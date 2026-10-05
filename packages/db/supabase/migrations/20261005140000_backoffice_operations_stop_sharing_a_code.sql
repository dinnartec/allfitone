-- Backoffice stops sharing four operation codes with Space.
--
-- `OP-IDN-045` to `OP-IDN-048` named two different things at once. Space declares a
-- biological sex, emphasis zones, a skipped onboarding step and a closed session;
-- Backoffice resends a team invitation and runs the three account recovery commands.
-- Both wrote their own code into `system.idempotency_keys`, so the receipt stopped
-- saying which operation had happened and `support.list_operational_events` showed two
-- unrelated things under one name.
--
-- Space's codes entered first and stay. Backoffice's move:
--
--   resend a team invitation          OP-IDN-045 -> OP-IDN-052
--   send the official recovery        OP-IDN-046 -> OP-IDN-053
--   resend a recovery in progress     OP-IDN-047 -> OP-IDN-054
--   cancel a suspicious recovery      OP-IDN-048 -> OP-IDN-055
--
-- **Forward-only.** The first attempt edited the four strings inside the migrations
-- that created these functions, which was fine while they were unmerged and wrong the
-- moment they were not: those files are shared history now. So the functions are
-- replaced here instead, with bodies copied verbatim from the migrations that created
-- them — the operation code is the only difference.
--
-- Receipts already written under the old codes are left alone. They record what the
-- platform did at the time, and rewriting an idempotency ledger to make a report
-- tidier is exactly the kind of edit it exists to prevent.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- resend_team_invitation: OP-IDN-045 -> OP-IDN-052
create or replace function identity.resend_team_invitation(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_organization_id uuid,
  p_invitation_id uuid,
  p_token_hash bytea,
  p_token_key_version smallint,
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
  duty_id uuid;
  receipt record;
  response jsonb;
  organization_state organizations.organization_status;
  target identity.invitations%rowtype;
  target_intent identity.invitation_intents%rowtype;
  lapsed boolean;
  delivered uuid;
  resend_outcome text;
begin
  duty_id := identity.require_invitation_resender(p_actor_person_id, p_actor_session_id);
  if p_token_hash is null
     or octet_length(p_token_hash) <> 32
     or p_token_key_version is null
     or p_token_key_version <= 0 then
    raise exception 'invalid team invitation resend' using errcode = '22023';
  end if;

  select organization.status into organization_state
  from organizations.organizations as organization
  where organization.id = p_organization_id
  for update;
  if organization_state is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select invitation.* into target
  from identity.invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.organization_id = p_organization_id
  for update;
  select intent.* into target_intent
  from identity.invitation_intents as intent
  where intent.invitation_id = p_invitation_id
    and intent.kind = 'membership';
  if target.id is null or target_intent.id is null then
    raise exception 'team invitation not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-IDN-052', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := identity.backoffice_team_invitation_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent team invitation resend not found' using errcode = '40001';
    end if;
    return query select
      response || jsonb_build_object(
        'outcome',
        case when receipt.aggregate_id = p_invitation_id then 'redelivered' else 'reissued' end
      ),
      true;
    return;
  end if;

  if organization_state <> 'active' then
    raise exception 'only an operating organization has team invitations to resend'
      using errcode = '55000';
  end if;

  lapsed := target.status::text = 'expired'
    or (target.status::text = 'pending' and target.expires_at <= clock_timestamp());

  if target.status::text = 'pending' and not lapsed then
    resend_outcome := 'redelivered';
    delivered := target.id;
  elsif lapsed and target_intent.status::text in ('pending', 'expired') then
    if exists (
      select 1 from identity.invitations as reissue
      where reissue.reissues_invitation_id = target.id
    ) then
      raise exception 'this invitation was already reissued; resend the new one'
        using errcode = '55000';
    end if;
    if exists (
      select 1 from identity.invitations as equal
      where equal.organization_id = target.organization_id
        and equal.proposal_hash = target.proposal_hash
        and equal.id <> target.id
        and equal.status::text = 'pending'
        and equal.expires_at > clock_timestamp()
    ) then
      raise exception 'an equal invitation is already pending' using errcode = '55000';
    end if;
    resend_outcome := 'reissued';
    delivered := p_command_id;
  else
    raise exception 'only a pending or expired invitation is resent' using errcode = '55000';
  end if;

  -- The windows Studio consumes, so support's mail counts against the same limits.
  perform system.consume_invitation_rate_window(
    'actor_hour',
    extensions.digest(convert_to(p_actor_person_id::text, 'UTF8'), 'sha256'),
    interval '1 hour',
    20
  );
  perform system.consume_invitation_rate_window(
    'destination_day',
    extensions.digest(
      convert_to(target.organization_id::text || chr(31) || lower(target.contact::text), 'UTF8'),
      'sha256'
    ),
    interval '24 hours',
    3
  );

  if resend_outcome = 'redelivered' then
    update identity.invitations as invitation
    set expires_at = clock_timestamp() + interval '7 days'
    where invitation.id = target.id;

    perform system.enqueue_outbox_event(
      'invitation', target.id, 'organization.staff_invited.v1',
      jsonb_build_object('invitation_id', target.id)
    );
  else
    if target.status::text = 'pending' then
      update identity.invitations as invitation
      set status = 'expired'
      where invitation.id = target.id;
      update identity.invitation_intents as intent
      set status = 'expired', decided_at = clock_timestamp()
      where intent.invitation_id = target.id
        and intent.status = 'pending';
      perform system.enqueue_outbox_event(
        'invitation', target.id, 'identity.invitation_expired.v1',
        jsonb_build_object('invitation_id', target.id)
      );
    end if;

    insert into identity.invitations (
      id, organization_id, issued_by_person_id, issued_by_duty_assignment_id,
      reissues_invitation_id, channel, contact, token_hash, token_key_version, proposal_hash,
      responsible_party, expires_at
    )
    select p_command_id, organization.id, p_actor_person_id, duty_id,
           target.id, target.channel, target.contact, p_token_hash, p_token_key_version,
           target.proposal_hash, organization.responsible_party,
           clock_timestamp() + interval '7 days'
    from organizations.organizations as organization
    where organization.id = target.organization_id;
    insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
    values (p_command_id, 'membership', target_intent.proposed_role_code);

    perform system.enqueue_outbox_event(
      'invitation', p_command_id, 'organization.staff_invited.v1',
      jsonb_build_object('invitation_id', p_command_id)
    );
  end if;

  insert into identity.invitation_resends (
    invitation_id, delivered_invitation_id, kind, outcome, actor_person_id,
    actor_duty_assignment_id
  ) values (
    target.id, delivered, 'membership', resend_outcome, p_actor_person_id, duty_id
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'team-invitation-resent', 'invitation', delivered
  );
  return query select
    identity.backoffice_team_invitation_projection(delivered)
      || jsonb_build_object('outcome', resend_outcome),
    false;
end
$function$;

-- start_account_recovery: OP-IDN-046 -> OP-IDN-053
create or replace function identity.start_account_recovery(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_case_reference text,
  p_person_id uuid,
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
  duty_id uuid;
  receipt record;
  response jsonb;
  subject identity.people%rowtype;
  reason text;
  account_id uuid;
  lapsed record;
begin
  duty_id := identity.require_account_recovery_assistant(p_actor_person_id, p_actor_session_id);
  if coalesce(p_case_reference, '') !~ '^[A-Z][A-Z0-9_-]{2,63}$' then
    raise exception 'an account recovery needs a traceable case reference' using errcode = '22023';
  end if;
  if p_actor_person_id = p_person_id then
    raise exception 'nobody in support recovers their own account' using errcode = '42501';
  end if;

  select person.* into subject
  from identity.people as person
  where person.id = p_person_id
  for no key update;
  if subject.id is null then
    raise exception 'person not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-IDN-053', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := identity.account_recovery_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent account recovery not found' using errcode = '40001';
    end if;
    perform identity.record_account_recovery_access(p_actor_person_id, p_person_id);
    return query select response, true;
    return;
  end if;

  reason := identity.account_recovery_unavailable_reason(p_person_id);
  if reason is not null then
    raise exception 'account recovery is unavailable: %', reason using errcode = '55000';
  end if;

  for lapsed in
    update identity.identity_action_requests as request
    set status = 'expired'
    where request.person_id = p_person_id
      and request.action_kind = 'account_recovery'
      and request.status in ('initiated', 'awaiting_verification')
      and request.expires_at <= clock_timestamp()
    returning request.id
  loop
    insert into identity.identity_action_events (request_id, event_type, actor_kind)
    values (lapsed.id, 'expired', 'system');
  end loop;

  if exists (
    select 1 from identity.identity_action_requests as request
    where request.person_id = p_person_id
      and request.action_kind = 'account_recovery'
      and request.status in ('initiated', 'awaiting_verification')
  ) then
    raise exception 'a recovery is already under way; resend or cancel it' using errcode = '55000';
  end if;

  perform identity.consume_account_recovery_send(p_person_id);

  select account.id into account_id
  from identity.access_accounts as account
  where account.person_id = p_person_id
  order by account.linked_at desc, account.id desc
  limit 1;

  -- Until the provider accepts it, the request lives one day: a recovery that never
  -- left in that time no longer answers the case that asked for it.
  insert into identity.identity_action_requests (
    id, person_id, access_account_id, action_kind, initiated_by_kind, initiated_by_person_id,
    initiated_by_duty_assignment_id, case_reference, delivery_channel, contact_fingerprint,
    contact_hint, expires_at
  ) values (
    p_command_id, p_person_id, account_id, 'account_recovery', 'support', p_actor_person_id,
    duty_id, p_case_reference, 'email',
    identity.account_recovery_contact_fingerprint(subject.contact_email::text),
    support.mask_email(subject.contact_email::text), clock_timestamp() + interval '24 hours'
  );

  insert into identity.identity_action_events (
    request_id, event_type, actor_kind, actor_person_id, actor_duty_assignment_id,
    case_reference, delivery_channel
  ) values (
    p_command_id, 'initiated', 'support', p_actor_person_id, duty_id, p_case_reference, 'email'
  );

  perform system.enqueue_outbox_event(
    'identity_action_request', p_command_id, 'identity.account_recovery_requested.v1',
    jsonb_build_object('request_id', p_command_id)
  );
  perform identity.record_account_recovery_access(p_actor_person_id, p_person_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'account-recovery-started', 'identity_action_request',
    p_command_id
  );
  return query select identity.account_recovery_projection(p_command_id), false;
end
$function$;

-- resend_account_recovery: OP-IDN-047 -> OP-IDN-054
create or replace function identity.resend_account_recovery(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_case_reference text,
  p_person_id uuid,
  p_request_id uuid,
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
  duty_id uuid;
  receipt record;
  response jsonb;
  subject identity.people%rowtype;
  target identity.identity_action_requests%rowtype;
begin
  duty_id := identity.require_account_recovery_assistant(p_actor_person_id, p_actor_session_id);
  if coalesce(p_case_reference, '') !~ '^[A-Z][A-Z0-9_-]{2,63}$' then
    raise exception 'an account recovery needs a traceable case reference' using errcode = '22023';
  end if;
  if p_actor_person_id = p_person_id then
    raise exception 'nobody in support recovers their own account' using errcode = '42501';
  end if;

  select person.* into subject
  from identity.people as person
  where person.id = p_person_id
  for no key update;
  select request.* into target
  from identity.identity_action_requests as request
  where request.id = p_request_id
    and request.person_id = p_person_id
    and request.action_kind = 'account_recovery'
  for update;
  if subject.id is null or target.id is null then
    raise exception 'account recovery not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-IDN-054', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := identity.account_recovery_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent account recovery resend not found' using errcode = '40001';
    end if;
    perform identity.record_account_recovery_access(p_actor_person_id, p_person_id);
    return query select response, true;
    return;
  end if;

  if target.status <> 'awaiting_verification' or target.expires_at <= clock_timestamp() then
    raise exception 'only a recovery that went out and is still live is resent'
      using errcode = '55000';
  end if;
  if identity.account_recovery_unavailable_reason(p_person_id) is not null
     or identity.account_recovery_contact_fingerprint(subject.contact_email::text)
       is distinct from target.contact_fingerprint then
    raise exception 'the verified address changed; start a new recovery' using errcode = '55000';
  end if;

  perform identity.consume_account_recovery_send(p_person_id);

  insert into identity.identity_action_events (
    request_id, event_type, actor_kind, actor_person_id, actor_duty_assignment_id,
    case_reference, delivery_channel
  ) values (
    target.id, 'delivery_requested', 'support', p_actor_person_id, duty_id, p_case_reference,
    'email'
  );

  perform system.enqueue_outbox_event(
    'identity_action_request', target.id, 'identity.account_recovery_requested.v1',
    jsonb_build_object('request_id', target.id)
  );
  perform identity.record_account_recovery_access(p_actor_person_id, p_person_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'account-recovery-resent', 'identity_action_request',
    target.id
  );
  return query select identity.account_recovery_projection(target.id), false;
end
$function$;

-- cancel_account_recovery: OP-IDN-048 -> OP-IDN-055
create or replace function identity.cancel_account_recovery(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_case_reference text,
  p_person_id uuid,
  p_request_id uuid,
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
  duty_id uuid;
  receipt record;
  response jsonb;
  subject identity.people%rowtype;
  target identity.identity_action_requests%rowtype;
begin
  duty_id := identity.require_account_recovery_assistant(p_actor_person_id, p_actor_session_id);
  if coalesce(p_case_reference, '') !~ '^[A-Z][A-Z0-9_-]{2,63}$' then
    raise exception 'an account recovery needs a traceable case reference' using errcode = '22023';
  end if;
  if p_actor_person_id = p_person_id then
    raise exception 'nobody in support recovers their own account' using errcode = '42501';
  end if;

  select person.* into subject
  from identity.people as person
  where person.id = p_person_id
  for no key update;
  select request.* into target
  from identity.identity_action_requests as request
  where request.id = p_request_id
    and request.person_id = p_person_id
    and request.action_kind = 'account_recovery'
  for update;
  if subject.id is null or target.id is null then
    raise exception 'account recovery not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-IDN-055', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := identity.account_recovery_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent account recovery cancellation not found' using errcode = '40001';
    end if;
    perform identity.record_account_recovery_access(p_actor_person_id, p_person_id);
    return query select response, true;
    return;
  end if;

  if target.status not in ('initiated', 'awaiting_verification')
     or target.expires_at <= clock_timestamp() then
    raise exception 'only a live recovery is cancelled' using errcode = '55000';
  end if;

  update identity.identity_action_requests as request
  set status = 'cancelled', cancelled_at = clock_timestamp()
  where request.id = target.id;

  insert into identity.identity_action_events (
    request_id, event_type, actor_kind, actor_person_id, actor_duty_assignment_id, case_reference
  ) values (
    target.id, 'cancelled', 'support', p_actor_person_id, duty_id, p_case_reference
  );

  perform identity.record_account_recovery_access(p_actor_person_id, p_person_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'account-recovery-cancelled', 'identity_action_request',
    target.id
  );
  return query select identity.account_recovery_projection(target.id), false;
end
$function$;
