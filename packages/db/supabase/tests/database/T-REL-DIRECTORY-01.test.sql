-- T-REL-DIRECTORY-01 — OP-REL-010.
--
-- The client directory through the function the API will call, which is where
-- the row policy actually bites: the same query returns every client to an
-- owner and only the assigned ones to a coach, without the function knowing the
-- difference.

begin;

select plan(9);

insert into identity.people (id, given_name, family_name, status)
values
  ('019ad000-0000-7000-8000-000000000001', 'Ana', 'Alvarez', 'active'),
  ('019ad000-0000-7000-8000-000000000002', 'Bruno', 'Bello', 'active'),
  ('019ad000-0000-7000-8000-000000000003', 'Carla', 'Castro', 'active'),
  ('019ad000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019ad000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active'),
  ('019ad000-0000-7000-8000-000000000013', 'Sara', 'Staff', 'active'),
  ('019ad000-0000-7000-8000-000000000015', 'Diana', 'Coach', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019ad000-0000-7000-8000-000000000101', 'gym', 'Directory Gym',
  '{"party_kind":"legal_entity","party_name":"Directory SAS","purpose":"studio_operations"}'
);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019ad000-0000-7000-8000-000000000201', '019ad000-0000-7000-8000-000000000101',
    '019ad000-0000-7000-8000-000000000011', 'active'),
  ('019ad000-0000-7000-8000-000000000202', '019ad000-0000-7000-8000-000000000101',
    '019ad000-0000-7000-8000-000000000012', 'active'),
  ('019ad000-0000-7000-8000-000000000203', '019ad000-0000-7000-8000-000000000101',
    '019ad000-0000-7000-8000-000000000013', 'active'),
  ('019ad000-0000-7000-8000-000000000205', '019ad000-0000-7000-8000-000000000101',
    '019ad000-0000-7000-8000-000000000015', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019ad000-0000-7000-8000-000000000201', 'owner'),
  ('019ad000-0000-7000-8000-000000000202', 'coach'),
  ('019ad000-0000-7000-8000-000000000203', 'staff'),
  ('019ad000-0000-7000-8000-000000000205', 'coach');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019ad000-0000-7000-8000-000000000301', '019ad000-0000-7000-8000-000000000001',
    '019ad000-0000-7000-8000-000000000101', 'active'),
  ('019ad000-0000-7000-8000-000000000302', '019ad000-0000-7000-8000-000000000002',
    '019ad000-0000-7000-8000-000000000101', 'active'),
  ('019ad000-0000-7000-8000-000000000303', '019ad000-0000-7000-8000-000000000003',
    '019ad000-0000-7000-8000-000000000101', 'terminated');

-- Camilo holds Ana as titular and stands in for Diana on Bruno, a cover the
-- person accepted. Carla is nobody's.
--
-- Diana exists because a cover stands in for somebody: a substitution on a
-- relationship with no holder is a state `OP-REL-004` refuses to create, so a
-- fixture with one was describing something the product cannot produce.
insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id,
  covers_membership_id, kind, status, valid_from, ends_on, accepted_by_person_at
) values
  ('019ad000-0000-7000-8000-000000000401', '019ad000-0000-7000-8000-000000000301',
    '019ad000-0000-7000-8000-000000000001', '019ad000-0000-7000-8000-000000000101',
    '019ad000-0000-7000-8000-000000000202', null, 'holder', 'active',
    clock_timestamp() - interval '30 days', null, null),
  ('019ad000-0000-7000-8000-000000000403', '019ad000-0000-7000-8000-000000000302',
    '019ad000-0000-7000-8000-000000000002', '019ad000-0000-7000-8000-000000000101',
    '019ad000-0000-7000-8000-000000000205', null, 'holder', 'active',
    clock_timestamp() - interval '40 days', null, null),
  ('019ad000-0000-7000-8000-000000000402', '019ad000-0000-7000-8000-000000000302',
    '019ad000-0000-7000-8000-000000000002', '019ad000-0000-7000-8000-000000000101',
    '019ad000-0000-7000-8000-000000000202',
    '019ad000-0000-7000-8000-000000000205', 'substitute', 'active',
    clock_timestamp() - interval '10 days',
    (clock_timestamp() + interval '30 days')::date, clock_timestamp() - interval '10 days');

