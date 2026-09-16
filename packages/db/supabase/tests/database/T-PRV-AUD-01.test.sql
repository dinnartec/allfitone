-- T-PRV-AUD-01 — PR-028 + PR-012 / OP-SUP-009: reading the access log.
--
-- `HU-BO-030`. The auditor answers "who looked at whose data", so almost every
-- assertion here is about what they are *not* allowed to see.
--
-- Criterion 5 is the one worth reading carefully. Separation of duties here is
-- **per case, not global**: an auditor who requested or approved one break-glass
-- window is disqualified from auditing that window, and stays a perfectly good
-- auditor for every other one. A global exclusion would be easier to write and
-- would quietly make the whole log unauditable for anyone who ever approved
-- anything.
--
-- The withheld rows are counted rather than silently dropped, and the count is a
-- second closed query instead of a column on the rows. An auditor who filters
-- down to a case they themselves requested would otherwise get an empty list and
-- no hint — and would conclude "nobody touched this person's data" when somebody
-- did. The count has to survive a list with nothing in it. It leaks nothing they
-- were not already present for, and it tells them to hand the case over.
--
-- Criterion 4 was not met before this slice. `UPDATE` and `DELETE` on
-- `privacy.access_events` both succeeded; the only thing standing in the way was
-- that `allfit_api` holds no grants, which protects the routes and not the table.

begin;

select plan(18);

insert into identity.people (id, given_name, family_name, status)
values
  ('019a9000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019a9000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019a9000-0000-7000-8000-000000000003', 'Auditor', 'Gamma', 'active'),
  ('019a9000-0000-7000-8000-000000000004', 'Operator', 'Delta', 'active'),
  ('019a9000-0000-7000-8000-000000000005', 'Approver', 'Epsilon', 'active'),
  ('019a9000-0000-7000-8000-000000000006', 'Subject', 'Zeta', 'active'),
  ('019a9000-0000-7000-8000-000000000007', 'Subject', 'Eta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a9000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha9', null),
  ('019a9000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta9', null),
  ('019a9000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma9',
    '019a9000-0000-7000-8000-000000000003'),
  ('019a9000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta9',
    '019a9000-0000-7000-8000-000000000004'),
  ('019a9000-0000-7000-8000-000000000015', 'workos', 'https://issuer.test', 'epsilon9',
    '019a9000-0000-7000-8000-000000000005');

