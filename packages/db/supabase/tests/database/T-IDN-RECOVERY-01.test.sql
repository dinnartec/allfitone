-- T-IDN-RECOVERY-01 — NEW-IDN-ACTION / OP-IDN-046..048: account recovery started by support.
--
-- `HU-BO-010` (criteria 3, 4, 5, 10 and 12) and the recovery resend of `HU-BO-011`,
-- over the identity action requests PRE_PHASE_5 §5 describes.
--
-- **Support starts the official flow; it never acts for the person.** The recovery goes
-- to the email the person already verified, through the provider, and only the person
-- confirms it by resetting their password. Without a verified email and an account the
-- request fails closed and leaves nothing behind.
--
-- **Nothing secret is kept.** Requests, events and outbox payloads carry a hint and a
-- fingerprint of the address, never the address, a link or a code.
--
-- **Resending never revives or redirects.** Only a recovery that went out and is still
-- live is resent, to the same address it started with; an expired one is replaced by a
-- new request and stays expired.

begin;

select plan(58);

insert into identity.people (
  id, given_name, family_name, status, contact_email, contact_email_verified_at
)
values
  ('019b1000-0000-7000-8000-000000000001', 'Admin', 'Alpha', 'active', null, null),
  ('019b1000-0000-7000-8000-000000000002', 'Admin', 'Beta', 'active', null, null),
  ('019b1000-0000-7000-8000-000000000003', 'Support', 'Gamma', 'active',
    'gamma.support@example.test', clock_timestamp()),
  ('019b1000-0000-7000-8000-000000000004', 'Badged', 'Delta', 'active', null, null),
  ('019b1000-0000-7000-8000-000000000005', 'Subject', 'Epsilon', 'active',
    'epsilon.subject@example.test', clock_timestamp()),
  ('019b1000-0000-7000-8000-000000000006', 'Subject', 'Zeta', 'active',
    'zeta.unverified@example.test', null),
  ('019b1000-0000-7000-8000-000000000007', 'Subject', 'Eta', 'active',
    'eta.nologin@example.test', clock_timestamp()),
  ('019b1000-0000-7000-8000-000000000008', 'Subject', 'Theta', 'active',
    'theta.subject@example.test', clock_timestamp()),
  ('019b1000-0000-7000-8000-000000000009', 'Subject', 'Iota', 'active',
    'iota.subject@example.test', clock_timestamp());

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b1000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'alpha_recovery', null),
  ('019b1000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'beta_recovery', null),
  ('019b1000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'gamma_recovery',
    '019b1000-0000-7000-8000-000000000003'),
  ('019b1000-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'delta_recovery',
    '019b1000-0000-7000-8000-000000000004'),
  ('019b1000-0000-7000-8000-000000000025', 'workos', 'https://issuer.test', 'epsilon_recovery',
    '019b1000-0000-7000-8000-000000000005'),
  ('019b1000-0000-7000-8000-000000000026', 'workos', 'https://issuer.test', 'zeta_recovery',
    '019b1000-0000-7000-8000-000000000006'),
  ('019b1000-0000-7000-8000-000000000028', 'workos', 'https://issuer.test', 'theta_recovery',
    '019b1000-0000-7000-8000-000000000008'),
  ('019b1000-0000-7000-8000-000000000029', 'workos', 'https://issuer.test', 'iota_recovery',
    '019b1000-0000-7000-8000-000000000009');

select support.bootstrap_backoffice_administrators(
  '019b1000-0000-7000-8000-000000000001', 'alpha_recovery',
  '019b1000-0000-7000-8000-000000000002', 'beta_recovery',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-IDN-RECOVERY-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
)
select
  session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019b1000-0000-7000-8000-000000000041'::uuid, '019b1000-0000-7000-8000-000000000021'::uuid,
    'alpha_recovery', 'c1'),
  ('019b1000-0000-7000-8000-000000000043'::uuid, '019b1000-0000-7000-8000-000000000023'::uuid,
    'gamma_recovery', 'c3'),
  ('019b1000-0000-7000-8000-000000000044'::uuid, '019b1000-0000-7000-8000-000000000024'::uuid,
    'delta_recovery', 'c4')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b1000-0000-7000-8000-000000000001', '019b1000-0000-7000-8000-000000000041',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b1000-0000-7000-8000-000000000003'::uuid, '019b1000-0000-7000-8000-000000000103'::uuid,
    '019b1000-0000-7000-8000-000000000203'::uuid, '83'),
  ('019b1000-0000-7000-8000-000000000004'::uuid, '019b1000-0000-7000-8000-000000000104'::uuid,
    '019b1000-0000-7000-8000-000000000204'::uuid, '84')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019b1000-0000-7000-8000-000000000001', '019b1000-0000-7000-8000-000000000041',
  '019b1000-0000-7000-8000-000000000003', 'diagnose_support_metadata',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-010',
  '019b1000-0000-7000-8000-000000000113', '019b1000-0000-7000-8000-000000000213',
  decode(repeat('93', 32), 'hex')
);

