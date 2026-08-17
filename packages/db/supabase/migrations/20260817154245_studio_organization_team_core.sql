-- Studio organization context and governed team commands.
-- Runtime access is limited to closed functions so audit and authority cannot be bypassed.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table organizations.organizations
  add column revision_number bigint not null default 0,
  add constraint ck_organizations_revision_number check (revision_number >= 0);

create table organizations.organization_type_transitions (
  from_type_code text not null,
  to_type_code text not null,
  status text not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_organization_type_transitions primary key (from_type_code, to_type_code),
  constraint fk_organization_type_transitions_from_type foreign key (from_type_code) references organizations.organization_types(code) on delete restrict,
  constraint fk_organization_type_transitions_to_type foreign key (to_type_code) references organizations.organization_types(code) on delete restrict,
  constraint ck_organization_type_transitions_distinct check (from_type_code <> to_type_code),
  constraint ck_organization_type_transitions_status check (status in ('active', 'inactive'))
);

create index idx_organization_type_transitions_from_status
  on organizations.organization_type_transitions (from_type_code, status);

insert into organizations.organization_type_transitions (from_type_code, to_type_code)
values
  ('professional_practice', 'gym'),
  ('professional_practice', 'studio');

create table organizations.organization_sites (
  id uuid not null default extensions.uuid_generate_v7(),
  organization_id uuid not null,
  name text not null,
  address text,
  status text not null default 'active',
  revision_number bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_organization_sites primary key (id),
  constraint fk_organization_sites_organization foreign key (organization_id) references organizations.organizations(id) on delete cascade,
  constraint ck_organization_sites_name check (btrim(name) <> ''),
  constraint ck_organization_sites_address check (address is null or btrim(address) <> ''),
  constraint ck_organization_sites_status check (status in ('active', 'inactive')),
  constraint ck_organization_sites_revision_number check (revision_number >= 0)
);

create index idx_organization_sites_organization
  on organizations.organization_sites (organization_id, id);

alter table organizations.organization_type_transitions owner to allfit_owner;
alter table organizations.organization_sites owner to allfit_owner;

create trigger trg_organization_sites_before_update_timestamp
before update on organizations.organization_sites
for each row execute function access_control.set_updated_at();

alter table organizations.organization_type_transitions enable row level security;
alter table organizations.organization_type_transitions force row level security;
alter table organizations.organization_sites enable row level security;
alter table organizations.organization_sites force row level security;

create policy organization_type_transitions_all_owner
  on organizations.organization_type_transitions
  for all to allfit_owner using (true) with check (true);
create policy organization_sites_all_owner
  on organizations.organization_sites
  for all to allfit_owner using (true) with check (true);

revoke all on organizations.organization_type_transitions, organizations.organization_sites
  from public, allfit_api;

create or replace function organizations.enforce_type_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.type_code is distinct from old.type_code
     and not exists (
       select 1
       from organizations.organization_type_transitions as transition
       where transition.from_type_code = old.type_code
         and transition.to_type_code = new.type_code
         and transition.status = 'active'
     ) then
    raise exception 'IX-45 organization type transition is not active' using errcode = '23514';
  end if;
  return new;
end
$function$;

alter function organizations.enforce_type_transition() owner to allfit_owner;
revoke all on function organizations.enforce_type_transition() from public, allfit_api;

create trigger trg_organizations_before_update_type_transition
before update of type_code on organizations.organizations
for each row execute function organizations.enforce_type_transition();

create type privacy.access_mode as enum (
  'live',
  'frozen',
  'break_glass',
  'organization_operational'
);
alter type privacy.access_mode owner to allfit_owner;

alter table privacy.access_events rename column target_person_id to subject_person_id;
alter table privacy.access_events rename column resource_type to resource;
alter table privacy.access_events rename column decision to result;

alter table privacy.access_events alter column subject_person_id drop not null;
alter table privacy.access_events drop constraint ck_access_events_resource_type;
alter table privacy.access_events
  add constraint ck_access_events_resource check (
    resource ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  );

