-- Complete Studio team-invitation resolution, decisions, listing and revocation.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table identity.invitation_intents
  drop constraint ck_invitation_intents_decision,
  add constraint ck_invitation_intents_decision check (
    (status = 'pending' and decided_at is null and materialized_membership_id is null)
    or (status in ('rejected', 'revoked', 'expired') and decided_at is not null and materialized_membership_id is null)
    or (status = 'accepted' and decided_at is not null and materialized_membership_id is not null)
  );

create index idx_invitations_organization_created
  on identity.invitations (organization_id, created_at desc, id desc);

create table system.invitation_rate_windows (
  scope text not null,
  scope_hash bytea not null,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_invitation_rate_windows primary key (scope, scope_hash),
  constraint ck_invitation_rate_windows_scope check (scope in ('actor_hour', 'organization_day', 'destination_day')),
  constraint ck_invitation_rate_windows_hash check (octet_length(scope_hash) = 32),
  constraint ck_invitation_rate_windows_count check (attempt_count > 0),
  constraint ck_invitation_rate_windows_expiry check (expires_at > window_started_at)
);

create index idx_invitation_rate_windows_expiry
  on system.invitation_rate_windows (expires_at);

alter table system.invitation_rate_windows owner to allfit_owner;
alter table system.invitation_rate_windows enable row level security;
alter table system.invitation_rate_windows force row level security;

create policy invitation_rate_windows_all_owner on system.invitation_rate_windows
  for all to allfit_owner using (true) with check (true);

revoke all on system.invitation_rate_windows from public, allfit_api;

