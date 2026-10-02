-- The week counts what was finished and stands: its work sets, and nothing annulled.
--
-- Hoy added up the sets of the last three sessions of all time and called it the week,
-- and the week's time and history still counted a session the person had annulled. Two
-- sessions this week, one of them annulled, with a warmup in the one that stands.
--
-- Written before touching `read_week_summary` and watched fail.
begin;

select plan(3);

insert into identity.people (id, given_name, family_name)
values ('019ef600-0000-7000-8000-000000000001', 'Quien', 'Cuenta');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef600-0000-7000-8000-0000000000a1', 'test_strength', 'Press', 'press', 'global', 'published');

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

-- Both inside this week: an hour ago and two hours ago.
select date_trunc('minute', clock_timestamp()) as base \gset

select execution.start_planned_session_attempt(
  '019ef600-0000-7000-8000-000000000001', :'planned_id'::uuid, (:'base'::timestamptz - interval '2 hours'), 'America/Bogota', 'detailed', 'manual',
  'f6111111-1111-4111-8111-111111111111', '019ef600-0000-7000-8000-000000000801', decode(repeat('11', 32), 'hex'));
select execution.replace_execution_results(
  '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000801', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef600-0000-7000-8000-0000000000a1","achieved_reps":5,"load_value":40,"load_unit_code":"kg","kind":"warmup"},
    {"family":"strength","set_order":2,"movement_id":"019ef600-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":60,"load_unit_code":"kg","kind":"normal"},
    {"family":"strength","set_order":3,"movement_id":"019ef600-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":60,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f6111111-1111-4111-8111-111111111112', extensions.uuid_generate_v7(), decode(repeat('12', 32), 'hex'));
select execution.finalize_execution(
  '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000801', (:'base'::timestamptz - interval '90 minutes'),
  'f6111111-1111-4111-8111-111111111113', extensions.uuid_generate_v7(), decode(repeat('13', 32), 'hex'));

select execution.start_planned_session_attempt(
  '019ef600-0000-7000-8000-000000000001', :'planned_id'::uuid, (:'base'::timestamptz - interval '1 hour'), 'America/Bogota', 'detailed', 'manual',
  'f6111111-1111-4111-8111-111111111114', '019ef600-0000-7000-8000-000000000802', decode(repeat('14', 32), 'hex'));
select execution.replace_execution_results(
  '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000802', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef600-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":60,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f6111111-1111-4111-8111-111111111115', extensions.uuid_generate_v7(), decode(repeat('15', 32), 'hex'));
select execution.finalize_execution(
  '019ef600-0000-7000-8000-000000000001', '019ef600-0000-7000-8000-000000000802', (:'base'::timestamptz - interval '30 minutes'),
  'f6111111-1111-4111-8111-111111111116', extensions.uuid_generate_v7(), decode(repeat('16', 32), 'hex'));
update execution.executed_sessions
set annulled_at = :'base'::timestamptz, annulment_reason = 'duplicada'
where id = '019ef600-0000-7000-8000-000000000802';

set local role postgres;
select set_config('app.actor_person_id', '019ef600-0000-7000-8000-000000000001', true);

select is(
  (select work_sets from execution.read_week_summary('019ef600-0000-7000-8000-000000000001', 'America/Bogota')),
  2,
  'T-EXE-WEEK-01 the week''s work sets: no warmup, nothing annulled');

select is(
  (select trained_seconds from execution.read_week_summary('019ef600-0000-7000-8000-000000000001', 'America/Bogota')),
  1800::numeric,
  'T-EXE-WEEK-02 an annulled session adds no time to the week');

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(history))
   from execution.read_week_summary('019ef600-0000-7000-8000-000000000001', 'America/Bogota')),
  array['019ef600-0000-7000-8000-000000000801'],
  'T-EXE-WEEK-03 nor shows in the recent history');

select * from finish();
rollback;
