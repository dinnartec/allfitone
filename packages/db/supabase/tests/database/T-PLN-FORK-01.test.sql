-- Taking a program is keeping it.
--
-- What has to hold: the copy is complete, it belongs to the person, the neighbour
-- cannot see it, the original is untouched, and the calendar lands on calendar
-- weeks. Plus the one thing that only shows up later — a session already closed
-- can be done again without stealing what the first attempt earned.
--
-- The neighbour assertions were written first and watched failing with the
-- ownership left as `global`: without it the copy is Allfit's and everybody reads
-- it, which is exactly the state this migration exists to leave behind.
begin;

select plan(20);

insert into identity.people (id, given_name, family_name)
values
  ('019e6000-0000-7000-8000-000000000001', 'Owner', 'One'),
  ('019e6000-0000-7000-8000-000000000002', 'Neighbour', 'Two');

-- The actor context comes first, before any target is written. The check that
-- guards `IX-22` resolves the family through a `security definer` reader, and the
-- owner obeys forced row security too: with no actor set it sees no catalogue and
-- refuses a target that is perfectly valid.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019e6000-0000-7000-8000-000000000001', true);

-- A small global program of its own: `db:reset` does not load the curated
-- catalogue, which is a script meant to be run against a real database.
insert into planning.session_templates (id, content_scope, discipline_code, status)
values
  ('019e6000-0000-7000-8000-000000000201', 'global', 'test_strength', 'published'),
  ('019e6000-0000-7000-8000-000000000202', 'global', 'test_strength', 'published');
insert into planning.programs (id, content_scope, status)
values ('019e6000-0000-7000-8000-000000000301', 'global', 'published');

-- One of the two routines has a cover. Taking the programme copies its versions, and a
-- copy that dropped the cover would quietly change how Allfit's routine looks the
-- moment it became somebody's own.

select set_config('app.planning_publication', 'true', true);
insert into planning.session_template_versions (
  id, template_id, version_number, discipline_code, activity_type_id, title,
  cover_kind, cover_icon, content_hash
) values
  ('019e6000-0000-7000-8000-000000000211', '019e6000-0000-7000-8000-000000000201', 1,
   'test_strength', '019c0000-0000-7000-8000-000000000011', 'Empuje',
   'icon', 'strength', decode(repeat('61', 32), 'hex')),
  ('019e6000-0000-7000-8000-000000000212', '019e6000-0000-7000-8000-000000000202', 1,
   'test_strength', '019c0000-0000-7000-8000-000000000011', 'Tirón',
   null, null, decode(repeat('62', 32), 'hex'));

insert into planning.planned_steps (id, template_version_id, position)
values
  ('019e6000-0000-7000-8000-000000000221', '019e6000-0000-7000-8000-000000000211', 1),
  ('019e6000-0000-7000-8000-000000000222', '019e6000-0000-7000-8000-000000000211', 2),
  ('019e6000-0000-7000-8000-000000000223', '019e6000-0000-7000-8000-000000000212', 1);
insert into planning.strength_targets (planned_step_id, target_sets, target_reps)
values
  ('019e6000-0000-7000-8000-000000000221', 4, 8),
  ('019e6000-0000-7000-8000-000000000222', 3, 10),
  ('019e6000-0000-7000-8000-000000000223', 4, 6);

insert into planning.program_versions (id, program_id, version_number, title, content_hash)
values ('019e6000-0000-7000-8000-000000000303', '019e6000-0000-7000-8000-000000000301', 1,
  'Torso y pierna', decode(repeat('63', 32), 'hex'));
-- Two weeks, two sessions each: enough to prove week N lands on calendar week N.
insert into planning.program_version_sessions (program_version_id, template_version_id, position, week, day)
values
  ('019e6000-0000-7000-8000-000000000303', '019e6000-0000-7000-8000-000000000211', 1, 1, 1),
  ('019e6000-0000-7000-8000-000000000303', '019e6000-0000-7000-8000-000000000212', 2, 1, 3),
  ('019e6000-0000-7000-8000-000000000303', '019e6000-0000-7000-8000-000000000211', 3, 2, 1),
  ('019e6000-0000-7000-8000-000000000303', '019e6000-0000-7000-8000-000000000212', 4, 2, 3);
select set_config('app.planning_publication', '', true);

insert into planning.program_version_goals (program_version_id, goal_code)
values ('019e6000-0000-7000-8000-000000000303', 'build_muscle');

set local role allfit_owner;

select '019e6000-0000-7000-8000-000000000303' as global_version \gset

