-- T-NUT-DISP-01 — OP-NUT-001, OP-NUT-002, OP-NUT-004 and OP-SUP-003 over meals
-- (`HU-SP-067`, `HU-SP-068`, `HU-SP-070`, `HU-BO-009`).
--
-- Ported from the first nutrition schema's test to the commands that replaced its own:
-- `record_meal`, `list_my_meals` and `delete_meal` now take the person the API already
-- resolved and refuse unless the transaction's actor is that person, so the helpers set
-- `app.actor_kind` and `app.actor_person_id` before each call instead of passing a token.
--
-- **A meal is recorded whole or not at all.** At least one item, nutrients only from the
-- published catalogue in their canonical unit, never negative; the moment, the time zone
-- and the day it belongs to are fixed when it is recorded and survive any correction
-- (`IX-28`, `IX-29`).
--
-- **Deleting it takes its items and values with it**, under the nutrition policy, and leaves
-- only the closed case and an announcement that carries the meal id and nothing else.
--
-- **Support reads meals only through its own restricted window**, audited before it answers.
--
-- Refusals that a gap in the command could let through are aimed at the second person, so
-- a meal recorded by mistake never shifts the first person's lists further down.

begin;

select plan(58);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b7000-0000-7000-8000-000000000001', 'Subject', 'Meal', 'active'),
  ('019b7000-0000-7000-8000-000000000002', 'Other', 'Meal', 'active'),
  ('019b7000-0000-7000-8000-000000000003', 'Closed', 'Meal', 'closed'),
  ('019b7000-0000-7000-8000-000000000011', 'Manager', 'Alpha', 'active'),
  ('019b7000-0000-7000-8000-000000000012', 'Manager', 'Beta', 'active'),
  ('019b7000-0000-7000-8000-000000000013', 'Requester', 'Gamma', 'active'),
  ('019b7000-0000-7000-8000-000000000014', 'Approver', 'Delta', 'active'),
  ('019b7000-0000-7000-8000-000000000015', 'Approver', 'Epsilon', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b7000-0000-7000-8000-000000000101', 'workos', 'https://issuer.test', 'subject_meal',
    '019b7000-0000-7000-8000-000000000001'),
  ('019b7000-0000-7000-8000-000000000102', 'workos', 'https://issuer.test', 'other_meal',
    '019b7000-0000-7000-8000-000000000002'),
  ('019b7000-0000-7000-8000-000000000103', 'workos', 'https://issuer.test', 'closed_meal',
    '019b7000-0000-7000-8000-000000000003'),
  ('019b7000-0000-7000-8000-000000000111', 'workos', 'https://issuer.test', 'alpha_meal', null),
  ('019b7000-0000-7000-8000-000000000112', 'workos', 'https://issuer.test', 'beta_meal', null),
  ('019b7000-0000-7000-8000-000000000113', 'workos', 'https://issuer.test', 'gamma_meal',
    '019b7000-0000-7000-8000-000000000013'),
  ('019b7000-0000-7000-8000-000000000114', 'workos', 'https://issuer.test', 'delta_meal',
    '019b7000-0000-7000-8000-000000000014'),
  ('019b7000-0000-7000-8000-000000000115', 'workos', 'https://issuer.test', 'epsilon_meal',
    '019b7000-0000-7000-8000-000000000015');

