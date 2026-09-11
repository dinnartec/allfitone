-- T-SUP-BG-01 — PR-22 / OP-SUP-001..004: break-glass windows.
--
-- `HU-BO-008`. This is the exceptional path, so almost every assertion here is a
-- denial. The ones that matter most:
--
--   * a forbidden category never becomes a window, at any tier;
--   * the server computes tier, quorum and duration — a caller cannot ask for the
--     cheap ones;
--   * a restricted window does not open on one approval;
--   * the requester never approves their own request, and no approver counts twice;
--   * only the exact requester exercises, and every attempt leaves evidence;
--   * a rejection is terminal, a closure is final, and neither is reversible.

begin;

select plan(38);

insert into identity.people (id, given_name, family_name, status)
values
  ('019a8000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019a8000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019a8000-0000-7000-8000-000000000003', 'Requester', 'Gamma', 'active'),
  ('019a8000-0000-7000-8000-000000000004', 'Approver', 'Delta', 'active'),
  ('019a8000-0000-7000-8000-000000000005', 'Approver', 'Epsilon', 'active'),
  ('019a8000-0000-7000-8000-000000000006', 'Subject', 'Zeta', 'active'),
  ('019a8000-0000-7000-8000-000000000007', 'Outsider', 'Eta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a8000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha8', null),
  ('019a8000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta8', null),
  ('019a8000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma8',
    '019a8000-0000-7000-8000-000000000003'),
  ('019a8000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta8',
    '019a8000-0000-7000-8000-000000000004'),
  ('019a8000-0000-7000-8000-000000000015', 'workos', 'https://issuer.test', 'epsilon8',
    '019a8000-0000-7000-8000-000000000005'),
  ('019a8000-0000-7000-8000-000000000017', 'workos', 'https://issuer.test', 'eta8',
    '019a8000-0000-7000-8000-000000000007');

