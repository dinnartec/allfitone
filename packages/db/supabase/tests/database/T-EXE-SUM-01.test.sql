-- El cierre de un entreno se resume; récords, racha y número son derivados (ADR-036).
--
-- Seis sesiones sobre seis semanas: una abandonada en medio corta la racha y no cuenta
-- para nada, el calentamiento lleva más peso que nadie y no es récord, y el curl se hace
-- por primera vez. La última es la que se resume.
--
-- Escritas antes de la función y vistas fallar.
begin;

select plan(12);

insert into identity.people (id, given_name, family_name, username)
values ('019ef400-0000-7000-8000-000000000001', 'Quien', 'Comparte', 'quien_comparte'),
       ('019ef400-0000-7000-8000-000000000002', 'La', 'Vecina', null);

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef400-0000-7000-8000-0000000000a1', 'test_strength', 'Press', 'press', 'global', 'published'),
       ('019ef400-0000-7000-8000-0000000000b1', 'test_strength', 'Remo', 'remo', 'global', 'published'),
       ('019ef400-0000-7000-8000-0000000000c1', 'test_strength', 'Curl', 'curl', 'global', 'published');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef400-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select (planning.create_my_session_template(
  '019ef400-0000-7000-8000-000000000001', 'test_strength', 'Tirón',
  'f4111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as tpl \gset
select (:'tpl'::jsonb->>'id') as tpl_id, (:'tpl'::jsonb->'draft'->>'etag') as etag0 \gset

-- Press, remo y curl, sueltos.
select (planning.replace_my_session_template_draft(
  '019ef400-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag0',
  '{"title":"Tirón","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[
     {"position":1,"movement_id":"019ef400-0000-7000-8000-0000000000a1","target":{"family":"strength","target_rest_seconds":60,"sets":[{"set_order":1,"kind":"normal","target_reps":8}]}},
     {"position":2,"movement_id":"019ef400-0000-7000-8000-0000000000b1","target":{"family":"strength","target_rest_seconds":90,"sets":[{"set_order":1,"kind":"normal","target_reps":8}]}},
     {"position":3,"movement_id":"019ef400-0000-7000-8000-0000000000c1","target":{"family":"strength","target_rest_seconds":120,"sets":[{"set_order":1,"kind":"normal","target_reps":12}]}}]}'::jsonb,
  'f4111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as draft \gset
select (:'draft'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ef400-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag1',
  'f4111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as ver \gset
select (:'ver'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019ef400-0000-7000-8000-000000000001', 'Semana',
  'f4111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id, (:'prog'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ef400-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag0',
  ('{"title":"Semana","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  'f4111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

select (planning.publish_my_program(
  '019ef400-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag1',
  'f4111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019ef400-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'f4111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment \gset

select id as planned_id from planning.planned_sessions
where assignment_id = :'assignment'::uuid limit 1 \gset


-- The anchor every session hangs from, so durations and weeks are exact.
select date_trunc('minute', clock_timestamp()) as base \gset

select execution.start_planned_session_attempt(
  '019ef400-0000-7000-8000-000000000001', :'planned_id'::uuid, (:'base'::timestamptz - interval '35 days' - interval '50 minutes'), 'America/Bogota', 'detailed', 'manual',
  'f4111111-1111-4111-8111-111111111121', '019ef400-0000-7000-8000-000000000501', decode('1515151515151515151515151515151515151515151515151515151515151515', 'hex'));
select execution.replace_execution_results(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000501', 0, '[{"family":"strength","set_order":1,"movement_id":"019ef400-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":70,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f4111111-1111-4111-8111-111111111122', extensions.uuid_generate_v7(), decode('1616161616161616161616161616161616161616161616161616161616161616', 'hex'));
select execution.finalize_execution(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000501', (:'base'::timestamptz - interval '35 days'), 'f4111111-1111-4111-8111-111111111123', extensions.uuid_generate_v7(), decode('1717171717171717171717171717171717171717171717171717171717171717', 'hex'));

select execution.start_planned_session_attempt(
  '019ef400-0000-7000-8000-000000000001', :'planned_id'::uuid, (:'base'::timestamptz - interval '28 days' - interval '50 minutes'), 'America/Bogota', 'detailed', 'manual',
  'f4111111-1111-4111-8111-111111111124', '019ef400-0000-7000-8000-000000000502', decode('1818181818181818181818181818181818181818181818181818181818181818', 'hex'));
select execution.replace_execution_results(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000502', 0, '[{"family":"strength","set_order":1,"movement_id":"019ef400-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":200,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f4111111-1111-4111-8111-111111111125', extensions.uuid_generate_v7(), decode('1919191919191919191919191919191919191919191919191919191919191919', 'hex'));
select execution.abandon_execution(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000502', (:'base'::timestamptz - interval '28 days'), 'f4111111-1111-4111-8111-111111111126', extensions.uuid_generate_v7(), decode('1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a', 'hex'));

select execution.start_planned_session_attempt(
  '019ef400-0000-7000-8000-000000000001', :'planned_id'::uuid, (:'base'::timestamptz - interval '21 days' - interval '50 minutes'), 'America/Bogota', 'detailed', 'manual',
  'f4111111-1111-4111-8111-111111111127', '019ef400-0000-7000-8000-000000000503', decode('1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b', 'hex'));
select execution.replace_execution_results(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000503', 0, '[{"family":"strength","set_order":1,"movement_id":"019ef400-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":75,"load_unit_code":"kg","kind":"normal"},{"family":"strength","set_order":2,"movement_id":"019ef400-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":60,"load_unit_code":"kg","kind":"normal"},{"family":"strength","set_order":3,"movement_id":"019ef400-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":60,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f4111111-1111-4111-8111-111111111128', extensions.uuid_generate_v7(), decode('1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c', 'hex'));
select execution.finalize_execution(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000503', (:'base'::timestamptz - interval '21 days'), 'f4111111-1111-4111-8111-111111111129', extensions.uuid_generate_v7(), decode('1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d', 'hex'));

select execution.start_planned_session_attempt(
  '019ef400-0000-7000-8000-000000000001', :'planned_id'::uuid, (:'base'::timestamptz - interval '14 days' - interval '50 minutes'), 'America/Bogota', 'detailed', 'manual',
  'f4111111-1111-4111-8111-111111111130', '019ef400-0000-7000-8000-000000000504', decode('1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e', 'hex'));
select execution.replace_execution_results(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000504', 0, '[{"family":"strength","set_order":1,"movement_id":"019ef400-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":80,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f4111111-1111-4111-8111-111111111131', extensions.uuid_generate_v7(), decode('1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f', 'hex'));
select execution.finalize_execution(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000504', (:'base'::timestamptz - interval '14 days'), 'f4111111-1111-4111-8111-111111111132', extensions.uuid_generate_v7(), decode('2020202020202020202020202020202020202020202020202020202020202020', 'hex'));

select execution.start_planned_session_attempt(
  '019ef400-0000-7000-8000-000000000001', :'planned_id'::uuid, (:'base'::timestamptz - interval '7 days' - interval '50 minutes'), 'America/Bogota', 'detailed', 'manual',
  'f4111111-1111-4111-8111-111111111133', '019ef400-0000-7000-8000-000000000505', decode('2121212121212121212121212121212121212121212121212121212121212121', 'hex'));
select execution.replace_execution_results(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000505', 0, '[{"family":"strength","set_order":1,"movement_id":"019ef400-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":55,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f4111111-1111-4111-8111-111111111134', extensions.uuid_generate_v7(), decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'));
select execution.finalize_execution(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000505', (:'base'::timestamptz - interval '7 days'), 'f4111111-1111-4111-8111-111111111135', extensions.uuid_generate_v7(), decode('2323232323232323232323232323232323232323232323232323232323232323', 'hex'));

select execution.start_planned_session_attempt(
  '019ef400-0000-7000-8000-000000000001', :'planned_id'::uuid, (:'base'::timestamptz - interval '0 days' - interval '50 minutes'), 'America/Bogota', 'detailed', 'manual',
  'f4111111-1111-4111-8111-111111111136', '019ef400-0000-7000-8000-000000000506', decode('2424242424242424242424242424242424242424242424242424242424242424', 'hex'));
select execution.replace_execution_results(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 0, '[{"family":"strength","set_order":1,"movement_id":"019ef400-0000-7000-8000-0000000000a1","achieved_reps":1,"load_value":100,"load_unit_code":"kg","kind":"warmup"},{"family":"strength","set_order":2,"movement_id":"019ef400-0000-7000-8000-0000000000a1","achieved_reps":5,"load_value":85,"load_unit_code":"kg","kind":"normal"},{"family":"strength","set_order":3,"movement_id":"019ef400-0000-7000-8000-0000000000b1","achieved_reps":12,"load_value":60,"load_unit_code":"kg","kind":"normal"},{"family":"strength","set_order":4,"movement_id":"019ef400-0000-7000-8000-0000000000c1","achieved_reps":10,"load_value":20,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f4111111-1111-4111-8111-111111111137', extensions.uuid_generate_v7(), decode('2525252525252525252525252525252525252525252525252525252525252525', 'hex'));
select execution.finalize_execution(
  '019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', (:'base'::timestamptz - interval '0 days'), 'f4111111-1111-4111-8111-111111111138', extensions.uuid_generate_v7(), decode('2626262626262626262626262626262626262626262626262626262626262626', 'hex'));

-- A session still open, for the summary that must refuse it.
select execution.start_planned_session_attempt(
  '019ef400-0000-7000-8000-000000000001', :'planned_id'::uuid, :'base'::timestamptz, 'America/Bogota', 'detailed', 'manual',
  'f4111111-1111-4111-8111-111111111199', '019ef400-0000-7000-8000-000000000599',
  decode(repeat('99', 32), 'hex'));

select is(
  (select duration_seconds from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  3000::numeric,
  'T-EXE-SUM-01 the duration runs from start to end');

select is(
  (select array[work_sets, exercise_count] from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  array[3, 3],
  'T-EXE-SUM-02 a warmup is not a work set');

select is(
  (select round(total_volume_kg, 2) from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  1345.00,
  'T-EXE-SUM-03 the kilos lifted leave the warmup out');

select is(
  (select session_number from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  5,
  'T-EXE-SUM-04 the number counts every finished session, never an abandoned one');

select is(
  (select streak_weeks from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  4,
  'T-EXE-SUM-05 the streak stops at the week with nothing finished');

select is(
  (select array(select (value->>'movement') || ':' || (value->>'kind') from jsonb_array_elements(records)) from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  array['Press:heaviest', 'Remo:e1rm', 'Remo:best_set'],
  'T-EXE-SUM-06 each kind of record against the best before, equal is not a record, and a first time is none');

select is(
  (select jsonb_build_array(value->'value', value->'reps', value->'previous_value')
   from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota'), jsonb_array_elements(records)
   where value->>'kind' = 'heaviest'),
  '[85, 5, 80]'::jsonb,
  'T-EXE-SUM-07 the heaviest is the work set, not the warmup, against the best before it');

select is(
  (select (value->>'previous_on')::date
   from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota'), jsonb_array_elements(records)
   where value->>'kind' = 'heaviest'),
  ((:'base'::timestamptz - interval '14 days' - interval '50 minutes') at time zone 'America/Bogota')::date,
  'T-EXE-SUM-08 a record says when the one it beat was set');

select is(
  (select jsonb_path_query_array(exercises, '$[*].work_sets') from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  '[1, 1, 1]'::jsonb,
  'T-EXE-SUM-09 each exercise counts its own work sets');

select is(
  (select array[given_name, username::text, title] from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  array['Quien', 'quien_comparte', 'Tirón'],
  'T-EXE-SUM-10 says who trained and what');

select throws_ok(
  $$ select * from execution.read_execution_summary('019ef400-0000-7000-8000-000000000001', '019ef400-0000-7000-8000-000000000599', 'America/Bogota') $$,
  '55000', null,
  'T-EXE-SUM-11 a session still open has no summary yet');

select set_config('app.actor_person_id', '019ef400-0000-7000-8000-000000000002', true);

select is(
  (select count(*)::integer from execution.read_execution_summary('019ef400-0000-7000-8000-000000000002', '019ef400-0000-7000-8000-000000000506', 'America/Bogota')),
  0,
  'T-EXE-SUM-12 T-RESULT-8 the neighbour reads nothing of another person''s session');

select * from finish();
rollback;
