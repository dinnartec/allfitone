-- T-ORG-HANDOVER-01 — OP-ORG-018 and its resend and cancellation: Allfit creates an
-- organization, hands it to its owner, and never runs it in between.
--
-- `HU-BO-014` and `HU-BO-015`. What this test is built around.
--
-- **Nobody operates an organization nobody has claimed.** It is born with no members
-- and one ownership invitation to an email. Accepting is the only way in, and it
-- makes the recipient the owner in the same transaction.
--
-- **Who acted is recorded, not implied.** The creation, its site and the invitation
-- name the person from Allfit and the duty they acted under. A missing membership
-- never stands for "Allfit did it".
--
-- **Allfit never writes a person's name.** A company is named at creation; a natural
-- person is named from their own identity when they accept.
--
-- **Kinds do not cross, and the one who hands over cannot claim.** A team invitation
-- cannot carry ownership, an ownership token never opens as a team invitation, and a
-- team member cannot create a gym for their own email and take it.

begin;

select plan(47);

insert into identity.people (id, given_name, family_name, status)
values
  ('019ac000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019ac000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019ac000-0000-7000-8000-000000000003', 'Lifecycle', 'Gamma', 'active'),
  ('019ac000-0000-7000-8000-000000000004', 'Support', 'Delta', 'active'),
  ('019ac000-0000-7000-8000-000000000005', 'Owner', 'Epsilon', 'active'),
  ('019ac000-0000-7000-8000-000000000006', 'Stranger', 'Zeta', 'active'),
  ('019ac000-0000-7000-8000-000000000007', 'Member', 'Eta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019ac000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha12', null),
  ('019ac000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta12', null),
  ('019ac000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma12',
    '019ac000-0000-7000-8000-000000000003'),
  ('019ac000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta12',
    '019ac000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019ac000-0000-7000-8000-000000000001', 'alpha12',
  '019ac000-0000-7000-8000-000000000002', 'beta12',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-ORG-HANDOVER-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019ac000-0000-7000-8000-000000000021', '019ac000-0000-7000-8000-000000000011',
    'sid_alpha_12', 'backoffice', decode(repeat('e1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ac000-0000-7000-8000-000000000023', '019ac000-0000-7000-8000-000000000013',
    'sid_gamma_12', 'backoffice', decode(repeat('e3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ac000-0000-7000-8000-000000000024', '019ac000-0000-7000-8000-000000000014',
    'sid_delta_12', 'backoffice', decode(repeat('e4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019ac000-0000-7000-8000-000000000001', '019ac000-0000-7000-8000-000000000021',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ac000-0000-7000-8000-000000000003'::uuid, '019ac000-0000-7000-8000-000000000103'::uuid,
    '019ac000-0000-7000-8000-000000000203'::uuid, '63'),
  ('019ac000-0000-7000-8000-000000000004'::uuid, '019ac000-0000-7000-8000-000000000104'::uuid,
    '019ac000-0000-7000-8000-000000000204'::uuid, '64')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019ac000-0000-7000-8000-000000000001', '019ac000-0000-7000-8000-000000000021',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-014', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ac000-0000-7000-8000-000000000003'::uuid, 'manage_organization_lifecycle',
    '019ac000-0000-7000-8000-000000000113'::uuid, '019ac000-0000-7000-8000-000000000213'::uuid, '73'),
  ('019ac000-0000-7000-8000-000000000004'::uuid, 'diagnose_support_metadata',
    '019ac000-0000-7000-8000-000000000114'::uuid, '019ac000-0000-7000-8000-000000000214'::uuid, '74')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- ---------------------------------------------------------------------------
-- Who is responsible
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into organizations.organizations (type_code, display_name, responsible_party)
     values ('gym', 'Nameless Operating',
       '{"party_kind":"natural_person","purpose":"studio_operations"}'::jsonb) $$,
  '23514',
  null,
  'an operating organization always names who is responsible for it'
);

select lives_ok(
  $$ insert into organizations.organizations (type_code, display_name, status, claimed_at, responsible_party)
     values ('professional_practice', 'Waiting For Its Owner', 'unclaimed', null,
       '{"party_kind":"natural_person","purpose":"studio_operations"}'::jsonb) $$,
  'an unclaimed natural-person organization waits for its owner to be named'
);

-- ---------------------------------------------------------------------------
-- OP-ORG-018 — creating and handing over
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from organizations.create_unclaimed_organization(
    '019ac000-0000-7000-8000-000000000004', '019ac000-0000-7000-8000-000000000024',
    'Support Made', 'gym', 'legal_entity', 'Support Made SAS', null, null,
    'owner@example.test', decode(repeat('a0', 32), 'hex'), 1::smallint,
    'd1000000-0000-4000-8000-000000000000', '019ac000-0000-7000-8000-000000000500',
    decode(repeat('f0', 32), 'hex')
  ) $$,
  '42501',
  null,
  'the support duty does not create organizations'
);

select throws_ok(
  $$ select * from organizations.create_unclaimed_organization(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    'Nameless Company', 'gym', 'legal_entity', null, null, null,
    'owner@example.test', decode(repeat('a0', 32), 'hex'), 1::smallint,
    'd1000000-0000-4000-8000-000000000000', '019ac000-0000-7000-8000-000000000500',
    decode(repeat('f0', 32), 'hex')
  ) $$,
  '22023',
  null,
  'a company is named when it is created'
);

select throws_ok(
  $$ select * from organizations.create_unclaimed_organization(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    'Named Person', 'professional_practice', 'natural_person', 'Somebody Typed This', null, null,
    'owner@example.test', decode(repeat('a0', 32), 'hex'), 1::smallint,
    'd1000000-0000-4000-8000-000000000000', '019ac000-0000-7000-8000-000000000500',
    decode(repeat('f0', 32), 'hex')
  ) $$,
  '22023',
  null,
  'Allfit never writes the name of a person who has not accepted'
);

select throws_ok(
  $$ select * from organizations.create_unclaimed_organization(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    'No Address', 'gym', 'legal_entity', 'No Address SAS', null, null,
    'not an email', decode(repeat('a0', 32), 'hex'), 1::smallint,
    'd1000000-0000-4000-8000-000000000000', '019ac000-0000-7000-8000-000000000500',
    decode(repeat('f0', 32), 'hex')
  ) $$,
  '22023',
  null,
  'the owner is invited by email or not at all'
);

create temporary table handover_norte on commit drop as
select * from organizations.create_unclaimed_organization(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  'Handover Norte', 'gym', 'legal_entity', 'Norte Fitness SAS', 'Sede Principal', 'Calle 1 # 2-3',
  ' Owner@Example.test ', decode(repeat('a1', 32), 'hex'), 1::smallint,
  'd1000000-0000-4000-8000-000000000001', '019ac000-0000-7000-8000-000000000501',
  decode(repeat('f1', 32), 'hex')
);

select is(
  (select result->>'status' from handover_norte),
  'unclaimed',
  'Allfit creates an organization that exists but does not operate'
);

select ok(
  (select organization.claimed_at is null
   from organizations.organizations as organization
   where organization.id = (select (result->>'organization_id')::uuid from handover_norte))
  and not exists (
    select 1 from organizations.organization_memberships as membership
    where membership.organization_id = (select (result->>'organization_id')::uuid from handover_norte)
  ),
  'nobody belongs to it until someone claims it'
);

select ok(
  (select invitation.issued_by_membership_id is null
     and invitation.issued_by_person_id = '019ac000-0000-7000-8000-000000000003'
     and invitation.issued_by_duty_assignment_id = (
       select assignment.id from support.platform_duty_assignments as assignment
       where assignment.person_id = '019ac000-0000-7000-8000-000000000003'
         and assignment.duty_code = 'manage_organization_lifecycle'
     )
     and invitation.contact::text = 'owner@example.test'
     and intent.kind = 'ownership'
     and intent.status = 'pending'
     and intent.proposed_role_code = 'owner'
   from identity.invitations as invitation
   join identity.invitation_intents as intent on intent.invitation_id = invitation.id
   where invitation.id = '019ac000-0000-7000-8000-000000000501'),
  'the invitation names who from Allfit handed it over, under which duty, and to which email'
);

select ok(
  exists (
    select 1 from organizations.organization_events as event
    where event.organization_id = (select (result->>'organization_id')::uuid from handover_norte)
      and event.event_type = 'organization.created_unclaimed.v1'
      and event.actor_person_id = '019ac000-0000-7000-8000-000000000003'
      and event.actor_duty_assignment_id is not null
      and event.actor_membership_id is null
  )
  and exists (
    select 1 from organizations.organization_events as event
    where event.organization_id = (select (result->>'organization_id')::uuid from handover_norte)
      and event.event_type = 'organization.site_created.v1'
      and event.actor_person_id = '019ac000-0000-7000-8000-000000000003'
  ),
  'the creation and its site are recorded as done by Allfit, not by a member'
);

select ok(
  exists (
    select 1 from system.outbox_events as event
    where event.event_type = 'organization.created_unclaimed.v1'
      and event.aggregate_id = (select (result->>'organization_id')::uuid from handover_norte)
  )
  and exists (
    select 1 from system.outbox_events as event
    where event.event_type = 'organization.ownership_invited.v1'
      and event.aggregate_id = '019ac000-0000-7000-8000-000000000501'
  ),
  'the creation and the delivery of its invitation are both on the outbox'
);

select is(
  (select result->'invitation'->>'contact_hint' from handover_norte),
  'o***@example.test',
  'the handover says where the invitation went without spelling the address out'
);

select ok(
  (select replay.replayed
     and replay.result->>'organization_id' = (select result->>'organization_id' from handover_norte)
   from organizations.create_unclaimed_organization(
     '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
     'Handover Norte', 'gym', 'legal_entity', 'Norte Fitness SAS', 'Sede Principal', 'Calle 1 # 2-3',
     ' Owner@Example.test ', decode(repeat('a1', 32), 'hex'), 1::smallint,
     'd1000000-0000-4000-8000-000000000001', '019ac000-0000-7000-8000-000000000501',
     decode(repeat('f1', 32), 'hex')
   ) as replay)
  and (select count(*) = 1 from organizations.organizations as organization
       where organization.display_name = 'Handover Norte'),
  'a retried creation returns the same organization, never a second one'
);

-- ---------------------------------------------------------------------------
-- Kinds do not cross
-- ---------------------------------------------------------------------------

insert into organizations.organizations (id, type_code, display_name, legal_name, responsible_party)
values (
  '019ac000-0000-7000-8000-000000000400', 'gym', 'Member Operated', 'Member Operated SAS',
  '{"party_kind":"legal_entity","party_name":"Member Operated SAS","purpose":"studio_operations"}'::jsonb
);
insert into organizations.organization_memberships (id, organization_id, person_id, status)
values (
  '019ac000-0000-7000-8000-000000000410', '019ac000-0000-7000-8000-000000000400',
  '019ac000-0000-7000-8000-000000000007', 'active'
);
insert into organizations.membership_roles (membership_id, role_code)
values ('019ac000-0000-7000-8000-000000000410', 'owner');
insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact, token_hash,
  token_key_version, proposal_hash, responsible_party, expires_at
) values (
  '019ac000-0000-7000-8000-000000000420', '019ac000-0000-7000-8000-000000000400',
  '019ac000-0000-7000-8000-000000000410', 'email', 'teammate@example.test',
  decode(repeat('b1', 32), 'hex'), 1, decode(repeat('b2', 32), 'hex'),
  '{"party_kind":"legal_entity","party_name":"Member Operated SAS","purpose":"studio_operations"}'::jsonb,
  clock_timestamp() + interval '7 days'
);

select throws_ok(
  $$ insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
     values ('019ac000-0000-7000-8000-000000000501', 'membership', 'staff') $$,
  '23514',
  null,
  'an invitation Allfit issued never carries a team role'
);

select throws_ok(
  $$ insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
     values ('019ac000-0000-7000-8000-000000000420', 'ownership', 'owner') $$,
  '23514',
  null,
  'a member cannot hand their organization over through an invitation'
);

select throws_ok(
  $$ insert into identity.invitations (
       id, organization_id, issued_by_membership_id, issued_by_person_id,
       issued_by_duty_assignment_id, channel, contact, token_hash, token_key_version,
       proposal_hash, responsible_party, expires_at
     ) values (
       '019ac000-0000-7000-8000-000000000421', '019ac000-0000-7000-8000-000000000400',
       '019ac000-0000-7000-8000-000000000410', '019ac000-0000-7000-8000-000000000003',
       (select assignment.id from support.platform_duty_assignments as assignment
        where assignment.person_id = '019ac000-0000-7000-8000-000000000003'),
       'email', 'both@example.test', decode(repeat('b3', 32), 'hex'), 1,
       decode(repeat('b4', 32), 'hex'),
       '{"party_kind":"legal_entity","party_name":"Member Operated SAS","purpose":"studio_operations"}'::jsonb,
       clock_timestamp() + interval '7 days'
     ) $$,
  '23514',
  null,
  'an invitation has exactly one author: a member or someone from Allfit'
);

select set_config('app.actor_kind', 'anonymous', true);

select is(
  (select count(*)::integer from identity.resolve_staff_invitation(decode(repeat('a1', 32), 'hex'))),
  0,
  'an ownership token never opens as a team invitation'
);

-- ---------------------------------------------------------------------------
-- Resolving and claiming
-- ---------------------------------------------------------------------------

select is(
  (select organization_display_name
   from identity.resolve_ownership_invitation(decode(repeat('a1', 32), 'hex'))),
  'Handover Norte',
  'the invitation opens for whoever holds the token'
);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000006', true);

select throws_ok(
  $$ select * from identity.resolve_ownership_invitation(decode(repeat('a1', 32), 'hex')) $$,
  '42501',
  null,
  'resolving a token is the anonymous step, before anyone decides'
);

create temporary table handover_propio on commit drop as
select * from organizations.create_unclaimed_organization(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  'Handover Propio', 'professional_practice', 'natural_person', null, null, null,
  'gamma@example.test', decode(repeat('a2', 32), 'hex'), 1::smallint,
  'd1000000-0000-4000-8000-000000000002', '019ac000-0000-7000-8000-000000000502',
  decode(repeat('f2', 32), 'hex')
);

select set_config('app.actor_verified_email', 'stranger@example.test', true);

select throws_ok(
  $$ select * from identity.decide_ownership_invitation(
    '019ac000-0000-7000-8000-000000000006', decode(repeat('a1', 32), 'hex'),
    (select intent.id from identity.invitation_intents as intent
     where intent.invitation_id = '019ac000-0000-7000-8000-000000000501'),
    'accepted', 'd2000000-0000-4000-8000-000000000001', '019ac000-0000-7000-8000-000000000600',
    decode(repeat('c0', 32), 'hex')
  ) $$,
  '42501',
  'verified email mismatch',
  'only the invited email claims the organization'
);

select set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000003', true);
select set_config('app.actor_verified_email', 'gamma@example.test', true);

select throws_ok(
  $$ select * from identity.decide_ownership_invitation(
    '019ac000-0000-7000-8000-000000000003', decode(repeat('a2', 32), 'hex'),
    (select intent.id from identity.invitation_intents as intent
     where intent.invitation_id = '019ac000-0000-7000-8000-000000000502'),
    'accepted', 'd2000000-0000-4000-8000-000000000002', '019ac000-0000-7000-8000-000000000604',
    decode(repeat('c4', 32), 'hex')
  ) $$,
  '42501',
  'whoever handed an organization over cannot claim it',
  'whoever handed an organization over cannot claim it, even with the right email'
);

select set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000005', true);
select set_config('app.actor_verified_email', 'owner@example.test', true);

create temporary table norte_claim on commit drop as
select * from identity.decide_ownership_invitation(
  '019ac000-0000-7000-8000-000000000005', decode(repeat('a1', 32), 'hex'),
  (select intent.id from identity.invitation_intents as intent
   where intent.invitation_id = '019ac000-0000-7000-8000-000000000501'),
  'accepted', 'd2000000-0000-4000-8000-000000000003', '019ac000-0000-7000-8000-000000000601',
  decode(repeat('c1', 32), 'hex')
);

select is((select intent_status from norte_claim), 'accepted', 'the invited owner accepts');

select ok(
  (select organization.status = 'active'
     and organization.claimed_at is not null
     and organization.responsible_party->>'party_name' = 'Norte Fitness SAS'
   from organizations.organizations as organization
   where organization.id = (select organization_id from norte_claim))
  and (select count(*) = 1
       from organizations.organization_memberships as membership
       join organizations.membership_roles as membership_role
         on membership_role.membership_id = membership.id and membership_role.valid_to is null
       where membership.organization_id = (select organization_id from norte_claim)
         and membership.person_id = '019ac000-0000-7000-8000-000000000005'
         and membership.status = 'active'
         and membership_role.role_code = 'owner'),
  'accepting makes them the only owner and the organization starts operating'
);

select ok(
  exists (
    select 1 from organizations.membership_events as event
    where event.membership_id = (select membership_id from norte_claim)
      and event.event_type = 'organization.role_granted.v1'
      and event.after->>'role_code' = 'owner'
  )
  and exists (
    select 1 from organizations.organization_events as event
    where event.organization_id = (select organization_id from norte_claim)
      and event.event_type = 'organization.claimed.v1'
      and event.actor_membership_id = (select membership_id from norte_claim)
  )
  and (select invitation.status = 'completed' from identity.invitations as invitation
       where invitation.id = '019ac000-0000-7000-8000-000000000501'),
  'the claim is recorded as the new owner''s own act, and the invitation is spent'
);

select ok(
  exists (
    select 1 from system.outbox_events as event
    where event.event_type = 'organization.claimed.v1'
      and event.aggregate_id = (select organization_id from norte_claim)
  ),
  'the claim is on the outbox'
);

select ok(
  (select replay.replayed
   from identity.decide_ownership_invitation(
     '019ac000-0000-7000-8000-000000000005', decode(repeat('a1', 32), 'hex'),
     (select intent.id from identity.invitation_intents as intent
      where intent.invitation_id = '019ac000-0000-7000-8000-000000000501'),
     'accepted', 'd2000000-0000-4000-8000-000000000003', '019ac000-0000-7000-8000-000000000601',
     decode(repeat('c1', 32), 'hex')
   ) as replay),
  'the same decision replays instead of claiming twice'
);

create temporary table handover_sur on commit drop as
select * from organizations.create_unclaimed_organization(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  'Handover Sur', 'professional_practice', 'natural_person', null, null, null,
  'owner@example.test', decode(repeat('a3', 32), 'hex'), 1::smallint,
  'd1000000-0000-4000-8000-000000000003', '019ac000-0000-7000-8000-000000000503',
  decode(repeat('f3', 32), 'hex')
);

select * from identity.decide_ownership_invitation(
  '019ac000-0000-7000-8000-000000000005', decode(repeat('a3', 32), 'hex'),
  (select intent.id from identity.invitation_intents as intent
   where intent.invitation_id = '019ac000-0000-7000-8000-000000000503'),
  'accepted', 'd2000000-0000-4000-8000-000000000004', '019ac000-0000-7000-8000-000000000603',
  decode(repeat('c3', 32), 'hex')
);

select ok(
  (select organization.responsible_party->>'party_name' = 'Owner Epsilon'
     and organization.legal_name is null
   from organizations.organizations as organization
   where organization.id = (select (result->>'organization_id')::uuid from handover_sur)),
  'a natural person is named from their own identity when they accept'
);

select throws_ok(
  $$ select * from identity.decide_ownership_invitation(
    '019ac000-0000-7000-8000-000000000005', decode(repeat('a1', 32), 'hex'),
    (select intent.id from identity.invitation_intents as intent
     where intent.invitation_id = '019ac000-0000-7000-8000-000000000501'),
    'accepted', 'd2000000-0000-4000-8000-000000000005', '019ac000-0000-7000-8000-000000000605',
    decode(repeat('c5', 32), 'hex')
  ) $$,
  'P0002',
  null,
  'a spent invitation cannot be decided again'
);

-- ---------------------------------------------------------------------------
-- OP-ORG-021 — resending
-- ---------------------------------------------------------------------------

create temporary table handover_oeste on commit drop as
select * from organizations.create_unclaimed_organization(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  'Handover Oeste', 'gym', 'legal_entity', 'Oeste SAS', null, null,
  'west@example.test', decode(repeat('a4', 32), 'hex'), 1::smallint,
  'd1000000-0000-4000-8000-000000000004', '019ac000-0000-7000-8000-000000000504',
  decode(repeat('f4', 32), 'hex')
);

select throws_ok(
  $$ select * from organizations.resend_ownership_invitation(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    (select organization_id from norte_claim), decode(repeat('a9', 32), 'hex'), 1::smallint,
    'd3000000-0000-4000-8000-000000000009', '019ac000-0000-7000-8000-000000000509',
    decode(repeat('f9', 32), 'hex')
  ) $$,
  '55000',
  null,
  'an organization with an owner has no invitation to resend'
);

-- Run in its own statement: a check in the same statement reads a snapshot taken
-- before the resend, and would see none of what it changed.
create temporary table live_resend on commit drop as
select * from organizations.resend_ownership_invitation(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  (select (result->>'organization_id')::uuid from handover_oeste),
  decode(repeat('a5', 32), 'hex'), 1::smallint,
  'd3000000-0000-4000-8000-000000000005', '019ac000-0000-7000-8000-000000000505',
  decode(repeat('f5', 32), 'hex')
);

select ok(
  (select result->'invitation'->>'invitation_id' = '019ac000-0000-7000-8000-000000000504'
   from live_resend)
  and (select count(*) = 1 from identity.invitations as invitation
       where invitation.organization_id = (select (result->>'organization_id')::uuid from handover_oeste))
  and (select count(*) = 2 from system.outbox_events as event
       where event.event_type = 'organization.ownership_invited.v1'
         and event.aggregate_id = '019ac000-0000-7000-8000-000000000504'),
  'resending a live invitation sends the same one again rather than a second'
);

update identity.invitations as invitation
set created_at = clock_timestamp() - interval '8 days',
    expires_at = clock_timestamp() - interval '1 day'
where invitation.id = '019ac000-0000-7000-8000-000000000504';

create temporary table lapsed_resend on commit drop as
select * from organizations.resend_ownership_invitation(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  (select (result->>'organization_id')::uuid from handover_oeste),
  decode(repeat('a6', 32), 'hex'), 1::smallint,
  'd3000000-0000-4000-8000-000000000006', '019ac000-0000-7000-8000-000000000506',
  decode(repeat('f6', 32), 'hex')
);

select ok(
  (select result->'invitation'->>'invitation_id' = '019ac000-0000-7000-8000-000000000506'
   from lapsed_resend)
  and (select invitation.status = 'expired' from identity.invitations as invitation
       where invitation.id = '019ac000-0000-7000-8000-000000000504')
  and (select invitation.status = 'pending' and invitation.contact::text = 'west@example.test'
       from identity.invitations as invitation
       where invitation.id = '019ac000-0000-7000-8000-000000000506'),
  'resending a lapsed invitation issues a new one to the same email'
);

select throws_ok(
  $$ select * from organizations.resend_ownership_invitation(
    '019ac000-0000-7000-8000-000000000004', '019ac000-0000-7000-8000-000000000024',
    (select (result->>'organization_id')::uuid from handover_oeste),
    decode(repeat('a7', 32), 'hex'), 1::smallint,
    'd3000000-0000-4000-8000-000000000007', '019ac000-0000-7000-8000-000000000507',
    decode(repeat('f7', 32), 'hex')
  ) $$,
  '42501',
  null,
  'the support duty does not resend a handover'
);

-- ---------------------------------------------------------------------------
-- OP-ORG-022 — cancelling (HU-BO-015)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from organizations.cancel_unclaimed_organization(
    '019ac000-0000-7000-8000-000000000004', '019ac000-0000-7000-8000-000000000024',
    (select (result->>'organization_id')::uuid from handover_oeste),
    'd4000000-0000-4000-8000-000000000000', '019ac000-0000-7000-8000-000000000700',
    decode(repeat('b0', 32), 'hex')
  ) $$,
  '42501',
  null,
  'the support duty does not cancel an organization'
);

select throws_ok(
  $$ select * from organizations.cancel_unclaimed_organization(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    (select organization_id from norte_claim),
    'd4000000-0000-4000-8000-000000000009', '019ac000-0000-7000-8000-000000000709',
    decode(repeat('b9', 32), 'hex')
  ) $$,
  '55000',
  null,
  'an organization with an owner is closed by its owner, not cancelled by Allfit'
);

create temporary table oeste_cancel on commit drop as
select * from organizations.cancel_unclaimed_organization(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  (select (result->>'organization_id')::uuid from handover_oeste),
  'd4000000-0000-4000-8000-000000000001', '019ac000-0000-7000-8000-000000000701',
  decode(repeat('b5', 32), 'hex')
);

select ok(
  (select result->>'status' = 'cancelled' and result->>'cancelled_at' is not null
   from oeste_cancel),
  'an organization nobody claimed is cancelled'
);

select ok(
  (select invitation.status = 'revoked' and intent.status = 'revoked'
   from identity.invitations as invitation
   join identity.invitation_intents as intent on intent.invitation_id = invitation.id
   where invitation.id = '019ac000-0000-7000-8000-000000000506')
  and exists (
    select 1 from organizations.organization_events as event
    where event.organization_id = (select (result->>'organization_id')::uuid from handover_oeste)
      and event.event_type = 'organization.cancelled.v1'
      and event.actor_person_id = '019ac000-0000-7000-8000-000000000003'
      and event.actor_duty_assignment_id is not null
  ),
  'cancelling withdraws its invitation and records who from Allfit cancelled it'
);

create temporary table repeated_cancel on commit drop as
select * from organizations.cancel_unclaimed_organization(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  (select (result->>'organization_id')::uuid from handover_oeste),
  'd4000000-0000-4000-8000-000000000002', '019ac000-0000-7000-8000-000000000702',
  decode(repeat('b6', 32), 'hex')
);

select ok(
  (select result->>'status' = 'cancelled' and not replayed from repeated_cancel)
  and (select count(*) = 1 from organizations.organization_events as event
       where event.organization_id = (select (result->>'organization_id')::uuid from handover_oeste)
         and event.event_type = 'organization.cancelled.v1'),
  'cancelling again converges instead of recording a second cancellation'
);

select set_config('app.actor_kind', 'anonymous', true);

select is(
  (select count(*)::integer
   from identity.resolve_ownership_invitation(decode(repeat('a6', 32), 'hex'))),
  0,
  'the invitation of a cancelled organization no longer opens'
);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ac000-0000-7000-8000-000000000006', true);
select set_config('app.actor_verified_email', 'west@example.test', true);

select throws_ok(
  $$ select * from identity.decide_ownership_invitation(
    '019ac000-0000-7000-8000-000000000006', decode(repeat('a6', 32), 'hex'),
    (select intent.id from identity.invitation_intents as intent
     where intent.invitation_id = '019ac000-0000-7000-8000-000000000506'),
    'accepted', 'd2000000-0000-4000-8000-000000000006', '019ac000-0000-7000-8000-000000000606',
    decode(repeat('c6', 32), 'hex')
  ) $$,
  'P0002',
  null,
  'nobody claims an organization that was cancelled'
);

-- ---------------------------------------------------------------------------
-- Reading a handover
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select organizations.read_organization_handover(
    '019ac000-0000-7000-8000-000000000004', '019ac000-0000-7000-8000-000000000024',
    (select (result->>'organization_id')::uuid from handover_oeste)
  ) $$,
  '42501',
  null,
  'the support duty does not read a handover'
);

