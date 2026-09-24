-- T-SUP-RLS-02 — PR-28: the read-only platform access inventory.
--
-- Covers `OP-SUP-008` and `OP-SUP-011`: two duties may read it, the base role
-- alone may not, reading grants no authority to administer, retired assignments
-- stay visible, and an elapsed window reads as expired with no job involved.

begin;

select plan(22);

insert into identity.people (id, given_name, family_name)
values
  ('019a4000-0000-7000-8000-000000000001', 'Manager', 'Alpha'),
  ('019a4000-0000-7000-8000-000000000002', 'Manager', 'Beta'),
  ('019a4000-0000-7000-8000-000000000003', 'Auditor', 'Gamma'),
  ('019a4000-0000-7000-8000-000000000004', 'Badged', 'Delta');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a4000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha', null),
  ('019a4000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta', null),
  ('019a4000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma',
    '019a4000-0000-7000-8000-000000000003'),
  ('019a4000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta',
    '019a4000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019a4000-0000-7000-8000-000000000001', 'alpha',
  '019a4000-0000-7000-8000-000000000002', 'beta',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-SUP-02'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019a4000-0000-7000-8000-000000000021', '019a4000-0000-7000-8000-000000000011',
    'sid_alpha_2', 'backoffice', decode(repeat('b1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a4000-0000-7000-8000-000000000023', '019a4000-0000-7000-8000-000000000013',
    'sid_gamma_2', 'backoffice', decode(repeat('b3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a4000-0000-7000-8000-000000000024', '019a4000-0000-7000-8000-000000000014',
    'sid_delta_2', 'backoffice', decode(repeat('b4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
  '019a4000-0000-7000-8000-000000000003', 'allfit_admin',
  '019a4000-0000-7000-8000-000000000101', '019a4000-0000-7000-8000-000000000201',
  decode(repeat('21', 32), 'hex')
);
select support.assign_platform_role(
  '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
  '019a4000-0000-7000-8000-000000000004', 'allfit_admin',
  '019a4000-0000-7000-8000-000000000102', '019a4000-0000-7000-8000-000000000202',
  decode(repeat('22', 32), 'hex')
);
select support.assign_platform_duty(
  '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
  '019a4000-0000-7000-8000-000000000003', 'audit_platform_access',
  null, clock_timestamp() + interval '30 days', 'CASE-AUDIT-01',
  '019a4000-0000-7000-8000-000000000103', '019a4000-0000-7000-8000-000000000203',
  decode(repeat('23', 32), 'hex')
);

select support.assign_platform_duty(
  '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
  '019a4000-0000-7000-8000-000000000004', 'diagnose_support_metadata',
  null, clock_timestamp() + interval '30 days', 'CASE-DIAG-01',
  '019a4000-0000-7000-8000-000000000106', '019a4000-0000-7000-8000-000000000206',
  decode(repeat('26', 32), 'hex')
);

-- An elapsed window is written as one granted earlier whose validity ran out. It
-- belongs to a person who keeps the base role, so nothing else closes it first:
-- revocation is terminal and would otherwise mask the expiry.
insert into support.platform_duty_assignments (
  person_id, duty_code, actor_mode, status, valid_from, valid_to,
  granted_by_person_id, reason_code
) values (
  '019a4000-0000-7000-8000-000000000003', 'view_platform_metrics', 'A10', 'active',
  clock_timestamp() - interval '20 days', clock_timestamp() - interval '1 second',
  '019a4000-0000-7000-8000-000000000001', 'CASE-METRICS-01'
);

-- `manage_platform_access` reads the inventory.
select is(
  (select count(*) from support.list_platform_role_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    50, null, null, null
  )),
  4::bigint,
  'the access manager sees every base role assignment'
);

-- `audit_platform_access` reads the same inventory without administering it.
select is(
  (select count(*) from support.list_platform_role_assignments(
    '019a4000-0000-7000-8000-000000000003', '019a4000-0000-7000-8000-000000000023',
    50, null, null, null
  )),
  4::bigint,
  'the independent auditor sees the same inventory'
);

select throws_ok(
  $$ select support.assign_platform_role(
    '019a4000-0000-7000-8000-000000000003', '019a4000-0000-7000-8000-000000000023',
    '019a4000-0000-7000-8000-000000000002', 'allfit_admin',
    '019a4000-0000-7000-8000-000000000104', '019a4000-0000-7000-8000-000000000204',
    decode(repeat('24', 32), 'hex')
  ) $$,
  '42501',
  'platform access management requires an effective duty',
  'reading the inventory never confers the authority to change it'
);

-- T-ROLE-4 · the base role alone reads nothing.
select throws_ok(
  $$ select * from support.list_platform_role_assignments(
    '019a4000-0000-7000-8000-000000000004', '019a4000-0000-7000-8000-000000000024',
    50, null, null, null
  ) $$,
  '42501',
  'reading platform access requires an effective duty',
  'a base role without a reading duty cannot open the inventory'
);

select throws_ok(
  $$ select * from support.list_platform_duty_assignments(
    '019a4000-0000-7000-8000-000000000004', '019a4000-0000-7000-8000-000000000024',
    null, null, null, 50, null, null, null, null
  ) $$,
  '42501',
  'reading platform access requires an effective duty',
  'the duty inventory fails closed for the same actor'
);

-- The duty is resolved for the person the session belongs to, never for the
-- person named in the call, so a mismatched pair resolves nothing.
select throws_ok(
  $$ select * from support.list_platform_duty_assignments(
    '019a4000-0000-7000-8000-000000000003', '019a4000-0000-7000-8000-000000000021',
    null, null, null, 50, null, null, null, null
  ) $$,
  '42501',
  'reading platform access requires an effective duty',
  'an actor paired with a session that is not theirs fails closed'
);

select throws_ok(
  $$ select * from support.list_platform_role_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    0, null, null, null
  ) $$,
  '22023',
  'invalid limit',
  'the page size is bounded below'
);

select throws_ok(
  $$ select * from support.list_platform_duty_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    null, null, null, 102, null, null, null, null
  ) $$,
  '22023',
  'invalid limit',
  'the page size is bounded above'
);

-- Effective assignments come first; the grantor and the moment travel with them.
select is(
  (select (result->>'status') from support.list_platform_role_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    1, null, null, null
  )),
  'active',
  'the inventory orders effective assignments before retired ones'
);

select ok(
  (select (result ? 'granted_by_person_id') and (result ? 'granted_at')
    from support.list_platform_role_assignments(
      '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
      1, null, null, null
    )),
  'each row carries who granted the role and when'
);

-- Criterion 1: who holds the base role today and who held it before.
select lives_ok(
  $$ select support.revoke_platform_role(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    (select id from support.platform_role_assignments
      where person_id = '019a4000-0000-7000-8000-000000000004' and status = 'active'),
    '019a4000-0000-7000-8000-000000000105', '019a4000-0000-7000-8000-000000000205',
    decode(repeat('25', 32), 'hex')
  ) $$,
  'the manager withdraws one base role'
);

select is(
  (select count(*) from support.list_platform_role_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    50, null, null, null
  ) where result->>'status' = 'revoked'),
  1::bigint,
  'a withdrawn base role stays in the inventory as history'
);

select is(
  (select count(*) from support.list_platform_role_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    50, null, null, null
  )),
  4::bigint,
  'withdrawing changes the state of a row, never the number of rows'
);

