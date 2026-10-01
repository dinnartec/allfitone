-- El detalle de un entreno terminado, y lo que la persona hace con él (ADR-038).
--
-- Agosto: un press el 5 (con calentamiento), un press que bate al primero y un remo que
-- se estrena el 7, y un press flojo el 12. Después se corrige el del 7, se anticipa qué
-- cambiaría anular, se repite, se anula y se mira que lo anulado deja de contar.
--
-- Escritas antes de las funciones y vistas fallar.
begin;

select plan(30);


insert into identity.people (id, given_name, family_name, username)
values ('019ef500-0000-7000-8000-000000000001', 'Quien', 'Entrena', 'quien_entrena'),
       ('019ef500-0000-7000-8000-000000000002', 'La', 'Vecina', null);

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef500-0000-7000-8000-0000000000a1', 'test_strength', 'Press', 'press', 'global', 'published'),
       ('019ef500-0000-7000-8000-0000000000b1', 'test_strength', 'Remo', 'remo', 'global', 'published');

insert into catalog.movement_media (movement_id, kind, object_key, content_type, width, height, byte_size, checksum)
values ('019ef500-0000-7000-8000-0000000000a1', 'demo', 'movements/press/demo.webp', 'image/webp', 400, 400, 1000, 'sha256-press');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef500-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select (planning.create_my_session_template(
  '019ef500-0000-7000-8000-000000000001', 'test_strength', 'Tirón',
  'f5111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as tpl \gset
select (:'tpl'::jsonb->>'id') as tpl_id, (:'tpl'::jsonb->'draft'->>'etag') as etag0 \gset

select (planning.replace_my_session_template_draft(
  '019ef500-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag0',
  '{"title":"Tirón","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[
     {"position":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","target":{"family":"strength","target_rest_seconds":60,"sets":[{"set_order":1,"kind":"normal","target_reps":8}]}},
     {"position":2,"movement_id":"019ef500-0000-7000-8000-0000000000b1","target":{"family":"strength","target_rest_seconds":90,"sets":[{"set_order":1,"kind":"normal","target_reps":10}]}}]}'::jsonb,
  'f5111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as draft \gset
select (:'draft'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ef500-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag1',
  'f5111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as ver \gset
select (:'ver'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019ef500-0000-7000-8000-000000000001', 'Semana',
  'f5111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id, (:'prog'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ef500-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag0',
  ('{"title":"Semana","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  'f5111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

select (planning.publish_my_program(
  '019ef500-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag1',
  'f5111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019ef500-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'f5111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment \gset

select id as planned_id, scheduled_at as planned_at from planning.planned_sessions
where assignment_id = :'assignment'::uuid limit 1 \gset

-- 801 · 5 ago: el primer press, tras un calentamiento que no cuenta.
select execution.start_planned_session_attempt(
  '019ef500-0000-7000-8000-000000000001', :'planned_id'::uuid, '2026-08-05 18:00-05', 'America/Bogota', 'detailed', 'manual',
  'f5111111-1111-4111-8111-111111111901', '019ef500-0000-7000-8000-000000000801', decode(repeat('01', 32), 'hex'));
select execution.replace_execution_results(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000801', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":10,"load_value":40,"load_unit_code":"kg","kind":"warmup"},{"family":"strength","set_order":2,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":70,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f5111111-1111-4111-8111-111111111902', extensions.uuid_generate_v7(), decode(repeat('02', 32), 'hex'));
select execution.finalize_execution(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000801', '2026-08-05 18:45-05',
  'f5111111-1111-4111-8111-111111111903', extensions.uuid_generate_v7(), decode(repeat('03', 32), 'hex'));

-- 802 · 7 ago: el press bate al del 5 en todo; el remo se estrena, y estrenar no es récord.
select execution.start_planned_session_attempt(
  '019ef500-0000-7000-8000-000000000001', :'planned_id'::uuid, '2026-08-07 18:00-05', 'America/Bogota', 'detailed', 'manual',
  'f5111111-1111-4111-8111-111111111904', '019ef500-0000-7000-8000-000000000802', decode(repeat('04', 32), 'hex'));
select execution.replace_execution_results(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":80,"load_unit_code":"kg","kind":"normal"},{"family":"strength","set_order":2,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":75,"load_unit_code":"kg","kind":"normal"},{"family":"strength","set_order":3,"movement_id":"019ef500-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":30,"load_unit_code":"kg","kind":"normal"},{"family":"strength","set_order":4,"movement_id":"019ef500-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":30,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f5111111-1111-4111-8111-111111111905', extensions.uuid_generate_v7(), decode(repeat('05', 32), 'hex'));
select execution.finalize_execution(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', '2026-08-07 18:50-05',
  'f5111111-1111-4111-8111-111111111906', extensions.uuid_generate_v7(), decode(repeat('06', 32), 'hex'));

-- 803 · 12 ago: un press flojo, la semana siguiente.
select execution.start_planned_session_attempt(
  '019ef500-0000-7000-8000-000000000001', :'planned_id'::uuid, '2026-08-12 18:00-05', 'America/Bogota', 'detailed', 'manual',
  'f5111111-1111-4111-8111-111111111907', '019ef500-0000-7000-8000-000000000803', decode(repeat('07', 32), 'hex'));
select execution.replace_execution_results(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000803', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":5,"load_value":60,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f5111111-1111-4111-8111-111111111908', extensions.uuid_generate_v7(), decode(repeat('08', 32), 'hex'));
select execution.finalize_execution(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000803', '2026-08-12 18:30-05',
  'f5111111-1111-4111-8111-111111111909', extensions.uuid_generate_v7(), decode(repeat('09', 32), 'hex'));

-- 806 · 1 ago: un entreno libre, la semana anterior, sin sesión planificada detrás (no hay aún operación que lo cree).
insert into execution.executed_sessions (
  id, person_id, activity_type_id, result_contract_id, contract_version, is_autonomous,
  started_at, ended_at, timezone, execution_status, validation_status, revision_number,
  requested_level, achieved_level, capture_source)
select '019ef500-0000-7000-8000-000000000806', person_id, activity_type_id, result_contract_id,
       contract_version, true, '2026-08-01 10:00-05', '2026-08-01 10:35-05', timezone,
       'completed', validation_status, 0, requested_level, achieved_level, capture_source
from execution.executed_sessions where id = '019ef500-0000-7000-8000-000000000803';

set local role postgres;
select set_config('app.actor_person_id', '019ef500-0000-7000-8000-000000000001', true);

-- ———————————————————————————————— el detalle (OP-EXE-023)

select execution.read_finished_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 'America/Bogota') as detail \gset

select is(
  jsonb_build_object('title', :'detail'::jsonb->'title', 'duration', :'detail'::jsonb->'duration_seconds',
    'sets', :'detail'::jsonb->'work_sets', 'kg', :'detail'::jsonb->'total_volume_kg',
    'records', :'detail'::jsonb->'record_count', 'number', :'detail'::jsonb->'session_number',
    'repeatable', :'detail'::jsonb->'repeatable', 'revision', :'detail'::jsonb->'revision_number'),
  '{"title": "Tirón", "duration": 3000, "sets": 4, "kg": 1840, "records": 4, "number": 3,
    "repeatable": true, "revision": 2}'::jsonb,
  'T-EXE-FIN-01 the detail sums the session up as the summary does');

select is(
  ((:'detail'::jsonb->>'started_at')::timestamptz, (:'detail'::jsonb->>'ended_at')::timestamptz),
  ('2026-08-07 18:00-05'::timestamptz, '2026-08-07 18:50-05'::timestamptz),
  'T-EXE-FIN-02 it says when it began and ended');

select is(
  (select jsonb_agg(jsonb_build_object('movement', e->'movement', 'record', e->'record', 'best', e->'best_set',
     'ever', (select jsonb_agg(s->'best_ever' order by (s->>'set_order')::int) from jsonb_array_elements(e->'sets') as s))
     order by (e->>'position')::int)
   from jsonb_array_elements(:'detail'::jsonb->'exercises') as e),
  '[{"movement": "Press", "record": true, "best": {"load_kg": 80, "reps": 8}, "ever": [true, false]},
    {"movement": "Remo", "record": false, "best": {"load_kg": 30, "reps": 10}, "ever": [false, false]}]'::jsonb,
  'T-EXE-FIN-03 each exercise has its best set, and the set that beat everything before says so');

select is(
  (select jsonb_build_object('kind', s->'kind', 'kg', s->'load_value', 'reps', s->'achieved_reps')
   from jsonb_array_elements(execution.read_finished_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000801', 'America/Bogota')->'exercises') as e,
        jsonb_array_elements(e->'sets') as s
   where (s->>'set_order')::int = 1 and e->>'movement' = 'Press'),
  '{"kind": "warmup", "kg": 40, "reps": 10}'::jsonb,
  'T-EXE-FIN-04 every set is there, the warmup too, with its kind');

select is(
  jsonb_build_object('on', (:'detail'::jsonb->'previous'->>'started_at')::timestamptz,
    'kg', :'detail'::jsonb->'previous'->'total_volume_kg', 'change', :'detail'::jsonb->'previous'->'change_percent'),
  jsonb_build_object('on', '2026-08-05 18:00-05'::timestamptz, 'kg', 560, 'change', 229),
  'T-EXE-FIN-05 it compares with the last time this routine was done');

select is(
  execution.read_finished_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000801', 'America/Bogota')->'previous',
  'null'::jsonb,
  'T-EXE-FIN-06 the first time has nothing to compare with');

select is(
  execution.read_finished_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000806', 'America/Bogota')->'repeatable',
  'false'::jsonb,
  'T-EXE-FIN-07 a free session has no routine to repeat');

-- ———————————————————————————————— corregir (OP-EXE-007)

-- Finalizing was revision 2. Remo first now, the second press 78 and not 75, and it ended five minutes later.
select (execution.revise_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 2,
  '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":30,"load_unit_code":"kg","kind":"normal","exercise_position":1},{"family":"strength","set_order":2,"movement_id":"019ef500-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":30,"load_unit_code":"kg","kind":"normal","exercise_position":1},{"family":"strength","set_order":3,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":80,"load_unit_code":"kg","kind":"normal","exercise_position":2},{"family":"strength","set_order":4,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":78,"load_unit_code":"kg","kind":"normal","exercise_position":2}]'::jsonb,
  '[{"position":1,"movement_id":"019ef500-0000-7000-8000-0000000000b1"},{"position":2,"movement_id":"019ef500-0000-7000-8000-0000000000a1"}]'::jsonb,
  '2026-08-07 18:00-05', '2026-08-07 18:55-05',
  'f5111111-1111-4111-8111-111111111920', extensions.uuid_generate_v7(), decode(repeat('20', 32), 'hex'))).revision_number as revised \gset

select is(:'revised'::bigint, 3::bigint, 'T-EXE-FIN-08 a correction is a new revision');

select is(
  (select jsonb_build_object('kg', d->'total_volume_kg', 'duration', d->'duration_seconds',
     'first', d->'exercises'->0->'movement')
   from (select execution.read_finished_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 'America/Bogota') as d) as x),
  '{"kg": 1864, "duration": 3300, "first": "Remo"}'::jsonb,
  'T-EXE-FIN-09 the session reads as corrected, its order and its time too');

select is(
  (select jsonb_build_object('from', revision_from, 'to', revision_to, 'reason', reason,
     'before', (select s->'load_value' from jsonb_array_elements(before->'sets') as s where (s->>'set_order')::int = 2),
     'ended', (before->>'ended_at')::timestamptz)
   from execution.execution_revisions where executed_session_id = '019ef500-0000-7000-8000-000000000802'),
  jsonb_build_object('from', 2, 'to', 3, 'reason', 'Corrección de la persona', 'before', 75,
    'ended', '2026-08-07 18:50-05'::timestamptz),
  'T-EXE-FIN-10 the original is kept, never overwritten');

select throws_ok(
  $$ select execution.revise_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 1, '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":80,"load_unit_code":"kg","kind":"normal"}]'::jsonb, null,
       '2026-08-07 18:00-05', '2026-08-07 18:50-05', 'f5111111-1111-4111-8111-111111111921', extensions.uuid_generate_v7(), decode(repeat('21', 32), 'hex')) $$,
  '40001', null, 'T-EXE-FIN-11 a correction over a stale revision is refused');

select throws_ok(
  $$ select execution.revise_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 3, '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":80,"load_unit_code":"kg","kind":"normal"}]'::jsonb, null,
       '2026-08-07 18:00-05', '2026-08-07 17:00-05', 'f5111111-1111-4111-8111-111111111922', extensions.uuid_generate_v7(), decode(repeat('22', 32), 'hex')) $$,
  '23514', null, 'T-EXE-FIN-12 a session cannot end before it began');

select throws_ok(
  $$ select execution.revise_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 3, '[]'::jsonb, null,
       '2026-08-07 18:00-05', '2026-08-07 18:50-05', 'f5111111-1111-4111-8111-111111111923', extensions.uuid_generate_v7(), decode(repeat('23', 32), 'hex')) $$,
  '23514', null, 'T-EXE-FIN-13 a correction cannot leave a finished session empty');

select is(
  (select count(*)::integer from execution.session_records('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802') where movement_id = '019ef500-0000-7000-8000-0000000000a1'),
  4, 'T-EXE-FIN-14 records are read again from the corrected sets');

-- ———————————————————————————————— anticipar la anulación (OP-EXE-024)

select is(
  execution.read_annulment_preview('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000803', 'America/Bogota', '2026-08-13'),
  '{"records": 0, "streak_weeks": 3, "streak_weeks_after": 2}'::jsonb,
  'T-EXE-FIN-15 annulling the only session of this week shortens the streak by one');

select is(
  (execution.read_annulment_preview('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 'America/Bogota', '2026-08-13')->>'records')::integer,
  4, 'T-EXE-FIN-16 and says how many records go with it');

-- ———————————————————————————————— repetir

select (execution.repeat_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', '2026-08-14 18:00-05', 'America/Bogota',
  'f5111111-1111-4111-8111-111111111930', '019ef500-0000-7000-8000-000000000810', decode(repeat('30', 32), 'hex'))).id as repeated \gset

select is(
  (select array_agg(movement.name order by item.position)
   from execution.session_exercises as item join catalog.movements as movement on movement.id = item.movement_id
   where item.executed_session_id = :'repeated'::uuid),
  array['Remo', 'Press']::text[],
  'T-EXE-FIN-17 a repeat opens with the exercises the session ended with, in its order');

select is(
  (select jsonb_build_object('status', executed.execution_status, 'sets', execution.result_count(executed.id),
     'same_plan', attempt.planned_session_id = :'planned_id'::uuid)
   from execution.executed_sessions as executed
   join execution.planned_session_executions as attempt on attempt.executed_session_id = executed.id
   where executed.id = :'repeated'::uuid),
  '{"status": "in_progress", "sets": 0, "same_plan": true}'::jsonb,
  'T-EXE-FIN-18 in blank, as another attempt at the same planned session');

select is(
  (execution.repeat_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', '2026-08-14 18:00-05', 'America/Bogota',
     'f5111111-1111-4111-8111-111111111930', '019ef500-0000-7000-8000-000000000810', decode(repeat('30', 32), 'hex'))).id,
  :'repeated'::uuid, 'T-EXE-FIN-19 a retried repeat answers the same session');

select throws_ok(
  $$ select execution.repeat_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000801', '2026-08-14 18:05-05', 'America/Bogota',
       'f5111111-1111-4111-8111-111111111931', extensions.uuid_generate_v7(), decode(repeat('31', 32), 'hex')) $$,
  '55006', null, 'T-EXE-FIN-20 another session cannot open while one is still open');

select throws_ok(
  $$ select execution.repeat_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000806', '2026-08-14 18:05-05', 'America/Bogota',
       'f5111111-1111-4111-8111-111111111932', extensions.uuid_generate_v7(), decode(repeat('32', 32), 'hex')) $$,
  '23514', null, 'T-EXE-FIN-21 a free session has no routine to repeat');

