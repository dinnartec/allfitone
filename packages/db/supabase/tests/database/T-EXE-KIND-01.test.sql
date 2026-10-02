-- La serie ejecutada dice de qué tipo fue, y el calentamiento no es trabajo (ADR-033).
--
-- Lo que tiene que valer: el tipo registrado vuelve al leer la sesión, y la serie que
-- no lo dice se lee como normal; un tipo fuera del vocabulario se rechaza; la sesión
-- recibe las series que pidió la rutina, con su tipo; y un calentamiento con carga no
-- suma al tonelaje ni a las series de «La última vez» ni de la semana.
--
-- Escritas antes de la migración y vistas fallar: `strength_sets` todavía no tiene
-- `kind`, y los resúmenes cuentan el calentamiento como una serie más.
begin;

select plan(11);

insert into identity.people (id, given_name, family_name)
values ('019ee000-0000-7000-8000-000000000001', 'Quien', 'Calienta'),
       ('019ee000-0000-7000-8000-000000000002', 'La', 'Vecina');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ee000-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select (planning.create_my_session_template(
  '019ee000-0000-7000-8000-000000000001', 'test_strength', 'Pierna',
  'e1111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as tpl \gset
select (:'tpl'::jsonb->>'id') as tpl_id, (:'tpl'::jsonb->'draft'->>'etag') as etag0 \gset

select (planning.replace_my_session_template_draft(
  '019ee000-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag0',
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[
     {"position":1,"target":{"family":"strength","sets":[
       {"set_order":1,"kind":"warmup","target_reps":12},
       {"set_order":2,"kind":"normal","target_reps":8},
       {"set_order":3,"kind":"to_failure"}]}}]}'::jsonb,
  'e1111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as draft \gset
select (:'draft'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ee000-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag1',
  'e1111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as ver \gset
select (:'ver'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019ee000-0000-7000-8000-000000000001', 'Semana',
  'e1111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id, (:'prog'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ee000-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag0',
  ('{"title":"Semana","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  'e1111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

select (planning.publish_my_program(
  '019ee000-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag1',
  'e1111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019ee000-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'e1111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment \gset

select id as planned_id from planning.planned_sessions
where assignment_id = :'assignment'::uuid limit 1 \gset

select execution.start_planned_session_attempt(
  '019ee000-0000-7000-8000-000000000001', :'planned_id'::uuid,
  clock_timestamp() - interval '40 minutes', 'America/Bogota', 'detailed', 'manual',
  'e1111111-1111-4111-8111-111111111111', '019ee000-0000-7000-8000-000000000501',
  decode(repeat('11', 32), 'hex'));

-- Un calentamiento de 12 × 20 kg, una normal de 8 × 100 y una sin tipo de 6 × 100 con RPE 9.
select execution.replace_execution_results(
  '019ee000-0000-7000-8000-000000000001', '019ee000-0000-7000-8000-000000000501', 0,
  '[{"family":"strength","set_order":1,"kind":"warmup","achieved_reps":12,"load_value":20,"load_unit_code":"kg"},
    {"family":"strength","set_order":2,"kind":"normal","achieved_reps":8,"load_value":100,"load_unit_code":"kg"},
    {"family":"strength","set_order":3,"achieved_reps":6,"load_value":100,"load_unit_code":"kg","rpe":9}]'::jsonb,
  'e1111111-1111-4111-8111-111111111112', '019ee000-0000-7000-8000-000000000502',
  decode(repeat('12', 32), 'hex'));

select is(
  (select results->0->>'kind'
   from execution.read_execution('019ee000-0000-7000-8000-000000000001', '019ee000-0000-7000-8000-000000000501')),
  'warmup',
  'T-EXE-KIND-01 el tipo registrado vuelve al leer la sesión');

select is(
  (select results->2->>'kind'
   from execution.read_execution('019ee000-0000-7000-8000-000000000001', '019ee000-0000-7000-8000-000000000501')),
  'normal',
  'T-EXE-KIND-02 la serie que no dice su tipo se lee como normal');

select is(
  (select (results->2->>'rpe')::numeric
   from execution.read_execution('019ee000-0000-7000-8000-000000000001', '019ee000-0000-7000-8000-000000000501')),
  9::numeric,
  'T-EXE-KIND-03 el esfuerzo se registra con la serie');

select is(
  (select results->1->>'rpe'
   from execution.read_execution('019ee000-0000-7000-8000-000000000001', '019ee000-0000-7000-8000-000000000501')),
  null,
  'T-EXE-KIND-04 y la que no lo declara lo deja nulo, no cero');

select is(
  (select array(select value->>'kind' from jsonb_array_elements(planned->0->'sets') order by (value->>'set_order')::integer)
   from execution.read_execution('019ee000-0000-7000-8000-000000000001', '019ee000-0000-7000-8000-000000000501')),
  array['warmup', 'normal', 'to_failure'],
  'T-EXE-KIND-05 la sesión recibe las series que pidió la rutina, con su tipo');

select throws_ok(
  $$ select execution.replace_execution_results(
       '019ee000-0000-7000-8000-000000000001', '019ee000-0000-7000-8000-000000000501', 1,
       '[{"family":"strength","set_order":1,"kind":"rest_pause","achieved_reps":5}]'::jsonb,
       'e1111111-1111-4111-8111-111111111113', '019ee000-0000-7000-8000-000000000503',
       decode(repeat('13', 32), 'hex')) $$,
  '22P02', null,
  'T-EXE-KIND-06 un tipo fuera del vocabulario se rechaza');

select execution.finalize_execution(
  '019ee000-0000-7000-8000-000000000001', '019ee000-0000-7000-8000-000000000501',
  clock_timestamp(), 'e1111111-1111-4111-8111-111111111114',
  '019ee000-0000-7000-8000-000000000504', decode(repeat('14', 32), 'hex'));

-- 8 × 100 + 6 × 100: el calentamiento de 240 kg no cuenta.
select is(
  (select tonnage_kg from execution.read_week_summary('019ee000-0000-7000-8000-000000000001', 'America/Bogota')),
  1400::numeric,
  'T-EXE-KIND-07 el calentamiento no suma a los kilos de la semana');

select is(
  (select (history->0->>'sets_recorded')::integer
   from execution.read_week_summary('019ee000-0000-7000-8000-000000000001', 'America/Bogota')),
  2,
  'T-EXE-KIND-08 ni a las series que la semana cuenta');

select is(
  (select (entry->'last_time'->>'tonnage_kg')::numeric
   from planning.read_week_plan('019ee000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  1400::numeric,
  'T-EXE-KIND-09 ni al tonelaje de la última vez');

select is(
  (select (entry->'last_time'->>'sets')::integer
   from planning.read_week_plan('019ee000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  2,
  'T-EXE-KIND-10 ni a sus series');

select set_config('app.actor_person_id', '019ee000-0000-7000-8000-000000000002', true);

select is(
  (select count(*)::integer
   from execution.read_execution('019ee000-0000-7000-8000-000000000002', '019ee000-0000-7000-8000-000000000501')),
  0,
  'T-EXE-KIND-11 la vecina no lee la sesión de otra persona, con o sin tipos');

select * from finish();
rollback;
