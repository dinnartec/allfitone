-- El catálogo de alimentos, el consentimiento de reconocimiento y de dónde sale cada ítem
-- (ADR-041, OP-NUT-014..017).
--
-- El catálogo trae ajonjolí tostado y molido, uno retirado, y un cuchuco hecho con sus
-- partes. Quien come busca con y sin tildes y por sinónimo, registra una comida con un
-- alimento del catálogo y otro reconocido en foto, y acepta el consentimiento; la vecina
-- no ve ni sus frecuentes ni su consentimiento, y nadie escribe en el catálogo.
--
-- Escritas antes de las funciones y vistas fallar.
begin;

select plan(22);

insert into identity.people (id, given_name, family_name, status)
values ('019f1300-0000-7000-8000-000000000001', 'Quien', 'Come', 'active'),
       ('019f1300-0000-7000-8000-000000000002', 'La', 'Vecina', 'active');

insert into nutrition.foods (id, name, kind, source, source_ref, status, published_at)
values
  ('019f1300-0000-7000-8000-000000000101', 'Ajonjolí tostado', 'ingredient', 'usda', '170150', 'published', clock_timestamp()),
  ('019f1300-0000-7000-8000-000000000102', 'Ajonjolí molido', 'ingredient', 'usda', '170151', 'published', clock_timestamp()),
  ('019f1300-0000-7000-8000-000000000103', 'Ajonjolí retirado', 'ingredient', 'usda', '170152', 'deprecated', clock_timestamp()),
  ('019f1300-0000-7000-8000-000000000104', 'Cuchuco de trigo', 'dish', 'allfit_recipe', null, 'published', clock_timestamp());

insert into nutrition.food_aliases (food_id, alias)
values ('019f1300-0000-7000-8000-000000000101', 'Sésamo');

insert into nutrition.food_nutrients (food_id, nutrient_definition_id, value_per_100g, unit_code)
select '019f1300-0000-7000-8000-000000000101', id,
       case code when 'energy' then 565 when 'protein' then 17 when 'carbohydrates' then 26 when 'fat' then 48 end,
       canonical_unit_code
from nutrition.nutrient_definitions where code in ('energy', 'protein', 'carbohydrates', 'fat');

insert into nutrition.food_portions (food_id, label, grams, position, is_default)
values ('019f1300-0000-7000-8000-000000000101', '1 cucharada', 9, 1, true),
       ('019f1300-0000-7000-8000-000000000101', '1 taza', 144, 2, false);

insert into nutrition.food_recipe_parts (dish_id, part_food_id, grams, position)
values ('019f1300-0000-7000-8000-000000000104', '019f1300-0000-7000-8000-000000000101', 10, 1);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f1300-0000-7000-8000-000000000001', true);

-- ———————————————————————————————— buscar (OP-NUT-014)

select is(
  (select jsonb_agg(f->>'id') from jsonb_array_elements(nutrition.search_foods('ajonjoli', 10)->'data') as f
   where f->>'id' like '019f1300%'),
  '["019f1300-0000-7000-8000-000000000102", "019f1300-0000-7000-8000-000000000101"]'::jsonb,
  'T-NUT-FOOD-01 a search without accents finds both, and never the retired one');

select is(
  (nutrition.search_foods('Ajonjolí tostado', 10)->'data'->0->>'id'),
  '019f1300-0000-7000-8000-000000000101',
  'T-NUT-FOOD-02 an exact name comes first');

select is(
  (select count(*)::integer from jsonb_array_elements(nutrition.search_foods('SESAMO', 10)->'data') as f
   where f->>'id' = '019f1300-0000-7000-8000-000000000101'),
  1, 'T-NUT-FOOD-03 a synonym finds the food, whatever its case and accents');

select is(
  (select f->'nutrients' from jsonb_array_elements(nutrition.search_foods('sesamo', 10)->'data') as f
   where f->>'id' = '019f1300-0000-7000-8000-000000000101'),
  '[{"nutrient_code": "carbohydrates", "unit": "g", "value_per_100g": 26},
    {"nutrient_code": "energy", "unit": "kcal", "value_per_100g": 565},
    {"nutrient_code": "fat", "unit": "g", "value_per_100g": 48},
    {"nutrient_code": "protein", "unit": "g", "value_per_100g": 17}]'::jsonb,
  'T-NUT-FOOD-04 each food comes with its nutrients per 100 g');

