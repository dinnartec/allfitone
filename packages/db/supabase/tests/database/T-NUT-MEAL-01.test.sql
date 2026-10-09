-- Las comidas de una persona: registrar, leer, listar, corregir y eliminar (ADR-027,
-- ADR-040, OP-NUT-001..004).
--
-- Quien come registra un almuerzo con dos ítems el 30 de septiembre y un desayuno el 1 de
-- octubre; lo corrige, le pone foto y lo elimina. La vecina no ve ni toca nada.
--
-- Escritas antes de las funciones y vistas fallar.
begin;

select plan(24);

insert into identity.people (id, given_name, family_name, status)
values ('019f1000-0000-7000-8000-000000000001', 'Quien', 'Come', 'active'),
       ('019f1000-0000-7000-8000-000000000002', 'La', 'Vecina', 'active');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f1000-0000-7000-8000-000000000001', true);

-- ———————————————————————————————— registrar (OP-NUT-001)

select nutrition.record_meal(
  '019f1000-0000-7000-8000-000000000001',
  '{"occurred_at":"2026-09-30T13:10:00-05:00","timezone":"America/Bogota","meal_type":"lunch",
    "note":"Después del entreno","items":[
      {"position":1,"name":"Pechuga de pollo","quantity":150,"quantity_unit":"g","nutrients":[
        {"nutrient_code":"energy","value":248,"unit":"kcal"},{"nutrient_code":"protein","value":46,"unit":"g"},
        {"nutrient_code":"carbohydrates","value":0,"unit":"g"},{"nutrient_code":"fat","value":5,"unit":"g"}]},
      {"position":2,"name":"Arroz blanco","quantity":180,"quantity_unit":"g","nutrients":[
        {"nutrient_code":"energy","value":234,"unit":"kcal"},{"nutrient_code":"protein","value":5,"unit":"g"},
        {"nutrient_code":"carbohydrates","value":51,"unit":"g"}]}]}'::jsonb,
  'f6111111-1111-4111-8111-111111111101', '019f1000-0000-7000-8000-000000000101', decode(repeat('01', 32), 'hex')
) as lunch \gset

select is(
  jsonb_build_object('id', :'lunch'::jsonb->'id', 'day', :'lunch'::jsonb->'local_date', 'type', :'lunch'::jsonb->'meal_type',
    'revision', :'lunch'::jsonb->'revision_number', 'items', jsonb_array_length(:'lunch'::jsonb->'items'),
    'media', :'lunch'::jsonb->'media_ref'),
  '{"id": "019f1000-0000-7000-8000-000000000101", "day": "2026-09-30", "type": "lunch", "revision": 0,
    "items": 2, "media": null}'::jsonb,
  'T-NUT-MEAL-01 a meal is recorded with its Command-Id, its local day and its items');

select is(
  (select jsonb_agg(n order by n->>'nutrient_code') from jsonb_array_elements(:'lunch'::jsonb->'items'->1->'nutrients') as n),
  '[{"nutrient_code": "carbohydrates", "value": 51, "unit": "g"}, {"nutrient_code": "energy", "value": 234, "unit": "kcal"},
    {"nutrient_code": "protein", "value": 5, "unit": "g"}]'::jsonb,
  'T-NUT-MEAL-02 an item keeps only the nutrients written: the fat left out is not zero');

select is(
  (nutrition.record_meal(
    '019f1000-0000-7000-8000-000000000001',
    '{"occurred_at":"2026-09-30T13:10:00-05:00","timezone":"America/Bogota","meal_type":"lunch","items":[
      {"position":1,"name":"Pechuga de pollo","quantity":150,"quantity_unit":"g","nutrients":[]}]}'::jsonb,
    'f6111111-1111-4111-8111-111111111101', '019f1000-0000-7000-8000-000000000101', decode(repeat('01', 32), 'hex')
  ))->>'id',
  '019f1000-0000-7000-8000-000000000101',
  'T-NUT-MEAL-03 a retried record answers the meal already recorded');