select set_config('app.actor_kind', 'support', true);
select set_config('app.actor_person_id', '019b1000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Who may look, and what a look records
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select identity.read_account_recovery(
    '019b1000-0000-7000-8000-000000000004', '019b1000-0000-7000-8000-000000000044',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000005'
  ) $$,
  '42501', null,
  'an administrator without the support duty cannot read a recovery'
);

select throws_ok(
  $$ select identity.read_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'case 10', '019b1000-0000-7000-8000-000000000005'
  ) $$,
  '22023', null,
  'a recovery read needs a traceable case reference'
);

select throws_ok(
  $$ select identity.read_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000099'
  ) $$,
  'P0002', null,
  'an unknown person is not found'
);

create temporary table epsilon_read on commit drop as
select identity.read_account_recovery(
  '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
  'CASE-2026-010', '019b1000-0000-7000-8000-000000000005'
) as body;

select is(
  (select body->>'availability' from epsilon_read),
  'available',
  'a person with a verified email and an account can be helped'
);

select is(
  (select body->>'contact_hint' from epsilon_read),
  '••••••••ct@example.test',
  'the destination is only ever a hint'
);

select ok(
  (select (body->>'can_start')::boolean and jsonb_array_length(body->'requests') = 0
   from epsilon_read),
  'with nothing under way a recovery can be started'
);

select is(
  (select count(*) from privacy.access_events
   where actor_person_id = '019b1000-0000-7000-8000-000000000003'
     and subject_person_id = '019b1000-0000-7000-8000-000000000005'
     and resource = 'identity.identity_action_requests'
     and access_mode = 'support_metadata'),
  1::bigint,
  'the read is recorded against the person before it returns'
);

-- ---------------------------------------------------------------------------
-- Failing closed
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select body->>'availability', body->>'unavailable_reason', (body->>'can_start')::boolean,
            body->>'contact_hint'
     from (select identity.read_account_recovery(
       '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
       'CASE-2026-010', '019b1000-0000-7000-8000-000000000006'
     ) as body) as answer $$,
  $$ values ('unavailable'::text, 'no_verified_email'::text, false, null::text) $$,
  'an unverified email makes recovery unavailable, without a hint of the address'
);

select results_eq(
  $$ select body->>'availability', body->>'unavailable_reason', (body->>'can_start')::boolean
     from (select identity.read_account_recovery(
       '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
       'CASE-2026-010', '019b1000-0000-7000-8000-000000000007'
     ) as body) as answer $$,
  $$ values ('unavailable'::text, 'no_access_account'::text, false) $$,
  'a person with no account to recover makes recovery unavailable'
);

select throws_ok(
  $$ select * from identity.start_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000006',
    '0b100000-0000-4000-8000-000000000090', '019b1000-0000-7000-8000-000000000690',
    decode(repeat('b0', 32), 'hex')
  ) $$,
  '55000', null,
  'without a verified email the recovery fails closed'
);

select throws_ok(
  $$ select * from identity.start_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000007',
    '0b100000-0000-4000-8000-000000000091', '019b1000-0000-7000-8000-000000000691',
    decode(repeat('b1', 32), 'hex')
  ) $$,
  '55000', null,
  'without an account the recovery fails closed'
);

select throws_ok(
  $$ select * from identity.start_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000003',
    '0b100000-0000-4000-8000-000000000092', '019b1000-0000-7000-8000-000000000692',
    decode(repeat('b2', 32), 'hex')
  ) $$,
  '42501', null,
  'nobody in support recovers their own account'
);

