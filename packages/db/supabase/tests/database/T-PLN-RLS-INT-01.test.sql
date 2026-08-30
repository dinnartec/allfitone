begin;

select plan(50);

select has_table('catalog', 'disciplines', 'T-CAT-PHY-01 disciplines are relational catalog data');
select has_table('catalog', 'result_contracts', 'T-CAT-PHY-02 result contracts are relational catalog data');
select has_table('planning', 'session_templates', 'T-PLN-PHY-01 template identities are separate from drafts');
select has_table('planning', 'session_template_versions', 'T-PLN-PHY-02 published template versions are separate and immutable');
select has_table('planning', 'programs', 'T-PLN-PHY-03 program identities are separate from drafts');
select has_table('planning', 'program_versions', 'T-PLN-PHY-04 published program versions are separate and immutable');
select has_function('planning', 'enforce_target_family_ct', 'T-PLN-INT-01 IX-22 has a database invariant');
select has_function('planning', 'create_session_template', 'T-PLN-RLS-01 organization content is reachable only through a closed command');

select is((
  select count(*)
  from pg_class as relation
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('catalog', 'planning')
    and relation.relname in (
      'disciplines', 'activity_types', 'movements', 'units', 'result_contracts',
      'activity_type_result_contracts', 'session_templates', 'session_template_drafts',
      'session_template_versions', 'planned_steps', 'strength_targets', 'endurance_targets',
      'interval_targets', 'mobility_targets', 'programs', 'program_drafts', 'program_versions',
      'program_version_sessions'
    )
    and relation.relrowsecurity
    and relation.relforcerowsecurity
), 18::bigint, 'T-PLN-RLS-09 every new relation enables and forces RLS');

select is((
  -- Cuenta relaciones con política de dueño, no políticas. Contando políticas, añadir
  -- una segunda legítima a una de estas tablas rompía la prueba sin que nada se
  -- hubiera degradado: el nombre decía una cosa y la consulta medía otra.
  select count(distinct relation.relname)
  from pg_policy as policy
  join pg_class as relation on relation.oid = policy.polrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('catalog', 'planning')
    and policy.polroles @> array[(select oid from pg_roles where rolname = 'allfit_owner')]
    and relation.relname in (
      'disciplines', 'activity_types', 'movements', 'units', 'result_contracts',
      'activity_type_result_contracts', 'session_templates', 'session_template_drafts',
      'session_template_versions', 'planned_steps', 'strength_targets', 'endurance_targets',
      'interval_targets', 'mobility_targets', 'programs', 'program_drafts', 'program_versions',
      'program_version_sessions'
    )
), 18::bigint, 'T-PLN-RLS-10 every new relation has an explicit owner policy');

select ok(not has_function_privilege('allfit_api', 'catalog.activity_type_target_family(uuid)', 'EXECUTE'),
  'T-CAT-RLS-01 runtime cannot enumerate an internal catalog SECURITY DEFINER helper');

insert into identity.people (id, given_name, family_name)
values
  ('019e0000-0000-7000-8000-000000000001', 'RLS', 'Owner'),
  ('019e0000-0000-7000-8000-000000000002', 'RLS', 'Outsider');
insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019e0000-0000-7000-8000-000000000101', 'studio', 'RLS Studio',
    '{"party_kind":"legal_entity","party_name":"RLS Studio SAS","purpose":"studio_operations"}'),
  ('019e0000-0000-7000-8000-000000000102', 'studio', 'Other Studio',
    '{"party_kind":"legal_entity","party_name":"Other Studio SAS","purpose":"studio_operations"}');
insert into organizations.organization_memberships (
  id, organization_id, person_id, status, joined_at
) values
  ('019e0000-0000-7000-8000-000000000121', '019e0000-0000-7000-8000-000000000101',
    '019e0000-0000-7000-8000-000000000001', 'active', '2026-08-17T12:00:00Z'),
  ('019e0000-0000-7000-8000-000000000122', '019e0000-0000-7000-8000-000000000102',
    '019e0000-0000-7000-8000-000000000002', 'active', '2026-08-17T12:00:00Z');