select throws_ok(
  $$ select nutrition.record_meal('019f1000-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-09-30T08:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast","items":[]}'::jsonb,
       'f6111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(), decode(repeat('02', 32), 'hex')) $$,
  '23514', null, 'T-NUT-MEAL-04 a meal has at least one item');

select throws_ok(
  $$ select nutrition.record_meal('019f1000-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-09-30T08:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast","items":[
         {"position":1,"name":"Huevo","quantity":null,"quantity_unit":null,"nutrients":[
           {"nutrient_code":"protein","value":6,"unit":"kcal"}]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(), decode(repeat('03', 32), 'hex')) $$,
  '23514', null, 'T-NUT-MEAL-05 a nutrient is written in its own unit or not at all');

select throws_ok(
  $$ select nutrition.record_meal('019f1000-0000-7000-8000-000000000001',
       '{"occurred_at":"2026-09-30T08:00:00-05:00","timezone":"America/Bogota","meal_type":"breakfast","items":[
         {"position":1,"name":"Huevo","quantity":null,"quantity_unit":null,"nutrients":[
           {"nutrient_code":"protein","value":-1,"unit":"g"}]}]}'::jsonb,
       'f6111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(), decode(repeat('04', 32), 'hex')) $$,
  '23514', null, 'T-NUT-MEAL-06 a nutrient is never negative');

-- The day is the one in the meal's own zone: 23:30 in Bogotá is still the 30th.
select is(
  (nutrition.record_meal('019f1000-0000-7000-8000-000000000001',
     '{"occurred_at":"2026-10-01T04:30:00Z","timezone":"America/Bogota","meal_type":"dinner","items":[
       {"position":1,"name":"Sopa","quantity":null,"quantity_unit":null,"nutrients":[
         {"nutrient_code":"energy","value":300,"unit":"kcal"}]}]}'::jsonb,
     'f6111111-1111-4111-8111-111111111105', '019f1000-0000-7000-8000-000000000102', decode(repeat('05', 32), 'hex')))->>'local_date',
  '2026-09-30',
  'T-NUT-MEAL-07 the local day is the meal''s, in its own zone');

select nutrition.record_meal('019f1000-0000-7000-8000-000000000001',
  '{"occurred_at":"2026-10-01T07:40:00-05:00","timezone":"America/Bogota","meal_type":"breakfast","items":[
    {"position":1,"name":"Avena","quantity":80,"quantity_unit":"g","nutrients":[
      {"nutrient_code":"energy","value":420,"unit":"kcal"},{"nutrient_code":"fiber","value":8,"unit":"g"}]}]}'::jsonb,
  'f6111111-1111-4111-8111-111111111106', '019f1000-0000-7000-8000-000000000103', decode(repeat('06', 32), 'hex'));

-- ———————————————————————————————— leer y listar (OP-NUT-002)

select is(
  nutrition.read_meal('019f1000-0000-7000-8000-000000000001', '019f1000-0000-7000-8000-000000000101')->>'note',
  'Después del entreno', 'T-NUT-MEAL-08 the meal reads back whole');

select is(
  (select array_agg(row->>'id') from jsonb_array_elements(
     nutrition.list_my_meals('019f1000-0000-7000-8000-000000000001', '2026-09-30', '2026-10-01', null, 20)->'data') as row),
  array['019f1000-0000-7000-8000-000000000103', '019f1000-0000-7000-8000-000000000102',
        '019f1000-0000-7000-8000-000000000101'],
  'T-NUT-MEAL-09 newest first, across the days asked for');

select nutrition.list_my_meals('019f1000-0000-7000-8000-000000000001', '2026-09-30', '2026-10-01', null, 2) as first_page \gset

select is(
  (select array_agg(row->>'id') from jsonb_array_elements(
     nutrition.list_my_meals('019f1000-0000-7000-8000-000000000001', '2026-09-30', '2026-10-01',
       :'first_page'::jsonb->'page'->>'next_cursor', 2)->'data') as row),
  array['019f1000-0000-7000-8000-000000000101'],
  'T-NUT-MEAL-10 the cursor carries on where the page ended');

