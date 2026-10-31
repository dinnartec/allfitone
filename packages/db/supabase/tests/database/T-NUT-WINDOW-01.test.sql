-- T-NUT-WINDOW-01 — the free plan sees the last month of its meals (DT-018, HU-SP-086).
--
-- One meal forty days ago and one three days ago. On a free plan with one month the list
-- and the daily summaries leave the old one out, opening it says Pro shows it again, and
-- nothing is deleted. Recording a meal stays free; recognising one by photo is Pro.
--
-- Written before the migration and watched failing.

begin;

select plan(11);

insert into identity.people (id, given_name, family_name, status)
values ('019ef700-0000-7000-8000-000000000001', 'Quien', 'Come', 'active');

-- The free plan, published the only way it can be: proposed by one commercial manager and
-- published by another. Calling it again publishes the next version.
insert into identity.people (id, given_name, family_name, status)
values ('019ef700-0000-7000-8000-0000000000e1', 'Manager', 'Alpha', 'active'),
       ('019ef700-0000-7000-8000-0000000000e2', 'Manager', 'Beta', 'active'),
       ('019ef700-0000-7000-8000-0000000000e3', 'Commerce', 'Gamma', 'active'),
       ('019ef700-0000-7000-8000-0000000000e4', 'Commerce', 'Delta', 'active');
insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values ('019ef700-0000-7000-8000-0000000000f1', 'workos', 'https://issuer.test', 'alpha_nutwin', null),
       ('019ef700-0000-7000-8000-0000000000f2', 'workos', 'https://issuer.test', 'beta_nutwin', null),
       ('019ef700-0000-7000-8000-0000000000f3', 'workos', 'https://issuer.test', 'gamma_nutwin',
         '019ef700-0000-7000-8000-0000000000e3'),
       ('019ef700-0000-7000-8000-0000000000f4', 'workos', 'https://issuer.test', 'delta_nutwin',
         '019ef700-0000-7000-8000-0000000000e4');
select support.bootstrap_backoffice_administrators(
  '019ef700-0000-7000-8000-0000000000e1', 'alpha_nutwin',
  '019ef700-0000-7000-8000-0000000000e2', 'beta_nutwin',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-NUT-WINDOW-01');
insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at)
select session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019ef700-0000-7000-8000-0000000000d1'::uuid, '019ef700-0000-7000-8000-0000000000f1'::uuid, 'alpha_nutwin', 'a1'),
  ('019ef700-0000-7000-8000-0000000000d3'::uuid, '019ef700-0000-7000-8000-0000000000f3'::uuid, 'gamma_nutwin', 'a3'),
  ('019ef700-0000-7000-8000-0000000000d4'::uuid, '019ef700-0000-7000-8000-0000000000f4'::uuid, 'delta_nutwin', 'a4')
) as session_row(session_id, account_id, suffix, hash_byte);
select support.assign_platform_role(
  '019ef700-0000-7000-8000-0000000000e1', '019ef700-0000-7000-8000-0000000000d1',
  person_id, 'allfit_admin', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019ef700-0000-7000-8000-0000000000e3'::uuid), ('019ef700-0000-7000-8000-0000000000e4'::uuid))
  as grant_row(person_id);
select support.assign_platform_duty(
  '019ef700-0000-7000-8000-0000000000e1', '019ef700-0000-7000-8000-0000000000d1',
  person_id, 'manage_platform_commercial', clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-NUT-WINDOW', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019ef700-0000-7000-8000-0000000000e3'::uuid), ('019ef700-0000-7000-8000-0000000000e4'::uuid))
  as duty_row(person_id);

create function pg_temp.free_plan(p_limits jsonb)
returns void
language plpgsql
as $fn$
declare
  plan_id uuid;
  version_id uuid;
  kind text := current_setting('app.actor_kind', true);
  actor text := current_setting('app.actor_person_id', true);