select is(
  (select f->'portions' from jsonb_array_elements(nutrition.search_foods('sesamo', 10)->'data') as f
   where f->>'id' = '019f1300-0000-7000-8000-000000000101'),
  '[{"label": "1 cucharada", "grams": 9, "is_default": true}, {"label": "1 taza", "grams": 144, "is_default": false}]'::jsonb,
  'T-NUT-FOOD-05 and with its portions, in order');

select throws_ok(
  $$ select nutrition.search_foods('', 10) $$,
  '22023', null, 'T-NUT-FOOD-06 an empty search is refused');

-- ———————————————————————————————— cruzar lo reconocido

select is(
  (select jsonb_agg(coalesce(m->>'id', 'none')) from jsonb_array_elements(
     nutrition.match_foods(array['ajonjolí tostado', 'sésamo', 'piedra'])) as m),
  '["019f1300-0000-7000-8000-000000000101", "019f1300-0000-7000-8000-000000000101", "none"]'::jsonb,
  'T-NUT-FOOD-07 each recognised name meets its food by name or synonym, in order, or nothing');

-- ———————————————————————————————— consentimiento (OP-NUT-017)

select is(
  nutrition.read_recognition_consent('019f1300-0000-7000-8000-000000000001'),
  '{"accepted_version": null, "accepted_at": null}'::jsonb,
  'T-NUT-CONSENT-01 nobody has consented until they do');

select throws_ok(
  $$ select nutrition.accept_recognition_consent('019f1300-0000-7000-8000-000000000001', 'una-que-no-existe',
       'f6111111-1111-4111-8111-111111111401', extensions.uuid_generate_v7(), decode(repeat('41', 32), 'hex')) $$,
  '22023', null, 'T-NUT-CONSENT-02 an unknown text version is refused');

select nutrition.accept_recognition_consent('019f1300-0000-7000-8000-000000000001', '2026-10-04',
  'f6111111-1111-4111-8111-111111111402', '019f1300-0000-7000-8000-000000000402', decode(repeat('42', 32), 'hex'));

select is(
  nutrition.read_recognition_consent('019f1300-0000-7000-8000-000000000001')->>'accepted_version',
  '2026-10-04', 'T-NUT-CONSENT-03 the accepted version is kept');

select is(
  (nutrition.accept_recognition_consent('019f1300-0000-7000-8000-000000000001', '2026-10-04',
     'f6111111-1111-4111-8111-111111111402', '019f1300-0000-7000-8000-000000000402', decode(repeat('42', 32), 'hex'))->>'accepted_version'),
  '2026-10-04', 'T-NUT-CONSENT-04 accepting again with the same key answers the same, once');

-- ———————————————————————————————— de dónde sale cada ítem (ADR-041 §6)

select nutrition.record_meal(
  '019f1300-0000-7000-8000-000000000001',
  '{"occurred_at":"2026-10-04T20:30:00-05:00","timezone":"America/Bogota","meal_type":"dinner",
    "recognized_by":"google/gemini-3.5-flash-lite","items":[
      {"position":1,"name":"Ajonjolí tostado","quantity":9,"quantity_unit":"g","origin":"catalog",
       "food_id":"019f1300-0000-7000-8000-000000000101","nutrients":[{"nutrient_code":"energy","value":51,"unit":"kcal"}]},
      {"position":2,"name":"Arroz","quantity":150,"quantity_unit":"g","origin":"photo","nutrients":[]},
      {"position":3,"name":"Agua de panela","origin":"typed","nutrients":[]}]}'::jsonb,
  'f6111111-1111-4111-8111-111111111403', '019f1300-0000-7000-8000-000000000501', decode(repeat('43', 32), 'hex')
) as dinner \gset

select is(
  (select jsonb_agg(jsonb_build_object('origin', i->'origin', 'food', i->'food_id') order by (i->>'position')::int)
   from jsonb_array_elements(:'dinner'::jsonb->'items') as i),
  '[{"origin": "catalog", "food": "019f1300-0000-7000-8000-000000000101"},
    {"origin": "photo", "food": null}, {"origin": "typed", "food": null}]'::jsonb,
  'T-NUT-FOOD-08 each item says where it came from, with its food when it has one');

