-- Un programa puede no tener fin — `AFO-186`.
--
-- Hoy la duración es implícita: es el `max(week)` de la composición, y por eso siempre
-- es finita. A partir de ahora un programa puede **no tener fecha de fin**: cuando su
-- composición se acaba, vuelve a empezar. Al número de semanas de la composición lo
-- llamamos **el ciclo**, y lo que se repite es el ciclo entero, no «una semana».
--
-- **Vive en la versión y no en el programa**, porque cambia lo que se entrena: uno que
-- termina en ocho semanas y uno que no termina son dos programas distintos aunque
-- tengan la misma semana. Por eso entra en el contenido y en el hash.
--
-- **Consecuencia aceptada:** el canónico cambia, así que la primera republicación de un
-- programa que ya existía acuña una versión aunque nadie haya tocado nada. Es una vez y
-- es visible; lo contrario sería que dos programas distintos compartieran hash.
--
-- **La agenda no tiene fin, pero la lectura sí.** `ADR-022` prometió que no hay job de
-- calendario y la promesa se mantiene: no se crea ningún worker. Lo que cambia es que
-- «se materializa entera al asignar» deja de poder decirse de un programa sin fin,
-- porque no hay un «entera». Al asignar se siembra la semana de calendario en la que se
-- asigna, y después la lectura siembra la semana que va a enseñar. La siembra es
-- idempotente, está acotada a una semana, y no promete nada que no vaya a enseñar en el
-- mismo instante.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Por defecto `false`: lo que ya existe tenía fin, y decirlo de otra manera cambiaría
-- retroactivamente lo que alguien entrenó.
alter table planning.program_versions
  add column repeats_forever boolean not null default false;

-- La lista blanca admite la clave nueva y nada más; el valor tiene que ser booleano.
-- `"sí"` es la respuesta de una pantalla que no sabe lo que está diciendo.
CREATE OR REPLACE FUNCTION planning.program_content_errors(p_content jsonb, p_organization_id uuid, p_require_publishable boolean)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  errors text[] := array[]::text[];
  session jsonb;
  template_status catalog.publication_status;
begin
  if jsonb_typeof(p_content) <> 'object'
     or not p_content ?& array['title', 'sessions']
     or p_content - array['title', 'notes', 'sessions', 'repeats_forever'] <> '{}'::jsonb
     or jsonb_typeof(p_content->'title') <> 'string'
     or btrim(p_content->>'title') = ''
     or char_length(p_content->>'title') > 160
     or jsonb_typeof(p_content->'sessions') <> 'array' then
    return array['invalid-content-shape'];
  end if;
  if p_content ? 'notes'
     and jsonb_typeof(p_content->'notes') not in ('string', 'null') then
    errors := array_append(errors, 'notes');
  elsif jsonb_typeof(p_content->'notes') = 'string'
        and char_length(p_content->>'notes') > 2000 then
    errors := array_append(errors, 'notes');
  end if;
  -- Ausente es `false`, pero presente es booleano o nada.
  if p_content ? 'repeats_forever'
     and jsonb_typeof(p_content->'repeats_forever') <> 'boolean' then
    errors := array_append(errors, 'repeats_forever');
  end if;
  if jsonb_array_length(p_content->'sessions') > 730 then
    return array_append(errors, 'sessions');
  end if;
  if p_require_publishable and jsonb_array_length(p_content->'sessions') = 0 then
    errors := array_append(errors, 'sessions');
  end if;
  for session in select value from jsonb_array_elements(p_content->'sessions') loop
    if jsonb_typeof(session) <> 'object'
       or not session ?& array['position', 'week', 'day', 'template_version_id']
       or session - array['position', 'week', 'day', 'template_version_id'] <> '{}'::jsonb
       or jsonb_typeof(session->'position') <> 'number'
       or jsonb_typeof(session->'week') <> 'number'
       or jsonb_typeof(session->'day') <> 'number'
       or jsonb_typeof(session->'template_version_id') <> 'string'
       or session->>'position' !~ '^[1-9][0-9]*$'
       or (session->>'position')::numeric > 730
       or session->>'week' !~ '^[1-9][0-9]*$'
       or (session->>'week')::numeric > 104
       or session->>'day' !~ '^[1-7]$'
       or session->>'template_version_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      errors := array_append(errors, 'session-shape');
      continue;
    end if;
    select version.status into template_status
    from planning.session_template_versions as version
    join planning.session_templates as template on template.id = version.template_id
    where version.id = (session->>'template_version_id')::uuid
      and (template.content_scope = 'global'
        or template.owner_organization_id = p_organization_id
        or template.owner_person_id = access_control.person());
    if template_status is null then
      errors := array_append(errors, 'template-version');
    end if;
  end loop;
  if exists (
    select item.value->>'position'
    from jsonb_array_elements(p_content->'sessions') as item(value)
    group by item.value->>'position'
    having count(*) > 1
  ) then
    errors := array_append(errors, 'duplicate-session-position');
  end if;
  return errors;
