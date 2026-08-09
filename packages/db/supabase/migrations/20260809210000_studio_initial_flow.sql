-- Studio self-service activation and initial organization workspace.
-- All commands converge in PostgreSQL before the browser receives success.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists system authorization allfit_owner;
create schema if not exists organizations authorization allfit_owner;

revoke all on schema system, organizations from public;
grant usage on schema system, organizations to allfit_api;

create type system.command_surface as enum ('space', 'studio', 'backoffice', 'system');
create type system.idempotency_status as enum ('processing', 'succeeded', 'rejected_final');
create type identity.onboarding_status as enum ('open', 'activated', 'ineligible', 'expired');
create type identity.eligibility_result as enum ('pass', 'fail', 'review_required', 'unknown');
create type organizations.organization_status as enum ('active', 'closed');
create type organizations.membership_status as enum ('active', 'terminated');

alter type system.command_surface owner to allfit_owner;
alter type system.idempotency_status owner to allfit_owner;
alter type identity.onboarding_status owner to allfit_owner;
alter type identity.eligibility_result owner to allfit_owner;
alter type organizations.organization_status owner to allfit_owner;
alter type organizations.membership_status owner to allfit_owner;

create table system.idempotency_keys (
  id uuid not null default extensions.uuid_generate_v7(),
  principal_fingerprint bytea not null,
  client_id text not null,
  surface system.command_surface not null,
  operation_code text not null,
  key uuid not null,
  command_id uuid not null,
  request_hash bytea not null,
  status system.idempotency_status not null,
  http_status smallint,
  outcome_code text,
  response_schema_version smallint,
  response jsonb,
  aggregate_type text,
  aggregate_id uuid,
  effect_disposed_at timestamptz,
  completed_at timestamptz,
  response_expires_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_idempotency_keys primary key (id),
  constraint ck_idempotency_keys_principal_hash check (octet_length(principal_fingerprint) = 32),
  constraint ck_idempotency_keys_request_hash check (octet_length(request_hash) = 32),
  constraint ck_idempotency_keys_client_id check (btrim(client_id) <> ''),
  constraint ck_idempotency_keys_operation_code check (operation_code ~ '^OP-[A-Z]+-[0-9]{3}$'),
  constraint ck_idempotency_keys_http_status check (http_status is null or http_status between 200 and 499),
  constraint ck_idempotency_keys_response_schema check (response_schema_version is null or response_schema_version = 1),
  constraint ck_idempotency_keys_aggregate_pair check ((aggregate_type is null) = (aggregate_id is null)),
  constraint ck_idempotency_keys_terminal_shape check (
    status = 'processing'
    or (
      http_status is not null
      and outcome_code is not null
      and response_schema_version = 1
      and response is not null
      and completed_at is not null
      and response_expires_at is not null
    )
  )
);

create unique index uidx_idempotency_keys_transport
  on system.idempotency_keys (principal_fingerprint, client_id, surface, operation_code, key);
create unique index uidx_idempotency_keys_command
  on system.idempotency_keys (principal_fingerprint, surface, operation_code, command_id);
create index idx_idempotency_keys_aggregate
  on system.idempotency_keys (aggregate_type, aggregate_id)
  where aggregate_id is not null;
create index idx_idempotency_keys_expiry
  on system.idempotency_keys (response_expires_at)
  where response is not null;

alter table system.idempotency_keys owner to allfit_owner;
alter table system.idempotency_keys enable row level security;
alter table system.idempotency_keys force row level security;

create policy idempotency_keys_all_owner on system.idempotency_keys
  for all to allfit_owner using (true) with check (true);

revoke all on system.idempotency_keys from public, allfit_api;

create or replace function system.enforce_idempotency_terminal()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if exists (
    select 1
    from system.idempotency_keys as receipt
    where receipt.id = new.id
      and receipt.status = 'processing'
  ) then
    raise exception 'idempotency receipt cannot commit while processing' using errcode = '23514';
  end if;
  return null;
end
$function$;

alter function system.enforce_idempotency_terminal() owner to allfit_owner;
revoke all on function system.enforce_idempotency_terminal() from public;

create constraint trigger trg_idempotency_keys_after_terminal
after insert or update on system.idempotency_keys
deferrable initially deferred
for each row execute function system.enforce_idempotency_terminal();