select throws_ok(
  $$ select * from identity.start_account_recovery(
    '019b1000-0000-7000-8000-000000000004', '019b1000-0000-7000-8000-000000000044',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000005',
    '0b100000-0000-4000-8000-000000000093', '019b1000-0000-7000-8000-000000000693',
    decode(repeat('b3', 32), 'hex')
  ) $$,
  '42501', null,
  'an administrator without the support duty cannot start a recovery'
);

-- ---------------------------------------------------------------------------
-- Starting: recorded, sent through the outbox, and nothing secret kept
-- ---------------------------------------------------------------------------

create temporary table epsilon_start on commit drop as
select * from identity.start_account_recovery(
  '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
  'CASE-2026-010', '019b1000-0000-7000-8000-000000000005',
  '0b100000-0000-4000-8000-000000000001', '019b1000-0000-7000-8000-000000000601',
  decode(repeat('a1', 32), 'hex')
);

select results_eq(
  $$ select result->>'state', result->>'contact_hint', (result->>'resendable')::boolean,
            (result->>'cancellable')::boolean, replayed
     from epsilon_start $$,
  $$ values ('initiated'::text, '••••••••ct@example.test'::text, false, true, false) $$,
  'starting opens a recovery that has not gone out yet'
);

select results_eq(
  $$ select event_type, actor_kind, actor_person_id, actor_duty_assignment_id is not null,
            case_reference
     from identity.identity_action_events
     where request_id = '019b1000-0000-7000-8000-000000000601' $$,
  $$ values ('initiated'::text, 'support'::text, '019b1000-0000-7000-8000-000000000003'::uuid,
             true, 'CASE-2026-010'::text) $$,
  'who started it, under which duty and for which case is recorded'
);

select results_eq(
  $$ select event_type, payload from system.outbox_events
     where aggregate_id = '019b1000-0000-7000-8000-000000000601' $$,
  $$ values ('identity.account_recovery_requested.v1'::text,
             jsonb_build_object('request_id', '019b1000-0000-7000-8000-000000000601'::uuid)) $$,
  'the email goes out through the outbox, which carries only the request'
);

select ok(
  not exists (
    select 1 from identity.identity_action_requests as request
    where position('epsilon.subject' in row_to_json(request)::text) > 0
  )
  and not exists (
    select 1 from identity.identity_action_events as event
    where position('epsilon.subject' in row_to_json(event)::text) > 0
  )
  and not exists (
    select 1 from system.outbox_events as event
    where event.aggregate_id = '019b1000-0000-7000-8000-000000000601'
      and position('epsilon.subject' in event.payload::text) > 0
  ),
  'no request, event or outbox payload keeps the address'
);

select results_eq(
  $$ select result->>'request_id', replayed
     from identity.start_account_recovery(
       '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
       'CASE-2026-010', '019b1000-0000-7000-8000-000000000005',
       '0b100000-0000-4000-8000-000000000001', '019b1000-0000-7000-8000-000000000601',
       decode(repeat('a1', 32), 'hex')
     ) $$,
  $$ values ('019b1000-0000-7000-8000-000000000601'::text, true) $$,
  'a retried start replays instead of opening a second recovery'
);

select throws_ok(
  $$ select * from identity.start_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000005',
    '0b100000-0000-4000-8000-000000000002', '019b1000-0000-7000-8000-000000000602',
    decode(repeat('a2', 32), 'hex')
  ) $$,
  '55000', null,
  'one recovery at a time per person'
);

select throws_ok(
  $$ insert into identity.identity_action_requests (
       id, person_id, access_account_id, action_kind, initiated_by_kind, initiated_by_person_id,
       initiated_by_duty_assignment_id, case_reference, delivery_channel, contact_fingerprint,
       contact_hint, expires_at
     )
     select '019b1000-0000-7000-8000-000000000699', person_id, access_account_id, action_kind,
            initiated_by_kind, initiated_by_person_id, initiated_by_duty_assignment_id,
            case_reference, delivery_channel, contact_fingerprint, contact_hint,
            clock_timestamp() + interval '1 hour'
     from identity.identity_action_requests
     where id = '019b1000-0000-7000-8000-000000000601' $$,
  '23505', null,
  'not even the owner of the table opens a second recovery for the same person'
);