begin
  perform set_config('app.actor_kind', 'support', true);
  perform set_config('app.actor_person_id', '019ef700-0000-7000-8000-0000000000e3', true);
  select id into plan_id from payments.platform_plans where plan_kind = 'free';
  if plan_id is null then
    select (result->>'id')::uuid into plan_id from payments.create_platform_plan(
      '019ef700-0000-7000-8000-0000000000e3', '019ef700-0000-7000-8000-0000000000d3',
      'free', 'Gratis', 'free', gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  end if;
  select (result->'proposal'->>'id')::uuid into version_id
  from payments.propose_platform_plan_version(
    '019ef700-0000-7000-8000-0000000000e3', '019ef700-0000-7000-8000-0000000000d3',
    plan_id, 0, null, null,
    (select jsonb_agg(jsonb_build_object(
       'feature_code', feature.code,
       'enabled', coalesce((p_limits->feature.code->>'enabled')::boolean, true),
       'limit_value', (p_limits->feature.code->>'limit_value')::integer))
     from payments.platform_features as feature),
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_person_id', '019ef700-0000-7000-8000-0000000000e4', true);
  perform payments.publish_platform_plan_version(
    '019ef700-0000-7000-8000-0000000000e4', '019ef700-0000-7000-8000-0000000000d4',
    plan_id, version_id, gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_kind', kind, true);
  perform set_config('app.actor_person_id', actor, true);
end
$fn$;

create function pg_temp.refusal(p_sql text)
returns text
language plpgsql
as $fn$
declare
  detail text;
begin
  execute p_sql;
  return 'allowed';
exception when others then
  get stacked diagnostics detail = pg_exception_detail;
  return sqlstate || ':' || coalesce(detail, '');
end
$fn$;

create function pg_temp.meal(p_days_ago integer, p_key uuid)
returns uuid
language sql
as $fn$
  select (nutrition.record_meal('019ef700-0000-7000-8000-000000000001',
    jsonb_build_object(
      'occurred_at', to_char((clock_timestamp() at time zone 'America/Bogota') - make_interval(days => p_days_ago),
                             'YYYY-MM-DD"T"12:00:00-05:00'),
      'timezone', 'America/Bogota', 'meal_type', 'lunch',
      'items', jsonb_build_array(jsonb_build_object('position', 1, 'name', 'Almuerzo',
        'quantity', null, 'quantity_unit', null,
        'nutrients', jsonb_build_array(jsonb_build_object('nutrient_code', 'energy', 'value', 600, 'unit', 'kcal'))))),
    p_key, extensions.uuid_generate_v7(), extensions.gen_random_bytes(32))->>'id')::uuid
$fn$;

create function pg_temp.listed(p_from_days integer)
returns integer
language sql
as $fn$
  select jsonb_array_length(nutrition.list_my_meals('019ef700-0000-7000-8000-000000000001',
    ((clock_timestamp() at time zone 'America/Bogota')::date - p_from_days),
    ((clock_timestamp() at time zone 'America/Bogota')::date - p_from_days + 30), null, 100)->'data')
$fn$;

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef700-0000-7000-8000-000000000001', true);

select pg_temp.meal(40, 'f7111111-1111-4111-8111-111111111101') as old_meal \gset
select pg_temp.meal(3, 'f7111111-1111-4111-8111-111111111102') as new_meal \gset

select is(pg_temp.listed(45), 1, 'T-NUT-WINDOW-01 with no window declared, the old meal is listed');

select pg_temp.free_plan('{"nutrition_history_months":{"enabled":true,"limit_value":1},
  "meal_photo_recognition":{"enabled":false,"limit_value":null}}');

select is(pg_temp.listed(45), 0, 'T-NUT-WINDOW-02 the free plan leaves the old meal out');
select is(pg_temp.listed(10), 1, 'T-NUT-WINDOW-03 and lists the recent one');

select is(
  pg_temp.refusal(format($$ select nutrition.read_meal('019ef700-0000-7000-8000-000000000001', %L) $$, :'old_meal')),
  'AF402:nutrition_history_months',
  'T-NUT-WINDOW-04 opening the old meal says Pro shows it again'
);

select isnt(nutrition.read_meal('019ef700-0000-7000-8000-000000000001', :'new_meal'), null,
  'T-NUT-WINDOW-05 the recent meal opens as always');

select is(
  (select (day->>'meal_count')::integer
   from jsonb_array_elements(nutrition.read_daily_summaries('019ef700-0000-7000-8000-000000000001',
     (clock_timestamp() at time zone 'America/Bogota')::date - 45,
     (clock_timestamp() at time zone 'America/Bogota')::date - 15, 'America/Bogota')->'data') as day
   where (day->>'local_date')::date = (clock_timestamp() at time zone 'America/Bogota')::date - 40),
  null,
  'T-NUT-WINDOW-06 a summary day outside the window has no count'
);

select is(
  (select (day->>'hidden')::boolean
   from jsonb_array_elements(nutrition.read_daily_summaries('019ef700-0000-7000-8000-000000000001',
     (clock_timestamp() at time zone 'America/Bogota')::date - 45,
     (clock_timestamp() at time zone 'America/Bogota')::date - 15, 'America/Bogota')->'data') as day
   where (day->>'local_date')::date = (clock_timestamp() at time zone 'America/Bogota')::date - 40),
  true,
  'T-NUT-WINDOW-07 and says it is kept behind the window'
);

select lives_ok(
  $$ select pg_temp.meal(0, 'f7111111-1111-4111-8111-111111111103') $$,
  'T-NUT-WINDOW-08 recording a meal stays free'
);

select is(
  (select count(*)::integer from nutrition.meals where person_id = '019ef700-0000-7000-8000-000000000001'),
  3,
  'T-NUT-WINDOW-09 nothing is deleted'
);

select is(
  pg_temp.refusal($$ select nutrition.require_recognition('019ef700-0000-7000-8000-000000000001') $$),
  'AF402:meal_photo_recognition',
  'T-NUT-WINDOW-10 recognising a meal by photo is Pro'
);

select pg_temp.free_plan('{}');

select is(
  pg_temp.refusal($$ select nutrition.require_recognition('019ef700-0000-7000-8000-000000000001') $$),
  'allowed',
  'T-NUT-WINDOW-11 and with it the photo goes to the model'
);

select * from finish();

rollback;