select support.bootstrap_backoffice_administrators(
  '019a8000-0000-7000-8000-000000000001', 'alpha8',
  '019a8000-0000-7000-8000-000000000002', 'beta8',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-BG-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019a8000-0000-7000-8000-000000000021', '019a8000-0000-7000-8000-000000000011',
    'sid_alpha_8', 'backoffice', decode(repeat('f1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a8000-0000-7000-8000-000000000023', '019a8000-0000-7000-8000-000000000013',
    'sid_gamma_8', 'backoffice', decode(repeat('f3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a8000-0000-7000-8000-000000000024', '019a8000-0000-7000-8000-000000000014',
    'sid_delta_8', 'backoffice', decode(repeat('f4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a8000-0000-7000-8000-000000000025', '019a8000-0000-7000-8000-000000000015',
    'sid_epsilon_8', 'backoffice', decode(repeat('f5', 32), 'hex'), 'v1.epsilon',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a8000-0000-7000-8000-000000000027', '019a8000-0000-7000-8000-000000000017',
    'sid_eta_8', 'backoffice', decode(repeat('f7', 32), 'hex'), 'v1.eta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

-- Four people with the base role; the duties are what separate them.
select support.assign_platform_role(
  '019a8000-0000-7000-8000-000000000001', '019a8000-0000-7000-8000-000000000021',
  person_id, 'allfit_admin',
  ('019a8000-0000-7000-8000-00000000010' || row_number() over (order by person_id))::uuid,
  ('019a8000-0000-7000-8000-00000000020' || row_number() over (order by person_id))::uuid,
  decode(repeat('7' || row_number() over (order by person_id), 32), 'hex')
)
from (values
  ('019a8000-0000-7000-8000-000000000003'::uuid),
  ('019a8000-0000-7000-8000-000000000004'::uuid),
  ('019a8000-0000-7000-8000-000000000005'::uuid),
  ('019a8000-0000-7000-8000-000000000007'::uuid)
) as candidates(person_id);

select support.assign_platform_duty(
  '019a8000-0000-7000-8000-000000000001', '019a8000-0000-7000-8000-000000000021',
  '019a8000-0000-7000-8000-000000000003', 'request_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-008',
  '019a8000-0000-7000-8000-000000000111', '019a8000-0000-7000-8000-000000000211',
  decode(repeat('81', 32), 'hex')
);
select support.assign_platform_duty(
  '019a8000-0000-7000-8000-000000000001', '019a8000-0000-7000-8000-000000000021',
  '019a8000-0000-7000-8000-000000000004', 'approve_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-008',
  '019a8000-0000-7000-8000-000000000112', '019a8000-0000-7000-8000-000000000212',
  decode(repeat('82', 32), 'hex')
);
select support.assign_platform_duty(
  '019a8000-0000-7000-8000-000000000001', '019a8000-0000-7000-8000-000000000021',
  '019a8000-0000-7000-8000-000000000005', 'approve_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-008',
  '019a8000-0000-7000-8000-000000000113', '019a8000-0000-7000-8000-000000000213',
  decode(repeat('83', 32), 'hex')
);

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019a8000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- The duty is the control
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from support.request_break_glass(
    '019a8000-0000-7000-8000-000000000007', '019a8000-0000-7000-8000-000000000027',
    '019a8000-0000-7000-8000-000000000006', array['relationship_training'],
    'customer_support_request', 'CASE-2026-900',
    '11111111-1111-4111-8111-111111111201', '019a8000-0000-7000-8000-000000000301',
    decode(repeat('91', 32), 'hex')
  ) $$,
  '42501',
  'this break-glass operation requires an effective duty',
  'the base role alone cannot request a window'
);

select throws_ok(
  $$ select * from support.request_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    '019a8000-0000-7000-8000-000000000003', array['relationship_training'],
    'customer_support_request', 'CASE-2026-901',
    '11111111-1111-4111-8111-111111111202', '019a8000-0000-7000-8000-000000000302',
    decode(repeat('92', 32), 'hex')
  ) $$,
  '42501',
  'a break-glass window is never opened over your own data',
  'nobody opens a window over their own data'
);

-- ---------------------------------------------------------------------------
-- A forbidden category never becomes a window
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from support.request_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    '019a8000-0000-7000-8000-000000000006', array['nutrition_media'],
    'customer_support_request', 'CASE-2026-902',
    '11111111-1111-4111-8111-111111111203', '019a8000-0000-7000-8000-000000000303',
    decode(repeat('93', 32), 'hex')
  ) $$,
  '42501',
  'category nutrition_media can never be approved for break-glass',
  'nutrition_media is refused, not merely made expensive'
);

-- Mixing a forbidden category with a legitimate one does not launder it.
select throws_ok(
  $$ select * from support.request_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    '019a8000-0000-7000-8000-000000000006',
    array['relationship_training', 'nutrition_media'],
    'customer_support_request', 'CASE-2026-903',
    '11111111-1111-4111-8111-111111111204', '019a8000-0000-7000-8000-000000000304',
    decode(repeat('94', 32), 'hex')
  ) $$,
  '42501',
  'category nutrition_media can never be approved for break-glass',
  'a forbidden category is not laundered by a legitimate one beside it'
);

select is(
  (select count(*) from support.break_glass_requests)::integer,
  0,
  'no refused request left a file behind'
);

-- ---------------------------------------------------------------------------
-- The server computes the tier, quorum and duration
-- ---------------------------------------------------------------------------

select ok(
  (select (result->>'sensitivity_tier') = 'standard'
     and (result->>'required_approvals')::integer = 1
     and (result->>'requested_duration_minutes')::integer = 30
   from support.request_break_glass(
     '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
     '019a8000-0000-7000-8000-000000000006', array['nutrition_guidance'],
     'customer_support_request', 'CASE-2026-001',
     '11111111-1111-4111-8111-111111111205', '019a8000-0000-7000-8000-000000000305',
     decode(repeat('95', 32), 'hex')
   )),
  'guidance is standard: one approval, thirty minutes'
);

select ok(
  (select (result->>'sensitivity_tier') = 'restricted'
     and (result->>'required_approvals')::integer = 2
     and (result->>'requested_duration_minutes')::integer = 15
   from support.request_break_glass(
     '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
     '019a8000-0000-7000-8000-000000000006', array['nutrition_intake'],
     'customer_support_request', 'CASE-2026-002',
     '11111111-1111-4111-8111-111111111206', '019a8000-0000-7000-8000-000000000306',
     decode(repeat('96', 32), 'hex')
   )),
  'intake is restricted: two approvals, fifteen minutes'
);

-- A mixed scope inherits the most restrictive tier rather than averaging.
select is(
  (select result->>'sensitivity_tier'
   from support.request_break_glass(
     '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
     '019a8000-0000-7000-8000-000000000006',
     array['nutrition_guidance', 'nutrition_intake'],
     'customer_support_request', 'CASE-2026-003',
     '11111111-1111-4111-8111-111111111207', '019a8000-0000-7000-8000-000000000307',
     decode(repeat('97', 32), 'hex')
   )),
  'restricted',
  'guidance plus intake inherits the restricted tier'
);

select is(
  (select request_expires_at - requested_at from support.break_glass_requests
   where case_reference = 'CASE-2026-001'),
  interval '30 minutes',
  'a pending request dies on its own after thirty minutes'
);

select throws_ok(
  $$ select * from support.request_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    '019a8000-0000-7000-8000-000000000006',
    array['nutrition_guidance', 'nutrition_guidance'],
    'customer_support_request', 'CASE-2026-904',
    '11111111-1111-4111-8111-111111111208', '019a8000-0000-7000-8000-000000000308',
    decode(repeat('98', 32), 'hex')
  ) $$,
  '22023',
  'a break-glass request names each category once',
  'a duplicated category is refused'
);

-- ---------------------------------------------------------------------------
-- Nobody approves their own request
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from support.decide_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-001'),
    'approved', 'REASON-OK',
    '11111111-1111-4111-8111-111111111209', '019a8000-0000-7000-8000-000000000309',
    decode(repeat('99', 32), 'hex')
  ) $$,
  '42501',
  'this break-glass operation requires an effective duty',
  'the requester holds no approving duty, so cannot approve at all'
);

