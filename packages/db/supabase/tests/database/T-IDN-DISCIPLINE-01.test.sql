-- The discipline somebody trains, which the goal then depends on.
--
-- Written against `T-IDN-EXPERIENCE-01`, because it is the same command answering a
-- different attribute — and that sameness is the point of adding a discipline as a
-- catalogue row instead of a table.
--
-- The assertion worth reading twice is the last pair: changing discipline must leave
-- both rows alive. Somebody who came in through strength and moved to combat has a
-- history, and an update would say they were always doing combat.
begin;

select plan(12);

select is(
  (select data_classification_code from identity.profile_attributes where code = 'training_discipline'),
  'training',
  'T-IDN-PHY-23 the discipline is training data: it decides what the plan is made of');

-- Las seis, aunque hoy solo una se pueda elegir. El catálogo es el vocabulario del
-- concepto; lo que se puede contestar es una decisión de lanzamiento y vive en el
-- contrato, igual que pasa con improve_performance en el objetivo.
select is(
  (select cardinality(allowed_values) from identity.profile_attributes where code = 'training_discipline'),
  6,
  'and holds all six disciplines, not only the one that is ready');
select is(
  (select allowed_values from identity.profile_attributes where code = 'training_discipline'),
  array['strength', 'high_intensity', 'endurance_cardio', 'combat_sports',
        'wellbeing_control', 'rhythm_classes']::text[],
  'in the order the carousel shows them');

insert into identity.access_accounts (id, provider, issuer, subject)
values ('019f9000-0000-7000-8000-0000000000d1', 'workos', 'https://issuer.test', 'disc_one');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f9000-0000-7000-8000-0000000000d1', true);

create temporary table disc_attempt as
select attempt_id from identity.start_onboarding_attempt(
  '019f9000-0000-7000-8000-0000000000d1',
  'd1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111112',
  decode(repeat('d1', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f9000-0000-7000-8000-0000000000d1',
  (select attempt_id from disc_attempt), true,
  'd1111111-1111-4111-8111-111111111121',
  'd1111111-1111-4111-8111-111111111122',
  decode(repeat('d2', 32), 'hex'));
create temporary table disc_person as
select person_id from identity.declare_fitness_id(
  '019f9000-0000-7000-8000-0000000000d1',
  (select attempt_id from disc_attempt),
  'Katherine', 'Johnson', 'katherine_disc', 'katherine.disc@example.test', true,
  'd1111111-1111-4111-8111-111111111131',
  'd1111111-1111-4111-8111-111111111132',
  decode(repeat('d3', 32), 'hex'));

-- Una disciplina inventada se rechaza. Es lo que hace segura la incorporación por
-- insert: el catálogo crece con datos, y lo que no está en él no entra.
select throws_ok(
  $$ select identity.declare_profile_claim(
       '019f9000-0000-7000-8000-0000000000d1',
       'training_discipline', 'quidditch', null, null,
       'd1111111-1111-4111-8111-111111111141',
       'd1111111-1111-4111-8111-111111111142',
       decode(repeat('d4', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-38 a discipline outside the closed catalogue is refused: OP-IDN-004 fails closed');

create temporary table first_discipline as
select * from identity.declare_profile_claim(
  '019f9000-0000-7000-8000-0000000000d1',
  'training_discipline', 'strength', null, null,
  'd1111111-1111-4111-8111-111111111151',
  'd1111111-1111-4111-8111-111111111152',
  decode(repeat('d5', 32), 'hex'));

select is((select value_text from first_discipline), 'strength', 'the discipline is recorded');
select is((select superseded_claim_id from first_discipline), null::uuid,
  'and supersedes nothing, because it is the first');

select is(
  (select claim_id from identity.declare_profile_claim(
    '019f9000-0000-7000-8000-0000000000d1',
    'training_discipline', 'strength', null, null,
    'd1111111-1111-4111-8111-111111111151',
    'd1111111-1111-4111-8111-111111111152',
    decode(repeat('d5', 32), 'hex'))),
  (select claim_id from first_discipline),
  'T-IDN-IDEM-18 replaying the same command returns the same claim');

-- El resumen del onboarding lo reporta sin cambiar de firma, que es lo único que la
-- pantalla necesita para saber si el paso está contestado.
select is(
  (select answers -> 'training_discipline'
   from identity.read_current_onboarding('019f9000-0000-7000-8000-0000000000d1')),
  '{"answered": true, "value": "strength"}'::jsonb,
  'T-IDN-INT-39 the resume read reports the discipline in force');

-- Cambiar de disciplina no edita. La base admite las seis aunque la aplicación ofrezca
-- una: el día que se abra otra, este camino ya está probado.
create temporary table second_discipline as
select * from identity.declare_profile_claim(
  '019f9000-0000-7000-8000-0000000000d1',
  'training_discipline', 'combat_sports', null, null,
  'd1111111-1111-4111-8111-111111111161',
  'd1111111-1111-4111-8111-111111111162',
  decode(repeat('d6', 32), 'hex'));

select is((select superseded_claim_id from second_discipline), (select claim_id from first_discipline),
  'T-IDN-INT-40 changing discipline supersedes the previous one instead of editing it');

reset role;
select is(
  (select value_text from identity.fitness_profile_claims where id = (select claim_id from first_discipline)),
  'strength',
  'the superseded claim keeps its value: what somebody started with stays readable');
select is(
  (select count(*) from identity.fitness_profile_claims
   where person_id = (select person_id from disc_person)
     and attribute_code = 'training_discipline'),
  2::bigint,
  'so both disciplines survive, and only one is in force');

-- Un vecino no ve nada de esto.
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f9000-0000-7000-8000-0000000000fe', true);
select is_empty(
  $$ select id from identity.fitness_profile_claims where attribute_code = 'training_discipline' $$,
  'T-IDN-RLS-24 another person reads none of the disciplines');

select * from finish();
rollback;
