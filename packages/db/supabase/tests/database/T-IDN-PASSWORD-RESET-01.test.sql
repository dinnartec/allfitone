begin;

select plan(11);

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('0199a000-0000-7000-8000-000000000001', 'workos', 'https://issuer.test', 'user_reset'),
  ('0199a000-0000-7000-8000-000000000002', 'workos', 'https://other-issuer.test', 'user_reset');

insert into identity.access_sessions (
  id,
  access_account_id,
  provider_session_id,
  surface,
  token_hash,
  token_ciphertext,
  access_token_expires_at,
  created_at
)
values
  (
    '0199a000-0000-7000-8000-000000000011',
    '0199a000-0000-7000-8000-000000000001',
    'session_old_one',
    'studio',
    decode(repeat('11', 32), 'hex'),
    'v1.old-one',
    '2026-08-10 13:00:00+00',
    '2026-08-10 11:00:00+00'
  ),
  (
    '0199a000-0000-7000-8000-000000000012',
    '0199a000-0000-7000-8000-000000000001',
    'session_old_two',
    'studio',
    decode(repeat('12', 32), 'hex'),
    'v1.old-two',
    '2026-08-10 13:00:00+00',
    '2026-08-10 11:30:00+00'
  ),
  (
    '0199a000-0000-7000-8000-000000000013',
    '0199a000-0000-7000-8000-000000000001',
    'session_after_reset',
    'studio',
    decode(repeat('13', 32), 'hex'),
    'v1.after-reset',
    '2026-08-10 13:00:00+00',
    '2026-08-10 12:01:00+00'
  ),
  (
    '0199a000-0000-7000-8000-000000000014',
    '0199a000-0000-7000-8000-000000000002',
    'session_other_issuer',
    'studio',
    decode(repeat('14', 32), 'hex'),
    'v1.other-issuer',
    '2026-08-10 13:00:00+00',
    '2026-08-10 11:00:00+00'
  );

set local role allfit_api;

select results_eq(
  $$
    select outcome, revoked_session_count, replayed
    from identity.process_password_reset_succeeded(
      'workos', 'https://issuer.test', 'event_reset', 'user_reset', '2026-08-10 12:00:00+00'
    )
  $$,
  $$ values ('processed'::text, 2, false) $$,
  'a successful reset revokes every older active local session'
);

select is_empty(
  $$ select session_id from identity.load_access_session(decode(repeat('11', 32), 'hex'), 'studio') $$,
  'the first revoked session can no longer be loaded'
);

select is_empty(
  $$ select session_id from identity.load_access_session(decode(repeat('12', 32), 'hex'), 'studio') $$,
  'the second revoked session can no longer be loaded'
);

select is(
  (select provider_session_id from identity.load_access_session(decode(repeat('13', 32), 'hex'), 'studio')),
  'session_after_reset',
  'a session created after the reset remains active'
);

select is(
  (select provider_session_id from identity.load_access_session(decode(repeat('14', 32), 'hex'), 'studio')),
  'session_other_issuer',
  'the same subject under a different issuer is not affected'
);

select results_eq(
  $$
    select outcome, revoked_session_count, replayed
    from identity.process_password_reset_succeeded(
      'workos', 'https://issuer.test', 'event_absent', 'missing_user', '2026-08-10 12:00:00+00'
    )
  $$,
  $$ values ('account_absent'::text, 0, false) $$,
  'an unknown subject converges to account_absent'
);

select results_eq(
  $$
    select outcome, revoked_session_count, replayed
    from identity.process_password_reset_succeeded(
      'workos', 'https://issuer.test', 'event_reset', 'user_reset', '2026-08-10 12:00:00+00'
    )
  $$,
  $$ values ('processed'::text, 2, true) $$,
  'a repeated event returns the durable result without revoking again'
);

select throws_ok(
  $$ insert into identity.password_reset_receipts (provider, issuer, provider_event_id, occurred_at) values ('workos', 'x', 'forged', now()) $$,
  '42501',
  null,
  'allfit_api cannot write receipts directly'
);

select throws_ok(
  $$ update identity.access_sessions set revoked_at = null $$,
  '42501',
  null,
  'allfit_api cannot write session rows directly'
);

select ok(
  has_function_privilege(
    'allfit_api',
    'identity.process_password_reset_succeeded(text, text, text, text, timestamptz)',
    'EXECUTE'
  ),
  'the runtime can execute only the processing function'
);

reset role;

select is(
  (select count(*) from identity.password_reset_receipts),
  2::bigint,
  'replay produces one receipt while the absent account has its own receipt'
);

select * from finish();
rollback;
