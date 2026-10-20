-- Choosing a program, and what the choice leaves behind.
--
-- What has to hold: the command writes one assignment and materialises its calendar
-- starting today, a replay of the same command answers the same assignment instead
-- of a second one, a version nobody offered me is refused, and **a neighbour reads
-- none of it**.
--
-- The two neighbour assertions were written first and watched failing with the
-- policies dropped: without them the neighbour reads the assignment and the whole
-- calendar hanging off it.
begin;

select plan(13);

insert into identity.people (id, given_name, family_name)
values
  ('019e2000-0000-7000-8000-000000000001', 'Chooser', 'One'),
  ('019e2000-0000-7000-8000-000000000002', 'Neighbour', 'Two');
insert into organizations.organizations (id, type_code, display_name, responsible_party)
values ('019e2000-0000-7000-8000-000000000101', 'studio', 'Private Studio',
  '{"party_kind":"legal_entity","party_name":"Private Studio SAS","purpose":"studio_operations"}');

insert into planning.session_templates (id, content_scope, discipline_code, status)
values ('019e2000-0000-7000-8000-000000000201', 'global', 'test_strength', 'published');

-- Somebody else's private content, to prove it cannot be assigned by a stranger.
insert into planning.session_templates (id, content_scope, owner_organization_id, discipline_code, author_person_id, status)
values ('019e2000-0000-7000-8000-000000000221', 'organization', '019e2000-0000-7000-8000-000000000101',
  'test_strength', '019e2000-0000-7000-8000-000000000002', 'published');
insert into planning.programs (id, content_scope, owner_organization_id, author_person_id, status)
values ('019e2000-0000-7000-8000-000000000321', 'organization', '019e2000-0000-7000-8000-000000000101',
  '019e2000-0000-7000-8000-000000000002', 'published');

insert into planning.programs (id, content_scope, status)
values ('019e2000-0000-7000-8000-000000000301', 'global', 'published');

select set_config('app.planning_publication', 'true', true);
insert into planning.session_template_versions (
  id, template_id, version_number, discipline_code, activity_type_id, title, content_hash
) values
  ('019e2000-0000-7000-8000-000000000211', '019e2000-0000-7000-8000-000000000201', 1,
    'test_strength', '019c0000-0000-7000-8000-000000000011', 'Sesión global', decode(repeat('21', 32), 'hex')),
  ('019e2000-0000-7000-8000-000000000231', '019e2000-0000-7000-8000-000000000221', 1,
    'test_strength', '019c0000-0000-7000-8000-000000000011', 'Sesión privada', decode(repeat('23', 32), 'hex'));
insert into planning.program_versions (id, program_id, version_number, title, content_hash)
values
  ('019e2000-0000-7000-8000-000000000303', '019e2000-0000-7000-8000-000000000301', 1,
    'Fuerza básica', decode(repeat('22', 32), 'hex')),
  ('019e2000-0000-7000-8000-000000000323', '019e2000-0000-7000-8000-000000000321', 1,
    'Programa privado', decode(repeat('24', 32), 'hex'));
-- Two weeks, three days a week: six sessions, and the first one is day one.
insert into planning.program_version_sessions (program_version_id, template_version_id, position, week, day)
select '019e2000-0000-7000-8000-000000000303', '019e2000-0000-7000-8000-000000000211',
       row_number() over (), week, day
from generate_series(1, 2) as week, unnest(array[1, 3, 5]) as day;
insert into planning.program_version_sessions (program_version_id, template_version_id, position, week, day)
values ('019e2000-0000-7000-8000-000000000323', '019e2000-0000-7000-8000-000000000231', 1, 1, 1);
select set_config('app.planning_publication', '', true);

insert into planning.program_version_goals (program_version_id, goal_code)
values ('019e2000-0000-7000-8000-000000000303', 'build_muscle');
insert into planning.program_version_levels (program_version_id, experience_code)
values ('019e2000-0000-7000-8000-000000000303', 'some_practice');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019e2000-0000-7000-8000-000000000001', true);

