-- Los productos empacados de Open Food Facts (ADR-041 enmendada, OP-NUT-014, OP-NUT-015).
--
-- Viven aparte del catálogo propio (ODbL). Hay una «Leche de prueba» genérica y la misma
-- de la Marca Zeta, más un producto retirado. Quien come busca por nombre y por marca,
-- registra el producto y lo ve en sus frecuentes; un ítem no nombra a la vez alimento y
-- producto, una foto no se casa con una marca, y nadie escribe productos en tiempo real.
--
-- Escritas antes de las tablas y funciones, y vistas fallar.
begin;

select plan(13);

insert into identity.people (id, given_name, family_name, status)
values ('019f1400-0000-7000-8000-000000000001', 'Quien', 'Compra', 'active');

insert into nutrition.foods (id, name, kind, source, source_ref, icon, status, published_at)
values ('019f1400-0000-7000-8000-000000000101', 'Leche de prueba', 'ingredient', 'usda', '171265', 'dairy',
        'published', clock_timestamp());

insert into nutrition.products (id, barcode, name, brand, quantity_label, icon, status, published_at)
values
  ('019f1400-0000-7000-8000-000000000201', '7700000000017', 'Leche de prueba', 'Marca Zeta', '1 L', 'dairy',
   'published', clock_timestamp()),
  ('019f1400-0000-7000-8000-000000000202', '7700000000024', 'Leche de prueba vieja', 'Marca Zeta', null, 'dairy',
   'deprecated', clock_timestamp());

insert into nutrition.product_nutrients (product_id, nutrient_definition_id, value_per_100g, unit_code)
select '019f1400-0000-7000-8000-000000000201', id,
       case code when 'energy' then 62 when 'protein' then 3.1 when 'carbohydrates' then 4.8 when 'fat' then 3.2 end,
       canonical_unit_code
from nutrition.nutrient_definitions where code in ('energy', 'protein', 'carbohydrates', 'fat');

insert into nutrition.product_portions (product_id, label, grams, position, is_default)
values ('019f1400-0000-7000-8000-000000000201', '1 vaso', 250, 1, true);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f1400-0000-7000-8000-000000000001', true);

-- ———————————————————————————————— buscar (OP-NUT-014)

select is(
  (select jsonb_agg(f->>'id') from jsonb_array_elements(nutrition.search_foods('leche de prueba', 10)->'data') as f
   where f->>'id' like '019f1400%'),
  '["019f1400-0000-7000-8000-000000000101", "019f1400-0000-7000-8000-000000000201"]'::jsonb,
  'T-NUT-PROD-01 the generic food comes before the product it ties with, and never the retired one');

select is(
  (select count(*)::integer from jsonb_array_elements(nutrition.search_foods('marca zeta', 10)->'data') as f
   where f->>'id' = '019f1400-0000-7000-8000-000000000201'),
  1, 'T-NUT-PROD-02 a product is found by its brand');

select is(
  (select jsonb_agg((select count(*) from jsonb_array_elements(nutrition.search_foods(q, 10)->'data') as f
                     where f->>'id' = '019f1400-0000-7000-8000-000000000201') order by n)
   from unnest(array['leche zeta', 'yogur zeta']) with ordinality as one (q, n)),
  '[1, 0]'::jsonb, 'T-NUT-PROD-03 every word, in any order, across name and brand; none missing');

select is(
  (select f - 'nutrients' from jsonb_array_elements(nutrition.search_foods('marca zeta leche', 10)->'data') as f
   where f->>'id' = '019f1400-0000-7000-8000-000000000201'),
  '{"id": "019f1400-0000-7000-8000-000000000201", "name": "Leche de prueba", "kind": "product",
    "brand": "Marca Zeta", "icon": "dairy", "grams_per_ml": null,
    "portions": [{"label": "1 vaso", "grams": 250, "is_default": true}]}'::jsonb,
  'T-NUT-PROD-04 brand and name read as one, and a product answers as a food of kind product');