insert into organizations.membership_roles (membership_id, role_code, valid_from)
values
  ('019e0000-0000-7000-8000-000000000121', 'admin', '2026-08-17T12:00:00Z'),
  ('019e0000-0000-7000-8000-000000000122', 'admin', '2026-08-17T12:00:00Z');
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019e0000-0000-7000-8000-000000000001', true);
select set_config('app.actor_org_id', '019e0000-0000-7000-8000-000000000101', true);
insert into catalog.activity_types (
  id, discipline_code, code, name, content_scope, owner_organization_id, status
) values (
  '019e0000-0000-7000-8000-000000000112', 'test_strength', 'rls_private_activity',
  'RLS Private Activity', 'organization', '019e0000-0000-7000-8000-000000000101', 'published'
);
insert into catalog.activity_type_result_contracts (
  id, activity_type_id, result_contract_id, is_default, valid_from
) values (
  '019e0000-0000-7000-8000-000000000113', '019e0000-0000-7000-8000-000000000112',
  '019c0000-0000-7000-8000-000000000031', true, clock_timestamp()
);
insert into catalog.movements (
  id, discipline_code, name, normalized_name, content_scope, owner_organization_id, status
) values (
  '019e0000-0000-7000-8000-000000000111', 'test_strength', 'RLS Movement',
  'rls movement', 'organization', '019e0000-0000-7000-8000-000000000101', 'published'
);
insert into planning.session_templates (id, owner_organization_id, discipline_code, author_person_id)
values ('019e0000-0000-7000-8000-000000000201', '019e0000-0000-7000-8000-000000000101', 'test_strength', '019e0000-0000-7000-8000-000000000001');
insert into planning.session_template_drafts (id, template_id, content)
values ('019e0000-0000-7000-8000-000000000202', '019e0000-0000-7000-8000-000000000201',
  '{"title":"RLS","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[]}');
insert into planning.session_template_versions (
  id, template_id, version_number, discipline_code, activity_type_id, title, content_hash
) values (
  '019e0000-0000-7000-8000-000000000203', '019e0000-0000-7000-8000-000000000201', 1,
  'test_strength', '019c0000-0000-7000-8000-000000000011', 'RLS', decode(repeat('01', 32), 'hex')
);
select set_config('app.planning_publication', 'true', true);
insert into planning.planned_steps (id, template_version_id, position, activity_type_id)
values
  ('019e0000-0000-7000-8000-000000000211', '019e0000-0000-7000-8000-000000000203', 1, '019c0000-0000-7000-8000-000000000011'),
  ('019e0000-0000-7000-8000-000000000212', '019e0000-0000-7000-8000-000000000203', 2, '019c0000-0000-7000-8000-000000000012'),
  ('019e0000-0000-7000-8000-000000000213', '019e0000-0000-7000-8000-000000000203', 3, '019c0000-0000-7000-8000-000000000013'),
  ('019e0000-0000-7000-8000-000000000214', '019e0000-0000-7000-8000-000000000203', 4, '019c0000-0000-7000-8000-000000000014');
insert into planning.strength_targets (planned_step_id, target_sets)
values ('019e0000-0000-7000-8000-000000000211', 1);
insert into planning.endurance_targets (planned_step_id, target_duration_seconds)
values ('019e0000-0000-7000-8000-000000000212', 60);
insert into planning.interval_targets (planned_step_id, rounds, work_duration_seconds)
values ('019e0000-0000-7000-8000-000000000213', 1, 30);
insert into planning.mobility_targets (planned_step_id, sequence_position, hold_duration_seconds, side)
values ('019e0000-0000-7000-8000-000000000214', 1, 30, 'bilateral');
insert into planning.programs (id, owner_organization_id, author_person_id)
values ('019e0000-0000-7000-8000-000000000301', '019e0000-0000-7000-8000-000000000101', '019e0000-0000-7000-8000-000000000001');
insert into planning.program_drafts (id, program_id, content)
values ('019e0000-0000-7000-8000-000000000302', '019e0000-0000-7000-8000-000000000301',
  '{"title":"RLS","sessions":[]}');