select support.bootstrap_backoffice_administrators(
  '019a9000-0000-7000-8000-000000000001', 'alpha9',
  '019a9000-0000-7000-8000-000000000002', 'beta9',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-AUD-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019a9000-0000-7000-8000-000000000021', '019a9000-0000-7000-8000-000000000011',
    'sid_alpha_9', 'backoffice', decode(repeat('a1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a9000-0000-7000-8000-000000000023', '019a9000-0000-7000-8000-000000000013',
    'sid_gamma_9', 'backoffice', decode(repeat('a3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a9000-0000-7000-8000-000000000024', '019a9000-0000-7000-8000-000000000014',
    'sid_delta_9', 'backoffice', decode(repeat('a4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a9000-0000-7000-8000-000000000025', '019a9000-0000-7000-8000-000000000015',
    'sid_epsilon_9', 'backoffice', decode(repeat('a5', 32), 'hex'), 'v1.epsilon',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019a9000-0000-7000-8000-000000000001', '019a9000-0000-7000-8000-000000000021',
  '019a9000-0000-7000-8000-000000000003', 'allfit_admin',
  '019a9000-0000-7000-8000-000000000101', '019a9000-0000-7000-8000-000000000201',
  decode(repeat('51', 32), 'hex')
);
select support.assign_platform_role(
  '019a9000-0000-7000-8000-000000000001', '019a9000-0000-7000-8000-000000000021',
  '019a9000-0000-7000-8000-000000000004', 'allfit_admin',
  '019a9000-0000-7000-8000-000000000102', '019a9000-0000-7000-8000-000000000202',
  decode(repeat('52', 32), 'hex')
);
select support.assign_platform_role(
  '019a9000-0000-7000-8000-000000000001', '019a9000-0000-7000-8000-000000000021',
  '019a9000-0000-7000-8000-000000000005', 'allfit_admin',
  '019a9000-0000-7000-8000-000000000103', '019a9000-0000-7000-8000-000000000203',
  decode(repeat('53', 32), 'hex')
);

-- ---------------------------------------------------------------------------
-- Criterion 5 — the base role is never enough, and a duty is not a rank
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from privacy.list_access_events(
    '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
    null, null, null, null, 50
  ) $$,
  '42501',
  null,
  'the base role alone cannot read the access log'
);

select support.assign_platform_duty(
  '019a9000-0000-7000-8000-000000000001', '019a9000-0000-7000-8000-000000000021',
  '019a9000-0000-7000-8000-000000000004', 'request_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-030',
  '019a9000-0000-7000-8000-000000000104', '019a9000-0000-7000-8000-000000000204',
  decode(repeat('54', 32), 'hex')
);

select throws_ok(
  $$ select * from privacy.list_access_events(
    '019a9000-0000-7000-8000-000000000004', '019a9000-0000-7000-8000-000000000024',
    null, null, null, null, 50
  ) $$,
  '42501',
  null,
  'another effective duty does not stand in for the audit duty'
);

select support.assign_platform_duty(
  '019a9000-0000-7000-8000-000000000001', '019a9000-0000-7000-8000-000000000021',
  '019a9000-0000-7000-8000-000000000003', 'audit_platform_access',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-031',
  '019a9000-0000-7000-8000-000000000105', '019a9000-0000-7000-8000-000000000205',
  decode(repeat('55', 32), 'hex')
);
select support.assign_platform_duty(
  '019a9000-0000-7000-8000-000000000001', '019a9000-0000-7000-8000-000000000021',
  '019a9000-0000-7000-8000-000000000005', 'approve_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-032',
  '019a9000-0000-7000-8000-000000000106', '019a9000-0000-7000-8000-000000000206',
  decode(repeat('56', 32), 'hex')
);
select support.assign_platform_duty(
  '019a9000-0000-7000-8000-000000000001', '019a9000-0000-7000-8000-000000000021',
  '019a9000-0000-7000-8000-000000000005', 'audit_platform_access',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-034',
  '019a9000-0000-7000-8000-000000000108', '019a9000-0000-7000-8000-000000000208',
  decode(repeat('58', 32), 'hex')
);

-- ---------------------------------------------------------------------------
-- Two ordinary reads, so the log holds something that is not break-glass
-- ---------------------------------------------------------------------------

insert into privacy.access_events (
  actor_person_id, subject_person_id, resource, purpose, result, request_id,
  access_mode, occurred_at
) values
  ('019a9000-0000-7000-8000-000000000004', '019a9000-0000-7000-8000-000000000006',
    'support.person_operational_state', 'customer_support_request', 'allowed',
    '019a9000-0000-7000-8000-000000000401', 'organization_operational',
    clock_timestamp() - interval '3 days'),
  ('019a9000-0000-7000-8000-000000000005', '019a9000-0000-7000-8000-000000000007',
    'support.person_operational_state', 'customer_support_request', 'allowed',
    '019a9000-0000-7000-8000-000000000402', 'organization_operational',
    clock_timestamp() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- Criterion 1 — who looked, at what, about whom, and when
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from privacy.list_access_events(
    '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
    null, null, null, null, 50
  )),
  2,
  'the auditor reads the log'
);

select ok(
  (select
     row.subject_person_id = '019a9000-0000-7000-8000-000000000006'
     and row.resource = 'support.person_operational_state'
     and row.result = 'allowed'
     and row.occurred_at is not null
   from privacy.list_access_events(
     '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
     '019a9000-0000-7000-8000-000000000004', null, null, null, 50
   ) as row),
  'each row says who accessed, what resource, about whom and when'
);

-- ---------------------------------------------------------------------------
-- Criterion 3 — the record of the access, never the content
-- ---------------------------------------------------------------------------

-- Asserted against the declared result type rather than one sampled row, so a
-- content column added later fails here instead of leaking quietly.
select is(
  (select pg_get_function_result(p.oid)
   from pg_proc as p
   join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'privacy' and p.proname = 'list_access_events'),
  'TABLE(actor_person_id uuid, subject_person_id uuid, resource text, resource_id uuid,'
    || ' purpose text, result text, scope_code text, scope_version integer,'
    || ' access_mode privacy.access_mode, occurred_at timestamp with time zone)',
  'the projection carries the record of the access and nothing that was read'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — filters resolved in the database
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from privacy.list_access_events(
    '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
    '019a9000-0000-7000-8000-000000000005', null, null, null, 50
  )),
  1,
  'filtering by team member narrows the log'
);

select is(
  (select count(*)::integer from privacy.list_access_events(
    '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
    null, '019a9000-0000-7000-8000-000000000006', null, null, 50
  )),
  1,
  'filtering by affected person narrows the log'
);

select is(
  (select count(*)::integer from privacy.list_access_events(
    '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
    null, null, clock_timestamp() - interval '2 hours', null, 50
  )),
  1,
  'filtering by date narrows the log'
);

select is(
  (select count(*)::integer from privacy.list_access_events(
    '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
    '019a9000-0000-7000-8000-000000000004', '019a9000-0000-7000-8000-000000000007',
    null, null, 50
  )),
  0,
  'the filters combine rather than widening each other'
);

select is(
  (select count(*)::integer from privacy.list_access_events(
    '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
    null, null, null, null, 1
  )),
  1,
  'the page size is the caller-supplied limit, applied in the database'
);

-- ---------------------------------------------------------------------------
-- Criterion 5 — separation of duties, per case
-- ---------------------------------------------------------------------------

select support.assign_platform_duty(
  '019a9000-0000-7000-8000-000000000001', '019a9000-0000-7000-8000-000000000021',
  '019a9000-0000-7000-8000-000000000003', 'request_break_glass',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-033',
  '019a9000-0000-7000-8000-000000000107', '019a9000-0000-7000-8000-000000000207',
  decode(repeat('57', 32), 'hex')
);

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019a9000-0000-7000-8000-000000000003', true);

-- Case A: the auditor is the requester, and the approver approved it.
create temp table audit_cases on commit drop as
select (opened.result->>'id')::uuid as own_case
from support.request_break_glass(
  '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
  '019a9000-0000-7000-8000-000000000006', array['relationship_training'],
  'security_investigation', 'CASE-2026-A01',
  '11111111-1111-4111-8111-111111111401', '019a9000-0000-7000-8000-000000000301',
  decode(repeat('71', 32), 'hex')
) as opened;

select support.decide_break_glass(
  '019a9000-0000-7000-8000-000000000005', '019a9000-0000-7000-8000-000000000025',
  (select own_case from audit_cases), 'approved', 'REASON-OK',
  '11111111-1111-4111-8111-111111111402', '019a9000-0000-7000-8000-000000000302',
  decode(repeat('72', 32), 'hex')
);
select support.exercise_break_glass(
  '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
  (select own_case from audit_cases), 'relationship_training',
  'execution.executed_sessions', null
);

-- Case B: somebody else's, which the auditor never touched.
select set_config('app.actor_person_id', '019a9000-0000-7000-8000-000000000004', true);

create temp table other_cases on commit drop as
select (opened.result->>'id')::uuid as other_case
from support.request_break_glass(
  '019a9000-0000-7000-8000-000000000004', '019a9000-0000-7000-8000-000000000024',
  '019a9000-0000-7000-8000-000000000007', array['relationship_training'],
  'security_investigation', 'CASE-2026-B01',
  '11111111-1111-4111-8111-111111111403', '019a9000-0000-7000-8000-000000000303',
  decode(repeat('73', 32), 'hex')
) as opened;

select support.decide_break_glass(
  '019a9000-0000-7000-8000-000000000005', '019a9000-0000-7000-8000-000000000025',
  (select other_case from other_cases), 'approved', 'REASON-OK',
  '11111111-1111-4111-8111-111111111404', '019a9000-0000-7000-8000-000000000304',
  decode(repeat('74', 32), 'hex')
);
select support.exercise_break_glass(
  '019a9000-0000-7000-8000-000000000004', '019a9000-0000-7000-8000-000000000024',
  (select other_case from other_cases), 'relationship_training',
  'execution.executed_sessions', null
);

select is(
  (select count(*)::integer
   from privacy.list_access_events(
     '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
     null, null, null, null, 50
   ) as row
   where row.access_mode = 'break_glass'),
  1,
  'a break-glass access the auditor never touched stays auditable'
);

select is(
  (select count(*)::integer
   from privacy.list_access_events(
     '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
     null, null, null, null, 50
   ) as row
   where row.actor_person_id = '019a9000-0000-7000-8000-000000000003'),
  0,
  'the auditor never audits the window they requested themselves'
);

select is(
  privacy.count_withheld_access_events(
    '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
    null, null, null, null
  ),
  1,
  'the auditor is told how many rows they cannot audit, not left with a short list'
);

-- The case that matters most: filtered down to only their own window, the list is
-- empty. Without the count they would read that as "nobody touched this person".
select is(
  (select count(*)::integer from privacy.list_access_events(
     '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
     '019a9000-0000-7000-8000-000000000003', null, null, null, 50
   ))
    + privacy.count_withheld_access_events(
      '019a9000-0000-7000-8000-000000000003', '019a9000-0000-7000-8000-000000000023',
      '019a9000-0000-7000-8000-000000000003', null, null, null
    ),
  1,
  'an empty list still reports what was withheld from it'
);

-- The approver is disqualified from the case they approved, and only that one.
select is(
  (select count(*)::integer
   from privacy.list_access_events(
     '019a9000-0000-7000-8000-000000000005', '019a9000-0000-7000-8000-000000000025',
     null, null, null, null, 50
   ) as row
   where row.access_mode = 'break_glass'),
  0,
  'whoever approved a window cannot audit it either'
);

-- ---------------------------------------------------------------------------
-- Criterion 4 — the log cannot be edited or deleted, by anyone
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update privacy.access_events set result = 'denied'
     where actor_person_id = '019a9000-0000-7000-8000-000000000004' $$,
  '55000',
  null,
  'no update rewrites an access record'
);

select throws_ok(
  $$ delete from privacy.access_events
     where actor_person_id = '019a9000-0000-7000-8000-000000000004' $$,
  '55000',
  null,
  'no delete removes an access record'
);

-- ---------------------------------------------------------------------------
-- Minimal grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'allfit_api',
    'privacy.list_access_events(uuid,uuid,uuid,uuid,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
    and has_function_privilege(
      'allfit_api',
      'privacy.count_withheld_access_events(uuid,uuid,uuid,uuid,timestamptz,timestamptz)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'allfit_api', 'privacy.require_access_log_auditor(uuid,uuid)', 'EXECUTE'
    )
    and not has_table_privilege('allfit_api', 'privacy.access_events', 'SELECT')
    and not has_table_privilege('allfit_api', 'privacy.access_events', 'UPDATE')
    and not has_table_privilege('allfit_api', 'privacy.access_events', 'DELETE'),
  'the runtime role runs the two queries, never the guard and never the table'
);

select * from finish();
rollback;
