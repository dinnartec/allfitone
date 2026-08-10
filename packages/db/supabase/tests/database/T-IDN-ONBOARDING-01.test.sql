begin;

select plan(10);

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('0198d000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'onboarding_one'),
  ('0198d000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'onboarding_two');

create temporary table test_people_before as
select count(*) as people_count
from identity.people;

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '0198d000-0000-7000-8000-000000000011', true);

create temporary table test_attempt as
select *
from identity.start_onboarding_attempt(
  '0198d000-0000-7000-8000-000000000011',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111112',
  decode(repeat('11', 32), 'hex')
);

select is((select status from test_attempt), 'open', 'T-IDN-IDEM-01 starts one open attempt');
select is((select eligibility_status from test_attempt), 'pending', 'a new attempt has no eligibility evidence');
select is(
  (select attempt_id from identity.start_onboarding_attempt(
    '0198d000-0000-7000-8000-000000000011',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111112',
    decode(repeat('11', 32), 'hex')
  )),
  (select attempt_id from test_attempt),
  'replaying the command returns the same attempt'
);
select is(
  (select result from identity.record_adult_eligibility(
    '0198d000-0000-7000-8000-000000000011',
    (select attempt_id from test_attempt),
    true,
    '11111111-1111-4111-8111-111111111121',
    '11111111-1111-4111-8111-111111111122',
    decode(repeat('12', 32), 'hex')
  )),
  'pass',
  'T-IDN-INT-01 records the versioned adult declaration'
);

create temporary table test_person as
select identity.activate_person(
  '0198d000-0000-7000-8000-000000000011',
  (select attempt_id from test_attempt),
  'Ada',
  'Lovelace',
  true,
  true,
  '11111111-1111-4111-8111-111111111131',
  '11111111-1111-4111-8111-111111111132',
  decode(repeat('13', 32), 'hex')
) as person_id;

select is((select count(*) from test_person), 1::bigint, 'activation returns one canonical person');
select is(
  (select person_id from identity.access_accounts where id = '0198d000-0000-7000-8000-000000000011'),
  (select person_id from test_person),
  'activation links the access account atomically'
);
select is(
  identity.activate_person(
    '0198d000-0000-7000-8000-000000000011',
    (select attempt_id from test_attempt),
    'Ada',
    'Lovelace',
    true,
    true,
    '11111111-1111-4111-8111-111111111131',
    '11111111-1111-4111-8111-111111111132',
    decode(repeat('13', 32), 'hex')
  ),
  (select person_id from test_person),
  'replaying completion never creates another person'
);
reset role;
select is(
  (select count(*) from identity.people),
  (select people_count + 1 from test_people_before),
  'only one person exists after completion replay'
);

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '0198d000-0000-7000-8000-000000000012', true);
select is_empty(
  $$ select id from identity.onboarding_attempts $$,
  'T-IDN-RLS-02 another account cannot read the first account attempt'
);
select throws_ok(
  $$ insert into identity.onboarding_attempts (account_id, expires_at) values ('0198d000-0000-7000-8000-000000000012', clock_timestamp() + interval '1 hour') $$,
  '42501',
  null,
  'allfit_api cannot insert onboarding attempts directly'
);

reset role;
select * from finish();
rollback;
