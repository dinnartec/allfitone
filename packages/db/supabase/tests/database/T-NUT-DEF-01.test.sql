-- El catálogo de nutrientes completo, sus unidades y cómo dijo la persona la cantidad
-- (ADR-041 enmendada, Resolución 810 de 2021).
--
-- Están los 31 nutrientes con su grupo y su valor de referencia, las unidades nuevas, un
-- alimento con todos sus nutrientes y su densidad, y una comida registrada como «1½ taza».
--
-- Escritas antes de las columnas, las unidades y los nutrientes, y vistas fallar.
begin;

select plan(11);

insert into identity.people (id, given_name, family_name, status)
values ('019f1500-0000-7000-8000-000000000001', 'Quien', 'Mide', 'active');

-- ———————————————————————————————— unidades y nutrientes

select is(
  (select jsonb_object_agg(code, jsonb_build_array(dimension, to_canonical_factor))
   from catalog.units where code in ('mg', 'mcg', 'oz', 'l', 'fl_oz')),
  '{"mg": ["mass", 0.000001], "mcg": ["mass", 0.000000001], "oz": ["mass", 0.028349523125],
    "l": ["volume", 1000], "fl_oz": ["volume", 29.5735]}'::jsonb,
  'T-NUT-DEF-01 milligrams, micrograms, ounces, litres and fluid ounces convert to their canonical unit');

select is(
  (select count(*)::integer from nutrition.nutrient_definitions where status = 'published'),
  31, 'T-NUT-DEF-02 thirty-one nutrients are published');

select is(
  (select jsonb_object_agg(code, jsonb_build_array(canonical_unit_code, nutrient_group, daily_reference))
   from nutrition.nutrient_definitions where code in ('energy', 'sodium', 'trans_fat', 'vitamin_a', 'copper', 'sugars')),
  '{"energy": ["kcal", "macro", 2000], "sodium": ["mg", "detail", 2000], "trans_fat": ["g", "detail", 2.2],
    "vitamin_a": ["mcg", "vitamin", 800], "copper": ["mg", "mineral", 0.9], "sugars": ["g", "detail", null]}'::jsonb,
  'T-NUT-DEF-03 each nutrient has its unit, its group and the Resolución 810 reference, none where it gives none');

select throws_ok(
  $$ insert into nutrition.nutrient_definitions (code, name, canonical_unit_code, nutrient_group, maximum_value)
     values ('length_thing', 'Cosa', 'cm', 'detail', 100) $$,
  '23514', null, 'T-NUT-DEF-04 a nutrient is measured in energy, mass or volume, never a length');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f1500-0000-7000-8000-000000000001', true);

select throws_ok(
  $$ select nutrition.record_meal('019f1500-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-10-05T07:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
         "items":[{"position":1,"name":"Leche","nutrients":[{"nutrient_code":"sodium","value":0.1,"unit":"g"}]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111601', extensions.uuid_generate_v7(), decode(repeat('61', 32), 'hex')) $$,
  '23514', null, 'T-NUT-DEF-05 sodium is written in milligrams, its own unit');

-- ———————————————————————————————— cómo lo dijo la persona

select is(
  (select jsonb_agg(jsonb_build_object('serving', i->'serving', 'quantity', i->'quantity', 'sodium', i->'nutrients'))
   from jsonb_array_elements(nutrition.record_meal('019f1500-0000-7000-8000-000000000001',
     '{"occurred_at":"2026-10-05T07:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
       "items":[{"position":1,"name":"Leche","quantity":366,"quantity_unit":"g","serving":"1½ taza",
                 "nutrients":[{"nutrient_code":"sodium","value":157,"unit":"mg"}]}]}'::jsonb,
     'f6111111-1111-4111-8111-111111111602', extensions.uuid_generate_v7(), decode(repeat('62', 32), 'hex'))->'items') as i),
  '[{"serving": "1½ taza", "quantity": 366, "sodium": [{"nutrient_code": "sodium", "value": 157, "unit": "mg"}]}]'::jsonb,
  'T-NUT-DEF-06 a meal keeps the grams and how the person said it');

select is(
  (nutrition.record_meal('019f1500-0000-7000-8000-000000000001',
     '{"occurred_at":"2026-10-05T08:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
       "items":[{"position":1,"name":"Pan","nutrients":[]}]}'::jsonb,
     'f6111111-1111-4111-8111-111111111603', extensions.uuid_generate_v7(), decode(repeat('63', 32), 'hex'))->'items'->0->'serving'),
  'null'::jsonb, 'T-NUT-DEF-07 an item said in no particular way has no serving');

select throws_ok(
  $$ select nutrition.record_meal('019f1500-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-10-05T09:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
         "items":[{"position":1,"name":"Pan","serving":"una cantidad descrita con demasiadas palabras para caber","nutrients":[]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111604', extensions.uuid_generate_v7(), decode(repeat('64', 32), 'hex')) $$,
  '23514', null, 'T-NUT-DEF-08 a serving is short');

-- ———————————————————————————————— un alimento completo

reset role;
insert into nutrition.foods (id, name, kind, source, source_ref, icon, grams_per_ml, status, published_at)
values ('019f1500-0000-7000-8000-000000000101', 'Leche de medida', 'ingredient', 'usda', '171265', 'dairy', 1.03,
        'published', clock_timestamp());
insert into nutrition.food_nutrients (food_id, nutrient_definition_id, value_per_100g, unit_code)
select '019f1500-0000-7000-8000-000000000101', id, 1, canonical_unit_code
from nutrition.nutrient_definitions where status = 'published';
insert into nutrition.products (id, barcode, name, icon, grams_per_ml, status, published_at)
values ('019f1500-0000-7000-8000-000000000201', '7700000000048', 'Bebida de medida', 'drink', 1,
        'published', clock_timestamp());

select is(
  jsonb_array_length(nutrition.food_json('019f1500-0000-7000-8000-000000000101')->'nutrients'),
  31, 'T-NUT-DEF-09 a food comes with every nutrient it has, not six');

select is(
  nutrition.food_json('019f1500-0000-7000-8000-000000000101')->'grams_per_ml',
  '1.03'::jsonb, 'T-NUT-DEF-10 a food says how much a millilitre of it weighs');

select is(
  nutrition.product_json('019f1500-0000-7000-8000-000000000201')->'grams_per_ml',
  '1'::jsonb, 'T-NUT-DEF-11 and so does a product');

select * from finish();
rollback;
