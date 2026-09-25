-- The catalogue Allfit owns.
--
-- What has to hold: a person who belongs to no organization reads the global
-- catalogue and everything hanging off it, a global draft stays invisible, reading
-- the catalogue opens **nothing** of anybody's private content, and the scope tells
-- the truth about owners — a global row with an owner or an author is refused.
--
-- The two reading assertions were written before the policies existed and watched
-- failing: without `programs_select_global` the person reads zero rows, which is
-- exactly what an account with no catalogue at all reads.
begin;

select plan(10);

insert into identity.people (id, given_name, family_name)
values
  ('019e1000-0000-7000-8000-000000000001', 'Global', 'Reader'),
  ('019e1000-0000-7000-8000-000000000002', 'Private', 'Owner');
insert into organizations.organizations (id, type_code, display_name, responsible_party)
values ('019e1000-0000-7000-8000-000000000101', 'studio', 'Private Studio',
  '{"party_kind":"legal_entity","party_name":"Private Studio SAS","purpose":"studio_operations"}');

-- A private template belonging to somebody else, to prove the global read does not
-- drag anything else open with it.
insert into planning.session_templates (id, content_scope, owner_organization_id, discipline_code, author_person_id)
values ('019e1000-0000-7000-8000-000000000201', 'organization', '019e1000-0000-7000-8000-000000000101',
  'test_strength', '019e1000-0000-7000-8000-000000000002');

insert into planning.session_templates (id, content_scope, discipline_code)
values ('019e1000-0000-7000-8000-000000000210', 'global', 'test_strength');
update planning.session_templates set status = 'published'
where id = '019e1000-0000-7000-8000-000000000210';

insert into planning.programs (id, content_scope, status)
values
  ('019e1000-0000-7000-8000-000000000301', 'global', 'published'),
  ('019e1000-0000-7000-8000-000000000302', 'global', 'draft');

select set_config('app.planning_publication', 'true', true);
insert into planning.session_template_versions (
  id, template_id, version_number, discipline_code, activity_type_id, title, content_hash
) values (
  '019e1000-0000-7000-8000-000000000211', '019e1000-0000-7000-8000-000000000210', 1,
  'test_strength', '019c0000-0000-7000-8000-000000000011', 'Sesión global', decode(repeat('11', 32), 'hex')
);
insert into planning.program_versions (id, program_id, version_number, title, content_hash, sex_affinity)
values ('019e1000-0000-7000-8000-000000000303', '019e1000-0000-7000-8000-000000000301', 1,
  'Programa global', decode(repeat('12', 32), 'hex'), 'female');
insert into planning.program_version_sessions (program_version_id, template_version_id, position, week, day)
values ('019e1000-0000-7000-8000-000000000303', '019e1000-0000-7000-8000-000000000211', 1, 1, 1);
select set_config('app.planning_publication', '', true);

insert into planning.program_version_goals (program_version_id, goal_code)
values ('019e1000-0000-7000-8000-000000000303', 'build_muscle');
insert into planning.program_version_levels (program_version_id, experience_code)
values ('019e1000-0000-7000-8000-000000000303', 'some_practice');
insert into planning.program_version_emphases (program_version_id, focus_area_code)
values ('019e1000-0000-7000-8000-000000000303', 'glutes');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019e1000-0000-7000-8000-000000000001', true);
select set_config('app.actor_org_id', '', true);

select is((select count(*) from planning.programs where id = '019e1000-0000-7000-8000-000000000301'), 1::bigint,
  'T-PLN-RLS-31 a person of no organization reads the global catalogue');
select is((select count(*) from planning.program_versions where id = '019e1000-0000-7000-8000-000000000303'), 1::bigint,
  'T-PLN-RLS-32 and the published version hanging off it');
select is((select count(*) from planning.program_version_goals where program_version_id = '019e1000-0000-7000-8000-000000000303'), 1::bigint,
  'T-PLN-RLS-33 and the segmentation, which inherits from the version');
select is((select count(*) from planning.session_templates where id = '019e1000-0000-7000-8000-000000000210'), 1::bigint,
  'T-PLN-RLS-34 and the global template the program composes');

-- A draft is work in progress, not catalogue.
select is((select count(*) from planning.programs where id = '019e1000-0000-7000-8000-000000000302'), 0::bigint,
  'T-PLN-RLS-35 a global draft stays invisible');

-- The whole point of a separate read policy rather than a wider owner one.
select is((select count(*) from planning.session_templates where id = '019e1000-0000-7000-8000-000000000201'), 0::bigint,
  'T-PLN-RLS-36 reading the catalogue opens nothing of anybody private');

select set_config('app.actor_kind', 'anonymous', true);
select set_config('app.actor_person_id', '', true);
select is((select count(*) from planning.programs where id = '019e1000-0000-7000-8000-000000000301'), 0::bigint,
  'T-PLN-RLS-37 and an actor who is nobody reads none of it');

reset role;

select throws_ok(
  $$ insert into planning.programs (content_scope, owner_person_id) values ('global', '019e1000-0000-7000-8000-000000000002') $$,
  '23514', null, 'T-PLN-INT-36 a global program cannot have an owner');
select throws_ok(
  $$ insert into planning.programs (content_scope, author_person_id) values ('global', '019e1000-0000-7000-8000-000000000002') $$,
  '23514', null, 'T-PLN-INT-37 nor an author: the platform publishes it, no person signs it');
select throws_ok(
  $$ insert into planning.program_version_goals (program_version_id, goal_code) values ('019e1000-0000-7000-8000-000000000303', 'improve_performance') $$,
  '23514', null, 'T-PLN-INT-38 a goal outside the five the contract admits is refused');

select * from finish();
rollback;
