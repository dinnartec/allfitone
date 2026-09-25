-- Un programa se puede eliminar, y se puede duplicar — `AFO-186`.
--
-- La lista de programas sólo enseña los publicados, y `OP-PLN-029` **rechaza un
-- programa que tenga cualquier versión publicada**. Así que hasta hoy lo que la lista
-- enseña es exactamente lo que no se puede borrar: la X del editor sabe tirar un
-- borrador y nada más.
--
-- **Nada se borra de verdad.** `allfit_api` no tiene `DELETE` sobre este recurso y no lo
-- va a tener. Eliminar es un estado, lo entrenado se conserva, y el acto tiene que ser
-- explicable después — la misma línea que ya sostienen `OP-PLN-028` y `OP-PLN-029`.
--
-- **Descartar un borrador y eliminar un programa son dos actos.** El primero no toca
-- ninguna rutina y sigue siendo `OP-PLN-029`; el segundo se lleva las rutinas que sólo
-- ese programa usaba, si se le pide.
--
-- Y duplicar existe además por lo que hoy no tiene salida: un programa de Allfit se toma
-- y su copia no siempre trae borrador, así que no se puede editar. Duplicarlo da una
-- copia propia que sí.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- `lifecycle = 'ended'` deja de ser imposible.
--
-- El enum lo tiene desde `20260831130000` y **nadie lo ha escrito nunca**, porque
-- `ck_program_assignments_personal_only` sólo admitía `personal`.
-- `20260909120000` ya lo dijo con todas las letras —«es dead hoy… deja de estarlo el día
-- que haya forma de dejar de seguir un programa»— y `read_current_assignment` lleva
-- desde entonces filtrando `lifecycle <> 'ended'` contra un valor que no existía. Ese
-- día es hoy: la restricción se abre exactamente a los dos valores que Space usa, y ni
-- uno más. `active` y `detached_pending_choice` son de las relaciones profesionales, que
-- no están construidas.
alter table planning.program_assignments
  drop constraint ck_program_assignments_personal_only,
  add constraint ck_program_assignments_lifecycle check (lifecycle in ('personal', 'ended'));

-- La proyección deja de exigir borrador.
--
-- El `join` era interno, así que un programa sin borrador se proyectaba como nada.
-- `discard_my_program` ya respondía nulo desde que borra el suyo, y eliminar haría lo
-- mismo: la operación converge y contesta «no existe». Un programa sin borrador es un
-- estado legítimo —el archivado, y el que se toma de Allfit— y lo que hay que decir de
-- él es que no tiene borrador, no que no está.
create or replace function planning.program_projection(p_program_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', program.id,
    'organization_id', program.owner_organization_id,
    'status', program.status,
    'author_person_id', program.author_person_id,
    'draft', planning.program_draft_projection(draft.id),
    'versions', coalesce((
      select jsonb_agg(planning.program_version_projection(version.id) order by version.version_number desc)
      from planning.program_versions as version
      where version.program_id = program.id
    ), '[]'::jsonb)
  )
  from planning.programs as program
  left join planning.program_drafts as draft on draft.program_id = program.id
  where program.id = p_program_id
$function$;