select is(
  (nutrition.search_foods('leche de prueba', 10)->'data'->0->'brand'),
  'null'::jsonb, 'T-NUT-PROD-05 a catalogue food has no brand');

-- ———————————————————————————————— registrar un producto (OP-NUT-001)

select is(
  (select jsonb_agg(jsonb_build_object('product_id', i->'product_id', 'food_id', i->'food_id', 'origin', i->'origin'))
   from jsonb_array_elements(nutrition.record_meal('019f1400-0000-7000-8000-000000000001',
     '{"occurred_at":"2026-10-04T07:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
       "items":[{"position":1,"name":"Leche de prueba","quantity":250,"quantity_unit":"g","origin":"catalog",
                 "product_id":"019f1400-0000-7000-8000-000000000201","nutrients":[]}]}'::jsonb,
     'f6111111-1111-4111-8111-111111111501', extensions.uuid_generate_v7(), decode(repeat('51', 32), 'hex'))->'items') as i),
  '[{"product_id": "019f1400-0000-7000-8000-000000000201", "food_id": null, "origin": "catalog"}]'::jsonb,
  'T-NUT-PROD-06 a meal keeps the product an item was picked from');

select throws_ok(
  $$ select nutrition.record_meal('019f1400-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-10-04T08:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
         "items":[{"position":1,"name":"Leche","origin":"catalog","food_id":"019f1400-0000-7000-8000-000000000101",
                   "product_id":"019f1400-0000-7000-8000-000000000201","nutrients":[]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111502', extensions.uuid_generate_v7(), decode(repeat('52', 32), 'hex')) $$,
  '23514', null, 'T-NUT-PROD-07 an item is a food or a product, never both');

select throws_ok(
  $$ select nutrition.record_meal('019f1400-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-10-04T08:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
         "items":[{"position":1,"name":"Leche vieja","origin":"catalog",
                   "product_id":"019f1400-0000-7000-8000-000000000202","nutrients":[]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111503', extensions.uuid_generate_v7(), decode(repeat('53', 32), 'hex')) $$,
  '23514', 'an item names a product the catalogue does not publish',
  'T-NUT-PROD-08 a retired product cannot be logged');

select throws_ok(
  $$ select nutrition.record_meal('019f1400-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-10-04T08:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast",
         "items":[{"position":1,"name":"Leche","origin":"photo",
                   "product_id":"019f1400-0000-7000-8000-000000000201","nutrients":[]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111504', extensions.uuid_generate_v7(), decode(repeat('54', 32), 'hex')) $$,
  '23514', null, 'T-NUT-PROD-09 a photo is never matched to a brand');

-- ———————————————————————————————— frecuentes y reconocimiento

select is(
  (select jsonb_agg(jsonb_build_object('id', f->'food'->>'id', 'kind', f->'food'->>'kind', 'times', f->'times'))
   from jsonb_array_elements(nutrition.my_frequent_foods('019f1400-0000-7000-8000-000000000001', 10)->'data') as f),
  '[{"id": "019f1400-0000-7000-8000-000000000201", "kind": "product", "times": 1}]'::jsonb,
  'T-NUT-PROD-10 what a person logs most includes products');

select is(
  nutrition.match_foods(array['marca zeta', 'leche de prueba'])->0,
  'null'::jsonb, 'T-NUT-PROD-11 a recognised name never meets a product');

select is(
  nutrition.match_foods(array['leche de prueba'])->0->>'kind',
  'ingredient', 'T-NUT-PROD-12 it meets the generic food instead');

set local role allfit_api;
select throws_ok(
  $$ insert into nutrition.products (barcode, name) values ('7700000000031', 'Intruso') $$,
  '42501', null, 'T-NUT-PROD-13 T-NUT-RLS-28 the runtime role writes no product');

select * from finish();
rollback;