-- ---------------------------------------------------------------------------
-- Standard: one approval opens the window
-- ---------------------------------------------------------------------------

select is(
  (select result->>'status' from support.decide_break_glass(
    '019a8000-0000-7000-8000-000000000004', '019a8000-0000-7000-8000-000000000024',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-001'),
    'approved', 'REASON-OK',
    '11111111-1111-4111-8111-111111111210', '019a8000-0000-7000-8000-000000000310',
    decode(repeat('a1', 32), 'hex')
  )),
  'approved',
  'a standard request opens on one approval'
);

select is(
  (select window_ends_at - window_starts_at from support.break_glass_requests
   where case_reference = 'CASE-2026-001'),
  interval '30 minutes',
  'the window lasts exactly what the tier allows'
);

-- ---------------------------------------------------------------------------
-- Restricted: one approval is not enough
-- ---------------------------------------------------------------------------

select is(
  (select result->>'status' from support.decide_break_glass(
    '019a8000-0000-7000-8000-000000000004', '019a8000-0000-7000-8000-000000000024',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-002'),
    'approved', 'REASON-OK',
    '11111111-1111-4111-8111-111111111211', '019a8000-0000-7000-8000-000000000311',
    decode(repeat('a2', 32), 'hex')
  )),
  'requested',
  'a restricted request does not open on a single approval'
);

select is(
  (select window_starts_at from support.break_glass_requests
   where case_reference = 'CASE-2026-002'),
  null,
  'and no window exists while the quorum is incomplete'
);

-- The same approver cannot supply the second approval.
select throws_ok(
  $$ select * from support.decide_break_glass(
    '019a8000-0000-7000-8000-000000000004', '019a8000-0000-7000-8000-000000000024',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-002'),
    'approved', 'REASON-AGAIN',
    '11111111-1111-4111-8111-111111111212', '019a8000-0000-7000-8000-000000000312',
    decode(repeat('a3', 32), 'hex')
  ) $$,
  '23505',
  null,
  'one approver counts once: a second decision is refused'
);

select is(
  (select result->>'status' from support.decide_break_glass(
    '019a8000-0000-7000-8000-000000000005', '019a8000-0000-7000-8000-000000000025',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-002'),
    'approved', 'REASON-OK',
    '11111111-1111-4111-8111-111111111213', '019a8000-0000-7000-8000-000000000313',
    decode(repeat('a4', 32), 'hex')
  )),
  'approved',
  'two distinct approvers open a restricted window'
);

select is(
  (select window_ends_at - window_starts_at from support.break_glass_requests
   where case_reference = 'CASE-2026-002'),
  interval '15 minutes',
  'a restricted window is shorter, as its tier says'
);

-- ---------------------------------------------------------------------------
-- A rejection is terminal
-- ---------------------------------------------------------------------------

select is(
  (select result->>'status' from support.decide_break_glass(
    '019a8000-0000-7000-8000-000000000004', '019a8000-0000-7000-8000-000000000024',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-003'),
    'rejected', 'REASON-NO',
    '11111111-1111-4111-8111-111111111214', '019a8000-0000-7000-8000-000000000314',
    decode(repeat('a5', 32), 'hex')
  )),
  'rejected',
  'a rejection closes the request'
);

