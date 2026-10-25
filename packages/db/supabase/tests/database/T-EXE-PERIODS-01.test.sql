-- T-EXE-PERIODS-01 — comparing periods, with Pro (DT-018, HU-SP-061).
--
-- A heavy press ten days ago and a lighter one yesterday land in different weeks. The
-- comparison is Pro; with it, each week says what was trained and lifted, and each
-- movement says its best load against the week before.
--
-- Written before the migration and watched failing.

begin;

select plan(8);

insert into identity.people (id, given_name, family_name, username)
values ('019efa00-0000-7000-8000-000000000001', 'Quien', 'Entrena', 'quien_ventana');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019efa00-0000-7000-8000-0000000000a1', 'test_strength', 'Press', 'press', 'global', 'published');

insert into catalog.muscles (id, code, name, region, status, display_order)
values ('019efa00-0000-7000-8000-0000000000b1', 'test_chest', 'Pecho de prueba', 'upper', 'published', 0),
       ('019efa00-0000-7000-8000-0000000000b2', 'test_triceps', 'Tríceps de prueba', 'upper', 'published', 1);
insert into catalog.movement_muscles (movement_id, muscle_id, is_primary)
values ('019efa00-0000-7000-8000-0000000000a1', '019efa00-0000-7000-8000-0000000000b1', true),
       ('019efa00-0000-7000-8000-0000000000a1', '019efa00-0000-7000-8000-0000000000b2', false);

-- The free plan, published the only way it can be: proposed by one commercial manager and
-- published by another. Calling it again publishes the next version.
insert into identity.people (id, given_name, family_name, status)
values ('019efa00-0000-7000-8000-0000000000e1', 'Manager', 'Alpha', 'active'),
       ('019efa00-0000-7000-8000-0000000000e2', 'Manager', 'Beta', 'active'),
       ('019efa00-0000-7000-8000-0000000000e3', 'Commerce', 'Gamma', 'active'),
       ('019efa00-0000-7000-8000-0000000000e4', 'Commerce', 'Delta', 'active');
insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values ('019efa00-0000-7000-8000-0000000000f1', 'workos', 'https://issuer.test', 'alpha_periods', null),
       ('019efa00-0000-7000-8000-0000000000f2', 'workos', 'https://issuer.test', 'beta_periods', null),
       ('019efa00-0000-7000-8000-0000000000f3', 'workos', 'https://issuer.test', 'gamma_periods',
         '019efa00-0000-7000-8000-0000000000e3'),
       ('019efa00-0000-7000-8000-0000000000f4', 'workos', 'https://issuer.test', 'delta_periods',
         '019efa00-0000-7000-8000-0000000000e4');
