-- A free session: training that was not on the agenda (OP-EXE-004, HU-SP-052).
--
-- What must hold: it starts empty, with no planned session behind it, autonomous and
-- with the discipline's current contract frozen; a retry answers the same session; only
-- one free session is open at a time; any catalogue movement can be recorded in it; it
-- finishes, and finishing it again answers the same; and the neighbour sees none of it.
--
-- Written before the migration and watched failing: the function does not exist.
begin;

select plan(20);

insert into identity.people (id, given_name, family_name)
values ('019ef700-0000-7000-8000-000000000001', 'Quien', 'Improvisa'),
       ('019ef700-0000-7000-8000-000000000002', 'La', 'Vecina');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef700-0000-7000-8000-0000000000a1', 'test_strength', 'Sentadilla', 'sentadilla', 'global', 'published'),
       ('019ef700-0000-7000-8000-0000000000b1', 'test_strength', 'Dominada', 'dominada', 'global', 'published');

-- A discipline nobody has published an activity type for.
insert into catalog.disciplines (code, name, status)
values ('test_unpublished', 'Disciplina sin actividad', 'published');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef700-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select * into temporary started from execution.start_free_session(
  '019ef700-0000-7000-8000-000000000001', 'test_strength', clock_timestamp() - interval '20 minutes',
  'America/Bogota', 'detailed', 'manual',
  'f7111111-1111-4111-8111-111111111101', '019ef700-0000-7000-8000-000000000501',
  decode(repeat('01', 32), 'hex'));

select is(
  (select array[id::text, revision_number::text, result_contract_id::text, requested_level] from started),
  array['019ef700-0000-7000-8000-000000000501', '0', '019c0000-0000-7000-8000-000000000031', 'detailed'],
  'T-EXE-FREE-01 the session is the command, at revision 0, with the discipline''s contract');

select is(
  (select array[is_autonomous::text, coalesce(context_relationship_id::text, '-'),
                coalesce(context_organization_id::text, '-'), execution_status::text,
                activity_type_id::text]
   from execution.executed_sessions where id = '019ef700-0000-7000-8000-000000000501'),
  array['true', '-', '-', 'in_progress', '019c0000-0000-7000-8000-000000000011'],
  'T-EXE-FREE-02 it is autonomous, belongs to no gym and is open');

select is(
  (select count(*)::integer from execution.planned_session_executions
   where executed_session_id = '019ef700-0000-7000-8000-000000000501'),
  0,
  'T-EXE-FREE-03 no planned session stands behind it');

select is(
  (select jsonb_build_object('exercises', jsonb_array_length(exercises), 'planned', jsonb_array_length(planned))
   from execution.read_execution('019ef700-0000-7000-8000-000000000001', '019ef700-0000-7000-8000-000000000501')),
  '{"exercises": 0, "planned": 0}'::jsonb,
  'T-EXE-FREE-04 it starts empty: the person adds what they train');

select is(
  (select id from execution.start_free_session(
     '019ef700-0000-7000-8000-000000000001', 'test_strength', clock_timestamp() - interval '20 minutes',
     'America/Bogota', 'detailed', 'manual',
     'f7111111-1111-4111-8111-111111111101', '019ef700-0000-7000-8000-000000000501',
     decode(repeat('01', 32), 'hex'))),
  '019ef700-0000-7000-8000-000000000501'::uuid,
  'T-EXE-FREE-05 a retry answers the session that was already started');

select is(
  (select count(*)::integer from execution.executed_sessions
   where person_id = '019ef700-0000-7000-8000-000000000001'),
  1,
  'T-EXE-FREE-06 and starts nothing more');

select throws_ok(
  $$ select execution.start_free_session(
       '019ef700-0000-7000-8000-000000000001', 'test_strength', clock_timestamp(),
       'America/Bogota', 'detailed', 'manual',
       'f7111111-1111-4111-8111-111111111102', '019ef700-0000-7000-8000-000000000502',
       decode(repeat('02', 32), 'hex')) $$,
  '55006', null,
  'T-EXE-FREE-07 a second free session is refused while one is open');

select is(
  execution.read_open_free_session('019ef700-0000-7000-8000-000000000001'),
  '019ef700-0000-7000-8000-000000000501'::uuid,
  'T-EXE-FREE-08 the open free session is what Today offers to resume');

select throws_ok(
  $$ select execution.start_free_session(
       '019ef700-0000-7000-8000-000000000002', 'test_strength', clock_timestamp(),
       'America/Bogota', 'detailed', 'manual',
       'f7111111-1111-4111-8111-111111111103', '019ef700-0000-7000-8000-000000000503',
       decode(repeat('03', 32), 'hex')) $$,
  '42501', null,
  'T-EXE-FREE-09 nobody starts a session for somebody else');