alter table privacy.access_events
  add column subject_organization_id uuid,
  add column actor_membership_id uuid,
  add column relationship_id uuid,
  add column data_grant_id uuid,
  add column historical_access_case_id uuid,
  add column scope_code text,
  add column scope_version integer,
  add column access_mode privacy.access_mode not null default 'live',
  add constraint fk_access_events_subject_organization foreign key (subject_organization_id) references organizations.organizations(id) on delete restrict,
  add constraint fk_access_events_actor_membership foreign key (actor_membership_id, subject_organization_id, actor_person_id) references organizations.organization_memberships(id, organization_id, person_id) on delete restrict,
  add constraint ck_access_events_subject_xor check (
    num_nonnulls(subject_person_id, subject_organization_id) = 1
  ),
  add constraint ck_access_events_organization_context check (
    subject_organization_id is null
    or (
      subject_person_id is null
      and actor_membership_id is not null
      and relationship_id is null
      and data_grant_id is null
      and historical_access_case_id is null
      and scope_code is null
      and scope_version is null
      and access_mode = 'organization_operational'
      and resource = 'organizations.organization_context'
    )
  );

alter table privacy.access_events alter column access_mode drop default;

create index idx_access_events_subject_organization_occurred
  on privacy.access_events (subject_organization_id, occurred_at desc, id)
  where subject_organization_id is not null;

create or replace function privacy.enforce_access_event_context_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.subject_organization_id is not null
     and not exists (
       select 1
       from organizations.organization_memberships as membership
       where membership.id = new.actor_membership_id
         and membership.organization_id = new.subject_organization_id
         and membership.person_id = new.actor_person_id
         and membership.status = 'active'
     ) then
    raise exception 'IX-23 organization access membership is not active'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

alter function privacy.enforce_access_event_context_tg() owner to allfit_owner;
revoke all on function privacy.enforce_access_event_context_tg() from public, allfit_api;

create trigger trg_access_events_before_insert_context
before insert on privacy.access_events
for each row execute function privacy.enforce_access_event_context_tg();

