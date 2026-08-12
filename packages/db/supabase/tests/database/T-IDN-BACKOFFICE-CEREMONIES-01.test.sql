begin;

select plan(16);

select ok(
  pg_has_role('postgres', 'allfit_migrator', 'SET'),
  'the protected workflow connection can narrow itself to allfit_migrator'
);

select ok(
  (
    select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'support'
      and procedure.proname = 'require_active_platform_role_for_duty'
      and procedure.pronargs = 0
  ),
  'the deferred duty invariant keeps workflow table access inside its security definer'
);

insert into identity.people (id, given_name, family_name)
values
  ('019a2000-0000-7000-8000-000000000001', 'Admin', 'Alpha'),
  ('019a2000-0000-7000-8000-000000000002', 'Admin', 'Beta'),
  ('019a2000-0000-7000-8000-000000000003', 'Subject', 'Recovery');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a2000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'bootstrap_a', null),
  ('019a2000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'bootstrap_b', null),
  ('019a2000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'recovery_subject', '019a2000-0000-7000-8000-000000000003');

select throws_ok(
  $$ select support.bootstrap_backoffice_administrators(
    '019a2000-0000-7000-8000-000000000001', 'bootstrap_a',
    '019a2000-0000-7000-8000-000000000002', 'bootstrap_b',
    'https://issuer.test', clock_timestamp() + interval '91 days', 'CEREMONY-TOO-LONG'
  ) $$,
  '22023',
  null,
  'bootstrap refuses authority lasting more than ninety days'
);

select lives_ok(
  $$ select support.bootstrap_backoffice_administrators(
    '019a2000-0000-7000-8000-000000000001', 'bootstrap_a',
    '019a2000-0000-7000-8000-000000000002', 'bootstrap_b',
    'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-001'
  ) $$,
  'the protected bootstrap links two existing people and accounts atomically'
);

select is(
  (select count(*) from identity.access_accounts
    where id in ('019a2000-0000-7000-8000-000000000011', '019a2000-0000-7000-8000-000000000012')
      and person_id is not null),
  2::bigint,
  'bootstrap links both WorkOS accounts to their active people'
);

select is(
  (select count(*) from support.platform_role_assignments
    where person_id in ('019a2000-0000-7000-8000-000000000001', '019a2000-0000-7000-8000-000000000002')
      and status = 'active' and granted_by_person_id <> person_id),
  2::bigint,
  'bootstrap creates two crossed base-role assignments'
);

select is(
  (select count(*) from support.platform_duty_assignments
    where person_id in ('019a2000-0000-7000-8000-000000000001', '019a2000-0000-7000-8000-000000000002')
      and duty_code = 'manage_platform_access' and status = 'active'
      and granted_by_person_id <> person_id),
  2::bigint,
  'bootstrap creates two crossed and temporary access-management duties'
);

select ok(
  not has_function_privilege(
    'allfit_api',
    'support.bootstrap_backoffice_administrators(uuid,text,uuid,text,text,timestamptz,text)',
    'EXECUTE'
  ),
  'runtime cannot execute the bootstrap ceremony'
);

select ok(
  not has_function_privilege(
    'allfit_api',
    'identity.recover_backoffice_totp_factor(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'runtime cannot execute TOTP recovery'
);

insert into identity.access_account_mfa_factors (
  id, access_account_id, provider_factor_id, status, verified_at
) values (
  '019a2000-0000-7000-8000-000000000021',
  '019a2000-0000-7000-8000-000000000013',
  'factor_recovery',
  'active',
  clock_timestamp()
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values (
  '019a2000-0000-7000-8000-000000000031',
  '019a2000-0000-7000-8000-000000000013',
  'sid_recovery',
  'backoffice',
  decode(repeat('55', 32), 'hex'),
  'v1.session',
  clock_timestamp() + interval '5 minutes',
  2,
  'password_totp',
  clock_timestamp(),
  clock_timestamp(),
  clock_timestamp() + interval '8 hours'
);

insert into identity.backoffice_authentication_attempts (
  id, access_account_id, factor_id, provider_session_id, provider_challenge_id,
  attempt_token_hash, secret_ciphertext, access_token_expires_at, status, expires_at
) values (
  '019a2000-0000-7000-8000-000000000041',
  '019a2000-0000-7000-8000-000000000013',
  '019a2000-0000-7000-8000-000000000021',
  'sid_attempt_recovery',
  'challenge_recovery',
  decode(repeat('66', 32), 'hex'),
  'v1.attempt',
  clock_timestamp() + interval '5 minutes',
  'pending_challenge',
  clock_timestamp() + interval '10 minutes'
);

select throws_ok(
  $$ select identity.recover_backoffice_totp_factor(
    '019a2000-0000-7000-8000-000000000003',
    '019a2000-0000-7000-8000-000000000001',
    '019a2000-0000-7000-8000-000000000001',
    'RECOVERY-INVALID'
  ) $$,
  '42501',
  null,
  'one administrator cannot fill both recovery approvals'
);

select lives_ok(
  $$ select identity.recover_backoffice_totp_factor(
    '019a2000-0000-7000-8000-000000000003',
    '019a2000-0000-7000-8000-000000000001',
    '019a2000-0000-7000-8000-000000000002',
    'RECOVERY-001'
  ) $$,
  'two independent administrators can complete the protected recovery'
);

select is(
  (select status::text from identity.access_account_mfa_factors
    where id = '019a2000-0000-7000-8000-000000000021'),
  'revoked',
  'recovery revokes the active TOTP factor'
);

select ok(
  (select revoked_at is not null from identity.access_sessions
    where id = '019a2000-0000-7000-8000-000000000031'),
  'recovery revokes every Backoffice session for the account'
);

select ok(
  (select status = 'failed' and terminal_at is not null and secret_ciphertext is null
    from identity.backoffice_authentication_attempts
    where id = '019a2000-0000-7000-8000-000000000041'),
  'recovery terminates pending attempts and removes their encrypted material'
);

select is(
  (select count(*) from identity.mfa_factor_recovery_events
    where factor_id = '019a2000-0000-7000-8000-000000000021'
      and ceremony_reference = 'RECOVERY-001'),
  1::bigint,
  'recovery preserves exactly one immutable evidence row'
);

select is(
  (select count(*) from system.outbox_events
    where event_type in (
      'identity.backoffice_factor_cleanup_requested.v1',
      'identity.backoffice_session_revocation_requested.v1',
      'identity.backoffice_auth_cleanup_requested.v1'
    )
      and aggregate_id in (
        '019a2000-0000-7000-8000-000000000021',
        '019a2000-0000-7000-8000-000000000031',
        '019a2000-0000-7000-8000-000000000041'
      )),
  3::bigint,
  'factor, session and attempt cleanup are all committed to the outbox'
);

select * from finish();
rollback;
