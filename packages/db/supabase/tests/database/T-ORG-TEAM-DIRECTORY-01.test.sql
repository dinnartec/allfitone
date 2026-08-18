begin;

select plan(27);

insert into identity.people (id, given_name, family_name)
values
  ('0199d000-0000-7000-8000-000000000001', 'Zeta', 'Owner'),
  ('0199d000-0000-7000-8000-000000000002', 'Alpha', 'Admin'),
  ('0199d000-0000-7000-8000-000000000003', 'Charlie', 'Staff'),
  ('0199d000-0000-7000-8000-000000000004', 'Bravo', 'Coach'),
  ('0199d000-0000-7000-8000-000000000005', 'Delta', 'Former'),
  ('0199d000-0000-7000-8000-000000000006', 'Oscar', 'Outsider'),
  ('0199d000-0000-7000-8000-000000000007', 'Echo', 'Invitee');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000001', true);

create temporary table team_directory_organization as
select *
from organizations.create_organization(
  '0199d000-0000-7000-8000-000000000001',
  'Team Directory Gym',
  'gym',
  'natural_person',
  'Zeta Owner',
  'd1111111-1111-4111-8111-111111111111',
  '0199d000-0000-7000-8000-000000000101',
  decode(repeat('d1', 32), 'hex')
);

reset role;

insert into organizations.organization_memberships (
  id, organization_id, person_id, status, joined_at, ended_at
)
select '0199d000-0000-7000-8000-000000000202'::uuid, organization_id,
       '0199d000-0000-7000-8000-000000000002'::uuid,
       'active'::organizations.membership_status,
       '2026-02-01T12:00:00Z'::timestamptz, null::timestamptz
from team_directory_organization
union all
select '0199d000-0000-7000-8000-000000000203'::uuid, organization_id,
       '0199d000-0000-7000-8000-000000000003'::uuid,
       'active'::organizations.membership_status,
       '2026-03-01T12:00:00Z'::timestamptz, null::timestamptz
from team_directory_organization
union all
select '0199d000-0000-7000-8000-000000000204'::uuid, organization_id,
       '0199d000-0000-7000-8000-000000000004'::uuid,
       'active'::organizations.membership_status,
       '2026-04-01T12:00:00Z'::timestamptz, null::timestamptz
from team_directory_organization
union all
select '0199d000-0000-7000-8000-000000000205'::uuid, organization_id,
       '0199d000-0000-7000-8000-000000000005'::uuid,
       'terminated'::organizations.membership_status,
       '2026-01-01T12:00:00Z'::timestamptz, '2026-06-01T12:00:00Z'::timestamptz
from team_directory_organization;

insert into organizations.membership_roles (membership_id, role_code, valid_from, valid_to)
values
  ('0199d000-0000-7000-8000-000000000202', 'admin', '2026-02-01T12:00:00Z', null),
  ('0199d000-0000-7000-8000-000000000203', 'staff', '2026-03-01T12:00:00Z', null),
  ('0199d000-0000-7000-8000-000000000204', 'coach', '2026-04-01T12:00:00Z', null),
  ('0199d000-0000-7000-8000-000000000205', 'coach', '2026-01-01T12:00:00Z', '2026-06-01T12:00:00Z');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000006', true);

create temporary table outsider_organization as
select *
from organizations.create_organization(
  '0199d000-0000-7000-8000-000000000006',
  'Other Organization',
  'studio',
  'natural_person',
  'Oscar Outsider',
  'd2222222-2222-4222-8222-222222222222',
  '0199d000-0000-7000-8000-000000000102',
  decode(repeat('d2', 32), 'hex')
);

reset role;

select is(
  (select count(*) from organizations.organization_capabilities),
  22::bigint,
  'the governed V1 capability catalogue has exactly 22 entries'
);

select is(
  (select count(*) from organizations.role_capabilities),
  41::bigint,
  'the governed V1 role mapping is fully materialized'
);

select results_eq(
  $$
    select code
    from organizations.organization_roles
    order by case code when 'owner' then 1 when 'admin' then 2 when 'coach' then 3 else 4 end
  $$,
  $$ values ('owner'::text), ('admin'::text), ('coach'::text), ('staff'::text) $$,
  'the role catalogue remains closed to exactly four roles'
);