select throws_ok(
  $$ select * from support.decide_break_glass(
    '019a8000-0000-7000-8000-000000000005', '019a8000-0000-7000-8000-000000000025',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-003'),
    'approved', 'REASON-OK',
    '11111111-1111-4111-8111-111111111215', '019a8000-0000-7000-8000-000000000315',
    decode(repeat('a6', 32), 'hex')
  ) $$,
  '55000',
  'only a pending break-glass request can be decided',
  'a later approval cannot revive a rejected request'
);

-- ---------------------------------------------------------------------------
-- Only the exact requester exercises, and every attempt leaves evidence
-- ---------------------------------------------------------------------------

select is(
  (select support.exercise_break_glass(
    '019a8000-0000-7000-8000-000000000004', '019a8000-0000-7000-8000-000000000024',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-001'),
    'nutrition_guidance', 'nutrition.guidance_notes', null
  )->>'reason_code'),
  'not_the_requester',
  'an approver cannot exercise the window they approved'
);

-- Outside the approved scope: denied, and recorded as such.
select is(
  (select support.exercise_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-001'),
    'health_context', 'execution.health_context', null
  )->>'outcome'),
  'denied',
  'a category outside the approved scope is denied'
);

select is(
  (select reason_code from support.break_glass_events
   where result = 'denied' and category = 'health_context'),
  'category_out_of_scope',
  'the denial is recorded with the reason a reviewer will need'
);

select ok(
  (select count(*) = 1 from privacy.access_events
   where subject_person_id = '019a8000-0000-7000-8000-000000000006'
     and result = 'denied'
     and resource = 'execution.health_context'
     and access_mode = 'break_glass'::privacy.access_mode),
  'the person can see the denied attempt in their own audit trail'
);

-- An authorised exercise records evidence even though the content cannot exist
-- yet: `execution` and `nutrition` are not created.
select is(
  (select support.exercise_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-001'),
    'nutrition_guidance', 'nutrition.guidance_notes', null
  )->>'outcome'),
  'content_unavailable',
  'an authorised exercise refuses to invent content it cannot read'
);

select is(
  (select count(*)::integer from support.break_glass_events where result = 'allowed'),
  1,
  'and the authorised attempt was recorded before the refusal'
);

select ok(
  (select event.occurred_at = access.occurred_at
   from support.break_glass_events as event
   join privacy.access_events as access on access.id = event.access_event_id
   where event.result = 'allowed'),
  'the evidence and the visible audit row are the same event, at the same instant'
);

-- ---------------------------------------------------------------------------
-- Append-only evidence
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update support.break_glass_events set result = 'denied' $$,
  '55000',
  'break-glass evidence is append-only',
  'evidence cannot be rewritten'
);

select throws_ok(
  $$ delete from support.break_glass_approvals $$,
  '55000',
  'a break-glass decision is append-only',
  'an approval cannot be deleted'
);

select throws_ok(
  $$ update support.break_glass_requests set categories = array['health_context']
     where case_reference = 'CASE-2026-001' $$,
  '55000',
  'the subject, scope, purpose and duration of a break-glass request are immutable',
  'the scope of a request cannot be widened after the fact'
);

-- ---------------------------------------------------------------------------
-- Closing is final
-- ---------------------------------------------------------------------------

select is(
  (select result->>'status' from support.close_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-001'),
    '11111111-1111-4111-8111-111111111216', '019a8000-0000-7000-8000-000000000316',
    decode(repeat('a7', 32), 'hex')
  )),
  'closed',
  'the requester closes their own window'
);

select throws_ok(
  $$ update support.break_glass_requests set status = 'approved'
     where case_reference = 'CASE-2026-001' $$,
  '55000',
  'a closed break-glass window is never reopened: request another',
  'a closed window is never reopened'
);

select is(
  (select result->>'status' from support.close_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-002'),
    '11111111-1111-4111-8111-111111111217', '019a8000-0000-7000-8000-000000000317',
    decode(repeat('a8', 32), 'hex')
  )),
  'closed',
  'the requester can close their other window too'
);

-- ---------------------------------------------------------------------------
-- The debt AFO-241 left behind
-- ---------------------------------------------------------------------------

