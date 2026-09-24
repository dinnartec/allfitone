begin;

select plan(18);

-- El primer atributo multivaluado del catálogo. Ocho miembros: las siete zonas de
-- HU-SP-097 y la forma de decir «sin énfasis».
select is(
  (select data_classification_code from identity.profile_attributes where code = 'focus_areas'),
  'training',
  'T-IDN-PHY-19 the emphasis is training data: the professional spreads volume against it');
select is(
  (select cardinality(allowed_values) from identity.profile_attributes where code = 'focus_areas'),
  8,
  'and carries the seven zones of HU-SP-097 criterion 1 plus whole body');
select ok(
  (select 'whole_body' = any (allowed_values) from identity.profile_attributes where code = 'focus_areas'),
  'whole body is a member of the catalogue, not the absence of the answer: otherwise "no emphasis" and "did not answer" would both be zero rows');

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019f4000-0000-7000-8000-000000000041', 'workos', 'https://issuer.test', 'focus_one'),
  ('019f4000-0000-7000-8000-000000000042', 'workos', 'https://issuer.test', 'focus_two');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000041', true);

create temporary table focus_attempt as
select attempt_id from identity.start_onboarding_attempt(
  '019f4000-0000-7000-8000-000000000041',
  '61111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111112',
  decode(repeat('61', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f4000-0000-7000-8000-000000000041',
  (select attempt_id from focus_attempt), true,
  '61111111-1111-4111-8111-111111111121',
  '61111111-1111-4111-8111-111111111122',
  decode(repeat('62', 32), 'hex'));
create temporary table focus_person as
select person_id from identity.declare_fitness_id(
  '019f4000-0000-7000-8000-000000000041',
  (select attempt_id from focus_attempt),
  'Grace', 'Hopper', 'grace_focus', 'grace.focus@example.test', true,
  '61111111-1111-4111-8111-111111111131',
  '61111111-1111-4111-8111-111111111132',
  decode(repeat('63', 32), 'hex'));

-- Todo lo que puede estar mal se valida antes de tocar la idempotencia: un conjunto
-- inválido que quemara la clave dejaría fallando al reintento correcto.
select throws_ok(
  $$ select identity.declare_focus_areas(
       '019f4000-0000-7000-8000-000000000041', array[]::text[],
       '61111111-1111-4111-8111-111111111141',
       '61111111-1111-4111-8111-111111111142',
       decode(repeat('64', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-22 the empty set is refused: "did not answer" must stay distinguishable from "no emphasis"');

select throws_ok(
  $$ select identity.declare_focus_areas(
       '019f4000-0000-7000-8000-000000000041', array['left_eyebrow'],
       '61111111-1111-4111-8111-111111111151',
       '61111111-1111-4111-8111-111111111152',
       decode(repeat('65', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-23 a member outside the closed catalogue is refused: OP-IDN-046 fails closed');

select throws_ok(
  $$ select identity.declare_focus_areas(
       '019f4000-0000-7000-8000-000000000041', array['chest', 'chest'],
       '61111111-1111-4111-8111-111111111161',
       '61111111-1111-4111-8111-111111111162',
       decode(repeat('66', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-24 and the same zone twice in one command is refused before it can become two rows');

select throws_ok(
  $$ select identity.declare_focus_areas(
       '019f4000-0000-7000-8000-000000000041', array['whole_body', 'chest'],
       '61111111-1111-4111-8111-111111111171',
       '61111111-1111-4111-8111-111111111172',
       decode(repeat('67', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-25 whole body excludes every zone in the database, not only on the screen');

-- El motivo de todo este trabajo: tres zonas tienen que convivir. Con OP-IDN-004
-- quedaba una y dos superseded.
select identity.declare_focus_areas(
  '019f4000-0000-7000-8000-000000000041', array['chest', 'arms', 'abs'],
  '61111111-1111-4111-8111-111111111181',
  '61111111-1111-4111-8111-111111111182',
  decode(repeat('68', 32), 'hex'));

reset role;
select is(
  (select array_agg(claim.value_text order by claim.value_text)
   from identity.fitness_profile_claims as claim
   where claim.person_id = (select person_id from focus_person)
     and claim.attribute_code = 'focus_areas'
     and claim.valid_to is null),
  array['abs', 'arms', 'chest']::text[],
  'T-IDN-INT-26 three zones coexist as three live claims of the same attribute');

create temporary table first_set as
select claim.id, claim.value_text, claim.valid_from
from identity.fitness_profile_claims as claim
where claim.person_id = (select person_id from focus_person)
  and claim.attribute_code = 'focus_areas';

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000041', true);

-- El replay no duplica. El agregado del receipt es la persona, no la fila, así que
-- lo que devuelve es el conjunto vigente.
select is(
  (select areas from identity.declare_focus_areas(
     '019f4000-0000-7000-8000-000000000041', array['chest', 'arms', 'abs'],
     '61111111-1111-4111-8111-111111111181',
     '61111111-1111-4111-8111-111111111182',
     decode(repeat('68', 32), 'hex'))),
  array['abs', 'arms', 'chest']::text[],
  'T-IDN-IDEM-14 replaying the same command answers the live set');

reset role;
select is(
  (select count(*) from identity.fitness_profile_claims
   where person_id = (select person_id from focus_person)
     and attribute_code = 'focus_areas'),
  3::bigint,
  'and writes nothing: the replay did not duplicate a single zone');

-- Quitar una zona la cierra; las que siguen no se reescriben.
set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000041', true);
select identity.declare_focus_areas(
  '019f4000-0000-7000-8000-000000000041', array['chest', 'arms'],
  '61111111-1111-4111-8111-111111111191',
  '61111111-1111-4111-8111-111111111192',
  decode(repeat('69', 32), 'hex'));

reset role;
select isnt(
  (select valid_to from identity.fitness_profile_claims
   where person_id = (select person_id from focus_person)
     and attribute_code = 'focus_areas' and value_text = 'abs'),
  null::timestamptz,
  'T-IDN-INT-27 the withdrawn zone is closed rather than deleted');
select is(
  (select superseded_by_id from identity.fitness_profile_claims
   where person_id = (select person_id from focus_person)
     and attribute_code = 'focus_areas' and value_text = 'abs'),
  null::uuid,
  'and carries no superseded_by_id: nothing replaced it, it ended');
select is(
  (select array_agg(claim.id order by claim.value_text)
   from identity.fitness_profile_claims as claim
   where claim.person_id = (select person_id from focus_person)
     and claim.attribute_code = 'focus_areas'
     and claim.valid_to is null),
  (select array_agg(kept.id order by kept.value_text)
   from first_set as kept where kept.value_text in ('arms', 'chest')),
  'and the two that stayed keep their original rows: a zone still chosen is not rewritten');

-- Todo el cuerpo reemplaza el conjunto entero.
set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000041', true);
select identity.declare_focus_areas(
  '019f4000-0000-7000-8000-000000000041', array['whole_body'],
  '61111111-1111-4111-8111-1111111111a1',
  '61111111-1111-4111-8111-1111111111a2',
  decode(repeat('6a', 32), 'hex'));

reset role;
select is(
  (select array_agg(claim.value_text order by claim.value_text)
   from identity.fitness_profile_claims as claim
   where claim.person_id = (select person_id from focus_person)
     and claim.attribute_code = 'focus_areas'
     and claim.valid_to is null),
  array['whole_body']::text[],
  'T-IDN-INT-28 declaring whole body seals every zone and leaves one live claim');
select is(
  (select count(*) from identity.fitness_profile_claims
   where person_id = (select person_id from focus_person)
     and attribute_code = 'focus_areas'),
  4::bigint,
  'and the four rows survive: append-only keeps what a column would have lost');

-- La forma del conjunto la defiende la base, no el comando.
select throws_ok(
  $$ insert into identity.fitness_profile_claims
       (id, person_id, attribute_code, value_text, provenance, captured_by_kind)
     select extensions.uuid_generate_v7(), person_id, 'focus_areas', 'whole_body',
            'person_declared', 'person'
     from focus_person $$,
  '23505', null,
  'T-IDN-INT-29 the same member twice live is refused by the partial unique index, not by the function');

-- El resumen del onboarding lo reporta sin cambiar de firma.
set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f4000-0000-7000-8000-000000000041', true);
select is(
  (select answers -> 'focus_areas'
   from identity.read_current_onboarding('019f4000-0000-7000-8000-000000000041')),
  '{"answered": true, "value": ["whole_body"]}'::jsonb,
  'T-IDN-INT-30 the resume read reports the emphasis, answered and all');

-- Un vecino no ve nada de esto.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f4000-0000-7000-8000-0000000000ff', true);
select is_empty(
  $$ select id from identity.fitness_profile_claims where attribute_code = 'focus_areas' $$,
  'T-IDN-RLS-19 another person reads none of the emphasis');

select * from finish();
rollback;
