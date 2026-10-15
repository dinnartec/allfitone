-- T-SUP-BGR-01 — OP-SUP-006 / T-BGG-10: reviewing a break-glass case that was used.
--
-- `HU-BO-008`. Break-glass is the one path that reads a person's data without that
-- person. Every other control on it fires *before* the reading; this is the only one
-- that fires after, and until now nothing enforced it. `T-BGG-10` was named in the
-- governance and asserted nowhere.
--
-- **A case is reviewable once it was used, not once it was approved.** A window
-- somebody opened and never exercised read nothing, so there is nothing to judge; the
-- obligation attaches to the first exercise and to no earlier moment.
--
-- **Independence is the whole value of the review.** The reviewer is not the
-- requester, not the subject, and not anybody who approved the case. The last one is
-- the one a CHECK cannot express, so it is the function's job and it is asserted here
-- against somebody who holds `audit_break_glass` and approved anyway.
--
-- **The twenty-four hours are an obligation, not a filter.** A late review is recorded
-- and marked late. Refusing it would leave the case unreviewed for good, which is the
-- opposite of the rule it would be enforcing: the operations matrix asks for a review
-- of 100% of exercised cases, and a deadline that voids the obligation cannot deliver
-- that. What the deadline buys is visibility, and an overdue review that happened is
-- strictly more than no review at all.

begin;

select plan(26);

insert into identity.people (id, given_name, family_name, status)
values
  ('019c1000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019c1000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019c1000-0000-7000-8000-000000000003', 'Requester', 'Gamma', 'active'),
  ('019c1000-0000-7000-8000-000000000004', 'Approver', 'Delta', 'active'),
  ('019c1000-0000-7000-8000-000000000005', 'Auditor', 'Epsilon', 'active'),
  ('019c1000-0000-7000-8000-000000000006', 'Subject', 'Zeta', 'active'),
  ('019c1000-0000-7000-8000-000000000007', 'Outsider', 'Eta', 'active'),
  ('019c1000-0000-7000-8000-000000000008', 'Auditor', 'Theta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019c1000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha_bgr', null),
  ('019c1000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta_bgr', null),
  ('019c1000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma_bgr',
    '019c1000-0000-7000-8000-000000000003'),
  ('019c1000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta_bgr',
    '019c1000-0000-7000-8000-000000000004'),
  ('019c1000-0000-7000-8000-000000000015', 'workos', 'https://issuer.test', 'epsilon_bgr',
    '019c1000-0000-7000-8000-000000000005'),
  ('019c1000-0000-7000-8000-000000000017', 'workos', 'https://issuer.test', 'eta_bgr',
    '019c1000-0000-7000-8000-000000000007'),
  ('019c1000-0000-7000-8000-000000000018', 'workos', 'https://issuer.test', 'theta_bgr',
    '019c1000-0000-7000-8000-000000000008');

