begin;

select plan(71);

insert into identity.people (id, given_name, family_name)
values
  ('019d0000-0000-7000-8000-000000000001', 'Olivia', 'Owner'),
  ('019d0000-0000-7000-8000-000000000002', 'Camilo', 'Coach'),
  ('019d0000-0000-7000-8000-000000000003', 'Sara', 'Staff'),
  ('019d0000-0000-7000-8000-000000000004', 'Otto', 'Other'),
  ('019d0000-0000-7000-8000-000000000005', 'Ada', 'Admin');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019d0000-0000-7000-8000-000000000101', 'studio', 'Planning One', '{"party_kind":"legal_entity","party_name":"Planning One SAS","purpose":"studio_operations"}'),
  ('019d0000-0000-7000-8000-000000000102', 'studio', 'Planning Other', '{"party_kind":"legal_entity","party_name":"Planning Other SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id)
values
  ('019d0000-0000-7000-8000-000000000201', '019d0000-0000-7000-8000-000000000101', '019d0000-0000-7000-8000-000000000001'),
  ('019d0000-0000-7000-8000-000000000202', '019d0000-0000-7000-8000-000000000101', '019d0000-0000-7000-8000-000000000002'),
  ('019d0000-0000-7000-8000-000000000203', '019d0000-0000-7000-8000-000000000101', '019d0000-0000-7000-8000-000000000003'),
  ('019d0000-0000-7000-8000-000000000204', '019d0000-0000-7000-8000-000000000102', '019d0000-0000-7000-8000-000000000004'),
  ('019d0000-0000-7000-8000-000000000205', '019d0000-0000-7000-8000-000000000101', '019d0000-0000-7000-8000-000000000005');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019d0000-0000-7000-8000-000000000201', 'owner'),
  ('019d0000-0000-7000-8000-000000000202', 'coach'),
  ('019d0000-0000-7000-8000-000000000203', 'staff'),
  ('019d0000-0000-7000-8000-000000000204', 'owner'),
  ('019d0000-0000-7000-8000-000000000205', 'admin');

insert into catalog.activity_types (
  id, discipline_code, code, name, content_scope, owner_organization_id, status
) values (
  '019c0000-0000-7000-8000-000000000015', 'test_strength', 'other_private_strength',
  'Other private strength', 'organization', '019d0000-0000-7000-8000-000000000102', 'published'
);
insert into catalog.activity_type_result_contracts (
  id, activity_type_id, result_contract_id, is_default, valid_from
) values (
  '019c0000-0000-7000-8000-000000000045', '019c0000-0000-7000-8000-000000000015',
  '019c0000-0000-7000-8000-000000000031', true, clock_timestamp()
);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000001', true);
select set_config('app.actor_org_id', '019d0000-0000-7000-8000-000000000101', true);

select ok(cardinality(planning.session_content_errors('{}', '019d0000-0000-7000-8000-000000000101', 'test_strength', true)) > 0,
  'T-PLN-UNIT-03 an empty session draft fails closed validation');
select ok(cardinality(planning.program_content_errors('{}', '019d0000-0000-7000-8000-000000000101', true)) > 0,
  'T-PLN-UNIT-04 an empty program draft fails closed validation');
select ok(cardinality(planning.session_content_errors(
  '{"title":"Invalid position","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":201,"target":{"family":"strength","target_sets":1}}]}',
  '019d0000-0000-7000-8000-000000000101', 'test_strength', false)) > 0,
  'T-PLN-UNIT-05 session step limits match the OpenAPI contract');
select ok(cardinality(planning.session_content_errors(
  '{"title":"Cross tenant","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"activity_type_id":"019c0000-0000-7000-8000-000000000015","target":{"family":"strength","target_sets":1}}]}',
  '019d0000-0000-7000-8000-000000000101', 'test_strength', false)) > 0,
  'T-PLN-RLS-08 a per-step activity override cannot cross organization scope');
select ok(cardinality(planning.program_content_errors(
  jsonb_build_object('title', 'Bad notes', 'notes', 7, 'sessions', '[]'::jsonb),
  '019d0000-0000-7000-8000-000000000101', false)) > 0,
  'T-PLN-UNIT-06 program notes types match the OpenAPI contract');
select ok(cardinality(planning.program_content_errors(
  jsonb_build_object('title', 'Bad week', 'sessions', jsonb_build_array(jsonb_build_object(
    'position', 731, 'week', 105, 'day', 1,
    'template_version_id', '019c0000-0000-7000-8000-000000000011'))),
  '019d0000-0000-7000-8000-000000000101', false)) > 0,
  'T-PLN-UNIT-07 program schedule limits match the OpenAPI contract');
select ok(cardinality(planning.session_content_errors(
  '{"title":"Invalid typed target","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"notes":7,"target":{"family":"strength","target_sets":1.5,"target_rpe":11}}]}',
  '019d0000-0000-7000-8000-000000000101', 'test_strength', false)) > 0,
  'T-PLN-UNIT-08 nested target and notes types fail before materialization');
select ok(
  cardinality(planning.session_content_errors(
    jsonb_build_object('title', 'Overflow', 'activity_type_id', '019c0000-0000-7000-8000-000000000011',
      'steps', jsonb_build_array(jsonb_build_object('position', 1, 'target', jsonb_build_object(
        'family', 'strength', 'target_sets', 2147483648, 'target_reps', 2147483648)))),
    '019d0000-0000-7000-8000-000000000101', 'test_strength', true)) > 0
  and cardinality(planning.session_content_errors(
    jsonb_build_object('title', 'Overflow', 'activity_type_id', '019c0000-0000-7000-8000-000000000013',
      'steps', jsonb_build_array(jsonb_build_object('position', 1, 'target', jsonb_build_object(
        'family', 'interval', 'rounds', 2147483648, 'work_duration_seconds', 30)))),
    '019d0000-0000-7000-8000-000000000101', 'test_interval', true)) > 0
  and cardinality(planning.session_content_errors(
    jsonb_build_object('title', 'Overflow', 'activity_type_id', '019c0000-0000-7000-8000-000000000014',
      'steps', jsonb_build_array(jsonb_build_object('position', 1, 'target', jsonb_build_object(
        'family', 'mobility', 'sequence_position', 2147483648, 'target_repetitions', 2147483648,
        'side', 'bilateral')))),
    '019d0000-0000-7000-8000-000000000101', 'test_mobility', true)) > 0,
  'T-PLN-UNIT-01 integer target overflow fails closed before materialization'
);
select ok(cardinality(planning.program_content_errors(
  jsonb_build_object('title', 'Program' || repeat(' ', 154), 'sessions', jsonb_build_array()),
  '019d0000-0000-7000-8000-000000000101', false)) > 0,
  'T-PLN-UNIT-02 title limits apply to the received value before trimming');
select ok(
  cardinality(planning.session_content_errors('{"title":"S","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":1}}]}', '019d0000-0000-7000-8000-000000000101', 'test_strength', true)) = 0
  and cardinality(planning.session_content_errors('{"title":"E","activity_type_id":"019c0000-0000-7000-8000-000000000012","steps":[{"position":1,"target":{"family":"endurance","target_duration_seconds":60}}]}', '019d0000-0000-7000-8000-000000000101', 'test_endurance', true)) = 0
  and cardinality(planning.session_content_errors('{"title":"I","activity_type_id":"019c0000-0000-7000-8000-000000000013","steps":[{"position":1,"target":{"family":"interval","rounds":1,"work_duration_seconds":30}}]}', '019d0000-0000-7000-8000-000000000101', 'test_interval', true)) = 0
  and cardinality(planning.session_content_errors('{"title":"M","activity_type_id":"019c0000-0000-7000-8000-000000000014","steps":[{"position":1,"target":{"family":"mobility","sequence_position":1,"hold_duration_seconds":30,"side":"bilateral"}}]}', '019d0000-0000-7000-8000-000000000101', 'test_mobility', true)) = 0,
  'T-PLN-UNIT-09 every lowercase target family satisfies closed database validation');
select ok(cardinality(planning.session_content_errors(
  jsonb_build_object('title', 'Too many steps', 'activity_type_id', '019c0000-0000-7000-8000-000000000011',
    'steps', (select jsonb_agg(jsonb_build_object('position', number, 'target', jsonb_build_object('family', 'strength', 'target_sets', 1))) from generate_series(1, 201) as number)),
  '019d0000-0000-7000-8000-000000000101', 'test_strength', false)) > 0,
  'T-PLN-UNIT-10 session draft array limits match OpenAPI');
select ok(cardinality(planning.program_content_errors(
  jsonb_build_object('title', 'Too many sessions',
    'sessions', (select jsonb_agg(jsonb_build_object('position', number, 'week', 1, 'day', 1, 'template_version_id', '019c0000-0000-7000-8000-000000000011')) from generate_series(1, 731) as number)),
  '019d0000-0000-7000-8000-000000000101', false)) > 0,
  'T-PLN-UNIT-11 program draft array limits match OpenAPI');

select throws_ok(
  $$ insert into planning.session_templates (owner_organization_id, owner_person_id, discipline_code, author_person_id) values ('019d0000-0000-7000-8000-000000000101', '019d0000-0000-7000-8000-000000000001', 'test_strength', '019d0000-0000-7000-8000-000000000001') $$,
  '23514', null, 'T-PLN-INT-02 stable template ownership is XOR'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000003', true);
select throws_ok(
  $$ select * from planning.create_session_template('019d0000-0000-7000-8000-000000000003', '019d0000-0000-7000-8000-000000000101', 'test_strength', 'Forged', '11111111-1111-4111-8111-111111111101', '019d0000-0000-7000-8000-000000000301', decode(repeat('01', 32), 'hex')) $$,
  'P0002', null, 'T-PLN-RLS-02 staff cannot manage content'
);

select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000002', true);
create temporary table created_template as
select * from planning.create_session_template(
  '019d0000-0000-7000-8000-000000000002',
  '019d0000-0000-7000-8000-000000000101',
  'test_strength', 'Fuerza inicial',
  '11111111-1111-4111-8111-111111111102',
  '019d0000-0000-7000-8000-000000000302',
  decode(repeat('02', 32), 'hex')
);
select is((select result->>'discipline_code' from created_template), 'test_strength', 'T-PLN-IDEM-01 coach creates an organization template');
select is((select replayed from planning.create_session_template('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', 'test_strength', 'Fuerza inicial', '11111111-1111-4111-8111-111111111102', '019d0000-0000-7000-8000-000000000302', decode(repeat('02', 32), 'hex'))), true, 'T-PLN-IDEM-02 template creation replays durably');
select throws_ok(
  $$ select * from planning.create_session_template('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', 'test_strength', 'Fuerza inicial', '11111111-1111-4111-8111-111111111102', '019d0000-0000-7000-8000-000000000302', decode(repeat('99', 32), 'hex')) $$,
  '23505', null, 'T-PLN-IDEM-02A reusing an idempotency identity with another canonical request is rejected'
);

create temporary table edited_template as
select * from planning.replace_session_template_draft(
  '019d0000-0000-7000-8000-000000000002',
  '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_template),
  (select result->'draft'->>'etag' from created_template),
  '{"title":"Fuerza A","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"movement_id":null,"activity_type_id":null,"notes":null,"target":{"family":"strength","target_sets":3,"target_reps":8,"target_load_value":null,"target_load_unit_code":null,"target_rpe":7}}]}',
  '11111111-1111-4111-8111-111111111103',
  '019d0000-0000-7000-8000-000000000303',
  decode(repeat('03', 32), 'hex')
);
select is((select result->'content'->>'title' from edited_template), 'Fuerza A', 'T-PLN-IDEM-03 draft replacement stores typed content');
select is((select replayed from planning.replace_session_template_draft('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_template), (select result->'draft'->>'etag' from created_template), '{"title":"Fuerza A","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"movement_id":null,"activity_type_id":null,"notes":null,"target":{"family":"strength","target_sets":3,"target_reps":8,"target_load_value":null,"target_load_unit_code":null,"target_rpe":7}}]}', '11111111-1111-4111-8111-111111111103', '019d0000-0000-7000-8000-000000000303', decode(repeat('03', 32), 'hex'))), true, 'T-PLN-IDEM-03A template draft replacement replays');
select throws_ok(
  format($sql$ select * from planning.replace_session_template_draft('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', %L, %L, '{"title":"Stale","activity_type_id":null,"steps":[]}', '11111111-1111-4111-8111-111111111104', '019d0000-0000-7000-8000-000000000304', decode(repeat('04', 32), 'hex')) $sql$, (select result->>'id' from created_template), (select result->'draft'->>'etag' from created_template)),
  '40001', null, 'T-PLN-IDEM-04 stale template draft ETag is rejected'
);
select throws_ok(
  format($sql$ select * from planning.replace_session_template_draft('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', %L, %L, '{"title":"Wrong family","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"endurance","target_duration_seconds":60}}]}', '11111111-1111-4111-8111-111111111105', '019d0000-0000-7000-8000-000000000305', decode(repeat('05', 32), 'hex')) $sql$, (select result->>'id' from created_template), (select result->>'etag' from edited_template)),
  '22023', null, 'T-PLN-INT-03 incompatible target family is rejected while editing'
);

create temporary table published_template as
select * from planning.publish_session_template_version(
  '019d0000-0000-7000-8000-000000000002',
  '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_template),
  (select result->>'etag' from edited_template),
  '11111111-1111-4111-8111-111111111106',
  '019d0000-0000-7000-8000-000000000306',
  decode(repeat('06', 32), 'hex')
);
select is((select (result->>'version_number')::integer from published_template), 1, 'T-PLN-IDEM-05 publishes immutable template version one');
select is((select replayed from planning.publish_session_template_version('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_template), (select result->>'etag' from edited_template), '11111111-1111-4111-8111-111111111106', '019d0000-0000-7000-8000-000000000306', decode(repeat('06', 32), 'hex'))), true, 'T-PLN-IDEM-06 publish transport retry replays');
select is((select result->>'id' from planning.publish_session_template_version('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_template), (select result->>'etag' from edited_template), '11111111-1111-4111-8111-111111111107', '019d0000-0000-7000-8000-000000000307', decode(repeat('07', 32), 'hex'))), (select result->>'id' from published_template), 'T-PLN-IDEM-07 equivalent publication converges to one version');

select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000004', true);
select throws_ok(
  format($sql$ select * from planning.replace_session_template_draft('019d0000-0000-7000-8000-000000000004', '019d0000-0000-7000-8000-000000000102', %L, %L, '{"title":"Cross tenant","activity_type_id":null,"steps":[]}', '11111111-1111-4111-8111-111111111108', '019d0000-0000-7000-8000-000000000308', decode(repeat('08', 32), 'hex')) $sql$, (select result->>'id' from created_template), (select result->>'etag' from edited_template)),
  'P0002', null, 'T-PLN-RLS-03 another tenant cannot edit the template'
);

select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000002', true);
select set_config('app.request_id', '11111111-1111-4111-8111-111111111109', true);
select is((planning.read_session_template_version('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_template), 1)->>'title'), 'Fuerza A', 'T-PLN-RLS-43 reads the complete immutable version through the audited projection');
select set_config('app.request_id', '11111111-1111-4111-8111-111111111129', true);
select lives_ok(
  $$ select * from planning.list_session_templates(
    '019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101',
    101, null, null) $$,
  'T-PLN-INT-14 the database accepts the one-row look-ahead for an HTTP limit of 100'
);
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000005', true);
select set_config('app.request_id', '11111111-1111-4111-8111-111111111130', true);
select lives_ok(
  $$ select * from planning.list_session_templates(
    '019d0000-0000-7000-8000-000000000005', '019d0000-0000-7000-8000-000000000101',
    25, null, null) $$,
  'T-PLN-RLS-38 an organization admin can list session templates'
);
select set_config('app.request_id', '11111111-1111-4111-8111-111111111131', true);
select is((planning.read_session_template_version(
  '019d0000-0000-7000-8000-000000000005', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_template), 1)->>'title'), 'Fuerza A',
  'T-PLN-RLS-39 an organization admin can read a session template version');
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000004', true);
select set_config('app.request_id', '11111111-1111-4111-8111-111111111132', true);
select throws_ok(
  $$ select * from planning.list_session_templates(
    '019d0000-0000-7000-8000-000000000004', '019d0000-0000-7000-8000-000000000101',
    25, null, null) $$,
  'P0002', null, 'T-PLN-RLS-40 organization B cannot list organization A session templates'
);
select set_config('app.request_id', '11111111-1111-4111-8111-111111111133', true);
select throws_ok(
  format($sql$ select planning.read_session_template_version(
    '019d0000-0000-7000-8000-000000000004', '019d0000-0000-7000-8000-000000000101', %L, 1) $sql$,
    (select result->>'id' from created_template)),
  'P0002', null, 'T-PLN-RLS-41 organization B cannot read organization A session versions'
);
reset role;
select is((select count(*) from privacy.access_events where request_id = '11111111-1111-4111-8111-111111111109'), 1::bigint, 'T-PLN-RLS-04 authorized read is audited in its transaction');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000002', true);
select set_config('app.request_id', '', true);
select throws_ok(
  format($sql$ select planning.read_session_template_version('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', %L, 1) $sql$, (select result->>'id' from created_template)),
  '22023', null, 'T-PLN-RLS-05 read fails closed without audit request context'
);
select throws_ok($$ select id from planning.session_templates $$, '42501', null, 'T-PLN-RLS-06 runtime cannot bypass closed projections');

create temporary table created_program as
select * from planning.create_program(
  '019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', 'Programa A',
  '11111111-1111-4111-8111-111111111110', '019d0000-0000-7000-8000-000000000310', decode(repeat('10', 32), 'hex')
);
select is((select result->'draft'->'content'->>'title' from created_program), 'Programa A', 'T-PLN-IDEM-08 coach creates a program draft');
select is((select replayed from planning.create_program('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', 'Programa A', '11111111-1111-4111-8111-111111111110', '019d0000-0000-7000-8000-000000000310', decode(repeat('10', 32), 'hex'))), true, 'T-PLN-IDEM-08A program creation replays');
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000004', true);
select set_config('app.request_id', '11111111-1111-4111-8111-111111111134', true);
select throws_ok(
  $$ select * from planning.list_programs(
    '019d0000-0000-7000-8000-000000000004', '019d0000-0000-7000-8000-000000000101',
    25, null, null) $$,
  'P0002', null, 'T-PLN-RLS-42 organization B cannot list organization A programs'
);
reset role;
select ok(cardinality(planning.program_content_errors(jsonb_build_object('title','Invalid','notes',null,'sessions',jsonb_build_array(jsonb_build_object('position',1,'week',1,'day',1,'template_version_id',(select result->'draft'->>'id' from created_template)))), '019d0000-0000-7000-8000-000000000101', false)) > 0, 'T-PLN-INT-04 a template draft is never referencable');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000002', true);
create temporary table edited_program as
select * from planning.replace_program_draft(
  '019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_program), (select result->'draft'->>'etag' from created_program),
  jsonb_build_object('title','Programa A','notes',null,'sessions',jsonb_build_array(jsonb_build_object('position',1,'week',1,'day',1,'template_version_id',(select result->>'id' from published_template)))),
  '11111111-1111-4111-8111-111111111111', '019d0000-0000-7000-8000-000000000311', decode(repeat('11', 32), 'hex')
);
select is((select jsonb_array_length(result->'content'->'sessions') from edited_program), 1, 'T-PLN-IDEM-09 program draft stores an exact template-version reference');
select is((select replayed from planning.replace_program_draft('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_program), (select result->'draft'->>'etag' from created_program), jsonb_build_object('title','Programa A','notes',null,'sessions',jsonb_build_array(jsonb_build_object('position',1,'week',1,'day',1,'template_version_id',(select result->>'id' from published_template)))), '11111111-1111-4111-8111-111111111111', '019d0000-0000-7000-8000-000000000311', decode(repeat('11', 32), 'hex'))), true, 'T-PLN-IDEM-09A program draft replacement replays');

create temporary table published_program as
select * from planning.publish_program_version(
  '019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_program), (select result->>'etag' from edited_program),
  '11111111-1111-4111-8111-111111111112', '019d0000-0000-7000-8000-000000000312', decode(repeat('12', 32), 'hex')
);
select is((select (result->>'session_count')::integer from published_program), 1, 'T-PLN-IDEM-10 program publication snapshots its exact composition');
select is((select replayed from planning.publish_program_version('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_program), (select result->>'etag' from edited_program), '11111111-1111-4111-8111-111111111112', '019d0000-0000-7000-8000-000000000312', decode(repeat('12', 32), 'hex'))), true, 'T-PLN-IDEM-11 program publication replays');

create temporary table derived_template as
select * from planning.derive_session_template_version(
  '019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_template), 1, (select result->>'etag' from edited_template),
  '11111111-1111-4111-8111-111111111116', '019d0000-0000-7000-8000-000000000316', decode(repeat('16', 32), 'hex')
);
select is((select result->>'derived_from_version_id' from derived_template),
  (select result->>'id' from published_template),
  'T-PLN-IDEM-14 derivation from a published version preserves provenance');
select is((select replayed from planning.derive_session_template_version(
  '019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_template), 1, (select result->>'etag' from edited_template),
  '11111111-1111-4111-8111-111111111116', '019d0000-0000-7000-8000-000000000316', decode(repeat('16', 32), 'hex'))),
  true, 'T-PLN-IDEM-14A published-version derivation replays');

select throws_ok(
  format($sql$ select * from planning.deprecate_session_template_version('019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101', %L, 1, '11111111-1111-4111-8111-111111111113', '019d0000-0000-7000-8000-000000000313', decode(repeat('13', 32), 'hex')) $sql$, (select result->>'id' from created_template)),
  '42501', null, 'T-PLN-RLS-07 coach cannot deprecate content'
);
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000001', true);
-- The watermark is read through the list contract itself: it is the ordering and
-- pagination key the caller sees, not an incidental column.
select set_config('app.request_id', '11111111-1111-4111-8111-111111111140', true);
create temporary table template_watermark_before_retirement as
select updated_at from planning.list_session_templates(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', 25, null, null
) where template_id = (select (result->>'id')::uuid from created_template);
select is((select result->>'status' from planning.deprecate_session_template_version('019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_template), 1, '11111111-1111-4111-8111-111111111114', '019d0000-0000-7000-8000-000000000314', decode(repeat('14', 32), 'hex'))), 'deprecated', 'T-PLN-IDEM-12 owner deprecates a template version');
select set_config('app.request_id', '11111111-1111-4111-8111-111111111141', true);
create temporary table template_watermark_after_retirement as
select updated_at from planning.list_session_templates(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', 25, null, null
) where template_id = (select (result->>'id')::uuid from created_template);
select ok(
  (select updated_at from template_watermark_after_retirement)
    > (select updated_at from template_watermark_before_retirement),
  'T-PLN-INT-14 template retirement moves the watermark that orders the list'
);
select is((select replayed from planning.deprecate_session_template_version('019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_template), 1, '11111111-1111-4111-8111-111111111114', '019d0000-0000-7000-8000-000000000314', decode(repeat('14', 32), 'hex'))), true, 'T-PLN-IDEM-12A template deprecation replays');
select set_config('app.request_id', '11111111-1111-4111-8111-111111111142', true);
select is(
  (select updated_at from planning.list_session_templates(
    '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', 25, null, null
  ) where template_id = (select (result->>'id')::uuid from created_template)),
  (select updated_at from template_watermark_after_retirement),
  'T-PLN-INT-15 a replayed retirement leaves the watermark untouched'
);
create temporary table new_program_after_deprecation as
select * from planning.create_program(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  'Programa nuevo', '11111111-1111-4111-8111-111111111119',
  '019d0000-0000-7000-8000-000000000319', decode(repeat('19', 32), 'hex')
);
select throws_ok(
  format($sql$ select * from planning.replace_program_draft(
    '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
    %L, %L, %L::jsonb, '11111111-1111-4111-8111-111111111120',
    '019d0000-0000-7000-8000-000000000320', decode(repeat('20', 32), 'hex')) $sql$,
    (select result->>'id' from new_program_after_deprecation),
    (select result->'draft'->>'etag' from new_program_after_deprecation),
    jsonb_build_object('title','Programa nuevo','sessions',jsonb_build_array(jsonb_build_object(
      'position',1,'week',1,'day',1,'template_version_id',(select result->>'id' from published_template))))::text),
  '22023', null, 'T-PLN-INT-11 a deprecated template version cannot enter a new program'
);
create temporary table edited_deprecated_program as
select * from planning.replace_program_draft(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_program), (select result->>'etag' from edited_program),
  (select result->'content' from edited_program),
  '11111111-1111-4111-8111-111111111117', '019d0000-0000-7000-8000-000000000317', decode(repeat('17', 32), 'hex')
);
select is((select jsonb_array_length(result->'deprecated_template_version_ids') from edited_deprecated_program), 1, 'T-PLN-IDEM-13B a program using a deprecated template remains editable with a warning');
create temporary table moved_deprecated_program as
select * from planning.replace_program_draft(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_program), (select result->>'etag' from edited_deprecated_program),
  jsonb_build_object('title','Programa A','notes',null,'sessions',jsonb_build_array(jsonb_build_object(
    'position',2,'week',2,'day',2,'template_version_id',(select result->>'id' from published_template)))),
  '11111111-1111-4111-8111-111111111121', '019d0000-0000-7000-8000-000000000321',
  decode(repeat('21', 32), 'hex')
);
select is((select result->'content'->'sessions'->0->>'position' from moved_deprecated_program), '2',
  'T-PLN-INT-12 a preexisting deprecated reference can move without increasing multiplicity');
select throws_ok(
  format($sql$ select * from planning.replace_program_draft(
    '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
    %L, %L, %L::jsonb, '11111111-1111-4111-8111-111111111122',
    '019d0000-0000-7000-8000-000000000322', decode(repeat('22', 32), 'hex')) $sql$,
    (select result->>'id' from created_program), (select result->>'etag' from moved_deprecated_program),
    jsonb_build_object('title','Programa A','notes',null,'sessions',jsonb_build_array(
      jsonb_build_object('position',1,'week',1,'day',1,'template_version_id',(select result->>'id' from published_template)),
      jsonb_build_object('position',2,'week',1,'day',2,'template_version_id',(select result->>'id' from published_template))))::text),
  '22023', null,
  'T-PLN-INT-13 a deprecated reference cannot increase its preexisting multiplicity'
);
create temporary table republished_deprecated_program as
select * from planning.publish_program_version(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_program), (select result->>'etag' from moved_deprecated_program),
  '11111111-1111-4111-8111-111111111118', '019d0000-0000-7000-8000-000000000318', decode(repeat('18', 32), 'hex')
);
select is((select jsonb_array_length(result->'deprecated_template_version_ids') from republished_deprecated_program), 1, 'T-PLN-IDEM-13C publication succeeds and warns about deprecated template versions');
select set_config('app.request_id', '11111111-1111-4111-8111-111111111143', true);
create temporary table program_watermark_before_retirement as
select updated_at from planning.list_programs(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', 25, null, null
) where program_id = (select (result->>'id')::uuid from created_program);
select is((select result->>'status' from planning.deprecate_program_version('019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_program), 1, '11111111-1111-4111-8111-111111111115', '019d0000-0000-7000-8000-000000000315', decode(repeat('15', 32), 'hex'))), 'deprecated', 'T-PLN-IDEM-13 owner deprecates a program version');
select set_config('app.request_id', '11111111-1111-4111-8111-111111111144', true);
create temporary table program_watermark_after_retirement as
select updated_at from planning.list_programs(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', 25, null, null
) where program_id = (select (result->>'id')::uuid from created_program);
select ok(
  (select updated_at from program_watermark_after_retirement)
    > (select updated_at from program_watermark_before_retirement),
  'T-PLN-INT-16 program retirement moves the watermark that orders the list'
);
select is((select replayed from planning.deprecate_program_version('019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', (select (result->>'id')::uuid from created_program), 1, '11111111-1111-4111-8111-111111111115', '019d0000-0000-7000-8000-000000000315', decode(repeat('15', 32), 'hex'))), true, 'T-PLN-IDEM-13A program deprecation replays');
select set_config('app.request_id', '11111111-1111-4111-8111-111111111145', true);
select is(
  (select updated_at from planning.list_programs(
    '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', 25, null, null
  ) where program_id = (select (result->>'id')::uuid from created_program)),
  (select updated_at from program_watermark_after_retirement),
  'T-PLN-INT-17 a replayed program retirement leaves the watermark untouched'
);

select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000002', true);
select is((select replayed from planning.derive_session_template_version(
    '019d0000-0000-7000-8000-000000000002', '019d0000-0000-7000-8000-000000000101',
    (select (result->>'id')::uuid from created_template), 1, (select result->>'etag' from edited_template),
    '11111111-1111-4111-8111-111111111116', '019d0000-0000-7000-8000-000000000316',
    decode(repeat('16', 32), 'hex'))), true,
  'T-PLN-IDEM-15 a terminal derivation replays after its source is deprecated');
select set_config('app.actor_person_id', '019d0000-0000-7000-8000-000000000001', true);
select is((select result->>'status' from planning.deprecate_session_template_version(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from created_template), 1,
  '11111111-1111-4111-8111-111111111114', '019d0000-0000-7000-8000-000000000314',
  decode(repeat('14', 32), 'hex'))), 'deprecated',
  'T-PLN-IDEM-16 deprecation remains idempotent after derivation is blocked');

-- Publication converges on the materialized content. Two drafts that differ only
-- in what materialization discards must not fork the immutable version history.
create temporary table convergence_template as
select * from planning.create_session_template(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  'test_strength', 'Convergencia', '11111111-1111-4111-8111-111111111123',
  '019d0000-0000-7000-8000-000000000323', decode(repeat('23', 32), 'hex')
);
create temporary table convergence_draft as
select * from planning.replace_session_template_draft(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from convergence_template),
  (select result->'draft'->>'etag' from convergence_template),
  '{"title":"Convergencia","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"movement_id":null,"activity_type_id":null,"notes":null,"target":{"family":"strength","target_sets":3,"target_reps":8,"target_load_value":null,"target_load_unit_code":null,"target_rpe":7}}]}',
  '11111111-1111-4111-8111-111111111124', '019d0000-0000-7000-8000-000000000324', decode(repeat('24', 32), 'hex')
);
create temporary table convergence_version as
select * from planning.publish_session_template_version(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from convergence_template),
  (select result->>'etag' from convergence_draft),
  '11111111-1111-4111-8111-111111111125', '019d0000-0000-7000-8000-000000000325', decode(repeat('25', 32), 'hex')
);
create temporary table convergence_normalized_draft as
select * from planning.replace_session_template_draft(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from convergence_template),
  (select result->>'etag' from convergence_draft),
  '{"title":"  Convergencia  ","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":3,"target_reps":8,"target_rpe":7}}]}',
  '11111111-1111-4111-8111-111111111126', '019d0000-0000-7000-8000-000000000326', decode(repeat('26', 32), 'hex')
);
select isnt(
  (select result->>'etag' from convergence_normalized_draft),
  (select result->>'etag' from convergence_draft),
  'T-PLN-IDEM-17 a padded, sparsely written draft is a distinct draft revision'
);
select is(
  (select result->>'id' from planning.publish_session_template_version(
    '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
    (select (result->>'id')::uuid from convergence_template),
    (select result->>'etag' from convergence_normalized_draft),
    '11111111-1111-4111-8111-111111111127', '019d0000-0000-7000-8000-000000000327', decode(repeat('27', 32), 'hex'))),
  (select result->>'id' from convergence_version),
  'T-PLN-IDEM-18 template publication converges on materialized content, not the raw draft'
);
select set_config('app.request_id', '11111111-1111-4111-8111-111111111146', true);
select is(
  (select jsonb_array_length(result->'versions') from planning.list_session_templates(
    '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', 25, null, null
  ) where template_id = (select (result->>'id')::uuid from convergence_template)),
  1, 'T-PLN-INT-18 convergent template publication does not fork the version history'
);

create temporary table convergence_program as
select * from planning.create_program(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  'Programa C', '11111111-1111-4111-8111-111111111128',
  '019d0000-0000-7000-8000-000000000328', decode(repeat('28', 32), 'hex')
);
create temporary table convergence_program_draft as
select * from planning.replace_program_draft(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from convergence_program),
  (select result->'draft'->>'etag' from convergence_program),
  jsonb_build_object('title', 'Programa C', 'notes', null, 'sessions', jsonb_build_array(
    jsonb_build_object('position', 1, 'week', 1, 'day', 1,
      'template_version_id', (select result->>'id' from convergence_version)))),
  '11111111-1111-4111-8111-111111111129', '019d0000-0000-7000-8000-000000000329', decode(repeat('29', 32), 'hex')
);
create temporary table convergence_program_version as
select * from planning.publish_program_version(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from convergence_program),
  (select result->>'etag' from convergence_program_draft),
  '11111111-1111-4111-8111-111111111130', '019d0000-0000-7000-8000-000000000330', decode(repeat('30', 32), 'hex')
);
create temporary table convergence_program_normalized_draft as
select * from planning.replace_program_draft(
  '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
  (select (result->>'id')::uuid from convergence_program),
  (select result->>'etag' from convergence_program_draft),
  jsonb_build_object('title', '  Programa C  ', 'sessions', jsonb_build_array(
    jsonb_build_object('position', 1, 'week', 1, 'day', 1,
      'template_version_id', (select result->>'id' from convergence_version)))),
  '11111111-1111-4111-8111-111111111131', '019d0000-0000-7000-8000-000000000331', decode(repeat('31', 32), 'hex')
);
select is(
  (select result->>'id' from planning.publish_program_version(
    '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101',
    (select (result->>'id')::uuid from convergence_program),
    (select result->>'etag' from convergence_program_normalized_draft),
    '11111111-1111-4111-8111-111111111132', '019d0000-0000-7000-8000-000000000332', decode(repeat('32', 32), 'hex'))),
  (select result->>'id' from convergence_program_version),
  'T-PLN-IDEM-19 program publication converges on materialized content, not the raw draft'
);
select set_config('app.request_id', '11111111-1111-4111-8111-111111111147', true);
select is(
  (select jsonb_array_length(result->'versions') from planning.list_programs(
    '019d0000-0000-7000-8000-000000000001', '019d0000-0000-7000-8000-000000000101', 25, null, null
  ) where program_id = (select (result->>'id')::uuid from convergence_program)),
  1, 'T-PLN-INT-19 convergent program publication does not fork the version history'
);

reset role;
select throws_ok(format($sql$ update planning.session_template_versions set title = 'Mutated' where id = %L $sql$, (select result->>'id' from published_template)), '55000', null, 'T-PLN-INT-05 published template content is immutable');
select throws_ok(format($sql$ delete from planning.program_version_sessions where program_version_id = %L $sql$, (select result->>'id' from published_program)), '55000', null, 'T-PLN-INT-06 published program composition is immutable');
select is((select count(*) from planning.program_version_sessions where program_version_id = (select (result->>'id')::uuid from published_program)), 1::bigint, 'T-PLN-INT-07 deprecation leaves published history unchanged');

select set_config('app.planning_publication', 'true', true);
insert into planning.planned_steps (id, template_version_id, position, activity_type_id)
values ('019d0000-0000-7000-8000-000000000401', (select (result->>'id')::uuid from published_template), 2, '019c0000-0000-7000-8000-000000000012');
select throws_ok(
  $$ insert into planning.strength_targets (planned_step_id, target_sets) values ('019d0000-0000-7000-8000-000000000401', 1) $$,
  '23514', null, 'T-PLN-INT-08 IX-22 rejects a typed target from the wrong activity family'
);
select set_config('app.planning_publication', '', true);
select throws_ok(format($sql$ insert into planning.program_version_sessions (program_version_id, template_version_id, position, week, day) values (%L, %L, 2, 1, 2) $sql$, (select result->>'id' from published_program), (select result->>'id' from published_template)), '55000', null, 'T-PLN-INT-09 published composition cannot gain a late position');
select throws_ok(
  $$ update catalog.result_contracts set envelope = '{"tampered":true}' where contract_code = 'test.strength' and version_number = 1 $$,
  '55000', null, 'T-CAT-INT-01 a published result contract is immutable'
);

select * from finish();
rollback;
