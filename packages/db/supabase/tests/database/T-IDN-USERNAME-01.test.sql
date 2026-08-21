begin;

select plan(18);

select has_table('identity', 'usernames', 'T-IDN-PHY-10 the handle and its uniqueness live in one relation');
select has_function('identity', 'record_onboarding_identity',
  'T-USERNAME-0 the onboarding identity is reachable only through a closed command');

select is((
  select count(*)
  from pg_class as relation
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'identity'
    and relation.relname = 'usernames'
    and relation.relrowsecurity
    and relation.relforcerowsecurity
), 1::bigint, 'T-USERNAME-6 the relation enables and forces RLS');

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019f0000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'username_one'),
  ('019f0000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'username_two');

-- Both accounts open an attempt, so the collision is between two real onboardings.
set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f0000-0000-7000-8000-000000000011', true);

create temporary table test_attempt_one as
select attempt_id
from identity.start_onboarding_attempt(
  '019f0000-0000-7000-8000-000000000011',
  '21111111-1111-4111-8111-111111111111',
  '21111111-1111-4111-8111-111111111112',
  decode(repeat('21', 32), 'hex')
);

create temporary table test_identity as
select *
from identity.record_onboarding_identity(
  '019f0000-0000-7000-8000-000000000011',
  (select attempt_id from test_attempt_one),
  'Ada',
  'Lovelace',
  'ada_lovelace',
  '21111111-1111-4111-8111-111111111121',
  '21111111-1111-4111-8111-111111111122',
  decode(repeat('22', 32), 'hex')
);

select is((select username from test_identity), 'ada_lovelace',
  'T-USERNAME-1 an account reserves a free handle against its own open attempt');
select is((select given_name || ' ' || family_name from test_identity), 'Ada Lovelace',
  'the declared name is stored on the attempt, where activation will read it');

select is(
  (select count(*) from identity.usernames
    where username = 'ada_lovelace'
      and onboarding_attempt_id = (select attempt_id from test_attempt_one)
      and person_id is null),
  1::bigint,
  'the reservation belongs to the attempt, because no person exists yet'
);

select is(
  (select username from identity.record_onboarding_identity(
    '019f0000-0000-7000-8000-000000000011',
    (select attempt_id from test_attempt_one),
    'Ada',
    'Lovelace',
    'ada_lovelace',
    '21111111-1111-4111-8111-111111111121',
    '21111111-1111-4111-8111-111111111122',
    decode(repeat('22', 32), 'hex')
  )),
  'ada_lovelace',
  'T-IDN-IDEM-10 replaying the command returns the same reservation'
);

-- Correcting the handle has to release the previous one, or a person could
-- silently hoard handles by retyping.
select is(
  (select username from identity.record_onboarding_identity(
    '019f0000-0000-7000-8000-000000000011',
    (select attempt_id from test_attempt_one),
    'Ada',
    'Lovelace',
    'ada_byron',
    '21111111-1111-4111-8111-111111111131',
    '21111111-1111-4111-8111-111111111132',
    decode(repeat('23', 32), 'hex')
  )),
  'ada_byron',
  'correcting the handle reserves the new one'
);
select is((select count(*) from identity.usernames where username = 'ada_lovelace'), 0::bigint,
  'and releases the previous one instead of keeping both');

select throws_ok(
  $$ select identity.record_onboarding_identity(
       '019f0000-0000-7000-8000-000000000011',
       (select attempt_id from test_attempt_one),
       'Ada',
       'Lovelace',
       'Ada Byron!',
       '21111111-1111-4111-8111-111111111141',
       '21111111-1111-4111-8111-111111111142',
       decode(repeat('24', 32), 'hex')
     ) $$,
  '23514',
  null,
  'T-USERNAME-5 a malformed handle is refused by a constraint, not only by the application'
);

-- The second account: collision, isolation, and no side effect on the owner.
select set_config('app.actor_account_id', '019f0000-0000-7000-8000-000000000012', true);

create temporary table test_attempt_two as
select attempt_id
from identity.start_onboarding_attempt(
  '019f0000-0000-7000-8000-000000000012',
  '21111111-1111-4111-8111-111111111211',
  '21111111-1111-4111-8111-111111111212',
  decode(repeat('25', 32), 'hex')
);

select throws_ok(
  $$ select identity.record_onboarding_identity(
       '019f0000-0000-7000-8000-000000000012',
       (select attempt_id from test_attempt_two),
       'Grace',
       'Hopper',
       'ada_byron',
       '21111111-1111-4111-8111-111111111221',
       '21111111-1111-4111-8111-111111111222',
       decode(repeat('26', 32), 'hex')
     ) $$,
  '23505',
  null,
  'T-USERNAME-2 a handle already reserved cannot be taken by another account'
);

select is_empty(
  $$ select username from identity.usernames $$,
  'T-USERNAME-3 and that account cannot even read the row, so there is no handle directory'
);

select throws_ok(
  $$ insert into identity.usernames (username, onboarding_attempt_id)
     values ('grace_hopper', (select attempt_id from test_attempt_two)) $$,
  '42501',
  null,
  'runtime cannot insert a reservation directly'
);
select throws_ok(
  $$ delete from identity.usernames $$,
  '42501',
  null,
  'runtime cannot release a reservation directly'
);

-- Activation has to carry the reservation across in the same transaction.
select set_config('app.actor_account_id', '019f0000-0000-7000-8000-000000000011', true);

select identity.record_adult_eligibility(
  '019f0000-0000-7000-8000-000000000011',
  (select attempt_id from test_attempt_one),
  true,
  '21111111-1111-4111-8111-111111111161',
  '21111111-1111-4111-8111-111111111162',
  decode(repeat('28', 32), 'hex')
);

create temporary table test_person as
select identity.activate_person(
  '019f0000-0000-7000-8000-000000000011',
  (select attempt_id from test_attempt_one),
  (select given_name from identity.onboarding_attempts where id = (select attempt_id from test_attempt_one)),
  (select family_name from identity.onboarding_attempts where id = (select attempt_id from test_attempt_one)),
  true,
  true,
  '21111111-1111-4111-8111-111111111151',
  '21111111-1111-4111-8111-111111111152',
  decode(repeat('27', 32), 'hex')
) as person_id;

reset role;
select is(
  (select person_id from identity.usernames where username = 'ada_byron'),
  (select person_id from test_person),
  'T-USERNAME-4 activation moves the reservation to the person'
);
select is(
  (select onboarding_attempt_id from identity.usernames where username = 'ada_byron'),
  null::uuid,
  'and the attempt stops owning it, so exactly one owner remains'
);
select is((select count(*) from identity.usernames where username = 'ada_byron'), 1::bigint,
  'the handle is never duplicated by the move');

-- The activated person reads their own handle; the actor is a person now.
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', (select person_id::text from test_person), true);
select is((select username from identity.usernames), 'ada_byron',
  'the person reads their own handle and nobody else''s');

reset role;
select * from finish();
rollback;
