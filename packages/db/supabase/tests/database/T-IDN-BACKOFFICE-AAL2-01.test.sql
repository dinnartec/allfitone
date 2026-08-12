begin;

select plan(20);

insert into identity.people (id, given_name, family_name)
values
  ('019a1000-0000-7000-8000-000000000001', 'Ada', 'Admin'),
  ('019a1000-0000-7000-8000-000000000002', 'Grace', 'Approver');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a1000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'user_admin', '019a1000-0000-7000-8000-000000000001'),
  ('019a1000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'user_approver', '019a1000-0000-7000-8000-000000000002');

insert into support.platform_role_assignments (person_id, platform_role, granted_by_person_id)
values
  ('019a1000-0000-7000-8000-000000000001', 'allfit_admin', '019a1000-0000-7000-8000-000000000002'),
  ('019a1000-0000-7000-8000-000000000002', 'allfit_admin', '019a1000-0000-7000-8000-000000000001');

insert into support.platform_duty_assignments (
  person_id, duty_code, actor_mode, status, valid_from, valid_to, granted_by_person_id, reason_code
) values (
  '019a1000-0000-7000-8000-000000000001', 'manage_platform_access', 'A12', 'active',
  clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 day',
  '019a1000-0000-7000-8000-000000000002', 'test-ceremony'
);

set local role allfit_api;

select is(
  (select account_id from identity.resolve_backoffice_account('workos', 'https://issuer.test', 'user_admin')),
  '019a1000-0000-7000-8000-000000000011'::uuid,
  'an active person with the base role is eligible'
);

select is_empty(
  $$ select account_id from identity.resolve_backoffice_account('workos', 'https://issuer.test', 'missing') $$,
  'an unknown account is indistinguishable from an ineligible account'
);

select lives_ok(
  $$
    select * from identity.start_backoffice_authentication_attempt(
      '019a1000-0000-7000-8000-000000000011', 'factor_bad', true,
      'provider_session_bad', 'challenge_bad', decode(repeat('11', 32), 'hex'),
      'v1.encrypted-attempt', clock_timestamp() + interval '5 minutes',
      'pending_enrollment', clock_timestamp() + interval '10 minutes'
    )
  $$,
  'first sign-in creates a pending enrollment attempt'
);

select is(
  (select factor_status::text from identity.load_backoffice_authentication_attempt(decode(repeat('11', 32), 'hex'))),
  'pending',
  'the provider factor is persisted as pending until TOTP verifies'
);

select lives_ok(
  $$ select identity.bind_backoffice_totp_verification(
    decode(repeat('11', 32), 'hex'),
    '82daa5c9-605d-457f-b989-74decf1fb12a',
    '019ff263-2eba-74f0-a49d-b858bc8a96b4'
  ) $$,
  'the external one-time challenge is bound to one durable command before verification'
);

select throws_ok(
  $$ select identity.bind_backoffice_totp_verification(
    decode(repeat('11', 32), 'hex'),
    'e604fb45-d682-4c7c-8aea-6b1da42f3789',
    '019ff263-2eba-74f0-a49d-b858bc8a96b5'
  ) $$,
  '23505',
  null,
  'a consumed provider challenge cannot be attached to another command'
);

select is(
  (select remaining_attempts from identity.record_backoffice_totp_failure(decode(repeat('11', 32), 'hex'))),
  4::smallint,
  'an invalid code decrements the closed attempt allowance'
);

select lives_ok(
  $$ select identity.bind_backoffice_totp_verification(
    decode(repeat('11', 32), 'hex'),
    'e604fb45-d682-4c7c-8aea-6b1da42f3789',
    '019ff263-2eba-74f0-a49d-b858bc8a96b5'
  ) $$,
  'a confirmed invalid code releases the command binding for the next code attempt'
);
do $test$
begin
  perform identity.record_backoffice_totp_failure(decode(repeat('11', 32), 'hex'));
  perform identity.record_backoffice_totp_failure(decode(repeat('11', 32), 'hex'));
  perform identity.record_backoffice_totp_failure(decode(repeat('11', 32), 'hex'));
end
$test$;
select is(
  (select terminal from identity.record_backoffice_totp_failure(decode(repeat('11', 32), 'hex'))),
  true,
  'the fifth invalid code terminates the attempt'
);

select is_empty(
  $$ select attempt_id from identity.load_backoffice_authentication_attempt(decode(repeat('11', 32), 'hex')) $$,
  'a failed attempt no longer exposes encrypted provider material'
);

select lives_ok(
  $$
    select * from identity.start_backoffice_authentication_attempt(
      '019a1000-0000-7000-8000-000000000011', 'factor_good', true,
      'provider_session_good', 'challenge_good', decode(repeat('22', 32), 'hex'),
      'v1.encrypted-attempt', clock_timestamp() + interval '5 minutes',
      'pending_enrollment', clock_timestamp() + interval '10 minutes'
    )
  $$,
  'a later correct password can begin a fresh factor enrollment'
);

do $test$
begin
  perform identity.bind_backoffice_totp_verification(
    decode(repeat('22', 32), 'hex'),
    '82daa5c9-605d-457f-b989-74decf1fb12a',
    '019ff263-2eba-74f0-a49d-b858bc8a96b4'
  );
end
$test$;

create temporary table completed_backoffice_session as
select * from identity.complete_backoffice_authentication(
  decode(repeat('22', 32), 'hex'),
  '82daa5c9-605d-457f-b989-74decf1fb12a',
  '019ff263-2eba-74f0-a49d-b858bc8a96b4',
  decode(repeat('33', 32), 'hex'),
  'v1.encrypted-session',
  clock_timestamp() + interval '5 minutes'
);

select is(
  (select assurance_level from identity.load_backoffice_access_session(decode(repeat('33', 32), 'hex'))),
  2::smallint,
  'only a completed TOTP ceremony materializes an AAL2 session'
);

select is(
  (select authentication_method from identity.load_backoffice_access_session(decode(repeat('33', 32), 'hex'))),
  'password_totp',
  'the assurance evidence records the closed password_totp method'
);

select ok(
  access_control.has_platform_duty(
    '019a1000-0000-7000-8000-000000000001',
    (select session_id from completed_backoffice_session),
    'manage_platform_access'
  ),
  'a current AAL2 session can exercise an explicitly assigned platform duty'
);

select results_eq(
  $$ select replayed from identity.complete_backoffice_authentication(
    decode(repeat('22', 32), 'hex'),
    '82daa5c9-605d-457f-b989-74decf1fb12a',
    '019ff263-2eba-74f0-a49d-b858bc8a96b4',
    decode(repeat('33', 32), 'hex'), 'v1.encrypted-session', clock_timestamp() + interval '5 minutes'
  ) $$,
  $$ values (true) $$,
  'the same verification command replays without a second session'
);

select results_eq(
  $$ select outcome from identity.logout_backoffice_access_session(decode(repeat('33', 32), 'hex')) $$,
  $$ values ('revoked'::text) $$,
  'logout revokes the local Backoffice session first'
);

select is_empty(
  $$ select session_id from identity.load_backoffice_access_session(decode(repeat('33', 32), 'hex')) $$,
  'a revoked Backoffice session cannot reactivate from its cookie'
);

select throws_ok(
  $$ insert into identity.backoffice_authentication_attempts (
    access_account_id, factor_id, provider_session_id, provider_challenge_id,
    attempt_token_hash, secret_ciphertext, access_token_expires_at, status, expires_at
  ) select access_account_id, id, 'forged', 'forged', decode(repeat('44', 32), 'hex'),
    'v1.forged', clock_timestamp() + interval '1 minute', 'pending_challenge', clock_timestamp() + interval '2 minutes'
    from identity.access_account_mfa_factors where provider_factor_id = 'factor_good' $$,
  '42501',
  null,
  'allfit_api has no direct DML over authentication evidence'
);

select ok(
  not has_table_privilege('allfit_api', 'support.platform_role_assignments', 'SELECT'),
  'the runtime cannot enumerate platform role assignments directly'
);

reset role;

update support.platform_role_assignments
set status = 'revoked', revoked_by_person_id = '019a1000-0000-7000-8000-000000000002', revoked_at = clock_timestamp()
where person_id = '019a1000-0000-7000-8000-000000000001' and status = 'active';

select is_empty(
  $$ select account_id from identity.resolve_backoffice_account('workos', 'https://issuer.test', 'user_admin') $$,
  'revoking the base role immediately removes login eligibility'
);

select * from finish();
rollback;
