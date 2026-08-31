-- Training that happened, and who may see it.
--
-- What has to hold: the device's `Command-Id` is the session's identity so a retry
-- cannot start a second one, results are replaced whole rather than merged, a stale
-- revision loses, a session with nothing recorded cannot be closed, and **a
-- neighbour reads none of it**.
--
-- The two neighbour assertions were written first and watched failing with the
-- policies opened: without them the neighbour reads the session and every set in it.
begin;

select plan(15);

insert into identity.people (id, given_name, family_name)
values
  ('019e3000-0000-7000-8000-000000000001', 'Runner', 'One'),
  ('019e3000-0000-7000-8000-000000000002', 'Neighbour', 'Two');

insert into planning.session_templates (id, content_scope, discipline_code, status)
values ('019e3000-0000-7000-8000-000000000101', 'global', 'test_strength', 'published');
insert into planning.programs (id, content_scope, status)
values ('019e3000-0000-7000-8000-000000000201', 'global', 'published');

select set_config('app.planning_publication', 'true', true);
insert into planning.session_template_versions (
  id, template_id, version_number, discipline_code, activity_type_id, title, content_hash
) values (
  '019e3000-0000-7000-8000-000000000102', '019e3000-0000-7000-8000-000000000101', 1,
  'test_strength', '019c0000-0000-7000-8000-000000000011', 'Empuje', decode(repeat('31', 32), 'hex')
);
insert into planning.program_versions (id, program_id, version_number, title, content_hash)
values ('019e3000-0000-7000-8000-000000000202', '019e3000-0000-7000-8000-000000000201', 1,
  'Fuerza', decode(repeat('32', 32), 'hex'));
insert into planning.program_version_sessions (program_version_id, template_version_id, position, week, day)
values ('019e3000-0000-7000-8000-000000000202', '019e3000-0000-7000-8000-000000000102', 1, 1, 1);
select set_config('app.planning_publication', '', true);

insert into planning.program_assignments (
  id, person_id, program_version_id, lifecycle, starts_on, timezone, display_order
) values ('019e3000-0000-7000-8000-000000000301', '019e3000-0000-7000-8000-000000000001',
  '019e3000-0000-7000-8000-000000000202', 'personal', current_date, 'America/Bogota', 1);
insert into planning.planned_sessions (
  id, assignment_id, person_id, template_version_id, week_starts_on, scheduled_at, timezone
) values (
  '019e3000-0000-7000-8000-000000000401', '019e3000-0000-7000-8000-000000000301',
  '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000102',
  date_trunc('week', current_date::timestamp)::date, clock_timestamp(), 'America/Bogota'
);

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019e3000-0000-7000-8000-000000000001', true);

select is(
  (select id from execution.start_planned_session_attempt(
    '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000401',
    clock_timestamp(), 'America/Bogota', 'detailed', 'manual',
    '41111111-1111-4111-8111-111111111111', '019e3000-0000-7000-8000-000000000501',
    decode(repeat('41', 32), 'hex'))),
  '019e3000-0000-7000-8000-000000000501'::uuid,
  'T-EXE-IDEM-01 the device''s command id is the session''s identity');

-- A replay answers the same attempt number, not just the same identifier: a second
-- row would look like a second try at the same day.
select is(
  (select attempt_number from execution.start_planned_session_attempt(
    '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000401',
    clock_timestamp(), 'America/Bogota', 'detailed', 'manual',
    '41111111-1111-4111-8111-111111111111', '019e3000-0000-7000-8000-000000000501',
    decode(repeat('41', 32), 'hex'))),
  1,
  'T-EXE-IDEM-02 and a replay answers it rather than starting a second');

select is(
  (select count(*)::integer from execution.executed_sessions), 1,
  'T-EXE-IDEM-03 leaving exactly one session');

select is(
  (select revision_number from execution.replace_execution_results(
    '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000501', 0,
    '[{"family":"strength","set_order":1,"achieved_reps":10,"rpe":7},
      {"family":"strength","set_order":2,"achieved_reps":8,"rpe":8}]'::jsonb,
    '41111111-1111-4111-8111-111111111121', '019e3000-0000-7000-8000-000000000502',
    decode(repeat('42', 32), 'hex'))),
  1::bigint,
  'T-EXE-INT-01 writing results moves the revision to one');