select throws_ok(
  $$ insert into identity.identity_action_requests (
       id, person_id, access_account_id, action_kind, initiated_by_kind, initiated_by_person_id,
       initiated_by_duty_assignment_id, case_reference, delivery_channel, contact_fingerprint,
       contact_hint, expires_at
     ) values (
       '019b1000-0000-7000-8000-000000000698', '019b1000-0000-7000-8000-000000000009',
       '019b1000-0000-7000-8000-000000000029', 'account_recovery', 'support',
       '019b1000-0000-7000-8000-000000000003', null, 'CASE-2026-010', 'email',
       extensions.digest('iota.subject@example.test', 'sha256'), '••••••••ct@example.test',
       clock_timestamp() + interval '1 hour'
     ) $$,
  '23514', null,
  'a recovery support starts always names the duty it acted under'
);

select throws_ok(
  $$ select * from identity.resend_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000005',
    '019b1000-0000-7000-8000-000000000601',
    '0b100000-0000-4000-8000-000000000003', '019b1000-0000-7000-8000-000000000603',
    decode(repeat('a3', 32), 'hex')
  ) $$,
  '55000', null,
  'nothing is resent before the first email went out'
);

-- ---------------------------------------------------------------------------
-- Cancelling a suspicious recovery
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select result->>'state', (result->>'cancellable')::boolean, replayed
     from identity.cancel_account_recovery(
       '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
       'CASE-2026-010', '019b1000-0000-7000-8000-000000000005',
       '019b1000-0000-7000-8000-000000000601',
       '0b100000-0000-4000-8000-000000000004', '019b1000-0000-7000-8000-000000000604',
       decode(repeat('a4', 32), 'hex')
     ) $$,
  $$ values ('cancelled'::text, false, false) $$,
  'a suspicious recovery is cancelled'
);

select results_eq(
  $$ select event_type, actor_person_id from identity.identity_action_events
     where request_id = '019b1000-0000-7000-8000-000000000601'
     order by occurred_at, id $$,
  $$ values ('initiated'::text, '019b1000-0000-7000-8000-000000000003'::uuid),
            ('cancelled'::text, '019b1000-0000-7000-8000-000000000003'::uuid) $$,
  'the cancellation is recorded with who cancelled it'
);

select throws_ok(
  $$ select * from identity.cancel_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000005',
    '019b1000-0000-7000-8000-000000000601',
    '0b100000-0000-4000-8000-000000000005', '019b1000-0000-7000-8000-000000000605',
    decode(repeat('a5', 32), 'hex')
  ) $$,
  '55000', null,
  'a cancelled recovery stays cancelled'
);

select throws_ok(
  $$ select * from identity.prepare_account_recovery_delivery(
    (select id from system.outbox_events
     where aggregate_id = '019b1000-0000-7000-8000-000000000601')
  ) $$,
  '42501', null,
  'only the worker prepares a delivery'
);

select set_config('app.actor_kind', 'worker', true);

select is(
  (select delivery_state from identity.prepare_account_recovery_delivery(
    (select id from system.outbox_events
     where aggregate_id = '019b1000-0000-7000-8000-000000000601')
  )),
  'skipped',
  'the worker sends nothing for a cancelled recovery'
);

select identity.record_account_recovery_delivery(
  (select id from system.outbox_events where aggregate_id = '019b1000-0000-7000-8000-000000000601'),
  clock_timestamp() + interval '15 minutes'
);

select results_eq(
  $$ select request.status::text,
            (select count(*) from identity.identity_action_events as event
             where event.request_id = request.id and event.event_type = 'delivered')
     from identity.identity_action_requests as request
     where request.id = '019b1000-0000-7000-8000-000000000601' $$,
  $$ values ('cancelled'::text, 1::bigint) $$,
  'an email that left before the cancellation landed is recorded without reopening it'
);

select throws_ok(
  $$ update identity.identity_action_requests
     set status = 'awaiting_verification', cancelled_at = null, delivered_at = clock_timestamp()
     where id = '019b1000-0000-7000-8000-000000000601' $$,
  '55000', null,
  'a finished recovery never moves again, not even for the owner of the table'
);

select throws_ok(
  $$ delete from identity.identity_action_requests
     where id = '019b1000-0000-7000-8000-000000000601' $$,
  '55000', null,
  'a recovery is never deleted'
);