select planning.self_assign_program(
  '019e6000-0000-7000-8000-000000000001', :'global_version', 'America/Bogota',
  '72111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('d1', 32), 'hex')) as assignment \gset

select is(
  (select count(*)::integer from planning.programs
    where owner_person_id = '019e6000-0000-7000-8000-000000000001'
      and content_scope = 'person'),
  1,
  'T-PLN-FORK-01 taking a global program leaves the person owning one');

-- The whole point: not a single session may still point at Allfit's content, or a
-- change there would reach into somebody's calendar.
select is(
  (select count(*)::integer
   from planning.planned_sessions as s
   join planning.session_template_versions as tv on tv.id = s.template_version_id
   join planning.session_templates as t on t.id = tv.template_id
   where s.person_id = '019e6000-0000-7000-8000-000000000001'
     and t.content_scope <> 'person'),
  0,
  'T-PLN-FORK-02 and not one planned session still points at the global content');

select is(
  (select count(distinct tv.id)::integer
   from planning.program_version_sessions as c
   join planning.session_template_versions as tv on tv.id = c.template_version_id
   where c.program_version_id = :'global_version'),
  (select count(*)::integer from planning.session_templates
    where owner_person_id = '019e6000-0000-7000-8000-000000000001'),
  'T-PLN-FORK-03 one copied template per distinct template the program composes');

-- La copia es una plantilla nueva con identidad propia, así que las métricas de la
-- persona cuentan su copia. La procedencia es lo único que permite agregar cuánta gente
-- entrena algo derivado de un programa de Allfit: sin ella son plantillas sueltas que
-- se parecen. `ADR-009`, invariante 7.
select is(
  (select array_agg(distinct copy.derived_from_version_id::text
                    order by copy.derived_from_version_id::text)
   from planning.session_template_versions as copy
   join planning.session_templates as owner on owner.id = copy.template_id
   where owner.owner_person_id = '019e6000-0000-7000-8000-000000000001'),
  array['019e6000-0000-7000-8000-000000000211', '019e6000-0000-7000-8000-000000000212'],
  'T-PLN-FORK-3b and each copy says which version of Allfit it came from');

select is(
  (select count(*)::integer from planning.planned_steps as step
   join planning.session_template_versions as tv on tv.id = step.template_version_id
   join planning.session_templates as t on t.id = tv.template_id
   where t.owner_person_id = '019e6000-0000-7000-8000-000000000001'),
  (select count(*)::integer from planning.planned_steps as step
   where step.template_version_id in (
     select c.template_version_id from planning.program_version_sessions as c
     where c.program_version_id = :'global_version')),
  'T-PLN-FORK-04 with every step copied, none dropped');

select is(
  (select count(*)::integer from planning.strength_targets as target
   join planning.planned_steps as step on step.id = target.planned_step_id
   join planning.session_template_versions as tv on tv.id = step.template_version_id
   join planning.session_templates as t on t.id = tv.template_id
   where t.owner_person_id = '019e6000-0000-7000-8000-000000000001'),
  (select count(*)::integer from planning.strength_targets as target
   join planning.planned_steps as step on step.id = target.planned_step_id
   where step.template_version_id in (
     select c.template_version_id from planning.program_version_sessions as c
     where c.program_version_id = :'global_version')),
  'T-PLN-FORK-05 and every target with them');

-- The same content produces the same hash, which is the cheapest possible proof
-- that the copy says what the original said.
select is(
  (select v.content_hash from planning.program_versions as v
   join planning.programs as p on p.id = v.program_id
   where p.owner_person_id = '019e6000-0000-7000-8000-000000000001'),
  (select content_hash from planning.program_versions where id = :'global_version'),
  'T-PLN-FORK-06 the copy hashes to what the original hashed to');

-- Weeks are calendar weeks in **the person's** zone, which is the one the assignment
-- was taken in. Comparing against `current_date` compared against the server's, and
-- those are different dates for five hours every night: this failed on a Sunday
-- evening in Bogotá, when UTC had already rolled into Monday and Bogotá had not.
select is(
  (select min(week_starts_on) from planning.planned_sessions
    where person_id = '019e6000-0000-7000-8000-000000000001'),
  date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))::date,
  'T-PLN-FORK-07 week one is the calendar week the person is standing in');

select is(
  (select count(distinct week_starts_on)::integer from planning.planned_sessions
    where person_id = '019e6000-0000-7000-8000-000000000001'),
  (select max(week)::integer from planning.program_version_sessions
    where program_version_id = :'global_version'),
  'T-PLN-FORK-08 and program week N lands on calendar week N');

-- A session already closed can be done again, and the repeat does not take what
-- the first attempt earned.
select id as first_session from planning.planned_sessions
where person_id = '019e6000-0000-7000-8000-000000000001'
order by scheduled_at limit 1 \gset

select execution.start_planned_session_attempt(
  '019e6000-0000-7000-8000-000000000001', :'first_session', clock_timestamp(),
  'America/Bogota', 'detailed', 'manual', '72111111-1111-4111-8111-111111111111',
  '019e6000-0000-7000-8000-000000000501', decode(repeat('d2', 32), 'hex'));
select execution.replace_execution_results(
  '019e6000-0000-7000-8000-000000000001', '019e6000-0000-7000-8000-000000000501', 0,
  '[{"family":"strength","set_order":1,"achieved_reps":8}]'::jsonb,
  '72111111-1111-4111-8111-111111111121', '019e6000-0000-7000-8000-000000000502',
  decode(repeat('d3', 32), 'hex'));
select execution.finalize_execution(
  '019e6000-0000-7000-8000-000000000001', '019e6000-0000-7000-8000-000000000501',
  clock_timestamp(), '72111111-1111-4111-8111-111111111131',
  '019e6000-0000-7000-8000-000000000503', decode(repeat('d4', 32), 'hex'));