exception when others then
  return array_append(errors, 'invalid-content-value');
end
$function$;

-- El canónico emite siempre la clave, nunca ausente: es lo que hace que dos programas
-- distintos no compartan hash.
CREATE OR REPLACE FUNCTION planning.canonical_program_content(p_content jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'title', btrim(p_content->>'title'),
    'notes', nullif(p_content->>'notes', ''),
    'repeats_forever', coalesce((p_content->>'repeats_forever')::boolean, false),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', (session.value->>'position')::integer,
        'week', (session.value->>'week')::integer,
        'day', (session.value->>'day')::integer,
        'template_version_id', (session.value->>'template_version_id')::uuid
      ) order by (session.value->>'position')::integer)
      from jsonb_array_elements(p_content->'sessions') as session(value)
    ), '[]'::jsonb)
  )
$function$;

-- Publicar guarda en la versión lo que el canónico dice, que es lo mismo que el hash
-- describe. `publish_my_program` no se toca: desde `20260919210000` delega aquí.
CREATE OR REPLACE FUNCTION planning.publish_program_content(p_program_id uuid, p_content jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      program_id, version_number, title, notes, content_hash, repeats_forever
    ) values (
      p_program_id, next_version, canonical_content->>'title',
      canonical_content->>'notes', version_content_hash,
      (canonical_content->>'repeats_forever')::boolean
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

CREATE OR REPLACE FUNCTION planning.publish_program_version(p_person_id uuid, p_organization_id uuid, p_program_id uuid, p_expected_etag text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(result jsonb, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  perform planning.assert_manage_content(p_person_id, p_organization_id);
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
  where program.id = p_program_id and program.owner_organization_id = p_organization_id
  for update of program, current_draft;
  if draft.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;
  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001', detail = planning.program_draft_projection(draft.id)::text;
  end if;
  perform planning.lock_program_template_versions(draft.content, p_organization_id);
  errors := planning.program_content_errors(draft.content, p_organization_id, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete program draft' using errcode = '22023', detail = to_json(errors)::text;
  end if;
  canonical_content := planning.canonical_program_content(draft.content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
  -- Sólo la última, por la misma razón que en las plantillas: el identificador de
  -- versión viaja en asignaciones y sesiones planificadas.
  select latest.id into version_id
  from (
    select version.id, version.content_hash, version.status
    from planning.program_versions as version
    where version.program_id = p_program_id
    order by version.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is null then
    select coalesce(max(version.version_number), 0) + 1 into next_version
    from planning.program_versions as version where version.program_id = p_program_id;
    insert into planning.program_versions (
      program_id, version_number, title, notes, content_hash, repeats_forever
    ) values (
      p_program_id, next_version, canonical_content->>'title',
      canonical_content->>'notes', version_content_hash,
      (canonical_content->>'repeats_forever')::boolean
    ) returning id into version_id;
    perform set_config('app.planning_publication', 'true', true);
    for session in select value from jsonb_array_elements(canonical_content->'sessions') order by (value->>'position')::integer loop
      insert into planning.program_version_sessions (
        program_version_id, template_version_id, position, week, day
      ) values (
        version_id, (session->>'template_version_id')::uuid,
        (session->>'position')::integer, (session->>'week')::integer, (session->>'day')::integer
      );
    end loop;
    update planning.programs set status = 'published', updated_at = clock_timestamp() where id = p_program_id;
    perform system.enqueue_outbox_event(
      'program_version', version_id, 'planning.program_version_published.v1',
      jsonb_build_object('program_id', p_program_id, 'version_id', version_id, 'version_number', next_version)
    );
  end if;
  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'program-version-published', 'program_version', version_id);
  return query select planning.program_version_projection(version_id), false;
end
$function$;

CREATE OR REPLACE FUNCTION planning.publish_global_program(p_program_id uuid, p_content jsonb, p_sex_affinity identity.biological_sex, p_goals text[], p_levels text[], p_emphases text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
begin
  errors := planning.program_content_errors(p_content, null, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete global program' using errcode = '22023', detail = to_json(errors)::text;
  end if;

  insert into planning.programs (id, content_scope, status)
  values (p_program_id, 'global', 'published')
  on conflict (id) do nothing;

  canonical_content := planning.canonical_program_content(p_content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');

  select latest.id into version_id
  from (
    select version.id, version.content_hash, version.status
    from planning.program_versions as version
    where version.program_id = p_program_id
    order by version.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is not null then
    return version_id;
  end if;

  insert into planning.program_versions (
    program_id, version_number, title, notes, content_hash, sex_affinity, repeats_forever
  )
  select p_program_id,
         coalesce(max(existing.version_number), 0) + 1,
         canonical_content->>'title',
         nullif(canonical_content->>'notes', ''),
         version_content_hash,
         p_sex_affinity,
         (canonical_content->>'repeats_forever')::boolean
  from planning.program_versions as existing
  where existing.program_id = p_program_id
  returning id into version_id;

  perform set_config('app.planning_publication', 'true', true);
  insert into planning.program_version_sessions (
    program_version_id, template_version_id, position, week, day
  )
  select version_id,
         (entry.value->>'template_version_id')::uuid,
         (entry.value->>'position')::integer,
         (entry.value->>'week')::integer,
         (entry.value->>'day')::integer
  from jsonb_array_elements(canonical_content->'sessions') as entry(value);

  -- The segmentation belongs to the version and is written with it: re-aiming a
  -- published version means publishing another one.
  insert into planning.program_version_goals (program_version_id, goal_code)
  select version_id, unnest(p_goals);
  insert into planning.program_version_levels (program_version_id, experience_code)
  select version_id, unnest(p_levels);
  insert into planning.program_version_emphases (program_version_id, focus_area_code)
  select version_id, unnest(p_emphases);

  return version_id;
end
$function$;

commit;

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Tomar un programa sin fin es quedárselo sin fin: la copia hereda la marca y su
-- borrador la lleva escrita, o al primer guardado el programa volvería a tener final.
CREATE OR REPLACE FUNCTION planning.fork_program_version(p_person_id uuid, p_program_version_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  source record;
  new_program_id uuid;
  new_version_id uuid;
  mapping jsonb := '{}'::jsonb;
  template record;
  new_template_id uuid;
  new_template_version_id uuid;
  step record;
  new_step_id uuid;
begin
  select version.id, version.title, version.notes, version.content_hash,
         version.sex_affinity, version.repeats_forever
  into source
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id
    and version.status = 'published'
    and program.content_scope = 'global'
    and program.status = 'published';
  if source.id is null then
    raise exception 'program version is not forkable' using errcode = '42501';
  end if;

  perform set_config('app.planning_publication', 'true', true);

  -- One copy per distinct template the program composes, remembered so the new
  -- composition points at the person's own versions and never at Allfit's.
  for template in
    select distinct source_version.id as version_id,
           -- El contenido que la copia va a tener, calculado una vez: fija su hash y es
           -- su borrador. La portada viaja entera, incluida la fotografía: desde que sale
           -- del catálogo y no de la galería de nadie, copiarla no es quedarse con algo
           -- ajeno.
           planning.canonical_session_content(
             planning.session_version_projection(source_version.id)) as content,
           source_version.template_id,
           source_version.discipline_code,
           source_version.activity_type_id,
           source_version.title,
           source_version.content_hash,
           source_template.discipline_code as template_discipline
    from planning.program_version_sessions as composition
    join planning.session_template_versions as source_version
      on source_version.id = composition.template_version_id
    join planning.session_templates as source_template
      on source_template.id = source_version.template_id
    where composition.program_version_id = p_program_version_id
  loop
    insert into planning.session_templates (
      content_scope, owner_person_id, author_person_id, discipline_code, status
    ) values ('person', p_person_id, p_person_id, template.template_discipline, 'published')
    returning id into new_template_id;

    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id, title,
      derived_from_version_id, content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title,
      -- De dónde salió. La copia es una plantilla nueva con identidad propia, así que
      -- sin esto no hay forma de contar cuánta gente entrena algo derivado de un
      -- programa de Allfit: son plantillas sueltas que se parecen.
      template.version_id,
      -- **El hash de su propio contenido, no el del original.** Copiar el del origen
      -- era copiar la descripción de otra cosa.
      extensions.digest(
        convert_to(planning.canonical_session_content(template.content)::text, 'UTF8'),
        'sha256'
      ),
      'published', clock_timestamp()
    ) returning id into new_template_version_id;

    for step in
      select id, position, movement_id, activity_type_id, notes, superset_group
      from planning.planned_steps
      where template_version_id = template.version_id
      order by position
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        new_template_version_id, step.position, step.movement_id, step.activity_type_id,
        step.notes, step.superset_group
      ) returning id into new_step_id;

      -- The sets come first: `IX-47` compares the summary against them, and the
      -- constraint is deferred so the order inside the transaction does not matter,
      -- but a fork that copied only the summary would flatten the routine.
      insert into planning.planned_sets (
        planned_step_id, set_order, kind, target_reps,
        target_load_value, target_load_unit_code, target_rpe
      )
      select new_step_id, set_order, kind, target_reps,
             target_load_value, target_load_unit_code, target_rpe
      from planning.planned_sets where planned_step_id = step.id;

      insert into planning.strength_targets (
        planned_step_id, target_sets, target_reps, target_load_value,
        target_load_unit_code, target_rpe, target_rest_seconds
      )
      select new_step_id, target_sets, target_reps, target_load_value,
             target_load_unit_code, target_rpe, target_rest_seconds
      from planning.strength_targets where planned_step_id = step.id;

      insert into planning.endurance_targets (
        planned_step_id, target_distance_value, target_distance_unit_code,
        target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      )
      select new_step_id, target_distance_value, target_distance_unit_code,
             target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      from planning.endurance_targets where planned_step_id = step.id;

      insert into planning.interval_targets (
        planned_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      )
      select new_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      from planning.interval_targets where planned_step_id = step.id;

      insert into planning.mobility_targets (
        planned_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      )
      select new_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      from planning.mobility_targets where planned_step_id = step.id;
    end loop;

    -- **Y su borrador.** Tomar es quedárselo, y una rutina que no se puede abrir para
    -- editar no es del todo tuya.
    insert into planning.session_template_drafts (template_id, content, derived_from_version_id)
    values (new_template_id, template.content, new_template_version_id);

    mapping := mapping || jsonb_build_object(template.version_id::text, new_template_version_id);
  end loop;

  -- La copia se lleva la cara del original **y el estilo de sus rutinas**: tomar un
  -- programa de Allfit y que sus seis tarjetas cambiaran de aspecto sería tomar otro.
  insert into planning.programs (
    content_scope, owner_person_id, author_person_id, status, cover_object_key,
    routine_cover_kind, routine_cover_icon
  )
  select 'person', p_person_id, p_person_id, 'published', origin.cover_object_key,
         origin.routine_cover_kind, origin.routine_cover_icon
  from planning.programs as origin
  join planning.program_versions as taken on taken.program_id = origin.id
  where taken.id = p_program_version_id
  returning id into new_program_id;

  insert into planning.program_versions (
    program_id, version_number, title, notes, content_hash, status, published_at,
    sex_affinity, repeats_forever
  ) values (
    new_program_id, 1, source.title, source.notes, source.content_hash,
    'published', clock_timestamp(), source.sex_affinity, source.repeats_forever
  ) returning id into new_version_id;

  insert into planning.program_version_sessions (
    program_version_id, template_version_id, position, week, day
  )
  select new_version_id,
         (mapping->>composition.template_version_id::text)::uuid,
         composition.position, composition.week, composition.day
  from planning.program_version_sessions as composition
  where composition.program_version_id = p_program_version_id;

  -- **Y su borrador.** Sin él, un programa tomado de Allfit no se puede abrir para
  -- editar: `read_my_programs` marca `editable` cuando hay borrador, y la tarjeta se
  -- quedaba sin el botón.
  --
  -- La composición se reconstruye de la copia recién hecha, que es donde las sesiones ya
  -- apuntan a las plantillas de la persona. **Y lleva `repeats_forever`**, o el primer
  -- guardado del borrador le devolvería una fecha de fin que el original no tenía.
  insert into planning.program_drafts (program_id, content)
  select new_program_id, planning.canonical_program_content(jsonb_build_object(
    'title', source.title,
    'notes', source.notes,
    'repeats_forever', source.repeats_forever,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', composition.position,
        'week', composition.week,
        'day', composition.day,
        'template_version_id', composition.template_version_id
      ) order by composition.position)
      from planning.program_version_sessions as composition
      where composition.program_version_id = new_version_id
    ), '[]'::jsonb)
  ));

  -- The segmentation travels with the copy: it is what the catalogue matched on,
  -- and a copy that forgot it would stop being findable as the thing it is.
  insert into planning.program_version_goals (program_version_id, goal_code)
  select new_version_id, goal_code from planning.program_version_goals
  where program_version_id = p_program_version_id;
  insert into planning.program_version_levels (program_version_id, experience_code)
  select new_version_id, experience_code from planning.program_version_levels
  where program_version_id = p_program_version_id;
  insert into planning.program_version_emphases (program_version_id, focus_area_code)
  select new_version_id, focus_area_code from planning.program_version_emphases
  where program_version_id = p_program_version_id;

  return new_version_id;
end
$function$;

commit;

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Sembrar la semana en curso de lo que no tiene fin.
--
-- No es un worker: lo llama la lectura de la agenda, justo antes de enseñar la semana
-- que acaba de sembrar. Por eso está acotada a **una** semana y es idempotente — dos
-- lecturas simultáneas sembrarían la misma semana dos veces, y el cerrojo consultivo
-- sobre la asignación es lo que lo impide.
create function planning.plant_my_open_week(p_person_id uuid, p_timezone text)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  this_week date;
  assignment record;
  program_week integer;
  cycle integer;
  composition_week integer;
begin
  this_week := date_trunc('week', (clock_timestamp() at time zone p_timezone))::date;

  for assignment in
    select taken.id, taken.program_version_id, taken.starts_on, taken.timezone
    from planning.program_assignments as taken
    join planning.program_versions as version on version.id = taken.program_version_id
    where taken.person_id = p_person_id
      and taken.lifecycle = 'personal'
      and version.repeats_forever
    order by taken.id
  loop
    -- La semana de programa se cuenta igual que en todas partes: desde la semana de
    -- calendario en la que empezó la asignación.
    program_week := (this_week - date_trunc('week', assignment.starts_on::timestamp)::date) / 7 + 1;
    -- La asignación empieza después de hoy: no hay nada que sembrar todavía.
    if program_week < 1 then
      continue;
    end if;

    -- Antes de mirar, no después: dos lecturas a la vez veían las dos la semana vacía.
    perform pg_advisory_xact_lock(hashtextextended(assignment.id::text, 0::bigint));

    if exists (
      select 1 from planning.planned_sessions as planted
      where planted.assignment_id = assignment.id
        and planted.week_starts_on = this_week
    ) then
      continue;
    end if;

    select max(composed.week) into cycle
    from planning.program_version_sessions as composed
    where composed.program_version_id = assignment.program_version_id;
    if cycle is null or cycle < 1 then
      continue;
    end if;
    composition_week := ((program_week - 1) % cycle) + 1;

    -- El mismo cálculo de `scheduled_at` que al asignar, **sin** el adelanto de la
    -- primera semana: ese adelanto existe para no estrenar un programa con sesiones ya
    -- perdidas, y la semana ciento tres no se estrena.
    insert into planning.planned_sessions (
      assignment_id, person_id, template_version_id, program_day,
      week_starts_on, scheduled_at, timezone
    )
    select assignment.id, p_person_id, composed.template_version_id,
           composed.day,
           this_week,
           (this_week + composed.day - 1)::timestamp at time zone assignment.timezone,
           assignment.timezone
    from planning.program_version_sessions as composed
    where composed.program_version_id = assignment.program_version_id
      and composed.week = composition_week;
  end loop;
end
$function$;

-- Sin `execute` para el runtime: la siembra no es una operación que nadie invoque, es
-- lo que hacen las dos lecturas antes de enseñar la semana, y ambas son `definer`.
alter function planning.plant_my_open_week(uuid, text) owner to allfit_owner;
revoke all on function planning.plant_my_open_week(uuid, text) from public, allfit_api;

-- La lectura siembra lo que va a enseñar. Deja de ser `sql` para poder hacerlo: la
-- misma consulta de siempre, precedida de la siembra de esta semana.
CREATE OR REPLACE FUNCTION planning.read_week_plan(p_person_id uuid, p_timezone text)
 RETURNS TABLE(assignment_id uuid, program_version_id uuid, program_title text, program_week integer, week_starts_on date, sessions jsonb)
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform planning.plant_my_open_week(p_person_id, p_timezone);
  return query
  select assignment.id,
         version.id,
         version.title,
         (((clock_timestamp() at time zone p_timezone)::date
           - date_trunc('week', assignment.starts_on::timestamp)::date) / 7 + 1)::integer,
         date_trunc('week', (clock_timestamp() at time zone p_timezone))::date,
         coalesce(week.entries, '[]'::jsonb)
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.scheduled_at) as entries
    from (
      select session.id as planned_session_id,
             template_version.title as title,
             template_version.discipline_code,
             session.status,
             session.program_day,
             session.scheduled_at,
             (select count(*)::integer from planning.planned_steps as step
               where step.template_version_id = session.template_version_id) as exercise_count,
             (select coalesce(sum(target.target_sets), 0)::integer
               from planning.planned_steps as step
               join planning.strength_targets as target on target.planned_step_id = step.id
               where step.template_version_id = session.template_version_id) as set_count,
             exists (
               select 1 from execution.planned_session_executions as attempt
               join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
               where attempt.planned_session_id = session.id
                 and executed.execution_status = 'completed'
             ) as done,
             (
               select attempt.executed_session_id
               from execution.planned_session_executions as attempt
               join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
               where attempt.planned_session_id = session.id
                 and executed.execution_status = 'in_progress'
               order by attempt.attempt_number desc
               limit 1
             ) as open_execution_id
      from planning.planned_sessions as session
      join planning.session_template_versions as template_version
        on template_version.id = session.template_version_id
      where session.assignment_id = assignment.id
        and session.week_starts_on
            = date_trunc('week', (clock_timestamp() at time zone p_timezone))::date
    ) as entry
  ) as week on true
  where assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.display_order, assignment.assigned_at desc
  limit 1;
end
$function$;

alter function planning.read_week_plan(uuid, text) owner to allfit_owner;
revoke all on function planning.read_week_plan(uuid, text) from public;
grant execute on function planning.read_week_plan(uuid, text) to allfit_api;

-- Y la de hoy por lo mismo: `start_planned_session_attempt` exige que la fila exista,
-- así que nadie puede entrenar una semana que no esté sembrada.
CREATE OR REPLACE FUNCTION planning.read_today_session(p_person_id uuid, p_timezone text)
 RETURNS TABLE(planned_session_id uuid, assignment_id uuid, program_title text, session_title text, discipline_code text, scheduled_on date, status text, exercise_count integer, executed_session_id uuid, execution_status text)
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform planning.plant_my_open_week(p_person_id, p_timezone);
  return query
  select session.id,
         session.assignment_id,
         version.title,
         template_version.title,
         template_version.discipline_code,
         (session.scheduled_at at time zone session.timezone)::date,
         session.status,
         (select count(*)::integer from planning.planned_steps as step
           where step.template_version_id = session.template_version_id),
         open_attempt.executed_session_id,
         open_attempt.execution_status::text
  from planning.planned_sessions as session
  join planning.program_assignments as assignment on assignment.id = session.assignment_id
  join planning.program_versions as version on version.id = assignment.program_version_id
  join planning.session_template_versions as template_version
    on template_version.id = session.template_version_id
  left join lateral (
    select attempt.executed_session_id, executed.execution_status
    from execution.planned_session_executions as attempt
    join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
    where attempt.planned_session_id = session.id
      and executed.execution_status = 'in_progress'
    order by attempt.attempt_number desc
    limit 1
  ) as open_attempt on true
  where session.person_id = p_person_id
    and session.week_starts_on
        = date_trunc('week', (clock_timestamp() at time zone p_timezone))::date
    -- Pending, or already open: an attempt in progress is what somebody comes back
    -- to, and offering the next one instead would strand it.
    and (session.status = 'scheduled' or open_attempt.executed_session_id is not null)
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by open_attempt.executed_session_id nulls last, session.scheduled_at
  limit 1;
end
$function$;

alter function planning.read_today_session(uuid, text) owner to allfit_owner;
revoke all on function planning.read_today_session(uuid, text) from public;
grant execute on function planning.read_today_session(uuid, text) to allfit_api;

commit;

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Tomar un programa sin fin siembra **la semana en la que se toma**, y nada más: no hay
-- un «entera» que materializar. El adelanto de la primera semana se queda, porque una
-- primera semana sigue siendo una primera semana.
CREATE OR REPLACE FUNCTION planning.self_assign_program(p_person_id uuid, p_program_version_id uuid, p_timezone text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  new_assignment_id uuid;
  starts date;
  first_week date;
  reachable boolean;
  is_global boolean;
  assigned_version_id uuid;
  open_ended boolean;
  front integer;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'assignment person does not match the authenticated actor' using errcode = '42501';
  end if;

  begin
    starts := (clock_timestamp() at time zone p_timezone)::date;
  exception when others then
    raise exception 'invalid timezone' using errcode = '22023';
  end;
  first_week := date_trunc('week', starts::timestamp)::date;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-011', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return receipt.aggregate_id;
  end if;

  select exists (
    select 1
    from planning.program_versions as version
    join planning.programs as program on program.id = version.program_id
    where version.id = p_program_version_id
      and version.status = 'published'
      and (
        program.content_scope = 'global' and program.status = 'published'
        or program.owner_person_id = p_person_id
      )
  ),
  exists (
    select 1
    from planning.program_versions as version
    join planning.programs as program on program.id = version.program_id
    where version.id = p_program_version_id and program.content_scope = 'global'
  )
  into reachable, is_global;
  if not reachable then
    raise exception 'program version is not available to this person' using errcode = '42501';
  end if;

  -- Taking Allfit's program is keeping it. The copy is what makes it editable
  -- later; immutability alone only makes it stable.
  assigned_version_id := case
    when is_global then planning.fork_program_version(p_person_id, p_program_version_id)
    else p_program_version_id
  end;

  select version.repeats_forever into open_ended
  from planning.program_versions as version where version.id = assigned_version_id;

  -- In front of everything, so the tab opens on what was just taken.
  select coalesce(min(assignment.display_order), 1) - 1 into front
  from planning.program_assignments as assignment
  where assignment.person_id = p_person_id;

  insert into planning.program_assignments (
    person_id, program_version_id, lifecycle, starts_on, timezone, display_order
  ) values (p_person_id, assigned_version_id, 'personal', starts, p_timezone, front)
  returning id into new_assignment_id;

  -- Week N of the program is calendar week N, counted from the one that contains
  -- today. The day inside the week is a suggestion, so it is only ever used to
  -- order the list — never to decide what can be trained.
  --
  -- Sin fin, sólo la semana de composición que le toca a esta semana de calendario, que
  -- al asignar es siempre la primera. Lo demás lo siembra la lectura cuando llegue.
  insert into planning.planned_sessions (
    assignment_id, person_id, template_version_id, program_day, week_starts_on, scheduled_at, timezone
  )
  select new_assignment_id, p_person_id, composition.template_version_id,
         composition.day,
         first_week + ((composition.week - 1) * 7),
         greatest(
           (first_week + ((composition.week - 1) * 7) + composition.day - 1)::timestamp,
           starts::timestamp
         ) at time zone p_timezone,
         p_timezone
  from planning.program_version_sessions as composition
  where composition.program_version_id = assigned_version_id
    and (not coalesce(open_ended, false) or composition.week = 1);

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-assignment-created',
    'program_assignment', new_assignment_id
  );
  return new_assignment_id;
end
$function$;

-- Re-plantear un programa sin fin es re-plantear **la semana en curso**: no hay
-- composición entera que volver a tender, y las semanas siguientes las siembra la
-- lectura con la versión nueva, que para entonces ya es la de la asignación.
CREATE OR REPLACE FUNCTION planning.restate_assignment_onto(p_person_id uuid, p_program_version_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  assignment planning.program_assignments%rowtype;
  target_program_id uuid;
  first_week date;
  open_ended boolean;
  this_week date;
  program_week integer;
  cycle integer;
begin
  select version.program_id, version.repeats_forever
  into target_program_id, open_ended
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

  if coalesce(open_ended, false) then
    this_week := date_trunc('week', (clock_timestamp() at time zone assignment.timezone))::date;
    program_week := (this_week - first_week) / 7 + 1;
    select max(composed.week) into cycle
    from planning.program_version_sessions as composed
    where composed.program_version_id = p_program_version_id;
    if program_week < 1 or cycle is null or cycle < 1 then
      return assignment.id;
    end if;

    insert into planning.planned_sessions (
      assignment_id, person_id, template_version_id, program_day, week_starts_on, scheduled_at, timezone
    )
    select assignment.id, p_person_id, composition.template_version_id,
           composition.day,
           this_week,
           (this_week + composition.day - 1)::timestamp at time zone assignment.timezone,
           assignment.timezone
    from (
      select composed.*,
             row_number() over (order by composed.day) as slot
      from planning.program_version_sessions as composed
      where composed.program_version_id = p_program_version_id
        and composed.week = ((program_week - 1) % cycle) + 1
    ) as composition
    -- Lo mismo que abajo, contado sobre la única semana que hay: lo entrenado cuenta
    -- para lo que la semana pide.
    where composition.slot > coalesce((
      select count(*) from planning.planned_sessions as kept
      where kept.assignment_id = assignment.id
        and kept.week_starts_on = this_week
        and kept.status = 'completed'
    ), 0);
    return assignment.id;
  end if;

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

commit;

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- `weeks` nulo dice «no tiene fecha de fin», y es lo único que se puede decir sin
-- mentir. El ciclo —`max(week)`, que existe siempre— se queda aparte, porque es lo que
-- decide si el programa se puede editar: comparar contra la duración declarada dejaba
-- fuera del editor justo al que no la tiene.
CREATE OR REPLACE FUNCTION planning.read_my_programs(p_person_id uuid)
 RETURNS TABLE(assignment_id uuid, program_version_id uuid, program_id uuid, title text, weeks integer, days_per_week integer, starts_on date, sessions_done integer, sessions_planned integer, editable boolean, cover_object_key text, routine_cover jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select assignment.id,
         version.id,
         version.program_id,
         version.title,
         case when version.repeats_forever then null else composition.cycle end,
         composition.days_per_week,
         assignment.starts_on,
         counted.done,
         counted.planned,
         -- A draft exists only for a programme somebody wrote here. A fork has none,
         -- and a programme whose weeks differ cannot be said as one repeated week.
         draft.id is not null
           and composition.cycle * composition.days_per_week = composition.sessions,
         program.cover_object_key,
         -- El estilo que llevan sus rutinas, que es una decisión del programa y no de
         -- cada una: seis tarjetas con seis lenguajes distintos en el mismo carrusel.
         case when program.routine_cover_kind is null then null else jsonb_strip_nulls(
           jsonb_build_object('kind', program.routine_cover_kind, 'icon', program.routine_cover_icon)
         ) end
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  join planning.programs as program on program.id = version.program_id
  left join planning.program_drafts as draft on draft.program_id = version.program_id
  join lateral (
    select max(session.week) as cycle,
           count(distinct session.day) filter (where session.week = 1)::integer as days_per_week,
           count(*)::integer as sessions
    from planning.program_version_sessions as session
    where session.program_version_id = version.id
  ) as composition on true
  join lateral (
    select count(*) filter (where session.status = 'completed')::integer as done,
           count(*)::integer as planned
    from planning.planned_sessions as session
    where session.assignment_id = assignment.id
  ) as counted on true
  where assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.display_order, assignment.assigned_at desc
$function$;

alter function planning.read_my_programs(uuid) owner to allfit_owner;
revoke all on function planning.read_my_programs(uuid) from public;
grant execute on function planning.read_my_programs(uuid) to allfit_api;

CREATE OR REPLACE FUNCTION planning.read_program_version(p_person_id uuid, p_program_version_id uuid)
 RETURNS TABLE(program_version_id uuid, title text, notes text, weeks integer, days_per_week integer, sex_affinity text, goals text[], levels text[], emphases text[], days jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select version.id,
         version.title,
         version.notes,
         case when version.repeats_forever then null else composition.weeks end,
         composition.days_per_week,
         version.sex_affinity::text,
         coalesce(goals.codes, array[]::text[]),
         coalesce(levels.codes, array[]::text[]),
         coalesce(emphases.codes, array[]::text[]),
         coalesce(split.days, '[]'::jsonb)
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day) filter (where session.week = 1)::integer as days_per_week
    from planning.program_version_sessions as session
    where session.program_version_id = version.id
  ) as composition on true
  left join lateral (
    select array_agg(goal.goal_code order by goal.goal_code) as codes
    from planning.program_version_goals as goal
    where goal.program_version_id = version.id
  ) as goals on true
  left join lateral (
    select array_agg(level.experience_code order by level.experience_code) as codes
    from planning.program_version_levels as level
    where level.program_version_id = version.id
  ) as levels on true
  left join lateral (
    select array_agg(emphasis.focus_area_code order by emphasis.focus_area_code) as codes
    from planning.program_version_emphases as emphasis
    where emphasis.program_version_id = version.id
  ) as emphases on true
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.day) as days
    from (
      select composed.day as day,
             template_version.title as title,
             template_version.discipline_code,
             (
               select jsonb_agg(
                 jsonb_build_object(
                   'position', step.position,
                   'movement_id', movement.id,
                   'movement', movement.name,
                   'target', coalesce(strength.target, endurance.target, interval_step.target, mobility.target)
                 ) order by step.position)
               from planning.planned_steps as step
               left join catalog.movements as movement on movement.id = step.movement_id
               left join lateral (
                 select jsonb_build_object(
                   'family', 'strength', 'target_sets', target.target_sets,
                   'target_reps', target.target_reps, 'target_rpe', target.target_rpe) as target
                 from planning.strength_targets as target where target.planned_step_id = step.id
               ) as strength on true
               left join lateral (
                 select jsonb_build_object(
                   'family', 'endurance', 'target_distance_value', target.target_distance_value,
                   'target_distance_unit_code', target.target_distance_unit_code,
                   'target_duration_seconds', target.target_duration_seconds) as target
                 from planning.endurance_targets as target where target.planned_step_id = step.id
               ) as endurance on true
               left join lateral (
                 select jsonb_build_object(
                   'family', 'interval', 'rounds', target.rounds,
                   'work_duration_seconds', target.work_duration_seconds,
                   'rest_duration_seconds', target.rest_duration_seconds) as target
                 from planning.interval_targets as target where target.planned_step_id = step.id
               ) as interval_step on true
               left join lateral (
                 select jsonb_build_object(
                   'family', 'mobility', 'hold_duration_seconds', target.hold_duration_seconds,
                   'target_repetitions', target.target_repetitions) as target
                 from planning.mobility_targets as target where target.planned_step_id = step.id
               ) as mobility on true
               where step.template_version_id = template_version.id
             ) as steps
      from planning.program_version_sessions as composed
      join planning.session_template_versions as template_version
        on template_version.id = composed.template_version_id
      where composed.program_version_id = version.id and composed.week = 1
      order by composed.day
    ) as entry
  ) as split on true
  where version.id = p_program_version_id
    and version.status = 'published'
    and (
      program.content_scope = 'global' and program.status = 'published'
      or program.owner_person_id = p_person_id
    )
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

alter function planning.read_program_version(uuid, uuid) owner to allfit_owner;
revoke all on function planning.read_program_version(uuid, uuid) from public;
grant execute on function planning.read_program_version(uuid, uuid) to allfit_api;

-- El filtro decía `weeks is not null` queriendo decir «tiene sesiones». Ahora las dos
-- cosas no son la misma, y dejarlo así borraba del catálogo justo a los que no acaban.
CREATE OR REPLACE FUNCTION planning.read_program_catalogue(p_person_id uuid)
 RETURNS TABLE(program_version_id uuid, program_id uuid, title text, weeks integer, days_per_week integer, sex_affinity text, goals text[], levels text[], emphases text[])
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select version.id,
         program.id,
         version.title,
         case when version.repeats_forever then null else composition.weeks end,
         composition.days_per_week,
         version.sex_affinity::text,
         coalesce(goals.codes, array[]::text[]),
         coalesce(levels.codes, array[]::text[]),
         coalesce(emphases.codes, array[]::text[])
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day)::integer as days_per_week,
           count(*)::integer as sessions
    from planning.program_version_sessions as session
    where session.program_version_id = version.id
  ) as composition on true
  left join lateral (
    select array_agg(goal.goal_code order by goal.goal_code) as codes
    from planning.program_version_goals as goal
    where goal.program_version_id = version.id
  ) as goals on true
  left join lateral (
    select array_agg(level.experience_code order by level.experience_code) as codes
    from planning.program_version_levels as level
    where level.program_version_id = version.id
  ) as levels on true
  left join lateral (
    select array_agg(emphasis.focus_area_code order by emphasis.focus_area_code) as codes
    from planning.program_version_emphases as emphasis
    where emphasis.program_version_id = version.id
  ) as emphases on true
  where program.content_scope = 'global'
    and program.status = 'published'
    and version.status = 'published'
    and composition.sessions > 0
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by version.title, version.id
$function$;

alter function planning.read_program_catalogue(uuid) owner to allfit_owner;
revoke all on function planning.read_program_catalogue(uuid) from public;
grant execute on function planning.read_program_catalogue(uuid) to allfit_api;

commit;
