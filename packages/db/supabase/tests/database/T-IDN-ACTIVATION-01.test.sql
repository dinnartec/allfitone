-- Activation is the one command in the onboarding that ends it, and until now
-- nothing read the far side of it. What has to hold: the pending person becomes
-- active, a replay answers the same Fitness ID rather than making a second one,
-- and — the part this test was written for — the resume read still answers after
-- activation, reporting the attempt as `activated`.
--
-- That last one failed when it was written. The reader filtered on `status =
-- 'open'`, so an activated person read nothing at all, which is exactly what an
-- account that never started reads: the app could not tell them apart and sent
-- somebody who had just finished back to the eligibility gate.
begin;

select plan(6);

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019f4000-0000-7000-8000-000000000081', 'workos', 'https://issuer.test', 'activation_one'),
  ('019f4000-0000-7000-8000-000000000082', 'workos', 'https://issuer.test', 'activation_two');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000081', true);

create temporary table attempt_one as
select attempt_id from identity.start_onboarding_attempt(
  '019f4000-0000-7000-8000-000000000081',
  '81111111-1111-4111-8111-111111111111',
  '81111111-1111-4111-8111-111111111112',
  decode(repeat('81', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f4000-0000-7000-8000-000000000081',
  (select attempt_id from attempt_one), true,
  '81111111-1111-4111-8111-111111111121',
  '81111111-1111-4111-8111-111111111122',
  decode(repeat('82', 32), 'hex'));

create temporary table person_one as
select person_id from identity.declare_fitness_id(
  '019f4000-0000-7000-8000-000000000081',
  (select attempt_id from attempt_one),
  'Ada', 'Lovelace', 'ada_activation', 'ada.activation@example.test', true,
  '81111111-1111-4111-8111-111111111131',
  '81111111-1111-4111-8111-111111111132',
  decode(repeat('83', 32), 'hex'));

select is(
  (select attempt.status
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000081') as attempt),
  'open',
  'the attempt reads open before activation');

create temporary table activated as
select identity.activate_person(
  '019f4000-0000-7000-8000-000000000081',
  (select attempt_id from attempt_one),
  'Ada', 'Lovelace', true, true,
  '81111111-1111-4111-8111-111111111141',
  '81111111-1111-4111-8111-111111111142',
  decode(repeat('84', 32), 'hex')) as person_id;

select is(
  (select person_id from activated),
  (select person_id from person_one),
  'activation transitions the pending person instead of creating a second one');

-- A lost response is the case that matters: the retry carries the same command,
-- and "exactly one Fitness ID" has to hold under it, not only under a good one.
select is(
  identity.activate_person(
    '019f4000-0000-7000-8000-000000000081',
    (select attempt_id from attempt_one),
    'Ada', 'Lovelace', true, true,
    '81111111-1111-4111-8111-111111111141',
    '81111111-1111-4111-8111-111111111142',
    decode(repeat('84', 32), 'hex')),
  (select person_id from activated),
  'a replay answers the same Fitness ID');

select set_config('app.actor_person_id', (select person_id::text from person_one), true);

select is(
  (select status::text from identity.people where id = (select person_id from person_one)),
  'active',
  'the person is active');

-- The reason this file exists. An activated person must not read as an account
-- that never started, or the app sends them back to the gate on the next launch.
select is(
  (select attempt.status
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000081') as attempt),
  'activated',
  'the resume read still answers after activation, and says so');

select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000082', true);
select set_config('app.actor_person_id', '', true);

select is(
  (select count(*)::int
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000081')),
  0,
  'and a neighbour reads none of it');

select * from finish();
rollback;
