-- Closed Backoffice authentication lifecycle, platform authority and provider cleanup outbox.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Protected workflows connect with the provider-owned administrative login,
-- then deliberately narrow themselves to allfit_migrator. Hosted Supabase
-- requires explicit membership for SET ROLE; allfit_api receives no membership.
do $ceremony_role$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres') then
    grant allfit_migrator to postgres;
  end if;
end
$ceremony_role$;

create or replace function access_control.has_platform_duty(
  p_person_id uuid,
  p_session_id uuid,
  p_duty_code text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from identity.access_sessions as session
    join identity.access_accounts as account
      on account.id = session.access_account_id
    join identity.people as person
      on person.id = account.person_id
    join support.platform_role_assignments as role_assignment
      on role_assignment.person_id = person.id
     and role_assignment.platform_role = 'allfit_admin'
     and role_assignment.status = 'active'
    join support.platform_duty_assignments as duty_assignment
      on duty_assignment.person_id = person.id
     and duty_assignment.duty_code = p_duty_code
     and duty_assignment.status = 'active'
     and clock_timestamp() >= duty_assignment.valid_from
     and clock_timestamp() < duty_assignment.valid_to
     and duty_assignment.required_aal <= session.assurance_level
    where person.id = p_person_id
      and person.status = 'active'
      and session.id = p_session_id
      and session.surface = 'backoffice'::identity.access_session_surface
      and session.assurance_level = 2
      and session.authentication_method = 'password_totp'
      and session.revoked_at is null
      and session.absolute_expires_at > clock_timestamp()
      and session.last_activity_at > clock_timestamp() - interval '15 minutes'
  )
$function$;

