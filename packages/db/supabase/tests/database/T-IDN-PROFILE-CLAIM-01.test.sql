begin;

select plan(18);

select has_table('identity', 'profile_attributes',
  'T-IDN-PHY-16 the attribute catalogue exists, so adding a member is data not schema');
select has_table('identity', 'fitness_profile_claims',
  'T-IDN-PHY-17 and the claims it governs');
select has_table('privacy', 'data_classifications',
  'T-IDN-PHY-18 with the classification catalogue the attributes inherit from');

select is(
  (select data_classification_code from identity.profile_attributes where code = 'primary_training_goal'),
  'training',
  'the goal is training data: the professional programs against it');
select is(
  (select cardinality(allowed_values) from identity.profile_attributes where code = 'primary_training_goal'),
  6,
  'and keeps six members while the API contract offers five: improve_performance is deferred, not deleted');

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019f3000-0000-7000-8000-000000000031', 'workos', 'https://issuer.test', 'claim_one'),
  ('019f3000-0000-7000-8000-000000000032', 'workos', 'https://issuer.test', 'claim_two'),
  ('019f3000-0000-7000-8000-000000000033', 'workos', 'https://issuer.test', 'claim_none');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f3000-0000-7000-8000-000000000031', true);

create temporary table attempt_one as
select attempt_id from identity.start_onboarding_attempt(
  '019f3000-0000-7000-8000-000000000031',
  '51111111-1111-4111-8111-111111111111',
  '51111111-1111-4111-8111-111111111112',
  decode(repeat('51', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f3000-0000-7000-8000-000000000031',
  (select attempt_id from attempt_one), true,
  '51111111-1111-4111-8111-111111111121',
  '51111111-1111-4111-8111-111111111122',
  decode(repeat('52', 32), 'hex'));

-- Sin persona no hay sujeto de la afirmación, y se rechaza antes que nada.
select throws_ok(
  $$ select identity.declare_profile_claim(
       '019f3000-0000-7000-8000-000000000031',
       'primary_training_goal', 'get_fit', null, null,
       '51111111-1111-4111-8111-111111111131',
       '51111111-1111-4111-8111-111111111132',
       decode(repeat('53', 32), 'hex')) $$,
  '42501', null,
  'T-IDN-RLS-16 declaring before the Fitness ID exists is refused');

create temporary table person_one as
select person_id from identity.declare_fitness_id(
  '019f3000-0000-7000-8000-000000000031',
  (select attempt_id from attempt_one),
  'Ada', 'Lovelace', 'ada_claim', 'ada.claim@example.test', true,
  '51111111-1111-4111-8111-111111111141',
  '51111111-1111-4111-8111-111111111142',
  decode(repeat('54', 32), 'hex'));

-- Un atributo inventado se rechaza antes de tocar la idempotencia: si quemara la
-- clave, el reintento correcto fallaría después.
select throws_ok(
  $$ select identity.declare_profile_claim(
       '019f3000-0000-7000-8000-000000000031',
       'invented_attribute', 'whatever', null, null,
       '51111111-1111-4111-8111-111111111151',
       '51111111-1111-4111-8111-111111111152',
       decode(repeat('55', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-19 an unknown attribute is refused: OP-IDN-004 fails closed');

select throws_ok(
  $$ select identity.declare_profile_claim(
       '019f3000-0000-7000-8000-000000000031',
       'primary_training_goal', 'become_immortal', null, null,
       '51111111-1111-4111-8111-111111111161',
       '51111111-1111-4111-8111-111111111162',
       decode(repeat('56', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-20 and a value outside the closed catalogue is refused too');

create temporary table first_goal as
select * from identity.declare_profile_claim(
  '019f3000-0000-7000-8000-000000000031',
  'primary_training_goal', 'lose_weight', null, null,
  '51111111-1111-4111-8111-111111111171',
  '51111111-1111-4111-8111-111111111172',
  decode(repeat('57', 32), 'hex'));

select is((select value_text from first_goal), 'lose_weight', 'the goal is recorded');
select is((select superseded_claim_id from first_goal), null::uuid,
  'and supersedes nothing, because it is the first');

select is(
  (select claim_id from identity.declare_profile_claim(
    '019f3000-0000-7000-8000-000000000031',
    'primary_training_goal', 'lose_weight', null, null,
    '51111111-1111-4111-8111-111111111171',
    '51111111-1111-4111-8111-111111111172',
    decode(repeat('57', 32), 'hex'))),
  (select claim_id from first_goal),
  'T-IDN-IDEM-13 replaying the same command returns the same claim');

-- Cambiar de objetivo no edita: escribe otra y cierra la anterior.
create temporary table second_goal as
select * from identity.declare_profile_claim(
  '019f3000-0000-7000-8000-000000000031',
  'primary_training_goal', 'improve_performance', null, null,
  '51111111-1111-4111-8111-111111111181',
  '51111111-1111-4111-8111-111111111182',
  decode(repeat('58', 32), 'hex'));

select is((select superseded_claim_id from second_goal), (select claim_id from first_goal),
  'T-IDN-INT-21 changing the goal supersedes the previous claim instead of editing it');

reset role;
select is(
  (select superseded_by_id from identity.fitness_profile_claims where id = (select claim_id from first_goal)),
  (select claim_id from second_goal),
  'the old claim points at the new one, so the change of intention is on the record');
select isnt(
  (select valid_to from identity.fitness_profile_claims where id = (select claim_id from first_goal)),
  null::timestamptz,
  'and is closed rather than deleted');
select is(
  (select count(*) from identity.fitness_profile_claims
   where person_id = (select person_id from person_one)),
  2::bigint,
  'both claims survive: append-only keeps the history a column would have lost');

-- La escritura no entra por la tabla, solo por la función.
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', (select person_id::text from person_one), true);
select throws_ok(
  $$ update identity.fitness_profile_claims set value_text = 'maintain' $$,
  '42501', null,
  'T-IDN-RLS-17 the runtime role cannot update a claim: append-only is enforced, not asked for');

select is(
  (select count(*) from identity.fitness_profile_claims),
  2::bigint,
  'and the person reads her own two claims');

-- Un vecino no ve nada de esto.
select set_config('app.actor_person_id', '019f3000-0000-7000-8000-0000000000ff', true);
select is_empty(
  $$ select id from identity.fitness_profile_claims $$,
  'T-IDN-RLS-18 another person reads none of them');

select * from finish();
rollback;
