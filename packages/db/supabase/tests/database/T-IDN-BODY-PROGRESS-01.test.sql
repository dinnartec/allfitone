begin;

select plan(21);

select has_table('identity', 'body_progress_records',
  'T-IDN-PHY-21 body measurements have a table of their own: they are a time series, not a profile claim');
select has_table('identity', 'onboarding_step_skips',
  'T-IDN-PHY-22 and skipping a step is recorded, or the screen asks again on every cold start');

-- Unidades de verdad. Hasta ahora solo había filas sintéticas de seed.sql.
select is(
  (select is_canonical from catalog.units where code = 'kg'),
  true,
  'kilograms are the canonical mass');
select is(
  (select to_canonical_factor from catalog.units where code = 'lb'),
  0.45359237::numeric,
  'and the pound carries the exact factor, so the conversion has one source of truth');
select is(
  (select is_canonical from catalog.units where code = 'cm'),
  true,
  'centimetres are the canonical length');
select is(
  (select to_canonical_factor from catalog.units where code = 'in'),
  2.54::numeric,
  'and the inch its own factor: feet and inches are measured as total inches');

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019fc000-0000-7000-8000-0000000000c1', 'workos', 'https://issuer.test', 'body_one'),
  ('019fc000-0000-7000-8000-0000000000c2', 'workos', 'https://issuer.test', 'body_two');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019fc000-0000-7000-8000-0000000000c1', true);

-- El catálogo tiene que ser legible por el runtime: la pantalla ofrece unidades y
-- sin este grant no puede ni enumerarlas.
select isnt_empty(
  $$ select code from catalog.units where code in ('kg', 'lb', 'cm', 'in') $$,
  'T-IDN-RLS-21 the runtime role can read the unit catalogue its own screens need');

create temporary table body_attempt as
select attempt_id from identity.start_onboarding_attempt(
  '019fc000-0000-7000-8000-0000000000c1',
  'e1111111-1111-4111-8111-111111111111',
  'e1111111-1111-4111-8111-111111111112',
  decode(repeat('e1', 32), 'hex'));
select identity.record_adult_eligibility(
  '019fc000-0000-7000-8000-0000000000c1',
  (select attempt_id from body_attempt), true,
  'e1111111-1111-4111-8111-111111111121',
  'e1111111-1111-4111-8111-111111111122',
  decode(repeat('e2', 32), 'hex'));
create temporary table body_person as
select person_id from identity.declare_fitness_id(
  '019fc000-0000-7000-8000-0000000000c1',
  (select attempt_id from body_attempt),
  'Chien', 'Wu', 'chien_body', 'chien.body@example.test', true,
  'e1111111-1111-4111-8111-111111111131',
  'e1111111-1111-4111-8111-111111111132',
  decode(repeat('e3', 32), 'hex'));

-- Una medida en la unidad canónica no lleva original: no hay nada que preservar.
create temporary table in_kilos as
select * from identity.record_body_progress(
  '019fc000-0000-7000-8000-0000000000c1',
  'body_weight', 74, 'kg', current_date,
  'e1111111-1111-4111-8111-111111111141',
  'e1111111-1111-4111-8111-111111111142',
  decode(repeat('e4', 32), 'hex'));

select is((select value_numeric from in_kilos), 74::numeric, 'a weight in kilos is stored as it came');
select is((select original_value from in_kilos), null::numeric,
  'and carries no original, because the canonical unit is what she chose');

-- Y una en libras sí: se guarda el canónico calculado y lo que la persona vio.
create temporary table in_pounds as
select * from identity.record_body_progress(
  '019fc000-0000-7000-8000-0000000000c1',
  'body_weight', 163, 'lb', current_date,
  'e1111111-1111-4111-8111-111111111151',
  'e1111111-1111-4111-8111-111111111152',
  decode(repeat('e5', 32), 'hex'));

select is((select value_numeric from in_pounds), (163 * 0.45359237)::numeric,
  'T-IDN-INT-35 a weight in pounds is converted with the factor from the catalogue, never one the client sent');
select is((select unit_code from in_pounds), 'kg', 'and lands in the canonical unit');
select is((select original_value from in_pounds), 163::numeric,
  'while what she actually read is kept, so changing units and back cannot move her weight');
select is((select original_unit_code from in_pounds), 'lb', 'with the unit she read it in');

-- La dimensión tiene que corresponder a la métrica, y lo hace cumplir la base.
select throws_ok(
  $$ select identity.record_body_progress(
       '019fc000-0000-7000-8000-0000000000c1',
       'body_weight', 170, 'cm', current_date,
       'e1111111-1111-4111-8111-111111111161',
       'e1111111-1111-4111-8111-111111111162',
       decode(repeat('e6', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-36 a weight in centimetres is refused: the unit must belong to the metric dimension');

select throws_ok(
  $$ select identity.record_body_progress(
       '019fc000-0000-7000-8000-0000000000c1',
       'body_fat', 18, 'kg', current_date,
       'e1111111-1111-4111-8111-111111111171',
       'e1111111-1111-4111-8111-111111111172',
       decode(repeat('e7', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-37 and a metric outside the closed list is refused, so a typo cannot invent one');

select is(
  (select record_id from identity.record_body_progress(
     '019fc000-0000-7000-8000-0000000000c1',
     'body_weight', 163, 'lb', current_date,
     'e1111111-1111-4111-8111-111111111151',
     'e1111111-1111-4111-8111-111111111152',
     decode(repeat('e5', 32), 'hex'))),
  (select record_id from in_pounds),
  'T-IDN-IDEM-16 replaying the same command returns the same record');

-- Saltar es idempotente por construcción: la clave primaria lo impide dos veces.
select identity.skip_onboarding_step(
  '019fc000-0000-7000-8000-0000000000c1', (select attempt_id from body_attempt), 'body_measures');
select identity.skip_onboarding_step(
  '019fc000-0000-7000-8000-0000000000c1', (select attempt_id from body_attempt), 'body_measures');

reset role;
select is(
  (select count(*) from identity.onboarding_step_skips
   where onboarding_attempt_id = (select attempt_id from body_attempt)),
  1::bigint,
  'T-IDN-IDEM-17 skipping twice records one skip, because the primary key says so');
select is(
  (select count(*) from identity.body_progress_records
   where person_id = (select person_id from body_person)),
  2::bigint,
  'and the two measurements survive: append-only keeps the series a column would have lost');

-- Un vecino no ve nada de esto. Es la prueba que existe para ver fallar.
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019fc000-0000-7000-8000-0000000000ff', true);
select is_empty(
  $$ select id from identity.body_progress_records $$,
  'T-IDN-RLS-22 another person reads none of my measurements');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', (select person_id::text from body_person), true);
select is(
  (select count(*) from identity.body_progress_records),
  2::bigint,
  'and I read my own two');

-- La escritura no entra por la tabla, solo por la función.
select throws_ok(
  $$ update identity.body_progress_records set value_numeric = 60 $$,
  '42501', null,
  'T-IDN-RLS-23 the runtime role cannot rewrite a measurement: the series is not editable in place');

select * from finish();
rollback;