select support.request_break_glass(
  '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
  '019a8000-0000-7000-8000-000000000006', array['relationship_training'],
  'security_investigation', 'CASE-2026-004',
  '11111111-1111-4111-8111-111111111218', '019a8000-0000-7000-8000-000000000318',
  decode(repeat('a9', 32), 'hex')
);
select support.decide_break_glass(
  '019a8000-0000-7000-8000-000000000004', '019a8000-0000-7000-8000-000000000024',
  (select id from support.break_glass_requests where case_reference = 'CASE-2026-004'),
  'approved', 'REASON-OK',
  '11111111-1111-4111-8111-111111111219', '019a8000-0000-7000-8000-000000000319',
  decode(repeat('b1', 32), 'hex')
);

select support.close_break_glass_for_withdrawn_duty('019a8000-0000-7000-8000-000000000003');

select is(
  (select status from support.break_glass_requests where case_reference = 'CASE-2026-004'),
  'closed',
  'withdrawing the duty closes the open window it authorised'
);

-- And through the real command, which is what criterion 5 of HU-BO-028 promises.
select support.request_break_glass(
  '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
  '019a8000-0000-7000-8000-000000000006', array['relationship_training'],
  'security_investigation', 'CASE-2026-005',
  '11111111-1111-4111-8111-111111111220', '019a8000-0000-7000-8000-000000000320',
  decode(repeat('b2', 32), 'hex')
);
select support.decide_break_glass(
  '019a8000-0000-7000-8000-000000000004', '019a8000-0000-7000-8000-000000000024',
  (select id from support.break_glass_requests where case_reference = 'CASE-2026-005'),
  'approved', 'REASON-OK',
  '11111111-1111-4111-8111-111111111221', '019a8000-0000-7000-8000-000000000321',
  decode(repeat('b3', 32), 'hex')
);

select support.revoke_platform_duty(
  '019a8000-0000-7000-8000-000000000001', '019a8000-0000-7000-8000-000000000021',
  (select id from support.platform_duty_assignments
   where person_id = '019a8000-0000-7000-8000-000000000003'
     and duty_code = 'request_break_glass'),
  '11111111-1111-4111-8111-111111111222', '019a8000-0000-7000-8000-000000000322',
  decode(repeat('b4', 32), 'hex')
);

select is(
  (select status from support.break_glass_requests where case_reference = 'CASE-2026-005'),
  'closed',
  'revoking request_break_glass closes the window in the same transaction'
);

select is(
  (select support.exercise_break_glass(
    '019a8000-0000-7000-8000-000000000003', '019a8000-0000-7000-8000-000000000023',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-005'),
    'relationship_training', 'execution.executed_sessions', null
  )->>'reason_code'),
  'duty_not_effective',
  'and the operator cannot exercise it afterwards'
);

-- ---------------------------------------------------------------------------
-- The evidence cannot name an audit row that does not exist
-- ---------------------------------------------------------------------------

-- The person's visible audit row and the operator's evidence are the same event
-- seen from two sides. Without this key the evidence could point at nothing, and
-- the person would never see the attempt recorded against them.
select throws_ok(
  $$ insert into support.break_glass_events (
       request_id, requester_person_id, requester_duty_assignment_id, subject_person_id,
       category, result, resource_type, operation_code, reason_code,
       occurred_at, access_event_id, access_event_occurred_at
     )
     select
       file.id, file.requester_person_id, file.requester_duty_assignment_id,
       file.subject_person_id, 'relationship_training', 'allowed',
       'execution.executed_sessions', 'OP-SUP-003', 'authorized_exercise',
       file.requested_at, '019a8000-0000-7000-8000-0000000009ff', file.requested_at
     from support.break_glass_requests as file
     limit 1 $$,
  '23503',
  null,
  'the evidence row cannot name an access event that does not exist'
);

-- ---------------------------------------------------------------------------
-- Minimal grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'allfit_api',
    'support.request_break_glass(uuid,uuid,uuid,text[],text,text,uuid,uuid,bytea)',
    'EXECUTE'
  )
    and has_function_privilege(
      'allfit_api', 'support.exercise_break_glass(uuid,uuid,uuid,text,text,uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'allfit_api', 'support.require_break_glass_duty(uuid,uuid,text)', 'EXECUTE'
    )
    and not has_function_privilege(
      'allfit_api', 'support.close_break_glass_for_withdrawn_duty(uuid)', 'EXECUTE'
    )
    and not has_table_privilege('allfit_api', 'support.break_glass_requests', 'INSERT')
    and not has_table_privilege('allfit_api', 'support.break_glass_events', 'INSERT'),
  'the runtime role runs the operations and reaches neither the guard nor the tables'
);

select * from finish();
rollback;