select is(
  (select attempt_number from execution.start_planned_session_attempt(
    '019e6000-0000-7000-8000-000000000001', :'first_session', clock_timestamp(),
    'America/Bogota', 'detailed', 'manual', '72111111-1111-4111-8111-111111111141',
    '019e6000-0000-7000-8000-000000000504', decode(repeat('d5', 32), 'hex'))),
  2,
  'T-PLN-FORK-09 a session already closed can be done again');

select is(
  (select count(*)::integer from execution.planned_session_executions
    where planned_session_id = :'first_session' and is_primary),
  1,
  'T-PLN-FORK-10 and the repeat does not take what the first attempt earned');

-- The order the person put them in, which is what decides the programme the tab
-- opens on. A second programme goes in front, because taking one is choosing it.
-- The same programme again: taking one twice is legitimate and gives a second copy,
-- which is all this needs to have two things to order.
select planning.self_assign_program(
  '019e6000-0000-7000-8000-000000000001', :'global_version', 'America/Bogota',
  '72111111-1111-4111-8111-111111111151', extensions.uuid_generate_v7(),
  decode(repeat('d6', 32), 'hex')) as second_assignment \gset

select is(
  (select assignment_id from planning.read_my_programs('019e6000-0000-7000-8000-000000000001') limit 1),
  :'second_assignment'::uuid,
  'T-PLN-FORK-11 the programme just taken is the one the tab opens on');

-- `IX-48` · the fork is a copy, and a copy keeps what the person will see. Four rows
-- and not two because this programme was taken twice, and each take forks again.
select is(
  (select jsonb_agg(copied.cover order by copied.cover->>'title')
   from (
     select distinct jsonb_build_object('title', mine.title, 'kind', mine.cover_kind,
                                        'icon', mine.cover_icon) as cover
     from planning.session_template_versions as mine
     join planning.session_templates as owned on owned.id = mine.template_id
     where owned.owner_person_id = '019e6000-0000-7000-8000-000000000001'
   ) as copied),
  '[{"kind": "icon", "icon": "strength", "title": "Empuje"}, {"kind": null, "icon": null, "title": "Tirón"}]'::jsonb,
  'T-PLN-FORK-14 taking a programme copies each routine cover, and the absence of one');

select is(
  planning.reorder_my_programs(
    '019e6000-0000-7000-8000-000000000001',
    array[:'assignment'::uuid, :'second_assignment'::uuid],
    '72111111-1111-4111-8111-111111111161', extensions.uuid_generate_v7(),
    decode(repeat('d7', 32), 'hex')),
  2,
  'T-PLN-FORK-12 and the order can be changed');

select is(
  (select assignment_id from planning.read_my_programs('019e6000-0000-7000-8000-000000000001') limit 1),
  :'assignment'::uuid,
  'T-PLN-FORK-13 which is what the list answers afterwards');

-- The Hoy screen asks this one and the Entrenar tab asks `read_week_plan`, so the two
-- have to agree on which programme is current. Ordering by when it was taken made them
-- disagree the moment somebody reordered, each screen naming a different programme.
select is(
  (select assignment_id from planning.read_current_assignment('019e6000-0000-7000-8000-000000000001')),
  :'assignment'::uuid,
  'T-PLN-FORK-15 the current assignment is the one chosen, not the one taken last');

select is(
  (select program_version_id from planning.read_current_assignment('019e6000-0000-7000-8000-000000000001')),
  (select program_version_id from planning.read_my_programs('019e6000-0000-7000-8000-000000000001') limit 1),
  'T-PLN-FORK-16 so Hoy and Entrenar name the same version');

-- A partial order would silently leave whatever was omitted wherever it was.
select throws_ok(
  $$ select planning.reorder_my_programs('019e6000-0000-7000-8000-000000000001', array['019e6000-0000-7000-8000-000000000001'::uuid], '72111111-1111-4111-8111-111111111171', extensions.uuid_generate_v7(), decode(repeat('d8', 32), 'hex')) $$,
  '22023', null, 'T-PLN-FORK-14 an order that does not cover every programme is refused');

-- Held by id, not by owner. Filtering on `owner_person_id` would pass even if the
-- fork had left the copy owned by nobody, which is the failure mode this pair is
-- here to catch.
select id as copy_program from planning.programs
where owner_person_id = '019e6000-0000-7000-8000-000000000001' limit 1 \gset
select id as copy_template from planning.session_templates
where owner_person_id = '019e6000-0000-7000-8000-000000000001' limit 1 \gset

select set_config('app.actor_person_id', '019e6000-0000-7000-8000-000000000002', true);

select is(
  (select count(*) from planning.programs where id = :'copy_program'), 0::bigint,
  'T-PLN-FORK-RLS-01 a neighbour does not see the copy');
select is(
  (select count(*) from planning.session_templates where id = :'copy_template'), 0::bigint,
  'T-PLN-FORK-RLS-02 nor a single template of it');

select * from finish();
rollback;
