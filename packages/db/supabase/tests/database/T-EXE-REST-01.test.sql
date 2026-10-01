-- El descanso viaja con la sesión (ADR-035).
--
-- Lo que tiene que valer: la sesión nace con el descanso de cada paso; cambiarlo en la
-- sesión persiste y no toca la rutina; un ejercicio añadido nace sin descanso; y un
-- descanso fuera de rango se rechaza, como en su origen.
--
-- Escritas antes de la migración y vistas fallar: la lista no tenía descanso.
begin;

select plan(4);

insert into identity.people (id, given_name, family_name)
values ('019ef300-0000-7000-8000-000000000001', 'Quien', 'Descansa'),
       ('019ef300-0000-7000-8000-000000000002', 'La', 'Vecina');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef300-0000-7000-8000-0000000000a1', 'test_strength', 'Press', 'press', 'global', 'published'),
       ('019ef300-0000-7000-8000-0000000000b1', 'test_strength', 'Remo', 'remo', 'global', 'published'),
       ('019ef300-0000-7000-8000-0000000000c1', 'test_strength', 'Curl', 'curl', 'global', 'published');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef300-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select (planning.create_my_session_template(
  '019ef300-0000-7000-8000-000000000001', 'test_strength', 'Torso',
  'f3111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as tpl \gset
select (:'tpl'::jsonb->>'id') as tpl_id, (:'tpl'::jsonb->'draft'->>'etag') as etag0 \gset

-- Press y remo en superserie, cada uno con su descanso, y un curl suelto.
select (planning.replace_my_session_template_draft(
  '019ef300-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag0',
  '{"title":"Torso","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[
     {"position":1,"superset_group":1,"movement_id":"019ef300-0000-7000-8000-0000000000a1","target":{"family":"strength","target_rest_seconds":60,"sets":[{"set_order":1,"kind":"normal","target_reps":8}]}},
     {"position":2,"superset_group":1,"movement_id":"019ef300-0000-7000-8000-0000000000b1","target":{"family":"strength","target_rest_seconds":90,"sets":[{"set_order":1,"kind":"normal","target_reps":8}]}},
     {"position":3,"movement_id":"019ef300-0000-7000-8000-0000000000c1","target":{"family":"strength","target_rest_seconds":120,"sets":[{"set_order":1,"kind":"normal","target_reps":12}]}}]}'::jsonb,
  'f3111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as draft \gset
select (:'draft'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ef300-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag1',
  'f3111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as ver \gset
select (:'ver'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019ef300-0000-7000-8000-000000000001', 'Semana',
  'f3111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id, (:'prog'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ef300-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag0',
  ('{"title":"Semana","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  'f3111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

select (planning.publish_my_program(
  '019ef300-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag1',
  'f3111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019ef300-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'f3111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment \gset

select id as planned_id from planning.planned_sessions
where assignment_id = :'assignment'::uuid limit 1 \gset

select execution.start_planned_session_attempt(
  '019ef300-0000-7000-8000-000000000001', :'planned_id'::uuid,
  clock_timestamp() - interval '30 minutes', 'America/Bogota', 'detailed', 'manual',
  'f3111111-1111-4111-8111-111111111111', '019ef300-0000-7000-8000-000000000501',
  decode(repeat('11', 32), 'hex'));


select is(
  (select jsonb_path_query_array(exercises, '$[*].rest_seconds')
   from execution.read_execution('019ef300-0000-7000-8000-000000000001', '019ef300-0000-7000-8000-000000000501')),
  '[60, 90, 120]'::jsonb,
  'T-EXE-REST-01 la sesión nace con el descanso de cada paso de su rutina');

-- Hoy el press descansa menos y el curl se quita; entra un curl nuevo sin descanso.
select execution.replace_execution_results(
  '019ef300-0000-7000-8000-000000000001', '019ef300-0000-7000-8000-000000000501', 0,
  '[]'::jsonb,
  'f3111111-1111-4111-8111-111111111112', '019ef300-0000-7000-8000-000000000502',
  decode(repeat('12', 32), 'hex'),
  '[{"position":1,"movement_id":"019ef300-0000-7000-8000-0000000000a1","superset_group":1,"rest_seconds":45},
    {"position":2,"movement_id":"019ef300-0000-7000-8000-0000000000b1","superset_group":1,"rest_seconds":90},
    {"position":3,"movement_id":"019ef300-0000-7000-8000-0000000000c1"}]'::jsonb);

select is(
  (select jsonb_path_query_array(exercises, '$[*].rest_seconds')
   from execution.read_execution('019ef300-0000-7000-8000-000000000001', '019ef300-0000-7000-8000-000000000501')),
  '[45, 90, null]'::jsonb,
  'T-EXE-REST-02 cambiarlo en la sesión persiste, y un ejercicio añadido nace sin descanso');

select is(
  (select array_agg(target.target_rest_seconds order by step.position)
   from planning.planned_steps as step
   join planning.strength_targets as target on target.planned_step_id = step.id
   where step.template_version_id = :'version_id'::uuid),
  array[60, 90, 120],
  'T-EXE-REST-03 y no toca la rutina');

select throws_ok(
  $$ select execution.replace_execution_results(
       '019ef300-0000-7000-8000-000000000001', '019ef300-0000-7000-8000-000000000501', 1,
       '[]'::jsonb,
       'f3111111-1111-4111-8111-111111111113', '019ef300-0000-7000-8000-000000000503',
       decode(repeat('13', 32), 'hex'),
       '[{"position":1,"movement_id":"019ef300-0000-7000-8000-0000000000a1","rest_seconds":3601}]'::jsonb) $$,
  '23514', null,
  'T-EXE-REST-04 un descanso de más de una hora se rechaza');

select * from finish();
rollback;