set local role allfit_owner;

-- The owner reads the whole directory, terminated relationships included.
-- Only the person is declared. The function sets the organization itself,
-- exactly as the API does; setting it here would test a path no caller takes.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000011', true);

select is(
  (select count(*) from relationships.list_organization_clients(
    '019ad000-0000-7000-8000-000000000011', '019ad000-0000-7000-8000-000000000101',
    null, 50, null, null, null)),
  3::bigint,
  'the owner reads every client of the organization'
);

select is(
  (select array_agg(display_name order by sort_name)
     from relationships.list_organization_clients(
       '019ad000-0000-7000-8000-000000000011', '019ad000-0000-7000-8000-000000000101',
       'active', 50, null, null, null)),
  array['Ana Alvarez', 'Bruno Bello'],
  'filtering by status returns only the active ones'
);

-- Staff reads the directory too: names and link state, never fitness data.
select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000013', true);

select is(
  (select count(*) from relationships.list_organization_clients(
    '019ad000-0000-7000-8000-000000000013', '019ad000-0000-7000-8000-000000000101',
    null, 50, null, null, null)),
  3::bigint,
  'staff reads the whole directory as well'
);

-- The coach runs the same function and the policy narrows it: the client they
-- hold and the one they stand in for, not the third.
select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000012', true);

select is(
  (select count(*) from relationships.list_organization_clients(
    '019ad000-0000-7000-8000-000000000012', '019ad000-0000-7000-8000-000000000101',
    null, 50, null, null, null)),
  2::bigint,
  'the coach reads only the clients they were assigned'
);

select is(
  (select array_agg(display_name order by sort_name)
     from relationships.list_organization_clients(
       '019ad000-0000-7000-8000-000000000012', '019ad000-0000-7000-8000-000000000101',
       null, 50, null, null, null)),
  array['Ana Alvarez', 'Bruno Bello'],
  'as holder for one and as accepted substitute for the other'
);

-- A substitution that ended stops showing its client, without touching the
-- relationship itself.
update relationships.relationship_professional_assignments
  set status = 'ended', valid_to = clock_timestamp() - interval '1 day'
  where id = '019ad000-0000-7000-8000-000000000402';

select is(
  (select count(*) from relationships.list_organization_clients(
    '019ad000-0000-7000-8000-000000000012', '019ad000-0000-7000-8000-000000000101',
    null, 50, null, null, null)),
  1::bigint,
  'and loses the substituted client once the substitution ends'
);

-- A member with no directory capability at all is refused before any row is
-- considered, rather than handed an empty page that looks like no clients.
insert into identity.people (id, given_name, family_name, status)
values ('019ad000-0000-7000-8000-000000000014', 'Nadie', 'Nada', 'active');
insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019ad000-0000-7000-8000-000000000204', '019ad000-0000-7000-8000-000000000101',
  '019ad000-0000-7000-8000-000000000014', 'active');

select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000014', true);

select throws_ok(
  $$select * from relationships.list_organization_clients(
    '019ad000-0000-7000-8000-000000000014', '019ad000-0000-7000-8000-000000000101',
    null, 50, null, null, null)$$,
  '42501',
  'client directory requires a directory capability',
  'a member with no directory capability is refused, not given an empty page'
);

-- Acting for someone else is refused whatever the caller holds.
select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000011', true);

select throws_ok(
  $$select * from relationships.list_organization_clients(
    '019ad000-0000-7000-8000-000000000012', '019ad000-0000-7000-8000-000000000101',
    null, 50, null, null, null)$$,
  '42501',
  'person actor mismatch',
  'the owner cannot run the directory as the coach'
);

select throws_ok(
  $$select * from relationships.list_organization_clients(
    '019ad000-0000-7000-8000-000000000011', '019ad000-0000-7000-8000-000000000101',
    null, 500, null, null, null)$$,
  '22023',
  'invalid page limit',
  'an unbounded page is refused'
);

select * from finish();

rollback;
