-- NEW-IDN-ACTION / OP-IDN-046..048 — account recovery started by support (`HU-BO-010`).
--
-- The identity action requests PRE_PHASE_5 §5 describes, built for the one action
-- Backoffice needs today: sending a person who cannot sign in the official recovery
-- flow. The contact changes a person starts from Space arrive later as new values of
-- `identity.identity_action_kind`, with the proposal columns they need; nothing here
-- anticipates them.
--
-- **Support starts the flow; it never acts for the person.** The recovery goes to the
-- email the person already verified, through the identity provider, and only the person
-- confirms it: `identity.process_password_reset_succeeded` marks the request confirmed
-- when the provider reports the reset. Without a verified email and an account the
-- command fails closed and writes nothing. Nobody in support recovers their own account.
--
-- **Nothing secret is kept.** A request stores a hint and a SHA-256 fingerprint of the
-- address; the worker reads the address from `identity.people` only to hand it to the
-- provider. The provider's password reset identifier is not stored either: its API
-- returns the reset token for that identifier, so it is a path to the secret.
--
-- **Resending never revives or redirects.** Only a recovery that went out and is still
-- live is resent, and only while the verified address is the one it started with. An
-- expired recovery stays expired and a new request replaces it. Cancelling stops every
-- pending delivery, but an email that already left cannot be recalled: the cancellation
-- is recorded and a later reset by the person does not reopen the request.
--
-- The duty is `diagnose_support_metadata`, as for resending an invitation: this writes no
-- personal data. Three recovery emails a day reach one person at most, and every read
-- and command records its access against the person.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type identity.identity_action_kind as enum ('account_recovery');

create type identity.identity_action_status as enum (
  'initiated', 'awaiting_verification', 'confirmed', 'expired', 'cancelled', 'failed'
);

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