-- `OP-PLN-034` — Eliminar mi programa.
--
-- Una sola transacción: el programa se archiva, pierde su borrador, sus versiones
-- publicadas pasan a `deprecated` —no se borran, `ADR-009` las congela y hay sesiones
-- planificadas que las apuntan—, la asignación personal termina y se van sus sesiones
-- **no cumplidas**. Las cumplidas y las que tienen ejecución se quedan: son historia, y
-- la clave foránea de `planned_session_executions` es `RESTRICT`.
--
-- **Lo que de verdad lo saca de la pantalla es la asignación.** `read_my_programs` no
-- mira `program.status`: su `where` es la asignación y su `lifecycle`. Archivar sigue
-- siendo correcto —es lo que filtran `read_my_unpublished_program` y el republicado de
-- `OP-PLN-028`— pero lo que hace desaparecer la tarjeta es `'ended'`.
--
-- **El orden importa.** Primero el programa y después las rutinas, porque el republicado
-- de `OP-PLN-028` filtra `program.status <> 'archived'` y así no intenta republicar el
-- que acaba de irse.
create function planning.remove_my_program(
  p_person_id uuid,
  p_program_id uuid,
  p_with_routines boolean,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (program jsonb, replayed boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  current planning.programs%rowtype;
  ended record;
  orphan record;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-034', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_projection(receipt.aggregate_id), true;
    return;
  end if;

  -- Vale tanto para uno que escribió como para uno de Allfit que tomó: tomarlo lo
  -- bifurcó y la copia es suya.
  select * into current
  from planning.programs as owned
  where owned.id = p_program_id and owned.owner_person_id = p_person_id
  for update;
  if current.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;

  -- Eliminar dos veces converge: la segunda llamada lo encuentra archivado y contesta el
  -- mismo programa.
  if current.status <> 'archived' then
    update planning.programs
    set status = 'archived', updated_at = clock_timestamp()
    where id = p_program_id;

    delete from planning.program_drafts where program_id = p_program_id;

    -- Retiradas de uso nuevo, no borradas. `ck_program_versions_status` sólo admite
    -- `published` y `deprecated`, así que ésta es la única jugada que hay, y es la que
    -- el diseño pide. El disparador de inmutabilidad deja pasar exactamente este cambio
    -- —de `published` a `deprecated` y nada más— y rechaza tocar una ya retirada.
    update planning.program_versions
    set status = 'deprecated'
    where program_id = p_program_id and status = 'published';

    for ended in
      select assignment.id
      from planning.program_assignments as assignment
      join planning.program_versions as version on version.id = assignment.program_version_id
      where assignment.person_id = p_person_id
        and version.program_id = p_program_id
        and assignment.lifecycle <> 'ended'
      for update of assignment
    loop
      -- Sólo lo que no se entrenó. Una sesión cumplida es la mañana de alguien, y la
      -- clave foránea de su ejecución rechazaría el borrado de todas formas. Es el mismo
      -- filtro que `restate_assignment_onto`, y está copiado a propósito.
      delete from planning.planned_sessions as stale
      where stale.assignment_id = ended.id
        and stale.status <> 'completed'
        and not exists (
          select 1 from execution.planned_session_executions as attempt
          where attempt.planned_session_id = stale.id
        );

      update planning.program_assignments
      set lifecycle = 'ended'
      where id = ended.id;

      perform system.enqueue_outbox_event(
        'program_assignment', ended.id, 'planning.assignment_ended.v1',
        jsonb_build_object('assignment_id', ended.id, 'program_id', p_program_id,
                           'person_id', p_person_id)
      );
    end loop;

    perform system.enqueue_outbox_event(
      'program', p_program_id, 'planning.program_discarded.v1',
      jsonb_build_object('program_id', p_program_id)
    );
  end if;

  -- Las rutinas que sólo este programa usaba: propias de la persona, presentes en la
  -- composición de alguna versión suya, y que ningún otro programa no archivado de la
  -- persona use.
  --
  -- **Una rutina compartida se queda.** Archivarla rompería el otro programa, y
  -- `OP-PLN-028` ya se niega a dejar uno sin una sola sesión: sería pedir lo que el
  -- dominio prohíbe.
  --
  -- Se archivan **en sitio** y no por `discard_my_session_template`: esa operación lleva
  -- su propio recibo de idempotencia y una operación no puede llevar dos. Tampoco haría
  -- falta su republicado — por construcción ninguna de éstas está en otro programa vivo.
  if p_with_routines then
    for orphan in
      select distinct used.template_id as id
      from planning.program_versions as version
      join planning.program_version_sessions as composition
        on composition.program_version_id = version.id
      join planning.session_template_versions as used
        on used.id = composition.template_version_id
      join planning.session_templates as routine on routine.id = used.template_id
      where version.program_id = p_program_id
        and routine.owner_person_id = p_person_id
        and routine.status <> 'archived'
        and not exists (
          select 1
          from planning.programs as other
          join planning.program_versions as other_version on other_version.program_id = other.id
          join planning.program_version_sessions as other_composition
            on other_composition.program_version_id = other_version.id
          join planning.session_template_versions as other_used
            on other_used.id = other_composition.template_version_id
          where other.owner_person_id = p_person_id
            and other.status <> 'archived'
            and other.id <> p_program_id
            and other_used.template_id = used.template_id
        )
    loop
      update planning.session_templates
      set status = 'archived', updated_at = clock_timestamp()
      where id = orphan.id;

      -- El borrador se queda donde está, como en `OP-PLN-028`: archivar no es borrar, y
      -- los lectores ya filtran lo archivado. Dos operaciones hermanas, una sola regla.

      perform system.enqueue_outbox_event(
        'session_template', orphan.id, 'planning.session_template_discarded.v1',
        jsonb_build_object('template_id', orphan.id)
      );
    end loop;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'program-removed', 'program', p_program_id
  );
  return query select planning.program_projection(p_program_id), false;
end
$function$;

alter function planning.remove_my_program(uuid, uuid, boolean, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.remove_my_program(uuid, uuid, boolean, uuid, uuid, bytea) from public;
grant execute on function planning.remove_my_program(uuid, uuid, boolean, uuid, uuid, bytea) to allfit_api;

-- `OP-PLN-035` — Duplicar mi programa.
--
-- Crea un programa propio y su borrador, **y nada más**: no acuña ninguna versión y no
-- crea ninguna asignación. La copia existe como borrador; publicarla es el chulito del
-- editor y tirarla es la X.
--
-- La composición sale de la **última versión publicada** del original —o de su borrador,
-- si nunca publicó—, así que duplicar no publica de paso lo que alguien tuviera a
-- medias. **Las rutinas no se copian:** la composición apunta a las mismas versiones de
-- plantilla, que son inmutables. Copiarlas duplicaría la biblioteca de la persona por
-- cambiarle el nombre a un programa.
create function planning.duplicate_my_program(
  p_person_id uuid,
  p_program_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (program jsonb, replayed boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  origin planning.programs%rowtype;
  source jsonb;
  copy_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-035', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_projection(receipt.aggregate_id), true;
    return;
  end if;

  select * into origin
  from planning.programs as owned
  where owned.id = p_program_id and owned.owner_person_id = p_person_id;
  if origin.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'title', latest.title,
    'notes', latest.notes,
    'repeats_forever', latest.repeats_forever,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', composition.position,
        'week', composition.week,
        'day', composition.day,
        'template_version_id', composition.template_version_id
      ) order by composition.position)
      from planning.program_version_sessions as composition
      where composition.program_version_id = latest.id
    ), '[]'::jsonb)
  ) into source
  from planning.program_versions as latest
  where latest.program_id = p_program_id
  order by latest.version_number desc
  limit 1;

  -- Uno que nunca publicó sólo tiene borrador, y es lo que hay que copiar.
  if source is null then
    select draft.content into source
    from planning.program_drafts as draft
    where draft.program_id = p_program_id;
  end if;
  if source is null then
    raise exception 'program has nothing to copy' using errcode = '23514';
  end if;

  -- Hereda el estilo de sus rutinas: es una decisión del programa, y una copia se
  -- reconoce igual que su original. La portada del programa no viaja — `ADR-031` la
  -- elige al publicar, y la copia todavía no ha publicado nada.
  insert into planning.programs (
    content_scope, owner_person_id, author_person_id, status,
    routine_cover_kind, routine_cover_icon
  ) values (
    'person', p_person_id, p_person_id, 'draft',
    origin.routine_cover_kind, origin.routine_cover_icon
  ) returning id into copy_id;

  -- El sufijo cabe **dentro** de los 160 caracteres que exigen `programs`,
  -- `program_versions` y el contenido: se recorta el título a 152 y después se añade,
  -- o la copia de un título largo no se podría ni guardar ni publicar.
  insert into planning.program_drafts (program_id, content)
  values (copy_id, planning.canonical_program_content(
    source || jsonb_build_object('title', left(btrim(source->>'title'), 152) || ' - Copia')
  ));

  perform system.enqueue_outbox_event(
    'program', copy_id, 'planning.program_created.v1',
    jsonb_build_object('program_id', copy_id, 'person_id', p_person_id,
                       'duplicated_from_program_id', p_program_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-duplicated', 'program', copy_id
  );
  return query select planning.program_projection(copy_id), false;
end
$function$;

alter function planning.duplicate_my_program(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.duplicate_my_program(uuid, uuid, uuid, uuid, bytea) from public;
grant execute on function planning.duplicate_my_program(uuid, uuid, uuid, uuid, bytea) to allfit_api;

commit;
