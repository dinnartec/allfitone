begin;

select plan(40);

select has_table('catalog', 'professional_specialties', 'professional specialties catalogue exists');
select has_table('catalog', 'professional_credential_types', 'professional credential types catalogue exists');
select has_table('identity', 'professional_profiles', 'professional profiles exist');
select has_table('identity', 'professional_profile_specialties', 'profile specialties exist');
select has_table('identity', 'professional_credentials', 'professional credentials exist');
select has_table('identity', 'professional_credential_verifications', 'credential verification evidence exists');
select has_table('system', 'outbox_events', 'transactional outbox exists');
select has_table('privacy', 'access_events', 'partitioned access audit exists');

select is(
  (select count(*) from catalog.professional_specialties where status = 'published'),
  6::bigint,
  'the six approved specialties are published'
);
select is(
  (select count(*) from catalog.professional_credential_types where status = 'published'),
  3::bigint,
  'the three approved credential types are published'
);

insert into identity.people (id, given_name, family_name)
values
  ('01991600-0000-7000-8000-000000000001', 'Ada', 'Profile'),
  ('01991600-0000-7000-8000-000000000002', 'Grace', 'Private');

insert into system.outbox_events (aggregate_type, aggregate_id, event_type, payload)
values (
  'professional_profile',
  '01991600-0000-7000-8000-000000000099',
  'identity.professional_profile_updated.v1',
  '{}'::jsonb
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '01991600-0000-7000-8000-000000000001', true);

select throws_ok(
  $$ insert into identity.professional_profiles (person_id, headline, bio, practice_started_year) values ('01991600-0000-7000-8000-000000000001', 'Forged', 'Forbidden', 2020) $$,
  '42501',
  null,
  'runtime cannot insert profiles directly'
);
select throws_ok(
  $$ insert into identity.professional_credentials (professional_profile_id, credential_type_code, issuer, name) values ('01991600-0000-7000-8000-000000000099', 'academic_degree', 'Forged', 'Forbidden') $$,
  '42501',
  null,
  'runtime cannot insert credentials directly'
);
select ok(
  not has_table_privilege('allfit_api', 'identity.professional_credential_verifications', 'SELECT'),
  'runtime cannot read credential verification evidence directly'
);
select ok(
  not has_table_privilege('allfit_api', 'privacy.access_events', 'INSERT'),
  'runtime cannot forge access audit rows'
);

create temporary table test_profile_result as
select *
from identity.put_professional_profile(
  '01991600-0000-7000-8000-000000000001',
  'Entrenadora de fuerza',
  'Acompaño procesos de fuerza con progresiones sostenibles.',
  2018,
  array['personal_training', 'strength_conditioning'],
  '31111111-1111-4111-8111-111111111111',
  '01991600-0000-7111-8111-111111111111',
  decode(repeat('11', 32), 'hex')
);

select is(
  (select profile ->> 'headline' from test_profile_result),
  'Entrenadora de fuerza',
  'profile is created atomically'
);
select is(
  jsonb_array_length((select profile -> 'specialties' from test_profile_result)),
  2,
  'published specialties are attached atomically'
);

select throws_ok(
  $$
    select * from identity.put_professional_profile(
      '01991600-0000-7000-8000-000000000001', 'Futuro', 'No permitido', 2100,
      array['personal_training'], '31111111-1111-4111-8111-111111111112',
      '01991600-0000-7111-8111-111111111112', decode(repeat('12', 32), 'hex')
    )
  $$,
  '22023',
  null,
  'future practice years are rejected'
);
select throws_ok(
  $$
    select * from identity.put_professional_profile(
      '01991600-0000-7000-8000-000000000001', 'Código', 'No permitido', 2020,
      array['unknown_specialty'], '31111111-1111-4111-8111-111111111113',
      '01991600-0000-7111-8111-111111111113', decode(repeat('13', 32), 'hex')
    )
  $$,
  '22023',
  null,
  'unknown or unpublished specialties are rejected'
);
select throws_ok(
  $$
    select * from identity.put_professional_profile(
      '01991600-0000-7000-8000-000000000001', 'Duplicado', 'No permitido', 2020,
      array['personal_training', 'personal_training'], '31111111-1111-4111-8111-111111111114',
      '01991600-0000-7111-8111-111111111114', decode(repeat('14', 32), 'hex')
    )
  $$,
  '22023',
  null,
  'duplicate specialties are rejected'
);