select throws_ok(
  $$ select execution.read_open_free_session('019ef700-0000-7000-8000-000000000002') $$,
  '42501', null,
  'T-EXE-FREE-10 nor asks for somebody else''s open session');

-- Two movements no routine chose, the second added after the first.
select execution.replace_execution_results(
  '019ef700-0000-7000-8000-000000000001', '019ef700-0000-7000-8000-000000000501', 0,
  '[{"family":"strength","set_order":1,"exercise_position":1,"movement_id":"019ef700-0000-7000-8000-0000000000a1","achieved_reps":8,"load_value":60,"load_unit_code":"kg","kind":"normal"},
    {"family":"strength","set_order":2,"exercise_position":2,"movement_id":"019ef700-0000-7000-8000-0000000000b1","achieved_reps":6,"kind":"normal"}]'::jsonb,
  'f7111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'),
  '[{"position":1,"movement_id":"019ef700-0000-7000-8000-0000000000a1"},
    {"position":2,"movement_id":"019ef700-0000-7000-8000-0000000000b1"}]'::jsonb);

select is(
  (select array(select value->>'movement' from jsonb_array_elements(exercises) order by (value->>'position')::integer)
   from execution.read_execution('019ef700-0000-7000-8000-000000000001', '019ef700-0000-7000-8000-000000000501')),
  array['Sentadilla', 'Dominada'],
  'T-EXE-FREE-11 any movement of the catalogue can be recorded in it');

select is(
  (select array[id::text, is_primary::text]
   from execution.finalize_execution(
     '019ef700-0000-7000-8000-000000000001', '019ef700-0000-7000-8000-000000000501', clock_timestamp(),
     'f7111111-1111-4111-8111-111111111105', '019ef700-0000-7000-8000-000000000505',
     decode(repeat('05', 32), 'hex'))),
  array['019ef700-0000-7000-8000-000000000501', 'false'],
  'T-EXE-FREE-12 it finishes, and is nobody''s primary attempt');

select is(
  (select count(*)::integer
   from execution.finalize_execution(
     '019ef700-0000-7000-8000-000000000001', '019ef700-0000-7000-8000-000000000501', clock_timestamp(),
     'f7111111-1111-4111-8111-111111111105', '019ef700-0000-7000-8000-000000000505',
     decode(repeat('05', 32), 'hex'))),
  1,
  'T-EXE-FREE-13 finishing it again answers the same session, not nothing');

select is(
  execution.read_open_free_session('019ef700-0000-7000-8000-000000000001'),
  null,
  'T-EXE-FREE-14 once finished, there is nothing to resume');

select throws_ok(
  $$ select execution.start_free_session(
       '019ef700-0000-7000-8000-000000000001', 'test_unpublished', clock_timestamp(),
       'America/Bogota', 'detailed', 'manual',
       'f7111111-1111-4111-8111-111111111107', '019ef700-0000-7000-8000-000000000507',
       decode(repeat('07', 32), 'hex')) $$,
  '23514', null,
  'T-EXE-FREE-15 a discipline with no published activity type is refused, never guessed');

select is(
  (select id from execution.start_free_session(
     '019ef700-0000-7000-8000-000000000001', 'test_strength', clock_timestamp(),
     'America/Bogota', 'detailed', 'manual',
     'f7111111-1111-4111-8111-111111111106', '019ef700-0000-7000-8000-000000000506',
     decode(repeat('06', 32), 'hex'))),
  '019ef700-0000-7000-8000-000000000506'::uuid,
  'T-EXE-FREE-16 and the next free session can start');

select set_config('app.actor_person_id', '019ef700-0000-7000-8000-000000000002', true);

select is(
  (select count(*)::integer from execution.executed_sessions
   where person_id = '019ef700-0000-7000-8000-000000000001'),
  0,
  'T-EXE-FREE-17 the neighbour sees none of these sessions');

select is(
  (select count(*)::integer
   from execution.read_execution('019ef700-0000-7000-8000-000000000002', '019ef700-0000-7000-8000-000000000506')),
  0,
  'T-EXE-FREE-18 nor reads one through the reader');

reset role;

select ok(
  has_function_privilege('allfit_api',
    'execution.start_free_session(uuid, text, timestamptz, text, catalog.completeness_level, text, uuid, uuid, bytea)',
    'execute')
  and has_function_privilege('allfit_api', 'execution.read_open_free_session(uuid)', 'execute'),
  'T-EXE-FREE-19 the API may call both');

select ok(
  not has_function_privilege('public',
    'execution.start_free_session(uuid, text, timestamptz, text, catalog.completeness_level, text, uuid, uuid, bytea)',
    'execute'),
  'T-EXE-FREE-20 and nobody else may');

select * from finish();
rollback;