create or replace function system.consume_invitation_rate_window(
  p_scope text,
  p_scope_hash bytea,
  p_window interval,
  p_limit integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target system.invitation_rate_windows%rowtype;
  observed_at timestamptz := clock_timestamp();
begin
  if p_scope not in ('actor_hour', 'organization_day', 'destination_day')
     or octet_length(p_scope_hash) <> 32
     or p_window <= interval '0 seconds'
     or p_limit <= 0 then
    raise exception 'invalid invitation rate window' using errcode = '22023';
  end if;

  insert into system.invitation_rate_windows (
    scope, scope_hash, window_started_at, attempt_count, expires_at
  ) values (
    p_scope, p_scope_hash, observed_at, 1, observed_at + interval '7 days'
  )
  on conflict (scope, scope_hash) do nothing;

  if found then
    return;
  end if;

  select rate_window.* into target
  from system.invitation_rate_windows as rate_window
  where rate_window.scope = p_scope
    and rate_window.scope_hash = p_scope_hash
  for update;

  if target.window_started_at + p_window <= observed_at then
    update system.invitation_rate_windows as rate_window
    set window_started_at = observed_at,
        attempt_count = 1,
        expires_at = observed_at + interval '7 days',
        updated_at = observed_at
    where rate_window.scope = p_scope
      and rate_window.scope_hash = p_scope_hash;
    return;
  end if;

  if target.attempt_count >= p_limit then
    raise exception 'team invitation rate limit reached' using errcode = 'P0001';
  end if;

  update system.invitation_rate_windows as rate_window
  set attempt_count = attempt_count + 1,
      expires_at = observed_at + interval '7 days',
      updated_at = observed_at
  where rate_window.scope = p_scope
    and rate_window.scope_hash = p_scope_hash;
end
$function$;

create or replace function identity.consume_staff_invitation_rate_limit(
  p_person_id uuid,
  p_organization_id uuid,
  p_contact text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  normalized_contact text := lower(btrim(p_contact));
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id
     or not access_control.has_capability(p_organization_id, 'invite') then
    raise exception 'invite capability required' using errcode = '42501';
  end if;

  if length(normalized_contact) not between 3 and 254
     or normalized_contact !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'invalid invitation contact' using errcode = '22023';
  end if;

  perform system.consume_invitation_rate_window(
    'actor_hour',
    extensions.digest(convert_to(p_person_id::text, 'UTF8'), 'sha256'),
    interval '1 hour',
    20
  );
  perform system.consume_invitation_rate_window(
    'organization_day',
    extensions.digest(convert_to(p_organization_id::text, 'UTF8'), 'sha256'),
    interval '24 hours',
    100
  );
  perform system.consume_invitation_rate_window(
    'destination_day',
    extensions.digest(convert_to(p_organization_id::text || chr(31) || normalized_contact, 'UTF8'), 'sha256'),
    interval '24 hours',
    3
  );
end
$function$;

create or replace function identity.resolve_staff_invitation(p_token_hash bytea)
returns table (
  invitation_id uuid,
  status text,
  organization_id uuid,
  organization_display_name text,
  responsible_party jsonb,
  expires_at timestamptz,
  invitation_intent_id uuid,
  proposed_role_code text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  expired_invitation_id uuid;
begin
  if access_control.actor_kind() <> 'anonymous' or octet_length(p_token_hash) <> 32 then
    raise exception 'anonymous invitation resolution required' using errcode = '42501';
  end if;

  update identity.invitations as invitation
  set status = 'expired'
  where invitation.token_hash = p_token_hash
    and invitation.status = 'pending'
    and invitation.expires_at <= clock_timestamp()
  returning invitation.id into expired_invitation_id;

  if expired_invitation_id is not null then
    update identity.invitation_intents as intent
    set status = 'expired', decided_at = clock_timestamp()
    where intent.invitation_id = expired_invitation_id
      and intent.status = 'pending';
    perform system.enqueue_outbox_event(
      'invitation',
      expired_invitation_id,
      'identity.invitation_expired.v1',
      jsonb_build_object('invitation_id', expired_invitation_id)
    );
    return;
  end if;

  return query
  select invitation.id,
         invitation.status::text,
         invitation.organization_id,
         organization.display_name,
         invitation.responsible_party,
         invitation.expires_at,
         intent.id,
         intent.proposed_role_code
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'membership'
   and intent.status = 'pending'
  join organizations.organizations as organization
    on organization.id = invitation.organization_id
  where invitation.token_hash = p_token_hash
    and invitation.status = 'pending'
    and invitation.expires_at > clock_timestamp()
    and organization.status = 'active';
end
$function$;

create or replace function identity.decide_staff_invitation(
  p_person_id uuid,
  p_token_hash bytea,
  p_intent_id uuid,
  p_decision text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  invitation_id uuid,
  invitation_status text,
  organization_id uuid,
  invitation_intent_id uuid,
  intent_status text,
  membership_id uuid,
  proposed_role_code text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
  receipt record;
  resolved_membership_id uuid;
  decision_time timestamptz := clock_timestamp();
  replay_result record;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'rejected') or octet_length(p_token_hash) <> 32 then
    raise exception 'invalid invitation decision' using errcode = '22023';
  end if;

  select invitation.id,
         invitation.status,
         invitation.organization_id,
         invitation.contact::text as contact,
         invitation.expires_at,
         intent.id as intent_id,
         intent.status as intent_status,
         intent.proposed_role_code,
         intent.materialized_membership_id
  into target
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.id = p_intent_id
   and intent.kind = 'membership'
  where invitation.token_hash = p_token_hash
  for update of invitation, intent;

  if target.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if lower(target.contact) is distinct from lower(nullif(current_setting('app.actor_verified_email', true), '')) then
    raise exception 'verified email mismatch' using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-IDN-009', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    select invitation.id,
           invitation.status::text as invitation_status,
           invitation.organization_id,
           intent.id as intent_id,
           intent.status::text as intent_status,
           intent.materialized_membership_id,
           intent.proposed_role_code
    into replay_result
    from identity.invitations as invitation
    join identity.invitation_intents as intent on intent.invitation_id = invitation.id
    where invitation.id = receipt.aggregate_id
      and intent.id = p_intent_id;
    if replay_result.id is null or replay_result.intent_status not in ('accepted', 'rejected') then
      raise exception 'idempotent decision not found' using errcode = '40001';
    end if;
    return query select
      replay_result.id,
      replay_result.invitation_status,
      replay_result.organization_id,
      replay_result.intent_id,
      replay_result.intent_status,
      replay_result.materialized_membership_id,
      replay_result.proposed_role_code,
      true;
    return;
  end if;

  if target.status <> 'pending'
     or target.intent_status <> 'pending'
     or target.expires_at <= decision_time then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from identity.people as person
    where person.id = p_person_id and person.status = 'active'
  ) then
    raise exception 'active person required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organizations.organizations as organization
    where organization.id = target.organization_id and organization.status = 'active'
  ) then
    raise exception 'active organization required' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from organizations.organization_roles as role
    where role.code = target.proposed_role_code
  ) then
    raise exception 'proposed role is no longer assignable' using errcode = '22023';
  end if;

  if p_decision = 'accepted' then
    select membership.id into resolved_membership_id
    from organizations.organization_memberships as membership
    where membership.organization_id = target.organization_id
      and membership.person_id = p_person_id
      and membership.status = 'active'
    for update;

    if resolved_membership_id is null then
      insert into organizations.organization_memberships (organization_id, person_id)
      values (target.organization_id, p_person_id)
      returning id into resolved_membership_id;
    end if;

    insert into organizations.membership_roles (membership_id, role_code)
    values (resolved_membership_id, target.proposed_role_code)
    on conflict do nothing;

    if found then
      insert into organizations.membership_events (membership_id, event_type, "after")
      values (
        resolved_membership_id,
        'organization.role_assigned.v1',
        jsonb_build_object('role_code', target.proposed_role_code, 'valid_from', decision_time)
      );
    end if;

    update identity.invitation_intents as intent
    set status = 'accepted',
        materialized_membership_id = resolved_membership_id,
        decided_at = decision_time
    where intent.id = target.intent_id;
  else
    update identity.invitation_intents as intent
    set status = 'rejected', decided_at = decision_time
    where intent.id = target.intent_id;
  end if;

  update identity.invitations as invitation
  set status = 'completed'
  where invitation.id = target.id;

  perform system.enqueue_outbox_event(
    'invitation',
    target.id,
    'identity.invitation_intent_decided.v1',
    jsonb_build_object(
      'invitation_id', target.id,
      'intent_id', target.intent_id,
      'decision', p_decision
    )
  );
  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'team-invitation-decided',
    'invitation',
    target.id
  );

  return query select
    target.id,
    'completed'::text,
    target.organization_id,
    target.intent_id,
    case when p_decision = 'accepted' then 'accepted' else 'rejected' end::text,
    resolved_membership_id,
    target.proposed_role_code,
    false;
