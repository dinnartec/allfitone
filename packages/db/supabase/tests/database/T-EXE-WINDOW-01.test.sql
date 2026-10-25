-- T-EXE-WINDOW-01 — the free plan sees the last month of its training (DT-018, HU-SP-086).
--
-- Two press sessions: a heavy one forty days ago and a lighter one three days ago. Before
-- any plan declares the window both are seen. On a free plan with one month, the list,
-- the month and the detail leave the old one out, opening it says Pro shows it again,
-- nothing is deleted, and the recent session is still compared against the old one.
--
-- Written before the migration and watched failing.

begin;

select plan(12);

insert into identity.people (id, given_name, family_name, username)
values ('019ef600-0000-7000-8000-000000000001', 'Quien', 'Entrena', 'quien_ventana');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef600-0000-7000-8000-0000000000a1', 'test_strength', 'Press', 'press', 'global', 'published');

-- The free plan, published the only way it can be: proposed by one commercial manager and
-- published by another. Calling it again publishes the next version.
insert into identity.people (id, given_name, family_name, status)
values ('019ef600-0000-7000-8000-0000000000e1', 'Manager', 'Alpha', 'active'),
       ('019ef600-0000-7000-8000-0000000000e2', 'Manager', 'Beta', 'active'),
       ('019ef600-0000-7000-8000-0000000000e3', 'Commerce', 'Gamma', 'active'),
       ('019ef600-0000-7000-8000-0000000000e4', 'Commerce', 'Delta', 'active');
insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values ('019ef600-0000-7000-8000-0000000000f1', 'workos', 'https://issuer.test', 'alpha_window', null),
       ('019ef600-0000-7000-8000-0000000000f2', 'workos', 'https://issuer.test', 'beta_window', null),
       ('019ef600-0000-7000-8000-0000000000f3', 'workos', 'https://issuer.test', 'gamma_window',
         '019ef600-0000-7000-8000-0000000000e3'),
       ('019ef600-0000-7000-8000-0000000000f4', 'workos', 'https://issuer.test', 'delta_window',
         '019ef600-0000-7000-8000-0000000000e4');
