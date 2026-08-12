-- Backoffice password + TOTP authentication authority and durable AAL2 evidence.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists support authorization allfit_owner;
revoke all on schema support from public;
grant usage on schema support to allfit_api;

create type identity.mfa_factor_status as enum ('pending', 'active', 'revoked', 'superseded');
create type identity.backoffice_authentication_attempt_status as enum (
  'pending_enrollment',
  'pending_challenge',
  'completed',
  'failed',
  'expired'
);

alter type identity.mfa_factor_status owner to allfit_owner;
alter type identity.backoffice_authentication_attempt_status owner to allfit_owner;

alter table identity.access_sessions
  add column assurance_level smallint not null default 1,
  add column authentication_method text,
  add column assurance_verified_at timestamptz,
  add column last_activity_at timestamptz,
  add column absolute_expires_at timestamptz,
  add constraint ck_access_sessions_assurance_level check (assurance_level in (1, 2)),
  add constraint ck_access_sessions_backoffice_assurance check (
    surface <> 'backoffice'::identity.access_session_surface
    or (
      assurance_level = 2
      and authentication_method = 'password_totp'
      and assurance_verified_at is not null
      and last_activity_at is not null
      and absolute_expires_at is not null
      and absolute_expires_at > created_at
    )
  );

create index idx_access_sessions_backoffice_activity
  on identity.access_sessions (last_activity_at, absolute_expires_at)
  where surface = 'backoffice'::identity.access_session_surface and revoked_at is null;

create table identity.access_account_mfa_factors (
  id uuid default extensions.uuid_generate_v7(),
  access_account_id uuid not null,
  provider text not null default 'workos',
  provider_factor_id text not null,
  factor_kind text not null default 'totp',
  status identity.mfa_factor_status not null default 'pending',
  verified_at timestamptz,
  revoked_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_access_account_mfa_factors primary key (id),
  constraint fk_access_account_mfa_factors_access_account foreign key (access_account_id) references identity.access_accounts(id) on delete restrict,
  constraint uq_access_account_mfa_factors_provider_factor unique (provider, provider_factor_id),
  constraint ck_access_account_mfa_factors_provider check (provider = 'workos'),
  constraint ck_access_account_mfa_factors_provider_factor_id check (btrim(provider_factor_id) <> ''),
  constraint ck_access_account_mfa_factors_kind check (factor_kind = 'totp'),
  constraint ck_access_account_mfa_factors_state check (
    (status = 'pending' and verified_at is null and revoked_at is null and superseded_at is null)
    or (status = 'active' and verified_at is not null and revoked_at is null and superseded_at is null)
    or (status = 'revoked' and revoked_at is not null and superseded_at is null)
    or (status = 'superseded' and superseded_at is not null and revoked_at is null)
  )
);

create unique index uidx_access_account_mfa_factors_current
  on identity.access_account_mfa_factors (access_account_id, factor_kind)
  where status in ('pending', 'active');
create index idx_access_account_mfa_factors_account_status
  on identity.access_account_mfa_factors (access_account_id, status);

create table identity.backoffice_authentication_attempts (
  id uuid default extensions.uuid_generate_v7(),
  access_account_id uuid not null,
  factor_id uuid not null,
  provider_session_id text not null,
  provider_challenge_id text not null,
  attempt_token_hash bytea not null,
  secret_ciphertext text,
  access_token_expires_at timestamptz not null,
  status identity.backoffice_authentication_attempt_status not null,
  invalid_code_count smallint not null default 0,
  verification_idempotency_key uuid,
  verification_command_id uuid,
  completed_session_id uuid,
  expires_at timestamptz not null,
  terminal_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_backoffice_authentication_attempts primary key (id),
  constraint fk_backoffice_authentication_attempts_access_account foreign key (access_account_id) references identity.access_accounts(id) on delete restrict,
  constraint fk_backoffice_authentication_attempts_factor foreign key (factor_id) references identity.access_account_mfa_factors(id) on delete restrict,
  constraint fk_backoffice_authentication_attempts_session foreign key (completed_session_id) references identity.access_sessions(id) on delete restrict,
  constraint uq_backoffice_authentication_attempts_token unique (attempt_token_hash),
  constraint uq_backoffice_authentication_attempts_provider_session unique (provider_session_id),
  constraint uq_backoffice_authentication_attempts_challenge unique (provider_challenge_id),
  constraint ck_backoffice_authentication_attempts_provider_session_id check (btrim(provider_session_id) <> ''),
  constraint ck_backoffice_authentication_attempts_provider_challenge_id check (btrim(provider_challenge_id) <> ''),
  constraint ck_backoffice_authentication_attempts_token_hash check (octet_length(attempt_token_hash) = 32),
  constraint ck_backoffice_authentication_attempts_ciphertext check (
    secret_ciphertext is null or secret_ciphertext like 'v1.%'
  ),
  constraint ck_backoffice_authentication_attempts_invalid_codes check (invalid_code_count between 0 and 5),
  constraint ck_backoffice_authentication_attempts_expiry check (expires_at > created_at),
  constraint ck_backoffice_authentication_attempts_terminal check (
    (status in ('pending_enrollment', 'pending_challenge') and terminal_at is null and secret_ciphertext is not null)
    or (status in ('completed', 'failed', 'expired') and terminal_at is not null and secret_ciphertext is null)
  ),
  constraint ck_backoffice_authentication_attempts_completion check (
    (status = 'completed' and completed_session_id is not null
      and verification_idempotency_key is not null and verification_command_id is not null)
    or (status <> 'completed' and completed_session_id is null)
  )
);

