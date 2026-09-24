begin;

select plan(15);

-- Un nivel global y singular: se escribe con OP-IDN-004, que es justo lo que sabe
-- hacer con un valor único.
select is(
  (select data_classification_code from identity.profile_attributes where code = 'training_experience'),
  'training',
  'T-IDN-PHY-20 the experience is training data: the professional sets the starting volume from it');
select is(
  (select cardinality(allowed_values) from identity.profile_attributes where code = 'training_experience'),
  3,
  'and carries the three simple terms of HU-SP-012 criterion 2');
select is(
  (select allowed_values from identity.profile_attributes where code = 'training_experience'),
  array['starting', 'some_practice', 'experienced']::text[],
  'in the order the screen lists them, least to most');
select ok(
  (select not ('advanced' = any (allowed_values)) from identity.profile_attributes where code = 'training_experience'),
  'and never the gym vocabulary: "advanced" makes people underrate themselves and pick below their level, so the plan bores them');

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019f9000-0000-7000-8000-000000000091', 'workos', 'https://issuer.test', 'exp_one'),
  ('019f9000-0000-7000-8000-000000000092', 'workos', 'https://issuer.test', 'exp_two');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f9000-0000-7000-8000-000000000091', true);

create temporary table exp_attempt as
select attempt_id from identity.start_onboarding_attempt(
  '019f9000-0000-7000-8000-000000000091',
  'b1111111-1111-4111-8111-111111111111',
  'b1111111-1111-4111-8111-111111111112',
  decode(repeat('b1', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f9000-0000-7000-8000-000000000091',
  (select attempt_id from exp_attempt), true,
  'b1111111-1111-4111-8111-111111111121',
  'b1111111-1111-4111-8111-111111111122',
  decode(repeat('b2', 32), 'hex'));
create temporary table exp_person as
select person_id from identity.declare_fitness_id(
  '019f9000-0000-7000-8000-000000000091',
  (select attempt_id from exp_attempt),
  'Rosalind', 'Franklin', 'rosalind_exp', 'rosalind.exp@example.test', true,
  'b1111111-1111-4111-8111-111111111131',
  'b1111111-1111-4111-8111-111111111132',
  decode(repeat('b3', 32), 'hex'));

-- Un valor inventado se rechaza. Es lo que hace segura la incorporación por insert:
-- el catálogo crece con datos, y lo que no está en él no entra.
select throws_ok(
  $$ select identity.declare_profile_claim(
       '019f9000-0000-7000-8000-000000000091',
       'training_experience', 'advanced', null, null,
       'b1111111-1111-4111-8111-111111111141',
       'b1111111-1111-4111-8111-111111111142',
       decode(repeat('b4', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-31 a level outside the closed catalogue is refused: OP-IDN-004 fails closed');

-- Un nivel no lleva número ni unidad, y la función lo hace cumplir.
select throws_ok(
  $$ select identity.declare_profile_claim(
       '019f9000-0000-7000-8000-000000000091',
       'training_experience', 'starting', 3, null,
       'b1111111-1111-4111-8111-111111111151',
       'b1111111-1111-4111-8111-111111111152',
       decode(repeat('b5', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-32 and an enum attribute carries no number: the three bars are a drawing, not a value');

create temporary table first_level as
select * from identity.declare_profile_claim(
  '019f9000-0000-7000-8000-000000000091',
  'training_experience', 'some_practice', null, null,
  'b1111111-1111-4111-8111-111111111161',
  'b1111111-1111-4111-8111-111111111162',
  decode(repeat('b6', 32), 'hex'));

select is((select value_text from first_level), 'some_practice', 'the level is recorded');
select is((select superseded_claim_id from first_level), null::uuid,
  'and supersedes nothing, because it is the first');

select is(
  (select claim_id from identity.declare_profile_claim(
    '019f9000-0000-7000-8000-000000000091',
    'training_experience', 'some_practice', null, null,
    'b1111111-1111-4111-8111-111111111161',
    'b1111111-1111-4111-8111-111111111162',
    decode(repeat('b6', 32), 'hex'))),
  (select claim_id from first_level),
  'T-IDN-IDEM-15 replaying the same command returns the same claim');

-- Recalificarse no edita: la persona sube de nivel y queda registrado con cuál se
-- inscribió, que es lo que un booleano habría perdido.
create temporary table second_level as
select * from identity.declare_profile_claim(
  '019f9000-0000-7000-8000-000000000091',
  'training_experience', 'experienced', null, null,
  'b1111111-1111-4111-8111-111111111171',
  'b1111111-1111-4111-8111-111111111172',
  decode(repeat('b7', 32), 'hex'));

select is((select superseded_claim_id from second_level), (select claim_id from first_level),
  'T-IDN-INT-33 requalifying supersedes the previous level instead of editing it');

-- El resumen del onboarding lo reporta sin cambiar de firma.
select is(
  (select answers -> 'training_experience'
   from identity.read_current_onboarding('019f9000-0000-7000-8000-000000000091')),
  '{"answered": true, "value": "experienced"}'::jsonb,
  'T-IDN-INT-34 the resume read reports the level in force, not the one it replaced');

reset role;
select is(
  (select value_text from identity.fitness_profile_claims where id = (select claim_id from first_level)),
  'some_practice',
  'the superseded claim keeps its value: what someone signed up with stays readable');
select isnt(
  (select valid_to from identity.fitness_profile_claims where id = (select claim_id from first_level)),
  null::timestamptz,
  'and is closed rather than deleted');
select is(
  (select count(*) from identity.fitness_profile_claims
   where person_id = (select person_id from exp_person)
     and attribute_code = 'training_experience'),
  2::bigint,
  'so both levels survive, and only one is in force');

-- Un vecino no ve nada de esto.
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f9000-0000-7000-8000-0000000000ff', true);
select is_empty(
  $$ select id from identity.fitness_profile_claims where attribute_code = 'training_experience' $$,
  'T-IDN-RLS-20 another person reads none of the levels');

select * from finish();
rollback;
