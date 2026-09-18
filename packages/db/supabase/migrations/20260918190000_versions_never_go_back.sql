begin;

-- Una versión publicada no se resucita.
--
-- Publicar comparaba el hash del borrador contra **todas** las versiones de la
-- plantilla, y un índice único `(template_id, content_hash)` lo obligaba: quitar una
-- portada que se acababa de poner devolvía el contenido a un estado que ya existió, el
-- hash coincidía con una versión anterior y publicar devolvía **su** identificador.
--
-- Ese identificador viaja fuera de la plantilla. La semana de un programa guarda
-- `session_template_version_id` y el resto del producto resuelve el contenido vigente
-- por la última versión publicada, así que el día quedaba apuntando a una versión real,
-- válida y que ninguna consulta de biblioteca nombra: la rutina desaparecía del
-- programa. También destruía la cronología, porque una misma fila representaba dos
-- épocas y `version_number` dejaba de ordenar en el tiempo.
--
-- `ADR-009`, enmendada: la deduplicación alcanza **sólo a la última versión publicada**.
-- Idéntico a ella no crea nada y la devuelve; idéntico a una anterior crea la
-- siguiente. El coste es almacenamiento, no latencia: los lectores toman la última por
-- `(template_id, version_number)` sin recorrer la historia.
--
-- Y la bifurcación guarda de dónde salió cada copia, que es el invariante 7 de la misma
-- ADR y hoy no lo escribía nadie.

-- El índice único es lo que hacía inevitable el regreso: sin él, dos versiones de una
-- plantilla pueden repetir contenido, que es exactamente lo que significa deshacer un
-- cambio. Nadie busca por `content_hash`, así que no se sustituye por un índice normal.
alter table planning.session_template_versions
  drop constraint if exists uq_session_template_versions_content;
alter table planning.program_versions
  drop constraint if exists uq_program_versions_content;