select support.bootstrap_backoffice_administrators(
  '019b7000-0000-7000-8000-000000000011', 'alpha_meal',
  '019b7000-0000-7000-8000-000000000012', 'beta_meal',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-MEAL-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
)
select
  session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019b7000-0000-7000-8000-000000000211'::uuid, '019b7000-0000-7000-8000-000000000111'::uuid,
    'alpha_meal', 'd1'),
  ('019b7000-0000-7000-8000-000000000213'::uuid, '019b7000-0000-7000-8000-000000000113'::uuid,
    'gamma_meal', 'd3'),
  ('019b7000-0000-7000-8000-000000000214'::uuid, '019b7000-0000-7000-8000-000000000114'::uuid,
    'delta_meal', 'd4'),
  ('019b7000-0000-7000-8000-000000000215'::uuid, '019b7000-0000-7000-8000-000000000115'::uuid,
    'epsilon_meal', 'd5')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b7000-0000-7000-8000-000000000011', '019b7000-0000-7000-8000-000000000211',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b7000-0000-7000-8000-000000000013'::uuid, '019b7000-0000-7000-8000-000000000313'::uuid,
    '019b7000-0000-7000-8000-000000000413'::uuid, 'a3'),
  ('019b7000-0000-7000-8000-000000000014'::uuid, '019b7000-0000-7000-8000-000000000314'::uuid,
    '019b7000-0000-7000-8000-000000000414'::uuid, 'a4'),
  ('019b7000-0000-7000-8000-000000000015'::uuid, '019b7000-0000-7000-8000-000000000315'::uuid,
    '019b7000-0000-7000-8000-000000000415'::uuid, 'a5')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019b7000-0000-7000-8000-000000000011', '019b7000-0000-7000-8000-000000000211',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-011', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b7000-0000-7000-8000-000000000013'::uuid, 'request_break_glass',
    '019b7000-0000-7000-8000-000000000323'::uuid, '019b7000-0000-7000-8000-000000000423'::uuid, 'b3'),
  ('019b7000-0000-7000-8000-000000000014'::uuid, 'approve_break_glass',
    '019b7000-0000-7000-8000-000000000324'::uuid, '019b7000-0000-7000-8000-000000000424'::uuid, 'b4'),
  ('019b7000-0000-7000-8000-000000000015'::uuid, 'approve_break_glass',
    '019b7000-0000-7000-8000-000000000325'::uuid, '019b7000-0000-7000-8000-000000000425'::uuid, 'b5')
) as duty_row(person_id, duty_code, key, command, hash_byte);

create function pg_temp.as_person(p_person uuid) returns void language sql as $fn$
  select set_config('app.actor_kind', 'person', true);
  select set_config('app.actor_person_id', p_person::text, true);
$fn$;

create function pg_temp.eat(
  p_person uuid, p_meal uuid, p_at timestamptz, p_zone text, p_type text, p_note text,
  p_items jsonb, p_key uuid default gen_random_uuid(),
  p_hash bytea default extensions.gen_random_bytes(32)
) returns jsonb
language sql as $fn$
  select pg_temp.as_person(p_person);
  select nutrition.record_meal(
    p_person,
    jsonb_build_object('occurred_at', p_at, 'timezone', p_zone, 'meal_type', p_type,
      'note', p_note, 'items', p_items),
    p_key, p_meal, p_hash
  )
$fn$;

create function pg_temp.forget(
  p_person uuid, p_meal uuid, p_key uuid default gen_random_uuid(),
  p_command uuid default extensions.uuid_generate_v7(),
  p_hash bytea default extensions.gen_random_bytes(32)
) returns jsonb
language sql as $fn$
  select pg_temp.as_person(p_person);
  select nutrition.delete_meal(p_person, p_meal, p_key, p_command, p_hash)
$fn$;

-- The first person's meals over a range of local days, as the person.
create function pg_temp.mine(
  p_from date, p_to date, p_limit integer default 50, p_cursor text default null
) returns jsonb
language sql as $fn$
  select pg_temp.as_person('019b7000-0000-7000-8000-000000000001');
  select nutrition.list_my_meals('019b7000-0000-7000-8000-000000000001', p_from, p_to, p_cursor, p_limit)
$fn$;

-- One item with two nutrients, used where the shape is not the point.
create function pg_temp.rice() returns jsonb language sql as $fn$
  select '[{"position": 1, "name": "Arroz", "quantity": 150, "quantity_unit": "g",
            "nutrients": [{"nutrient_code": "energy", "value": 195, "unit": "kcal"},
                          {"nutrient_code": "carbohydrates", "value": 42, "unit": "g"}]}]'::jsonb
$fn$;

