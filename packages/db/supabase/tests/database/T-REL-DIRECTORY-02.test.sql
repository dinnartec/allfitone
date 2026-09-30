-- T-REL-DIRECTORY-02 — OP-REL-010, the unanswered half.
--
-- A directory entry is a relationship or an invitation nobody answered. The
-- assertions that carry the most weight are the two about the coach: they see
-- the invitations they sent and not the ones a colleague sent, and that
-- narrowing lives in the function rather than in a row policy, because
-- `identity.invitations` is `using (true)` for the owner.
--
-- The other one worth reading is that an invitation entry carries no person and
-- no name. HU-STUDIO-023 criterion 8: until somebody accepts, no person exists,
-- not even a provisional one.

begin;

select plan(14);

insert into identity.people (id, given_name, family_name, status)
values
  ('019ae000-0000-7000-8000-000000000001', 'Ana', 'Alvarez', 'active'),
  ('019ae000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019ae000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active'),
  ('019ae000-0000-7000-8000-000000000013', 'Diana', 'Coach', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019ae000-0000-7000-8000-000000000101', 'gym', 'Pending Gym',
  '{"party_kind":"legal_entity","party_name":"Pending SAS","purpose":"studio_operations"}'
);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019ae000-0000-7000-8000-000000000201', '019ae000-0000-7000-8000-000000000101',
    '019ae000-0000-7000-8000-000000000011', 'active'),
  ('019ae000-0000-7000-8000-000000000202', '019ae000-0000-7000-8000-000000000101',
    '019ae000-0000-7000-8000-000000000012', 'active'),
  ('019ae000-0000-7000-8000-000000000203', '019ae000-0000-7000-8000-000000000101',
    '019ae000-0000-7000-8000-000000000013', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019ae000-0000-7000-8000-000000000201', 'owner'),
  ('019ae000-0000-7000-8000-000000000202', 'coach'),
  ('019ae000-0000-7000-8000-000000000203', 'coach');

-- One person already accepted.
insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019ae000-0000-7000-8000-000000000301', '019ae000-0000-7000-8000-000000000001',
  '019ae000-0000-7000-8000-000000000101', 'active');

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id,
  kind, status, valid_from, ends_on, accepted_by_person_at
) values (
  '019ae000-0000-7000-8000-000000000401', '019ae000-0000-7000-8000-000000000301',
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000101',
  '019ae000-0000-7000-8000-000000000202', 'holder', 'active',
  clock_timestamp() - interval '30 days', null, null
);

-- Camilo invited one person; Diana invited another. Neither has answered.
insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party, expires_at
) values
  ('019ae000-0000-7000-8000-000000000501', '019ae000-0000-7000-8000-000000000101',
    '019ae000-0000-7000-8000-000000000202', 'email', 'bruno@example.test',
    extensions.digest('pending-token-1', 'sha256'), 1,
    extensions.digest('proposal-1', 'sha256'),
    '{"party_kind":"legal_entity","party_name":"Pending SAS","purpose":"studio_operations"}',
    clock_timestamp() + interval '7 days'),
  ('019ae000-0000-7000-8000-000000000502', '019ae000-0000-7000-8000-000000000101',
    '019ae000-0000-7000-8000-000000000203', 'email', 'zoe@example.test',
    extensions.digest('pending-token-2', 'sha256'), 1,
    extensions.digest('proposal-2', 'sha256'),
    '{"party_kind":"legal_entity","party_name":"Pending SAS","purpose":"studio_operations"}',
    clock_timestamp() + interval '7 days');

insert into identity.invitation_intents (id, invitation_id, kind, status)
values
  ('019ae000-0000-7000-8000-000000000601', '019ae000-0000-7000-8000-000000000501',
    'service_relationship', 'pending'),
  ('019ae000-0000-7000-8000-000000000602', '019ae000-0000-7000-8000-000000000502',
    'service_relationship', 'pending');

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000011', true);

select is(
  (select count(*) from relationships.list_organization_clients(
    '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
    null, 50, null, null, null)),
  3::bigint,
  'the owner sees one client and the two people who have not answered'
);

select is(
  (select array_agg(entry_kind order by sort_group, sort_name)
     from relationships.list_organization_clients(
       '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
       null, 50, null, null, null)),
  array['relationship', 'invitation', 'invitation'],
  'each entry says which of the two it is'
);

select is(
  (select contact_hint from relationships.list_organization_clients(
     '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
     'invited', 50, null, null, null)
   order by sort_name limit 1),
  'b***@example.test',
  'an unanswered entry carries the contact masked, never in full'
);

select is(
  (select display_name from relationships.list_organization_clients(
     '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
     'invited', 50, null, null, null)
   order by sort_name limit 1),
  null,
  'and no name, because the person does not exist yet'
);

select is(
  (select person_id from relationships.list_organization_clients(
     '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
     'invited', 50, null, null, null)
   order by sort_name limit 1),
  null,
  'nor a person behind it'
);

select is(
  (select invitation_status from relationships.list_organization_clients(
     '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
     'invited', 50, null, null, null)
   order by sort_name limit 1),
  'pending',
  'what it does carry is the state of the invitation'
);

select is(
  (select invitation_status from relationships.list_organization_clients(
     '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
     'active', 50, null, null, null)),
  'accepted',
  'a relationship reports its invitation as accepted: it exists because somebody accepted'
);

select is(
  (select count(*) from relationships.list_organization_clients(
    '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
    'invited', 50, null, null, null)),
  2::bigint,
  'filtering by invited returns only the unanswered ones'
);

-- Camilo. A coach sees the clients assigned to them, and the invitations they
-- sent. Not Diana's.
select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000012', true);

select is(
  (select count(*) from relationships.list_organization_clients(
    '019ae000-0000-7000-8000-000000000012', '019ae000-0000-7000-8000-000000000101',
    null, 50, null, null, null)),
  2::bigint,
  'the coach sees their assigned client and the invitation they sent'
);

select is(
  (select array_agg(contact_hint order by sort_name)
     from relationships.list_organization_clients(
       '019ae000-0000-7000-8000-000000000012', '019ae000-0000-7000-8000-000000000101',
       'invited', 50, null, null, null)),
  array['b***@example.test'],
  'and specifically not the one a colleague sent'
);

-- Diana sees the mirror image, which is what makes the previous assertion mean
-- something: the row is readable, just not by the wrong coach.
select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000013', true);

select is(
  (select array_agg(contact_hint order by sort_name)
     from relationships.list_organization_clients(
       '019ae000-0000-7000-8000-000000000013', '019ae000-0000-7000-8000-000000000101',
       'invited', 50, null, null, null)),
  array['z***@example.test'],
  'the other coach sees theirs and not the one Camilo sent'
);

-- An invitation that was answered stops being a pending entry. It does not
-- become a relationship here: accepting does that, and nobody accepted.
select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000011', true);

update identity.invitation_intents
  set status = 'rejected', decided_at = clock_timestamp()
  where id = '019ae000-0000-7000-8000-000000000601';

select is(
  (select count(*) from relationships.list_organization_clients(
    '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
    'invited', 50, null, null, null)),
  1::bigint,
  'a refused invitation leaves the pending list'
);

select throws_ok(
  $$select * from relationships.list_organization_clients(
    '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
    'nonsense', 50, null, null, null)$$,
  '22023',
  'invalid directory status',
  'a status nobody defined is refused'
);

select throws_ok(
  $$select * from relationships.list_organization_clients(
    '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000101',
    null, 50, 'invited', null, null)$$,
  '22023',
  'invalid directory cursor',
  'and half a cursor is refused rather than resumed from nowhere'
);

select * from finish();

rollback;