-- ———————————————————————————————— anular (OP-EXE-009)

select execution.annul_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', null, 'f5111111-1111-4111-8111-111111111940', '019ef500-0000-7000-8000-000000000840', decode(repeat('40', 32), 'hex'));

select is(
  (select jsonb_build_object('status', validation_status, 'reason', annulment_reason, 'stamped', annulled_at is not null)
   from execution.executed_sessions where id = '019ef500-0000-7000-8000-000000000802'),
  '{"status": "annulled", "reason": "La persona lo eliminó", "stamped": true}'::jsonb,
  'T-EXE-FIN-22 annulling marks the session, with the default reason, and deletes nothing');

select is(
  (select count(*)::integer from execution.strength_sets where executed_session_id = '019ef500-0000-7000-8000-000000000802'),
  4, 'T-EXE-FIN-23 its sets are still there');

select ok(
  not exists (select 1 from jsonb_array_elements(
    execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null, null, 20)->'data') as row
    where row->>'executed_session_id' = '019ef500-0000-7000-8000-000000000802')
  and execution.read_finished_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', 'America/Bogota') is null,
  'T-EXE-FIN-24 and it leaves the history and its detail');

select lives_ok(
  $$ select execution.annul_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', null, 'f5111111-1111-4111-8111-111111111940', '019ef500-0000-7000-8000-000000000840', decode(repeat('40', 32), 'hex')) $$,
  'T-EXE-FIN-25 a retried annulment answers as the first did');