-- The dinner the first person records, and replays, below.
create function pg_temp.dinner() returns jsonb language sql as $fn$
  select '[{"position": 1, "name": "Pollo a la plancha", "quantity": 120, "quantity_unit": "g",
            "nutrients": [{"nutrient_code": "energy", "value": 198, "unit": "kcal"},
                          {"nutrient_code": "protein", "value": 37, "unit": "g"}]},
           {"position": 2, "name": "Agua", "quantity": 500, "quantity_unit": "ml",
            "nutrients": [{"nutrient_code": "water", "value": 500, "unit": "ml"}]},
           {"position": 3, "name": "Ensalada", "nutrients": []}]'::jsonb
$fn$;

-- ---------------------------------------------------------------------------
-- What can be recorded
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select code, canonical_unit_code, status::text,
            (select count(*)::integer from nutrition.nutrient_definitions where status = 'published')
     from nutrition.nutrient_definitions
     where code in ('carbohydrates', 'energy', 'fat', 'fiber', 'protein', 'water')
     order by code $$,
  $$ values ('carbohydrates'::text, 'g'::text, 'published'::text, 31),
            ('energy'::text, 'kcal'::text, 'published'::text, 31),
            ('fat'::text, 'g'::text, 'published'::text, 31),
            ('fiber'::text, 'g'::text, 'published'::text, 31),
            ('protein'::text, 'g'::text, 'published'::text, 31),
            ('water'::text, 'ml'::text, 'published'::text, 31) $$,
  'T-NUT-DISP-01 the first six nutrients keep their canonical units among the 31 published'
);

select is(
  enum_range(null::nutrition.meal_type)::text[],
  array['breakfast', 'lunch', 'dinner', 'snack', 'other'],
  'T-NUT-DISP-02 a meal is one of five kinds'
);

select throws_ok(
  $$ update nutrition.nutrient_definitions set canonical_unit_code = 'kg' where code = 'protein' $$,
  '55000', null,
  'T-NUT-DISP-03 a published nutrient never changes its unit under the history that uses it'
);

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------

create temporary table lunch on commit drop as
select pg_temp.eat(
  '019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000501',
  ((current_date - 10)::text || ' 23:30:00+00')::timestamptz, 'America/Bogota', 'dinner', 'Con poca sal',
  pg_temp.dinner(), 'a0000000-0000-4000-8000-000000000701', decode(repeat('61', 32), 'hex')
) as result;

select results_eq(
  $$ select result->>'meal_type', result->>'timezone', result->>'local_date', result->>'note',
            jsonb_array_length(result->'items'), result->'media_ref'
     from lunch $$,
  $$ values ('dinner'::text, 'America/Bogota'::text, (current_date - 10)::text, 'Con poca sal'::text,
             3, 'null'::jsonb) $$,
  'T-NUT-DISP-04 a meal is recorded whole, and its day is the day where it was eaten, not in UTC'
);

select results_eq(
  $$ select item->>'position', item->>'name', (item->>'quantity')::numeric, item->>'quantity_unit',
            jsonb_array_length(item->'nutrients')
     from lunch, jsonb_array_elements(result->'items') as item
     order by (item->>'position')::integer $$,
  $$ values ('1'::text, 'Pollo a la plancha'::text, 120::numeric, 'g'::text, 2),
            ('2'::text, 'Agua'::text, 500::numeric, 'ml'::text, 1),
            ('3'::text, 'Ensalada'::text, null::numeric, null::text, 0) $$,
  'T-NUT-DISP-05 items keep the positions the client gave them, and a quantity is optional'
);

select is(
  (select person_id from nutrition.meals where id = '019b7000-0000-7000-8000-000000000501'),
  '019b7000-0000-7000-8000-000000000001'::uuid,
  'T-NUT-DISP-06 the meal belongs to the person in the actor context, and its id is the command'
);

select results_eq(
  $$ select count(distinct item.person_id)::integer, count(distinct value.person_id)::integer,
            bool_and(value.meal_id = item.meal_id)
     from nutrition.meal_items as item
     join nutrition.meal_nutrient_values as value on value.meal_item_id = item.id
     where item.meal_id = '019b7000-0000-7000-8000-000000000501' $$,
  $$ values (1, 1, true) $$,
  'T-NUT-DISP-07 items and values carry the same meal and the same person (IX-28)'
);