select throws_ok(
  $$ update identity.identity_action_events set case_reference = 'CASE-2026-999'
     where request_id = '019b1000-0000-7000-8000-000000000601' $$,
  '55000', null,
  'the recovery history is never rewritten'
);

select throws_ok(
  $$ delete from identity.identity_action_events
     where request_id = '019b1000-0000-7000-8000-000000000601' $$,
  '55000', null,
  'the recovery history is never deleted'
);

-- ---------------------------------------------------------------------------
-- A delivery the provider never accepted
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true);

create temporary table epsilon_second on commit drop as
select * from identity.start_account_recovery(
  '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
  'CASE-2026-010', '019b1000-0000-7000-8000-000000000005',
  '0b100000-0000-4000-8000-000000000006', '019b1000-0000-7000-8000-000000000606',
  decode(repeat('a6', 32), 'hex')
);

select is(
  (select result->>'state' from epsilon_second),
  'initiated',
  'after a cancellation a new recovery can start'
);

select set_config('app.actor_kind', 'worker', true);

select results_eq(
  $$ select delivery_state, request_id, contact
     from identity.prepare_account_recovery_delivery(
       (select id from system.outbox_events
        where aggregate_id = '019b1000-0000-7000-8000-000000000606')
     ) $$,
  $$ values ('ready'::text, '019b1000-0000-7000-8000-000000000606'::uuid,
             'epsilon.subject@example.test'::text) $$,
  'only the worker receives the address, and only to hand it to the provider'
);

select identity.fail_account_recovery_delivery(
  (select id from system.outbox_events where aggregate_id = '019b1000-0000-7000-8000-000000000606')
);

select results_eq(
  $$ select status::text, failure_code, failed_at is not null
     from identity.identity_action_requests
     where id = '019b1000-0000-7000-8000-000000000606' $$,
  $$ values ('failed'::text, 'delivery_failed'::text, true) $$,
  'a delivery the provider never accepted fails with a closed code'
);

select results_eq(
  $$ select event_type, actor_kind from identity.identity_action_events
     where request_id = '019b1000-0000-7000-8000-000000000606'
     order by occurred_at desc, id desc limit 1 $$,
  $$ values ('failed'::text, 'worker'::text) $$,
  'the failure is recorded as the worker''s'
);

-- ---------------------------------------------------------------------------
-- Expiry, a new recovery, and the person confirming it
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true);

select * from identity.start_account_recovery(
  '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
  'CASE-2026-010', '019b1000-0000-7000-8000-000000000008',
  '0b100000-0000-4000-8000-000000000007', '019b1000-0000-7000-8000-000000000607',
  decode(repeat('a7', 32), 'hex')
);

select set_config('app.actor_kind', 'worker', true);

select identity.record_account_recovery_delivery(
  (select id from system.outbox_events where aggregate_id = '019b1000-0000-7000-8000-000000000607'),
  clock_timestamp() + interval '15 minutes'
);

select results_eq(
  $$ select status::text, delivered_at is not null,
            expires_at between clock_timestamp() + interval '14 minutes'
                           and clock_timestamp() + interval '16 minutes'
     from identity.identity_action_requests
     where id = '019b1000-0000-7000-8000-000000000607' $$,
  $$ values ('awaiting_verification'::text, true, true) $$,
  'once the provider accepts it the recovery waits for the person until its link expires'
);

select throws_ok(
  $$ select identity.record_account_recovery_delivery(
    (select id from system.outbox_events
     where aggregate_id = '019b1000-0000-7000-8000-000000000607'),
    clock_timestamp() - interval '1 minute'
  ) $$,
  '22023', null,
  'a link that expired before it was recorded is refused'
);

update identity.identity_action_requests
set expires_at = clock_timestamp() - interval '1 minute'
where id = '019b1000-0000-7000-8000-000000000607';

select set_config('app.actor_kind', 'support', true);

select results_eq(
  $$ select request->>'state', (request->>'resendable')::boolean,
            (request->>'cancellable')::boolean, (body->>'can_start')::boolean
     from (select identity.read_account_recovery(
       '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
       'CASE-2026-010', '019b1000-0000-7000-8000-000000000008'
     ) as body) as answer
     cross join lateral jsonb_array_elements(answer.body->'requests') as request $$,
  $$ values ('expired'::text, false, false, true) $$,
  'a link past its expiry reads as expired, and a new recovery can start'
);

