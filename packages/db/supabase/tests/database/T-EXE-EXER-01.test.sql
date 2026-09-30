-- Una sesión es una lista de ejercicios, y cada serie pertenece a uno (ADR-034).
--
-- Lo que tiene que valer: la sesión nace con los ejercicios y la superserie de su
-- rutina; mover, quitar y añadir sobreviven a leerla otra vez; una superserie que salta
-- un ejercicio se rechaza (IX-50); dos ejercicios del mismo movimiento no comparten
-- series; y la vecina no ve ni escribe nada de esto.
--
-- Escritas antes de la migración y vistas fallar: la tabla no existe, la sesión se lee
-- desde el plan y las series se emparejan por movimiento.
begin;

select plan(12);

insert into identity.people (id, given_name, family_name)
values ('019ef200-0000-7000-8000-000000000001', 'Quien', 'Encadena'),
       ('019ef200-0000-7000-8000-000000000002', 'La', 'Vecina');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef200-0000-7000-8000-0000000000a1', 'test_strength', 'Press', 'press', 'global', 'published'),
       ('019ef200-0000-7000-8000-0000000000b1', 'test_strength', 'Remo', 'remo', 'global', 'published'),
       ('019ef200-0000-7000-8000-0000000000c1', 'test_strength', 'Curl', 'curl', 'global', 'published');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef200-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select (planning.create_my_session_template(
  '019ef200-0000-7000-8000-000000000001', 'test_strength', 'Torso',
  'f2111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as tpl \gset
select (:'tpl'::jsonb->>'id') as tpl_id, (:'tpl'::jsonb->'draft'->>'etag') as etag0 \gset

-- Press y remo en superserie, y otra vez press, suelto, al final.
select (planning.replace_my_session_template_draft(
  '019ef200-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag0',
  '{"title":"Torso","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[
     {"position":1,"superset_group":1,"movement_id":"019ef200-0000-7000-8000-0000000000a1","target":{"family":"strength","sets":[{"set_order":1,"kind":"normal","target_reps":8}]}},
     {"position":2,"superset_group":1,"movement_id":"019ef200-0000-7000-8000-0000000000b1","target":{"family":"strength","sets":[{"set_order":1,"kind":"normal","target_reps":8}]}},
     {"position":3,"movement_id":"019ef200-0000-7000-8000-0000000000a1","target":{"family":"strength","sets":[{"set_order":1,"kind":"normal","target_reps":12}]}}]}'::jsonb,
  'f2111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as draft \gset
select (:'draft'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ef200-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag1',
  'f2111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as ver \gset
select (:'ver'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019ef200-0000-7000-8000-000000000001', 'Semana',
  'f2111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id, (:'prog'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ef200-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag0',
  ('{"title":"Semana","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  'f2111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

select (planning.publish_my_program(
  '019ef200-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag1',
  'f2111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019ef200-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'f2111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment \gset

select id as planned_id from planning.planned_sessions
where assignment_id = :'assignment'::uuid limit 1 \gset

select execution.start_planned_session_attempt(
  '019ef200-0000-7000-8000-000000000001', :'planned_id'::uuid,
  clock_timestamp() - interval '30 minutes', 'America/Bogota', 'detailed', 'manual',
  'f2111111-1111-4111-8111-111111111111', '019ef200-0000-7000-8000-000000000501',
  decode(repeat('11', 32), 'hex'));

select is(
  (select array(select value->>'movement' from jsonb_array_elements(exercises) order by (value->>'position')::integer)
   from execution.read_execution('019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501')),
  array['Press', 'Remo', 'Press'],
  'T-EXE-EXER-01 la sesión nace con los ejercicios de su rutina, en su orden');

select is(
  (select array(select coalesce(value->>'superset_group', '-') from jsonb_array_elements(exercises) order by (value->>'position')::integer)
   from execution.read_execution('019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501')),
  array['1', '1', '-'],
  'T-EXE-EXER-02 y con la superserie que la rutina traía');

-- Una serie en cada press: el primero en superserie y el suelto del final.
select execution.replace_execution_results(
  '019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501', 0,
  '[{"family":"strength","set_order":1,"exercise_position":1,"movement_id":"019ef200-0000-7000-8000-0000000000a1","achieved_reps":8},
    {"family":"strength","set_order":2,"exercise_position":3,"movement_id":"019ef200-0000-7000-8000-0000000000a1","achieved_reps":12}]'::jsonb,
  'f2111111-1111-4111-8111-111111111112', '019ef200-0000-7000-8000-000000000502',
  decode(repeat('12', 32), 'hex'),
  '[{"position":1,"movement_id":"019ef200-0000-7000-8000-0000000000a1","superset_group":1},
    {"position":2,"movement_id":"019ef200-0000-7000-8000-0000000000b1","superset_group":1},
    {"position":3,"movement_id":"019ef200-0000-7000-8000-0000000000a1"}]'::jsonb);

select is(
  (select array(select (value->>'exercise_position') || ':' || (value->>'achieved_reps') from jsonb_array_elements(results) order by (value->>'set_order')::integer)
   from execution.read_execution('019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501')),
  array['1:8', '3:12'],
  'T-EXE-EXER-03 dos ejercicios del mismo movimiento no comparten series');

-- Remo sale de la superserie y sube; el press suelto se quita; entra un curl.
select execution.replace_execution_results(
  '019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501', 1,
  '[{"family":"strength","set_order":1,"exercise_position":2,"movement_id":"019ef200-0000-7000-8000-0000000000a1","achieved_reps":8}]'::jsonb,
  'f2111111-1111-4111-8111-111111111113', '019ef200-0000-7000-8000-000000000503',
  decode(repeat('13', 32), 'hex'),
  '[{"position":1,"movement_id":"019ef200-0000-7000-8000-0000000000b1"},
    {"position":2,"movement_id":"019ef200-0000-7000-8000-0000000000a1"},
    {"position":3,"movement_id":"019ef200-0000-7000-8000-0000000000c1"}]'::jsonb);

select is(
  (select array(select value->>'movement' from jsonb_array_elements(exercises) order by (value->>'position')::integer)
   from execution.read_execution('019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501')),
  array['Remo', 'Press', 'Curl'],
  'T-EXE-EXER-04 mover, quitar y añadir sobreviven a leer la sesión otra vez');

select is(
  (select jsonb_path_query_array(exercises, '$[*].superset_group')
   from execution.read_execution('019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501')),
  '[null, null, null]'::jsonb,
  'T-EXE-EXER-05 y deshacer la superserie también');

select is(
  (select (exercises->2->>'planned_step_id') is null
   from execution.read_execution('019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501')),
  true,
  'T-EXE-EXER-06 el añadido no viene de ningún paso de la rutina');

select is(
  (select results->0->>'exercise_position'
   from execution.read_execution('019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501')),
  '2',
  'T-EXE-EXER-07 la serie sigue a su ejercicio cuando este cambia de lugar');

select throws_ok(
  $$ select execution.replace_execution_results(
       '019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501', 2,
       '[]'::jsonb,
       'f2111111-1111-4111-8111-111111111114', '019ef200-0000-7000-8000-000000000504',
       decode(repeat('14', 32), 'hex'),
       '[{"position":1,"movement_id":"019ef200-0000-7000-8000-0000000000b1","superset_group":1},
         {"position":2,"movement_id":"019ef200-0000-7000-8000-0000000000a1"},
         {"position":3,"movement_id":"019ef200-0000-7000-8000-0000000000c1","superset_group":1}]'::jsonb) $$,
  '23514', null,
  'T-EXE-EXER-08 una superserie que salta un ejercicio se rechaza (IX-50)');

select throws_ok(
  $$ select execution.replace_execution_results(
       '019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501', 2,
       '[{"family":"strength","set_order":1,"exercise_position":9,"achieved_reps":5}]'::jsonb,
       'f2111111-1111-4111-8111-111111111115', '019ef200-0000-7000-8000-000000000505',
       decode(repeat('15', 32), 'hex'),
       '[{"position":1,"movement_id":"019ef200-0000-7000-8000-0000000000b1"}]'::jsonb) $$,
  '23514', null,
  'T-EXE-EXER-09 una serie de un ejercicio que la sesión no tiene se rechaza');

-- Sin lista de ejercicios, el reemplazo de antes sigue valiendo y no toca la lista.
select execution.replace_execution_results(
  '019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501', 2,
  '[{"family":"strength","set_order":1,"movement_id":"019ef200-0000-7000-8000-0000000000c1","achieved_reps":10}]'::jsonb,
  'f2111111-1111-4111-8111-111111111116', '019ef200-0000-7000-8000-000000000506',
  decode(repeat('16', 32), 'hex'));

select is(
  (select array[jsonb_array_length(exercises)::text, results->0->>'exercise_position']
   from execution.read_execution('019ef200-0000-7000-8000-000000000001', '019ef200-0000-7000-8000-000000000501')),
  array['3', '3'],
  'T-EXE-EXER-10 sin lista, la serie cae en el primer ejercicio de su movimiento');

select set_config('app.actor_person_id', '019ef200-0000-7000-8000-000000000002', true);

select is(
  (select count(*)::integer from execution.session_exercises
   where executed_session_id = '019ef200-0000-7000-8000-000000000501'),
  0,
  'T-EXE-EXER-11 la vecina no ve los ejercicios de otra sesión');

select throws_ok(
  $$ insert into execution.session_exercises (executed_session_id, position)
     values ('019ef200-0000-7000-8000-000000000501', 9) $$,
  '42501', null,
  'T-EXE-EXER-12 ni puede escribir en ella');

select * from finish();
rollback;