-- ———————————————————————————————— corregir (OP-NUT-003)

select nutrition.revise_meal('019f1000-0000-7000-8000-000000000001', '019f1000-0000-7000-8000-000000000101', 0,
  '{"note":"Con más arroz","items":[
     {"position":1,"name":"Pechuga de pollo","quantity":150,"quantity_unit":"g","nutrients":[
       {"nutrient_code":"energy","value":248,"unit":"kcal"},{"nutrient_code":"protein","value":46,"unit":"g"}]},
     {"position":2,"name":"Arroz blanco","quantity":250,"quantity_unit":"g","nutrients":[
       {"nutrient_code":"energy","value":325,"unit":"kcal"}]}]}'::jsonb,
  '{"set":"nutrition/019f1000-0000-7000-8000-000000000001/019f1000-0000-7000-8000-000000000101/a.jpg"}'::jsonb,
  'f6111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(), decode(repeat('07', 32), 'hex')) as revised \gset

select is(
  jsonb_build_object('revision', :'revised'::jsonb->'revision_number', 'note', :'revised'::jsonb->'note',
    'rice', :'revised'::jsonb->'items'->1->'quantity', 'day', :'revised'::jsonb->'local_date',
    'media', :'revised'::jsonb->'media_ref', 'disposed', :'revised'::jsonb->'disposed_media_ref'),
  '{"revision": 1, "note": "Con más arroz", "rice": 250, "day": "2026-09-30",
    "media": "nutrition/019f1000-0000-7000-8000-000000000001/019f1000-0000-7000-8000-000000000101/a.jpg", "disposed": null}'::jsonb,
  'T-NUT-MEAL-11 a correction replaces items and note in place, adds the photo and keeps the day');

select throws_ok(
  $$ select nutrition.revise_meal('019f1000-0000-7000-8000-000000000001', '019f1000-0000-7000-8000-000000000101', 0,
       '{"note":"Otra"}'::jsonb, null, 'f6111111-1111-4111-8111-111111111108', extensions.uuid_generate_v7(),
       decode(repeat('08', 32), 'hex')) $$,
  '40001', null, 'T-NUT-MEAL-12 a correction over a stale revision is refused, never merged');

select throws_ok(
  $$ select nutrition.revise_meal('019f1000-0000-7000-8000-000000000001', '019f1000-0000-7000-8000-000000000101', 1,
       '{"occurred_at":"2026-09-30T15:00:00-05:00"}'::jsonb, null, 'f6111111-1111-4111-8111-111111111109',
       extensions.uuid_generate_v7(), decode(repeat('09', 32), 'hex')) $$,
  '23514', null, 'T-NUT-MEAL-13 the hour and the day do not change on correcting');

-- A new photo replaces the old one, which is set down to be removed from storage.
select nutrition.revise_meal('019f1000-0000-7000-8000-000000000001', '019f1000-0000-7000-8000-000000000101', 1,
  '{}'::jsonb,
  '{"set":"nutrition/019f1000-0000-7000-8000-000000000001/019f1000-0000-7000-8000-000000000101/b.jpg"}'::jsonb,
  'f6111111-1111-4111-8111-111111111110', extensions.uuid_generate_v7(), decode(repeat('10', 32), 'hex')) as rephotographed \gset

select is(
  jsonb_build_object('disposed', :'rephotographed'::jsonb->'disposed_media_ref',
    'pending', (select count(*) from nutrition.media_disposals where sealed_at is null)),
  '{"disposed": "nutrition/019f1000-0000-7000-8000-000000000001/019f1000-0000-7000-8000-000000000101/a.jpg", "pending": 1}'::jsonb,
  'T-NUT-MEAL-14 the replaced photo is answered and queued for disposal in the same transaction');