end
$function$;

create or replace function identity.list_staff_invitations(
  p_person_id uuid,
  p_organization_id uuid,
  p_status text,
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid
)
returns table (
  invitation_id uuid,
  status text,
  channel text,
  contact text,
  created_at timestamptz,
  expires_at timestamptz,
  invitation_intent_id uuid,
  intent_status text,
  proposed_role_code text,
  decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id
     or not access_control.has_capability(p_organization_id, 'invite') then
    raise exception 'invite capability required' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('pending', 'completed', 'revoked', 'expired') then
    raise exception 'invalid invitation status' using errcode = '22023';
  end if;
  if p_limit not between 1 and 101
     or ((p_cursor_created_at is null) <> (p_cursor_id is null)) then
    raise exception 'invalid invitation page' using errcode = '22023';
  end if;

  return query
  select invitation.id,
         invitation.status::text,
         invitation.channel,
         invitation.contact::text,
         invitation.created_at,
         invitation.expires_at,
         intent.id,
         intent.status::text,
         intent.proposed_role_code,
         intent.decided_at
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'membership'
  where invitation.organization_id = p_organization_id
    and (p_status is null or invitation.status::text = p_status)
    and (
      p_cursor_created_at is null
      or (invitation.created_at, invitation.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by invitation.created_at desc, invitation.id desc
  limit p_limit;
end
$function$;

create or replace function identity.revoke_staff_invitation(
  p_person_id uuid,
  p_organization_id uuid,
  p_invitation_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (invitation_id uuid, status text, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.invitations%rowtype;
  receipt record;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id
     or not access_control.has_capability(p_organization_id, 'invite') then
    raise exception 'invite capability required' using errcode = '42501';
  end if;

  select invitation.* into target
  from identity.invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.organization_id = p_organization_id
  for update;

  if target.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-ORG-006', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    return query select target.id, target.status::text, true;
    return;
  end if;

  if target.status = 'revoked' then
    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'team-invitation-revoked', 'invitation', target.id
    );
    return query select target.id, 'revoked'::text, false;
    return;
  end if;
  if target.status <> 'pending' then
    raise exception 'invitation can no longer be revoked' using errcode = 'P0004';
  end if;

  update identity.invitations as invitation
  set status = 'revoked'
  where invitation.id = target.id;
  update identity.invitation_intents as intent
  set status = 'revoked', decided_at = clock_timestamp()
  where intent.invitation_id = target.id
    and intent.status = 'pending';

  perform system.enqueue_outbox_event(
    'invitation', target.id, 'identity.invitation_revoked.v1',
    jsonb_build_object('invitation_id', target.id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'team-invitation-revoked', 'invitation', target.id
  );
  return query select target.id, 'revoked'::text, false;
end
$function$;

create or replace function identity.expire_staff_invitations(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  expired record;
  expired_count integer := 0;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker actor required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 1000 then
    raise exception 'invalid expiration batch size' using errcode = '22023';
  end if;

  for expired in
    select invitation.id
    from identity.invitations as invitation
    where invitation.status = 'pending'
      and invitation.expires_at <= clock_timestamp()
    order by invitation.expires_at, invitation.id
    for update skip locked
    limit p_limit
  loop
    update identity.invitations as invitation
    set status = 'expired'
    where invitation.id = expired.id;
    update identity.invitation_intents as intent
    set status = 'expired', decided_at = clock_timestamp()
    where intent.invitation_id = expired.id
      and intent.status = 'pending';
    perform system.enqueue_outbox_event(
      'invitation', expired.id, 'identity.invitation_expired.v1',
      jsonb_build_object('invitation_id', expired.id)
    );
    expired_count := expired_count + 1;
  end loop;

  delete from system.invitation_rate_windows as rate_window
  where rate_window.expires_at <= clock_timestamp();
  return expired_count;
end
$function$;

create or replace function identity.associate_onboarding_invitation(
  p_account_id uuid,
  p_attempt_id uuid,
  p_token_hash bytea
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'account'
     or access_control.account() is distinct from p_account_id
     or octet_length(p_token_hash) <> 32 then
    raise exception 'onboarding account mismatch' using errcode = '42501';
  end if;

  update identity.onboarding_attempts as attempt
  set invitation_token_hash = encode(p_token_hash, 'hex')
  where attempt.id = p_attempt_id
    and attempt.account_id = p_account_id
    and attempt.status = 'open';

  if not found then
    raise exception 'open onboarding attempt not found' using errcode = 'P0002';
  end if;
end
$function$;

alter function system.consume_invitation_rate_window(text, bytea, interval, integer) owner to allfit_owner;
alter function identity.consume_staff_invitation_rate_limit(uuid, uuid, text) owner to allfit_owner;
alter function identity.resolve_staff_invitation(bytea) owner to allfit_owner;
alter function identity.decide_staff_invitation(uuid, bytea, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
alter function identity.list_staff_invitations(uuid, uuid, text, integer, timestamptz, uuid) owner to allfit_owner;
alter function identity.revoke_staff_invitation(uuid, uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
alter function identity.expire_staff_invitations(integer) owner to allfit_owner;
alter function identity.associate_onboarding_invitation(uuid, uuid, bytea) owner to allfit_owner;

revoke all on function system.consume_invitation_rate_window(text, bytea, interval, integer) from public, allfit_api;
revoke all on function identity.consume_staff_invitation_rate_limit(uuid, uuid, text) from public;
revoke all on function identity.resolve_staff_invitation(bytea) from public;
revoke all on function identity.decide_staff_invitation(uuid, bytea, uuid, text, uuid, uuid, bytea) from public;
revoke all on function identity.list_staff_invitations(uuid, uuid, text, integer, timestamptz, uuid) from public;
revoke all on function identity.revoke_staff_invitation(uuid, uuid, uuid, uuid, uuid, bytea) from public;
revoke all on function identity.expire_staff_invitations(integer) from public;
revoke all on function identity.associate_onboarding_invitation(uuid, uuid, bytea) from public;

grant execute on function identity.consume_staff_invitation_rate_limit(uuid, uuid, text) to allfit_api;
grant execute on function identity.resolve_staff_invitation(bytea) to allfit_api;
grant execute on function identity.decide_staff_invitation(uuid, bytea, uuid, text, uuid, uuid, bytea) to allfit_api;
grant execute on function identity.list_staff_invitations(uuid, uuid, text, integer, timestamptz, uuid) to allfit_api;
grant execute on function identity.revoke_staff_invitation(uuid, uuid, uuid, uuid, uuid, bytea) to allfit_api;
grant execute on function identity.expire_staff_invitations(integer) to allfit_api;
grant execute on function identity.associate_onboarding_invitation(uuid, uuid, bytea) to allfit_api;