insert into planning.program_versions (id, program_id, version_number, title, content_hash)
values ('019e0000-0000-7000-8000-000000000303', '019e0000-0000-7000-8000-000000000301', 1, 'RLS', decode(repeat('02', 32), 'hex'));
insert into planning.program_version_sessions (program_version_id, template_version_id, position, week, day)
values ('019e0000-0000-7000-8000-000000000303', '019e0000-0000-7000-8000-000000000203', 1, 1, 1);
select set_config('app.planning_publication', '', true);

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019e0000-0000-7000-8000-000000000001', true);
select set_config('app.actor_org_id', '019e0000-0000-7000-8000-000000000101', true);
select is((select count(*) from catalog.disciplines where id = '019c0000-0000-7000-8000-000000000001'), 1::bigint,
  'T-CAT-RLS-02 authenticated actor reads a published discipline');
select is((select count(*) from catalog.activity_types where id = '019e0000-0000-7000-8000-000000000112'), 1::bigint,
  'T-CAT-RLS-04 organization A reads its private activity type');
select is((select count(*) from catalog.movements where id = '019e0000-0000-7000-8000-000000000111'), 1::bigint,
  'T-CAT-RLS-06 organization A reads its private movement');
select is((select count(*) from catalog.units where id = '019c0000-0000-7000-8000-000000000021'), 1::bigint,
  'T-CAT-RLS-08 authenticated actor reads the governed unit catalog');
select is((select count(*) from catalog.result_contracts where id = '019c0000-0000-7000-8000-000000000031'), 1::bigint,
  'T-CAT-RLS-10 authenticated actor reads a published result contract');
select is((select count(*) from catalog.activity_type_result_contracts where id = '019e0000-0000-7000-8000-000000000113'), 1::bigint,
  'T-CAT-RLS-12 organization A reads its current private activity contract');
select is((select count(*) from planning.session_templates where id = '019e0000-0000-7000-8000-000000000201'), 1::bigint,
  'T-PLN-RLS-14 organization A admin reads its session template');
select is((select count(*) from planning.session_template_drafts where id = '019e0000-0000-7000-8000-000000000202'), 1::bigint,
  'T-PLN-RLS-16 session draft inherits organization A access');
select is((select count(*) from planning.session_template_versions where id = '019e0000-0000-7000-8000-000000000203'), 1::bigint,
  'T-PLN-RLS-18 session version inherits organization A access');
select is((select count(*) from planning.planned_steps where id = '019e0000-0000-7000-8000-000000000211'), 1::bigint,
  'T-PLN-RLS-20 planned step inherits organization A access');
select is((select count(*) from planning.strength_targets where planned_step_id = '019e0000-0000-7000-8000-000000000211'), 1::bigint,
  'T-PLN-RLS-22 strength target inherits organization A access');
select is((select count(*) from planning.endurance_targets where planned_step_id = '019e0000-0000-7000-8000-000000000212'), 1::bigint,
  'T-PLN-RLS-24 endurance target inherits organization A access');
select is((select count(*) from planning.interval_targets where planned_step_id = '019e0000-0000-7000-8000-000000000213'), 1::bigint,
  'T-PLN-RLS-26 interval target inherits organization A access');
select is((select count(*) from planning.mobility_targets where planned_step_id = '019e0000-0000-7000-8000-000000000214'), 1::bigint,
  'T-PLN-RLS-28 mobility target inherits organization A access');
select is((select count(*) from planning.programs where id = '019e0000-0000-7000-8000-000000000301'), 1::bigint,
  'T-PLN-RLS-30 organization A admin reads its program');
select is((select count(*) from planning.program_drafts where id = '019e0000-0000-7000-8000-000000000302'), 1::bigint,
  'T-PLN-RLS-32 program draft inherits organization A access');
select is((select count(*) from planning.program_versions where id = '019e0000-0000-7000-8000-000000000303'), 1::bigint,
  'T-PLN-RLS-34 program version inherits organization A access');
select is((select count(*) from planning.program_version_sessions where program_version_id = '019e0000-0000-7000-8000-000000000303'), 1::bigint,
  'T-PLN-RLS-36 program session inherits organization A access');

select set_config('app.actor_person_id', '019e0000-0000-7000-8000-000000000002', true);
select set_config('app.actor_org_id', '019e0000-0000-7000-8000-000000000102', true);
select is((select count(*) from catalog.disciplines where id = '019c0000-0000-7000-8000-000000000001'), 1::bigint,
  'T-CAT-RLS-03 organization B still reads published global disciplines');
