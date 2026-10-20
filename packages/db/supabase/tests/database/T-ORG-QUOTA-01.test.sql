-- T-ORG-QUOTA-01 — OP-ORG-023: how many people a gym may have (`HU-BO-034`).
--
-- **No quota is no limit.** A gym nobody has sold a number to is unlimited, and the
-- file says so. Zero would stop it inviting anybody, and the gyms that exist today
-- were all created without a number.
--
-- **The commercial duty, and no other.** Whoever creates a gym holds the lifecycle
-- duty; whoever decides what it was sold holds the commercial one. Neither stands in
-- for the other, and the base role alone is not either of them.
--
-- **Lowering it never ends anything.** The relationship count and the invitation
-- count are read before and after a quota is cut below them, and both are unchanged.
-- The gym is over its quota and says so; nobody is thrown out.
--
-- **The occupancy has to be the real one.** It is counted from
-- `relationships.service_relationships`, which forces row-level security and did not
-- admit this duty before this migration. Zero places taken is the one wrong figure
-- that makes any quota look safe, so there is an assertion on the figure itself.

begin;

select plan(31);

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019ae000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active', null),
  ('019ae000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active', null),
  ('019ae000-0000-7000-8000-000000000003', 'Commercial', 'Gamma', 'active', null),
  ('019ae000-0000-7000-8000-000000000004', 'Lifecycle', 'Delta', 'active', null),
  ('019ae000-0000-7000-8000-000000000005', 'Support', 'Epsilon', 'active', null),
  ('019ae000-0000-7000-8000-000000000006', 'Owner', 'Zeta', 'active', 'owner.zeta@quota.test'),
  ('019ae000-0000-7000-8000-000000000007', 'Badged', 'Eta', 'active', null),
  ('019ae000-0000-7000-8000-000000000008', 'Client', 'Theta', 'active', null),
  ('019ae000-0000-7000-8000-000000000009', 'Client', 'Iota', 'active', null),
  ('019ae000-0000-7000-8000-000000000010', 'Client', 'Kappa', 'active', null),
  ('019ae000-0000-7000-8000-000000000011', 'Commercial', 'Lambda', 'active', null);

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019ae000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'alpha34', null),
  ('019ae000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'beta34', null),
  ('019ae000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'gamma34',
    '019ae000-0000-7000-8000-000000000003'),
  ('019ae000-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'delta34',
    '019ae000-0000-7000-8000-000000000004'),
  ('019ae000-0000-7000-8000-000000000025', 'workos', 'https://issuer.test', 'epsilon34',
    '019ae000-0000-7000-8000-000000000005'),
  ('019ae000-0000-7000-8000-000000000027', 'workos', 'https://issuer.test', 'eta34',
    '019ae000-0000-7000-8000-000000000007'),
  ('019ae000-0000-7000-8000-000000000031', 'workos', 'https://issuer.test', 'lambda34',
    '019ae000-0000-7000-8000-000000000011');

select support.bootstrap_backoffice_administrators(
  '019ae000-0000-7000-8000-000000000001', 'alpha34',
  '019ae000-0000-7000-8000-000000000002', 'beta34',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-ORG-QUOTA-01'
);

-- AAL2 is not asserted by its absence: `ck_access_sessions_backoffice_assurance` makes
-- a Backoffice session AAL2 with a second factor or no session at all. What a duty
-- actually loses is its session, so that is what is asserted below.
insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at, revoked_at
) values
  ('019ae000-0000-7000-8000-000000000041', '019ae000-0000-7000-8000-000000000021',
    'sid_alpha_34', 'backoffice', decode(repeat('a1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours', null),
  ('019ae000-0000-7000-8000-000000000043', '019ae000-0000-7000-8000-000000000023',
    'sid_gamma_34', 'backoffice', decode(repeat('a3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours', null),
  ('019ae000-0000-7000-8000-000000000044', '019ae000-0000-7000-8000-000000000024',
    'sid_delta_34', 'backoffice', decode(repeat('a4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours', null),
  ('019ae000-0000-7000-8000-000000000045', '019ae000-0000-7000-8000-000000000025',
    'sid_epsilon_34', 'backoffice', decode(repeat('a5', 32), 'hex'), 'v1.epsilon',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours', null),
  ('019ae000-0000-7000-8000-000000000047', '019ae000-0000-7000-8000-000000000027',
    'sid_eta_34', 'backoffice', decode(repeat('a7', 32), 'hex'), 'v1.eta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours', null),
  -- The commercial duty on a session somebody already closed.
  ('019ae000-0000-7000-8000-000000000051', '019ae000-0000-7000-8000-000000000031',
    'sid_lambda_34', 'backoffice', decode(repeat('b1', 32), 'hex'), 'v1.lambda',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours',
    clock_timestamp());

select support.assign_platform_role(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000041',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ae000-0000-7000-8000-000000000003'::uuid, '019ae000-0000-7000-8000-000000000103'::uuid,
    '019ae000-0000-7000-8000-000000000203'::uuid, 'c3'),
  ('019ae000-0000-7000-8000-000000000004'::uuid, '019ae000-0000-7000-8000-000000000104'::uuid,
    '019ae000-0000-7000-8000-000000000204'::uuid, 'c4'),
  ('019ae000-0000-7000-8000-000000000005'::uuid, '019ae000-0000-7000-8000-000000000105'::uuid,
    '019ae000-0000-7000-8000-000000000205'::uuid, 'c5'),
  ('019ae000-0000-7000-8000-000000000007'::uuid, '019ae000-0000-7000-8000-000000000107'::uuid,
    '019ae000-0000-7000-8000-000000000207'::uuid, 'c7'),
  ('019ae000-0000-7000-8000-000000000011'::uuid, '019ae000-0000-7000-8000-000000000111'::uuid,
    '019ae000-0000-7000-8000-000000000211'::uuid, 'd1')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000041',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-034', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ae000-0000-7000-8000-000000000003'::uuid, 'manage_platform_commercial',
    '019ae000-0000-7000-8000-000000000113'::uuid, '019ae000-0000-7000-8000-000000000213'::uuid, 'e3'),
  ('019ae000-0000-7000-8000-000000000004'::uuid, 'manage_organization_lifecycle',
    '019ae000-0000-7000-8000-000000000114'::uuid, '019ae000-0000-7000-8000-000000000214'::uuid, 'e4'),
  ('019ae000-0000-7000-8000-000000000005'::uuid, 'diagnose_support_metadata',
    '019ae000-0000-7000-8000-000000000115'::uuid, '019ae000-0000-7000-8000-000000000215'::uuid, 'e5'),
  ('019ae000-0000-7000-8000-000000000011'::uuid, 'manage_platform_commercial',
    '019ae000-0000-7000-8000-000000000121'::uuid, '019ae000-0000-7000-8000-000000000221'::uuid, 'f1')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- A gym with three clients: two with a live relationship and one that ended.
insert into organizations.organizations (
  id, type_code, display_name, legal_name, responsible_party
) values
  ('019ae000-0000-7000-8000-000000000301', 'gym', 'Cupo Norte', 'Cupo Norte SAS',
    '{"party_kind":"legal_entity","party_name":"Cupo Norte SAS","purpose":"studio_operations"}'::jsonb),
  ('019ae000-0000-7000-8000-000000000302', 'gym', 'Cupo Libre', 'Cupo Libre SAS',
    '{"party_kind":"legal_entity","party_name":"Cupo Libre SAS","purpose":"studio_operations"}'::jsonb);

insert into organizations.organizations (
  id, type_code, display_name, legal_name, status, claimed_at, cancelled_at, responsible_party
) values
  ('019ae000-0000-7000-8000-000000000303', 'gym', 'Cupo Sin Reclamar', 'Sin Reclamar SAS',
    'unclaimed', null, null,
    '{"party_kind":"legal_entity","party_name":"Sin Reclamar SAS","purpose":"studio_operations"}'::jsonb),
  ('019ae000-0000-7000-8000-000000000304', 'gym', 'Cupo Cancelado', 'Cancelado SAS',
    'cancelled', null, clock_timestamp(),
    '{"party_kind":"legal_entity","party_name":"Cancelado SAS","purpose":"studio_operations"}'::jsonb);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019ae000-0000-7000-8000-000000000311', '019ae000-0000-7000-8000-000000000301',
  '019ae000-0000-7000-8000-000000000006', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values ('019ae000-0000-7000-8000-000000000311', 'owner');

insert into relationships.service_relationships (
  id, person_id, organization_id, status, started_at, ended_at, ended_reason
) values
  ('019ae000-0000-7000-8000-000000000321', '019ae000-0000-7000-8000-000000000008',
    '019ae000-0000-7000-8000-000000000301', 'active', clock_timestamp(), null, null),
  ('019ae000-0000-7000-8000-000000000322', '019ae000-0000-7000-8000-000000000009',
    '019ae000-0000-7000-8000-000000000301', 'active', clock_timestamp(), null, null),
  -- A relationship that ended frees its place.
  ('019ae000-0000-7000-8000-000000000323', '019ae000-0000-7000-8000-000000000010',
    '019ae000-0000-7000-8000-000000000301', 'terminated',
    clock_timestamp() - interval '10 days', clock_timestamp(), 'left');

-- One client invitation still awaiting an answer, one rejected, one whose time ran
-- out while still labelled pending, and a team invitation, which is not a client.
insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact, token_hash,
  token_key_version, proposal_hash, responsible_party, status, created_at, expires_at
) values
  ('019ae000-0000-7000-8000-000000000331', '019ae000-0000-7000-8000-000000000301',
    '019ae000-0000-7000-8000-000000000311', 'email', 'pendiente@quota.test',
    decode(repeat('11', 32), 'hex'), 1, decode(repeat('21', 32), 'hex'),
    '{"party_kind":"legal_entity"}'::jsonb, 'pending', clock_timestamp(),
    clock_timestamp() + interval '7 days'),
  ('019ae000-0000-7000-8000-000000000332', '019ae000-0000-7000-8000-000000000301',
    '019ae000-0000-7000-8000-000000000311', 'email', 'rechazada@quota.test',
    decode(repeat('12', 32), 'hex'), 1, decode(repeat('22', 32), 'hex'),
    '{"party_kind":"legal_entity"}'::jsonb, 'pending', clock_timestamp(),
    clock_timestamp() + interval '7 days'),
  ('019ae000-0000-7000-8000-000000000333', '019ae000-0000-7000-8000-000000000301',
    '019ae000-0000-7000-8000-000000000311', 'email', 'vencida@quota.test',
    decode(repeat('13', 32), 'hex'), 1, decode(repeat('23', 32), 'hex'),
    '{"party_kind":"legal_entity"}'::jsonb, 'pending', clock_timestamp() - interval '30 days',
    clock_timestamp() - interval '1 day'),
  ('019ae000-0000-7000-8000-000000000334', '019ae000-0000-7000-8000-000000000301',
    '019ae000-0000-7000-8000-000000000311', 'email', 'equipo@quota.test',
    decode(repeat('14', 32), 'hex'), 1, decode(repeat('24', 32), 'hex'),
    '{"party_kind":"legal_entity"}'::jsonb, 'pending', clock_timestamp(),
    clock_timestamp() + interval '7 days');

insert into identity.invitation_intents (invitation_id, kind, status, decided_at, proposed_role_code)
values
  ('019ae000-0000-7000-8000-000000000331', 'service_relationship', 'pending', null, null),
  ('019ae000-0000-7000-8000-000000000332', 'service_relationship', 'rejected',
    clock_timestamp(), null),
  ('019ae000-0000-7000-8000-000000000333', 'service_relationship', 'pending', null, null),
  ('019ae000-0000-7000-8000-000000000334', 'membership', 'pending', null, 'coach');

-- The actor context the API sets on every Backoffice request. The occupancy comes
-- from a table whose policies ask who is reading.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Criterion 4 — who may set it
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000007', true);

select throws_ok(
  $$ select organizations.set_organization_guest_quota(
    '019ae000-0000-7000-8000-000000000007', '019ae000-0000-7000-8000-000000000047',
    '019ae000-0000-7000-8000-000000000301', 50,
    '5f1b0001-0000-4000-8000-000000000001', '019ae000-0000-7000-8000-000000000901',
    decode(repeat('71', 32), 'hex')
  ) $$,
  '42501',
  null,
  'the base role alone does not decide what a gym was sold'
);

select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000004', true);

select throws_ok(
  $$ select organizations.set_organization_guest_quota(
    '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000044',
    '019ae000-0000-7000-8000-000000000301', 50,
    '5f1b0002-0000-4000-8000-000000000002', '019ae000-0000-7000-8000-000000000902',
    decode(repeat('72', 32), 'hex')
  ) $$,
  '42501',
  null,
  'whoever creates a gym does not thereby decide its commercial terms'
);

select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000005', true);

select throws_ok(
  $$ select organizations.set_organization_guest_quota(
    '019ae000-0000-7000-8000-000000000005', '019ae000-0000-7000-8000-000000000045',
    '019ae000-0000-7000-8000-000000000301', 50,
    '5f1b0003-0000-4000-8000-000000000003', '019ae000-0000-7000-8000-000000000903',
    decode(repeat('73', 32), 'hex')
  ) $$,
  '42501',
  null,
  'nor does the duty that reads a gym''s file'
);

select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000011', true);

select throws_ok(
  $$ select organizations.set_organization_guest_quota(
    '019ae000-0000-7000-8000-000000000011', '019ae000-0000-7000-8000-000000000051',
    '019ae000-0000-7000-8000-000000000301', 50,
    '5f1b0004-0000-4000-8000-000000000004', '019ae000-0000-7000-8000-000000000904',
    decode(repeat('74', 32), 'hex')
  ) $$,
  '42501',
  null,
  'the commercial duty on a session that was closed reaches nothing'
);

-- The actor of the transaction and the actor named in the call are one person.
select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000005', true);

select throws_ok(
  $$ select organizations.set_organization_guest_quota(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
    '019ae000-0000-7000-8000-000000000301', 50,
    '5f1b0005-0000-4000-8000-000000000005', '019ae000-0000-7000-8000-000000000905',
    decode(repeat('75', 32), 'hex')
  ) $$,
  '42501',
  null,
  'a quota is not set for an actor other than the one acting'
);

select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- The occupancy, which is what any quota is judged against
-- ---------------------------------------------------------------------------

select is(
  (select occupied from organizations.organization_guest_occupancy(
     '019ae000-0000-7000-8000-000000000301')),
  3,
  'two live relationships and one invitation awaiting an answer take three places'
);

select is(
  (select relationships_active from organizations.organization_guest_occupancy(
     '019ae000-0000-7000-8000-000000000301')),
  2,
  'the relationship that ended freed its place'
);

select is(
  (select invitations_pending from organizations.organization_guest_occupancy(
     '019ae000-0000-7000-8000-000000000301')),
  1,
  'a rejected invitation, one out of time and a team invitation take no client place'
);

-- ---------------------------------------------------------------------------
-- Criterion 1 — the number, and what no number means
-- ---------------------------------------------------------------------------

select is(
  (select organizations.guest_quota_projection(
     '019ae000-0000-7000-8000-000000000302')->'seats'),
  'null'::jsonb,
  'a gym nobody sold a number to has no limit, which is not zero'
);

select is(
  (select organizations.guest_quota_projection(
     '019ae000-0000-7000-8000-000000000302')->'places_left'),
  'null'::jsonb,
  'and no limit leaves no number of places to count down'
);

select is(
  (select organizations.guest_quota_projection(
     '019ae000-0000-7000-8000-000000000302')->'last_change'),
  'null'::jsonb,
  'never having been set is told apart from having been set to no limit'
);

select throws_ok(
  $$ select organizations.set_organization_guest_quota(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
    '019ae000-0000-7000-8000-000000000301', 0,
    '5f1b0006-0000-4000-8000-000000000006', '019ae000-0000-7000-8000-000000000906',
    decode(repeat('76', 32), 'hex')
  ) $$,
  '22023',
  null,
  'a quota of zero is not a sale'
);

select throws_ok(
  $$ select organizations.set_organization_guest_quota(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
    '019ae000-0000-7000-8000-000000009999', 50,
    '5f1b0007-0000-4000-8000-000000000007', '019ae000-0000-7000-8000-000000000907',
    decode(repeat('77', 32), 'hex')
  ) $$,
  'P0002',
  null,
  'a gym that does not exist is sold nothing'
);

select throws_ok(
  $$ select organizations.set_organization_guest_quota(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
    '019ae000-0000-7000-8000-000000000304', 50,
    '5f1b0008-0000-4000-8000-000000000008', '019ae000-0000-7000-8000-000000000908',
    decode(repeat('78', 32), 'hex')
  ) $$,
  '55000',
  null,
  'and a gym that no longer operates is not sold a quota either'
);

-- Criterion 1 says at creation or after: an organization nobody has claimed yet is
-- the one Allfit just created.
select ok(
  (select (result->>'seats')::integer = 25
   from organizations.set_organization_guest_quota(
     '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
     '019ae000-0000-7000-8000-000000000303', 25,
     '5f1b0009-0000-4000-8000-000000000009', '019ae000-0000-7000-8000-000000000909',
     decode(repeat('79', 32), 'hex')
   )),
  'a gym nobody has claimed yet can be sold its number'
);

-- ---------------------------------------------------------------------------
-- Criterion 3 — who changed it, when, and what it was before
-- ---------------------------------------------------------------------------

create temporary table first_quota on commit drop as
select result from organizations.set_organization_guest_quota(
  '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
  '019ae000-0000-7000-8000-000000000301', 50,
  '5f1b0010-0000-4000-8000-000000000010', '019ae000-0000-7000-8000-000000000910',
  decode(repeat('7a', 32), 'hex')
) as result;

select is(
  (select result->'last_change'->'previous_seats' from first_quota),
  'null'::jsonb,
  'the quota a gym had before its first one was no limit, reported as the value it was'
);

select ok(
  (select result->'last_change'->>'by_person_id' = '019ae000-0000-7000-8000-000000000003'
     and result->'last_change'->>'at' is not null
   from first_quota),
  'the change names who made it and when'
);

select ok(
  (select exists (
     select 1
     from organizations.organization_events as event
     join support.platform_duty_assignments as assignment
       on assignment.id = event.actor_duty_assignment_id
     where event.organization_id = '019ae000-0000-7000-8000-000000000301'
       and event.event_type = 'organization.guest_quota_set.v1'
       and assignment.duty_code = 'manage_platform_commercial'
   )),
  'and the duty assignment it was made under, not merely the person'
);

select is(
  (select (result->>'places_left')::integer from first_quota),
  47,
  'fifty places with three taken leaves forty-seven'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — lowering it ends nothing
-- ---------------------------------------------------------------------------

create temporary table before_cut on commit drop as
select
  (select count(*) from relationships.service_relationships
    where organization_id = '019ae000-0000-7000-8000-000000000301'
      and status = 'active') as live_relationships,
  (select count(*) from identity.invitations
    where organization_id = '019ae000-0000-7000-8000-000000000301'
      and status = 'pending') as pending_invitations;

create temporary table cut_quota on commit drop as
select result from organizations.set_organization_guest_quota(
  '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
  '019ae000-0000-7000-8000-000000000301', 1,
  '5f1b0011-0000-4000-8000-000000000011', '019ae000-0000-7000-8000-000000000911',
  decode(repeat('7b', 32), 'hex')
) as result;

select is(
  (select count(*)::integer from relationships.service_relationships
    where organization_id = '019ae000-0000-7000-8000-000000000301' and status = 'active'),
  (select live_relationships::integer from before_cut),
  'cutting the quota below the occupancy ends no relationship'
);

select is(
  (select count(*)::integer from identity.invitations
    where organization_id = '019ae000-0000-7000-8000-000000000301' and status = 'pending'),
  (select pending_invitations::integer from before_cut),
  'and revokes no invitation that was already sent'
);

select ok(
  (select (result->>'over_quota')::boolean and (result->>'places_left')::integer = 0
   from cut_quota),
  'the gym is over its quota and has no place left, which is the honest answer'
);

select is(
  (select (result->'last_change'->>'previous_seats')::integer from cut_quota),
  50,
  'the second change reports the first number as what it replaced'
);

-- ---------------------------------------------------------------------------
-- Removing the limit, and repeating a decision
-- ---------------------------------------------------------------------------

select ok(
  (select result->'seats' = 'null'::jsonb and result->'places_left' = 'null'::jsonb
   from organizations.set_organization_guest_quota(
     '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
     '019ae000-0000-7000-8000-000000000301', null,
     '5f1b0012-0000-4000-8000-000000000012', '019ae000-0000-7000-8000-000000000912',
     decode(repeat('7c', 32), 'hex')
   ) as result),
  'a deal with no cap is written as no limit, not as a very large number'
);

select is(
  (select count(*)::integer from organizations.organization_events
    where organization_id = '019ae000-0000-7000-8000-000000000301'
      and event_type = 'organization.guest_quota_set.v1'),
  3,
  'three decisions left three records'
);

-- The same number again is not a change: the receipt replays and the history keeps
-- the three decisions that were actually made.
select ok(
  (select replayed from organizations.set_organization_guest_quota(
     '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043',
     '019ae000-0000-7000-8000-000000000301', null,
     '5f1b0012-0000-4000-8000-000000000012', '019ae000-0000-7000-8000-000000000912',
     decode(repeat('7c', 32), 'hex')
   )),
  'a replayed decision is reported as the replay it is'
);

select is(
  (select count(*)::integer from organizations.organization_events
    where organization_id = '019ae000-0000-7000-8000-000000000301'
      and event_type = 'organization.guest_quota_set.v1'),
  3,
  'and leaves no fourth record behind'
);

-- ---------------------------------------------------------------------------
-- A record of a commercial decision is not a gym's own event
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into organizations.organization_events (
    organization_id, event_type, before_snapshot, after_snapshot, actor_membership_id
  ) values (
    '019ae000-0000-7000-8000-000000000301',
    'organization.guest_quota_set.v1',
    '{"guest_quota_seats": null, "revision_number": 0}'::jsonb,
    '{"guest_quota_seats": 10, "revision_number": 1}'::jsonb,
    '019ae000-0000-7000-8000-000000000311'
  ) $$,
  '23514',
  null,
  'a gym cannot record a quota decision as if its own member had made it'
);

select throws_ok(
  $$ insert into organizations.organization_events (
    organization_id, event_type, before_snapshot, after_snapshot,
    actor_person_id, actor_duty_assignment_id
  ) values (
    '019ae000-0000-7000-8000-000000000301',
    'organization.guest_quota_set.v1',
    '{"guest_quota_seats": null, "revision_number": 0}'::jsonb,
    '{"seats": 10}'::jsonb,
    '019ae000-0000-7000-8000-000000000003',
    '019ae000-0000-7000-8000-000000000113'
  ) $$,
  '23514',
  null,
  'and a snapshot that does not carry the number is not a record of it'
);

-- ---------------------------------------------------------------------------
-- The file a gym's quota is read from
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000005', true);

create temporary table norte_file on commit drop as
select organizations.read_backoffice_organization(
  '019ae000-0000-7000-8000-000000000005', '019ae000-0000-7000-8000-000000000045',
  '019ae000-0000-7000-8000-000000000301'
) as file;

select ok(
  (select file->'guest_quota'->'seats' = 'null'::jsonb
     and (file->'guest_quota'->>'occupied')::integer = 3
     and (file->'guest_quota'->>'relationships_active')::integer = 2
     and (file->'guest_quota'->>'invitations_pending')::integer = 1
   from norte_file),
  'the file carries the number beside the occupancy it has to be judged against'
);

select ok(
  (select file->'guest_quota'->'last_change'->>'by_person_id'
     = '019ae000-0000-7000-8000-000000000003'
   from norte_file),
  'and says who last decided it, for whoever opens the file afterwards'
);

select finish();

rollback;