select results_eq(
  $$ select replay->>'id',
            (select count(*)::integer from nutrition.meals
             where person_id = '019b7000-0000-7000-8000-000000000001')
     from (select pg_temp.eat('019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000501',
       ((current_date - 10)::text || ' 23:30:00+00')::timestamptz, 'America/Bogota', 'dinner', 'Con poca sal',
       pg_temp.dinner(), 'a0000000-0000-4000-8000-000000000701', decode(repeat('61', 32), 'hex')) as replay) as retried $$,
  $$ values ('019b7000-0000-7000-8000-000000000501'::text, 1) $$,
  'T-NUT-DISP-08 a retried recording answers the same meal instead of a second one'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000501',
       now(), 'America/Bogota', 'lunch', null, pg_temp.rice(),
       'a0000000-0000-4000-8000-000000000701', decode(repeat('62', 32), 'hex')) $$,
  '23505', null,
  'T-NUT-DISP-09 the same key with another meal is a conflict, not a correction'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null, '[]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-10 an empty meal is not recorded'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null,
       '[{"position": 1, "name": "Café", "nutrients": [{"nutrient_code": "caffeine", "value": 1, "unit": "mg"}]}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-11 a nutrient outside the published catalogue is refused'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null,
       '[{"position": 1, "name": "Pan", "nutrients": [{"nutrient_code": "energy", "value": 800, "unit": "kg"}]}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-12 a nutrient is written in its own unit'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null,
       '[{"position": 1, "name": "Pan", "nutrients": [{"nutrient_code": "fat", "value": -1, "unit": "g"}]}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-13 a nutrient value is never negative'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null,
       '[{"position": 1, "name": "Pan", "nutrients": [{"nutrient_code": "fat", "value": 2, "unit": "g"},
                                       {"nutrient_code": "fat", "value": 3, "unit": "g"}]}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-14 an item says each nutrient once'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null,
       '[{"position": 1, "name": "Pan", "quantity": 2, "quantity_unit": "percent", "nutrients": []}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-15 a quantity is a mass or a volume'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null,
       '[{"position": 1, "name": "Pan", "quantity": 2, "nutrients": []}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-16 a quantity comes with its unit'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000002', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null,
       '[{"position": 1, "name": "Pan", "quantity": "2", "quantity_unit": "g", "nutrients": []}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-17 a quantity is a number, not text that looks like one'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null, '[{"position": 1, "name": "  ", "nutrients": []}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-18 an item has a name'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null,
       '[{"position": 1, "name": "Pan", "nutrients": []},
         {"position": 1, "name": "Queso", "nutrients": []}]'::jsonb) $$,
  '23514', null,
  'T-NUT-DISP-19 two items never share a position'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null, '[{"position": 1.5, "name": "Pan", "nutrients": []}]'::jsonb) $$,
  '22P02', null,
  'T-NUT-DISP-20 a position is a whole number'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'Mars/Olympus_Mons', 'lunch', null, pg_temp.rice()) $$,
  '22023', null,
  'T-NUT-DISP-21 a meal happens in a real time zone'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000002', extensions.uuid_generate_v7(),
       now() + interval '3 days', 'America/Bogota', 'lunch', null, pg_temp.rice()) $$,
  '22023', null,
  'T-NUT-DISP-22 nobody records a meal they have not eaten yet'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'brunch', null, pg_temp.rice()) $$,
  '22P02', null,
  'T-NUT-DISP-23 a meal is one of the five kinds'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000003', extensions.uuid_generate_v7(), now(),
       'America/Bogota', 'lunch', null, pg_temp.rice()) $$,
  '42501', null,
  'T-NUT-DISP-24 a closed person records nothing'
);

select is(
  (select array_agg(field order by field)
   from system.outbox_events, jsonb_object_keys(payload) as field
   where aggregate_id = '019b7000-0000-7000-8000-000000000501'
     and event_type = 'nutrition.meal_recorded.v1'),
  array['meal_id'],
  'T-NUT-DISP-25 the event says a meal exists, never what was eaten'
);