select ok(
  (select handover->>'status' = 'cancelled'
     and handover->'invitation'->>'status' = 'revoked'
   from organizations.read_organization_handover(
     '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
     (select (result->>'organization_id')::uuid from handover_oeste)
   ) as handover),
  'whoever manages the lifecycle reads where a handover stands'
);

select throws_ok(
  $$ select organizations.read_organization_handover(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    '019ac000-0000-7000-8000-000000000400'
  ) $$,
  'P0002',
  null,
  'an organization its owner created was never a handover'
);

-- ---------------------------------------------------------------------------
-- Delivery
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from identity.prepare_ownership_invitation_delivery(
    (select event.id from system.outbox_events as event
     where event.event_type = 'organization.ownership_invited.v1'
       and event.aggregate_id = '019ac000-0000-7000-8000-000000000502')
  ) $$,
  '42501',
  null,
  'only the worker prepares a delivery'
);

select set_config('app.actor_kind', 'worker', true);

select ok(
  (select delivery.delivery_state = 'ready' and delivery.contact = 'gamma@example.test'
   from identity.prepare_ownership_invitation_delivery(
     (select event.id from system.outbox_events as event
      where event.event_type = 'organization.ownership_invited.v1'
        and event.aggregate_id = '019ac000-0000-7000-8000-000000000502')
   ) as delivery),
  'a pending ownership invitation is ready to send'
);