select throws_ok(
  $$ select execution.annul_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000802', null, 'f5111111-1111-4111-8111-111111111941', extensions.uuid_generate_v7(), decode(repeat('41', 32), 'hex')) $$,
  '23514', null, 'T-EXE-FIN-26 what is annulled cannot be annulled again');

-- With 802 and 803 annulled, the press weighed last time is the 5 August one.
select execution.annul_execution('019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000803', null, 'f5111111-1111-4111-8111-111111111942', extensions.uuid_generate_v7(), decode(repeat('42', 32), 'hex'));

select is(
  (select (select max((done->>'load_value')::numeric) from jsonb_array_elements(item->'previous') as done)
   from execution.read_execution('019ef500-0000-7000-8000-000000000001', :'repeated'::uuid) as read, jsonb_array_elements(read.exercises) as item
   where item->>'movement' = 'Press'),
  70::numeric, 'T-EXE-FIN-27 what was annulled is no longer the last time');

-- ———————————————————————————————— lo guardado no se toca, y la vecina no ve nada

set local role allfit_owner;
select throws_ok(
  $$ update execution.execution_revisions set reason = 'otra' $$,
  '42501', null, 'T-EXE-FIN-28 a revision cannot be rewritten');
set local role postgres;

select set_config('app.actor_person_id', '019ef500-0000-7000-8000-000000000002', true);

select is(
  execution.read_finished_execution('019ef500-0000-7000-8000-000000000002', '019ef500-0000-7000-8000-000000000801', 'America/Bogota'),
  null, 'T-EXE-FIN-29 T-RESULT-11 the neighbour reads nothing of another person''s');

select throws_ok(
  $$ select execution.annul_execution('019ef500-0000-7000-8000-000000000002', '019ef500-0000-7000-8000-000000000801', null,
       'f5111111-1111-4111-8111-111111111950', extensions.uuid_generate_v7(), decode(repeat('50', 32), 'hex')) $$,
  '42501', null, 'T-EXE-FIN-30 T-RESULT-11 nor annuls it');

select * from finish();
rollback;
