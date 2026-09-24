-- Descartar una rutina la saca de tus programas — `OP-PLN-028`.
--
-- Hasta ahora una rutina con alguna versión publicada **no se podía descartar**: se
-- rechazaba en seco porque hay programas y asignaciones que la referencian. El resultado
-- era una biblioteca donde lo único que se podía tirar era lo que nunca llegó a usarse.
--
-- Ahora se puede, y lo que pasa con los programas es explícito: **cada programa propio
-- que la usaba se republica sin ella y la asignación se muda sola a la versión nueva**,
-- así que quien lo estuviera entrenando sigue entrenándolo, con una sesión menos y sin
-- tener que hacer nada. Lo de Allfit no se toca —no es suyo— y la bifurcación ya le dio
-- una copia propia que sí lo es.
--
-- **Lo que no se hace:** vaciar un programa. Uno sin una sola sesión no se puede
-- publicar, así que si la rutina es la única que le queda, el descarte se rechaza
-- nombrando el programa en vez de dejar a alguien con algo que ya no se puede tocar.
--
-- Y dos piezas salen a funciones propias porque ahora las usan dos caminos:
-- `publish_program_content` sabe cómo nace una versión de programa, y
-- `restate_assignment_onto` cómo se muda una asignación. Copiarlas aquí habría dejado dos
-- sitios que saben lo mismo, que es como empiezan a divergir.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Cómo nace una versión de programa, en un solo sitio.
--
-- Estaba dentro de `publish_my_program`, que además lleva recibo, etag y borrador.
-- Descartar una rutina tiene que publicar el programa que la usaba sin ella, y copiar
-- aquí cuarenta líneas de inserción habría dejado dos sitios que saben cómo nace una
-- versión: así es como empiezan a divergir.
create or replace function planning.publish_program_content(p_program_id uuid, p_content jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  session jsonb;
begin
  perform planning.lock_program_template_versions(p_content, null);
  errors := planning.program_content_errors(p_content, null, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete program draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  canonical_content := planning.canonical_program_content(p_content);
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
  return version_id;
end
$function$;

alter function planning.publish_program_content(uuid, jsonb) owner to allfit_owner;
revoke all on function planning.publish_program_content(uuid, jsonb) from public, allfit_api;

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
  version_id := planning.publish_program_content(p_program_id, draft.content);

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-version-published', 'program_version', version_id
  );
  return query select planning.program_version_projection(version_id), false;
end
$function$;

-- Mudar una asignación a otra versión del mismo programa, sin recibo.
--
-- Por el mismo motivo: descartar una rutina republica el programa y la persona tiene que
-- quedar en la versión nueva sin pedir nada. `restate_my_program_assignment` sigue siendo
-- la operación; esto es lo que hace por dentro.
create or replace function planning.restate_assignment_onto(
  p_person_id uuid,
  p_program_version_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  assignment planning.program_assignments%rowtype;
  target_program_id uuid;
  first_week date;
begin
  select version.program_id into target_program_id
  from planning.program_versions as version where version.id = p_program_version_id;
  if target_program_id is null then return null; end if;

  -- The assignment for any version of this programme, newest first. Publishing is not
  -- starting: somebody who wrote a programme and never took it has nothing to restate.
  select existing.* into assignment
  from planning.program_assignments as existing
  join planning.program_versions as version on version.id = existing.program_version_id
  where existing.person_id = p_person_id and version.program_id = target_program_id
  order by existing.display_order, existing.assigned_at desc
  limit 1
  for update of existing;

  -- Nulo dice «no había nada siguiendo esto», que es como quien llama sabe que hay
  -- que tomar el programa en vez de mudarlo.
  if assignment.id is null then return null; end if;

  update planning.program_assignments
  set program_version_id = p_program_version_id
  where id = assignment.id;

  -- Only what has not been trained. A completed session is somebody's record of a
  -- morning, and the foreign key from its execution refuses the delete anyway.
  delete from planning.planned_sessions as stale
  where stale.assignment_id = assignment.id
    and stale.status <> 'completed'
    and not exists (
      select 1 from execution.planned_session_executions as attempt
      where attempt.planned_session_id = stale.id
    );

  -- Week N of the programme is calendar week N counted from where the assignment
  -- started, which is what keeps the week number from moving under somebody mid-week.
  first_week := date_trunc('week', assignment.starts_on::timestamp)::date;

  insert into planning.planned_sessions (
    assignment_id, person_id, template_version_id, program_day, week_starts_on, scheduled_at, timezone
  )
  select assignment.id, p_person_id, composition.template_version_id,
         composition.day,
         first_week + ((composition.week - 1) * 7),
         greatest(
           (first_week + ((composition.week - 1) * 7) + composition.day - 1)::timestamp,
           assignment.starts_on::timestamp
         ) at time zone assignment.timezone,
         assignment.timezone
  from (
    select composed.*,
           row_number() over (partition by composed.week order by composed.day) as slot
    from planning.program_version_sessions as composed
    where composed.program_version_id = p_program_version_id
  ) as composition
  -- How many the week still needs, counted rather than matched by day.
  --
  -- Which day of the base week a planned session came from cannot be recovered: the
  -- table does not store it, and `greatest(..., starts_on)` collapses every day before
  -- the start onto the same date, so three days of week one can share one. What the
  -- domain says is that the day is a suggestion and the week is the unit, so a week
  -- keeps as many sessions as the new version asks for and the trained ones count
  -- towards that. Protecting the whole week instead froze somebody at one of one when
  -- they added a second day.
  where composition.slot > coalesce((
    select count(*) from planning.planned_sessions as kept
    where kept.assignment_id = assignment.id
      and kept.week_starts_on = first_week + ((composition.week - 1) * 7)
      and kept.status = 'completed'
  ), 0);
  return assignment.id;
end
$function$;

alter function planning.restate_assignment_onto(uuid, uuid) owner to allfit_owner;
revoke all on function planning.restate_assignment_onto(uuid, uuid) from public, allfit_api;

create or replace function planning.restate_my_program_assignment(p_person_id uuid, p_program_version_id uuid, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  moved uuid;
  receipt record;
  target_program_id uuid;
  assignment record;
  first_week date;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-027', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then return receipt.aggregate_id; end if;

  select version.program_id into target_program_id
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id and program.owner_person_id = p_person_id;
  if target_program_id is null then
    raise exception 'program version is not available to this person' using errcode = '42501';
  end if;

  -- El trabajo está en `restate_assignment_onto`; aquí se queda el recibo, que es lo que
  -- hace de esto una operación y no una función.
  moved := planning.restate_assignment_onto(p_person_id, p_program_version_id);

  -- Nulo dice «no había nada siguiendo esto», que es como publicar sabe que hay que tomar
  -- el programa. El recibo no nombra agregado: no lo hay, y
  -- `ck_idempotency_keys_aggregate_pair` exige que el tipo y el id concuerden.
  if moved is null then
    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'program-assignment-unchanged', null, null
    );
    return null;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'program-assignment-restated',
    'program_assignment', moved
  );
  return moved;
end
$function$;

create or replace function planning.discard_my_session_template(p_person_id uuid, p_template_id uuid, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
returns TABLE(template jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  current planning.session_templates%rowtype;
  affected record;
  remaining jsonb;
  new_content jsonb;
  new_version_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-028', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_template_projection(receipt.aggregate_id), true;
    return;
  end if;

  select * into current
  from planning.session_templates as template
  where template.id = p_template_id and template.owner_person_id = p_person_id
  for update;
  if current.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  -- **Los programas de la persona la sueltan.** Antes esto se rechazaba en seco porque
  -- hay programas y asignaciones que la referencian; ahora se republica cada programa
  -- propio sin ella y la asignación se muda sola a la versión nueva. Lo de Allfit no se
  -- toca: no es suyo, y la bifurcación ya le dio una copia que sí lo es.
  --
  -- Se trabaja sobre la composición de la **última versión publicada** y no sobre el
  -- borrador: descartar una rutina no debe publicar de paso los cambios a medias que
  -- alguien tuviera sin guardar en otro programa.
  for affected in
    select program.id as program_id, latest.id as version_id, latest.title, latest.notes
    from planning.programs as program
    join lateral (
      select version.* from planning.program_versions as version
      where version.program_id = program.id
      order by version.version_number desc
      limit 1
    ) as latest on true
    where program.owner_person_id = p_person_id
      and program.status <> 'archived'
      and exists (
        select 1
        from planning.program_version_sessions as composition
        join planning.session_template_versions as used
          on used.id = composition.template_version_id
        where composition.program_version_id = latest.id and used.template_id = p_template_id
      )
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'position', composition.position,
             'week', composition.week,
             'day', composition.day,
             'template_version_id', composition.template_version_id
           ) order by composition.position), '[]'::jsonb)
    into remaining
    from planning.program_version_sessions as composition
    join planning.session_template_versions as used on used.id = composition.template_version_id
    where composition.program_version_id = affected.version_id
      and used.template_id <> p_template_id;

    -- Un programa sin una sola sesión no se puede publicar, y dejar a alguien con un
    -- programa que ya no se puede tocar sería peor que no borrar la rutina. Se dice cuál
    -- es y no se hace nada.
    if jsonb_array_length(remaining) = 0 then
      raise exception 'program would be left empty' using errcode = '23514',
        detail = affected.title;
    end if;

    new_content := jsonb_build_object(
      'title', affected.title, 'notes', affected.notes, 'sessions', remaining
    );
    update planning.program_drafts
    set content = planning.canonical_program_content(new_content),
        updated_at = clock_timestamp()
    where program_id = affected.program_id;

    new_version_id := planning.publish_program_content(affected.program_id, new_content);
    perform planning.restate_assignment_onto(p_person_id, new_version_id);
  end loop;

  if current.status <> 'archived' then
    update planning.session_templates
    set status = 'archived', updated_at = clock_timestamp()
    where id = p_template_id;

    -- Descartar se lleva las fotos que nadie referencia. Archivar no borra la plantilla,
    -- así que el cascade nunca dispara y sin esto los bytes sobrevivirían a la rutina que
    -- los justificaba.
    --
    -- **Las que una versión publicada congeló se quedan**, y ya no es un caso imposible:
    -- desde que una rutina publicada se puede descartar, sus versiones siguen existiendo
    -- y alguna versión vieja de un programa puede apuntarlas. La clave foránea es
    -- `RESTRICT` y rechazaría el borrado; `collect_cover_photos` respeta esa línea y se
    -- lleva exactamente lo demás.
    perform planning.collect_cover_photos(p_template_id, 'content_discarded');
    perform system.enqueue_outbox_event(
      'session_template', p_template_id, 'planning.session_template_discarded.v1',
      jsonb_build_object('template_id', p_template_id)
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'session-template-discarded',
    'session_template', p_template_id
  );
  return query select planning.session_template_projection(p_template_id), false;
end
$function$;

commit;
