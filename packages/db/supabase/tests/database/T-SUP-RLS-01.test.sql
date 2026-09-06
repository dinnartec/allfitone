-- T-SUP-RLS-01 — PR-28: platform base role and duty administration.
--
-- Covers T-ROLE-1..5 and T-DUTY-01..08: no self-assignment, never zero active
-- administrators, an append-only history with no DELETE, the closed catalogue
-- with its derived actor mode, the ninety-day bound, and a base role that
-- authorizes nothing on its own.

begin;

select plan(36);

insert into identity.people (id, given_name, family_name)
values
  ('019a3000-0000-7000-8000-000000000001', 'Manager', 'Alpha'),
  ('019a3000-0000-7000-8000-000000000002', 'Manager', 'Beta'),
  ('019a3000-0000-7000-8000-000000000003', 'Operator', 'Gamma'),
  ('019a3000-0000-7000-8000-000000000004', 'Outsider', 'Delta'),
  ('019a3000-0000-7000-8000-000000000005', 'Unbadged', 'Epsilon');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a3000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha', null),
  ('019a3000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta', null),
  ('019a3000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma',
    '019a3000-0000-7000-8000-000000000003');

select support.bootstrap_backoffice_administrators(
  '019a3000-0000-7000-8000-000000000001', 'alpha',
  '019a3000-0000-7000-8000-000000000002', 'beta',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-SUP-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019a3000-0000-7000-8000-000000000021', '019a3000-0000-7000-8000-000000000011',
    'sid_alpha', 'backoffice', decode(repeat('a1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a3000-0000-7000-8000-000000000023', '019a3000-0000-7000-8000-000000000013',
    'sid_gamma', 'backoffice', decode(repeat('a3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

-- T-ROLE-1 · the database refuses a self-granted role, not the application.
select throws_ok(
  $$ insert into support.platform_role_assignments (person_id, platform_role, granted_by_person_id)
     values ('019a3000-0000-7000-8000-000000000004', 'allfit_admin',
             '019a3000-0000-7000-8000-000000000004') $$,
  '23514',
  null,
  'a CHECK rejects a self-granted base role on a direct insert'
);

-- T-ROLE-3 / T-DUTY-08 · retiring never deletes and never rewrites the grant.
select throws_ok(
  $$ delete from support.platform_role_assignments
     where person_id = '019a3000-0000-7000-8000-000000000001' $$,
  '23514',
  'platform access history cannot be deleted',
  'the base role history cannot be deleted'
);

select throws_ok(
  $$ delete from support.platform_duty_assignments
     where person_id = '019a3000-0000-7000-8000-000000000001' $$,
  '23514',
  'platform access history cannot be deleted',
  'the duty history cannot be deleted'
);

select throws_ok(
  $$ update support.platform_role_assignments
     set granted_by_person_id = '019a3000-0000-7000-8000-000000000003'
     where person_id = '019a3000-0000-7000-8000-000000000001' $$,
  '23514',
  'platform role history is append-only',
  'the grantor recorded on a base role cannot be rewritten'
);

select throws_ok(
  $$ update support.platform_duty_assignments
     set valid_to = clock_timestamp() + interval '365 days'
     where person_id = '019a3000-0000-7000-8000-000000000001' $$,
  '23514',
  'platform duty history is append-only',
  'a granted duty window cannot be widened after the fact'
);

-- T-ROLE-4 / T-DUTY-01 · the base role alone authorizes nothing.
select lives_ok(
  $$ select support.grant_platform_role(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000004', 'allfit_admin',
    '019a3000-0000-7000-8000-000000000101', '019a3000-0000-7000-8000-000000000201',
    decode(repeat('01', 32), 'hex')
  ) $$,
  'an access manager grants the base role to another active person'
);

select support.grant_platform_role(
  '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
  '019a3000-0000-7000-8000-000000000003', 'allfit_admin',
  '019a3000-0000-7000-8000-000000000102', '019a3000-0000-7000-8000-000000000202',
  decode(repeat('02', 32), 'hex')
);

select ok(
  access_control.has_platform_role(
    '019a3000-0000-7000-8000-000000000003', '019a3000-0000-7000-8000-000000000023', 'allfit_admin'
  ),
  'a granted base role resolves for its own AAL2 Backoffice session'
);

select ok(
  not access_control.has_platform_duty(
    '019a3000-0000-7000-8000-000000000003', '019a3000-0000-7000-8000-000000000023',
    'manage_platform_access'
  ),
  'a base role without a duty resolves no authority'
);

select throws_ok(
  $$ select support.grant_platform_role(
    '019a3000-0000-7000-8000-000000000003', '019a3000-0000-7000-8000-000000000023',
    '019a3000-0000-7000-8000-000000000004', 'allfit_admin',
    '019a3000-0000-7000-8000-000000000103', '019a3000-0000-7000-8000-000000000203',
    decode(repeat('03', 32), 'hex')
  ) $$,
  '42501',
  'platform access management requires an effective duty',
  'a base role without manage_platform_access cannot administer access'
);

-- T-ROLE-1 through the closed function, with a precise answer.
select throws_ok(
  $$ select support.grant_platform_role(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000001', 'allfit_admin',
    '019a3000-0000-7000-8000-000000000104', '019a3000-0000-7000-8000-000000000204',
    decode(repeat('04', 32), 'hex')
  ) $$,
  '42501',
  'a platform role is never self-assigned',
  'the closed function refuses a self-granted base role'
);

select throws_ok(
  $$ select support.grant_platform_role(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000003', 'allfit_support',
    '019a3000-0000-7000-8000-000000000105', '019a3000-0000-7000-8000-000000000205',
    decode(repeat('05', 32), 'hex')
  ) $$,
  '22023',
  'platform role outside the closed catalogue',
  'a role outside the closed catalogue is rejected'
);

-- Repeating the same command converges instead of creating a second grant.
select is(
  (select replayed from support.grant_platform_role(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000003', 'allfit_admin',
    '019a3000-0000-7000-8000-000000000102', '019a3000-0000-7000-8000-000000000202',
    decode(repeat('02', 32), 'hex')
  )),
  true,
  'replaying the grant returns the same assignment without a second row'
);

select is(
  (select count(*) from support.platform_role_assignments
    where person_id = '019a3000-0000-7000-8000-000000000003' and status = 'active'),
  1::bigint,
  'a converged grant leaves exactly one active assignment'
);

-- T-DUTY-04 · the ninety-day bound belongs to the database.
select throws_ok(
  $$ select support.grant_platform_duty(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000003', 'diagnose_support_metadata',
    null, clock_timestamp() + interval '91 days', 'CASE-001',
    '019a3000-0000-7000-8000-000000000106', '019a3000-0000-7000-8000-000000000206',
    decode(repeat('06', 32), 'hex')
  ) $$,
  '22023',
  'invalid platform duty window',
  'a duty lasting more than ninety days is rejected'
);

select throws_ok(
  $$ select support.grant_platform_duty(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000001', 'diagnose_support_metadata',
    null, clock_timestamp() + interval '30 days', 'CASE-002',
    '019a3000-0000-7000-8000-000000000107', '019a3000-0000-7000-8000-000000000207',
    decode(repeat('07', 32), 'hex')
  ) $$,
  '42501',
  'a platform duty is never self-assigned',
  'nobody assigns a duty to themselves'
);

-- Epsilon exists and is active, but was never granted the base role.
select throws_ok(
  $$ select support.grant_platform_duty(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000005', 'diagnose_support_metadata',
    null, clock_timestamp() + interval '30 days', 'CASE-003',
    '019a3000-0000-7000-8000-000000000108', '019a3000-0000-7000-8000-000000000208',
    decode(repeat('08', 32), 'hex')
  ) $$,
  'P0002',
  'a platform duty requires an active base role',
  'a duty cannot be granted to a person without an active base role'
);

-- T-DUTY-02 · the actor mode is derived from the code, never supplied.
select is(
  (select (result->>'actor_mode') from support.grant_platform_duty(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000003', 'diagnose_support_metadata',
    null, clock_timestamp() + interval '30 days', 'CASE-004',
    '019a3000-0000-7000-8000-000000000109', '019a3000-0000-7000-8000-000000000209',
    decode(repeat('09', 32), 'hex')
  )),
  'A10',
  'diagnose_support_metadata derives the ordinary support mode'
);

select is(
  (select (result->>'actor_mode') from support.grant_platform_duty(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000003', 'manage_platform_commercial',
    null, clock_timestamp() + interval '30 days', 'CASE-005',
    '019a3000-0000-7000-8000-00000000020a', '019a3000-0000-7000-8000-00000000030a',
    decode(repeat('0a', 32), 'hex')
  )),
  'A11',
  'manage_platform_commercial derives the curation mode declared by governance'
);

select is(
  (select (result->>'required_aal')::smallint from support.grant_platform_duty(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    '019a3000-0000-7000-8000-000000000003', 'approve_break_glass',
    null, clock_timestamp() + interval '30 days', 'CASE-006',
    '019a3000-0000-7000-8000-00000000020b', '019a3000-0000-7000-8000-00000000030b',
    decode(repeat('0b', 32), 'hex')
  )),
  2::smallint,
  'every duty is born requiring AAL2'
);

select ok(
  access_control.has_platform_duty(
    '019a3000-0000-7000-8000-000000000003', '019a3000-0000-7000-8000-000000000023',
    'diagnose_support_metadata'
  ),
  'an effective duty resolves inside the transaction'
);

-- T-DUTY-04 · suspension cuts authority in the very next resolution.
select lives_ok(
  $$ select support.close_platform_duty(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    (select id from support.platform_duty_assignments
      where person_id = '019a3000-0000-7000-8000-000000000003'
        and duty_code = 'diagnose_support_metadata'),
    'suspended',
    '019a3000-0000-7000-8000-00000000020c', '019a3000-0000-7000-8000-00000000030c',
    decode(repeat('0c', 32), 'hex')
  ) $$,
  'an access manager suspends an effective duty'
);

select ok(
  not access_control.has_platform_duty(
    '019a3000-0000-7000-8000-000000000003', '019a3000-0000-7000-8000-000000000023',
    'diagnose_support_metadata'
  ),
  'a suspended duty stops authorizing immediately'
);

select throws_ok(
  $$ update support.platform_duty_assignments set status = 'active'
     where person_id = '019a3000-0000-7000-8000-000000000003'
       and duty_code = 'diagnose_support_metadata' $$,
  '23514',
  'a suspended platform duty is only expired or revoked',
  'a suspended duty is never silently reopened'
);

-- T-DUTY-04 · expiry is evaluated by the clock, with no job involved.
-- A window elapses with time, not with a command, so the row is written as one
-- that was granted ten days ago and whose validity ran out a second ago.
insert into support.platform_duty_assignments (
  person_id, duty_code, actor_mode, status, valid_from, valid_to,
  granted_by_person_id, reason_code
) values (
  '019a3000-0000-7000-8000-000000000003', 'view_platform_metrics', 'A10', 'active',
  clock_timestamp() - interval '10 days', clock_timestamp() - interval '1 second',
  '019a3000-0000-7000-8000-000000000001', 'CASE-007'
);

select ok(
  not access_control.has_platform_duty(
    '019a3000-0000-7000-8000-000000000003', '019a3000-0000-7000-8000-000000000023',
    'view_platform_metrics'
  ),
  'a duty whose window already closed stops authorizing without any job running'
);

select is(
  (select support.platform_duty_assignment_projection(assignment.id)->>'status'
    from support.platform_duty_assignments as assignment
    where assignment.person_id = '019a3000-0000-7000-8000-000000000003'
      and assignment.duty_code = 'view_platform_metrics'),
  'expired',
  'the projection reports an elapsed window as expired even before a job runs'
);

-- T-DUTY-05 · withdrawing the base role closes duties and sessions.
select lives_ok(
  $$ select support.revoke_platform_role(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    (select id from support.platform_role_assignments
      where person_id = '019a3000-0000-7000-8000-000000000003' and status = 'active'),
    '019a3000-0000-7000-8000-00000000020d', '019a3000-0000-7000-8000-00000000030d',
    decode(repeat('0d', 32), 'hex')
  ) $$,
  'an access manager withdraws the base role from another person'
);

select is(
  (select count(*) from support.platform_duty_assignments
    where person_id = '019a3000-0000-7000-8000-000000000003'
      and status in ('scheduled', 'active', 'suspended')),
  0::bigint,
  'withdrawing the base role closes every effective duty'
);

select ok(
  (select revoked_at is not null from identity.access_sessions
    where id = '019a3000-0000-7000-8000-000000000023'),
  'withdrawing the base role revokes the Backoffice session'
);

select is(
  (select count(*) from support.platform_duty_assignments
    where person_id = '019a3000-0000-7000-8000-000000000003'),
  4::bigint,
  'withdrawal keeps the whole duty history instead of deleting it'
);

-- T-ROLE-2 · the Backoffice never ends up without an administrator.
select lives_ok(
  $$ select support.revoke_platform_role(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    (select id from support.platform_role_assignments
      where person_id = '019a3000-0000-7000-8000-000000000002' and status = 'active'),
    '019a3000-0000-7000-8000-00000000020e', '019a3000-0000-7000-8000-00000000030e',
    decode(repeat('0e', 32), 'hex')
  ) $$,
  'one of two remaining administrators can still be withdrawn'
);

select throws_ok(
  $$ select support.revoke_platform_role(
    '019a3000-0000-7000-8000-000000000004', '019a3000-0000-7000-8000-000000000021',
    (select id from support.platform_role_assignments
      where person_id = '019a3000-0000-7000-8000-000000000001' and status = 'active'),
    '019a3000-0000-7000-8000-00000000020f', '019a3000-0000-7000-8000-00000000030f',
    decode(repeat('0f', 32), 'hex')
  ) $$,
  '42501',
  'platform access management requires an effective duty',
  'an actor paired with a session that is not theirs fails closed'
);

-- Delta holds the base role from the earlier grant, so Alpha is the last
-- administrator only once Delta is withdrawn too.
select lives_ok(
  $$ select support.revoke_platform_role(
    '019a3000-0000-7000-8000-000000000001', '019a3000-0000-7000-8000-000000000021',
    (select id from support.platform_role_assignments
      where person_id = '019a3000-0000-7000-8000-000000000004' and status = 'active'),
    '019a3000-0000-7000-8000-000000000210', '019a3000-0000-7000-8000-000000000310',
    decode(repeat('10', 32), 'hex')
  ) $$,
  'the second-to-last administrator can still be withdrawn'
);

select throws_ok(
  $$ update support.platform_role_assignments
     set status = 'revoked',
         revoked_by_person_id = '019a3000-0000-7000-8000-000000000004',
         revoked_at = clock_timestamp()
     where person_id = '019a3000-0000-7000-8000-000000000001' and status = 'active' $$,
  '23514',
  'cannot revoke the last platform administrator',
  'the last active administrator cannot be withdrawn even by a direct update'
);

-- Minimal grants: the runtime role reaches the tables only through the commands.
select ok(
  not has_table_privilege('allfit_api', 'support.platform_role_assignments', 'SELECT')
    and not has_table_privilege('allfit_api', 'support.platform_role_assignments', 'INSERT')
    and not has_table_privilege('allfit_api', 'support.platform_role_assignments', 'UPDATE')
    and not has_table_privilege('allfit_api', 'support.platform_role_assignments', 'DELETE'),
  'the runtime role holds no direct privilege on base role assignments'
);

select ok(
  not has_table_privilege('allfit_api', 'support.platform_duty_assignments', 'SELECT')
    and not has_table_privilege('allfit_api', 'support.platform_duty_assignments', 'INSERT')
    and not has_table_privilege('allfit_api', 'support.platform_duty_assignments', 'UPDATE')
    and not has_table_privilege('allfit_api', 'support.platform_duty_assignments', 'DELETE'),
  'the runtime role holds no direct privilege on duty assignments'
);

select ok(
  has_function_privilege(
    'allfit_api',
    'support.grant_platform_role(uuid,uuid,uuid,text,uuid,uuid,bytea)',
    'EXECUTE'
  )
    and has_function_privilege(
      'allfit_api',
      'support.close_platform_duty(uuid,uuid,uuid,text,uuid,uuid,bytea)',
      'EXECUTE'
    ),
  'the runtime role executes the closed platform access commands'
);

select * from finish();
rollback;