-- Criterion 2: every duty state, with window, AAL, grantor and recertification.
select is(
  (select count(*) from support.list_platform_duty_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    null, null, null, 50, null, null, null, null
  )),
  5::bigint,
  'the duty inventory covers effective, elapsed and revoked assignments'
);

select ok(
  (select bool_and(
      (result ? 'valid_from') and (result ? 'valid_to') and (result ? 'required_aal')
      and (result ? 'granted_by_person_id') and (result ? 'recertified_at')
      and (result ? 'suspended_at') and (result ? 'revoked_at')
    )
    from support.list_platform_duty_assignments(
      '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
      null, null, null, 50, null, null, null, null
    )),
  'each duty row carries its window, AAL, grantor and recertification'
);

select is(
  (select count(*) from support.list_platform_duty_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    '019a4000-0000-7000-8000-000000000003', null, null, 50, null, null, null, null
  )),
  2::bigint,
  'the inventory filters by person'
);

select is(
  (select count(*) from support.list_platform_duty_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    null, 'manage_platform_access', null, 50, null, null, null, null
  )),
  2::bigint,
  'the inventory filters by duty code'
);

select is(
  (select (result->>'duty_code') from support.list_platform_duty_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    null, null, 'expired', 50, null, null, null, null
  )),
  'view_platform_metrics',
  'filtering by state reports an elapsed window as expired with no job involved'
);

select is(
  (select count(*) from support.list_platform_duty_assignments(
    '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
    null, null, 'revoked', 50, null, null, null, null
  )),
  1::bigint,
  'withdrawing the base role left its duty visible as revoked'
);

-- The cursor advances without repeating or skipping a row.
select is(
  (select count(distinct value)
    from (
      select (result->>'id') as value from support.list_platform_duty_assignments(
        '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
        null, null, null, 2, null, null, null, null
      )
      union all
      select (page.result->>'id') from support.list_platform_duty_assignments(
        '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
        null, null, null, 2,
        (select first.cursor_rank from support.list_platform_duty_assignments(
          '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
          null, null, null, 2, null, null, null, null
        ) as first offset 1 limit 1),
        (select first.cursor_valid_to from support.list_platform_duty_assignments(
          '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
          null, null, null, 2, null, null, null, null
        ) as first offset 1 limit 1),
        (select first.cursor_created_at from support.list_platform_duty_assignments(
          '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
          null, null, null, 2, null, null, null, null
        ) as first offset 1 limit 1),
        (select first.cursor_id from support.list_platform_duty_assignments(
          '019a4000-0000-7000-8000-000000000001', '019a4000-0000-7000-8000-000000000021',
          null, null, null, 2, null, null, null, null
        ) as first offset 1 limit 1)
      ) as page
    ) as pages),
  4::bigint,
  'two cursor pages of two return four distinct assignments'
);

-- Minimal grants: the inventory is reachable only through its closed functions.
select ok(
  has_function_privilege(
    'allfit_api',
    'support.list_platform_role_assignments(uuid,uuid,integer,integer,timestamptz,uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'allfit_api',
      'support.list_platform_duty_assignments(uuid,uuid,uuid,text,text,integer,integer,timestamptz,timestamptz,uuid)',
      'EXECUTE'
    ),
  'the runtime role executes both inventory queries'
);

select ok(
  not has_function_privilege(
    'allfit_api',
    'support.require_platform_access_reader(uuid,uuid)',
    'EXECUTE'
  )
    and not has_table_privilege('allfit_api', 'support.platform_duty_assignments', 'SELECT'),
  'the runtime role can neither select the tables nor call the guard on its own'
);

select * from finish();
rollback;
