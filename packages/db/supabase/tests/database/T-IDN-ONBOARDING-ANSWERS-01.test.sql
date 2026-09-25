-- The resume read now reports one derived `answers` object instead of a flat
-- column per answer. What has to hold: every step reports itself, an unanswered
-- step says so rather than being absent, only the claim in force is reported, and
-- a neighbour reads nothing.
begin;

select plan(9);

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019f4000-0000-7000-8000-000000000041', 'workos', 'https://issuer.test', 'answers_one'),
  ('019f4000-0000-7000-8000-000000000042', 'workos', 'https://issuer.test', 'answers_two');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000041', true);

create temporary table attempt_one as
select attempt_id from identity.start_onboarding_attempt(
  '019f4000-0000-7000-8000-000000000041',
  '61111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111112',
  decode(repeat('61', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f4000-0000-7000-8000-000000000041',
  (select attempt_id from attempt_one), true,
  '61111111-1111-4111-8111-111111111121',
  '61111111-1111-4111-8111-111111111122',
  decode(repeat('62', 32), 'hex'));

-- Nothing answered yet: every step has to say `answered: false` rather than be
-- missing, or the app cannot tell a skipped step from a field that did not travel.
select is(
  (select (answers -> 'identity' ->> 'answered')::boolean
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041')),
  false,
  'an unanswered step reports itself unanswered instead of being absent');
select is(
  (select (answers -> 'primary_training_goal' ->> 'answered')::boolean
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041')),
  false,
  'and so does the goal before any claim exists');
select is(
  (select answers -> 'primary_training_goal' ->> 'value'
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041')),
  null::text,
  'with no value to prefill');

create temporary table person_one as
select person_id from identity.declare_fitness_id(
  '019f4000-0000-7000-8000-000000000041',
  (select attempt_id from attempt_one),
  'Grace', 'Hopper', 'grace_answers', 'grace.answers@example.test', true,
  '61111111-1111-4111-8111-111111111131',
  '61111111-1111-4111-8111-111111111132',
  decode(repeat('63', 32), 'hex'));

-- Reading a claim back needs the full actor context, not just the account: the
-- policy on claims is is_self, which compares against the person.
select set_config('app.actor_person_id', (select person_id::text from person_one), true);

select is(
  (select answers -> 'identity' -> 'value' ->> 'username'
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041')),
  'grace_answers',
  'T-IDN-RLS-19 the name step reports its value through the governed function');

select identity.declare_biological_sex(
  '019f4000-0000-7000-8000-000000000041',
  (select attempt_id from attempt_one), 'female',
  '61111111-1111-4111-8111-111111111141',
  '61111111-1111-4111-8111-111111111142',
  decode(repeat('64', 32), 'hex'));

select is(
  (select answers -> 'biological_sex' ->> 'value'
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041')),
  'female',
  'the sex step keeps reporting its value under the new shape');

create temporary table first_goal as
select claim_id from identity.declare_profile_claim(
  '019f4000-0000-7000-8000-000000000041',
  'primary_training_goal', 'build_muscle', null, null,
  '61111111-1111-4111-8111-111111111151',
  '61111111-1111-4111-8111-111111111152',
  decode(repeat('65', 32), 'hex'));

select is(
  (select answers -> 'primary_training_goal' ->> 'value'
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041')),
  'build_muscle',
  'T-IDN-INT-22 the goal step reports the claim that is in force');

-- Correcting the goal writes a second claim and seals the first. The read has to
-- follow the live one, or the screen would prefill what the person moved away from.
select identity.declare_profile_claim(
  '019f4000-0000-7000-8000-000000000041',
  'primary_training_goal', 'run_a_race', null, null,
  '61111111-1111-4111-8111-111111111161',
  '61111111-1111-4111-8111-111111111162',
  decode(repeat('66', 32), 'hex'));

select is(
  (select answers -> 'primary_training_goal' ->> 'value'
     from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041')),
  'run_a_race',
  'T-IDN-INT-23 and a superseded claim never comes back as the current one');
select is(
  (select valid_to is not null and superseded_by_id is not null
     from identity.fitness_profile_claims
     where id = (select claim_id from first_goal)),
  true,
  'because the previous one was sealed rather than edited');

reset role;
set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000042', true);

-- The function filters by the actor context, not only by its argument. Passing
-- someone else's account id has to return nothing at all.
select is_empty(
  $$ select attempt_id from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041') $$,
  'T-IDN-RLS-20 a neighbour reading with someone else''s account id gets nothing');

reset role;
select finish();
rollback;