-- Replaced whole: the second write is the session, not an addition to it.
select is(
  (select revision_number from execution.replace_execution_results(
    '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000501', 1,
    '[{"family":"strength","set_order":1,"achieved_reps":12,"rpe":6}]'::jsonb,
    '41111111-1111-4111-8111-111111111131', '019e3000-0000-7000-8000-000000000503',
    decode(repeat('43', 32), 'hex'))),
  2::bigint,
  'T-EXE-INT-02 and again moves it to two');

-- The count the screen echoes is a count of what is stored, not of what was sent.
select is(
  (select result_count from execution.replace_execution_results(
    '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000501', 2,
    '[{"family":"strength","set_order":1,"achieved_reps":12,"rpe":6}]'::jsonb,
    '41111111-1111-4111-8111-111111111132', '019e3000-0000-7000-8000-00000000050a',
    decode(repeat('4a', 32), 'hex'))),
  1,
  'T-EXE-INT-07 and answers how many results the session now holds');

select is(
  (select count(*)::integer from execution.strength_sets), 1,
  'T-EXE-INT-03 results are replaced whole, never merged');

select throws_ok(
  $$ select * from execution.replace_execution_results('019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000501', 0, '[]'::jsonb, '41111111-1111-4111-8111-111111111141', '019e3000-0000-7000-8000-000000000504', decode(repeat('44', 32), 'hex')) $$,
  '40001', null, 'T-EXE-INT-04 a stale revision loses');

-- The first valid attempt is the primary one, which is what the history counts.
select is(
  (select is_primary from execution.finalize_execution(
    '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000501',
    clock_timestamp(), '41111111-1111-4111-8111-111111111151',
    '019e3000-0000-7000-8000-000000000505', decode(repeat('45', 32), 'hex'))),
  true,
  'T-EXE-INT-05 closing completes the session as its primary attempt');

select is(
  (select status from planning.planned_sessions where id = '019e3000-0000-7000-8000-000000000401'),
  'completed',
  'T-EXE-INT-06 and the planned session with it');

-- Abandoning keeps what was recorded rather than deleting it, and the attempt can
-- never be the primary one for its day.
insert into planning.planned_sessions (
  id, assignment_id, person_id, template_version_id, week_starts_on, scheduled_at, timezone
) values (
  '019e3000-0000-7000-8000-000000000402', '019e3000-0000-7000-8000-000000000301',
  '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000102',
  date_trunc('week', current_date::timestamp)::date, clock_timestamp(), 'America/Bogota'
);
select execution.start_planned_session_attempt(
  '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000402',
  clock_timestamp(), 'America/Bogota', 'detailed', 'manual',
  '41111111-1111-4111-8111-111111111161', '019e3000-0000-7000-8000-000000000601',
  decode(repeat('46', 32), 'hex'));
select execution.replace_execution_results(
  '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000601', 0,
  '[{"family":"strength","set_order":1,"achieved_reps":5}]'::jsonb,
  '41111111-1111-4111-8111-111111111171', '019e3000-0000-7000-8000-000000000602',
  decode(repeat('47', 32), 'hex'));

select is(
  (select result_count from execution.abandon_execution(
    '019e3000-0000-7000-8000-000000000001', '019e3000-0000-7000-8000-000000000601',
    clock_timestamp(), '41111111-1111-4111-8111-111111111181',
    '019e3000-0000-7000-8000-000000000603', decode(repeat('48', 32), 'hex'))),
  1,
  'T-EXE-INT-08 abandoning keeps what was recorded');

select is(
  (select count(*)::integer from execution.planned_session_executions as attempt
    where attempt.executed_session_id = '019e3000-0000-7000-8000-000000000601'
      and attempt.is_primary),
  0,
  'T-EXE-INT-09 and an abandoned attempt is never the primary one');

select set_config('app.actor_person_id', '019e3000-0000-7000-8000-000000000002', true);

select is(
  (select count(*) from execution.executed_sessions
    where person_id = '019e3000-0000-7000-8000-000000000001'), 0::bigint,
  'T-EXE-RLS-01 a neighbour does not read my session');
select is(
  (select count(*) from execution.strength_sets), 0::bigint,
  'T-EXE-RLS-02 nor a single set of it');

-- Written after the surface answered 42501 on a green suite: every assertion above
-- runs as the owner, so nothing here crossed the runtime role's schema grant.
set local role allfit_api;
select ok(
  has_schema_privilege('allfit_api', 'execution', 'usage'),
  'T-EXE-RLS-03 the runtime role can reach the schema its readers live in');

select * from finish();
rollback;