select is(
  (select count(*)::integer from system.outbox_events
   where aggregate_id = '019b7000-0000-7000-8000-000000000501'),
  1,
  'T-NUT-DISP-26 and says it once, however many times the recording is retried'
);

select throws_ok(
  $$ update nutrition.meals
     set occurred_at = occurred_at + interval '1 day', timezone = 'America/Lima',
         local_date = local_date + 1
     where id = '019b7000-0000-7000-8000-000000000501' $$,
  '55000', null,
  'T-NUT-DISP-27 a correction never moves the moment, the zone or the day a meal was recorded with'
);

select throws_ok(
  $$ insert into nutrition.meal_nutrient_values (
       meal_item_id, meal_id, person_id, nutrient_definition_id, value_numeric, unit_code
     )
     select item.id, item.meal_id, item.person_id, nutrient.id, 3, 'kg'
     from nutrition.meal_items as item, nutrition.nutrient_definitions as nutrient
     where item.meal_id = '019b7000-0000-7000-8000-000000000501' and item.position = 3
       and nutrient.code = 'fiber' $$,
  '23514', null,
  'T-NUT-DISP-28 a value in another unit is refused by the table, not only by the function (IX-29)'
);

select throws_ok(
  $$ insert into nutrition.meal_items (meal_id, person_id, position, name)
     values ('019b7000-0000-7000-8000-000000000501', '019b7000-0000-7000-8000-000000000002',
       9, 'Ajeno') $$,
  '23503', null,
  'T-NUT-DISP-29 an item cannot claim a meal of another person (IX-28)'
);

select throws_ok(
  $$ insert into nutrition.meals (id, person_id, occurred_at, timezone, local_date, meal_type)
     values (extensions.uuid_generate_v7(), '019b7000-0000-7000-8000-000000000001',
       ((current_date - 10)::text || ' 23:30:00+00')::timestamptz, 'America/Bogota', (current_date - 9), 'dinner') $$,
  '23514', null,
  'T-NUT-DISP-30 the day of a meal is the day of its moment in its zone, whoever writes it'
);

select throws_ok(
  $$ insert into nutrition.meals (id, person_id, occurred_at, timezone, local_date, meal_type)
     values (extensions.uuid_generate_v7(), '019b7000-0000-7000-8000-000000000001',
       ((current_date - 10)::text || ' 23:30:00+00')::timestamptz, 'Mars/Olympus_Mons', (current_date - 10), 'dinner') $$,
  '23514', null,
  'T-NUT-DISP-31 nor can anyone file a meal in a zone that does not exist'
);

-- ---------------------------------------------------------------------------
-- Reading my own
-- ---------------------------------------------------------------------------

select pg_temp.eat('019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000502',
  now() - interval '2 hours', 'America/Bogota', 'lunch', null, pg_temp.rice());
select pg_temp.eat('019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000503',
  now() - interval '1 hour', 'America/Bogota', 'snack', null, pg_temp.rice());
select pg_temp.eat('019b7000-0000-7000-8000-000000000002', '019b7000-0000-7000-8000-000000000601',
  now() - interval '30 minutes', 'America/Bogota', 'snack', 'Ajeno', pg_temp.rice());

select results_eq(
  $$ select entry->>'id' from jsonb_array_elements(pg_temp.mine(current_date - 29, current_date + 1)->'data') as entry $$,
  $$ values ('019b7000-0000-7000-8000-000000000503'::text),
            ('019b7000-0000-7000-8000-000000000502'::text),
            ('019b7000-0000-7000-8000-000000000501'::text) $$,
  'T-NUT-DISP-32 a person reads their own meals, most recent first, and nobody else''s'
);

select is(
  pg_temp.mine(current_date - 29, current_date + 1, 2)->'page'->>'has_more',
  'true',
  'T-NUT-DISP-33 the list says when there is more than it returned'
);

select results_eq(
  $$ select entry->>'id' from jsonb_array_elements(pg_temp.mine(current_date - 29, current_date + 1, 50,
       pg_temp.mine(current_date - 29, current_date + 1, 2)->'page'->>'next_cursor')->'data') as entry $$,
  $$ values ('019b7000-0000-7000-8000-000000000501'::text) $$,
  'T-NUT-DISP-34 and continues after the last one it returned'
);

