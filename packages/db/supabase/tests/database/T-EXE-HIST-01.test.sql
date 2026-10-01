-- El historial muestra lo terminado, y cada fila se resume al leer (ADR-037).
--
-- Agosto: un primer press, un segundo press que bate al primero en los cuatro récords y
-- estrena el remo, uno abandonado y uno anulado. Septiembre: un remo y un entreno libre,
-- sin sesión planificada detrás. La vecina no tiene nada.
--
-- Escritas antes de las funciones y vistas fallar.
begin;

select plan(24);

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

-- 701 · 5 ago: el primer press.
select execution.start_planned_session_attempt(
  '019ef500-0000-7000-8000-000000000001', :'planned_id'::uuid, '2026-08-05 18:00-05', 'America/Bogota', 'detailed', 'manual',
  'f5111111-1111-4111-8111-111111111111', '019ef500-0000-7000-8000-000000000701', decode(repeat('11', 32), 'hex'));
select execution.replace_execution_results(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000701', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":70,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f5111111-1111-4111-8111-111111111112', extensions.uuid_generate_v7(), decode(repeat('12', 32), 'hex'));
select execution.finalize_execution(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000701', '2026-08-05 18:45-05',
  'f5111111-1111-4111-8111-111111111113', extensions.uuid_generate_v7(), decode(repeat('13', 32), 'hex'));

-- 702 · 7 ago: más press, que bate al primero en todo, y el remo por primera vez.
select execution.start_planned_session_attempt(
  '019ef500-0000-7000-8000-000000000001', :'planned_id'::uuid, '2026-08-07 18:00-05', 'America/Bogota', 'detailed', 'manual',
  'f5111111-1111-4111-8111-111111111114', '019ef500-0000-7000-8000-000000000702', decode(repeat('14', 32), 'hex'));
select execution.replace_execution_results(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000702', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":80,"load_unit_code":"kg","kind":"normal"},
    {"family":"strength","set_order":2,"movement_id":"019ef500-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":30,"load_unit_code":"kg","kind":"normal"},
    {"family":"strength","set_order":3,"movement_id":"019ef500-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":30,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f5111111-1111-4111-8111-111111111115', extensions.uuid_generate_v7(), decode(repeat('15', 32), 'hex'));
select execution.finalize_execution(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000702', '2026-08-07 18:50-05',
  'f5111111-1111-4111-8111-111111111116', extensions.uuid_generate_v7(), decode(repeat('16', 32), 'hex'));

-- 703 · 12 ago: abandonado.
select execution.start_planned_session_attempt(
  '019ef500-0000-7000-8000-000000000001', :'planned_id'::uuid, '2026-08-12 18:00-05', 'America/Bogota', 'detailed', 'manual',
  'f5111111-1111-4111-8111-111111111117', '019ef500-0000-7000-8000-000000000703', decode(repeat('17', 32), 'hex'));
select execution.abandon_execution(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000703', '2026-08-12 18:10-05',
  'f5111111-1111-4111-8111-111111111118', extensions.uuid_generate_v7(), decode(repeat('18', 32), 'hex'));

-- 704 · 14 ago: terminado y después anulado.
select execution.start_planned_session_attempt(
  '019ef500-0000-7000-8000-000000000001', :'planned_id'::uuid, '2026-08-14 18:00-05', 'America/Bogota', 'detailed', 'manual',
  'f5111111-1111-4111-8111-111111111119', '019ef500-0000-7000-8000-000000000704', decode(repeat('19', 32), 'hex'));
select execution.replace_execution_results(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000704', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":200,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f5111111-1111-4111-8111-111111111124', extensions.uuid_generate_v7(), decode(repeat('24', 32), 'hex'));
select execution.finalize_execution(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000704', '2026-08-14 18:30-05',
  'f5111111-1111-4111-8111-111111111120', extensions.uuid_generate_v7(), decode(repeat('20', 32), 'hex'));
update execution.executed_sessions
set annulled_at = '2026-08-14 19:00-05', annulment_reason = 'la app duplicó series'
where id = '019ef500-0000-7000-8000-000000000704';

-- 705 · 2 sep: un remo que no bate nada.
select execution.start_planned_session_attempt(
  '019ef500-0000-7000-8000-000000000001', :'planned_id'::uuid, '2026-09-02 18:00-05', 'America/Bogota', 'detailed', 'manual',
  'f5111111-1111-4111-8111-111111111121', '019ef500-0000-7000-8000-000000000705', decode(repeat('21', 32), 'hex'));
select execution.replace_execution_results(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000705', 0,
  '[{"family":"strength","set_order":1,"movement_id":"019ef500-0000-7000-8000-0000000000b1","achieved_reps":10,"load_value":25,"load_unit_code":"kg","kind":"normal"}]'::jsonb,
  'f5111111-1111-4111-8111-111111111122', extensions.uuid_generate_v7(), decode(repeat('22', 32), 'hex'));
select execution.finalize_execution(
  '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000705', '2026-09-02 18:40-05',
  'f5111111-1111-4111-8111-111111111123', extensions.uuid_generate_v7(), decode(repeat('23', 32), 'hex'));

-- 706 · 5 sep: un entreno libre. No hay todavía una operación que lo cree, así que se
-- escribe como lo dejaría: una ejecución terminada sin sesión planificada detrás.
insert into execution.executed_sessions (
  id, person_id, activity_type_id, result_contract_id, contract_version, is_autonomous,
  started_at, ended_at, timezone, execution_status, validation_status, revision_number,
  requested_level, achieved_level, capture_source)
select '019ef500-0000-7000-8000-000000000706', person_id, activity_type_id, result_contract_id,
       contract_version, true, '2026-09-05 10:00-05', '2026-09-05 10:35-05', timezone,
       'completed', validation_status, 0, requested_level, achieved_level, capture_source
from execution.executed_sessions where id = '019ef500-0000-7000-8000-000000000705';

-- The plan's session falls on 6 Aug, so 701 and 702 are the same planned session done
-- twice that week. No operation reschedules a session yet, so it is written directly.
update planning.planned_sessions set scheduled_at = '2026-08-06 07:00-05' where id = :'planned_id';

-- Who asks: the person, with the history a request would send.
set local role postgres;
select set_config('app.actor_person_id', '019ef500-0000-7000-8000-000000000001', true);

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null, null, 20)->'data'))),
  array['019ef500-0000-7000-8000-000000000706', '019ef500-0000-7000-8000-000000000705',
        '019ef500-0000-7000-8000-000000000702', '019ef500-0000-7000-8000-000000000701'],
  'T-EXE-HIST-01 newest first, finished only: no abandoned, no annulled');

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', '2026-08-01', null, null, null, null, null, 20)->'data'))),
  array['019ef500-0000-7000-8000-000000000702', '019ef500-0000-7000-8000-000000000701'],
  'T-EXE-HIST-02 a month, in the person''s zone');

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, true, null, null, null, 20)->'data'))),
  array['019ef500-0000-7000-8000-000000000702'],
  'T-EXE-HIST-03 only the sessions with a record');

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, true, null, null, 20)->'data'))),
  array['019ef500-0000-7000-8000-000000000706'],
  'T-EXE-HIST-04 only the free ones');

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, false, null, null, 20)->'data'))),
  array['019ef500-0000-7000-8000-000000000705', '019ef500-0000-7000-8000-000000000702',
        '019ef500-0000-7000-8000-000000000701'],
  'T-EXE-HIST-05 only the planned ones');

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, ' TIRON ', null, 20)->'data'))),
  array['019ef500-0000-7000-8000-000000000705', '019ef500-0000-7000-8000-000000000702',
        '019ef500-0000-7000-8000-000000000701'],
  'T-EXE-HIST-06 the routine found without its accent or its case');

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, 'pres', null, 20)->'data'))),
  -- «pres» is not in «Tirón»: what matches is the press in each session's exercise list,
  -- 705's too, though it only recorded rows.
  array['019ef500-0000-7000-8000-000000000705', '019ef500-0000-7000-8000-000000000702',
        '019ef500-0000-7000-8000-000000000701'],
  'T-EXE-HIST-07 a session found by one of its exercises');

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null, null, 20,
       '2026-08-07')->'data'))),
  array['019ef500-0000-7000-8000-000000000702'],
  'T-EXE-HIST-24 a day picked on the calendar lists only what was finished on it');

