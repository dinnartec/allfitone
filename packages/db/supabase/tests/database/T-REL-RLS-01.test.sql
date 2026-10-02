-- T-REL-RLS-01 — OP-REL-010, OP-REL-011.
--
-- Who may read a service relationship. Each rule is asserted twice: once on the
-- actor it admits and once on the actor it must refuse, because a policy tested
-- only on its allow case is a policy nobody has shown to deny anything.
--
-- The distinction that matters is inside the organization. `view_directory`
-- (owner, admin, staff) reads the whole client directory; a coach holds
-- `view_assigned_directory` instead and reads only the relationships it was
-- actually assigned to. A coach of the same organization with no assignment is
-- as refused as a stranger.

begin;

select plan(12);

insert into identity.people (id, given_name, family_name, status)
values
  ('019ac000-0000-7000-8000-000000000001', 'Client', 'One', 'active'),
  ('019ac000-0000-7000-8000-000000000002', 'Client', 'Two', 'active'),
  ('019ac000-0000-7000-8000-000000000011', 'Owner', 'Ours', 'active'),
  ('019ac000-0000-7000-8000-000000000012', 'Coach', 'Assigned', 'active'),
  ('019ac000-0000-7000-8000-000000000013', 'Coach', 'Unassigned', 'active'),
  ('019ac000-0000-7000-8000-000000000014', 'Owner', 'Other', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  (
    '019ac000-0000-7000-8000-000000000101', 'gym', 'Ours',
    '{"party_kind":"legal_entity","party_name":"Ours SAS","purpose":"studio_operations"}'
  ),
  (
    '019ac000-0000-7000-8000-000000000102', 'gym', 'Theirs',
    '{"party_kind":"legal_entity","party_name":"Theirs SAS","purpose":"studio_operations"}'
  );

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019ac000-0000-7000-8000-000000000201', '019ac000-0000-7000-8000-000000000101',
    '019ac000-0000-7000-8000-000000000011', 'active'),
  ('019ac000-0000-7000-8000-000000000202', '019ac000-0000-7000-8000-000000000101',
    '019ac000-0000-7000-8000-000000000012', 'active'),
  ('019ac000-0000-7000-8000-000000000203', '019ac000-0000-7000-8000-000000000101',
    '019ac000-0000-7000-8000-000000000013', 'active'),
  ('019ac000-0000-7000-8000-000000000204', '019ac000-0000-7000-8000-000000000102',
    '019ac000-0000-7000-8000-000000000014', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019ac000-0000-7000-8000-000000000201', 'owner'),
  ('019ac000-0000-7000-8000-000000000202', 'coach'),
  ('019ac000-0000-7000-8000-000000000203', 'coach'),
  ('019ac000-0000-7000-8000-000000000204', 'owner');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019ac000-0000-7000-8000-000000000301', '019ac000-0000-7000-8000-000000000001',
    '019ac000-0000-7000-8000-000000000101', 'active'),
  ('019ac000-0000-7000-8000-000000000302', '019ac000-0000-7000-8000-000000000002',
    '019ac000-0000-7000-8000-000000000101', 'active');

-- Only the first client has a coach put in charge of them.
insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status
) values (
  '019ac000-0000-7000-8000-000000000401',
  '019ac000-0000-7000-8000-000000000301',
  '019ac000-0000-7000-8000-000000000001',
  '019ac000-0000-7000-8000-000000000101',
  '019ac000-0000-7000-8000-000000000202',
  'holder',
  'active'
);

/*
 * Read as the table owner, which is the role every `security definer` read
 * function runs as, and the role `force row level security` subjects to the
 * policy. Reading as the superuser that owns the test session would bypass RLS
 * entirely and quietly assert nothing.
 */
set local role allfit_owner;

-- A person reads their own relationship and no one else's.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000001', true);

select is(
  (select count(*) from relationships.service_relationships),
  1::bigint,
  'the person sees their own relationship'
);
select is(
  (select person_id from relationships.service_relationships),
  '019ac000-0000-7000-8000-000000000001'::uuid,
  'and it is theirs, not the other client of the same gym'
);

-- The owner holds view_directory, so the whole client directory is readable.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000011', true),
       set_config('app.actor_org_id', '019ac000-0000-7000-8000-000000000101', true);

select is(
  (select count(*) from relationships.service_relationships),
  2::bigint,
  'the owner reads every client of their organization'
);

-- The assigned coach reads the one relationship they were given, and not the
-- other client of the same organization.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000012', true),
       set_config('app.actor_org_id', '019ac000-0000-7000-8000-000000000101', true);

select is(
  (select count(*) from relationships.service_relationships),
  1::bigint,
  'the assigned coach reads only what they were assigned'
);
select is(
  (select id from relationships.service_relationships),
  '019ac000-0000-7000-8000-000000000301'::uuid,
  'and it is the relationship of their own client'
);

-- The refusal that matters most: a coach of this very organization, with a live
-- membership and the coach role, who was never assigned to anyone.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000013', true),
       set_config('app.actor_org_id', '019ac000-0000-7000-8000-000000000101', true);

select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'an unassigned coach of the same organization reads nothing'
);

-- Another organization's owner, even though the person is a client elsewhere.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000014', true),
       set_config('app.actor_org_id', '019ac000-0000-7000-8000-000000000102', true);

select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'another organization reads none of ours'
);

-- Claiming our organization without a membership in it changes nothing: the
-- capability check resolves against the database, not against what was claimed.
select set_config('app.actor_org_id', '019ac000-0000-7000-8000-000000000101', true);

select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'and claiming our organization id does not grant it the directory'
);

-- No actor at all.
select set_config('app.actor_kind', '', true),
       set_config('app.actor_person_id', '', true),
       set_config('app.actor_org_id', '', true);

select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'without an actor the table is closed, not open'
);

-- Assignments follow the relationship they belong to.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000012', true),
       set_config('app.actor_org_id', '019ac000-0000-7000-8000-000000000101', true);

select is(
  (select count(*) from relationships.relationship_professional_assignments),
  1::bigint,
  'the assigned coach reads their own assignment'
);

select set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000013', true);

select is(
  (select count(*) from relationships.relationship_professional_assignments),
  0::bigint,
  'and the unassigned coach reads no assignment either'
);

-- The runtime role reaches these tables only through security definer
-- functions. It holds no grant of its own, so a direct read is refused before
-- any policy is consulted.
set local role allfit_api;
select throws_ok(
  'select count(*) from relationships.service_relationships',
  '42501',
  null,
  'the runtime role cannot read the table directly'
);
reset role;

select * from finish();

rollback;