select pg_temp.as_person('019b7000-0000-7000-8000-000000000001');

select is(
  nutrition.list_my_meals('019b7000-0000-7000-8000-000000000002', current_date - 29, current_date + 1, null, 50),
  '{"data": [], "page": {"has_more": false, "next_cursor": null}}'::jsonb,
  'T-NUT-DISP-35 asking for someone other than the actor reads nothing'
);

select results_eq(
  $$ select entry->>'id' from jsonb_array_elements(pg_temp.mine(current_date - 10, current_date - 10)->'data') as entry $$,
  $$ values ('019b7000-0000-7000-8000-000000000501'::text) $$,
  'T-NUT-DISP-36 a page reads the local days it names, not the UTC ones'
);

select throws_ok(
  $$ select pg_temp.mine(current_date - 40, current_date) $$,
  '22023', null,
  'T-NUT-DISP-37 and never more than a month of them at once'
);

select ok(
  (select bool_and(not entry ? 'person_id')
   from jsonb_array_elements(pg_temp.mine(current_date - 29, current_date + 1)->'data') as entry),
  'T-NUT-DISP-38 a meal never says whose it is'
);

-- ---------------------------------------------------------------------------
-- Support reads it through its own restricted window
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b7000-0000-7000-8000-000000000013', true);

create temporary table meal_window on commit drop as
select result from support.request_break_glass(
  '019b7000-0000-7000-8000-000000000013', '019b7000-0000-7000-8000-000000000213',
  '019b7000-0000-7000-8000-000000000001', array['nutrition_intake'],
  'customer_support_request', 'CASE-2026-011',
  'b0000000-0000-4000-8000-000000000721', '019b7000-0000-7000-8000-000000000721',
  decode(repeat('75', 32), 'hex')
);

select support.decide_break_glass(
  person_id, session_id, (select (result->>'id')::uuid from meal_window), 'approved',
  'REASON-OK', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b7000-0000-7000-8000-000000000014'::uuid, '019b7000-0000-7000-8000-000000000214'::uuid,
    'b0000000-0000-4000-8000-000000000722'::uuid, '019b7000-0000-7000-8000-000000000722'::uuid, '76'),
  ('019b7000-0000-7000-8000-000000000015'::uuid, '019b7000-0000-7000-8000-000000000215'::uuid,
    'b0000000-0000-4000-8000-000000000723'::uuid, '019b7000-0000-7000-8000-000000000723'::uuid, '77')
) as approval(person_id, session_id, key, command, hash_byte);

create temporary table meal_read on commit drop as
select support.exercise_break_glass(
  '019b7000-0000-7000-8000-000000000013', '019b7000-0000-7000-8000-000000000213',
  (select (result->>'id')::uuid from meal_window), 'nutrition_intake', 'nutrition.meals', null
) as answer;

select results_eq(
  $$ select answer->>'outcome', jsonb_array_length(answer->'content'->'nutrition_intake')
     from meal_read $$,
  $$ values ('allowed'::text, 3) $$,
  'T-NUT-DISP-39 the approved window reads the subject''s three meals'
);

select ok(
  (select bool_and(entry ? 'items' and entry ? 'has_media' and not entry ? 'media_ref'
                   and not entry ? 'person_id')
   from meal_read, jsonb_array_elements(answer->'content'->'nutrition_intake') as entry),
  'T-NUT-DISP-40 each carries what was eaten and whether a photo exists, never where it is'
);

select ok(
  (select position('019b7000-0000-7000-8000-000000000601' in answer::text) = 0
     and position('Ajeno' in answer::text) = 0
   from meal_read),
  'T-NUT-DISP-41 another person''s meal never enters the window'
);

select is(
  (select result from privacy.access_events
   where actor_person_id = '019b7000-0000-7000-8000-000000000013'
     and subject_person_id = '019b7000-0000-7000-8000-000000000001'
     and resource = 'nutrition.meals'
   order by occurred_at desc limit 1),
  'allowed',
  'T-NUT-DISP-42 the read is recorded against the person before the content is returned'
);