select throws_ok(
  $$ select * from identity.resend_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000008',
    '019b1000-0000-7000-8000-000000000607',
    '0b100000-0000-4000-8000-000000000008', '019b1000-0000-7000-8000-000000000608',
    decode(repeat('a8', 32), 'hex')
  ) $$,
  '55000', null,
  'resending never revives an expired recovery'
);

select * from identity.start_account_recovery(
  '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
  'CASE-2026-010', '019b1000-0000-7000-8000-000000000008',
  '0b100000-0000-4000-8000-000000000009', '019b1000-0000-7000-8000-000000000609',
  decode(repeat('a9', 32), 'hex')
);

select results_eq(
  $$ select id, status::text from identity.identity_action_requests
     where person_id = '019b1000-0000-7000-8000-000000000008'
     order by created_at, id $$,
  $$ values ('019b1000-0000-7000-8000-000000000607'::uuid, 'expired'::text),
            ('019b1000-0000-7000-8000-000000000609'::uuid, 'initiated'::text) $$,
  'a new recovery replaces the expired one, which stays expired'
);

select is(
  (select count(*) from identity.identity_action_events
   where request_id = '019b1000-0000-7000-8000-000000000607'
     and event_type = 'expired' and actor_kind = 'system'),
  1::bigint,
  'the expiry is recorded when it is noticed'
);

select set_config('app.actor_kind', 'worker', true);

select identity.record_account_recovery_delivery(
  (select id from system.outbox_events where aggregate_id = '019b1000-0000-7000-8000-000000000609'),
  clock_timestamp() + interval '15 minutes'
);

select * from identity.process_password_reset_succeeded(
  'workos', 'https://issuer.test', 'event_recovery_theta', 'theta_recovery', clock_timestamp()
);

select results_eq(
  $$ select status::text, confirmed_at is not null from identity.identity_action_requests
     where id = '019b1000-0000-7000-8000-000000000609' $$,
  $$ values ('confirmed'::text, true) $$,
  'the person resetting their password confirms the recovery'
);

select results_eq(
  $$ select actor_kind, actor_person_id, actor_duty_assignment_id from identity.identity_action_events
     where request_id = '019b1000-0000-7000-8000-000000000609' and event_type = 'confirmed' $$,
  $$ values ('person'::text, '019b1000-0000-7000-8000-000000000008'::uuid, null::uuid) $$,
  'the person who confirmed is recorded, never the operator'
);

select * from identity.process_password_reset_succeeded(
  'workos', 'https://issuer.test', 'event_recovery_theta', 'theta_recovery', clock_timestamp()
);

select is(
  (select count(*) from identity.identity_action_events
   where request_id = '019b1000-0000-7000-8000-000000000609' and event_type = 'confirmed'),
  1::bigint,
  'a replayed provider event confirms nothing twice'
);

select is(
  (select status::text from identity.identity_action_requests
   where id = '019b1000-0000-7000-8000-000000000607'),
  'expired',
  'confirming the new recovery leaves the expired one expired'
);

-- ---------------------------------------------------------------------------
-- Resending: same request, same address, bounded
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true);

select * from identity.start_account_recovery(
  '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
  'CASE-2026-010', '019b1000-0000-7000-8000-000000000009',
  '0b100000-0000-4000-8000-000000000010', '019b1000-0000-7000-8000-000000000610',
  decode(repeat('aa', 32), 'hex')
);

select set_config('app.actor_kind', 'worker', true);

select identity.record_account_recovery_delivery(
  (select id from system.outbox_events where aggregate_id = '019b1000-0000-7000-8000-000000000610'),
  clock_timestamp() + interval '15 minutes'
);

select set_config('app.actor_kind', 'support', true);

select results_eq(
  $$ select result->>'request_id', result->>'contact_hint', (result->>'send_count')::integer,
            replayed
     from identity.resend_account_recovery(
       '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
       'CASE-2026-010', '019b1000-0000-7000-8000-000000000009',
       '019b1000-0000-7000-8000-000000000610',
       '0b100000-0000-4000-8000-000000000011', '019b1000-0000-7000-8000-000000000611',
       decode(repeat('ab', 32), 'hex')
     ) $$,
  $$ values ('019b1000-0000-7000-8000-000000000610'::text, '••••••••ct@example.test'::text, 2,
             false) $$,
  'a resend is the same request going to the same address again'
);

