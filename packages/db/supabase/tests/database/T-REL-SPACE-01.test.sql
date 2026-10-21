-- T-REL-SPACE-01 — a person's side of a gym: the invitation, the history, covers, the end.
--
-- HU-SP-016..020 and HU-SP-095 on Space. What must hold:
--   · the invitation says who sent it;
--   · she finds her pending invitations by her verified email — never anybody else's, never
--     an expired one — and can read and decide one by id under the same email test;
--   · she reads the history of her own relationship, without the gym's reason for ending it;
--   · she accepts or rejects a cover explicitly, once, and nobody else can;
--   · she ends her own relationship: grants frozen at one instant, once;
--   · her relationships say who her coach is.
--
-- Written before the migration and watched failing.

begin;

select plan(26);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b3000-0000-7000-8000-000000000001', 'Ana', 'Alvarez', 'active'),
  ('019b3000-0000-7000-8000-000000000002', 'Bea', 'Beltrán', 'active'),
  ('019b3000-0000-7000-8000-000000000011', 'Laura', 'Gómez', 'active'),
  ('019b3000-0000-7000-8000-000000000012', 'Daniel', 'Mora', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values ('019b3000-0000-7000-8000-000000000101', 'gym', 'Bodytech Chicó',
  '{"party_kind":"legal_entity","party_name":"Bodytech SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019b3000-0000-7000-8000-000000000201', '019b3000-0000-7000-8000-000000000101',
        '019b3000-0000-7000-8000-000000000011', 'active'),
       ('019b3000-0000-7000-8000-000000000202', '019b3000-0000-7000-8000-000000000101',
        '019b3000-0000-7000-8000-000000000012', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values ('019b3000-0000-7000-8000-000000000201', 'owner'),
       ('019b3000-0000-7000-8000-000000000202', 'coach');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019b3000-0000-7000-8000-000000000301', 'relationship_training', 1, 'published', clock_timestamp()),
       ('019b3000-0000-7000-8000-000000000302', 'body_progress', 1, 'published', clock_timestamp());

-- Laura invites Ana twice (one will expire) and Bea once.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select identity.issue_client_invitation(
  '019b3000-0000-7000-8000-000000000011', '019b3000-0000-7000-8000-000000000101',
  'email', contact,
  '[{"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar","presented_snapshot":{"title":"Entrenamiento"}},
    {"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento","presented_snapshot":{"title":"Progreso"}}]'::jsonb,
  extensions.digest(token, 'sha256'), 1::smallint, command::uuid, command::uuid,
  extensions.digest(token || '-request', 'sha256'))
from (values ('ana@example.test', 'token-ana', '019b3000-0000-7000-8000-000000000f01'),
             ('bea@example.test', 'token-bea', '019b3000-0000-7000-8000-000000000f02')) as issued(contact, token, command);

select id as ana_invitation from identity.invitations where contact = 'ana@example.test' \gset

-- ------------------------------------------------------------------ who invites

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000001', true),
       set_config('app.actor_verified_email', 'ana@example.test', true);

select is(
  (select invited_by from identity.resolve_client_invitation(extensions.digest('token-ana', 'sha256'))),
  (select display_name from identity.people where id = '019b3000-0000-7000-8000-000000000011'),
  'T-REL-SPACE-01 the invitation says who sent it');

-- ------------------------------------------------------------------ pending, by email

select is(
  (select array_agg(organization_name) from identity.list_my_client_invitations()),
  array['Bodytech Chicó'],
  'T-REL-SPACE-02 she finds the invitation addressed to her verified email');

select is(
  (select invited_by from identity.list_my_client_invitations()),
  (select display_name from identity.people where id = '019b3000-0000-7000-8000-000000000011'),
  'T-REL-SPACE-03 and who sent it');

select set_config('app.actor_kind', 'account', true),
       set_config('app.actor_person_id', '', true);

select is(
  (select count(*)::integer from identity.list_my_client_invitations()),
  1,
  'T-REL-SPACE-04 an account still registering finds it too, to be told it is waiting');

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000001', true),
       set_config('app.actor_verified_email', '', true);

select throws_ok(
  $$ select * from identity.list_my_client_invitations() $$,
  '42501', null,
  'T-REL-SPACE-05 without a verified email nothing is listed: the email is the only key');

select set_config('app.actor_verified_email', 'bea@example.test', true);

select is(
  (select count(*)::integer from identity.list_my_client_invitations()
   where invitation_id = :'ana_invitation'::uuid),
  0,
  'T-REL-SPACE-06 never somebody else''s');

select set_config('app.actor_verified_email', 'ana@example.test', true);

select is(
  (select organization_display_name from identity.read_my_client_invitation(:'ana_invitation'::uuid)),
  'Bodytech Chicó',
  'T-REL-SPACE-07 she reads it by id, as the link would show it');

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000002', true),
       set_config('app.actor_verified_email', 'bea@example.test', true);

select throws_ok(
  format($$ select * from identity.read_my_client_invitation(%L) $$, :'ana_invitation'),
  '42501', null,
  'T-REL-SPACE-08 another person cannot read it by id');

select throws_ok(
  format($$ select * from identity.decide_my_client_invitation(
       '019b3000-0000-7000-8000-000000000002', %L,
       (select id from identity.invitation_intents where invitation_id = %L), 'accepted', '{}'::jsonb,
       '019b3000-0000-7000-8000-000000000f03', '019b3000-0000-7000-8000-000000000f03',
       extensions.digest('bea-takes-ana', 'sha256')) $$, :'ana_invitation', :'ana_invitation'),
  '42501', null,
  'T-REL-SPACE-09 nor decide it');

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000001', true),
       set_config('app.actor_verified_email', 'ana@example.test', true);

select is(
  (select array[intent_status, array_to_string(granted_scope_codes, ',')]
   from identity.decide_my_client_invitation(
     '019b3000-0000-7000-8000-000000000001', :'ana_invitation'::uuid,
     (select id from identity.invitation_intents where invitation_id = :'ana_invitation'::uuid),
     'accepted', '{"relationship_training":"accepted"}'::jsonb,
     '019b3000-0000-7000-8000-000000000f04', '019b3000-0000-7000-8000-000000000f04',
     extensions.digest('ana-decides', 'sha256'))),
  array['accepted', 'relationship_training'],
  'T-REL-SPACE-10 she decides it by id, scope by scope');

select is(
  (select count(*)::integer from identity.list_my_client_invitations()),
  0,
  'T-REL-SPACE-11 and it is no longer pending');

-- An expired one is not listed.
update identity.invitations set created_at = clock_timestamp() - interval '10 days', expires_at = clock_timestamp() - interval '1 day'
where contact = 'bea@example.test';
select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000002', true),
       set_config('app.actor_verified_email', 'bea@example.test', true);

select is(
  (select count(*)::integer from identity.list_my_client_invitations()),
  0,
  'T-REL-SPACE-12 an expired invitation is not offered');

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000001', true),
       set_config('app.actor_verified_email', 'ana@example.test', true);

select id as relationship from relationships.service_relationships
where person_id = '019b3000-0000-7000-8000-000000000001' \gset

-- ------------------------------------------------------------------ the coach

insert into relationships.relationship_professional_assignments
  (id, relationship_id, person_id, organization_id, membership_id, kind, status, valid_from)
values ('019b3000-0000-7000-8000-000000000401', :'relationship'::uuid,
        '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000101',
        '019b3000-0000-7000-8000-000000000201', 'holder', 'active', clock_timestamp() - interval '1 hour');

select is(
  (select holder_name from relationships.list_my_relationships(
     '019b3000-0000-7000-8000-000000000001', 10, null, null)),
  (select display_name from identity.people where id = '019b3000-0000-7000-8000-000000000011'),
  'T-REL-SPACE-13 her gyms say who her coach is');

-- ------------------------------------------------------------------ covers

insert into relationships.relationship_professional_assignments
  (id, relationship_id, person_id, organization_id, membership_id, kind, status, valid_from, ends_on, covers_membership_id)
values ('019b3000-0000-7000-8000-000000000402', :'relationship'::uuid,
        '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000101',
        '019b3000-0000-7000-8000-000000000202', 'substitute', 'proposed',
        clock_timestamp(), current_date + 10, '019b3000-0000-7000-8000-000000000201'),
       ('019b3000-0000-7000-8000-000000000403', :'relationship'::uuid,
        '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000101',
        '019b3000-0000-7000-8000-000000000202', 'substitute', 'proposed',
        clock_timestamp() + interval '20 days', current_date + 30, '019b3000-0000-7000-8000-000000000201');

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000002', true);

select throws_ok(
  format($$ select * from relationships.decide_substitution(
       '019b3000-0000-7000-8000-000000000002', %L, '019b3000-0000-7000-8000-000000000402',
       'accepted', 'f3111111-1111-4111-8111-111111111101', '019b3000-0000-7000-8000-000000000f05',
       extensions.digest('bea-accepts', 'sha256')) $$, :'relationship'),
  'P0002', null,
  'T-REL-SPACE-14 nobody else decides her cover, and is not told it exists');

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000001', true);

select is(
  (select status from relationships.decide_substitution(
     '019b3000-0000-7000-8000-000000000001', :'relationship'::uuid,
     '019b3000-0000-7000-8000-000000000402', 'accepted',
     'f3111111-1111-4111-8111-111111111102', '019b3000-0000-7000-8000-000000000f06',
     extensions.digest('ana-accepts', 'sha256'))),
  'active',
  'T-REL-SPACE-15 accepting a cover makes it run');

select isnt(
  (select accepted_by_person_at from relationships.relationship_professional_assignments
   where id = '019b3000-0000-7000-8000-000000000402'),
  null,
  'T-REL-SPACE-16 and records when she accepted');

select is(
  (select status from relationships.decide_substitution(
     '019b3000-0000-7000-8000-000000000001', :'relationship'::uuid,
     '019b3000-0000-7000-8000-000000000403', 'rejected',
     'f3111111-1111-4111-8111-111111111103', '019b3000-0000-7000-8000-000000000f07',
     extensions.digest('ana-rejects', 'sha256'))),
  'rejected',
  'T-REL-SPACE-17 rejecting one leaves it rejected, with no access');

select throws_ok(
  format($$ select * from relationships.decide_substitution(
       '019b3000-0000-7000-8000-000000000001', %L, '019b3000-0000-7000-8000-000000000403',
       'accepted', 'f3111111-1111-4111-8111-111111111104', '019b3000-0000-7000-8000-000000000f08',
       extensions.digest('ana-changes-mind', 'sha256')) $$, :'relationship'),
  'P0004', null,
  'T-REL-SPACE-18 a cover is decided once');

select is(
  (select status from relationships.decide_substitution(
     '019b3000-0000-7000-8000-000000000001', :'relationship'::uuid,
     '019b3000-0000-7000-8000-000000000403', 'rejected',
     'f3111111-1111-4111-8111-111111111103', '019b3000-0000-7000-8000-000000000f07',
     extensions.digest('ana-rejects', 'sha256'))),
  'rejected',
  'T-REL-SPACE-19 and a retry answers the same');

-- ------------------------------------------------------------------ the end

select is(
  (select frozen_grants from relationships.end_my_relationship(
     '019b3000-0000-7000-8000-000000000001', :'relationship'::uuid, 'Me mudé',
     'f3111111-1111-4111-8111-111111111105', '019b3000-0000-7000-8000-000000000f09',
     extensions.digest('ana-ends', 'sha256'))),
  1,
  'T-REL-SPACE-20 she ends her relationship and what she shared is frozen');

select is(
  (select array[status::text, ended_by_kind::text] from relationships.service_relationships
   where id = :'relationship'::uuid),
  array['terminated', 'person'],
  'T-REL-SPACE-21 the record says she ended it');

select is(
  (select count(*)::integer from relationships.relationship_professional_assignments
   where relationship_id = :'relationship'::uuid and status = 'active'),
  0,
  'T-REL-SPACE-22 and nobody stays assigned to her');

select is(
  (select replayed from relationships.end_my_relationship(
     '019b3000-0000-7000-8000-000000000001', :'relationship'::uuid, null,
     'f3111111-1111-4111-8111-111111111106', '019b3000-0000-7000-8000-000000000f10',
     extensions.digest('ana-ends-again', 'sha256'))),
  true,
  'T-REL-SPACE-23 ending it again changes nothing');

-- ------------------------------------------------------------------ the history

select is(
  (select jsonb_path_query_array(
     relationships.read_relationship_history(
       '019b3000-0000-7000-8000-000000000001', null, :'relationship'::uuid, 50, null),
     '$.data[*].type') @> '["relationship_started","holder_assigned","substitution_accepted","relationship_ended"]'::jsonb),
  true,
  'T-REL-SPACE-24 she reads the history of her own relationship');

select is(
  (select relationships.read_relationship_history(
     '019b3000-0000-7000-8000-000000000001', null, :'relationship'::uuid, 50, null)
     -> 'data' -> 0 -> 'detail' ->> 'reason'),
  'Me mudé',
  'T-REL-SPACE-25 her own reason is hers to read');

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000002', true);

select throws_ok(
  format($$ select relationships.read_relationship_history(
       '019b3000-0000-7000-8000-000000000002', null, %L, 50, null) $$, :'relationship'),
  'P0002', null,
  'T-REL-SPACE-26 and nobody else reads it');

select * from finish();
rollback;