select is(
  (select support.exercise_break_glass(
     '019b7000-0000-7000-8000-000000000013', '019b7000-0000-7000-8000-000000000213',
     (select (result->>'id')::uuid from meal_window), 'nutrition_intake',
     'identity.health_context_claims', null
   )->>'reason_code'),
  'resource_out_of_scope',
  'T-NUT-DISP-43 a meal window cannot be pointed at another kind of data'
);

-- ---------------------------------------------------------------------------
-- Deleting my own
-- ---------------------------------------------------------------------------

create temporary table forgotten on commit drop as
select pg_temp.forget(
  '019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000501',
  'a0000000-0000-4000-8000-000000000902', '019b7000-0000-7000-8000-000000000903',
  decode(repeat('92', 32), 'hex')
) as result;

-- The case the deletion opened: the only nutrition case of the person so far.
create temporary table forgotten_case on commit drop as
select item.disposition_case_id as id
from privacy.disposition_items as item
where item.subject_person_id = '019b7000-0000-7000-8000-000000000001'
  and item.data_classification_code = 'nutrition';

select is(
  (select result from forgotten),
  '{"deleted": true, "disposed_media_ref": null}'::jsonb,
  'T-NUT-DISP-44 a person deletes their own meal'
);

select results_eq(
  $$ select
       (select count(*)::integer from nutrition.meals where id = '019b7000-0000-7000-8000-000000000501'),
       (select count(*)::integer from nutrition.meal_items where meal_id = '019b7000-0000-7000-8000-000000000501'),
       (select count(*)::integer from nutrition.meal_nutrient_values where meal_id = '019b7000-0000-7000-8000-000000000501') $$,
  $$ values (0, 0, 0) $$,
  'T-NUT-DISP-45 the meal, its items and its values are gone, with no copy left behind'
);

select results_eq(
  $$ select dcase.status, item.data_classification_code, item.target_kind,
            item.target_nutrition_meal_id is null, item.status::text
     from privacy.disposition_cases as dcase
     join privacy.disposition_items as item on item.disposition_case_id = dcase.id
     where dcase.id = (select id from forgotten_case) $$,
  $$ values ('closed'::text, 'nutrition'::text, 'nutrition_meal'::text, true, 'executed'::text) $$,
  'T-NUT-DISP-46 what stays is a closed nutrition case with no pointer to what it deleted'
);

select is(
  (select item.retention_policy_id = policy.id
   from privacy.disposition_items as item, privacy.retention_policies as policy
   where item.disposition_case_id = (select id from forgotten_case)
     and policy.data_classification_code = 'nutrition' and policy.jurisdiction = 'CO'
     and policy.trigger = 'owner_request' and policy.default_action = 'delete'),
  true,
  'T-NUT-DISP-47 and it names the nutrition policy it followed'
);

select is(
  (select array_agg(field order by field)
   from system.outbox_events, jsonb_object_keys(payload) as field
   where aggregate_id = '019b7000-0000-7000-8000-000000000501'
     and event_type = 'nutrition.meal_deleted.v1'),
  array['meal_id'],
  'T-NUT-DISP-48 the deletion is announced with the meal id and nothing it contained'
);

select results_eq(
  $$ select retried->'deleted',
            (select count(*)::integer from privacy.disposition_items
             where subject_person_id = '019b7000-0000-7000-8000-000000000001'
               and data_classification_code = 'nutrition')
     from (select pg_temp.forget('019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000501',
       'a0000000-0000-4000-8000-000000000902', '019b7000-0000-7000-8000-000000000903',
       decode(repeat('92', 32), 'hex')) as retried) as replay $$,
  $$ values ('true'::jsonb, 1) $$,
  'T-NUT-DISP-49 a retried deletion answers as the first did instead of opening another case'
);

select throws_ok(
  $$ select pg_temp.eat('019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000501',
       ((current_date - 10)::text || ' 23:30:00+00')::timestamptz, 'America/Bogota', 'dinner', 'Con poca sal',
       pg_temp.dinner(), 'a0000000-0000-4000-8000-000000000701', decode(repeat('61', 32), 'hex')) $$,
  'AF410', null,
  'T-NUT-DISP-50 replaying the recording of a deleted meal says it was deleted, and does not bring it back'
);