select is(
  (select jsonb_array_length(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, 'test_endurance', null, null, null, null, 20)->'data')),
  0,
  'T-EXE-HIST-08 a discipline nobody trained answers nothing');

select is(
  (select jsonb_build_object(
     'duration', value->'duration_seconds', 'sets', value->'work_sets', 'kg', value->'total_volume_kg',
     'records', value->'record_count', 'free', value->'is_free', 'title', value->'title',
     'on', value->'trained_on', 'status', value->'status')
   from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', '2026-08-01', null, null, null, null, null, 20)->'data')
   where value->>'executed_session_id' = '019ef500-0000-7000-8000-000000000702'),
  '{"duration": 3000, "sets": 3, "kg": 1240, "records": 4, "free": false, "title": "Tirón",
    "on": "2026-08-07", "status": "completed"}'::jsonb,
  'T-EXE-HIST-09 each row summarised as it is read');

select is(
  (select value->>'thumbnail_object_key'
   from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null, null, 20)->'data')
   where value->>'executed_session_id' = '019ef500-0000-7000-8000-000000000702'),
  (select cover_object_key from execution.read_execution_summary(
     '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000702', 'America/Bogota')),
  'T-EXE-HIST-21 the thumbnail is the routine''s cover, the one its summary shows, never an exercise');

select is(
  (select (value->>'record_count')::integer
   from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null, null, 20)->'data')
   where value->>'executed_session_id' = '019ef500-0000-7000-8000-000000000702'),
  (select jsonb_array_length(records) from execution.read_execution_summary(
     '019ef500-0000-7000-8000-000000000001', '019ef500-0000-7000-8000-000000000702', 'America/Bogota')),
  'T-EXE-HIST-10 a row counts the records its summary shows');