create or replace function planning.publish_my_session_template(
  p_person_id uuid,
  p_template_id uuid,
  p_expected_etag text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (version jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  draft planning.session_template_drafts%rowtype;
  template planning.session_templates%rowtype;
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  step jsonb;
  step_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-003', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_version_projection(receipt.aggregate_id), true;
    return;
  end if;

  select parent.* into template
  from planning.session_templates as parent
  where parent.id = p_template_id and parent.owner_person_id = p_person_id
  for update of parent;
  if template.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;
  select current_draft.* into draft
  from planning.session_template_drafts as current_draft
  where current_draft.template_id = p_template_id
  for update of current_draft;

  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001',
      detail = planning.session_draft_projection(draft.id)::text;
  end if;
  -- `require_complete`, so an empty routine is refused here and still saveable as a
  -- draft. `V-G` is the screen that says exactly what is missing.
  errors := planning.session_content_errors(draft.content, null, template.discipline_code, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete session template draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  canonical_content := planning.canonical_session_content(draft.content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
  -- Sólo la última. Volver a publicar lo que ya está publicado la devuelve, que es lo
  -- que evita una versión por pulsación; deshacer un cambio es una versión hacia
  -- adelante. Devolver un identificador ya superado dejaría a las semanas de programa
  -- que lo llevan apuntando a una versión que ninguna consulta de biblioteca nombra.
  select latest.id into version_id
  from (
    select existing.id, existing.content_hash, existing.status
    from planning.session_template_versions as existing
    where existing.template_id = p_template_id
    order by existing.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is null then
    select coalesce(max(existing.version_number), 0) + 1 into next_version
    from planning.session_template_versions as existing where existing.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, cover_kind, cover_icon, cover_photo_id, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title',
      (canonical_content->'cover'->>'kind')::planning.routine_cover,
      (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
      (canonical_content->'cover'->>'photo_id')::uuid,
      version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for step in
      select value from jsonb_array_elements(canonical_content->'steps')
      order by (value->>'position')::integer
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        version_id, (step->>'position')::integer,
        nullif(step->>'movement_id', '')::uuid,
        nullif(step->>'activity_type_id', '')::uuid,
        nullif(step->>'notes', ''),
        nullif(step->>'superset_group', '')::smallint
      ) returning id into step_id;
      perform planning.materialize_target(step_id, step->'target');
    end loop;
    update planning.session_templates
    set status = 'published', updated_at = clock_timestamp() where id = p_template_id;
    perform system.enqueue_outbox_event(
      'session_template_version', version_id, 'planning.session_template_version_published.v1',
      jsonb_build_object('template_id', p_template_id, 'version_id', version_id,
                         'version_number', next_version)
    );
  end if;
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'session-template-version-published',
    'session_template_version', version_id
  );
  return query select planning.session_version_projection(version_id), false;
end
$function$;

create or replace function planning.publish_session_template_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_expected_etag text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  draft planning.session_template_drafts%rowtype;
  template planning.session_templates%rowtype;
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  step jsonb;
  step_id uuid;
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-003', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_version_projection(receipt.aggregate_id), true;
    return;
  end if;
  select parent.* into template
  from planning.session_templates as parent
  where parent.id = p_template_id and parent.owner_organization_id = p_organization_id
  for update of parent;
  select current_draft.* into draft
  from planning.session_template_drafts as current_draft
  where current_draft.template_id = p_template_id
  for update of current_draft;
  if template.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001', detail = planning.session_draft_projection(draft.id)::text;
  end if;
  errors := planning.session_content_errors(draft.content, p_organization_id, template.discipline_code, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete session template draft' using errcode = '22023', detail = to_json(errors)::text;
  end if;

  canonical_content := planning.canonical_session_content(draft.content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
  -- Sólo la última. Volver a publicar lo que ya está publicado la devuelve, que es lo
  -- que evita una versión por pulsación; deshacer un cambio es una versión hacia
  -- adelante. Devolver un identificador ya superado dejaría a las semanas de programa
  -- que lo llevan apuntando a una versión que ninguna consulta de biblioteca nombra.
  select latest.id into version_id
  from (
    select version.id, version.content_hash, version.status
    from planning.session_template_versions as version
    where version.template_id = p_template_id
    order by version.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is null then
    select coalesce(max(version.version_number), 0) + 1 into next_version
    from planning.session_template_versions as version where version.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, cover_kind, cover_icon, cover_photo_id, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title',
      (canonical_content->'cover'->>'kind')::planning.routine_cover,
      (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
      (canonical_content->'cover'->>'photo_id')::uuid,
      version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for step in select value from jsonb_array_elements(canonical_content->'steps') order by (value->>'position')::integer loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        version_id, (step->>'position')::integer,
        nullif(step->>'movement_id', '')::uuid,
        nullif(step->>'activity_type_id', '')::uuid,
        nullif(step->>'notes', ''),
        nullif(step->>'superset_group', '')::smallint
      ) returning id into step_id;
      perform planning.materialize_target(step_id, step->'target');
    end loop;
    update planning.session_templates set status = 'published', updated_at = clock_timestamp() where id = p_template_id;
    perform system.enqueue_outbox_event(
      'session_template_version', version_id, 'planning.session_template_version_published.v1',
      jsonb_build_object('template_id', p_template_id, 'version_id', version_id, 'version_number', next_version)
    );
  end if;
  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'session-template-version-published', 'session_template_version', version_id);
  return query select planning.session_version_projection(version_id), false;
end
$function$;

create or replace function planning.publish_global_session_template(p_template_id uuid, p_discipline_code text, p_content jsonb)
returns uuid
language plpgsql
set search_path = pg_catalog
as $function$
declare
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  step jsonb;
  step_id uuid;
begin
  -- A null organization is what makes the validator accept global movements and
  -- activity types and reject anything privately owned, which is exactly right here.
  errors := planning.session_content_errors(p_content, null, p_discipline_code, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete global session template' using errcode = '22023', detail = to_json(errors)::text;
  end if;

  insert into planning.session_templates (id, content_scope, discipline_code, status)
  values (p_template_id, 'global', p_discipline_code, 'published')
  on conflict (id) do nothing;

  canonical_content := planning.canonical_session_content(p_content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');

  -- Publishing the same content twice is not a new version. It is the property that
  -- lets the curation script be run again without forking the catalogue.
  --
  -- Against the newest only, so a curated routine that was changed and changed back
  -- moves forward instead of resurrecting the version the catalogue already moved on
  -- from.
  select latest.id into version_id
  from (
    select version.id, version.content_hash, version.status
    from planning.session_template_versions as version
    where version.template_id = p_template_id
    order by version.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is not null then
    return version_id;
  end if;

  insert into planning.session_template_versions (
    template_id, version_number, discipline_code, activity_type_id, title,
    cover_kind, cover_icon, cover_photo_id, content_hash
  )
  select p_template_id,
         coalesce(max(existing.version_number), 0) + 1,
         p_discipline_code,
         (canonical_content->>'activity_type_id')::uuid,
         canonical_content->>'title',
         (canonical_content->'cover'->>'kind')::planning.routine_cover,
         (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
         (canonical_content->'cover'->>'photo_id')::uuid,
         version_content_hash
  from planning.session_template_versions as existing
  where existing.template_id = p_template_id
  returning id into version_id;

  perform set_config('app.planning_publication', 'true', true);
  for step in
    select value from jsonb_array_elements(canonical_content->'steps')
    order by (value->>'position')::integer
  loop
    insert into planning.planned_steps (
      template_version_id, position, movement_id, activity_type_id, notes, superset_group
    ) values (
      version_id, (step->>'position')::integer,
      nullif(step->>'movement_id', '')::uuid,
      nullif(step->>'activity_type_id', '')::uuid,
      nullif(step->>'notes', ''),
      nullif(step->>'superset_group', '')::smallint
    ) returning id into step_id;
    perform planning.materialize_target(step_id, step->'target');
  end loop;

  return version_id;
end
$function$;

create or replace function planning.publish_my_program(
  p_person_id uuid,
  p_program_id uuid,
  p_expected_etag text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (version jsonb, replayed boolean)
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
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-version-published', 'program_version', version_id
  );
  return query select planning.program_version_projection(version_id), false;
end
$function$;

create or replace function planning.publish_program_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_program_id uuid,
  p_expected_etag text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
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
      program_id, version_number, title, notes, content_hash
    ) values (
      p_program_id, next_version, canonical_content->>'title',
      canonical_content->>'notes', version_content_hash
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

create or replace function planning.publish_global_program(
  p_program_id uuid,
  p_content jsonb,
  p_sex_affinity identity.biological_sex,
  p_goals text[],
  p_levels text[],
  p_emphases text[]
)
returns uuid
language plpgsql
set search_path = pg_catalog
as $function$
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
    program_id, version_number, title, notes, content_hash, sex_affinity
  )
  select p_program_id,
         coalesce(max(existing.version_number), 0) + 1,
         canonical_content->>'title',
         nullif(canonical_content->>'notes', ''),
         version_content_hash,
         p_sex_affinity
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

create or replace function planning.fork_program_version(p_person_id uuid, p_program_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
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
  select version.id, version.title, version.notes, version.content_hash, version.sex_affinity
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
           source_version.template_id,
           source_version.discipline_code,
           source_version.activity_type_id,
           source_version.title,
           source_version.cover_kind,
           source_version.cover_icon,
           source_version.cover_photo_id,
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
      derived_from_version_id, cover_kind, cover_icon, content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title,
      -- De dónde salió. La copia es una plantilla nueva con identidad propia, así que
      -- sin esto no hay forma de contar cuánta gente entrena algo derivado de un
      -- programa de Allfit: son plantillas sueltas que se parecen.
      template.version_id,
      -- Una portada de foto no se copia: los bytes son de quien los subió y la clave
      -- foránea compuesta ata la foto a su plantilla. La copia se queda sin portada,
      -- que es un estado legítimo, en vez de con una que no le pertenece.
      case when template.cover_kind = 'photo' then null else template.cover_kind end,
      template.cover_icon,
      template.content_hash, 'published', clock_timestamp()
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

    mapping := mapping || jsonb_build_object(template.version_id::text, new_template_version_id);
  end loop;

  insert into planning.programs (content_scope, owner_person_id, author_person_id, status)
  values ('person', p_person_id, p_person_id, 'published')
  returning id into new_program_id;

  insert into planning.program_versions (
    program_id, version_number, title, notes, content_hash, status, published_at, sex_affinity
  ) values (
    new_program_id, 1, source.title, source.notes, source.content_hash,
    'published', clock_timestamp(), source.sex_affinity
  ) returning id into new_version_id;

  insert into planning.program_version_sessions (
    program_version_id, template_version_id, position, week, day
  )
  select new_version_id,
         (mapping->>composition.template_version_id::text)::uuid,
         composition.position, composition.week, composition.day
  from planning.program_version_sessions as composition
  where composition.program_version_id = p_program_version_id;

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