select is(
  (select count(*) from system.outbox_events
   where aggregate_id = '019b1000-0000-7000-8000-000000000610'),
  2::bigint,
  'each resend is one more email through the outbox'
);

select is(
  (select replayed from identity.resend_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000009',
    '019b1000-0000-7000-8000-000000000610',
    '0b100000-0000-4000-8000-000000000011', '019b1000-0000-7000-8000-000000000611',
    decode(repeat('ab', 32), 'hex')
  )),
  true,
  'a retried resend replays instead of sending a third email'
);

select * from identity.resend_account_recovery(
  '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
  'CASE-2026-010', '019b1000-0000-7000-8000-000000000009',
  '019b1000-0000-7000-8000-000000000610',
  '0b100000-0000-4000-8000-000000000012', '019b1000-0000-7000-8000-000000000612',
  decode(repeat('ac', 32), 'hex')
);

select throws_ok(
  $$ select * from identity.resend_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000009',
    '019b1000-0000-7000-8000-000000000610',
    '0b100000-0000-4000-8000-000000000013', '019b1000-0000-7000-8000-000000000613',
    decode(repeat('ad', 32), 'hex')
  ) $$,
  'P0001', null,
  'no more than three recovery emails a day reach one person'
);

update identity.people
set contact_email = 'iota.renamed@example.test'
where id = '019b1000-0000-7000-8000-000000000009';

select throws_ok(
  $$ select * from identity.resend_account_recovery(
    '019b1000-0000-7000-8000-000000000003', '019b1000-0000-7000-8000-000000000043',
    'CASE-2026-010', '019b1000-0000-7000-8000-000000000009',
    '019b1000-0000-7000-8000-000000000610',
    '0b100000-0000-4000-8000-000000000014', '019b1000-0000-7000-8000-000000000614',
    decode(repeat('ae', 32), 'hex')
  ) $$,
  '55000', null,
  'a recovery never follows an address that changed after it started'
);

select set_config('app.actor_kind', 'worker', true);

select is(
  (select delivery_state from identity.prepare_account_recovery_delivery(
    (select id from system.outbox_events
     where aggregate_id = '019b1000-0000-7000-8000-000000000610'
     order by occurred_at desc, id desc limit 1)
  )),
  'skipped',
  'the worker never sends a recovery to an address that changed'
);

select results_eq(
  $$ select status::text, failure_code from identity.identity_action_requests
     where id = '019b1000-0000-7000-8000-000000000610' $$,
  $$ values ('failed'::text, 'contact_changed'::text) $$,
  'and the recovery fails, saying why'
);

-- ---------------------------------------------------------------------------
-- The runtime reaches all of this only through its functions
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('allfit_api',
    'identity.read_account_recovery(uuid, uuid, text, uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.start_account_recovery(uuid, uuid, text, uuid, uuid, uuid, bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.resend_account_recovery(uuid, uuid, text, uuid, uuid, uuid, uuid, bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.cancel_account_recovery(uuid, uuid, text, uuid, uuid, uuid, uuid, bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.prepare_account_recovery_delivery(uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.record_account_recovery_delivery(uuid, timestamptz)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.fail_account_recovery_delivery(uuid)', 'EXECUTE'),
  'the runtime executes the read, the three commands and the three delivery steps'
);

select ok(
  not has_function_privilege('allfit_api', 'identity.account_recovery_projection(uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api',
    'identity.require_account_recovery_assistant(uuid, uuid)', 'EXECUTE'),
  'the projection and the duty check stay private'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
   where oid in ('identity.identity_action_requests'::regclass,
                 'identity.identity_action_events'::regclass)),
  'row-level security is forced on both tables'
);

set local role allfit_api;

select throws_ok(
  $$ select count(*) from identity.identity_action_requests $$,
  '42501', null,
  'the runtime cannot read requests directly'
);

select throws_ok(
  $$ select count(*) from identity.identity_action_events $$,
  '42501', null,
  'the runtime cannot read the recovery history directly'
);

reset role;

select * from finish();
rollback;