create or replace function identity.resolve_backoffice_account(
  p_provider text,
  p_issuer text,
  p_subject text
)
returns table (
  account_id uuid,
  person_id uuid,
  given_name text,
  family_name text,
  factor_id uuid,
  provider_factor_id text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    account.id,
    person.id,
    person.given_name,
    person.family_name,
    factor.id,
    factor.provider_factor_id
  from identity.access_accounts as account
  join identity.people as person
    on person.id = account.person_id
   and person.status = 'active'
  join support.platform_role_assignments as role_assignment
    on role_assignment.person_id = person.id
   and role_assignment.platform_role = 'allfit_admin'
   and role_assignment.status = 'active'
  left join identity.access_account_mfa_factors as factor
    on factor.access_account_id = account.id
   and factor.factor_kind = 'totp'
   and factor.status = 'active'
  where p_provider = 'workos'
    and account.provider = p_provider
    and account.issuer = p_issuer
    and account.subject = p_subject
$function$;

create or replace function identity.start_backoffice_authentication_attempt(
  p_access_account_id uuid,
  p_provider_factor_id text,
  p_new_factor boolean,
  p_provider_session_id text,
  p_provider_challenge_id text,
  p_attempt_token_hash bytea,
  p_secret_ciphertext text,
  p_access_token_expires_at timestamptz,
  p_status identity.backoffice_authentication_attempt_status,
  p_expires_at timestamptz
)
returns table (
  attempt_id uuid,
  factor_id uuid,
  status identity.backoffice_authentication_attempt_status,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_person_id uuid;
  v_factor_id uuid;
  previous_attempt record;
  v_attempt_id uuid;
begin
  if p_access_account_id is null
    or btrim(p_provider_factor_id) = ''
    or btrim(p_provider_session_id) = ''
    or btrim(p_provider_challenge_id) = ''
    or octet_length(p_attempt_token_hash) <> 32
    or p_secret_ciphertext not like 'v1.%'
    or p_access_token_expires_at is null
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '10 minutes 5 seconds'
    or (p_new_factor and p_status <> 'pending_enrollment')
    or (not p_new_factor and p_status <> 'pending_challenge') then
    raise exception 'invalid backoffice authentication attempt' using errcode = '22023';
  end if;

  select account.person_id into v_person_id
  from identity.access_accounts as account
  join identity.people as person on person.id = account.person_id and person.status = 'active'
  join support.platform_role_assignments as role_assignment
    on role_assignment.person_id = person.id
   and role_assignment.platform_role = 'allfit_admin'
   and role_assignment.status = 'active'
  where account.id = p_access_account_id
  for update of account;

  if v_person_id is null then
    raise exception 'backoffice account is not eligible' using errcode = '28000';
  end if;

  for previous_attempt in
    select attempt.id, attempt.factor_id
    from identity.backoffice_authentication_attempts as attempt
    where attempt.access_account_id = p_access_account_id
      and attempt.status in ('pending_enrollment', 'pending_challenge')
    for update
  loop
    update identity.backoffice_authentication_attempts
    set status = 'expired', terminal_at = clock_timestamp(), secret_ciphertext = null
    where id = previous_attempt.id;

    update identity.access_account_mfa_factors as factor
    set status = 'superseded', superseded_at = clock_timestamp()
    where factor.id = previous_attempt.factor_id and factor.status = 'pending';

    perform system.enqueue_outbox_event(
      'backoffice_auth_attempt',
      previous_attempt.id,
      'identity.backoffice_auth_cleanup_requested.v1',
      jsonb_build_object('attempt_id', previous_attempt.id)
    );
  end loop;

  if p_new_factor then
    insert into identity.access_account_mfa_factors (
      access_account_id, provider_factor_id, status
    ) values (
      p_access_account_id, p_provider_factor_id, 'pending'
    ) returning id into v_factor_id;
  else
    select factor.id into v_factor_id
    from identity.access_account_mfa_factors as factor
    where factor.access_account_id = p_access_account_id
      and factor.provider_factor_id = p_provider_factor_id
      and factor.factor_kind = 'totp'
      and factor.status = 'active'
    for update;
    if v_factor_id is null then
      raise exception 'active factor not found' using errcode = '28000';
    end if;
  end if;

  insert into identity.backoffice_authentication_attempts (
    access_account_id,
    factor_id,
    provider_session_id,
    provider_challenge_id,
    attempt_token_hash,
    secret_ciphertext,
    access_token_expires_at,
    status,
    expires_at
  ) values (
    p_access_account_id,
    v_factor_id,
    p_provider_session_id,
    p_provider_challenge_id,
    p_attempt_token_hash,
    p_secret_ciphertext,
    p_access_token_expires_at,
    p_status,
    p_expires_at
  ) returning id into v_attempt_id;

  return query select v_attempt_id, v_factor_id, p_status, p_expires_at;
end
$function$;

create or replace function identity.load_backoffice_authentication_attempt(p_attempt_token_hash bytea)
returns table (
  attempt_id uuid,
  account_id uuid,
  person_id uuid,
  external_subject text,
  given_name text,
  family_name text,
  factor_id uuid,
  factor_status identity.mfa_factor_status,
  provider_factor_id text,
  provider_session_id text,
  provider_challenge_id text,
  secret_ciphertext text,
  access_token_expires_at timestamptz,
  attempt_status identity.backoffice_authentication_attempt_status,
  invalid_code_count smallint,
  verification_idempotency_key uuid,
  verification_command_id uuid,
  completed_session_id uuid,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    attempt.id,
    attempt.access_account_id,
    person.id,
    account.subject,
    person.given_name,
    person.family_name,
    factor.id,
    factor.status,
    factor.provider_factor_id,
    attempt.provider_session_id,
    attempt.provider_challenge_id,
    attempt.secret_ciphertext,
    attempt.access_token_expires_at,
    attempt.status,
    attempt.invalid_code_count,
    attempt.verification_idempotency_key,
    attempt.verification_command_id,
    attempt.completed_session_id,
    attempt.expires_at
  from identity.backoffice_authentication_attempts as attempt
  join identity.access_accounts as account on account.id = attempt.access_account_id
  join identity.people as person on person.id = account.person_id and person.status = 'active'
  join support.platform_role_assignments as role_assignment
    on role_assignment.person_id = person.id
   and role_assignment.platform_role = 'allfit_admin'
   and role_assignment.status = 'active'
  join identity.access_account_mfa_factors as factor on factor.id = attempt.factor_id
  where attempt.attempt_token_hash = p_attempt_token_hash
    and attempt.status in ('pending_enrollment', 'pending_challenge', 'completed')
    and attempt.expires_at > clock_timestamp()
$function$;

create or replace function identity.record_backoffice_totp_failure(p_attempt_token_hash bytea)
returns table (remaining_attempts smallint, terminal boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.backoffice_authentication_attempts%rowtype;
  v_count smallint;
  v_terminal boolean;
begin
  select * into target
  from identity.backoffice_authentication_attempts
  where attempt_token_hash = p_attempt_token_hash
  for update;

  if target.id is null
    or target.status not in ('pending_enrollment', 'pending_challenge')
    or target.expires_at <= clock_timestamp() then
    raise exception 'authentication attempt not available' using errcode = '28000';
  end if;

  v_count := least(target.invalid_code_count + 1, 5);
  v_terminal := v_count >= 5;
  update identity.backoffice_authentication_attempts
  set invalid_code_count = v_count,
      status = case when v_terminal then 'failed' else status end,
      terminal_at = case when v_terminal then clock_timestamp() else terminal_at end,
      secret_ciphertext = case when v_terminal then null else secret_ciphertext end,
      -- WorkOS has conclusively rejected this code, so a later code is a new
      -- command. Provider/network uncertainty never reaches this function and
      -- deliberately keeps the existing command binding for a safe retry.
      verification_idempotency_key = case
        when v_terminal then verification_idempotency_key
        else null
      end,
      verification_command_id = case
        when v_terminal then verification_command_id
        else null
      end
  where id = target.id;

  if v_terminal then
    update identity.access_account_mfa_factors as factor
    set status = 'superseded', superseded_at = clock_timestamp()
    where factor.id = target.factor_id and factor.status = 'pending';
    perform system.enqueue_outbox_event(
      'backoffice_auth_attempt', target.id, 'identity.backoffice_auth_cleanup_requested.v1',
      jsonb_build_object('attempt_id', target.id)
    );
  end if;

  return query select (5 - v_count)::smallint, v_terminal;
end
$function$;

create or replace function identity.bind_backoffice_totp_verification(
  p_attempt_token_hash bytea,
  p_idempotency_key uuid,
  p_command_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.backoffice_authentication_attempts%rowtype;
begin
  if p_idempotency_key is null or p_command_id is null then
    raise exception 'invalid verification command' using errcode = '22023';
  end if;
  select * into target
  from identity.backoffice_authentication_attempts
  where attempt_token_hash = p_attempt_token_hash
  for update;
  if target.id is null
    or target.status not in ('pending_enrollment', 'pending_challenge', 'completed')
    or (target.status <> 'completed' and target.expires_at <= clock_timestamp()) then
    raise exception 'authentication attempt not available' using errcode = '28000';
  end if;
  if target.verification_idempotency_key is not null
    and (target.verification_idempotency_key <> p_idempotency_key
      or target.verification_command_id <> p_command_id) then
    raise exception 'verification command conflicts with prior attempt' using errcode = '23505';
  end if;
  update identity.backoffice_authentication_attempts
  set verification_idempotency_key = p_idempotency_key,
      verification_command_id = p_command_id
  where id = target.id and verification_idempotency_key is null;
end
$function$;

create or replace function identity.complete_backoffice_authentication(
  p_attempt_token_hash bytea,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_session_token_hash bytea,
  p_session_token_ciphertext text,
  p_access_token_expires_at timestamptz
)
returns table (session_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.backoffice_authentication_attempts%rowtype;
  v_person_id uuid;
  v_session_id uuid;
begin
  if p_idempotency_key is null or p_command_id is null
    or octet_length(p_session_token_hash) <> 32
    or p_session_token_ciphertext not like 'v1.%'
    or p_access_token_expires_at is null then
    raise exception 'invalid verification command' using errcode = '22023';
  end if;

  select * into target
  from identity.backoffice_authentication_attempts
  where attempt_token_hash = p_attempt_token_hash
  for update;

  if target.id is null then
    raise exception 'authentication attempt not found' using errcode = '28000';
  end if;

  if target.status = 'completed' then
    if target.verification_idempotency_key <> p_idempotency_key
      or target.verification_command_id <> p_command_id then
      raise exception 'authentication attempt already completed' using errcode = '23505';
    end if;
    return query select target.completed_session_id, true;
    return;
  end if;

  if target.status not in ('pending_enrollment', 'pending_challenge')
    or target.expires_at <= clock_timestamp()
    or target.invalid_code_count >= 5 then
    raise exception 'authentication attempt not available' using errcode = '28000';
  end if;

  select person.id into v_person_id
  from identity.access_accounts as account
  join identity.people as person on person.id = account.person_id and person.status = 'active'
  join support.platform_role_assignments as role_assignment
    on role_assignment.person_id = person.id
   and role_assignment.platform_role = 'allfit_admin'
   and role_assignment.status = 'active'
  where account.id = target.access_account_id
  for update of account, person, role_assignment;

  if v_person_id is null then
    raise exception 'backoffice account is no longer eligible' using errcode = '28000';
  end if;

  update identity.access_account_mfa_factors as factor
  set status = 'active', verified_at = coalesce(factor.verified_at, clock_timestamp())
  where factor.id = target.factor_id and factor.status = 'pending';

  if not exists (
    select 1 from identity.access_account_mfa_factors as factor
    where factor.id = target.factor_id and factor.status = 'active'
  ) then
    raise exception 'authentication factor is not active' using errcode = '28000';
  end if;

  insert into identity.access_sessions (
    access_account_id,
    provider_session_id,
    surface,
    token_hash,
    token_ciphertext,
    access_token_expires_at,
    assurance_level,
    authentication_method,
    assurance_verified_at,
    last_activity_at,
    absolute_expires_at
  ) values (
    target.access_account_id,
    target.provider_session_id,
    'backoffice',
    p_session_token_hash,
    p_session_token_ciphertext,
    p_access_token_expires_at,
    2,
    'password_totp',
    clock_timestamp(),
    clock_timestamp(),
    clock_timestamp() + interval '8 hours'
  )
  on conflict (surface, provider_session_id) do update
  set token_hash = excluded.token_hash,
      token_ciphertext = excluded.token_ciphertext,
      access_token_expires_at = excluded.access_token_expires_at,
      assurance_level = 2,
      authentication_method = 'password_totp',
      assurance_verified_at = excluded.assurance_verified_at,
      last_activity_at = excluded.last_activity_at,
      absolute_expires_at = excluded.absolute_expires_at,
      token_version = identity.access_sessions.token_version + 1,
      revoked_at = null
  returning id into v_session_id;

  update identity.backoffice_authentication_attempts
  set status = 'completed',
      terminal_at = clock_timestamp(),
      secret_ciphertext = null,
      verification_idempotency_key = p_idempotency_key,
      verification_command_id = p_command_id,
      completed_session_id = v_session_id
  where id = target.id;

  perform system.enqueue_outbox_event(
    'access_session', v_session_id, 'identity.backoffice_authenticated.v1',
    jsonb_build_object('session_id', v_session_id, 'assurance_level', 2)
  );

  return query select v_session_id, false;
end
$function$;

create or replace function identity.load_backoffice_access_session(p_token_hash bytea)
returns table (
  session_id uuid,
  account_id uuid,
  person_id uuid,
  external_subject text,
  provider_session_id text,
  token_ciphertext text,
  access_token_expires_at timestamptz,
  token_version integer,
  given_name text,
  family_name text,
  assurance_level smallint,
  authentication_method text,
  assurance_verified_at timestamptz,
  last_activity_at timestamptz,
  absolute_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.access_sessions%rowtype;
begin
  select * into target
  from identity.access_sessions
  where token_hash = p_token_hash
    and surface = 'backoffice'
  for update;

  if target.id is null or target.revoked_at is not null then return; end if;

  if target.assurance_level <> 2
    or target.authentication_method <> 'password_totp'
    or target.absolute_expires_at <= clock_timestamp()
    or target.last_activity_at <= clock_timestamp() - interval '15 minutes'
    or not exists (
      select 1
      from identity.access_accounts as account
      join identity.people as person on person.id = account.person_id and person.status = 'active'
      join support.platform_role_assignments as role_assignment
        on role_assignment.person_id = person.id
       and role_assignment.platform_role = 'allfit_admin'
       and role_assignment.status = 'active'
      where account.id = target.access_account_id
    ) then
    update identity.access_sessions set revoked_at = coalesce(revoked_at, clock_timestamp())
    where id = target.id;
    perform system.enqueue_outbox_event(
      'access_session', target.id, 'identity.backoffice_session_revocation_requested.v1',
      jsonb_build_object('session_id', target.id)
    );
    return;
  end if;

  update identity.access_sessions
  set last_activity_at = clock_timestamp()
  where id = target.id
  returning * into target;

  return query
  select
    target.id,
    target.access_account_id,
    person.id,
    account.subject,
    target.provider_session_id,
    target.token_ciphertext,
    target.access_token_expires_at,
    target.token_version,
    person.given_name,
    person.family_name,
    target.assurance_level,
    target.authentication_method,
    target.assurance_verified_at,
    target.last_activity_at,
    target.absolute_expires_at
  from identity.access_accounts as account
  join identity.people as person on person.id = account.person_id
  where account.id = target.access_account_id;
end
$function$;

create or replace function identity.logout_backoffice_access_session(p_token_hash bytea)
returns table (outcome text, provider_session_id text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.access_sessions%rowtype;
begin
  select * into target
  from identity.access_sessions
  where token_hash = p_token_hash and surface = 'backoffice'
  for update;

  if target.id is null then
    return query select 'already-absent'::text, null::text;
    return;
  end if;

  if target.revoked_at is null then
    update identity.access_sessions set revoked_at = clock_timestamp() where id = target.id;
    perform system.enqueue_outbox_event(
      'access_session', target.id, 'identity.backoffice_session_revocation_requested.v1',
      jsonb_build_object('session_id', target.id)
    );
    return query select 'revoked'::text, target.provider_session_id;
  else
    return query select 'already-absent'::text, target.provider_session_id;
  end if;
end
$function$;

create or replace function identity.expire_backoffice_authentication_attempts(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
  expired_count integer := 0;
begin
  if access_control.actor_kind() <> 'worker' or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid backoffice attempt expiration' using errcode = '42501';
  end if;

  for target in
    select attempt.id, attempt.factor_id
    from identity.backoffice_authentication_attempts as attempt
    where attempt.status in ('pending_enrollment', 'pending_challenge')
      and attempt.expires_at <= clock_timestamp()
    order by attempt.expires_at, attempt.id
    limit p_limit
    for update skip locked
  loop
    update identity.backoffice_authentication_attempts
    set status = 'expired', terminal_at = clock_timestamp(), secret_ciphertext = null
    where id = target.id;
    update identity.access_account_mfa_factors as factor
    set status = 'superseded', superseded_at = clock_timestamp()
    where factor.id = target.factor_id and factor.status = 'pending';
    perform system.enqueue_outbox_event(
      'backoffice_auth_attempt', target.id, 'identity.backoffice_auth_cleanup_requested.v1',
      jsonb_build_object('attempt_id', target.id)
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end
$function$;

create or replace function identity.prepare_backoffice_auth_cleanup(p_event_id uuid)
returns table (
  cleanup_state text,
  provider_session_id text,
  provider_factor_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_event system.outbox_events%rowtype;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker context required' using errcode = '42501';
  end if;
  select * into target_event from system.outbox_events where id = p_event_id;
  if target_event.id is null then
    return query select 'skipped'::text, null::text, null::text;
  elsif target_event.event_type = 'identity.backoffice_auth_cleanup_requested.v1' then
    return query
    select 'ready'::text,
      attempt.provider_session_id,
      case when factor.status in ('superseded', 'revoked') then factor.provider_factor_id end
    from identity.backoffice_authentication_attempts as attempt
    join identity.access_account_mfa_factors as factor on factor.id = attempt.factor_id
    where attempt.id = target_event.aggregate_id;
  elsif target_event.event_type = 'identity.backoffice_session_revocation_requested.v1' then
    return query
    select 'ready'::text, session.provider_session_id, null::text
    from identity.access_sessions as session
    where session.id = target_event.aggregate_id;
  elsif target_event.event_type = 'identity.backoffice_factor_cleanup_requested.v1' then
    return query
    select 'ready'::text, null::text, factor.provider_factor_id
    from identity.access_account_mfa_factors as factor
    where factor.id = target_event.aggregate_id and factor.status = 'revoked';
  else
    return query select 'skipped'::text, null::text, null::text;
  end if;
end
$function$;

create or replace function support.prevent_last_platform_administrator_revocation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if old.status = 'active' and new.status = 'revoked'
    and not exists (
      select 1 from support.platform_role_assignments
      where platform_role = 'allfit_admin' and status = 'active' and id <> old.id
    ) then
    raise exception 'cannot revoke the last platform administrator' using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function support.close_revoked_platform_access()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
begin
  if old.status = 'active' and new.status = 'revoked' then
    update support.platform_duty_assignments
    set status = 'revoked', revoked_by_person_id = new.revoked_by_person_id,
        revoked_at = new.revoked_at
    where person_id = new.person_id and status in ('scheduled', 'active', 'suspended');

    for target in
      update identity.access_sessions as session
      set revoked_at = clock_timestamp()
      from identity.access_accounts as account
      where account.person_id = new.person_id
        and session.access_account_id = account.id
        and session.surface = 'backoffice'
        and session.revoked_at is null
      returning session.id
    loop
      perform system.enqueue_outbox_event(
        'access_session', target.id, 'identity.backoffice_session_revocation_requested.v1',
        jsonb_build_object('session_id', target.id)
      );
    end loop;

    for target in
      update identity.backoffice_authentication_attempts as attempt
      set status = 'failed', terminal_at = clock_timestamp(), secret_ciphertext = null
      from identity.access_accounts as account
      where account.person_id = new.person_id
        and attempt.access_account_id = account.id
        and attempt.status in ('pending_enrollment', 'pending_challenge')
      returning attempt.id, attempt.factor_id
    loop
      update identity.access_account_mfa_factors as factor
      set status = 'superseded', superseded_at = clock_timestamp()
      where factor.id = target.factor_id and factor.status = 'pending';
      perform system.enqueue_outbox_event(
        'backoffice_auth_attempt', target.id, 'identity.backoffice_auth_cleanup_requested.v1',
        jsonb_build_object('attempt_id', target.id)
      );
    end loop;
  end if;
  return new;
end
$function$;

create trigger trg_platform_role_assignments_update_last_admin
before update on support.platform_role_assignments
for each row execute function support.prevent_last_platform_administrator_revocation();

create trigger trg_platform_role_assignments_update_close_access
after update on support.platform_role_assignments
for each row execute function support.close_revoked_platform_access();

create or replace function support.require_active_platform_role_for_duty()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if new.status in ('scheduled', 'active', 'suspended') and not exists (
    select 1 from support.platform_role_assignments
    where person_id = new.person_id and platform_role = 'allfit_admin' and status = 'active'
  ) then
    raise exception 'platform duty requires an active base role' using errcode = '23514';
  end if;
  return null;
end
$function$;

create constraint trigger trg_platform_duty_assignments_change_require_role
after insert or update on support.platform_duty_assignments
deferrable initially deferred
for each row execute function support.require_active_platform_role_for_duty();

create or replace function support.bootstrap_backoffice_administrators(
  p_person_a uuid,
  p_subject_a text,
  p_person_b uuid,
  p_subject_b text,
  p_issuer text,
  p_valid_to timestamptz,
  p_ceremony_reference text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  role_id uuid;
  duty_id uuid;
  account_a uuid;
  account_b uuid;
begin
  if p_person_a is null or p_person_b is null or p_person_a = p_person_b
    or btrim(p_subject_a) = '' or btrim(p_subject_b) = '' or p_subject_a = p_subject_b
    or btrim(p_issuer) = ''
    or btrim(p_ceremony_reference) = ''
    or p_valid_to <= clock_timestamp()
    or p_valid_to > clock_timestamp() + interval '90 days'
    or not exists (
      select 1 from identity.people as person
      where person.id = p_person_a and person.status = 'active'
    )
    or not exists (
      select 1 from identity.people as person
      where person.id = p_person_b and person.status = 'active'
    ) then
    raise exception 'invalid Backoffice bootstrap ceremony' using errcode = '22023';
  end if;

  select id into account_a from identity.access_accounts
  where provider = 'workos' and issuer = p_issuer and subject = p_subject_a
    and (person_id is null or person_id = p_person_a)
  for update;
  select id into account_b from identity.access_accounts
  where provider = 'workos' and issuer = p_issuer and subject = p_subject_b
    and (person_id is null or person_id = p_person_b)
  for update;
  if account_a is null or account_b is null then
    raise exception 'Backoffice bootstrap account mismatch' using errcode = '28000';
  end if;
  update identity.access_accounts set person_id = p_person_a where id = account_a;
  update identity.access_accounts set person_id = p_person_b where id = account_b;

  insert into support.platform_role_assignments (person_id, platform_role, granted_by_person_id)
  values (p_person_a, 'allfit_admin', p_person_b)
  returning id into role_id;
  perform system.enqueue_outbox_event('platform_role_assignment', role_id,
    'support.platform_role_granted.v1', jsonb_build_object('assignment_id', role_id));

  insert into support.platform_role_assignments (person_id, platform_role, granted_by_person_id)
  values (p_person_b, 'allfit_admin', p_person_a)
  returning id into role_id;
  perform system.enqueue_outbox_event('platform_role_assignment', role_id,
    'support.platform_role_granted.v1', jsonb_build_object('assignment_id', role_id));

  insert into support.platform_duty_assignments (
    person_id, duty_code, actor_mode, status, valid_from, valid_to,
    granted_by_person_id, reason_code
  ) values (
    p_person_a, 'manage_platform_access', 'A12', 'active', clock_timestamp(), p_valid_to,
    p_person_b, 'bootstrap:' || p_ceremony_reference
  ) returning id into duty_id;
  perform system.enqueue_outbox_event('platform_duty_assignment', duty_id,
    'support.platform_duty_granted.v1', jsonb_build_object('assignment_id', duty_id));

  insert into support.platform_duty_assignments (
    person_id, duty_code, actor_mode, status, valid_from, valid_to,
    granted_by_person_id, reason_code
  ) values (
    p_person_b, 'manage_platform_access', 'A12', 'active', clock_timestamp(), p_valid_to,
    p_person_a, 'bootstrap:' || p_ceremony_reference
  ) returning id into duty_id;
  perform system.enqueue_outbox_event('platform_duty_assignment', duty_id,
    'support.platform_duty_granted.v1', jsonb_build_object('assignment_id', duty_id));
end
$function$;

create or replace function identity.recover_backoffice_totp_factor(
  p_subject_person_id uuid,
  p_requested_by_person_id uuid,
  p_approved_by_person_id uuid,
  p_ceremony_reference text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_factor identity.access_account_mfa_factors%rowtype;
  target record;
begin
  if p_subject_person_id is null or p_requested_by_person_id is null or p_approved_by_person_id is null
    or p_subject_person_id in (p_requested_by_person_id, p_approved_by_person_id)
    or p_requested_by_person_id = p_approved_by_person_id
    or btrim(p_ceremony_reference) = ''
    or not exists (
      select 1 from support.platform_duty_assignments
      where person_id = p_requested_by_person_id and duty_code = 'manage_platform_access'
        and status = 'active' and clock_timestamp() between valid_from and valid_to
    )
    or not exists (
      select 1 from support.platform_duty_assignments
      where person_id = p_approved_by_person_id and duty_code = 'manage_platform_access'
        and status = 'active' and clock_timestamp() between valid_from and valid_to
    ) then
    raise exception 'invalid TOTP recovery ceremony' using errcode = '42501';
  end if;

  select factor.* into target_factor
  from identity.access_account_mfa_factors as factor
  join identity.access_accounts as account on account.id = factor.access_account_id
  where account.person_id = p_subject_person_id and factor.status = 'active'
  for update of factor;
  if target_factor.id is null then
    raise exception 'active TOTP factor not found' using errcode = 'P0002';
  end if;

  update identity.access_account_mfa_factors
  set status = 'revoked', revoked_at = clock_timestamp()
  where id = target_factor.id;
  insert into identity.mfa_factor_recovery_events (
    factor_id, subject_person_id, requested_by_person_id, approved_by_person_id,
    reason_code, ceremony_reference
  ) values (
    target_factor.id, p_subject_person_id, p_requested_by_person_id, p_approved_by_person_id,
    'lost_authenticator', p_ceremony_reference
  );
  perform system.enqueue_outbox_event(
    'authentication_factor', target_factor.id, 'identity.backoffice_factor_cleanup_requested.v1',
    jsonb_build_object('factor_id', target_factor.id)
  );

  for target in
    update identity.access_sessions as session
    set revoked_at = clock_timestamp()
    where session.access_account_id = target_factor.access_account_id
      and session.surface = 'backoffice' and session.revoked_at is null
    returning session.id
  loop
    perform system.enqueue_outbox_event(
      'access_session', target.id, 'identity.backoffice_session_revocation_requested.v1',
      jsonb_build_object('session_id', target.id)
    );
  end loop;

  for target in
    update identity.backoffice_authentication_attempts
    set status = 'failed', terminal_at = clock_timestamp(), secret_ciphertext = null
    where access_account_id = target_factor.access_account_id
      and status in ('pending_enrollment', 'pending_challenge')
    returning id
  loop
    perform system.enqueue_outbox_event(
      'backoffice_auth_attempt', target.id, 'identity.backoffice_auth_cleanup_requested.v1',
      jsonb_build_object('attempt_id', target.id)
    );
  end loop;
  return target_factor.id;
end
$function$;

create or replace function identity.process_password_reset_succeeded(
  p_provider text,
  p_issuer text,
  p_provider_event_id text,
  p_subject text,
  p_occurred_at timestamptz
)
returns table (outcome text, revoked_session_count integer, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_receipt_id uuid;
  v_access_account_id uuid;
  v_result identity.password_reset_receipt_result;
  v_revoked_session_count integer := 0;
  target record;
begin
  if p_provider <> 'workos' or btrim(p_issuer) = '' or btrim(p_provider_event_id) = ''
    or btrim(p_subject) = '' or p_occurred_at is null then
    raise exception 'invalid password reset event' using errcode = '22023';
  end if;
  insert into identity.password_reset_receipts (provider, issuer, provider_event_id, occurred_at)
  values (p_provider, p_issuer, p_provider_event_id, p_occurred_at)
  on conflict (provider, issuer, provider_event_id) do nothing
  returning id into v_receipt_id;
  if v_receipt_id is null then
    select receipt.result, receipt.revoked_session_count into v_result, v_revoked_session_count
    from identity.password_reset_receipts as receipt
    where receipt.provider = p_provider and receipt.issuer = p_issuer
      and receipt.provider_event_id = p_provider_event_id;
    if v_result is null then raise exception 'password reset receipt did not finish' using errcode = '40001'; end if;
    return query select v_result::text, v_revoked_session_count, true;
    return;
  end if;
  select account.id into v_access_account_id
  from identity.access_accounts as account
  where account.provider = p_provider and account.issuer = p_issuer and account.subject = p_subject;
  if v_access_account_id is null then
    v_result := 'account_absent';
  else
    for target in
      update identity.access_sessions as session
      set revoked_at = clock_timestamp()
      where session.access_account_id = v_access_account_id and session.revoked_at is null
        and session.created_at <= p_occurred_at
      returning session.id, session.surface
    loop
      v_revoked_session_count := v_revoked_session_count + 1;
      if target.surface = 'backoffice'::identity.access_session_surface then
        perform system.enqueue_outbox_event(
          'access_session', target.id, 'identity.backoffice_session_revocation_requested.v1',
          jsonb_build_object('session_id', target.id)
        );
      end if;
    end loop;
    for target in
      update identity.backoffice_authentication_attempts
      set status = 'failed', terminal_at = clock_timestamp(), secret_ciphertext = null
      where access_account_id = v_access_account_id
        and status in ('pending_enrollment', 'pending_challenge')
      returning id, factor_id
    loop
      update identity.access_account_mfa_factors as factor
      set status = 'superseded', superseded_at = clock_timestamp()
      where factor.id = target.factor_id and factor.status = 'pending';
      perform system.enqueue_outbox_event(
        'backoffice_auth_attempt', target.id, 'identity.backoffice_auth_cleanup_requested.v1',
        jsonb_build_object('attempt_id', target.id)
      );
    end loop;
    v_result := 'processed';
  end if;
  update identity.password_reset_receipts
  set access_account_id = v_access_account_id, result = v_result,
      revoked_session_count = v_revoked_session_count, processed_at = clock_timestamp()
  where id = v_receipt_id;
  return query select v_result::text, v_revoked_session_count, false;
end
$function$;

alter function access_control.has_platform_duty(uuid, uuid, text) owner to allfit_owner;
alter function identity.resolve_backoffice_account(text, text, text) owner to allfit_owner;
alter function identity.start_backoffice_authentication_attempt(uuid, text, boolean, text, text, bytea, text, timestamptz, identity.backoffice_authentication_attempt_status, timestamptz) owner to allfit_owner;
alter function identity.load_backoffice_authentication_attempt(bytea) owner to allfit_owner;
alter function identity.record_backoffice_totp_failure(bytea) owner to allfit_owner;
alter function identity.bind_backoffice_totp_verification(bytea, uuid, uuid) owner to allfit_owner;
alter function identity.complete_backoffice_authentication(bytea, uuid, uuid, bytea, text, timestamptz) owner to allfit_owner;
alter function identity.load_backoffice_access_session(bytea) owner to allfit_owner;
alter function identity.logout_backoffice_access_session(bytea) owner to allfit_owner;
alter function identity.expire_backoffice_authentication_attempts(integer) owner to allfit_owner;
alter function identity.prepare_backoffice_auth_cleanup(uuid) owner to allfit_owner;
alter function support.prevent_last_platform_administrator_revocation() owner to allfit_owner;
alter function support.close_revoked_platform_access() owner to allfit_owner;
alter function support.require_active_platform_role_for_duty() owner to allfit_owner;
alter function support.bootstrap_backoffice_administrators(uuid, text, uuid, text, text, timestamptz, text) owner to allfit_owner;
alter function identity.recover_backoffice_totp_factor(uuid, uuid, uuid, text) owner to allfit_owner;
alter function identity.process_password_reset_succeeded(text, text, text, text, timestamptz) owner to allfit_owner;

revoke all on function access_control.has_platform_duty(uuid, uuid, text) from public;
revoke all on function identity.resolve_backoffice_account(text, text, text) from public;
revoke all on function identity.start_backoffice_authentication_attempt(uuid, text, boolean, text, text, bytea, text, timestamptz, identity.backoffice_authentication_attempt_status, timestamptz) from public;
revoke all on function identity.load_backoffice_authentication_attempt(bytea) from public;
revoke all on function identity.record_backoffice_totp_failure(bytea) from public;
revoke all on function identity.bind_backoffice_totp_verification(bytea, uuid, uuid) from public;
revoke all on function identity.complete_backoffice_authentication(bytea, uuid, uuid, bytea, text, timestamptz) from public;
revoke all on function identity.load_backoffice_access_session(bytea) from public;
revoke all on function identity.logout_backoffice_access_session(bytea) from public;
revoke all on function identity.expire_backoffice_authentication_attempts(integer) from public;
revoke all on function identity.prepare_backoffice_auth_cleanup(uuid) from public;
revoke all on function support.bootstrap_backoffice_administrators(uuid, text, uuid, text, text, timestamptz, text) from public, allfit_api;
revoke all on function identity.recover_backoffice_totp_factor(uuid, uuid, uuid, text) from public, allfit_api;

grant execute on function access_control.has_platform_duty(uuid, uuid, text) to allfit_api;
grant execute on function identity.resolve_backoffice_account(text, text, text) to allfit_api;
grant execute on function identity.start_backoffice_authentication_attempt(uuid, text, boolean, text, text, bytea, text, timestamptz, identity.backoffice_authentication_attempt_status, timestamptz) to allfit_api;
grant execute on function identity.load_backoffice_authentication_attempt(bytea) to allfit_api;
grant execute on function identity.record_backoffice_totp_failure(bytea) to allfit_api;
grant execute on function identity.bind_backoffice_totp_verification(bytea, uuid, uuid) to allfit_api;
grant execute on function identity.complete_backoffice_authentication(bytea, uuid, uuid, bytea, text, timestamptz) to allfit_api;
grant execute on function identity.load_backoffice_access_session(bytea) to allfit_api;
grant execute on function identity.logout_backoffice_access_session(bytea) to allfit_api;
grant execute on function identity.expire_backoffice_authentication_attempts(integer) to allfit_api;
grant execute on function identity.prepare_backoffice_auth_cleanup(uuid) to allfit_api;
grant usage on schema identity, support to allfit_migrator;
grant execute on function support.bootstrap_backoffice_administrators(uuid, text, uuid, text, text, timestamptz, text) to allfit_migrator;
grant execute on function identity.recover_backoffice_totp_factor(uuid, uuid, uuid, text) to allfit_migrator;
