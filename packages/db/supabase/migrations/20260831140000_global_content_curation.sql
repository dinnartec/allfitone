-- Publishing the platform's own content.
--
-- Studio publishes from a draft, under a capability, with an idempotency receipt.
-- None of that applies to curation: there is no organization to hold the capability,
-- no draft to converge, and no device retrying a command — there is a script an
-- operator runs.
--
-- What **does** have to be identical is the canonical form, the content hash and the
-- materialisation of steps and targets. A second publishing path with its own
-- hashing would let the same session mean two different things depending on who
-- published it, and the immutability of a version rests on that hash. So these
-- functions reuse `canonical_session_content`, `canonical_program_content`,
-- `session_content_errors`, `program_content_errors` and `materialize_target`
-- exactly as `publish_session_template_version` does.
--
-- They are **not** granted to the runtime role, and they are not `security definer`:
-- they run with the privileges of whoever calls them, which is the operator running
-- the curation script.

begin;

create function planning.publish_global_session_template(
  p_template_id uuid,
  p_discipline_code text,
  p_content jsonb
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
  select version.id into version_id
  from planning.session_template_versions as version
  where version.template_id = p_template_id and version.content_hash = version_content_hash;
  if version_id is not null then
    return version_id;
  end if;

  insert into planning.session_template_versions (
    template_id, version_number, discipline_code, activity_type_id, title, content_hash
  )
  select p_template_id,
         coalesce(max(existing.version_number), 0) + 1,
         p_discipline_code,
         (canonical_content->>'activity_type_id')::uuid,
         canonical_content->>'title',
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
      template_version_id, position, movement_id, activity_type_id, notes
    ) values (
      version_id, (step->>'position')::integer,
      nullif(step->>'movement_id', '')::uuid,
      nullif(step->>'activity_type_id', '')::uuid,
      nullif(step->>'notes', '')
    ) returning id into step_id;
    perform planning.materialize_target(step_id, step->'target');
  end loop;

  return version_id;
end
$function$;

create function planning.publish_global_program(
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

  select version.id into version_id
  from planning.program_versions as version
  where version.program_id = p_program_id and version.content_hash = version_content_hash;
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

alter function planning.publish_global_session_template(uuid, text, jsonb) owner to allfit_owner;
alter function planning.publish_global_program(uuid, jsonb, identity.biological_sex, text[], text[], text[]) owner to allfit_owner;
revoke all on function planning.publish_global_session_template(uuid, text, jsonb) from public;
revoke all on function planning.publish_global_program(uuid, jsonb, identity.biological_sex, text[], text[], text[]) from public;

-- Composing a program out of a template the platform published.
--
-- Both of these matched a template **only** by `owner_organization_id`, so a global
-- template was invisible to them and every session referencing one came back as
-- `template-version`. The filter is widened, not replaced: an organization still
-- cannot compose with another organization's content, and the global catalogue is
-- added to what it may reach — which is the same widening `OP-PLN-020` just took.
--
-- Person-owned templates are still out of reach here, because these functions have
-- no person to check against. `HU-SP-047` is what will need that, and it is not built.

create or replace function planning.program_content_errors(
  p_content jsonb,
  p_organization_id uuid,
  p_require_publishable boolean
)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
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
        or template.owner_organization_id = p_organization_id);
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

create or replace function planning.lock_program_template_versions(
  p_content jsonb,
  p_organization_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
begin
  if jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(p_content->'sessions') <> 'array' then
    return;
  end if;

  perform 1
  from planning.session_template_versions as version
  join planning.session_templates as template on template.id = version.template_id
  where (template.content_scope = 'global'
      or template.owner_organization_id = p_organization_id)
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

commit;