select throws_ok(
  $$ select pg_temp.forget('019b7000-0000-7000-8000-000000000002', '019b7000-0000-7000-8000-000000000502') $$,
  '42501', null,
  'T-NUT-DISP-51 nobody deletes someone else''s meal'
);

select is(
  (select count(*)::integer from nutrition.meals where id = '019b7000-0000-7000-8000-000000000502'),
  1,
  'T-NUT-DISP-52 and trying leaves it where it was'
);

select throws_ok(
  $$ select pg_temp.forget('019b7000-0000-7000-8000-000000000001', '019b7000-0000-7000-8000-000000000999') $$,
  '42501', null,
  'T-NUT-DISP-53 a meal that does not exist is not found'
);

-- ---------------------------------------------------------------------------
-- The disposition learns meals
-- ---------------------------------------------------------------------------

insert into privacy.disposition_cases (id, subject_person_id, origin, requested_by_person_id)
values ('019b7000-0000-7000-8000-000000000911', '019b7000-0000-7000-8000-000000000001',
  'request', '019b7000-0000-7000-8000-000000000001');

insert into privacy.disposition_items (
  disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
  action, target_kind, target_nutrition_meal_id
)
select '019b7000-0000-7000-8000-000000000911', '019b7000-0000-7000-8000-000000000001',
  'nutrition', policy.id, 'delete', 'nutrition_meal', '019b7000-0000-7000-8000-000000000503'
from privacy.retention_policies as policy
where policy.data_classification_code = 'nutrition' and policy.trigger = 'owner_request';

select throws_ok(
  $$ delete from nutrition.meals where id = '019b7000-0000-7000-8000-000000000503' $$,
  '23503', null,
  'T-NUT-DISP-54 a meal under a pending disposition is not deleted around it'
);

select throws_ok(
  $$ insert into privacy.disposition_items (
       disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
       action, target_kind, target_nutrition_meal_id
     )
     select '019b7000-0000-7000-8000-000000000911', '019b7000-0000-7000-8000-000000000001',
       'nutrition', policy.id, 'delete', 'nutrition_meal', '019b7000-0000-7000-8000-000000000601'
     from privacy.retention_policies as policy
     where policy.data_classification_code = 'nutrition' and policy.trigger = 'owner_request' $$,
  '23514', null,
  'T-NUT-DISP-55 a disposition cannot target another person''s meal'
);

select throws_ok(
  $$ insert into privacy.disposition_items (
       disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
       action, target_kind, target_nutrition_meal_id
     )
     select '019b7000-0000-7000-8000-000000000911', '019b7000-0000-7000-8000-000000000001',
       'health', policy.id, 'delete', 'nutrition_meal', '019b7000-0000-7000-8000-000000000502'
     from privacy.retention_policies as policy
     where policy.data_classification_code = 'health' and policy.trigger = 'owner_request' $$,
  '23514', null,
  'T-NUT-DISP-56 a meal is never disposed of under another kind''s policy'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('allfit_api', 'nutrition.meals', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'nutrition.meal_items', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'nutrition.meal_nutrient_values', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'nutrition.nutrient_definitions', 'INSERT, UPDATE, DELETE'),
  'T-NUT-DISP-57 the runtime touches no meal table directly'
);

select ok(
  has_function_privilege('allfit_api', 'nutrition.record_meal(uuid,jsonb,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api', 'nutrition.read_meal(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api', 'nutrition.list_my_meals(uuid,date,date,text,integer)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'nutrition.revise_meal(uuid,uuid,integer,jsonb,jsonb,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api', 'nutrition.delete_meal(uuid,uuid,uuid,uuid,bytea)', 'EXECUTE')
  and not has_function_privilege('allfit_api', 'nutrition.meal_projection(uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api', 'nutrition.meal_json(uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api', 'nutrition.write_items(uuid,uuid,jsonb)', 'EXECUTE'),
  'T-NUT-DISP-58 it runs the meal commands and nothing behind them'
);

select * from finish();
rollback;
