-- T-REL-RLS-02 — HU-STUDIO-087: counting what occupies a gym's places.
--
-- A coach holds `invite_clients` and not `view_directory`, so the ordinary read
-- policy narrows a coach to assigned relationships. Counted under that policy the
-- quota would be silently bypassed by the very role that invites most clients.
--
-- The counting policy is not keyed to a capability. It admits the rows of ONE
-- organization, and only while a transaction-local setting names that
-- organization, which only the occupancy function sets, around its own count.
-- Each half is asserted: the rows it opens, and every way it must stay shut.

begin;

select plan(11);

insert into identity.people (id, given_name, family_name, status)
values
  ('019af000-0000-7000-8000-000000000001', 'Client', 'One', 'active'),
  ('019af000-0000-7000-8000-000000000002', 'Client', 'Two', 'active'),
  ('019af000-0000-7000-8000-000000000003', 'Client', 'Three', 'active'),
  ('019af000-0000-7000-8000-000000000011', 'Coach', 'Unassigned', 'active'),
  ('019af000-0000-7000-8000-000000000012', 'Coach', 'Assigned', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019af000-0000-7000-8000-000000000101', 'gym', 'Count Ours',
    '{"party_kind":"legal_entity","party_name":"Ours SAS","purpose":"studio_operations"}'),
  ('019af000-0000-7000-8000-000000000102', 'gym', 'Count Theirs',
    '{"party_kind":"legal_entity","party_name":"Theirs SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019af000-0000-7000-8000-000000000201', '019af000-0000-7000-8000-000000000101',
    '019af000-0000-7000-8000-000000000011', 'active'),
  ('019af000-0000-7000-8000-000000000202', '019af000-0000-7000-8000-000000000101',
    '019af000-0000-7000-8000-000000000012', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values
  ('019af000-0000-7000-8000-000000000201', 'coach'),
  ('019af000-0000-7000-8000-000000000202', 'coach');

-- Two clients of our gym and one of the other, so a count can be wrong both ways.
insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019af000-0000-7000-8000-000000000301', '019af000-0000-7000-8000-000000000001',
    '019af000-0000-7000-8000-000000000101', 'active'),
  ('019af000-0000-7000-8000-000000000302', '019af000-0000-7000-8000-000000000002',
    '019af000-0000-7000-8000-000000000101', 'active'),
  ('019af000-0000-7000-8000-000000000303', '019af000-0000-7000-8000-000000000003',
    '019af000-0000-7000-8000-000000000102', 'active');
insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status
) values (
  '019af000-0000-7000-8000-000000000401', '019af000-0000-7000-8000-000000000301',
  '019af000-0000-7000-8000-000000000001', '019af000-0000-7000-8000-000000000101',
  '019af000-0000-7000-8000-000000000202', 'holder', 'active'
);

-- Read as the table owner: it is the role the security definer functions run as.
set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000011', true),
       set_config('app.actor_org_id', '019af000-0000-7000-8000-000000000101', true);

-- Deny: the setting is unset, so an unassigned coach reads nothing.
select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'with no counting setting an unassigned coach reads no relationship'
);

-- Deny: a setting that is present and empty opens nothing either.
select set_config('app.guest_quota_organization_id', '', true);
select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'an empty counting setting opens nothing'
);

-- Deny: the setting names the other organization, and ours stays shut.
select set_config('app.guest_quota_organization_id', '019af000-0000-7000-8000-000000000102', true);
select is(
  (select count(*) from relationships.service_relationships
   where organization_id = '019af000-0000-7000-8000-000000000101'),
  0::bigint,
  'naming another organization does not open ours'
);

-- Deny: an assigned coach is not widened by a setting naming a different gym.
select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000012', true);
select set_config('app.guest_quota_organization_id', '019af000-0000-7000-8000-000000000102', true);
select is(
  (select count(*) from relationships.service_relationships
   where organization_id = '019af000-0000-7000-8000-000000000101'),
  1::bigint,
  'an assigned coach still reads only the one assigned relationship of ours'
);

-- Allow: naming our organization opens exactly our rows.
select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000011', true);
select set_config('app.guest_quota_organization_id', '019af000-0000-7000-8000-000000000101', true);
select is(
  (select count(*) from relationships.service_relationships
   where organization_id = '019af000-0000-7000-8000-000000000101'),
  2::bigint,
  'naming the organization lets the unassigned coach count all of its relationships'
);

-- Deny: and not one row of anybody else's, while it is open.
select is(
  (select count(*) from relationships.service_relationships
   where organization_id = '019af000-0000-7000-8000-000000000102'),
  0::bigint,
  'the opening is bounded to the one organization it names'
);

-- Deny: the setting is transaction-local and gone once cleared.
select set_config('app.guest_quota_organization_id', '', true);
select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'clearing the setting closes it again'
);

-- Deny: the function that counts leaves the setting the way it found it. Asserted
-- against the real function and not a hand-set value, because that clearing is the
-- only thing keeping a coach directory narrow once a count has run in the same
-- transaction, and the Studio directory does both in one.
select is(
  (select live.occupied
   from organizations.organization_guest_occupancy(
     '019af000-0000-7000-8000-000000000101') as live),
  2,
  'the count itself sees the whole gym while it runs'
);
select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'and the unassigned coach reads nothing again once the count is done'
);

-- Deny: it is declared for select alone, so it can be read through and never written.
select is(
  (select cmd from pg_policies
   where schemaname = 'relationships' and tablename = 'service_relationships'
     and policyname = 'service_relationships_select_guest_quota_count'),
  'SELECT',
  'the counting policy is a select policy and opens no write'
);

-- Deny: the runtime role has no direct read, setting or not.
set local role allfit_api;
select throws_ok(
  'select count(*) from relationships.service_relationships',
  '42501',
  null,
  'the runtime role still cannot read the table directly'
);
reset role;

select * from finish();

rollback;