create or replace function system.begin_idempotency(
  p_principal_id uuid,
  p_operation_code text,
  p_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (claimed boolean, receipt_id uuid, aggregate_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  principal_hash bytea;
  inserted_id uuid;
  existing system.idempotency_keys%rowtype;
begin
  if p_principal_id is null or octet_length(p_request_hash) <> 32 then
    raise exception 'invalid idempotency identity' using errcode = '22023';
  end if;

  principal_hash := extensions.digest(convert_to(p_principal_id::text, 'UTF8'), 'sha256');

  insert into system.idempotency_keys (
    principal_fingerprint,
    client_id,
    surface,
    operation_code,
    key,
    command_id,
    request_hash,
    status
  ) values (
    principal_hash,
    'studio',
    'studio',
    p_operation_code,
    p_key,
    p_command_id,
    p_request_hash,
    'processing'
  )
  on conflict do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return query select true, inserted_id, null::uuid;
    return;
  end if;

  select receipt.* into existing
  from system.idempotency_keys as receipt
  where receipt.principal_fingerprint = principal_hash
    and receipt.surface = 'studio'
    and receipt.operation_code = p_operation_code
    and (
      (receipt.client_id = 'studio' and receipt.key = p_key)
      or receipt.command_id = p_command_id
    )
  order by receipt.created_at
  limit 1;

  if existing.id is null then
    raise exception 'idempotency conflict could not be resolved' using errcode = '40001';
  end if;
  if existing.request_hash <> p_request_hash then
    raise exception 'idempotency identity reused with a different request' using errcode = '23505';
  end if;
  if existing.status = 'processing' then
    raise exception 'idempotency command is still processing' using errcode = '40001';
  end if;

  return query select false, existing.id, existing.aggregate_id;
end
$function$;

create or replace function system.finish_idempotency(
  p_receipt_id uuid,
  p_http_status smallint,
  p_outcome_code text,
  p_aggregate_type text,
  p_aggregate_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update system.idempotency_keys
  set status = 'succeeded',
      http_status = p_http_status,
      outcome_code = p_outcome_code,
      response_schema_version = 1,
      response = jsonb_build_object(
        'status', 'succeeded',
        'resource_type', p_aggregate_type,
        'resource_id', p_aggregate_id
      ),
      aggregate_type = p_aggregate_type,
      aggregate_id = p_aggregate_id,
      completed_at = clock_timestamp(),
      response_expires_at = clock_timestamp() + interval '24 hours'
  where id = p_receipt_id
    and status = 'processing';

  if not found then
    raise exception 'idempotency receipt is not claimable' using errcode = '40001';
  end if;
end
$function$;

alter function system.begin_idempotency(uuid, text, uuid, uuid, bytea) owner to allfit_owner;
alter function system.finish_idempotency(uuid, smallint, text, text, uuid) owner to allfit_owner;
revoke all on function system.begin_idempotency(uuid, text, uuid, uuid, bytea) from public;
revoke all on function system.finish_idempotency(uuid, smallint, text, text, uuid) from public;

create table identity.onboarding_attempts (
  id uuid not null default extensions.uuid_generate_v7(),
  account_id uuid not null,
  person_id uuid,
  status identity.onboarding_status not null default 'open',
  invitation_token_hash text,
  terms_version text,
  terms_accepted_at timestamptz,
  privacy_notice_version text,
  privacy_notice_accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_onboarding_attempts primary key (id),
  constraint fk_onboarding_attempts_account foreign key (account_id) references identity.access_accounts(id) on delete restrict,
  constraint fk_onboarding_attempts_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint ck_onboarding_attempts_expiry check (expires_at > created_at),
  constraint ck_onboarding_attempts_terms_pair check ((terms_version is null) = (terms_accepted_at is null)),
  constraint ck_onboarding_attempts_privacy_pair check ((privacy_notice_version is null) = (privacy_notice_accepted_at is null)),
  constraint ck_onboarding_attempts_activation check (
    status <> 'activated'
    or (
      person_id is not null
      and terms_version is not null
      and privacy_notice_version is not null
    )
  )
);

create unique index uidx_onboarding_attempts_open_account
  on identity.onboarding_attempts (account_id)
  where status = 'open';
create index idx_onboarding_attempts_account_status
  on identity.onboarding_attempts (account_id, status);
create index idx_onboarding_attempts_person
  on identity.onboarding_attempts (person_id)
  where person_id is not null;

create table identity.eligibility_evidence (
  id uuid not null default extensions.uuid_generate_v7(),
  onboarding_attempt_id uuid not null,
  result identity.eligibility_result not null,
  policy_version integer not null,
  policy_snapshot_schema_version smallint not null default 1,
  policy_snapshot jsonb not null,
  evaluated_at timestamptz not null default clock_timestamp(),
  constraint pk_eligibility_evidence primary key (id),
  constraint fk_eligibility_evidence_attempt foreign key (onboarding_attempt_id) references identity.onboarding_attempts(id) on delete cascade,
  constraint ck_eligibility_evidence_policy_version check (policy_version = 1),
  constraint ck_eligibility_evidence_snapshot_version check (policy_snapshot_schema_version = 1),
  constraint ck_eligibility_evidence_snapshot_object check (jsonb_typeof(policy_snapshot) = 'object')
);

create index idx_eligibility_evidence_attempt_evaluated
  on identity.eligibility_evidence (onboarding_attempt_id, evaluated_at desc);

alter table identity.onboarding_attempts owner to allfit_owner;
alter table identity.eligibility_evidence owner to allfit_owner;

create trigger trg_onboarding_attempts_before_update_timestamp
before update on identity.onboarding_attempts
for each row execute function access_control.set_updated_at();

alter table identity.onboarding_attempts enable row level security;
alter table identity.onboarding_attempts force row level security;
alter table identity.eligibility_evidence enable row level security;
alter table identity.eligibility_evidence force row level security;

create policy onboarding_attempts_all_owner on identity.onboarding_attempts
  for all to allfit_owner using (true) with check (true);
create policy onboarding_attempts_select_own_account on identity.onboarding_attempts
  for select to allfit_api using (account_id = access_control.account());
create policy eligibility_evidence_all_owner on identity.eligibility_evidence
  for all to allfit_owner using (true) with check (true);
create policy eligibility_evidence_select_own_account on identity.eligibility_evidence
  for select to allfit_api using (
    exists (
      select 1
      from identity.onboarding_attempts as attempt
      where attempt.id = onboarding_attempt_id
        and attempt.account_id = access_control.account()
    )
  );

revoke all on identity.onboarding_attempts, identity.eligibility_evidence from public, allfit_api;
grant select on identity.onboarding_attempts, identity.eligibility_evidence to allfit_api;

create or replace function identity.start_onboarding_attempt(
  p_account_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  attempt_id uuid,
  status text,
  eligibility_status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  account_person_id uuid;
  attempt identity.onboarding_attempts%rowtype;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  select person_id into account_person_id
  from identity.access_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'access account does not exist' using errcode = '42501';
  end if;
  if account_person_id is not null then
    raise exception 'registration is already complete' using errcode = '23505';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-001',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    select * into attempt
    from identity.onboarding_attempts as onboarding_attempt
    where onboarding_attempt.id = receipt.aggregate_id
      and onboarding_attempt.account_id = p_account_id;
  else
    update identity.onboarding_attempts as onboarding_attempt
    set status = 'expired'
    where onboarding_attempt.account_id = p_account_id
      and onboarding_attempt.status = 'open'
      and onboarding_attempt.expires_at <= clock_timestamp();

    select * into attempt
    from identity.onboarding_attempts as onboarding_attempt
    where onboarding_attempt.account_id = p_account_id
      and onboarding_attempt.status = 'open'
      and onboarding_attempt.expires_at > clock_timestamp()
    for update;

    if attempt.id is null then
      insert into identity.onboarding_attempts (account_id, expires_at)
      values (p_account_id, clock_timestamp() + interval '24 hours')
      returning * into attempt;
    end if;

    perform system.finish_idempotency(
      receipt.receipt_id,
      200::smallint,
      'onboarding-attempt-open',
      'onboarding_attempt',
      attempt.id
    );
  end if;

  if attempt.id is null then
    raise exception 'onboarding attempt could not be resolved' using errcode = '40001';
  end if;

  return query
  select
    attempt.id,
    attempt.status::text,
    coalesce((
      select evidence.result::text
      from identity.eligibility_evidence as evidence
      where evidence.onboarding_attempt_id = attempt.id
      order by evidence.evaluated_at desc, evidence.id desc
      limit 1
    ), 'pending'),
    attempt.expires_at;
end
$function$;

create or replace function identity.record_adult_eligibility(
  p_account_id uuid,
  p_attempt_id uuid,
  p_declared_adult boolean,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result text, evaluated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  attempt identity.onboarding_attempts%rowtype;
  evidence identity.eligibility_evidence%rowtype;
  evaluated_result identity.eligibility_result;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-002',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    select * into evidence
    from identity.eligibility_evidence
    where id = receipt.aggregate_id;
  else
    select * into attempt
    from identity.onboarding_attempts
    where id = p_attempt_id
      and account_id = p_account_id
    for update;

    if attempt.id is null then
      raise exception 'onboarding attempt is not owned by the account' using errcode = '42501';
    end if;
    if attempt.status <> 'open' or attempt.expires_at <= clock_timestamp() then
      raise exception 'onboarding attempt is not open' using errcode = '23514';
    end if;

    evaluated_result := case
      when p_declared_adult then 'pass'::identity.eligibility_result
      else 'fail'::identity.eligibility_result
    end;
    insert into identity.eligibility_evidence (
      onboarding_attempt_id,
      result,
      policy_version,
      policy_snapshot,
      evaluated_at
    ) values (
      p_attempt_id,
      evaluated_result,
      1,
      jsonb_build_object(
        'policy_code', 'adult_eligibility',
        'minimum_age', 18,
        'jurisdiction', 'CO',
        'evidence_kind', 'self_declaration',
        'evaluated_result', evaluated_result
      ),
      clock_timestamp()
    )
    returning * into evidence;

    if evaluated_result = 'fail' then
      update identity.onboarding_attempts
      set status = 'ineligible'
      where id = p_attempt_id;
    end if;

    perform system.finish_idempotency(
      receipt.receipt_id,
      200::smallint,
      'adult-eligibility-recorded',
      'eligibility_evidence',
      evidence.id
    );
  end if;

  return query select evidence.result::text, evidence.evaluated_at;
end
$function$;

create or replace function identity.activate_person(
  p_account_id uuid,
  p_attempt_id uuid,
  p_given_name text,
  p_family_name text,
  p_terms_accepted boolean,
  p_privacy_notice_accepted boolean,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  account_person_id uuid;
  attempt identity.onboarding_attempts%rowtype;
  result_person_id uuid;
  eligibility identity.eligibility_result;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;
  if btrim(p_given_name) = '' or btrim(p_family_name) = '' then
    raise exception 'given name and family name are required' using errcode = '22023';
  end if;
  if not p_terms_accepted or not p_privacy_notice_accepted then
    raise exception 'legal acceptances are required' using errcode = '23514';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-003',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    return receipt.aggregate_id;
  end if;

  select person_id into account_person_id
  from identity.access_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'access account does not exist' using errcode = '42501';
  end if;

  select * into attempt
  from identity.onboarding_attempts
  where id = p_attempt_id
    and account_id = p_account_id
  for update;

  if attempt.id is null then
    raise exception 'onboarding attempt is not owned by the account' using errcode = '42501';
  end if;

  if account_person_id is not null then
    if attempt.person_id is not null and attempt.person_id <> account_person_id then
      raise exception 'access account is linked to a different person' using errcode = '23514';
    end if;
    result_person_id := account_person_id;
  else
    if attempt.status <> 'open' or attempt.expires_at <= clock_timestamp() then
      raise exception 'onboarding attempt is not open' using errcode = '23514';
    end if;

    select evidence.result into eligibility
    from identity.eligibility_evidence as evidence
    where evidence.onboarding_attempt_id = p_attempt_id
    order by evidence.evaluated_at desc, evidence.id desc
    limit 1;

    if eligibility is distinct from 'pass' then
      raise exception 'adult eligibility is required' using errcode = '23514';
    end if;

    insert into identity.people (given_name, family_name)
    values (btrim(p_given_name), btrim(p_family_name))
    returning id into result_person_id;

    update identity.access_accounts
    set person_id = result_person_id
    where id = p_account_id
      and person_id is null;

    if not found then
      raise exception 'access account was linked concurrently' using errcode = '40001';
    end if;

    update identity.onboarding_attempts
    set person_id = result_person_id,
        status = 'activated',
        terms_version = 'platform_terms_v1',
        terms_accepted_at = clock_timestamp(),
        privacy_notice_version = 'privacy_notice_v1',
        privacy_notice_accepted_at = clock_timestamp()
    where id = p_attempt_id;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'person-activated',
    'person',
    result_person_id
  );
  return result_person_id;
end
$function$;

alter function identity.start_onboarding_attempt(uuid, uuid, uuid, bytea) owner to allfit_owner;
alter function identity.record_adult_eligibility(uuid, uuid, boolean, uuid, uuid, bytea) owner to allfit_owner;
alter function identity.activate_person(uuid, uuid, text, text, boolean, boolean, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.start_onboarding_attempt(uuid, uuid, uuid, bytea) from public;
revoke all on function identity.record_adult_eligibility(uuid, uuid, boolean, uuid, uuid, bytea) from public;
revoke all on function identity.activate_person(uuid, uuid, text, text, boolean, boolean, uuid, uuid, bytea) from public;
grant execute on function identity.start_onboarding_attempt(uuid, uuid, uuid, bytea) to allfit_api;
grant execute on function identity.record_adult_eligibility(uuid, uuid, boolean, uuid, uuid, bytea) to allfit_api;
grant execute on function identity.activate_person(uuid, uuid, text, text, boolean, boolean, uuid, uuid, bytea) to allfit_api;

create table organizations.organization_types (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  sort_order smallint not null,
  active boolean not null default true,
  constraint pk_organization_types primary key (id),
  constraint uq_organization_types_code unique (code),
  constraint ck_organization_types_code check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint ck_organization_types_name check (btrim(name) <> ''),
  constraint ck_organization_types_sort_order check (sort_order > 0)
);

create table organizations.organizations (
  id uuid not null default extensions.uuid_generate_v7(),
  type_code text not null,
  legal_name text,
  display_name text not null,
  status organizations.organization_status not null default 'active',
  responsible_party_schema_version smallint not null default 1,
  responsible_party jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_organizations primary key (id),
  constraint fk_organizations_type foreign key (type_code) references organizations.organization_types(code) on delete restrict,
  constraint ck_organizations_display_name check (btrim(display_name) <> ''),
  constraint ck_organizations_legal_name check (legal_name is null or btrim(legal_name) <> ''),
  constraint ck_organizations_responsible_party_version check (responsible_party_schema_version = 1),
  constraint ck_organizations_responsible_party check (
    jsonb_typeof(responsible_party) = 'object'
    and responsible_party->>'party_kind' in ('natural_person', 'legal_entity')
    and btrim(responsible_party->>'party_name') <> ''
    and responsible_party->>'purpose' = 'studio_operations'
  )
);

create table organizations.organization_memberships (
  id uuid not null default extensions.uuid_generate_v7(),
  organization_id uuid not null,
  person_id uuid not null,
  status organizations.membership_status not null default 'active',
  joined_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_organization_memberships primary key (id),
  constraint fk_organization_memberships_organization foreign key (organization_id) references organizations.organizations(id) on delete restrict,
  constraint fk_organization_memberships_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint uq_organization_memberships_carrier unique (id, organization_id),
  constraint uq_organization_memberships_person_carrier unique (id, organization_id, person_id),
  constraint ck_organization_memberships_termination check (
    (status = 'active' and ended_at is null)
    or (status = 'terminated' and ended_at is not null)
  )
);

create unique index uidx_organization_memberships_active_person
  on organizations.organization_memberships (organization_id, person_id)
  where status = 'active';
create index idx_organization_memberships_person_status
  on organizations.organization_memberships (person_id, status);
create index idx_organization_memberships_organization_status
  on organizations.organization_memberships (organization_id, status);

create table organizations.organization_roles (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  constraint pk_organization_roles primary key (id),
  constraint uq_organization_roles_code unique (code),
  constraint ck_organization_roles_code check (code in ('owner', 'admin', 'coach', 'staff')),
  constraint ck_organization_roles_name check (btrim(name) <> '')
);

create table organizations.membership_roles (
  id uuid not null default extensions.uuid_generate_v7(),
  membership_id uuid not null,
  role_code text not null,
  valid_from timestamptz not null default clock_timestamp(),
  valid_to timestamptz,
  constraint pk_membership_roles primary key (id),
  constraint fk_membership_roles_membership foreign key (membership_id) references organizations.organization_memberships(id) on delete cascade,
  constraint fk_membership_roles_role foreign key (role_code) references organizations.organization_roles(code) on delete restrict,
  constraint ck_membership_roles_validity check (valid_to is null or valid_to > valid_from)
);

create unique index uidx_membership_roles_active_role
  on organizations.membership_roles (membership_id, role_code)
  where valid_to is null;
create index idx_membership_roles_membership_validity
  on organizations.membership_roles (membership_id, role_code, valid_from, valid_to);

create table organizations.organization_events (
  id uuid not null default extensions.uuid_generate_v7(),
  organization_id uuid not null,
  event_type text not null,
  snapshot_schema_version smallint not null default 1,
  before_snapshot jsonb,
  after_snapshot jsonb,
  actor_membership_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint pk_organization_events primary key (id),
  constraint fk_organization_events_organization foreign key (organization_id) references organizations.organizations(id) on delete restrict,
  constraint fk_organization_events_actor_membership foreign key (actor_membership_id, organization_id) references organizations.organization_memberships(id, organization_id) on delete restrict,
  constraint ck_organization_events_type check (event_type ~ '^organization\.[a-z_]+\.v1$'),
  constraint ck_organization_events_snapshot_version check (snapshot_schema_version = 1),
  constraint ck_organization_events_snapshot_presence check (before_snapshot is not null or after_snapshot is not null)
);

create index idx_organization_events_organization_occurred
  on organizations.organization_events (organization_id, occurred_at desc);

alter table organizations.organization_types owner to allfit_owner;
alter table organizations.organizations owner to allfit_owner;
alter table organizations.organization_memberships owner to allfit_owner;
alter table organizations.organization_roles owner to allfit_owner;
alter table organizations.membership_roles owner to allfit_owner;
alter table organizations.organization_events owner to allfit_owner;

insert into organizations.organization_types (id, code, name, sort_order)
values
  ('0198f000-0000-7000-8000-000000000001', 'professional_practice', 'Práctica profesional', 1),
  ('0198f000-0000-7000-8000-000000000002', 'gym', 'Gimnasio', 2),
  ('0198f000-0000-7000-8000-000000000003', 'studio', 'Estudio', 3),
  ('0198f000-0000-7000-8000-000000000004', 'academy', 'Academia', 4),
  ('0198f000-0000-7000-8000-000000000005', 'clinic', 'Clínica', 5);

insert into organizations.organization_roles (id, code, name)
values
  ('0198f000-0000-7000-8000-000000000011', 'owner', 'Propietario'),
  ('0198f000-0000-7000-8000-000000000012', 'admin', 'Administrador'),
  ('0198f000-0000-7000-8000-000000000013', 'coach', 'Coach'),
  ('0198f000-0000-7000-8000-000000000014', 'staff', 'Staff');

create trigger trg_organizations_before_update_timestamp
before update on organizations.organizations
for each row execute function access_control.set_updated_at();
create trigger trg_organization_memberships_before_update_timestamp
before update on organizations.organization_memberships
for each row execute function access_control.set_updated_at();

alter table organizations.organization_types enable row level security;
alter table organizations.organization_types force row level security;
alter table organizations.organizations enable row level security;
alter table organizations.organizations force row level security;
alter table organizations.organization_memberships enable row level security;
alter table organizations.organization_memberships force row level security;
alter table organizations.organization_roles enable row level security;
alter table organizations.organization_roles force row level security;
alter table organizations.membership_roles enable row level security;
alter table organizations.membership_roles force row level security;
alter table organizations.organization_events enable row level security;
alter table organizations.organization_events force row level security;

create or replace function access_control.has_membership(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from organizations.organization_memberships as membership
    where membership.organization_id = p_organization_id
      and membership.person_id = access_control.person()
      and membership.status = 'active'
  )
$function$;

create or replace function access_control.owns_membership(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from organizations.organization_memberships as membership
    where membership.id = p_membership_id
      and membership.person_id = access_control.person()
  )
$function$;

alter function access_control.has_membership(uuid) owner to allfit_owner;
alter function access_control.owns_membership(uuid) owner to allfit_owner;
revoke all on function access_control.has_membership(uuid) from public;
revoke all on function access_control.owns_membership(uuid) from public;
grant execute on function access_control.has_membership(uuid) to allfit_api;
grant execute on function access_control.owns_membership(uuid) to allfit_api;

create policy organization_types_all_owner on organizations.organization_types
  for all to allfit_owner using (true) with check (true);
create policy organization_types_select_authenticated on organizations.organization_types
  for select to allfit_api using (access_control.person() is not null and active);
create policy organizations_all_owner on organizations.organizations
  for all to allfit_owner using (true) with check (true);
create policy organizations_select_members on organizations.organizations
  for select to allfit_api using (access_control.has_membership(id));
create policy organization_memberships_all_owner on organizations.organization_memberships
  for all to allfit_owner using (true) with check (true);
create policy organization_memberships_select_self on organizations.organization_memberships
  for select to allfit_api using (person_id = access_control.person());
create policy organization_roles_all_owner on organizations.organization_roles
  for all to allfit_owner using (true) with check (true);
create policy organization_roles_select_authenticated on organizations.organization_roles
  for select to allfit_api using (access_control.person() is not null);
create policy membership_roles_all_owner on organizations.membership_roles
  for all to allfit_owner using (true) with check (true);
create policy membership_roles_select_self on organizations.membership_roles
  for select to allfit_api using (access_control.owns_membership(membership_id));
create policy organization_events_all_owner on organizations.organization_events
  for all to allfit_owner using (true) with check (true);

revoke all on
  organizations.organization_types,
  organizations.organizations,
  organizations.organization_memberships,
  organizations.organization_roles,
  organizations.membership_roles,
  organizations.organization_events
from public, allfit_api;

grant select on
  organizations.organization_types,
  organizations.organizations,
  organizations.organization_memberships,
  organizations.organization_roles,
  organizations.membership_roles
to allfit_api;

create or replace function organizations.enforce_exactly_one_active_owner()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  target_organization_id uuid;
  active_status organizations.organization_status;
  owner_count bigint;
begin
  if tg_table_name = 'organizations' then
    target_organization_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'organization_memberships' then
    target_organization_id := coalesce(new.organization_id, old.organization_id);
  else
    select membership.organization_id into target_organization_id
    from organizations.organization_memberships as membership
    where membership.id = coalesce(new.membership_id, old.membership_id);
  end if;

  select organization.status into active_status
  from organizations.organizations as organization
  where organization.id = target_organization_id;

  if active_status = 'active' then
    select count(*) into owner_count
    from organizations.organization_memberships as membership
    join organizations.membership_roles as role on role.membership_id = membership.id
    where membership.organization_id = target_organization_id
      and membership.status = 'active'
      and role.role_code = 'owner'
      and role.valid_to is null;

    if owner_count <> 1 then
      raise exception 'active organization must have exactly one active owner' using errcode = '23514';
    end if;
  end if;
  return null;
end
$function$;

alter function organizations.enforce_exactly_one_active_owner() owner to allfit_owner;
revoke all on function organizations.enforce_exactly_one_active_owner() from public;

create constraint trigger trg_organizations_after_owner_invariant
after insert or update or delete on organizations.organizations
deferrable initially deferred
for each row execute function organizations.enforce_exactly_one_active_owner();
create constraint trigger trg_organization_memberships_after_owner_invariant
after insert or update or delete on organizations.organization_memberships
deferrable initially deferred
for each row execute function organizations.enforce_exactly_one_active_owner();
create constraint trigger trg_membership_roles_after_owner_invariant
after insert or update or delete on organizations.membership_roles
deferrable initially deferred
for each row execute function organizations.enforce_exactly_one_active_owner();

create or replace function organizations.list_organization_types()
returns table (code text, name text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() is null then
    raise exception 'active person required' using errcode = '42501';
  end if;
  return query
  select organization_type.code, organization_type.name
  from organizations.organization_types as organization_type
  where organization_type.active
  order by organization_type.sort_order, organization_type.code;
end
$function$;

create or replace function organizations.list_my_memberships(p_person_id uuid)
returns table (
  membership_id uuid,
  organization_id uuid,
  display_name text,
  type_code text,
  status text,
  joined_at timestamptz,
  ended_at timestamptz,
  roles text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'membership subject does not match the authenticated actor' using errcode = '42501';
  end if;

  return query
  select
    membership.id,
    membership.organization_id,
    organization.display_name,
    organization.type_code,
    membership.status::text,
    membership.joined_at,
    membership.ended_at,
    coalesce(array_agg(role.role_code order by role.role_code) filter (where role.role_code is not null and role.valid_to is null), array[]::text[])
  from organizations.organization_memberships as membership
  join organizations.organizations as organization on organization.id = membership.organization_id
  left join organizations.membership_roles as role on role.membership_id = membership.id
  where membership.person_id = p_person_id
  group by membership.id, organization.id
  order by organization.display_name, membership.id;
end
$function$;

create or replace function organizations.create_organization(
  p_person_id uuid,
  p_display_name text,
  p_type_code text,
  p_responsible_party_kind text,
  p_responsible_party_name text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  organization_id uuid,
  membership_id uuid,
  display_name text,
  type_code text,
  role_code text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  created_organization_id uuid;
  created_membership_id uuid;
  person_active boolean;
  person_display_name text;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'organization creator does not match the authenticated actor' using errcode = '42501';
  end if;
  if btrim(p_display_name) = '' or btrim(p_responsible_party_name) = '' then
    raise exception 'organization and responsible party names are required' using errcode = '22023';
  end if;
  if p_responsible_party_kind not in ('natural_person', 'legal_entity') then
    raise exception 'unsupported responsible party kind' using errcode = '22023';
  end if;

  select person.status = 'active', person.display_name
  into person_active, person_display_name
  from identity.people as person
  where person.id = p_person_id;

  if person_active is distinct from true then
    raise exception 'active person required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from organizations.organization_types as organization_type
    where organization_type.code = p_type_code
      and organization_type.active
  ) then
    raise exception 'unsupported organization type' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id,
    'OP-ORG-001',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    return query
    select
      organization.id,
      membership.id,
      organization.display_name,
      organization.type_code,
      'owner'::text
    from organizations.organizations as organization
    join organizations.organization_memberships as membership
      on membership.organization_id = organization.id
     and membership.person_id = p_person_id
     and membership.status = 'active'
    where organization.id = receipt.aggregate_id;
    return;
  end if;

  insert into organizations.organizations (
    type_code,
    legal_name,
    display_name,
    responsible_party
  ) values (
    p_type_code,
    case when p_responsible_party_kind = 'legal_entity' then btrim(p_responsible_party_name) else null end,
    btrim(p_display_name),
    jsonb_build_object(
      'party_kind', p_responsible_party_kind,
      'party_name', case
        when p_responsible_party_kind = 'natural_person' then person_display_name
        else btrim(p_responsible_party_name)
      end,
      'purpose', 'studio_operations'
    )
  )
  returning id into created_organization_id;

  insert into organizations.organization_memberships (organization_id, person_id)
  values (created_organization_id, p_person_id)
  returning id into created_membership_id;

  insert into organizations.membership_roles (membership_id, role_code)
  values (created_membership_id, 'owner');

  insert into organizations.organization_events (
    organization_id,
    event_type,
    after_snapshot,
    actor_membership_id
  ) values (
    created_organization_id,
    'organization.created.v1',
    jsonb_build_object(
      'type_code', p_type_code,
      'display_name', btrim(p_display_name),
      'status', 'active'
    ),
    created_membership_id
  );

  perform system.finish_idempotency(
    receipt.receipt_id,
    201::smallint,
    'organization-created',
    'organization',
    created_organization_id
  );

  return query
  select
    created_organization_id,
    created_membership_id,
    btrim(p_display_name),
    p_type_code,
    'owner'::text;
end
$function$;

alter function organizations.list_organization_types() owner to allfit_owner;
alter function organizations.list_my_memberships(uuid) owner to allfit_owner;
alter function organizations.create_organization(uuid, text, text, text, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function organizations.list_organization_types() from public;
revoke all on function organizations.list_my_memberships(uuid) from public;
revoke all on function organizations.create_organization(uuid, text, text, text, text, uuid, uuid, bytea) from public;
grant execute on function organizations.list_organization_types() to allfit_api;
grant execute on function organizations.list_my_memberships(uuid) to allfit_api;
grant execute on function organizations.create_organization(uuid, text, text, text, text, uuid, uuid, bytea) to allfit_api;

alter default privileges for role allfit_owner revoke execute on functions from public;
alter default privileges for role allfit_owner revoke all on tables from public;