select is(
  (select profile ->> 'id' from identity.put_professional_profile(
    '01991600-0000-7000-8000-000000000001',
    'Entrenadora de fuerza',
    'Acompaño procesos de fuerza con progresiones sostenibles.',
    2018,
    array['personal_training', 'strength_conditioning'],
    '31111111-1111-4111-8111-111111111111',
    '01991600-0000-7111-8111-111111111111',
    decode(repeat('11', 32), 'hex')
  )),
  (select profile ->> 'id' from test_profile_result),
  'an idempotent replay returns the same profile resource'
);
select is(
  (select profile ->> 'id' from identity.put_professional_profile(
    '01991600-0000-7000-8000-000000000001',
    'Entrenadora de fuerza',
    'Acompaño procesos de fuerza con progresiones sostenibles.',
    2018,
    array['personal_training', 'strength_conditioning'],
    '31111111-1111-4111-8111-111111111115',
    '01991600-0000-7111-8111-111111111115',
    decode(repeat('15', 32), 'hex')
  )),
  (select profile ->> 'id' from test_profile_result),
  'an identical command with a new identity preserves the same profile'
);

reset role;
select is(
  (
    select count(*)
    from system.outbox_events
    where event_type = 'identity.professional_profile_updated.v1'
      and aggregate_type = 'professional_profile'
      and aggregate_id = (select (profile ->> 'id')::uuid from test_profile_result)
  ),
  1::bigint,
  'a replay or identical content does not emit another event for the profile under test'
);

insert into organizations.organizations (
  id,
  type_code,
  display_name,
  status,
  responsible_party
) values
  (
    '01991600-0000-7000-8000-000000000101',
    'gym',
    'Active Gym',
    'active',
    '{"party_kind":"natural_person","party_name":"Grace Private","purpose":"studio_operations"}'::jsonb
  ),
  (
    '01991600-0000-7000-8000-000000000111',
    'studio',
    'Closed Studio',
    'closed',
    '{"party_kind":"natural_person","party_name":"Grace Private","purpose":"studio_operations"}'::jsonb
  );

insert into organizations.organization_memberships (
  id,
  organization_id,
  person_id,
  status,
  joined_at,
  ended_at
) values
  (
    '01991600-0000-7000-8000-000000000102',
    '01991600-0000-7000-8000-000000000101',
    '01991600-0000-7000-8000-000000000002',
    'active',
    '2025-01-01T00:00:00Z',
    null
  ),
  (
    '01991600-0000-7000-8000-000000000103',
    '01991600-0000-7000-8000-000000000101',
    '01991600-0000-7000-8000-000000000001',
    'active',
    '2025-02-01T00:00:00Z',
    null
  ),
  (
    '01991600-0000-7000-8000-000000000112',
    '01991600-0000-7000-8000-000000000111',
    '01991600-0000-7000-8000-000000000001',
    'terminated',
    '2024-01-01T00:00:00Z',
    '2025-06-01T00:00:00Z'
  );

insert into organizations.membership_roles (membership_id, role_code, valid_from, valid_to)
values
  ('01991600-0000-7000-8000-000000000102', 'owner', '2025-01-01T00:00:00Z', null),
  (
    '01991600-0000-7000-8000-000000000102',
    'coach',
    clock_timestamp() - interval '1 year',
    clock_timestamp() + interval '1 year'
  ),
  ('01991600-0000-7000-8000-000000000103', 'coach', '2025-02-01T00:00:00Z', null),
  ('01991600-0000-7000-8000-000000000112', 'admin', '2024-01-01T00:00:00Z', '2024-12-01T00:00:00Z'),
  ('01991600-0000-7000-8000-000000000112', 'staff', '2024-01-01T00:00:00Z', '2025-06-01T00:00:00Z'),
  ('01991600-0000-7000-8000-000000000112', 'coach', '2025-07-01T00:00:00Z', null);

set local role allfit_api;

create temporary table test_credential_result as
select *
from identity.declare_professional_credential(
  '01991600-0000-7000-8000-000000000001',
  'professional_certification',
  'NSCA',
  'Certified Strength and Conditioning Specialist',
  'CSCS-123',
  '2020-01-01',
  '2028-01-01',
  'https://example.test/cscs-123',
  '32222222-2222-4222-8222-222222222221',
  '01991600-0000-7222-8222-222222222221',
  decode(repeat('21', 32), 'hex')
);

