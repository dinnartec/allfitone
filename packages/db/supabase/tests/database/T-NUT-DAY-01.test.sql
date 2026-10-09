-- El día de nutrición se resume al leer, y la racha cuenta días seguidos con algo
-- registrado (ADR-040, OP-NUT-005).
--
-- Comidas el 27, 28 y 29 de septiembre, nada el 30, y el 1 de octubre. La vecina no tiene
-- nada.
--
-- Escritas antes de las funciones y vistas fallar.
begin;

select plan(7);

insert into identity.people (id, given_name, family_name, status)
values ('019f1100-0000-7000-8000-000000000001', 'Quien', 'Come', 'active'),
       ('019f1100-0000-7000-8000-000000000002', 'La', 'Vecina', 'active');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f1100-0000-7000-8000-000000000001', true);

do $$
declare
  day text;
  n integer := 0;
begin
  foreach day in array array['2026-09-27', '2026-09-28', '2026-09-29', '2026-10-01'] loop
    n := n + 1;
    perform nutrition.record_meal('019f1100-0000-7000-8000-000000000001',
      jsonb_build_object('occurred_at', day || 'T12:00:00-05:00', 'timezone', 'America/Bogota',
        'meal_type', 'lunch', 'items', jsonb_build_array(jsonb_build_object(
          'position', 1, 'name', 'Almuerzo', 'quantity', null, 'quantity_unit', null,
          'nutrients', jsonb_build_array(
            jsonb_build_object('nutrient_code', 'energy', 'value', 600, 'unit', 'kcal'),
            jsonb_build_object('nutrient_code', 'protein', 'value', 40, 'unit', 'g'))))),
      extensions.uuid_generate_v4(), extensions.uuid_generate_v7(),
      extensions.digest(day, 'sha256'));
  end loop;
end
$$;

-- A second meal on the 29th, with fat, which the first one did not have.
select nutrition.record_meal('019f1100-0000-7000-8000-000000000001',
  '{"occurred_at":"2026-09-29T20:00:00-05:00","timezone":"America/Bogota","meal_type":"dinner","items":[
    {"position":1,"name":"Cena","quantity":null,"quantity_unit":null,"nutrients":[
      {"nutrient_code":"energy","value":500,"unit":"kcal"},{"nutrient_code":"fat","value":20,"unit":"g"}]}]}'::jsonb,
  'f6111111-1111-4111-8111-111111111201', extensions.uuid_generate_v7(), decode(repeat('21', 32), 'hex'));

select nutrition.read_daily_summaries('019f1100-0000-7000-8000-000000000001', '2026-09-27', '2026-10-01',
  'America/Bogota', '2026-10-01') as week \gset

select is(
  (select array_agg(jsonb_build_object('day', d->>'local_date', 'meals', (d->>'meal_count')::int) order by d->>'local_date')
   from jsonb_array_elements(:'week'::jsonb->'data') as d),
  array['{"day": "2026-09-27", "meals": 1}', '{"day": "2026-09-28", "meals": 1}', '{"day": "2026-09-29", "meals": 2}',
        '{"day": "2026-09-30", "meals": 0}', '{"day": "2026-10-01", "meals": 1}']::jsonb[],
  'T-NUT-DAY-01 every day of the range, the empty one included, in order');

select is(
  (select jsonb_agg(t order by t->>'nutrient_code') from jsonb_array_elements(:'week'::jsonb->'data'->2->'nutrient_totals') as t),
  '[{"nutrient_code": "energy", "value": 1100, "unit": "kcal"}, {"nutrient_code": "fat", "value": 20, "unit": "g"},
    {"nutrient_code": "protein", "value": 40, "unit": "g"}]'::jsonb,
  'T-NUT-DAY-02 a day adds up what its meals recorded, and only that');

select is(
  :'week'::jsonb->'data'->3->'nutrient_totals', '[]'::jsonb,
  'T-NUT-DAY-03 a day with nothing recorded has no totals, not zeros');

select is(
  (:'week'::jsonb->>'streak_days')::integer, 1,
  'T-NUT-DAY-04 the streak counts back from today and stops at the empty day');

select is(
  (nutrition.read_daily_summaries('019f1100-0000-7000-8000-000000000001', '2026-09-27', '2026-09-30',
     'America/Bogota', '2026-09-30')->>'streak_days')::integer, 3,
  'T-NUT-DAY-05 while today is still empty, the streak runs to yesterday');

select throws_ok(
  $$ select nutrition.read_daily_summaries('019f1100-0000-7000-8000-000000000001', '2026-09-01', '2026-10-02',
       'America/Bogota', '2026-10-02') $$,
  '22023', null, 'T-NUT-DAY-06 a range longer than 31 days is refused');

select set_config('app.actor_person_id', '019f1100-0000-7000-8000-000000000002', true);

select is(
  (select sum((d->>'meal_count')::int)::integer from jsonb_array_elements(
     nutrition.read_daily_summaries('019f1100-0000-7000-8000-000000000002', '2026-09-27', '2026-10-01',
       'America/Bogota', '2026-10-01')->'data') as d),
  0, 'T-NUT-DAY-07 T-NUT-RLS-04 the neighbour''s days count none of another person''s meals');

select * from finish();
rollback;