select results_eq(
  $$
    select capability_code
    from organizations.role_capabilities
    where role_code = 'staff'
    order by capability_code
  $$,
  $$ values ('invite'::text), ('invite_clients'::text), ('view_directory'::text) $$,
  'staff receives only invitation and non-fitness directory capabilities'
);

select results_eq(
  $$
    select capability_code
    from organizations.role_capabilities
    where role_code = 'coach'
    order by capability_code
  $$,
  $$ values
    ('assign_programs'::text),
    ('exercise_grants'::text),
    ('guide_nutrition'::text),
    ('invite_clients'::text),
    ('manage_content'::text),
    ('observe_training'::text),
    ('propose_corrections'::text),
    ('view_assigned_directory'::text)
  $$,
  'coach receives the complete conditional professional capability set'
);

select is(
  (
    select count(*)
    from organizations.role_capabilities as admin_capability
    where admin_capability.role_code = 'admin'
      and not exists (
        select 1
        from organizations.role_capabilities as owner_capability
        where owner_capability.role_code = 'owner'
          and owner_capability.capability_code = admin_capability.capability_code
      )
  ),
  0::bigint,
  'owner materializes every admin capability'
);

select ok(
  (select name from organizations.organization_capabilities where code = 'guide_nutrition')
    like '%credencial verificada%',
  'nutrition guidance states its credential requirement'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000001', true);

select is(
  (
    select count(*)
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000001',
      (select organization_id from team_directory_organization),
      null, 51, null, null, null
    )
  ),
  5::bigint,
  'owner can list active and terminated team memberships'
);

select results_eq(
  $$
    select display_name
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000001',
      (select organization_id from team_directory_organization),
      null, 51, null, null, null
    )
  $$,
  $$ values
    ('Alpha Admin'::text),
    ('Bravo Coach'::text),
    ('Charlie Staff'::text),
    ('Zeta Owner'::text),
    ('Delta Former'::text)
  $$,
  'team order is active first, then normalized display name, then terminated'
);

select is(
  (
    select count(*)
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000001',
      (select organization_id from team_directory_organization),
      'active', 51, null, null, null
    )
  ),
  4::bigint,
  'active status filter returns only active memberships'
);

select is(
  (
    select count(*)
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000001',
      (select organization_id from team_directory_organization),
      'terminated', 51, null, null, null
    )
  ),
  1::bigint,
  'terminated status filter returns only membership history'
);

select is(
  (
    select roles
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000001',
      (select organization_id from team_directory_organization),
      'terminated', 51, null, null, null
    )
  ),
  array['coach']::text[],
  'a terminated membership exposes roles effective at termination'
);

select results_eq(
  $$
    with first_page as (
      select *
      from organizations.list_organization_memberships(
        '0199d000-0000-7000-8000-000000000001',
        (select organization_id from team_directory_organization),
        null, 2, null, null, null
      )
    )
    select display_name from first_page
  $$,
  $$ values ('Alpha Admin'::text), ('Bravo Coach'::text) $$,
  'the first keyset page is stable'
);

select results_eq(
  $$
    select display_name
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000001',
      (select organization_id from team_directory_organization),
      null, 3, 'active', 'bravo coach', '0199d000-0000-7000-8000-000000000204'
    )
  $$,
  $$ values ('Charlie Staff'::text), ('Zeta Owner'::text), ('Delta Former'::text) $$,
  'the next keyset page continues without duplicates or omissions'
);

select is(
  (
    select count(*)
    from jsonb_object_keys(to_jsonb(team_row)) as field(key)
    where field.key in (
      'person_id', 'contact_email', 'contact_phone', 'fitness_id',
      'professional_profile', 'client_status'
    )
  ),
  0::bigint,
  'the database projection contains no personal contact, client, or fitness fields'
)
from organizations.list_organization_memberships(
  '0199d000-0000-7000-8000-000000000001',
  (select organization_id from team_directory_organization),
  null, 1, null, null, null
) as team_row;

select is(
  (
    select count(distinct role_code)
    from organizations.list_organization_roles(
      '0199d000-0000-7000-8000-000000000001',
      (select organization_id from team_directory_organization)
    )
  ),
  4::bigint,
  'an active owner can read all four role definitions'
);