select is(
  (select credential #>> '{verification,state}' from test_credential_result),
  'unverified',
  'a declared credential starts unverified'
);

reset role;
insert into identity.professional_credential_verifications (
  professional_credential_id,
  verifier_person_id,
  policy_code,
  method,
  source_authority,
  source_jurisdiction,
  source_reference,
  source_status,
  source_checked_at,
  source_valid_to,
  evidence_fingerprint,
  result,
  valid_from,
  valid_to
) values (
  (select (credential ->> 'id')::uuid from test_credential_result),
  '01991600-0000-7000-8000-000000000001',
  'professional_credential.registry.v1',
  'official_registry_lookup',
  'Internal authority',
  'CO',
  'SECRET-REFERENCE',
  'active',
  '2026-08-08T12:00:00Z',
  '2027-03-01T00:00:00Z',
  decode(repeat('91', 32), 'hex'),
  'verified',
  '2026-08-01T00:00:00Z',
  '2027-02-01T00:00:00Z'
);

select is(
  identity.professional_credential_projection(
    (select (credential ->> 'id')::uuid from test_credential_result)
  ) #>> '{verification,state}',
  'verified',
  'the owner projection carries verification state without exposing evidence'
);

set local role allfit_api;

create temporary table test_revision_result as
select *
from identity.revise_professional_credential(
  '01991600-0000-7000-8000-000000000001',
  (select (credential ->> 'id')::uuid from test_credential_result),
  'professional_certification',
  'NSCA',
  'Certified Strength and Conditioning Specialist',
  'CSCS-456',
  '2024-01-01',
  '2030-01-01',
  'https://example.test/cscs-456',
  '32222222-2222-4222-8222-222222222222',
  '01991600-0000-7222-8222-222222222222',
  decode(repeat('22', 32), 'hex')
);

select is(
  (select credential ->> 'supersedes_credential_id' from test_revision_result),
  (select credential ->> 'id' from test_credential_result),
  'revision creates one linked successor'
);
select is(
  (
    select status::text
    from identity.professional_credentials
    where id = (select (credential ->> 'id')::uuid from test_credential_result)
  ),
  'retired',
  'revision retires the prior version atomically'
);
select is(
  (select credential #>> '{verification,state}' from test_revision_result),
  'unverified',
  'a revision never inherits verification'
);

select set_config('app.actor_person_id', '01991600-0000-7000-8000-000000000002', true);
select is_empty(
  $$ select id from identity.professional_profiles $$,
  'another person cannot read the profile'
);
select is_empty(
  $$ select id from identity.professional_credentials $$,
  'another person cannot read credentials'
);

select set_config('app.actor_person_id', '01991600-0000-7000-8000-000000000001', true);
create temporary table test_me as
select identity.get_my_professional_context(
  '01991600-0000-7000-8000-000000000001',
  '33333333-3333-4333-8333-333333333333'
) as body;

select is(
  jsonb_array_length((select body -> 'memberships' from test_me)),
  2,
  'the consolidated projection includes active and terminated memberships'
);
select is(
  (select body #>> '{memberships,0,status}' from test_me),
  'active',
  'active memberships are projected before history'
);
select ok(
  (select body #> '{memberships,0,roles}' from test_me) ? 'coach',
  'active memberships include roles whose validity window is still open'
);
select is(
  (select body #>> '{memberships,0,roles,0}' from test_me),
  'coach',
  'active memberships project currently effective roles'
);
select is(
  (select body #>> '{memberships,1,display_name}' from test_me),
  'Closed Studio',
  'terminated memberships remain visible when the organization is closed'
);
select is(
  (select body #>> '{memberships,1,roles,0}' from test_me),
  'staff',
  'terminated memberships project only roles effective at termination'
);

select set_config('app.actor_person_id', '01991600-0000-7000-8000-000000000002', true);
select throws_ok(
  $$
    select identity.get_my_professional_context(
      '01991600-0000-7000-8000-000000000001',
      '33333333-3333-4333-8333-333333333334'
    )
  $$,
  '42501',
  null,
  'another person cannot read professional membership history'
);
select set_config('app.actor_person_id', '01991600-0000-7000-8000-000000000001', true);

select ok(
  (
    select bool_and(
      not (credential -> 'verification') ?| array['source_authority', 'source_reference', 'evidence_fingerprint']
      and credential::text not like '%SECRET-REFERENCE%'
    )
    from jsonb_array_elements((select body #> '{profile,credentials}' from test_me)) as credential
  ),
  'the consolidated projection never exposes verification evidence'
);

reset role;
select is(
  (
    select count(*)
    from privacy.access_events
    where actor_person_id = '01991600-0000-7000-8000-000000000001'
      and request_id = '33333333-3333-4333-8333-333333333333'
  ),
  1::bigint,
  'GET me records an allowed access event before returning'
);

set local role allfit_api;
select throws_ok(
  $$ select identity.get_my_professional_context('01991600-0000-7000-8000-000000000001', null) $$,
  '22023',
  null,
  'an audit failure prevents the consolidated read'
);

reset role;
select is(
  (
    select count(*)
    from system.outbox_events
    where payload ?| array['headline', 'bio', 'issuer', 'name', 'identifier']
  ),
  0::bigint,
  'outbox payloads omit professional PII fields'
);

select * from finish();
rollback;