select is((select count(*) from catalog.activity_types where id = '019e0000-0000-7000-8000-000000000112'), 0::bigint,
  'T-CAT-RLS-05 organization B cannot read organization A activity types');
select is((select count(*) from catalog.movements where id = '019e0000-0000-7000-8000-000000000111'), 0::bigint,
  'T-CAT-RLS-07 organization B cannot read organization A movements');
select is((select count(*) from catalog.units where id = '019c0000-0000-7000-8000-000000000021'), 1::bigint,
  'T-CAT-RLS-09 organization B still reads the governed global unit catalog');
select is((select count(*) from catalog.result_contracts where id = '019c0000-0000-7000-8000-000000000031'), 1::bigint,
  'T-CAT-RLS-11 organization B still reads published global result contracts');
select is((select count(*) from catalog.activity_type_result_contracts where id = '019e0000-0000-7000-8000-000000000113'), 0::bigint,
  'T-CAT-RLS-13 organization B cannot read organization A activity contracts');
select is((select count(*) from planning.session_templates where id = '019e0000-0000-7000-8000-000000000201'), 0::bigint,
  'T-PLN-RLS-15 organization B cannot read organization A session templates');
select is((select count(*) from planning.session_template_drafts where id = '019e0000-0000-7000-8000-000000000202'), 0::bigint,
  'T-PLN-RLS-17 organization B cannot read organization A session drafts');
select is((select count(*) from planning.session_template_versions where id = '019e0000-0000-7000-8000-000000000203'), 0::bigint,
  'T-PLN-RLS-19 organization B cannot read organization A session versions');
select is((select count(*) from planning.planned_steps where id = '019e0000-0000-7000-8000-000000000211'), 0::bigint,
  'T-PLN-RLS-21 organization B cannot read organization A planned steps');
select is((select count(*) from planning.strength_targets where planned_step_id = '019e0000-0000-7000-8000-000000000211'), 0::bigint,
  'T-PLN-RLS-23 organization B cannot read organization A strength targets');
select is((select count(*) from planning.endurance_targets where planned_step_id = '019e0000-0000-7000-8000-000000000212'), 0::bigint,
  'T-PLN-RLS-25 organization B cannot read organization A endurance targets');
select is((select count(*) from planning.interval_targets where planned_step_id = '019e0000-0000-7000-8000-000000000213'), 0::bigint,
  'T-PLN-RLS-27 organization B cannot read organization A interval targets');
select is((select count(*) from planning.mobility_targets where planned_step_id = '019e0000-0000-7000-8000-000000000214'), 0::bigint,
  'T-PLN-RLS-29 organization B cannot read organization A mobility targets');
select is((select count(*) from planning.programs where id = '019e0000-0000-7000-8000-000000000301'), 0::bigint,
  'T-PLN-RLS-31 organization B cannot read organization A programs');
select is((select count(*) from planning.program_drafts where id = '019e0000-0000-7000-8000-000000000302'), 0::bigint,
  'T-PLN-RLS-33 organization B cannot read organization A program drafts');
select is((select count(*) from planning.program_versions where id = '019e0000-0000-7000-8000-000000000303'), 0::bigint,
  'T-PLN-RLS-35 organization B cannot read organization A program versions');
select is((select count(*) from planning.program_version_sessions where program_version_id = '019e0000-0000-7000-8000-000000000303'), 0::bigint,
  'T-PLN-RLS-37 organization B cannot read organization A program sessions');
select set_config('app.actor_person_id', '', true);
select set_config('app.actor_org_id', '', true);
select is((select count(*) from catalog.disciplines where id = '019c0000-0000-7000-8000-000000000001'), 0::bigint,
  'T-CAT-RLS-14 an unauthenticated context cannot read global disciplines');
select is((select count(*) from catalog.units where id = '019c0000-0000-7000-8000-000000000021'), 0::bigint,
  'T-CAT-RLS-15 an unauthenticated context cannot read the global unit catalog');
select is((select count(*) from catalog.result_contracts where id = '019c0000-0000-7000-8000-000000000031'), 0::bigint,
  'T-CAT-RLS-16 an unauthenticated context cannot read global result contracts');
reset role;

select * from finish();
rollback;