select support.bootstrap_backoffice_administrators(
  '019efa00-0000-7000-8000-0000000000e1', 'alpha_periods',
  '019efa00-0000-7000-8000-0000000000e2', 'beta_periods',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-EXE-PERIODS-01');
insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at)
select session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019efa00-0000-7000-8000-0000000000d1'::uuid, '019efa00-0000-7000-8000-0000000000f1'::uuid, 'alpha_periods', 'a1'),
  ('019efa00-0000-7000-8000-0000000000d3'::uuid, '019efa00-0000-7000-8000-0000000000f3'::uuid, 'gamma_periods', 'a3'),
  ('019efa00-0000-7000-8000-0000000000d4'::uuid, '019efa00-0000-7000-8000-0000000000f4'::uuid, 'delta_periods', 'a4')
) as session_row(session_id, account_id, suffix, hash_byte);
select support.assign_platform_role(
  '019efa00-0000-7000-8000-0000000000e1', '019efa00-0000-7000-8000-0000000000d1',
  person_id, 'allfit_admin', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019efa00-0000-7000-8000-0000000000e3'::uuid), ('019efa00-0000-7000-8000-0000000000e4'::uuid))
  as grant_row(person_id);
select support.assign_platform_duty(
  '019efa00-0000-7000-8000-0000000000e1', '019efa00-0000-7000-8000-0000000000d1',
  person_id, 'manage_platform_commercial', clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-EXE-PERIODS', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019efa00-0000-7000-8000-0000000000e3'::uuid), ('019efa00-0000-7000-8000-0000000000e4'::uuid))
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
  perform set_config('app.actor_person_id', '019efa00-0000-7000-8000-0000000000e3', true);
  select id into plan_id from payments.platform_plans where plan_kind = 'free';
  if plan_id is null then
    select (result->>'id')::uuid into plan_id from payments.create_platform_plan(
      '019efa00-0000-7000-8000-0000000000e3', '019efa00-0000-7000-8000-0000000000d3',
      'free', 'Gratis', 'free', gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  end if;
  select (result->'proposal'->>'id')::uuid into version_id
  from payments.propose_platform_plan_version(
    '019efa00-0000-7000-8000-0000000000e3', '019efa00-0000-7000-8000-0000000000d3',
    plan_id, 0, null, null,
    (select jsonb_agg(jsonb_build_object(
       'feature_code', feature.code,
       'enabled', coalesce((p_limits->feature.code->>'enabled')::boolean, true),
       'limit_value', (p_limits->feature.code->>'limit_value')::integer))
     from payments.platform_features as feature),
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_person_id', '019efa00-0000-7000-8000-0000000000e4', true);
  perform payments.publish_platform_plan_version(
    '019efa00-0000-7000-8000-0000000000e4', '019efa00-0000-7000-8000-0000000000d4',
    plan_id, version_id, gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_kind', kind, true);
  perform set_config('app.actor_person_id', actor, true);
end
$fn$;

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019efa00-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select (planning.create_my_session_template(
  '019efa00-0000-7000-8000-000000000001', 'test_strength', 'Empuje',
  'fa111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as tpl \gset
select (:'tpl'::jsonb->>'id') as tpl_id, (:'tpl'::jsonb->'draft'->>'etag') as etag0 \gset

select (planning.replace_my_session_template_draft(
  '019efa00-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag0',
  '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[
     {"position":1,"movement_id":"019efa00-0000-7000-8000-0000000000a1","target":{"family":"strength","target_rest_seconds":60,"sets":[{"set_order":1,"kind":"normal","target_reps":8}]}}]}'::jsonb,
  'fa111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as draft \gset
select (:'draft'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019efa00-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag1',
  'fa111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as ver \gset
select (:'ver'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019efa00-0000-7000-8000-000000000001', 'Semana',
  'fa111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id, (:'prog'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019efa00-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag0',
  ('{"title":"Semana","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  'fa111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

select (planning.publish_my_program(
  '019efa00-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag1',
  'fa111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019efa00-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'fa111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment \gset

select id as planned_id from planning.planned_sessions
where assignment_id = :'assignment'::uuid limit 1 \gset

select (clock_timestamp() - interval '10 days')::text as old_start,
       (clock_timestamp() - interval '10 days' + interval '45 minutes')::text as old_end,
       (clock_timestamp() - interval '1 days')::text as new_start,
       (clock_timestamp() - interval '1 days' + interval '40 minutes')::text as new_end \gset

-- 901 · forty days ago: the heavy press.
select execution.start_planned_session_attempt(
  '019efa00-0000-7000-8000-000000000001', :'planned_id'::uuid, :'old_start'::timestamptz, 'America/Bogota', 'detailed', 'manual',
  'fa111111-1111-4111-8111-111111111901', '019efa00-0000-7000-8000-000000000901', decode(repeat('11', 32), 'hex'));
select execution.replace_execution_results(
  '019efa00-0000-7000-8000-000000000001', '019efa00-0000-7000-8000-000000000901', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019efa00-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":80,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'fa111111-1111-4111-8111-111111111902', extensions.uuid_generate_v7(), decode(repeat('12', 32), 'hex'));
select execution.finalize_execution(
  '019efa00-0000-7000-8000-000000000001', '019efa00-0000-7000-8000-000000000901', :'old_end'::timestamptz,
  'fa111111-1111-4111-8111-111111111903', extensions.uuid_generate_v7(), decode(repeat('13', 32), 'hex'));

-- 902 · three days ago: a lighter press, which is no record against the old one.
select execution.start_planned_session_attempt(
  '019efa00-0000-7000-8000-000000000001', :'planned_id'::uuid, :'new_start'::timestamptz, 'America/Bogota', 'detailed', 'manual',
  'fa111111-1111-4111-8111-111111111904', '019efa00-0000-7000-8000-000000000902', decode(repeat('14', 32), 'hex'));
select execution.replace_execution_results(
  '019efa00-0000-7000-8000-000000000001', '019efa00-0000-7000-8000-000000000902', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019efa00-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":75,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'fa111111-1111-4111-8111-111111111905', extensions.uuid_generate_v7(), decode(repeat('15', 32), 'hex'));
select execution.finalize_execution(
  '019efa00-0000-7000-8000-000000000001', '019efa00-0000-7000-8000-000000000902', :'new_end'::timestamptz,
  'fa111111-1111-4111-8111-111111111906', extensions.uuid_generate_v7(), decode(repeat('16', 32), 'hex'));

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

reset role;
select pg_temp.free_plan('{"period_analysis":{"enabled":false,"limit_value":null}}');
set local role allfit_owner;

select is(
  pg_temp.refusal($$ select execution.compare_my_periods('019efa00-0000-7000-8000-000000000001', 'America/Bogota', 'week', 4) $$),
  'AF402:period_analysis',
  'T-EXE-PERIODS-01 comparing periods is Pro'
);

reset role;
select pg_temp.free_plan('{}');
set local role allfit_owner;

select is(
  jsonb_array_length(execution.compare_my_periods('019efa00-0000-7000-8000-000000000001', 'America/Bogota', 'week', 4)->'periods'),
  4,
  'T-EXE-PERIODS-02 four weeks, oldest first'
);

select is(
  (select sum((period->>'sessions')::integer)::integer
   from jsonb_array_elements(execution.compare_my_periods('019efa00-0000-7000-8000-000000000001', 'America/Bogota', 'week', 4)->'periods') as period),
  2,
  'T-EXE-PERIODS-03 each session counts in its own week'
);

select is(
  (select (period->>'volume_kg')::numeric
   from jsonb_array_elements(execution.compare_my_periods('019efa00-0000-7000-8000-000000000001', 'America/Bogota', 'week', 4)->'periods') as period
   where (period->>'starts_on')::date = date_trunc('week', (clock_timestamp() - interval '1 day') at time zone 'America/Bogota')::date),
  600.00,
  'T-EXE-PERIODS-04 the volume of a week is load times reps'
);

select is(
  (select array[(movement->>'best_kg')::numeric, (movement->>'previous_best_kg')::numeric]
   from jsonb_array_elements(execution.compare_my_periods('019efa00-0000-7000-8000-000000000001', 'America/Bogota', 'week', 4)->'movements') as movement),
  array[75.00, 80.00]::numeric[],
  'T-EXE-PERIODS-05 each movement says its best against the period before'
);

-- A set belongs to one muscle, the movement's primary, as a routine's own count does.
select is(
  (select array_agg(distinct muscle->>'code') || array[sum((muscle->>'sets')::integer)::text]
   from jsonb_array_elements(execution.compare_my_periods('019efa00-0000-7000-8000-000000000001', 'America/Bogota', 'week', 4)->'periods') as period,
        jsonb_array_elements(period->'muscles') as muscle),
  array['test_chest', '2'],
  'T-EXE-PERIODS-07 each period says the work sets of each muscle, counted to the primary'
);

select is(
  (select array(select coalesce(best #>> '{}', 'none') from jsonb_array_elements(movement->'bests') as best)
   from jsonb_array_elements(execution.compare_my_periods('019efa00-0000-7000-8000-000000000001', 'America/Bogota', 'week', 4)->'movements') as movement),
  (select array_agg(case when starts_on = date_trunc('week', (clock_timestamp() - interval '1 day') at time zone 'America/Bogota')::date then '75.00'
                         when starts_on = date_trunc('week', (clock_timestamp() - interval '10 days') at time zone 'America/Bogota')::date then '80.00'
                         else 'none' end order by starts_on)
   from (select (date_trunc('week', clock_timestamp() at time zone 'America/Bogota')::date - (interval '1 week' * offs))::date as starts_on
         from generate_series(0, 3) as offs) as weeks),
  'T-EXE-PERIODS-08 each movement says its best in every period, null where it was not trained'
);

select throws_ok(
  $$ select execution.compare_my_periods('019efa00-0000-7000-8000-000000000001', 'America/Bogota', 'day', 4) $$,
  '22023', null,
  'T-EXE-PERIODS-09 periods are weeks or months'
);

select * from finish();

rollback;