select throws_ok(
  format(
    'select * from organizations.list_organization_memberships(%L, %L, %L, 51, null, null, null)',
    '0199d000-0000-7000-8000-000000000001',
    (select organization_id from team_directory_organization),
    'suspended'
  ),
  '22023', null,
  'the database rejects an unknown membership status'
);

select throws_ok(
  format(
    'select * from organizations.list_organization_memberships(%L, %L, null, 51, %L, null, null)',
    '0199d000-0000-7000-8000-000000000001',
    (select organization_id from team_directory_organization),
    'active'
  ),
  '22023', null,
  'the database rejects a partial keyset cursor'
);

select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000002', true);
select is(
  (
    select count(*)
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000002',
      (select organization_id from team_directory_organization),
      null, 51, null, null, null
    )
  ),
  5::bigint,
  'admin can list the team through manage_memberships'
);

select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000003', true);
select is(
  (
    select count(*)
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000003',
      (select organization_id from team_directory_organization),
      null, 51, null, null, null
    )
  ),
  5::bigint,
  'staff can list the team through view_directory'
);

select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000004', true);
select throws_ok(
  format(
    'select * from organizations.list_organization_memberships(%L, %L, null, 51, null, null, null)',
    '0199d000-0000-7000-8000-000000000004',
    (select organization_id from team_directory_organization)
  ),
  '42501', null,
  'coach without a directory role cannot list the organization team'
);

select is(
  (
    select count(distinct role_code)
    from organizations.list_organization_roles(
      '0199d000-0000-7000-8000-000000000004',
      (select organization_id from team_directory_organization)
    )
  ),
  4::bigint,
  'coach can still consult the role catalogue'
);

select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000005', true);
select throws_ok(
  format(
    'select * from organizations.list_organization_roles(%L, %L)',
    '0199d000-0000-7000-8000-000000000005',
    (select organization_id from team_directory_organization)
  ),
  '42501', null,
  'a terminated member cannot consult the role catalogue'
);

select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000006', true);
select throws_ok(
  format(
    'select * from organizations.list_organization_memberships(%L, %L, null, 51, null, null, null)',
    '0199d000-0000-7000-8000-000000000006',
    (select organization_id from team_directory_organization)
  ),
  '42501', null,
  'an outsider cannot list another organization team'
);

select throws_ok(
  $$
    select * from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000006',
      '0199d000-0000-7000-8000-000000000999',
      null, 51, null, null, null
    )
  $$,
  '42501', null,
  'an unknown organization fails with the same SQL state as an inaccessible one'
);

select throws_ok(
  $$
    select * from organizations.list_organization_roles(
      '0199d000-0000-7000-8000-000000000006',
      '0199d000-0000-7000-8000-000000000999'
    )
  $$,
  '42501', null,
  'the role catalogue also hides unknown and inaccessible organizations'
);

select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000001', true);

create temporary table accepted_team_invitation as
select * from identity.issue_staff_invitation(
  '0199d000-0000-7000-8000-000000000001',
  (select organization_id from team_directory_organization),
  'email', 'echo@example.test', 'staff', decode(repeat('31', 32), 'hex'), 1::smallint,
  'd3333333-3333-4333-8333-333333333333',
  '0199d000-0000-7000-8000-000000000103',
  decode(repeat('d3', 32), 'hex')
);

select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000007', true);
select set_config('app.actor_verified_email', 'echo@example.test', true);

select *
from identity.decide_staff_invitation(
  '0199d000-0000-7000-8000-000000000007',
  decode(repeat('31', 32), 'hex'),
  (select invitation_intent_id from accepted_team_invitation),
  'accepted',
  'd4444444-4444-4444-8444-444444444444',
  '0199d000-0000-7000-8000-000000000104',
  decode(repeat('d4', 32), 'hex')
);

select set_config('app.actor_person_id', '0199d000-0000-7000-8000-000000000001', true);
select is(
  (
    select count(*)
    from organizations.list_organization_memberships(
      '0199d000-0000-7000-8000-000000000001',
      (select organization_id from team_directory_organization),
      null, 51, null, null, null
    )
    where display_name = 'Echo Invitee'
      and status = 'active'
      and roles = array['staff']::text[]
  ),
  1::bigint,
  'an accepted invitation appears immediately as an active team membership'
);

reset role;
select * from finish();
rollback;