create table identity.identity_action_requests (
  id uuid not null,
  person_id uuid not null,
  access_account_id uuid not null,
  action_kind identity.identity_action_kind not null,
  status identity.identity_action_status not null default 'initiated',
  initiated_by_kind text not null,
  initiated_by_person_id uuid not null,
  initiated_by_duty_assignment_id uuid,
  case_reference text,
  delivery_channel text not null,
  contact_fingerprint bytea not null,
  contact_hint text not null,
  expires_at timestamptz not null,
  delivered_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_identity_action_requests primary key (id),
  constraint fk_identity_action_requests_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_identity_action_requests_account foreign key (access_account_id) references identity.access_accounts(id) on delete restrict,
  constraint fk_identity_action_requests_initiator foreign key (initiated_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_identity_action_requests_duty foreign key (initiated_by_duty_assignment_id) references support.platform_duty_assignments(id) on delete restrict,
  constraint ck_identity_action_requests_initiator check (
    initiated_by_kind = 'support'
    and initiated_by_duty_assignment_id is not null
    and initiated_by_person_id <> person_id
    and case_reference ~ '^[A-Z][A-Z0-9_-]{2,63}$'
  ),
  constraint ck_identity_action_requests_channel check (delivery_channel = 'email'),
  constraint ck_identity_action_requests_fingerprint check (octet_length(contact_fingerprint) = 32),
  constraint ck_identity_action_requests_hint check (
    btrim(contact_hint) <> '' and char_length(contact_hint) <= 260
  ),
  constraint ck_identity_action_requests_failure_code check (
    failure_code in ('contact_changed', 'delivery_failed')
  ),
  constraint ck_identity_action_requests_lifecycle check (
    (status not in ('awaiting_verification', 'confirmed') or delivered_at is not null)
    and (confirmed_at is not null) = (status = 'confirmed')
    and (cancelled_at is not null) = (status = 'cancelled')
    and (failed_at is not null) = (status = 'failed')
    and (failure_code is not null) = (status = 'failed')
  )
);

-- One recovery under way per person, whoever writes it.
create unique index uidx_identity_action_requests_open
  on identity.identity_action_requests (person_id, action_kind)
  where status in ('initiated', 'awaiting_verification');

create index idx_identity_action_requests_person
  on identity.identity_action_requests (person_id, created_at desc, id desc);

create index idx_identity_action_requests_account
  on identity.identity_action_requests (access_account_id);

create or replace function identity.identity_action_request_transition_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'an identity action request is never deleted' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
     or new.person_id is distinct from old.person_id
     or new.access_account_id is distinct from old.access_account_id
     or new.action_kind is distinct from old.action_kind
     or new.initiated_by_kind is distinct from old.initiated_by_kind
     or new.initiated_by_person_id is distinct from old.initiated_by_person_id
     or new.initiated_by_duty_assignment_id is distinct from old.initiated_by_duty_assignment_id
     or new.case_reference is distinct from old.case_reference
     or new.delivery_channel is distinct from old.delivery_channel
     or new.contact_fingerprint is distinct from old.contact_fingerprint
     or new.contact_hint is distinct from old.contact_hint
     or new.created_at is distinct from old.created_at then
    raise exception 'an identity action request keeps its subject, destination and author'
      using errcode = '55000';
  end if;

  if old.status not in ('initiated', 'awaiting_verification') then
    raise exception 'a finished identity action request never changes' using errcode = '55000';
  end if;
  if old.status = 'awaiting_verification' and new.status = 'initiated' then
    raise exception 'a delivered request does not return to initiated' using errcode = '55000';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$function$;

create trigger trg_identity_action_requests_transition
before update or delete on identity.identity_action_requests
for each row execute function identity.identity_action_request_transition_tg();

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

create table identity.identity_action_events (
  id uuid not null default extensions.uuid_generate_v7(),
  request_id uuid not null,
  event_type text not null,
  actor_kind text not null,
  actor_person_id uuid,
  actor_duty_assignment_id uuid,
  case_reference text,
  delivery_channel text,
  result_code text,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint pk_identity_action_events primary key (id),
  constraint fk_identity_action_events_request foreign key (request_id) references identity.identity_action_requests(id) on delete restrict,
  constraint fk_identity_action_events_actor foreign key (actor_person_id) references identity.people(id) on delete restrict,
  constraint fk_identity_action_events_duty foreign key (actor_duty_assignment_id) references support.platform_duty_assignments(id) on delete restrict,
  constraint ck_identity_action_events_type check (
    event_type in (
      'initiated', 'delivery_requested', 'delivered', 'confirmed', 'expired', 'cancelled', 'failed'
    )
  ),
  -- Each transition has exactly one kind of author, and only support's carry a case.
  constraint ck_identity_action_events_actor check (
    (actor_kind = 'support' and event_type in ('initiated', 'delivery_requested', 'cancelled')
      and actor_person_id is not null and actor_duty_assignment_id is not null
      and case_reference ~ '^[A-Z][A-Z0-9_-]{2,63}$')
    or (actor_kind = 'worker' and event_type in ('delivered', 'failed')
      and actor_person_id is null and actor_duty_assignment_id is null and case_reference is null)
    or (actor_kind = 'person' and event_type = 'confirmed'
      and actor_person_id is not null and actor_duty_assignment_id is null
      and case_reference is null)
    or (actor_kind = 'system' and event_type = 'expired'
      and actor_person_id is null and actor_duty_assignment_id is null and case_reference is null)
  ),
  constraint ck_identity_action_events_channel check (
    (delivery_channel is not null) = (event_type in ('initiated', 'delivery_requested', 'delivered'))
    and (delivery_channel is null or delivery_channel = 'email')
  ),
  constraint ck_identity_action_events_result check (
    (result_code is not null) = (event_type = 'failed')
    and (result_code is null or result_code in ('contact_changed', 'delivery_failed'))
  )
);

create index idx_identity_action_events_request
  on identity.identity_action_events (request_id, occurred_at, id);

create or replace function identity.reject_identity_action_event_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'the identity action history is append-only' using errcode = '55000';
end
$function$;

create trigger trg_identity_action_events_append_only
before update or delete on identity.identity_action_events
for each row execute function identity.reject_identity_action_event_rewrite();

alter table identity.identity_action_requests enable row level security;
alter table identity.identity_action_requests force row level security;
alter table identity.identity_action_events enable row level security;
alter table identity.identity_action_events force row level security;

create policy identity_action_requests_all_owner
  on identity.identity_action_requests
  for all to allfit_owner using (true) with check (true);

create policy identity_action_events_all_owner
  on identity.identity_action_events
  for all to allfit_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create or replace function identity.require_account_recovery_assistant(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  assignment_id uuid;
begin
  if access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
     and access_control.has_platform_duty(
       p_actor_person_id, p_actor_session_id, 'diagnose_support_metadata'
     ) then
    select assignment.id into assignment_id
    from support.platform_duty_assignments as assignment
    where assignment.person_id = p_actor_person_id
      and assignment.duty_code = 'diagnose_support_metadata'
      and assignment.status = 'active'
      and clock_timestamp() >= assignment.valid_from
      and clock_timestamp() < assignment.valid_to
    order by assignment.valid_to desc
    limit 1;
  end if;

  if assignment_id is null then
    raise exception 'helping with an account recovery requires an effective support duty'
      using errcode = '42501';
  end if;
  return assignment_id;
end
$function$;

create or replace function identity.account_recovery_contact_fingerprint(p_email text)
returns bytea
language sql
immutable
set search_path = pg_catalog
as $function$
  select extensions.digest(convert_to(lower(p_email), 'UTF8'), 'sha256')
$function$;

-- Null when recovery is possible; otherwise why it fails closed.
create or replace function identity.account_recovery_unavailable_reason(p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case
    when person.status::text <> 'active' then 'person_not_active'
    when not exists (
      select 1 from identity.access_accounts as account where account.person_id = person.id
    ) then 'no_access_account'
    when person.contact_email is null or person.contact_email_verified_at is null
      then 'no_verified_email'
  end
  from identity.people as person
  where person.id = p_person_id
$function$;

create or replace function identity.record_account_recovery_access(
  p_actor_person_id uuid,
  p_person_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog
as $function$
  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, resource_id, purpose, result,
    request_id, access_mode
  ) values (
    p_actor_person_id,
    p_person_id,
    'identity.identity_action_requests',
    p_person_id,
    'support_account_recovery',
    'allowed',
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    'support_metadata'::privacy.access_mode
  )
$function$;

create or replace function identity.account_recovery_projection(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'request_id', request.id,
    'person_id', request.person_id,
    'state', case
      when request.status in ('initiated', 'awaiting_verification')
        and request.expires_at <= clock_timestamp() then 'expired'
      else request.status::text
    end,
    'contact_hint', request.contact_hint,
    'case_reference', request.case_reference,
    'created_at', request.created_at,
    'delivered_at', request.delivered_at,
    'expires_at', request.expires_at,
    'confirmed_at', request.confirmed_at,
    'cancelled_at', request.cancelled_at,
    'failed_at', request.failed_at,
    'failure_code', request.failure_code,
    'send_count', (
      select count(*) from identity.identity_action_events as event
      where event.request_id = request.id
        and event.event_type in ('initiated', 'delivery_requested')
    ),
    'resendable',
      request.status = 'awaiting_verification' and request.expires_at > clock_timestamp(),
    'cancellable',
      request.status in ('initiated', 'awaiting_verification')
      and request.expires_at > clock_timestamp()
  )
  from identity.identity_action_requests as request
  where request.id = p_request_id
$function$;

-- Counted from the history, under the person's row lock every command takes first.
create or replace function identity.consume_account_recovery_send(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if (
    select count(*)
    from identity.identity_action_events as event
    join identity.identity_action_requests as request on request.id = event.request_id
    where request.person_id = p_person_id
      and event.event_type in ('initiated', 'delivery_requested')
      and event.occurred_at > clock_timestamp() - interval '24 hours'
  ) >= 3 then
    raise exception 'no more recovery emails reach this person today' using errcode = 'P0001';
  end if;
end
$function$;

-- ---------------------------------------------------------------------------
-- NEW-IDN-ACTION — the recovery state of a person
-- ---------------------------------------------------------------------------

create or replace function identity.read_account_recovery(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_case_reference text,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  subject identity.people%rowtype;
  reason text;
begin
  perform identity.require_account_recovery_assistant(p_actor_person_id, p_actor_session_id);
  if coalesce(p_case_reference, '') !~ '^[A-Z][A-Z0-9_-]{2,63}$' then
    raise exception 'a recovery read needs a traceable case reference' using errcode = '22023';
  end if;

  select person.* into subject from identity.people as person where person.id = p_person_id;
  if subject.id is null then
    raise exception 'person not found' using errcode = 'P0002';
  end if;

  reason := identity.account_recovery_unavailable_reason(p_person_id);
  perform identity.record_account_recovery_access(p_actor_person_id, p_person_id);

  return jsonb_build_object(
    'person_id', p_person_id,
    'availability', case when reason is null then 'available' else 'unavailable' end,
    'unavailable_reason', reason,
    'contact_hint', case
      when reason is null then support.mask_email(subject.contact_email::text)
    end,
    'can_start', reason is null
      and p_actor_person_id <> p_person_id
      and not exists (
        select 1 from identity.identity_action_requests as request
        where request.person_id = p_person_id
          and request.status in ('initiated', 'awaiting_verification')
          and request.expires_at > clock_timestamp()
      ),
    'requests', coalesce((
      select jsonb_agg(
        identity.account_recovery_projection(newest.id)
        order by newest.created_at desc, newest.id desc
      )
      from (
        select request.id, request.created_at
        from identity.identity_action_requests as request
        where request.person_id = p_person_id
        order by request.created_at desc, request.id desc
        limit 10
      ) as newest
    ), '[]'::jsonb)
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-046 — start a recovery
-- ---------------------------------------------------------------------------

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
    'OP-IDN-046', p_idempotency_key, p_command_id, p_request_hash
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

-- ---------------------------------------------------------------------------
-- OP-IDN-047 — resend a recovery
-- ---------------------------------------------------------------------------

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
    'OP-IDN-047', p_idempotency_key, p_command_id, p_request_hash
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

-- ---------------------------------------------------------------------------
-- OP-IDN-048 — cancel a suspicious recovery
-- ---------------------------------------------------------------------------

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
    'OP-IDN-048', p_idempotency_key, p_command_id, p_request_hash
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

-- ---------------------------------------------------------------------------
-- Delivery, from the worker
-- ---------------------------------------------------------------------------

create or replace function identity.prepare_account_recovery_delivery(p_event_id uuid)
returns table (delivery_state text, request_id uuid, contact text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
#variable_conflict use_column
declare
  target identity.identity_action_requests%rowtype;
  subject identity.people%rowtype;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker actor required' using errcode = '42501';
  end if;

  select request.* into target
  from system.outbox_events as event
  join identity.identity_action_requests as request on request.id = event.aggregate_id
  where event.id = p_event_id
    and event.event_type = 'identity.account_recovery_requested.v1'
  for update of request;

  if target.id is null or target.status not in ('initiated', 'awaiting_verification') then
    return query select 'skipped'::text, null::uuid, null::text;
    return;
  end if;

  if target.expires_at <= clock_timestamp() then
    update identity.identity_action_requests as request
    set status = 'expired'
    where request.id = target.id;
    insert into identity.identity_action_events (request_id, event_type, actor_kind)
    values (target.id, 'expired', 'system');
    return query select 'skipped'::text, target.id, null::text;
    return;
  end if;

  select person.* into subject from identity.people as person where person.id = target.person_id;
  if subject.status::text <> 'active'
     or subject.contact_email_verified_at is null
     or identity.account_recovery_contact_fingerprint(subject.contact_email::text)
       is distinct from target.contact_fingerprint then
    update identity.identity_action_requests as request
    set status = 'failed', failed_at = clock_timestamp(), failure_code = 'contact_changed'
    where request.id = target.id;
    insert into identity.identity_action_events (request_id, event_type, actor_kind, result_code)
    values (target.id, 'failed', 'worker', 'contact_changed');
    return query select 'skipped'::text, target.id, null::text;
    return;
  end if;

  return query select 'ready'::text, target.id, subject.contact_email::text;
end
$function$;

-- The provider accepted the recovery: record it, and adopt the link's own expiry. An
-- email that left after a cancellation is recorded without reopening the request.
create or replace function identity.record_account_recovery_delivery(
  p_event_id uuid,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.identity_action_requests%rowtype;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker actor required' using errcode = '42501';
  end if;
  if p_expires_at is null
     or p_expires_at <= clock_timestamp()
     or p_expires_at > clock_timestamp() + interval '7 days' then
    raise exception 'invalid recovery link expiry' using errcode = '22023';
  end if;

  select request.* into target
  from system.outbox_events as event
  join identity.identity_action_requests as request on request.id = event.aggregate_id
  where event.id = p_event_id
    and event.event_type = 'identity.account_recovery_requested.v1'
  for update of request;
  if target.id is null then
    raise exception 'account recovery delivery not found' using errcode = 'P0002';
  end if;

  insert into identity.identity_action_events (
    request_id, event_type, actor_kind, delivery_channel
  ) values (
    target.id, 'delivered', 'worker', 'email'
  );

  if target.status in ('initiated', 'awaiting_verification') then
    update identity.identity_action_requests as request
    set status = 'awaiting_verification',
        delivered_at = clock_timestamp(),
        expires_at = p_expires_at
    where request.id = target.id;
  end if;
end
$function$;

create or replace function identity.fail_account_recovery_delivery(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.identity_action_requests%rowtype;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker actor required' using errcode = '42501';
  end if;

  select request.* into target
  from system.outbox_events as event
  join identity.identity_action_requests as request on request.id = event.aggregate_id
  where event.id = p_event_id
    and event.event_type = 'identity.account_recovery_requested.v1'
  for update of request;
  if target.id is null then
    raise exception 'account recovery delivery not found' using errcode = 'P0002';
  end if;

  if target.status in ('initiated', 'awaiting_verification') then
    update identity.identity_action_requests as request
    set status = 'failed', failed_at = clock_timestamp(), failure_code = 'delivery_failed'
    where request.id = target.id;
    insert into identity.identity_action_events (request_id, event_type, actor_kind, result_code)
    values (target.id, 'failed', 'worker', 'delivery_failed');
  end if;
end
$function$;

-- ---------------------------------------------------------------------------
-- The person confirms: the provider reports the password reset
-- ---------------------------------------------------------------------------

-- The `20260812122000` version, unchanged except for confirming the person's live recovery.
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
    -- Whoever asked for the reset, the person resetting their password is who confirms.
    for target in
      update identity.identity_action_requests as request
      set status = 'confirmed', confirmed_at = p_occurred_at
      from identity.access_accounts as account
      where account.id = v_access_account_id
        and request.person_id = account.person_id
        and request.action_kind = 'account_recovery'
        and request.status = 'awaiting_verification'
        and request.created_at <= p_occurred_at
        and request.expires_at > p_occurred_at
      returning request.id, request.person_id
    loop
      insert into identity.identity_action_events (
        request_id, event_type, actor_kind, actor_person_id
      ) values (
        target.id, 'confirmed', 'person', target.person_id
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

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter type identity.identity_action_kind owner to allfit_owner;
alter type identity.identity_action_status owner to allfit_owner;
alter table identity.identity_action_requests owner to allfit_owner;
alter table identity.identity_action_events owner to allfit_owner;
alter function identity.identity_action_request_transition_tg() owner to allfit_owner;
alter function identity.reject_identity_action_event_rewrite() owner to allfit_owner;
alter function identity.require_account_recovery_assistant(uuid, uuid) owner to allfit_owner;
alter function identity.account_recovery_contact_fingerprint(text) owner to allfit_owner;
alter function identity.account_recovery_unavailable_reason(uuid) owner to allfit_owner;
alter function identity.record_account_recovery_access(uuid, uuid) owner to allfit_owner;
alter function identity.account_recovery_projection(uuid) owner to allfit_owner;
alter function identity.consume_account_recovery_send(uuid) owner to allfit_owner;
alter function identity.read_account_recovery(uuid, uuid, text, uuid) owner to allfit_owner;
alter function identity.start_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, bytea
) owner to allfit_owner;
alter function identity.resend_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, uuid, bytea
) owner to allfit_owner;
alter function identity.cancel_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, uuid, bytea
) owner to allfit_owner;
alter function identity.prepare_account_recovery_delivery(uuid) owner to allfit_owner;
alter function identity.record_account_recovery_delivery(uuid, timestamptz) owner to allfit_owner;
alter function identity.fail_account_recovery_delivery(uuid) owner to allfit_owner;
alter function identity.process_password_reset_succeeded(text, text, text, text, timestamptz)
  owner to allfit_owner;

revoke all on identity.identity_action_requests from public, allfit_api;
revoke all on identity.identity_action_events from public, allfit_api;
revoke all on function identity.identity_action_request_transition_tg() from public, allfit_api;
revoke all on function identity.reject_identity_action_event_rewrite() from public, allfit_api;
revoke all on function identity.require_account_recovery_assistant(uuid, uuid)
  from public, allfit_api;
revoke all on function identity.account_recovery_contact_fingerprint(text) from public, allfit_api;
revoke all on function identity.account_recovery_unavailable_reason(uuid) from public, allfit_api;
revoke all on function identity.record_account_recovery_access(uuid, uuid) from public, allfit_api;
revoke all on function identity.account_recovery_projection(uuid) from public, allfit_api;
revoke all on function identity.consume_account_recovery_send(uuid) from public, allfit_api;
revoke all on function identity.read_account_recovery(uuid, uuid, text, uuid) from public;
revoke all on function identity.start_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, bytea
) from public;
revoke all on function identity.resend_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, uuid, bytea
) from public;
revoke all on function identity.cancel_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, uuid, bytea
) from public;
revoke all on function identity.prepare_account_recovery_delivery(uuid) from public;
revoke all on function identity.record_account_recovery_delivery(uuid, timestamptz) from public;
revoke all on function identity.fail_account_recovery_delivery(uuid) from public;

grant execute on function identity.read_account_recovery(uuid, uuid, text, uuid) to allfit_api;
grant execute on function identity.start_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, bytea
) to allfit_api;
grant execute on function identity.resend_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, uuid, bytea
) to allfit_api;
grant execute on function identity.cancel_account_recovery(
  uuid, uuid, text, uuid, uuid, uuid, uuid, bytea
) to allfit_api;
grant execute on function identity.prepare_account_recovery_delivery(uuid) to allfit_api;
grant execute on function identity.record_account_recovery_delivery(uuid, timestamptz) to allfit_api;
grant execute on function identity.fail_account_recovery_delivery(uuid) to allfit_api;