select is(
  :'dinner'::jsonb->>'recognized_by', 'google/gemini-3.5-flash-lite',
  'T-NUT-FOOD-09 the meal says which model recognised it');

select throws_ok(
  $$ select nutrition.record_meal('019f1300-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-10-04T21:00:00-05:00","timezone":"America/Bogota","meal_type":"snack","items":[
         {"position":1,"name":"Retirado","origin":"catalog","food_id":"019f1300-0000-7000-8000-000000000103","nutrients":[]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111404', extensions.uuid_generate_v7(), decode(repeat('44', 32), 'hex')) $$,
  '23514', null, 'T-NUT-FOOD-10 an item from the catalogue needs a published food');

select throws_ok(
  $$ select nutrition.record_meal('019f1300-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-10-04T21:00:00-05:00","timezone":"America/Bogota","meal_type":"snack","items":[
         {"position":1,"name":"Sin alimento","origin":"catalog","nutrients":[]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111405', extensions.uuid_generate_v7(), decode(repeat('45', 32), 'hex')) $$,
  '23514', null, 'T-NUT-FOOD-11 and an item said to be from the catalogue cannot come without one');

select is(
  (select jsonb_agg(i->>'origin') from jsonb_array_elements(nutrition.record_meal('019f1300-0000-7000-8000-000000000001',
     '{"occurred_at":"2026-10-04T07:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
       "items":[{"position":1,"name":"Café","nutrients":[]}]}'::jsonb,
     'f6111111-1111-4111-8111-111111111406', extensions.uuid_generate_v7(), decode(repeat('46', 32), 'hex'))->'items') as i),
  '["typed"]'::jsonb, 'T-NUT-FOOD-12 an item that says nothing was typed');

-- ———————————————————————————————— lo que más registras (OP-NUT-015)

select is(
  (select jsonb_agg(jsonb_build_object('id', f->'food'->>'id', 'times', f->'times', 'last', f->'last_portion'))
   from jsonb_array_elements(nutrition.my_frequent_foods('019f1300-0000-7000-8000-000000000001', 10)->'data') as f),
  '[{"id": "019f1300-0000-7000-8000-000000000101", "times": 1, "last": {"grams": 9, "quantity": 9, "quantity_unit": "g"}}]'::jsonb,
  'T-NUT-FREQ-01 the foods a person logs, with how often and the last amount');

-- ———————————————————————————————— la vecina y el catálogo

select set_config('app.actor_person_id', '019f1300-0000-7000-8000-000000000002', true);

select is(
  jsonb_array_length(nutrition.my_frequent_foods('019f1300-0000-7000-8000-000000000001', 10)->'data'),
  0, 'T-NUT-FREQ-02 T-NUT-RLS-25 the neighbour reads no one else''s frequent foods');

select is(
  nutrition.read_recognition_consent('019f1300-0000-7000-8000-000000000001'),
  null, 'T-NUT-CONSENT-05 T-NUT-RLS-26 nor their consent');

select throws_ok(
  $$ select nutrition.accept_recognition_consent('019f1300-0000-7000-8000-000000000001', '2026-10-04',
       'f6111111-1111-4111-8111-111111111407', extensions.uuid_generate_v7(), decode(repeat('47', 32), 'hex')) $$,
  '42501', null, 'T-NUT-CONSENT-06 T-NUT-RLS-26 nor gives it in their name');

set local role allfit_api;
select throws_ok(
  $$ insert into nutrition.foods (name, kind, source) values ('Intruso', 'ingredient', 'allfit_recipe') $$,
  '42501', null, 'T-NUT-FOOD-13 T-NUT-RLS-27 the runtime role writes nothing in the catalogue');

set local role allfit_owner;
select is(
  (select count(*)::integer from nutrition.recognition_consents), 0,
  'T-NUT-FOOD-14 T-NUT-RLS-26 straight at the table, the neighbour sees no consent of another''s');

select * from finish();
rollback;
