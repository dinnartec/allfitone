-- Content a person makes for themselves.
--
-- Everything needed to build a routine and a programme already existed and was
-- reachable only from Studio: `session_template_drafts`, `program_drafts`, the
-- `replace_*_draft` and `publish_*_version` commands, `content_etag` as the
-- optimistic lock. What blocked Space was one line in each of them —
-- `assert_manage_content`, which raises `P0002` without an organization membership.
--
-- So these are the same commands with the ownership swapped, not a second content
-- pipeline. They reuse `session_content_errors`, `program_content_errors`,
-- `canonical_*_content`, `content_etag` and `materialize_target` untouched: writing a
-- second validator would let a person's routines drift from a coach's, and the whole
-- point of the hash is that identical content is identical everywhere.
--
-- **Two guards had to widen.** `lock_program_template_versions` and
-- `program_content_errors` admitted templates that were `global` or the
-- organization's, and nothing else — so a personal programme composed of personal
-- routines could never be published. They now admit `owner_person_id`, read under the
-- caller's own row security, so a routine somebody cannot see is a routine they
-- cannot compose.
--
-- The operation codes are the Studio ones. `allfitone-docs` gives each of these
-- operations a Space surface rather than inventing new operations, and the receipt
-- has to agree with the matrix.

begin;