create temporary table chosen as
select planning.self_assign_program(
  '019e2000-0000-7000-8000-000000000001',
  '019e2000-0000-7000-8000-000000000303',
  'America/Bogota',
  '21111111-1111-4111-8111-111111111111',
  '21111111-1111-4111-8111-111111111112',
  decode(repeat('31', 32), 'hex')) as assignment_id;

select isnt((select assignment_id from chosen), null, 'T-PLN-IDEM-30 choosing a program answers an assignment');

-- The runtime role reaches this only through the closed function; it has no
-- privilege on the tables themselves, and that is what keeps the policy honest.
select ok(
  has_function_privilege('allfit_api', 'planning.self_assign_program(uuid, uuid, text, uuid, uuid, bytea, boolean)', 'execute')
  and not has_table_privilege('allfit_api', 'planning.program_assignments', 'select'),
  'T-PLN-RLS-43 the runtime role executes the command and cannot touch the table');

select is(
  (select sessions_planned from planning.read_current_assignment('019e2000-0000-7000-8000-000000000001')),
  6,
  'T-PLN-INT-40 the calendar is materialised, one row per composed session');

select is(
  (select (min(scheduled_at) at time zone 'America/Bogota')::date
     from planning.planned_sessions where person_id = '019e2000-0000-7000-8000-000000000001'),
  (clock_timestamp() at time zone 'America/Bogota')::date,
  'T-PLN-INT-41 and it starts today, in the zone the person is in');

-- A lost response is the case that matters: the retry carries the same command.
select is(
  planning.self_assign_program(
    '019e2000-0000-7000-8000-000000000001',
    '019e2000-0000-7000-8000-000000000303',
    'America/Bogota',
    '21111111-1111-4111-8111-111111111111',
    '21111111-1111-4111-8111-111111111112',
    decode(repeat('31', 32), 'hex')),
  (select assignment_id from chosen),
  'T-PLN-IDEM-31 a replay answers the same assignment instead of a second one');

select is(
  (select count(*)::integer from planning.program_assignments
    where person_id = '019e2000-0000-7000-8000-000000000001'),
  1,
  'T-PLN-IDEM-32 and leaves exactly one');

select throws_ok(
  $$ select planning.self_assign_program('019e2000-0000-7000-8000-000000000001', '019e2000-0000-7000-8000-000000000323', 'America/Bogota', '21111111-1111-4111-8111-111111111121', '21111111-1111-4111-8111-111111111122', decode(repeat('32', 32), 'hex')) $$,
  '42501', null, 'T-PLN-RLS-38 a version belonging to somebody else cannot be assigned');

select throws_ok(
  $$ select planning.self_assign_program('019e2000-0000-7000-8000-000000000001', '019e2000-0000-7000-8000-000000000303', 'Mars/Olympus', '21111111-1111-4111-8111-111111111131', '21111111-1111-4111-8111-111111111132', decode(repeat('33', 32), 'hex')) $$,
  '22023', null, 'T-PLN-INT-42 a timezone PostgreSQL does not know is refused before anything is written');

select is(
  (select count(*)::integer
     from planning.read_program_catalogue('019e2000-0000-7000-8000-000000000001')
    where program_version_id = '019e2000-0000-7000-8000-000000000303'),
  1,
  'T-PLN-RLS-39 the catalogue answers the global program');
select is(
  (select count(*)::integer
     from planning.read_program_catalogue('019e2000-0000-7000-8000-000000000001')
    where program_version_id = '019e2000-0000-7000-8000-000000000323'),
  0,
  'T-PLN-RLS-39A and never the private one');

select set_config('app.actor_person_id', '019e2000-0000-7000-8000-000000000002', true);

select is(
  (select count(*) from planning.program_assignments
    where person_id = '019e2000-0000-7000-8000-000000000001'), 0::bigint,
  'T-PLN-RLS-40 a neighbour does not read my assignment');
select is(
  (select count(*) from planning.planned_sessions
    where person_id = '019e2000-0000-7000-8000-000000000001'), 0::bigint,
  'T-PLN-RLS-41 nor a single session of my calendar');

select is(
  (select count(*)::integer from planning.read_current_assignment('019e2000-0000-7000-8000-000000000001')),
  0,
  'T-PLN-RLS-42 and the governed reader refuses them the same way');

select * from finish();
rollback;
