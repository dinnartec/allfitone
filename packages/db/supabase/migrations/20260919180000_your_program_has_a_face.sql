-- Un programa propio también tiene cara — `HU-SP-100`.
--
-- Las veinticuatro portadas del catálogo son las únicas que existen, y un programa que
-- alguien escribe aquí se quedaba sin ninguna: la tarjeta de quien más trabajo puso era
-- la única sin imagen.
--
-- **La elige el contenido, no la persona.** Un programa de tren superior toma prestada la
-- portada de un programa global de tren superior; lo que se ve en la foto y lo que se
-- entrena hablan de lo mismo sin preguntarle nada a nadie. No hace falta una taxonomía
-- nueva: la región dominante de un programa ya está en sus ejercicios, y los globales ya
-- tienen portada.
--
-- **Medido antes de escribirlo:** calcular el perfil de los veintisiete programas de la
-- base cuesta 4 ms. Para los dos o tres de una persona es ruido, así que no hace falta
-- caer en el azar — pero cuando no hay coincidencia de región **sí** se reparte, y de
-- forma estable: el mismo programa recibe siempre la misma portada.
--
-- Se decide **al publicar** y se guarda. Al leer sería recalcular en cada foco de la
-- pestaña, y una portada que cambiara al añadir un ejercicio sería una tarjeta distinta
-- cada vez que alguien edita.

set statement_timeout = '60s';

begin;

set lock_timeout = '5s';

-- La región que más pesa en un programa: la de sus músculos primarios, y si no hay
-- primarios la de los que aparezcan. Nulo cuando el programa no tiene ejercicios todavía.
create or replace function planning.program_region(p_program_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select muscle.region
  from planning.program_versions as version
  join planning.program_version_sessions as composition
    on composition.program_version_id = version.id
  join planning.planned_steps as step
    on step.template_version_id = composition.template_version_id
  join catalog.movement_muscles as link on link.movement_id = step.movement_id
  join catalog.muscles as muscle on muscle.id = link.muscle_id
  where version.program_id = p_program_id
  group by muscle.region
  -- Los primarios mandan; el recuento total desempata.
  order by count(*) filter (where link.is_primary) desc, count(*) desc, muscle.region
  limit 1
$function$;

alter function planning.program_region(uuid) owner to allfit_owner;
revoke all on function planning.program_region(uuid) from public;
grant execute on function planning.program_region(uuid) to allfit_api;

-- Qué portada le toca. Determinista: el mismo programa recibe siempre la misma, así que
-- publicar otra vez no le cambia la cara.
create or replace function planning.pick_program_cover(p_program_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select candidate.cover_object_key
  from (
    select source.cover_object_key,
           planning.program_region(source.id) = planning.program_region(p_program_id) as misma_region
    from planning.programs as source
    where source.content_scope = 'global'
      and source.status = 'published'
      and source.cover_object_key is not null
  ) as candidate
  -- Las de la misma región primero; dentro de ellas, un orden estable derivado del
  -- identificador del programa, para que dos programas parecidos no salgan clonados.
  order by candidate.misma_region desc nulls last,
           extensions.digest(p_program_id::text || candidate.cover_object_key, 'sha256')
  limit 1
$function$;

alter function planning.pick_program_cover(uuid) owner to allfit_owner;
revoke all on function planning.pick_program_cover(uuid) from public;
grant execute on function planning.pick_program_cover(uuid) to allfit_api;

-- Lo que ya está publicado también tiene derecho a una cara.
--
-- **Persona por persona, con su contexto puesto.** `pick_program_cover` es
-- `security definer` y corre bajo las políticas del dueño de las tablas: sin actor no ve
-- ni los programas globales ni los de nadie, y el relleno se ejecutaría entero sin
-- escribir una fila y sin quejarse. Es el mismo tropiezo que el descarte de una foto, y
-- por eso el bucle existe.
do $$
declare
  owner record;
begin
  for owner in
    select distinct owner_person_id
    from planning.programs
    where content_scope = 'person' and cover_object_key is null and owner_person_id is not null
  loop
    perform set_config('app.actor_kind', 'person', true);
    perform set_config('app.actor_person_id', owner.owner_person_id::text, true);
    update planning.programs as target
    set cover_object_key = planning.pick_program_cover(target.id)
    where target.content_scope = 'person'
      and target.cover_object_key is null
      and target.owner_person_id = owner.owner_person_id;
  end loop;
  perform set_config('app.actor_person_id', '', true);
  perform set_config('app.actor_kind', '', true);
end $$;

create or replace function planning.publish_my_program(p_person_id uuid, p_program_id uuid, p_expected_etag text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
returns TABLE(version jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  draft planning.program_drafts%rowtype;
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  session jsonb;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-008', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_version_projection(receipt.aggregate_id), true;
    return;
  end if;

  select current_draft.* into draft
  from planning.program_drafts as current_draft
  join planning.programs as program on program.id = current_draft.program_id
  where program.id = p_program_id and program.owner_person_id = p_person_id
  for update of current_draft;
  if draft.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;

  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001',
      detail = planning.program_draft_projection(draft.id)::text;
  end if;
  perform planning.lock_program_template_versions(draft.content, null);
  errors := planning.program_content_errors(draft.content, null, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete program draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  canonical_content := planning.canonical_program_content(draft.content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
  -- Sólo la última, por la misma razón que en las plantillas: el identificador de
  -- versión viaja en asignaciones y sesiones planificadas.
  select latest.id into version_id
  from (
    select existing.id, existing.content_hash, existing.status
    from planning.program_versions as existing
    where existing.program_id = p_program_id
    order by existing.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is null then
    select coalesce(max(existing.version_number), 0) + 1 into next_version
    from planning.program_versions as existing where existing.program_id = p_program_id;
    insert into planning.program_versions (
      program_id, version_number, title, notes, content_hash
    ) values (
      p_program_id, next_version, canonical_content->>'title',
      canonical_content->>'notes', version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for session in
      select value from jsonb_array_elements(canonical_content->'sessions')
      order by (value->>'position')::integer
    loop
      insert into planning.program_version_sessions (
        program_version_id, template_version_id, position, week, day
      ) values (
        version_id, (session->>'template_version_id')::uuid,
        (session->>'position')::integer, (session->>'week')::integer,
        (session->>'day')::integer
      );
    end loop;
    update planning.programs
    set status = 'published', updated_at = clock_timestamp() where id = p_program_id;
    perform system.enqueue_outbox_event(
      'program_version', version_id, 'planning.program_version_published.v1',
      jsonb_build_object('program_id', p_program_id, 'version_id', version_id,
                         'version_number', next_version)
    );
  end if;
  -- Una portada, si todavía no tiene. Aquí y no al leer: la elección tiene que quedarse
  -- quieta, y una que cambiara al añadir un ejercicio sería una tarjeta distinta cada vez.
  update planning.programs
  set cover_object_key = planning.pick_program_cover(p_program_id)
  where id = p_program_id and cover_object_key is null;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-version-published', 'program_version', version_id
  );
  return query select planning.program_version_projection(version_id), false;
end
$function$;

commit;