create or replace function planning.lock_program_template_versions(p_content jsonb, p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(p_content->'sessions') <> 'array' then
    return;
  end if;

  perform 1
  from planning.session_template_versions as version
  join planning.session_templates as template on template.id = version.template_id
  where (template.content_scope = 'global'
      or template.owner_organization_id = p_organization_id
      or template.owner_person_id = access_control.person())
    and version.id in (
      select distinct (session.value->>'template_version_id')::uuid
      from jsonb_array_elements(p_content->'sessions') as session(value)
      where jsonb_typeof(session.value) = 'object'
        and jsonb_typeof(session.value->'template_version_id') = 'string'
        and session.value->>'template_version_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  order by version.id
  for no key update of version;
end
$function$;

create or replace function planning.program_content_errors(p_content jsonb, p_organization_id uuid, p_require_publishable boolean)
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
     or p_content - array['title', 'notes', 'sessions'] <> '{}'::jsonb
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

commit;

begin;

-- The guard these six share. It is what `assert_manage_content` does minus the
-- organization: the actor is this person, and nothing else is asserted because
-- ownership is checked against the row itself in each command.
create function planning.assert_own_content(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
end
$function$;

-- `OP-PLN-001` on `/space/v1`. The identity exists before anything is published, so
-- the screen has somewhere to save a draft from the first keystroke.
create function planning.create_my_session_template(
  p_person_id uuid,
  p_discipline_code text,
  p_title text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (template jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  new_template_id uuid;
  activity_type_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-001', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_template_projection(receipt.aggregate_id), true;
    return;
  end if;

  if btrim(p_title) = '' or char_length(p_title) > 160 then
    raise exception 'invalid session template title' using errcode = '22023';
  end if;
  if not exists (
    select 1 from catalog.disciplines
    where code = p_discipline_code and status = 'published'
  ) then
    raise exception 'unknown discipline' using errcode = '22023';
  end if;

  insert into planning.session_templates (
    content_scope, owner_person_id, author_person_id, discipline_code
  ) values ('person', p_person_id, p_person_id, p_discipline_code)
  returning id into new_template_id;

  -- A discipline with one published activity type poses no question, and `V-H` asks
  -- none. Left null the routine would be unpublishable for a reason no screen shows.
  select activity.id into activity_type_id
  from catalog.activity_types as activity
  where activity.discipline_code = p_discipline_code
    and activity.content_scope = 'global'
    and activity.status = 'published';

  insert into planning.session_template_drafts (template_id, content)
  values (new_template_id, jsonb_build_object(
    'title', btrim(p_title),
    'activity_type_id', activity_type_id,
    'steps', jsonb_build_array()
  ));

  perform system.enqueue_outbox_event(
    'session_template', new_template_id, 'planning.session_template_created.v1',
    jsonb_build_object('template_id', new_template_id, 'person_id', p_person_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'session-template-created', 'session_template', new_template_id
  );
  return query select planning.session_template_projection(new_template_id), false;
end
$function$;

-- `OP-PLN-002` on `/space/v1`. Saved as the person types, which is what `V-H`
-- promises, so the etag is the only thing standing between two devices.
create function planning.replace_my_session_template_draft(
  p_person_id uuid,
  p_template_id uuid,
  p_expected_etag text,
  p_content jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (draft jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  current planning.session_template_drafts%rowtype;
  discipline text;
  errors text[];
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-002', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_draft_projection(receipt.aggregate_id), true;
    return;
  end if;

  select existing_draft.*
  into current
  from planning.session_template_drafts as existing_draft
  join planning.session_templates as template on template.id = existing_draft.template_id
  where template.id = p_template_id and template.owner_person_id = p_person_id
  for update of existing_draft;
  if current.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  select template.discipline_code into discipline
  from planning.session_templates as template where template.id = p_template_id;

  if planning.content_etag(current.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001',
      detail = planning.session_draft_projection(current.id)::text;
  end if;
  -- No organization, so only global activity types and movements qualify, which is
  -- exactly what a person should be able to reach.
  errors := planning.session_content_errors(p_content, null, discipline, false);
  if cardinality(errors) > 0 then
    raise exception 'invalid session template draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  if current.content is distinct from p_content then
    update planning.session_template_drafts
    set content = p_content, derived_from_version_id = null, updated_at = clock_timestamp()
    where id = current.id;
    update planning.session_templates set updated_at = clock_timestamp() where id = p_template_id;
  end if;
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'session-template-draft-updated',
    'session_template_draft', current.id
  );
  return query select planning.session_draft_projection(current.id), false;
end
$function$;

commit;

begin;

-- `OP-PLN-003` on `/space/v1`. Publishing fixes the version forever; correcting means
-- publishing another. Publishing the same content twice answers the version that
-- already exists rather than making a second one that says the same thing.
create function planning.publish_my_session_template(
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
  select existing.id into version_id from planning.session_template_versions as existing
  where existing.template_id = p_template_id and existing.content_hash = version_content_hash;
  if version_id is null then
    select coalesce(max(existing.version_number), 0) + 1 into next_version
    from planning.session_template_versions as existing where existing.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title', version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for step in
      select value from jsonb_array_elements(canonical_content->'steps')
      order by (value->>'position')::integer
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes
      ) values (
        version_id, (step->>'position')::integer,
        nullif(step->>'movement_id', '')::uuid,
        nullif(step->>'activity_type_id', '')::uuid,
        nullif(step->>'notes', '')
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

commit;

begin;

-- `OP-PLN-006` and `-007` on `/space/v1`.
create function planning.create_my_program(
  p_person_id uuid,
  p_title text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (program jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  new_program_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-006', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_projection(receipt.aggregate_id), true;
    return;
  end if;

  if btrim(p_title) = '' or char_length(p_title) > 160 then
    raise exception 'invalid program title' using errcode = '22023';
  end if;

  insert into planning.programs (content_scope, owner_person_id, author_person_id)
  values ('person', p_person_id, p_person_id) returning id into new_program_id;
  insert into planning.program_drafts (program_id, content)
  values (new_program_id, jsonb_build_object(
    'title', btrim(p_title), 'notes', null, 'sessions', jsonb_build_array()
  ));

  perform system.enqueue_outbox_event(
    'program', new_program_id, 'planning.program_created.v1',
    jsonb_build_object('program_id', new_program_id, 'person_id', p_person_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-created', 'program', new_program_id
  );
  return query select planning.program_projection(new_program_id), false;
end
$function$;

create function planning.replace_my_program_draft(
  p_person_id uuid,
  p_program_id uuid,
  p_expected_etag text,
  p_content jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (draft jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  current planning.program_drafts%rowtype;
  errors text[];
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_draft_projection(receipt.aggregate_id), true;
    return;
  end if;

  select existing_draft.* into current
  from planning.program_drafts as existing_draft
  join planning.programs as program on program.id = existing_draft.program_id
  where program.id = p_program_id and program.owner_person_id = p_person_id
  for update of existing_draft;
  if current.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;

  if planning.content_etag(current.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001',
      detail = planning.program_draft_projection(current.id)::text;
  end if;
  errors := planning.program_content_errors(p_content, null, false);
  if cardinality(errors) > 0 then
    raise exception 'invalid program draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  if current.content is distinct from p_content then
    update planning.program_drafts
    set content = p_content, updated_at = clock_timestamp() where id = current.id;
    update planning.programs set updated_at = clock_timestamp() where id = p_program_id;
  end if;
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'program-draft-updated', 'program_draft', current.id
  );
  return query select planning.program_draft_projection(current.id), false;
end
$function$;

-- `OP-PLN-008` on `/space/v1`. This is the one the widened guards exist for: its
-- sessions point at the person's own routines.
create function planning.publish_my_program(
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
  select existing.id into version_id from planning.program_versions as existing
  where existing.program_id = p_program_id and existing.content_hash = version_content_hash;
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

do $$
declare
  routine text;
begin
  foreach routine in array array[
    'planning.assert_own_content(uuid)',
    'planning.create_my_session_template(uuid, text, text, uuid, uuid, bytea)',
    'planning.replace_my_session_template_draft(uuid, uuid, text, jsonb, uuid, uuid, bytea)',
    'planning.publish_my_session_template(uuid, uuid, text, uuid, uuid, bytea)',
    'planning.create_my_program(uuid, text, uuid, uuid, bytea)',
    'planning.replace_my_program_draft(uuid, uuid, text, jsonb, uuid, uuid, bytea)',
    'planning.publish_my_program(uuid, uuid, text, uuid, uuid, bytea)'
  ] loop
    execute format('alter function %s owner to allfit_owner', routine);
    execute format('revoke all on function %s from public', routine);
    execute format('grant execute on function %s to allfit_api', routine);
  end loop;
end
$$;

commit;