select lives_ok(
  $$ select nutrition.seal_media_disposal('019f1000-0000-7000-8000-000000000001',
       'nutrition/019f1000-0000-7000-8000-000000000001/019f1000-0000-7000-8000-000000000101/a.jpg') $$,
  'T-NUT-MEAL-15 a disposal is sealed once storage has removed it');

select is(
  (select count(*)::integer from nutrition.media_disposals where sealed_at is null), 0,
  'T-NUT-MEAL-16 and nothing is left pending');

-- ———————————————————————————————— eliminar (OP-NUT-004)

select nutrition.delete_meal('019f1000-0000-7000-8000-000000000001', '019f1000-0000-7000-8000-000000000101',
  'f6111111-1111-4111-8111-111111111111', extensions.uuid_generate_v7(), decode(repeat('11', 32), 'hex')) as gone \gset

select is(
  jsonb_build_object('disposed', :'gone'::jsonb->'disposed_media_ref',
    'meals', (select count(*) from nutrition.meals where id = '019f1000-0000-7000-8000-000000000101'),
    'items', (select count(*) from nutrition.meal_items where meal_id = '019f1000-0000-7000-8000-000000000101'),
    'values', (select count(*) from nutrition.meal_nutrient_values where meal_id = '019f1000-0000-7000-8000-000000000101')),
  '{"disposed": "nutrition/019f1000-0000-7000-8000-000000000001/019f1000-0000-7000-8000-000000000101/b.jpg",
    "meals": 0, "items": 0, "values": 0}'::jsonb,
  'T-NUT-MEAL-17 deleting removes the meal, its items and nutrients, and queues its photo');

select lives_ok(
  $$ select nutrition.delete_meal('019f1000-0000-7000-8000-000000000001', '019f1000-0000-7000-8000-000000000101',
       'f6111111-1111-4111-8111-111111111111', extensions.uuid_generate_v7(), decode(repeat('11', 32), 'hex')) $$,
  'T-NUT-MEAL-18 a retried delete answers as the first did');

select is(
  nutrition.read_meal('019f1000-0000-7000-8000-000000000001', '019f1000-0000-7000-8000-000000000101'),
  null, 'T-NUT-MEAL-19 and it cannot be read again');

-- ———————————————————————————————— la vecina

select set_config('app.actor_person_id', '019f1000-0000-7000-8000-000000000002', true);

select is(
  nutrition.read_meal('019f1000-0000-7000-8000-000000000002', '019f1000-0000-7000-8000-000000000103'),
  null, 'T-NUT-MEAL-20 T-NUT-RLS-01 the neighbour reads no meal of another person''s');

select is(
  jsonb_array_length(nutrition.list_my_meals('019f1000-0000-7000-8000-000000000002', '2026-09-30', '2026-10-01', null, 20)->'data'),
  0, 'T-NUT-MEAL-21 T-NUT-RLS-01 nor lists one');

select throws_ok(
  $$ select nutrition.revise_meal('019f1000-0000-7000-8000-000000000002', '019f1000-0000-7000-8000-000000000103', 0,
       '{"note":"Mía"}'::jsonb, null, 'f6111111-1111-4111-8111-111111111112', extensions.uuid_generate_v7(),
       decode(repeat('12', 32), 'hex')) $$,
  '42501', null, 'T-NUT-MEAL-22 T-NUT-RLS-02 nor corrects it');

select throws_ok(
  $$ select nutrition.delete_meal('019f1000-0000-7000-8000-000000000002', '019f1000-0000-7000-8000-000000000103',
       'f6111111-1111-4111-8111-111111111113', extensions.uuid_generate_v7(), decode(repeat('13', 32), 'hex')) $$,
  '42501', null, 'T-NUT-MEAL-23 T-NUT-RLS-02 nor deletes it');

-- Straight at the table, RLS answers for the person in the context and nobody else.
set local role allfit_owner;
select is(
  (select count(*)::integer from nutrition.meals), 0,
  'T-NUT-MEAL-24 T-NUT-RLS-03 the table shows the neighbour none of another person''s rows');

select * from finish();
rollback;