create unique index uidx_backoffice_authentication_attempts_open_account
  on identity.backoffice_authentication_attempts (access_account_id)
  where status in ('pending_enrollment', 'pending_challenge');
create index idx_backoffice_authentication_attempts_expiration
  on identity.backoffice_authentication_attempts (expires_at, id)
  where status in ('pending_enrollment', 'pending_challenge');

create table identity.mfa_factor_recovery_events (
  id uuid default extensions.uuid_generate_v7(),
  factor_id uuid not null,
  subject_person_id uuid not null,
  requested_by_person_id uuid not null,
  approved_by_person_id uuid not null,
  reason_code text not null,
  ceremony_reference text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint pk_mfa_factor_recovery_events primary key (id),
  constraint fk_mfa_factor_recovery_events_factor foreign key (factor_id) references identity.access_account_mfa_factors(id) on delete restrict,
  constraint fk_mfa_factor_recovery_events_subject foreign key (subject_person_id) references identity.people(id) on delete restrict,
  constraint fk_mfa_factor_recovery_events_requester foreign key (requested_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_mfa_factor_recovery_events_approver foreign key (approved_by_person_id) references identity.people(id) on delete restrict,
  constraint ck_mfa_factor_recovery_events_people check (
    requested_by_person_id <> approved_by_person_id
    and requested_by_person_id <> subject_person_id
    and approved_by_person_id <> subject_person_id
  ),
  constraint ck_mfa_factor_recovery_events_reason check (reason_code = 'lost_authenticator'),
  constraint ck_mfa_factor_recovery_events_reference check (btrim(ceremony_reference) <> '')
);

create index idx_mfa_factor_recovery_events_factor_occurred
  on identity.mfa_factor_recovery_events (factor_id, occurred_at desc, id desc);

create table support.platform_role_assignments (
  id uuid default extensions.uuid_generate_v7(),
  person_id uuid not null,
  platform_role text not null,
  status text not null default 'active',
  granted_by_person_id uuid not null,
  granted_at timestamptz not null default clock_timestamp(),
  revoked_by_person_id uuid,
  revoked_at timestamptz,
  constraint pk_platform_role_assignments primary key (id),
  constraint fk_platform_role_assignments_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_role_assignments_grantor foreign key (granted_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_role_assignments_revoker foreign key (revoked_by_person_id) references identity.people(id) on delete restrict,
  constraint ck_platform_role_assignments_role check (platform_role = 'allfit_admin'),
  constraint ck_platform_role_assignments_status check (status in ('active', 'revoked')),
  constraint ck_platform_role_assignments_no_self_grant check (granted_by_person_id <> person_id),
  constraint ck_platform_role_assignments_no_self_revoke check (
    revoked_by_person_id is null or revoked_by_person_id <> person_id
  ),
  constraint ck_platform_role_assignments_revocation check (
    (status = 'active' and revoked_at is null and revoked_by_person_id is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by_person_id is not null)
  )
);

create unique index uidx_platform_role_assignments_active
  on support.platform_role_assignments (person_id, platform_role)
  where status = 'active';
create index idx_platform_role_assignments_person_status
  on support.platform_role_assignments (person_id, status);
create index idx_platform_role_assignments_role_status
  on support.platform_role_assignments (platform_role, status);

create table support.platform_duty_assignments (
  id uuid default extensions.uuid_generate_v7(),
  person_id uuid not null,
  duty_code text not null,
  actor_mode text not null,
  status text not null,
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  required_aal smallint not null default 2,
  granted_by_person_id uuid not null,
  recertified_by_person_id uuid,
  recertified_at timestamptz,
  suspended_by_person_id uuid,
  suspended_at timestamptz,
  revoked_by_person_id uuid,
  revoked_at timestamptz,
  reason_code text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_platform_duty_assignments primary key (id),
  constraint fk_platform_duty_assignments_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_duty_assignments_grantor foreign key (granted_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_duty_assignments_recertifier foreign key (recertified_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_duty_assignments_suspender foreign key (suspended_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_duty_assignments_revoker foreign key (revoked_by_person_id) references identity.people(id) on delete restrict,
  constraint ck_platform_duty_assignments_duty check (duty_code in (
    'view_platform_metrics', 'diagnose_support_metadata', 'view_billing_metadata',
    'manage_organization_lifecycle', 'request_break_glass', 'verify_professional_credentials',
    'curate_global_catalog', 'manage_platform_commercial', 'manage_platform_access',
    'audit_platform_access', 'approve_break_glass', 'audit_break_glass',
    'manage_privacy_requests'
  )),
  constraint ck_platform_duty_assignments_actor_mode check (
    actor_mode = case
      when duty_code in ('curate_global_catalog', 'verify_professional_credentials') then 'A11'
      when duty_code in ('manage_platform_access', 'audit_platform_access', 'approve_break_glass',
        'audit_break_glass', 'manage_privacy_requests') then 'A12'
      else 'A10'
    end
  ),
  constraint ck_platform_duty_assignments_status check (
    status in ('scheduled', 'active', 'suspended', 'expired', 'revoked')
  ),
  constraint ck_platform_duty_assignments_window check (
    valid_to > valid_from and valid_to <= valid_from + interval '90 days'
  ),
  constraint ck_platform_duty_assignments_aal check (required_aal = 2),
  constraint ck_platform_duty_assignments_no_self_action check (
    granted_by_person_id <> person_id
    and (recertified_by_person_id is null or recertified_by_person_id <> person_id)
    and (suspended_by_person_id is null or suspended_by_person_id <> person_id)
    and (revoked_by_person_id is null or revoked_by_person_id <> person_id)
  ),
  constraint ck_platform_duty_assignments_reason check (btrim(reason_code) <> '')
);

create unique index uidx_platform_duty_assignments_current
  on support.platform_duty_assignments (person_id, duty_code)
  where status in ('scheduled', 'active', 'suspended');
create index idx_platform_duty_assignments_person_status_expiry
  on support.platform_duty_assignments (person_id, status, valid_to);
create index idx_platform_duty_assignments_duty_status_expiry
  on support.platform_duty_assignments (duty_code, status, valid_to);
create index idx_platform_duty_assignments_status_expiry
  on support.platform_duty_assignments (status, valid_to);

alter table identity.access_account_mfa_factors owner to allfit_owner;
alter table identity.backoffice_authentication_attempts owner to allfit_owner;
alter table identity.mfa_factor_recovery_events owner to allfit_owner;
alter table support.platform_role_assignments owner to allfit_owner;
alter table support.platform_duty_assignments owner to allfit_owner;

create trigger trg_access_account_mfa_factors_update_set_updated_at
before update on identity.access_account_mfa_factors
for each row execute function access_control.set_updated_at();

create trigger trg_backoffice_authentication_attempts_update_set_updated_at
before update on identity.backoffice_authentication_attempts
for each row execute function access_control.set_updated_at();

create trigger trg_platform_duty_assignments_update_set_updated_at
before update on support.platform_duty_assignments
for each row execute function access_control.set_updated_at();

alter table identity.access_account_mfa_factors enable row level security;
alter table identity.access_account_mfa_factors force row level security;
alter table identity.backoffice_authentication_attempts enable row level security;
alter table identity.backoffice_authentication_attempts force row level security;
alter table identity.mfa_factor_recovery_events enable row level security;
alter table identity.mfa_factor_recovery_events force row level security;
alter table support.platform_role_assignments enable row level security;
alter table support.platform_role_assignments force row level security;
alter table support.platform_duty_assignments enable row level security;
alter table support.platform_duty_assignments force row level security;

create policy access_account_mfa_factors_all_owner on identity.access_account_mfa_factors
  for all to allfit_owner using (true) with check (true);
create policy backoffice_authentication_attempts_all_owner on identity.backoffice_authentication_attempts
  for all to allfit_owner using (true) with check (true);
create policy mfa_factor_recovery_events_all_owner on identity.mfa_factor_recovery_events
  for all to allfit_owner using (true) with check (true);
create policy platform_role_assignments_all_owner on support.platform_role_assignments
  for all to allfit_owner using (true) with check (true);
create policy platform_duty_assignments_all_owner on support.platform_duty_assignments
  for all to allfit_owner using (true) with check (true);

revoke all on identity.access_account_mfa_factors from public, allfit_api;
revoke all on identity.backoffice_authentication_attempts from public, allfit_api;
revoke all on identity.mfa_factor_recovery_events from public, allfit_api;
revoke all on support.platform_role_assignments from public, allfit_api;
revoke all on support.platform_duty_assignments from public, allfit_api;