create or replace function privacy.log_access_event(
  p_actor_person_id uuid,
  p_target_person_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_purpose text,
  p_decision text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  access_event_id uuid;
begin
  if p_actor_person_id is null
     or p_target_person_id is null
     or p_request_id is null
     or p_resource_type !~ '^[a-z][a-z0-9_]{1,63}$'
     or p_purpose !~ '^[a-z][a-z0-9_]{1,63}$'
     or p_decision not in ('allowed', 'denied') then
    raise exception 'invalid access event' using errcode = '22023';
  end if;

  insert into privacy.access_events (
    actor_person_id,
    subject_person_id,
    resource,
    resource_id,
    purpose,
    result,
    request_id,
    access_mode
  ) values (
    p_actor_person_id,
    p_target_person_id,
    p_resource_type,
    p_resource_id,
    p_purpose,
    p_decision,
    p_request_id,
    'live'
  )
  returning id into access_event_id;

  return access_event_id;
end
$function$;

create or replace function privacy.log_access_event(
  p_subject_person_id uuid,
  p_subject_organization_id uuid,
  p_relationship_id uuid,
  p_data_grant_id uuid,
  p_historical_access_case_id uuid,
  p_scope_code text,
  p_scope_version integer,
  p_access_mode privacy.access_mode,
  p_resource text,
  p_result text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_person_id uuid := access_control.person();
  actor_membership_id uuid;
  request_id uuid;
  purpose text;
  access_event_id uuid;
begin
  actor_membership_id := nullif(current_setting('app.actor_membership_id', true), '')::uuid;
  request_id := nullif(current_setting('app.request_id', true), '')::uuid;
  purpose := nullif(current_setting('app.access_purpose', true), '');

  if access_control.actor_kind() <> 'person'
     or actor_person_id is null
     or request_id is null
     or purpose is null
     or num_nonnulls(p_subject_person_id, p_subject_organization_id) <> 1
     or p_result not in ('allowed', 'denied') then
    raise exception 'invalid access event context' using errcode = '22023';
  end if;

  if p_subject_organization_id is not null and not exists (
    select 1
    from organizations.organization_memberships as membership
    where membership.id = actor_membership_id
      and membership.organization_id = p_subject_organization_id
      and membership.person_id = actor_person_id
      and membership.status = 'active'
  ) then
    raise exception 'organization access membership is not active' using errcode = '42501';
  end if;

  insert into privacy.access_events (
    subject_person_id,
    subject_organization_id,
    actor_person_id,
    actor_membership_id,
    relationship_id,
    data_grant_id,
    historical_access_case_id,
    scope_code,
    scope_version,
    purpose,
    access_mode,
    resource,
    request_id,
    result
  ) values (
    p_subject_person_id,
    p_subject_organization_id,
    actor_person_id,
    actor_membership_id,
    p_relationship_id,
    p_data_grant_id,
    p_historical_access_case_id,
    p_scope_code,
    p_scope_version,
    purpose,
    p_access_mode,
    p_resource,
    request_id,
    p_result
  )
  returning id into access_event_id;

  return access_event_id;
end
$function$;

alter function privacy.log_access_event(uuid, uuid, uuid, uuid, uuid, text, integer, privacy.access_mode, text, text)
  owner to allfit_owner;
revoke all on function privacy.log_access_event(uuid, uuid, uuid, uuid, uuid, text, integer, privacy.access_mode, text, text)
  from public, allfit_api;

-- Closed projections keep base tables unavailable even to a correctly contextualized runtime role.
revoke select on
  organizations.organization_types,
  organizations.organizations,
  organizations.organization_memberships,
  organizations.organization_roles,
  organizations.membership_roles,
  organizations.organization_events,
  organizations.membership_events,
  organizations.organization_capabilities,
  organizations.role_capabilities
from allfit_api;

alter table system.idempotency_keys
  add column updated_at timestamptz not null default clock_timestamp();

alter table system.idempotency_keys
  drop constraint ck_idempotency_keys_terminal_shape,
  add constraint ck_idempotency_keys_terminal_shape check (
    status = 'processing'
    or (
      http_status is not null
      and outcome_code is not null
      and completed_at is not null
      and response_expires_at is not null
      and ((response_schema_version = 1 and response is not null)
        or (response_schema_version is null and response is null))
    )
  ),
  add constraint ck_idempotency_keys_response_document check (
    response is null
    or response = jsonb_build_object(
      'status', status,
      'resource_type', aggregate_type,
      'resource_id', aggregate_id
    )
    or response = jsonb_build_object(
      'status', status,
      'etag', response->>'etag'
    )
    or response = jsonb_build_object(
      'status', status,
      'error_code', response->>'error_code'
    )
  );

create trigger trg_idempotency_keys_before_update_timestamp
before update on system.idempotency_keys
for each row execute function access_control.set_updated_at();

create or replace function system.expire_idempotency_response(p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update system.idempotency_keys
  set response = null,
      response_schema_version = null
  where id = p_receipt_id
    and status in ('succeeded', 'rejected_final')
    and response is not null
    and response_expires_at <= clock_timestamp();

  return found;
end
$function$;

alter function system.expire_idempotency_response(uuid) owner to allfit_owner;
revoke all on function system.expire_idempotency_response(uuid) from public, allfit_api;

create or replace function organizations.organization_projection(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', organization.id,
    'display_name', organization.display_name,
    'legal_name', organization.legal_name,
    'type_code', organization.type_code,
    'status', organization.status,
    'revision_number', organization.revision_number,
    'sites', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', site.id,
          'name', site.name,
          'address', site.address,
          'status', site.status,
          'revision_number', site.revision_number
        ) order by lower(site.name) collate "C", site.id
      )
      from organizations.organization_sites as site
      where site.organization_id = organization.id
    ), '[]'::jsonb)
  )
  from organizations.organizations as organization
  where organization.id = p_organization_id
$function$;

create or replace function organizations.site_projection(p_site_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', site.id,
    'name', site.name,
    'address', site.address,
    'status', site.status,
    'revision_number', site.revision_number
  )
  from organizations.organization_sites as site
  where site.id = p_site_id
$function$;

alter function organizations.organization_projection(uuid) owner to allfit_owner;
alter function organizations.site_projection(uuid) owner to allfit_owner;
revoke all on function organizations.organization_projection(uuid) from public, allfit_api;
revoke all on function organizations.site_projection(uuid) from public, allfit_api;