select is(
  (select delivery.delivery_state
   from identity.prepare_ownership_invitation_delivery(
     (select event.id from system.outbox_events as event
      where event.event_type = 'organization.ownership_invited.v1'
        and event.aggregate_id = '019ac000-0000-7000-8000-000000000506')
   ) as delivery),
  'skipped',
  'nothing is sent for an organization that was cancelled'
);

select is(
  (select delivery.delivery_state
   from identity.prepare_ownership_invitation_delivery(
     (select event.id from system.outbox_events as event
      where event.event_type = 'organization.created_unclaimed.v1'
        and event.aggregate_id = (select (result->>'organization_id')::uuid from handover_propio))
   ) as delivery),
  'skipped',
  'only an ownership invitation event is delivered as one'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('allfit_api',
    'organizations.create_unclaimed_organization(uuid,uuid,text,text,text,text,text,text,text,bytea,smallint,uuid,uuid,bytea)',
    'EXECUTE')
  and has_function_privilege('allfit_api',
    'organizations.resend_ownership_invitation(uuid,uuid,uuid,bytea,smallint,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'organizations.cancel_unclaimed_organization(uuid,uuid,uuid,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'organizations.read_organization_handover(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api', 'identity.resolve_ownership_invitation(bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.decide_ownership_invitation(uuid,bytea,uuid,text,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.prepare_ownership_invitation_delivery(uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api',
    'organizations.require_organization_lifecycle_duty(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api', 'organizations.handover_projection(uuid)', 'EXECUTE')
  and not has_table_privilege('allfit_api', 'identity.invitations', 'INSERT'),
  'the runtime role runs the handover entries, never the guard, the projection or the tables'
);

select * from finish();
rollback;