select support.bootstrap_backoffice_administrators(
  '019ef600-0000-7000-8000-0000000000e1', 'alpha_window',
  '019ef600-0000-7000-8000-0000000000e2', 'beta_window',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-EXE-WINDOW-01');
insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at)
select session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019ef600-0000-7000-8000-0000000000d1'::uuid, '019ef600-0000-7000-8000-0000000000f1'::uuid, 'alpha_window', 'a1'),
  ('019ef600-0000-7000-8000-0000000000d3'::uuid, '019ef600-0000-7000-8000-0000000000f3'::uuid, 'gamma_window', 'a3'),
  ('019ef600-0000-7000-8000-0000000000d4'::uuid, '019ef600-0000-7000-8000-0000000000f4'::uuid, 'delta_window', 'a4')
) as session_row(session_id, account_id, suffix, hash_byte);
select support.assign_platform_role(
  '019ef600-0000-7000-8000-0000000000e1', '019ef600-0000-7000-8000-0000000000d1',
  person_id, 'allfit_admin', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019ef600-0000-7000-8000-0000000000e3'::uuid), ('019ef600-0000-7000-8000-0000000000e4'::uuid))
  as grant_row(person_id);
select support.assign_platform_duty(
  '019ef600-0000-7000-8000-0000000000e1', '019ef600-0000-7000-8000-0000000000d1',
  person_id, 'manage_platform_commercial', clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-EXE-WINDOW', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019ef600-0000-7000-8000-0000000000e3'::uuid), ('019ef600-0000-7000-8000-0000000000e4'::uuid))
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
  perform set_config('app.actor_person_id', '019ef600-0000-7000-8000-0000000000e3', true);
  select id into plan_id from payments.platform_plans where plan_kind = 'free';
  if plan_id is null then
    select (result->>'id')::uuid into plan_id from payments.create_platform_plan(
      '019ef600-0000-7000-8000-0000000000e3', '019ef600-0000-7000-8000-0000000000d3',
      'free', 'Gratis', 'free', gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  end if;
  select (result->'proposal'->>'id')::uuid into version_id
  from payments.propose_platform_plan_version(
    '019ef600-0000-7000-8000-0000000000e3', '019ef600-0000-7000-8000-0000000000d3',
    plan_id, 0, null, null,
    (select jsonb_agg(jsonb_build_object(
       'feature_code', feature.code,
       'enabled', coalesce((p_limits->feature.code->>'enabled')::boolean, true),
       'limit_value', (p_limits->feature.code->>'limit_value')::integer))
     from payments.platform_features as feature),
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_person_id', '019ef600-0000-7000-8000-0000000000e4', true);
  perform payments.publish_platform_plan_version(
    '019ef600-0000-7000-8000-0000000000e4', '019ef600-0000-7000-8000-0000000000d4',
    plan_id, version_id, gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_kind', kind, true);
  perform set_config('app.actor_person_id', actor, true);
end
$fn$;

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef600-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select (planning.create_my_session_template(
  '019ef600-0000-7000-8000-000000000001', 'test_strength', 'Empuje',
  'f6111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as tpl \gset
select (:'tpl'::jsonb->>'id') as tpl_id, (:'tpl'::jsonb->'draft'->>'etag') as etag0 \gset

select (planning.replace_my_session_template_draft(
  '019ef600-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag0',
  '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[
     {"position":1,"movement_id":"019ef600-0000-7000-8000-0000000000a1","target":{"family":"strength","target_rest_seconds":60,"sets":[{"set_order":1,"kind":"normal","target_reps":8}]}}]}'::jsonb,
  'f6111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as draft \gset
select (:'draft'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ef600-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag1',
  'f6111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as ver \gset
select (:'ver'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019ef600-0000-7000-8000-000000000001', 'Semana',
  'f6111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id, (:'prog'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ef600-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag0',
  ('{"title":"Semana","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  'f6111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

select (planning.publish_my_program(
  '019ef600-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag1',
  'f6111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019ef600-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'f6111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment \gset

select id as planned_id from planning.planned_sessions
where assignment_id = :'assignment'::uuid limit 1 \gset

select (clock_timestamp() - interval '40 days')::text as old_start,
       (clock_timestamp() - interval '40 days' + interval '45 minutes')::text as old_end,
       (clock_timestamp() - interval '3 days')::text as new_start,
       (clock_timestamp() - interval '3 days' + interval '40 minutes')::text as new_end \gset

-- 901 · forty days ago: the heavy press.
select execution.start_planned_session_attempt(
  '019ef600-0000-7000-8000-000000000001', :'planned_id'::uuid, :'old_start'::timestamptz, 'America/Bogota', 'detailed', 'manual',
  'f6111111-1111-4111-8111-111111111901', '019ef600-0000-7000-8000-000000000901', decode(repeat('11', 32), 'hex'));
select execution.replace_execution_results(
  '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000901', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef600-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":80,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f6111111-1111-4111-8111-111111111902', extensions.uuid_generate_v7(), decode(repeat('12', 32), 'hex'));
select execution.finalize_execution(
  '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000901', :'old_end'::timestamptz,
  'f6111111-1111-4111-8111-111111111903', extensions.uuid_generate_v7(), decode(repeat('13', 32), 'hex'));

-- 902 · three days ago: a lighter press, which is no record against the old one.
select execution.start_planned_session_attempt(
  '019ef600-0000-7000-8000-000000000001', :'planned_id'::uuid, :'new_start'::timestamptz, 'America/Bogota', 'detailed', 'manual',
  'f6111111-1111-4111-8111-111111111904', '019ef600-0000-7000-8000-000000000902', decode(repeat('14', 32), 'hex'));
select execution.replace_execution_results(
  '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000902', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef600-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":75,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f6111111-1111-4111-8111-111111111905', extensions.uuid_generate_v7(), decode(repeat('15', 32), 'hex'));
select execution.finalize_execution(
  '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000902', :'new_end'::timestamptz,
  'f6111111-1111-4111-8111-111111111906', extensions.uuid_generate_v7(), decode(repeat('16', 32), 'hex'));

create function pg_temp.listed()
returns integer
language sql
as $fn$
  select jsonb_array_length(execution.list_my_executions(
    '019ef600-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null, null, 50)->'data')
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

-- ---------------------------------------------------------------------------
-- Before a plan declares the window
-- ---------------------------------------------------------------------------

select is(pg_temp.listed(), 2, 'T-EXE-WINDOW-01 with no window declared, all of it is seen');

-- ---------------------------------------------------------------------------
-- On the free plan
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.free_plan('{"training_history_months":{"enabled":true,"limit_value":1}}');
set local role allfit_owner;

select is(pg_temp.listed(), 1, 'T-EXE-WINDOW-02 the free plan lists the last month');

select is(
  (execution.list_my_executions('019ef600-0000-7000-8000-000000000001', 'America/Bogota',
     null, null, null, null, null, null, 50)->'window'->>'has_hidden')::boolean,
  true,
  'T-EXE-WINDOW-03 and says there is more kept behind it'
);

select is(
  (execution.list_my_executions('019ef600-0000-7000-8000-000000000001', 'America/Bogota',
     null, null, null, null, null, null, 50)->'window'->>'visible_from')::date,
  ((date_trunc('day', clock_timestamp() at time zone 'America/Bogota') - interval '1 month'))::date,
  'T-EXE-WINDOW-04 from the day a month ago'
);

select is(
  (execution.read_history_month('019ef600-0000-7000-8000-000000000001', 'America/Bogota',
     (clock_timestamp() - interval '40 days')::date)->>'sessions')::integer,
  0,
  'T-EXE-WINDOW-05 the month leaves the old session out'
);

select is(
  pg_temp.refusal($$ select execution.read_finished_execution(
    '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000901', 'America/Bogota') $$),
  'AF402:training_history_months',
  'T-EXE-WINDOW-06 opening the old session says Pro shows it again'
);

select is(
  pg_temp.refusal($$ select * from execution.read_execution_summary(
    '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000901', 'America/Bogota') $$),
  'AF402:training_history_months',
  'T-EXE-WINDOW-07 and so does its summary'
);

select isnt(
  execution.read_finished_execution('019ef600-0000-7000-8000-000000000001',
    '019ef600-0000-7000-8000-000000000902', 'America/Bogota'),
  null,
  'T-EXE-WINDOW-08 the recent one opens as always'
);

select is(
  (select (entry->>'record_count')::integer
   from jsonb_array_elements(execution.list_my_executions('019ef600-0000-7000-8000-000000000001',
     'America/Bogota', null, null, null, null, null, null, 50)->'data') as entry),
  0,
  'T-EXE-WINDOW-09 the lighter press is no record: records still compare against everything'
);

select is(
  (select count(*)::integer from execution.executed_sessions
   where person_id = '019ef600-0000-7000-8000-000000000001'),
  2,
  'T-EXE-WINDOW-10 nothing is deleted'
);

-- ---------------------------------------------------------------------------
-- A plan with no window
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.free_plan('{"training_history_months":{"enabled":true,"limit_value":null},
  "own_routines":{"enabled":true,"limit_value":3}}');
set local role allfit_owner;

select is(pg_temp.listed(), 2, 'T-EXE-WINDOW-11 without a limit everything comes back');

select is(
  (execution.list_my_executions('019ef600-0000-7000-8000-000000000001', 'America/Bogota',
     null, null, null, null, null, null, 50)->'window'->>'has_hidden')::boolean,
  false,
  'T-EXE-WINDOW-12 and nothing is hidden'
);

select * from finish();

rollback;