create or replace function organizations.read_organization(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_person_id uuid := access_control.person();
  actor_membership_id uuid;
  projection jsonb;
begin
  if access_control.actor_kind() <> 'person' or actor_person_id is null then
    raise exception 'person actor required' using errcode = '42501';
  end if;
  if nullif(current_setting('app.request_id', true), '') is null then
    raise exception 'request context required' using errcode = '22023';
  end if;

  select membership.id
  into actor_membership_id
  from organizations.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.person_id = actor_person_id
    and membership.status = 'active';

  if actor_membership_id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  projection := organizations.organization_projection(p_organization_id);
  if projection is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  perform set_config('app.actor_membership_id', actor_membership_id::text, true);
  perform set_config('app.access_purpose', 'studio_organization_context', true);
  perform privacy.log_access_event(
    null,
    p_organization_id,
    null,
    null,
    null,
    null,
    null,
    'organization_operational',
    'organizations.organization_context',
    'allowed'
  );

  return projection;
end
$function$;

alter function organizations.read_organization(uuid) owner to allfit_owner;
revoke all on function organizations.read_organization(uuid) from public;
grant execute on function organizations.read_organization(uuid) to allfit_api;

create or replace function organizations.update_organization(
  p_person_id uuid,
  p_organization_id uuid,
  p_expected_revision bigint,
  p_patch jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  actor_membership_id uuid;
  target organizations.organizations%rowtype;
  previous_snapshot jsonb;
  next_display_name text;
  next_legal_name text;
  next_type_code text;
  response jsonb;
begin
  perform set_config('lock_timeout', '750ms', true);

  if access_control.actor_kind() <> 'person' or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
  if p_expected_revision is null
     or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or p_patch - array['display_name', 'legal_name', 'type_code'] <> '{}'::jsonb
     or (p_patch ? 'display_name' and (jsonb_typeof(p_patch->'display_name') <> 'string' or btrim(p_patch->>'display_name') = ''))
     or (p_patch ? 'legal_name' and jsonb_typeof(p_patch->'legal_name') not in ('string', 'null'))
     or (p_patch ? 'legal_name' and jsonb_typeof(p_patch->'legal_name') = 'string' and btrim(p_patch->>'legal_name') = '')
     or (p_patch ? 'type_code' and (jsonb_typeof(p_patch->'type_code') <> 'string' or btrim(p_patch->>'type_code') = '')) then
    raise exception 'invalid organization patch' using errcode = '22023';
  end if;

  select membership.id
  into actor_membership_id
  from organizations.organizations as organization
  join organizations.organization_memberships as membership
    on membership.organization_id = organization.id
   and membership.person_id = p_person_id
   and membership.status = 'active'
  where organization.id = p_organization_id
    and organization.status = 'active'
  for update of organization;

  if actor_membership_id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select organization.* into target
  from organizations.organizations as organization
  where organization.id = p_organization_id;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-ORG-002', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select organizations.organization_projection(idempotency.aggregate_id) into response
    from system.idempotency_keys as idempotency
    where idempotency.id = receipt.receipt_id
      and idempotency.aggregate_type = 'organization'
      and idempotency.aggregate_id = p_organization_id;
    if response is null then
      raise exception 'idempotent organization update not found' using errcode = '40001';
    end if;
    return response;
  end if;

  if not access_control.has_capability(p_organization_id, 'manage_organization') then
    raise exception 'organization management capability required' using errcode = '42501';
  end if;
  if target.revision_number <> p_expected_revision then
    raise exception 'stale-draft' using errcode = '40001';
  end if;

  next_display_name := case
    when p_patch ? 'display_name' then btrim(p_patch->>'display_name')
    else target.display_name
  end;
  next_legal_name := case
    when p_patch ? 'legal_name' and jsonb_typeof(p_patch->'legal_name') = 'null' then null
    when p_patch ? 'legal_name' then btrim(p_patch->>'legal_name')
    else target.legal_name
  end;
  next_type_code := case
    when p_patch ? 'type_code' then p_patch->>'type_code'
    else target.type_code
  end;

  if next_display_name is distinct from target.display_name
     or next_legal_name is distinct from target.legal_name
     or next_type_code is distinct from target.type_code then
    previous_snapshot := jsonb_build_object(
      'display_name', target.display_name,
      'legal_name', target.legal_name,
      'type_code', target.type_code,
      'status', target.status,
      'revision_number', target.revision_number
    );

    update organizations.organizations
    set display_name = next_display_name,
        legal_name = next_legal_name,
        type_code = next_type_code,
        revision_number = revision_number + 1
    where id = p_organization_id;

    insert into organizations.organization_events (
      organization_id, event_type, before_snapshot, after_snapshot, actor_membership_id
    ) values (
      p_organization_id,
      'organization.updated.v1',
      previous_snapshot,
      jsonb_build_object(
        'display_name', next_display_name,
        'legal_name', next_legal_name,
        'type_code', next_type_code,
        'status', target.status,
        'revision_number', target.revision_number + 1
      ),
      actor_membership_id
    );
  end if;

  response := organizations.organization_projection(p_organization_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'organization-updated',
    'organization', p_organization_id
  );
  return response;
end
$function$;

create or replace function organizations.create_site(
  p_person_id uuid,
  p_organization_id uuid,
  p_site jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  actor_membership_id uuid;
  site_id uuid;
  response jsonb;
begin
  perform set_config('lock_timeout', '750ms', true);

  if access_control.actor_kind() <> 'person' or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
  if jsonb_typeof(p_site) <> 'object'
     or not p_site ? 'name'
     or p_site - array['name', 'address'] <> '{}'::jsonb
     or jsonb_typeof(p_site->'name') <> 'string'
     or btrim(p_site->>'name') = ''
     or (p_site ? 'address' and jsonb_typeof(p_site->'address') not in ('string', 'null'))
     or (p_site ? 'address' and jsonb_typeof(p_site->'address') = 'string' and btrim(p_site->>'address') = '') then
    raise exception 'invalid organization site' using errcode = '22023';
  end if;

  select membership.id
  into actor_membership_id
  from organizations.organization_memberships as membership
  join organizations.organizations as organization on organization.id = membership.organization_id
  where organization.id = p_organization_id
    and organization.status = 'active'
    and membership.person_id = p_person_id
    and membership.status = 'active'
  for update of organization;

  if actor_membership_id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-ORG-003', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select organizations.site_projection(idempotency.aggregate_id) into response
    from system.idempotency_keys as idempotency
    join organizations.organization_sites as replay_site
      on replay_site.id = idempotency.aggregate_id
     and replay_site.organization_id = p_organization_id
    where idempotency.id = receipt.receipt_id
      and idempotency.aggregate_type = 'organization_site';
    if response is null then
      raise exception 'idempotent site creation not found' using errcode = '40001';
    end if;
    return response;
  end if;

  if not access_control.has_capability(p_organization_id, 'manage_sites') then
    raise exception 'site management capability required' using errcode = '42501';
  end if;

  insert into organizations.organization_sites (organization_id, name, address)
  values (
    p_organization_id,
    btrim(p_site->>'name'),
    case when p_site ? 'address' and jsonb_typeof(p_site->'address') = 'string'
      then btrim(p_site->>'address') else null end
  )
  returning id into site_id;

  response := organizations.site_projection(site_id);
  insert into organizations.organization_events (
    organization_id, event_type, after_snapshot, actor_membership_id
  ) values (
    p_organization_id,
    'organization.site_created.v1',
    response || jsonb_build_object('site_id', site_id),
    actor_membership_id
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'organization-site-created',
    'organization_site', site_id
  );
  return response;
end
$function$;

create or replace function organizations.update_site(
  p_person_id uuid,
  p_organization_id uuid,
  p_site_id uuid,
  p_expected_revision bigint,
  p_patch jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  actor_membership_id uuid;
  target organizations.organization_sites%rowtype;
  previous_snapshot jsonb;
  next_name text;
  next_address text;
  next_status text;
  response jsonb;
begin
  perform set_config('lock_timeout', '750ms', true);

  if access_control.actor_kind() <> 'person' or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
  if p_expected_revision is null
     or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or p_patch - array['name', 'address', 'status'] <> '{}'::jsonb
     or (p_patch ? 'name' and (jsonb_typeof(p_patch->'name') <> 'string' or btrim(p_patch->>'name') = ''))
     or (p_patch ? 'address' and jsonb_typeof(p_patch->'address') not in ('string', 'null'))
     or (p_patch ? 'address' and jsonb_typeof(p_patch->'address') = 'string' and btrim(p_patch->>'address') = '')
     or (p_patch ? 'status' and (jsonb_typeof(p_patch->'status') <> 'string' or p_patch->>'status' not in ('active', 'inactive'))) then
    raise exception 'invalid organization site patch' using errcode = '22023';
  end if;

  select membership.id
  into actor_membership_id
  from organizations.organization_memberships as membership
  join organizations.organizations as organization on organization.id = membership.organization_id
  where organization.id = p_organization_id
    and organization.status = 'active'
    and membership.person_id = p_person_id
    and membership.status = 'active'
  for update of organization;

  if actor_membership_id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select site.* into target
  from organizations.organization_sites as site
  where site.id = p_site_id
    and site.organization_id = p_organization_id
  for update;
  if target.id is null then
    raise exception 'organization site not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-ORG-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select organizations.site_projection(idempotency.aggregate_id) into response
    from system.idempotency_keys as idempotency
    join organizations.organization_sites as replay_site
      on replay_site.id = idempotency.aggregate_id
     and replay_site.organization_id = p_organization_id
    where idempotency.id = receipt.receipt_id
      and idempotency.aggregate_type = 'organization_site'
      and idempotency.aggregate_id = p_site_id;
    if response is null then
      raise exception 'idempotent site update not found' using errcode = '40001';
    end if;
    return response;
  end if;

  if not access_control.has_capability(p_organization_id, 'manage_sites') then
    raise exception 'site management capability required' using errcode = '42501';
  end if;
  if target.revision_number <> p_expected_revision then
    raise exception 'stale-draft' using errcode = '40001';
  end if;

  next_name := case when p_patch ? 'name' then btrim(p_patch->>'name') else target.name end;
  next_address := case
    when p_patch ? 'address' and jsonb_typeof(p_patch->'address') = 'null' then null
    when p_patch ? 'address' then btrim(p_patch->>'address')
    else target.address
  end;
  next_status := case when p_patch ? 'status' then p_patch->>'status' else target.status end;

  if next_name is distinct from target.name
     or next_address is distinct from target.address
     or next_status is distinct from target.status then
    previous_snapshot := organizations.site_projection(p_site_id) || jsonb_build_object('site_id', p_site_id);
    update organizations.organization_sites
    set name = next_name,
        address = next_address,
        status = next_status,
        revision_number = revision_number + 1
    where id = p_site_id;

    insert into organizations.organization_events (
      organization_id, event_type, before_snapshot, after_snapshot, actor_membership_id
    ) values (
      p_organization_id,
      'organization.site_updated.v1',
      previous_snapshot,
      organizations.site_projection(p_site_id) || jsonb_build_object('site_id', p_site_id),
      actor_membership_id
    );
  end if;

  response := organizations.site_projection(p_site_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'organization-site-updated',
    'organization_site', p_site_id
  );
  return response;
end
$function$;

create or replace function organizations.transfer_ownership(
  p_person_id uuid,
  p_organization_id uuid,
  p_target_membership_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  actor_membership_id uuid;
  target_membership organizations.organization_memberships%rowtype;
  transferred_at timestamptz := statement_timestamp();
  transfer_event_id uuid;
  response jsonb;
begin
  perform set_config('lock_timeout', '750ms', true);

  if access_control.actor_kind() <> 'person' or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  perform 1
  from organizations.organizations as organization
  where organization.id = p_organization_id
    and organization.status = 'active'
  for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select membership.id
  into actor_membership_id
  from organizations.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.person_id = p_person_id
    and membership.status = 'active';
  if actor_membership_id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-ORG-011', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select jsonb_build_object(
      'organization_id', event.organization_id,
      'owner_membership_id', event.after_snapshot->>'owner_membership_id',
      'previous_owner_membership_id', event.after_snapshot->>'previous_owner_membership_id',
      'transferred_at', event.after_snapshot->>'transferred_at'
    ) into response
    from system.idempotency_keys as idempotency
    join organizations.organization_events as event
      on event.id = idempotency.aggregate_id
     and event.organization_id = p_organization_id
     and event.event_type = 'organization.ownership_transferred.v1'
    where idempotency.id = receipt.receipt_id
      and idempotency.aggregate_type = 'organization_ownership_transfer';
    if response is null then
      raise exception 'idempotent ownership transfer not found' using errcode = '40001';
    end if;
    return response;
  end if;

  if not exists (
    select 1
    from organizations.membership_roles as role
    where role.membership_id = actor_membership_id
      and role.role_code = 'owner'
      and role.valid_to is null
  ) then
    raise exception 'active owner role required' using errcode = '42501';
  end if;

  select membership.* into target_membership
  from organizations.organization_memberships as membership
  where membership.id = p_target_membership_id
    and membership.organization_id = p_organization_id;
  if target_membership.id is null then
    raise exception 'target membership not found' using errcode = 'P0002';
  end if;
  if target_membership.status <> 'active' or target_membership.id = actor_membership_id then
    raise exception 'target membership is not eligible for ownership' using errcode = '22023';
  end if;

  perform 1
  from organizations.organization_memberships as membership
  where membership.id in (actor_membership_id, p_target_membership_id)
  order by membership.id
  for update;

  perform 1
  from organizations.membership_roles as role
  where role.membership_id in (actor_membership_id, p_target_membership_id)
    and role.role_code = 'owner'
  order by role.membership_id, role.id
  for update;

  if exists (
    select 1
    from organizations.membership_roles as role
    where role.membership_id = p_target_membership_id
      and role.role_code = 'owner'
      and role.valid_to is null
  ) then
    raise exception 'target membership is already owner' using errcode = '22023';
  end if;

  update organizations.membership_roles
  set valid_to = transferred_at
  where membership_id = actor_membership_id
    and role_code = 'owner'
    and valid_to is null;
  if not found then
    raise exception 'ownership changed concurrently' using errcode = '40001';
  end if;

  insert into organizations.membership_roles (membership_id, role_code, valid_from)
  values (p_target_membership_id, 'owner', transferred_at);

  insert into organizations.organization_events (
    organization_id, event_type, before_snapshot, after_snapshot, actor_membership_id
  ) values (
    p_organization_id,
    'organization.ownership_transferred.v1',
    jsonb_build_object('owner_membership_id', actor_membership_id),
    jsonb_build_object(
      'previous_owner_membership_id', actor_membership_id,
      'owner_membership_id', p_target_membership_id,
      'transferred_at', transferred_at
    ),
    actor_membership_id
  )
  returning id into transfer_event_id;

  insert into organizations.membership_events (membership_id, event_type, "before", "after")
  values
    (
      actor_membership_id,
      'organization.role_revoked.v1',
      jsonb_build_object('role_code', 'owner', 'valid_to', null),
      jsonb_build_object('role_code', 'owner', 'valid_to', transferred_at)
    ),
    (
      p_target_membership_id,
      'organization.role_granted.v1',
      null,
      jsonb_build_object('role_code', 'owner', 'valid_from', transferred_at)
    );

  response := jsonb_build_object(
    'organization_id', p_organization_id,
    'owner_membership_id', p_target_membership_id,
    'previous_owner_membership_id', actor_membership_id,
    'transferred_at', transferred_at
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'organization-ownership-transferred',
    'organization_ownership_transfer', transfer_event_id
  );
  return response;
end
$function$;

create or replace function organizations.grant_membership_role(
  p_person_id uuid,
  p_organization_id uuid,
  p_membership_id uuid,
  p_role_code text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  actor_membership_id uuid;
  membership_role_id uuid;
  role_valid_from timestamptz;
  response jsonb;
begin
  perform set_config('lock_timeout', '750ms', true);

  if access_control.actor_kind() <> 'person' or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
  if p_role_code not in ('admin', 'coach', 'staff') then
    raise exception 'role is not assignable' using errcode = '22023';
  end if;

  select membership.id
  into actor_membership_id
  from organizations.organization_memberships as membership
  join organizations.organizations as organization on organization.id = membership.organization_id
  where organization.id = p_organization_id
    and organization.status = 'active'
    and membership.person_id = p_person_id
    and membership.status = 'active'
  for update of organization;
  if actor_membership_id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-ORG-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select jsonb_build_object(
      'membership_id', membership.id,
      'role_code', role.role_code,
      'valid_from', role.valid_from
    ) into response
    from system.idempotency_keys as idempotency
    join organizations.membership_roles as role on role.id = idempotency.aggregate_id
    join organizations.organization_memberships as membership
      on membership.id = role.membership_id
     and membership.organization_id = p_organization_id
    where idempotency.id = receipt.receipt_id
      and idempotency.aggregate_type = 'membership_role'
      and membership.id = p_membership_id
      and role.role_code = p_role_code;
    if response is null then
      raise exception 'idempotent role grant not found' using errcode = '40001';
    end if;
    return response;
  end if;

  if not access_control.has_capability(p_organization_id, 'manage_roles') then
    raise exception 'role management capability required' using errcode = '42501';
  end if;

  perform 1
  from organizations.organization_memberships as membership
  where membership.id = p_membership_id
    and membership.organization_id = p_organization_id
    and membership.status = 'active'
  for update;
  if not found then
    if exists (
      select 1
      from organizations.organization_memberships as membership
      where membership.id = p_membership_id
        and membership.organization_id = p_organization_id
    ) then
      raise exception 'target membership is inactive' using errcode = '22023';
    end if;
    raise exception 'target membership not found' using errcode = 'P0002';
  end if;

  select role.id, role.valid_from
  into membership_role_id, role_valid_from
  from organizations.membership_roles as role
  where role.membership_id = p_membership_id
    and role.role_code = p_role_code
    and role.valid_to is null
  for update;

  if role_valid_from is null then
    insert into organizations.membership_roles (membership_id, role_code)
    values (p_membership_id, p_role_code)
    returning id, valid_from into membership_role_id, role_valid_from;

    insert into organizations.membership_events (membership_id, event_type, "after")
    values (
      p_membership_id,
      'organization.role_granted.v1',
      jsonb_build_object('role_code', p_role_code, 'valid_from', role_valid_from)
    );
  end if;

  response := jsonb_build_object(
    'membership_id', p_membership_id,
    'role_code', p_role_code,
    'valid_from', role_valid_from
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'organization-role-granted',
    'membership_role', membership_role_id
  );
  return response;
end
$function$;

alter function organizations.update_organization(uuid, uuid, bigint, jsonb, uuid, uuid, bytea)
  owner to allfit_owner;
alter function organizations.create_site(uuid, uuid, jsonb, uuid, uuid, bytea)
  owner to allfit_owner;
alter function organizations.update_site(uuid, uuid, uuid, bigint, jsonb, uuid, uuid, bytea)
  owner to allfit_owner;
alter function organizations.transfer_ownership(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function organizations.grant_membership_role(uuid, uuid, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;

revoke all on function organizations.update_organization(uuid, uuid, bigint, jsonb, uuid, uuid, bytea)
  from public;
revoke all on function organizations.create_site(uuid, uuid, jsonb, uuid, uuid, bytea)
  from public;
revoke all on function organizations.update_site(uuid, uuid, uuid, bigint, jsonb, uuid, uuid, bytea)
  from public;
revoke all on function organizations.transfer_ownership(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;
revoke all on function organizations.grant_membership_role(uuid, uuid, uuid, text, uuid, uuid, bytea)
  from public;

grant execute on function organizations.update_organization(uuid, uuid, bigint, jsonb, uuid, uuid, bytea)
  to allfit_api;
grant execute on function organizations.create_site(uuid, uuid, jsonb, uuid, uuid, bytea)
  to allfit_api;
grant execute on function organizations.update_site(uuid, uuid, uuid, bigint, jsonb, uuid, uuid, bytea)
  to allfit_api;
grant execute on function organizations.transfer_ownership(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function organizations.grant_membership_role(uuid, uuid, uuid, text, uuid, uuid, bytea)
  to allfit_api;