select support.bootstrap_backoffice_administrators(
  '019c1000-0000-7000-8000-000000000001', 'alpha_bgr',
  '019c1000-0000-7000-8000-000000000002', 'beta_bgr',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-BGR-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019c1000-0000-7000-8000-000000000021', '019c1000-0000-7000-8000-000000000011',
    'sid_alpha_bgr', 'backoffice', decode(repeat('e1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019c1000-0000-7000-8000-000000000023', '019c1000-0000-7000-8000-000000000013',
    'sid_gamma_bgr', 'backoffice', decode(repeat('e3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019c1000-0000-7000-8000-000000000024', '019c1000-0000-7000-8000-000000000014',
    'sid_delta_bgr', 'backoffice', decode(repeat('e4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019c1000-0000-7000-8000-000000000025', '019c1000-0000-7000-8000-000000000015',
    'sid_epsilon_bgr', 'backoffice', decode(repeat('e5', 32), 'hex'), 'v1.epsilon',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019c1000-0000-7000-8000-000000000027', '019c1000-0000-7000-8000-000000000017',
    'sid_eta_bgr', 'backoffice', decode(repeat('e7', 32), 'hex'), 'v1.eta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019c1000-0000-7000-8000-000000000028', '019c1000-0000-7000-8000-000000000018',
    'sid_theta_bgr', 'backoffice', decode(repeat('e8', 32), 'hex'), 'v1.theta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019c1000-0000-7000-8000-000000000001', '019c1000-0000-7000-8000-000000000021',
  person_id, 'allfit_admin',
  ('019c1000-0000-7000-8000-00000000010' || row_number() over (order by person_id))::uuid,
  ('019c1000-0000-7000-8000-00000000020' || row_number() over (order by person_id))::uuid,
  decode(repeat('6' || row_number() over (order by person_id), 32), 'hex')
)
from (values
  ('019c1000-0000-7000-8000-000000000003'::uuid),
  ('019c1000-0000-7000-8000-000000000004'::uuid),
  ('019c1000-0000-7000-8000-000000000005'::uuid),
  ('019c1000-0000-7000-8000-000000000007'::uuid),
  ('019c1000-0000-7000-8000-000000000008'::uuid)
) as candidates(person_id);

-- Gamma requests and also audits: holding the auditing duty is not what makes a
-- reviewer independent, and asserting that needs somebody who holds both.
select support.assign_platform_duty(
  '019c1000-0000-7000-8000-000000000001', '019c1000-0000-7000-8000-000000000021',
  '019c1000-0000-7000-8000-000000000003', 'request_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-BGR',
  '019c1000-0000-7000-8000-000000000111', '019c1000-0000-7000-8000-000000000211',
  decode(repeat('71', 32), 'hex')
);
select support.assign_platform_duty(
  '019c1000-0000-7000-8000-000000000001', '019c1000-0000-7000-8000-000000000021',
  '019c1000-0000-7000-8000-000000000003', 'audit_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-BGR',
  '019c1000-0000-7000-8000-000000000112', '019c1000-0000-7000-8000-000000000212',
  decode(repeat('72', 32), 'hex')
);
-- Delta approves and also audits, for the same reason.
select support.assign_platform_duty(
  '019c1000-0000-7000-8000-000000000001', '019c1000-0000-7000-8000-000000000021',
  '019c1000-0000-7000-8000-000000000004', 'approve_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-BGR',
  '019c1000-0000-7000-8000-000000000113', '019c1000-0000-7000-8000-000000000213',
  decode(repeat('73', 32), 'hex')
);
select support.assign_platform_duty(
  '019c1000-0000-7000-8000-000000000001', '019c1000-0000-7000-8000-000000000021',
  '019c1000-0000-7000-8000-000000000004', 'audit_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-BGR',
  '019c1000-0000-7000-8000-000000000114', '019c1000-0000-7000-8000-000000000214',
  decode(repeat('74', 32), 'hex')
);
select support.assign_platform_duty(
  '019c1000-0000-7000-8000-000000000001', '019c1000-0000-7000-8000-000000000021',
  '019c1000-0000-7000-8000-000000000005', 'audit_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-BGR',
  '019c1000-0000-7000-8000-000000000115', '019c1000-0000-7000-8000-000000000215',
  decode(repeat('75', 32), 'hex')
);
select support.assign_platform_duty(
  '019c1000-0000-7000-8000-000000000001', '019c1000-0000-7000-8000-000000000021',
  '019c1000-0000-7000-8000-000000000008', 'audit_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-BGR',
  '019c1000-0000-7000-8000-000000000116', '019c1000-0000-7000-8000-000000000216',
  decode(repeat('76', 32), 'hex')
);

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Three cases: one used, one approved and never used, one used long ago
-- ---------------------------------------------------------------------------

select support.request_break_glass(
  '019c1000-0000-7000-8000-000000000003', '019c1000-0000-7000-8000-000000000023',
  '019c1000-0000-7000-8000-000000000006', array['prior_training_history'],
  'customer_support_request', case_reference,
  key, command, decode(repeat(seed, 32), 'hex')
)
from (values
  ('CASE-2026-R01', '22222222-2222-4222-8222-222222222201'::uuid,
    '019c1000-0000-7000-8000-000000000301'::uuid, '81'),
  ('CASE-2026-R02', '22222222-2222-4222-8222-222222222202'::uuid,
    '019c1000-0000-7000-8000-000000000302'::uuid, '82'),
  ('CASE-2026-R03', '22222222-2222-4222-8222-222222222203'::uuid,
    '019c1000-0000-7000-8000-000000000303'::uuid, '83')
) as cases(case_reference, key, command, seed);

select support.decide_break_glass(
  '019c1000-0000-7000-8000-000000000004', '019c1000-0000-7000-8000-000000000024',
  (select id from support.break_glass_requests where case_reference = cases.case_reference),
  'approved', 'REASON-OK', key, command, decode(repeat(seed, 32), 'hex')
)
from (values
  ('CASE-2026-R01', '22222222-2222-4222-8222-222222222211'::uuid,
    '019c1000-0000-7000-8000-000000000311'::uuid, '91'),
  ('CASE-2026-R02', '22222222-2222-4222-8222-222222222212'::uuid,
    '019c1000-0000-7000-8000-000000000312'::uuid, '92'),
  ('CASE-2026-R03', '22222222-2222-4222-8222-222222222213'::uuid,
    '019c1000-0000-7000-8000-000000000313'::uuid, '93')
) as cases(case_reference, key, command, seed);

-- R01 is exercised for real, so its evidence is the evidence the product writes.
select support.exercise_break_glass(
  '019c1000-0000-7000-8000-000000000003', '019c1000-0000-7000-8000-000000000023',
  (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01'),
  'prior_training_history', 'execution.executed_sessions', null
);

-- R03 was used more than a day ago. The clock cannot be moved and the evidence is
-- append-only once written, so the only way to stand a case in the past is to write
-- its evidence row there, with the audit row it mirrors.
insert into privacy.access_events (
  id, actor_person_id, subject_person_id, resource, purpose, result,
  request_id, access_mode, occurred_at
)
select '019c1000-0000-7000-8000-000000000401', file.requester_person_id,
  file.subject_person_id, 'execution.executed_sessions', file.purpose::text, 'allowed',
  file.id, 'break_glass'::privacy.access_mode, clock_timestamp() - interval '30 hours'
from support.break_glass_requests as file
where file.case_reference = 'CASE-2026-R03';

insert into support.break_glass_events (
  request_id, requester_person_id, requester_duty_assignment_id, subject_person_id,
  category, result, resource_type, operation_code, reason_code,
  occurred_at, access_event_id, access_event_occurred_at
)
-- The two instants are read from the audit row rather than taken twice from the
-- clock: ck_break_glass_events_mirror holds them equal, and the clock moves.
select file.id, file.requester_person_id, file.requester_duty_assignment_id,
  file.subject_person_id, 'prior_training_history', 'allowed',
  'execution.executed_sessions', 'OP-SUP-003', 'break_glass_read',
  event.occurred_at, event.id, event.occurred_at
from support.break_glass_requests as file
join privacy.access_events as event
  on event.id = '019c1000-0000-7000-8000-000000000401'
where file.case_reference = 'CASE-2026-R03';

-- ---------------------------------------------------------------------------
-- Who may review, and who may not
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from support.review_break_glass(
    '019c1000-0000-7000-8000-000000000007', '019c1000-0000-7000-8000-000000000027',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01'),
    'justified', '33333333-3333-4333-8333-333333333301',
    '019c1000-0000-7000-8000-000000000501', decode(repeat('a1', 32), 'hex')
  ) $$,
  '42501',
  'this break-glass operation requires an effective duty',
  'the base role alone does not review a case'
);

select throws_ok(
  $$ select * from support.review_break_glass(
    '019c1000-0000-7000-8000-000000000003', '019c1000-0000-7000-8000-000000000023',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01'),
    'justified', '33333333-3333-4333-8333-333333333302',
    '019c1000-0000-7000-8000-000000000502', decode(repeat('a2', 32), 'hex')
  ) $$,
  '42501',
  'a break-glass case is reviewed by somebody who neither asked for it, approved it nor is its subject',
  'the requester does not review their own case, auditing duty or not'
);

-- The one a CHECK cannot express: approving is what spends the independence, and the
-- approver holds `audit_break_glass` here precisely so the duty cannot be the reason.
select throws_ok(
  $$ select * from support.review_break_glass(
    '019c1000-0000-7000-8000-000000000004', '019c1000-0000-7000-8000-000000000024',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01'),
    'justified', '33333333-3333-4333-8333-333333333303',
    '019c1000-0000-7000-8000-000000000503', decode(repeat('a3', 32), 'hex')
  ) $$,
  '42501',
  'a break-glass case is reviewed by somebody who neither asked for it, approved it nor is its subject',
  'whoever approved the case cannot also be the one who reviews it'
);

-- ---------------------------------------------------------------------------
-- A case nobody used has nothing to review
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from support.review_break_glass(
    '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-R02'),
    'justified', '33333333-3333-4333-8333-333333333304',
    '019c1000-0000-7000-8000-000000000504', decode(repeat('a4', 32), 'hex')
  ) $$,
  '55000',
  'only a break-glass case that was exercised is reviewed',
  'a window that was opened and never used read nothing, so there is nothing to judge'
);

-- ---------------------------------------------------------------------------
-- The review itself
-- ---------------------------------------------------------------------------

create temporary table review_one on commit drop as
select * from support.review_break_glass(
  '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025',
  (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01'),
  'justified', '33333333-3333-4333-8333-333333333305',
  '019c1000-0000-7000-8000-000000000505', decode(repeat('a5', 32), 'hex')
);

select is(
  (select result->>'review_outcome' from review_one),
  'justified',
  'an independent auditor records the outcome of the case'
);

select is(
  (select replayed from review_one),
  false,
  'and the first call is the one that decides it'
);

select is(
  (select reviewed_by_person_id from support.break_glass_requests
   where case_reference = 'CASE-2026-R01'),
  '019c1000-0000-7000-8000-000000000005'::uuid,
  'the file names who reviewed it'
);

select isnt(
  (select reviewed_at from support.break_glass_requests where case_reference = 'CASE-2026-R01'),
  null,
  'and when'
);

select is(
  (select reviewed_by_duty_assignment_id is not null from support.break_glass_requests
   where case_reference = 'CASE-2026-R01'),
  true,
  'under the duty assignment that was in force at that moment, not merely the duty'
);

-- ---------------------------------------------------------------------------
-- One terminal review, and it is not rewritten
-- ---------------------------------------------------------------------------

select is(
  (select replayed from support.review_break_glass(
    '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01'),
    'justified', '33333333-3333-4333-8333-333333333305',
    '019c1000-0000-7000-8000-000000000505', decode(repeat('a5', 32), 'hex')
  )),
  true,
  'the same command replays instead of reviewing twice'
);

select throws_ok(
  $$ select * from support.review_break_glass(
    '019c1000-0000-7000-8000-000000000008', '019c1000-0000-7000-8000-000000000028',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01'),
    'unjustified', '33333333-3333-4333-8333-333333333306',
    '019c1000-0000-7000-8000-000000000506', decode(repeat('a6', 32), 'hex')
  ) $$,
  '55000',
  'this break-glass case was already reviewed',
  'a second reviewer arriving later gets a conflict, not a second verdict'
);

set local role allfit_owner;
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000005', true);

select throws_ok(
  $$ update support.break_glass_requests set review_outcome = 'unjustified'
     where case_reference = 'CASE-2026-R01' $$,
  '55000',
  'a break-glass review is written once and never rewritten',
  'and the verdict already written cannot be edited afterwards either'
);

reset role;

-- ---------------------------------------------------------------------------
-- Twenty-four hours: an obligation that is recorded, not a filter that refuses
-- ---------------------------------------------------------------------------

select is(
  (select (projection->>'review_due_at')::timestamptz
        - (projection->>'first_exercised_at')::timestamptz
   from support.break_glass_review_projection(
     (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01')
   ) as projection),
  interval '24 hours',
  'the clock starts at the first exercise and runs for a day'
);

select is(
  (select (projection->>'reviewed_late')::boolean
   from support.break_glass_review_projection(
     (select id from support.break_glass_requests where case_reference = 'CASE-2026-R01')
   ) as projection),
  false,
  'a case reviewed the same hour it was used is not late'
);

select is(
  (select (projection->>'overdue')::boolean
   from support.break_glass_review_projection(
     (select id from support.break_glass_requests where case_reference = 'CASE-2026-R03')
   ) as projection),
  true,
  'a case used thirty hours ago and still unreviewed is overdue'
);

create temporary table review_late on commit drop as
select * from support.review_break_glass(
  '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025',
  (select id from support.break_glass_requests where case_reference = 'CASE-2026-R03'),
  'unjustified', '33333333-3333-4333-8333-333333333307',
  '019c1000-0000-7000-8000-000000000507', decode(repeat('a7', 32), 'hex')
);

select is(
  (select result->>'review_outcome' from review_late),
  'unjustified',
  'the late review is accepted: refusing it would leave the case unreviewed for good'
);

select is(
  (select (result->>'reviewed_late')::boolean from review_late),
  true,
  'and it is recorded as late, which is what the deadline is actually for'
);

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

select support.exercise_break_glass(
  '019c1000-0000-7000-8000-000000000003', '019c1000-0000-7000-8000-000000000023',
  (select id from support.break_glass_requests where case_reference = 'CASE-2026-R02'),
  'prior_training_history', 'execution.executed_sessions', null
);

select is(
  (select count(*)::integer
   from support.break_glass_review_queue(
     '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025', 50
   ) as queue
   where (queue.result->>'case_reference') = 'CASE-2026-R02'),
  1,
  'a case that has just been used is waiting in the review queue'
);

select is(
  (select count(*)::integer
   from support.break_glass_review_queue(
     '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025', 50
   ) as queue
   where (queue.result->>'case_reference') in ('CASE-2026-R01', 'CASE-2026-R03')),
  0,
  'and the two already reviewed are not, because the queue is what is still owed'
);

select throws_ok(
  $$ select * from support.break_glass_review_queue(
    '019c1000-0000-7000-8000-000000000007', '019c1000-0000-7000-8000-000000000027', 50
  ) $$,
  '42501',
  'reading the break-glass review queue requires an effective duty',
  'the queue is as closed as the operation it feeds'
);

-- ---------------------------------------------------------------------------
-- An incident is its own event, because somebody has to act on it
-- ---------------------------------------------------------------------------

select support.request_break_glass(
  '019c1000-0000-7000-8000-000000000003', '019c1000-0000-7000-8000-000000000023',
  '019c1000-0000-7000-8000-000000000006', array['prior_training_history'],
  'customer_support_request', 'CASE-2026-R04',
  '22222222-2222-4222-8222-222222222204', '019c1000-0000-7000-8000-000000000304',
  decode(repeat('84', 32), 'hex')
);
select support.decide_break_glass(
  '019c1000-0000-7000-8000-000000000004', '019c1000-0000-7000-8000-000000000024',
  (select id from support.break_glass_requests where case_reference = 'CASE-2026-R04'),
  'approved', 'REASON-OK', '22222222-2222-4222-8222-222222222214',
  '019c1000-0000-7000-8000-000000000314', decode(repeat('94', 32), 'hex')
);
select support.exercise_break_glass(
  '019c1000-0000-7000-8000-000000000003', '019c1000-0000-7000-8000-000000000023',
  (select id from support.break_glass_requests where case_reference = 'CASE-2026-R04'),
  'prior_training_history', 'execution.executed_sessions', null
);

select is(
  (select result->>'review_outcome' from support.review_break_glass(
    '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025',
    (select id from support.break_glass_requests where case_reference = 'CASE-2026-R04'),
    'incident_opened', '33333333-3333-4333-8333-333333333308',
    '019c1000-0000-7000-8000-000000000508', decode(repeat('a8', 32), 'hex')
  )),
  'incident_opened',
  'a reviewer who finds a problem opens an incident as the outcome'
);

select is(
  (select count(*)::integer from system.outbox_events
   where event_type = 'support.break_glass_incident_opened.v1'
     and aggregate_id = (
       select id from support.break_glass_requests where case_reference = 'CASE-2026-R04'
     )),
  1,
  'and that is a different event from a plain review, because somebody has to act on it'
);

select is(
  (select count(*)::integer from system.outbox_events
   where event_type = 'support.break_glass_reviewed.v1'
     and aggregate_id = (
       select id from support.break_glass_requests where case_reference = 'CASE-2026-R01'
     )),
  1,
  'a review that found nothing wrong is published too: 100% reviewed has to be provable'
);

-- ---------------------------------------------------------------------------
-- The queue is ordered by what is most overdue
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer
   from support.break_glass_review_queue(
     '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025', 50
   ) as queue
   where (queue.result->>'overdue')::boolean),
  0,
  'nothing is overdue once the one case that was is reviewed'
);

select is(
  (select (queue.result->>'first_exercised_at') is not null
   from support.break_glass_review_queue(
     '019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000025', 50
   ) as queue
   limit 1),
  true,
  'every row in the queue says when its clock started'
);

select is(
  (select count(*)::integer
   from support.break_glass_review_queue(
     '019c1000-0000-7000-8000-000000000008', '019c1000-0000-7000-8000-000000000028', 50
   )),
  1,
  'any auditor sees the same queue: the obligation is the platform''s, not one person''s'
);

select * from finish();
rollback;