select is(
  (select jsonb_build_object('kg', value->'total_volume_kg', 'sets', value->'work_sets', 'thumbnail', value->'thumbnail_object_key', 'free', value->'is_free')
   from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, true, null, null, 20)->'data')),
  '{"kg": null, "sets": 0, "thumbnail": null, "free": true}'::jsonb,
  'T-EXE-HIST-11 nothing weighed is no kilos, not zero');

select execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null, null, 2) as first_page \gset

select is(
  (select array(select value->>'executed_session_id' from jsonb_array_elements(
     execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null,
       :'first_page'::jsonb->'page'->>'next_cursor', 2)->'data'))),
  array['019ef500-0000-7000-8000-000000000702', '019ef500-0000-7000-8000-000000000701'],
  'T-EXE-HIST-12 the cursor carries on where the page ended, skipping and repeating nothing');

select is(
  (:'first_page'::jsonb->'page'->>'has_more')::boolean
  and not (execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null,
       :'first_page'::jsonb->'page'->>'next_cursor', 2)->'page'->>'has_more')::boolean,
  true,
  'T-EXE-HIST-13 a page says whether there is more');

select throws_ok(
  $$ select execution.list_my_executions('019ef500-0000-7000-8000-000000000001', 'America/Bogota', null, null, null, null, null, 'not a cursor', 20) $$,
  '22023', null,
  'T-EXE-HIST-14 a malformed cursor is refused, never answered with an arbitrary page');

select is(
  (select jsonb_build_object('sessions', value->'sessions', 'sets', value->'work_sets', 'kg', value->'total_volume_kg',
     'records', value->'records', 'seconds', value->'trained_seconds', 'disciplines', value->'disciplines')
   from (select execution.read_history_month('019ef500-0000-7000-8000-000000000001', 'America/Bogota', '2026-08-01') as value) as month),
  '{"sessions": 2, "sets": 4, "kg": 1800, "records": 4, "seconds": 5700,
    "disciplines": [{"code": "test_strength", "name": "Fuerza de prueba"}]}'::jsonb,
  'T-EXE-HIST-15 the month adds up its finished sessions only');

select is(
  (select value from jsonb_array_elements(
     execution.read_history_month('019ef500-0000-7000-8000-000000000001', 'America/Bogota', '2026-09-01')->'weeks')
   where value->>'week_starts_on' = '2026-08-31'),
  '{"week_starts_on": "2026-08-31", "completed": 2, "planned": 0, "fulfilled": 0}'::jsonb,
  'T-EXE-HIST-16 a week with nothing planned says only what was finished');

-- The abandoned 12th and the annulled 14th are not days trained.
select is(
  execution.read_history_month('019ef500-0000-7000-8000-000000000001', 'America/Bogota', '2026-08-01')->'days',
  '[{"trained_on": "2026-08-05", "sessions": 1, "trained_seconds": 2700, "work_sets": 1, "volume_kg": 560, "records": 0},
    {"trained_on": "2026-08-07", "sessions": 1, "trained_seconds": 3000, "work_sets": 3, "volume_kg": 1240, "records": 4}]'::jsonb,
  'T-EXE-HIST-22 the calendar marks each day finished, with its work and its records');

-- 701 and 702 both carry out the 6 Aug session; 704 did too, and was annulled.
select is(
  (select value from jsonb_array_elements(
     execution.read_history_month('019ef500-0000-7000-8000-000000000001', 'America/Bogota', '2026-08-01')->'weeks')
   where value->>'week_starts_on' = '2026-08-03'),
  '{"week_starts_on": "2026-08-03", "completed": 2, "planned": 1, "fulfilled": 1}'::jsonb,
  'T-EXE-HIST-17 a planned session done twice is one of the plan done, the other extra');

-- 31 Aug – 6 Sep seen from August: its sessions fell in September, and still count.
select is(
  (select value from jsonb_array_elements(
     execution.read_history_month('019ef500-0000-7000-8000-000000000001', 'America/Bogota', '2026-08-01')->'weeks')
   where value->>'week_starts_on' = '2026-08-31'),
  '{"week_starts_on": "2026-08-31", "completed": 2, "planned": 0, "fulfilled": 0}'::jsonb,
  'T-EXE-HIST-23 a week across two months is counted whole from either');

select ok(
  (execution.read_history_month('019ef500-0000-7000-8000-000000000001', 'America/Bogota', '2026-08-01')->'months_available')
    @> '["2026-08-01", "2026-09-01"]'::jsonb,
  'T-EXE-HIST-18 the months there is something to see in');

select set_config('app.actor_person_id', '019ef500-0000-7000-8000-000000000002', true);

select is(
  jsonb_array_length(execution.list_my_executions('019ef500-0000-7000-8000-000000000002', 'America/Bogota', null, null, null, null, null, null, 20)->'data'),
  0,
  'T-EXE-HIST-19 T-RESULT-10 the neighbour lists nothing of another person''s');

select is(
  (execution.read_history_month('019ef500-0000-7000-8000-000000000002', 'America/Bogota', '2026-08-01')->>'sessions')::integer,
  0,
  'T-EXE-HIST-20 T-RESULT-10 and her month is empty');

select * from finish();
rollback;
