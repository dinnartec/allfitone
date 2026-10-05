-- T-IDN-RESEND-01 — NEW-IDN-RESEND / OP-IDN-052: resending an invitation from Backoffice.
--
-- `HU-BO-011`, the invitation half. Verification and recovery resends need the
-- identity action requests PRE_PHASE_5 §5 describes and are built with `HU-BO-010`.
--
-- **Only what is still pending goes out again.** A live invitation is sent as it is;
-- an expired one is replaced by a new identical one that Allfit signs; an accepted,
-- declined or revoked one is never resent, and neither is one already reissued.
--
-- **Resending changes nothing it proposed.** The reissue keeps the organization, the
-- contact and the role, and the database refuses one that does not — even from the
-- owner of the tables.
--
-- **Allfit reissues, it does not impersonate.** The new invitation carries the Allfit
-- person and duty that issued it and points at the one it replaces; a team invitation
-- Allfit authors without replacing one is still refused.
--
-- **Every resend is recorded**, team and ownership alike, and the destination limit
-- Studio already enforces applies to support as well.

begin;

select plan(35);

insert into identity.people (id, given_name, family_name, status)
values
  ('019af000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019af000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019af000-0000-7000-8000-000000000003', 'Support', 'Gamma', 'active'),
  ('019af000-0000-7000-8000-000000000004', 'Lifecycle', 'Delta', 'active'),
  ('019af000-0000-7000-8000-000000000005', 'Badged', 'Epsilon', 'active'),
  ('019af000-0000-7000-8000-000000000006', 'Owner', 'Zeta', 'active'),
  ('019af000-0000-7000-8000-000000000007', 'Invitee', 'Eta', 'active'),
  ('019af000-0000-7000-8000-000000000008', 'Owner', 'Theta', 'active'),
  ('019af000-0000-7000-8000-000000000009', 'Joined', 'Iota', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019af000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'alpha_resend', null),
  ('019af000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'beta_resend', null),
  ('019af000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'gamma_resend',
    '019af000-0000-7000-8000-000000000003'),
  ('019af000-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'delta_resend',
    '019af000-0000-7000-8000-000000000004'),
  ('019af000-0000-7000-8000-000000000025', 'workos', 'https://issuer.test', 'epsilon_resend',
    '019af000-0000-7000-8000-000000000005');

select support.bootstrap_backoffice_administrators(
  '019af000-0000-7000-8000-000000000001', 'alpha_resend',
  '019af000-0000-7000-8000-000000000002', 'beta_resend',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-IDN-RESEND-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
)
select
  session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019af000-0000-7000-8000-000000000041'::uuid, '019af000-0000-7000-8000-000000000021'::uuid,
    'alpha_resend', 'b1'),
  ('019af000-0000-7000-8000-000000000043'::uuid, '019af000-0000-7000-8000-000000000023'::uuid,
    'gamma_resend', 'b3'),
  ('019af000-0000-7000-8000-000000000044'::uuid, '019af000-0000-7000-8000-000000000024'::uuid,
    'delta_resend', 'b4'),
  ('019af000-0000-7000-8000-000000000045'::uuid, '019af000-0000-7000-8000-000000000025'::uuid,
    'epsilon_resend', 'b5')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019af000-0000-7000-8000-000000000001', '019af000-0000-7000-8000-000000000041',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019af000-0000-7000-8000-000000000003'::uuid, '019af000-0000-7000-8000-000000000103'::uuid,
    '019af000-0000-7000-8000-000000000203'::uuid, '63'),
  ('019af000-0000-7000-8000-000000000004'::uuid, '019af000-0000-7000-8000-000000000104'::uuid,
    '019af000-0000-7000-8000-000000000204'::uuid, '64'),
  ('019af000-0000-7000-8000-000000000005'::uuid, '019af000-0000-7000-8000-000000000105'::uuid,
    '019af000-0000-7000-8000-000000000205'::uuid, '65')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019af000-0000-7000-8000-000000000001', '019af000-0000-7000-8000-000000000041',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-011', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019af000-0000-7000-8000-000000000003'::uuid, 'diagnose_support_metadata',
    '019af000-0000-7000-8000-000000000113'::uuid, '019af000-0000-7000-8000-000000000213'::uuid, '73'),
  ('019af000-0000-7000-8000-000000000004'::uuid, 'manage_organization_lifecycle',
    '019af000-0000-7000-8000-000000000114'::uuid, '019af000-0000-7000-8000-000000000214'::uuid, '74')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- Two operating organizations, each with its owner.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000006', true);
create temporary table resend_gym on commit drop as
select * from organizations.create_organization(
  '019af000-0000-7000-8000-000000000006', 'Reenvío Norte', 'studio', 'natural_person', 'Ignored',
  'd0000000-0000-4000-8000-000000000001', '019af000-0000-7000-8000-000000000301',
  decode(repeat('d1', 32), 'hex')
);

select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000008', true);
create temporary table other_gym on commit drop as
select * from organizations.create_organization(
  '019af000-0000-7000-8000-000000000008', 'Reenvío Sur', 'studio', 'natural_person', 'Ignored',
  'd0000000-0000-4000-8000-000000000002', '019af000-0000-7000-8000-000000000302',
  decode(repeat('d2', 32), 'hex')
);

-- The owner invites: one still live, one that will lapse, one revoked, one accepted,
-- and one that lapses while an equal one is issued again.
select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000006', true);
select * from identity.issue_staff_invitation(
  '019af000-0000-7000-8000-000000000006', (select organization_id from resend_gym),
  'email', 'live.coach@example.test', 'coach', extensions.digest('T-IDN-RESEND-01 c1', 'sha256'), 1::smallint,
  'e0000000-0000-4000-8000-000000000001', '019af000-0000-7000-8000-000000000501',
  decode(repeat('e1', 32), 'hex')
);
select * from identity.issue_staff_invitation(
  '019af000-0000-7000-8000-000000000006', (select organization_id from resend_gym),
  'email', 'eta.invitee@example.test', 'staff', extensions.digest('T-IDN-RESEND-01 c2', 'sha256'), 1::smallint,
  'e0000000-0000-4000-8000-000000000002', '019af000-0000-7000-8000-000000000502',
  decode(repeat('e2', 32), 'hex')
);
select * from identity.issue_staff_invitation(
  '019af000-0000-7000-8000-000000000006', (select organization_id from resend_gym),
  'email', 'revoked@example.test', 'staff', extensions.digest('T-IDN-RESEND-01 c3', 'sha256'), 1::smallint,
  'e0000000-0000-4000-8000-000000000003', '019af000-0000-7000-8000-000000000503',
  decode(repeat('e3', 32), 'hex')
);
select * from identity.revoke_staff_invitation(
  '019af000-0000-7000-8000-000000000006', (select organization_id from resend_gym),
  '019af000-0000-7000-8000-000000000503', 'e0000000-0000-4000-8000-000000000013',
  '019af000-0000-7000-8000-000000000513', decode(repeat('f3', 32), 'hex')
);
select * from identity.issue_staff_invitation(
  '019af000-0000-7000-8000-000000000006', (select organization_id from resend_gym),
  'email', 'joined@example.test', 'staff', extensions.digest('T-IDN-RESEND-01 c4', 'sha256'), 1::smallint,
  'e0000000-0000-4000-8000-000000000004', '019af000-0000-7000-8000-000000000504',
  decode(repeat('e4', 32), 'hex')
);
select * from identity.issue_staff_invitation(
  '019af000-0000-7000-8000-000000000006', (select organization_id from resend_gym),
  'email', 'dup@example.test', 'staff', extensions.digest('T-IDN-RESEND-01 c6', 'sha256'), 1::smallint,
  'e0000000-0000-4000-8000-000000000006', '019af000-0000-7000-8000-000000000506',
  decode(repeat('e6', 32), 'hex')
);

select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000008', true);
select * from identity.issue_staff_invitation(
  '019af000-0000-7000-8000-000000000008', (select organization_id from other_gym),
  'email', 'other@example.test', 'staff', extensions.digest('T-IDN-RESEND-01 c5', 'sha256'), 1::smallint,
  'e0000000-0000-4000-8000-000000000005', '019af000-0000-7000-8000-000000000505',
  decode(repeat('e5', 32), 'hex')
);

select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000009', true);
select set_config('app.actor_verified_email', 'joined@example.test', true);
select * from identity.decide_staff_invitation(
  '019af000-0000-7000-8000-000000000009', extensions.digest('T-IDN-RESEND-01 c4', 'sha256'),
  (select intent.id from identity.invitation_intents as intent
   where intent.invitation_id = '019af000-0000-7000-8000-000000000504'),
  'accepted', 'e0000000-0000-4000-8000-000000000014', '019af000-0000-7000-8000-000000000514',
  decode(repeat('f4', 32), 'hex')
);

select set_config('app.actor_kind', '', true);
select set_config('app.actor_person_id', '', true);
select set_config('app.actor_verified_email', '', true);

update identity.invitations as invitation
set created_at = clock_timestamp() - interval '8 days',
    expires_at = clock_timestamp() - interval '1 day'
where invitation.id in (
  '019af000-0000-7000-8000-000000000502', '019af000-0000-7000-8000-000000000506'
);

-- The owner invites dup@ again: an equal invitation is now pending.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000006', true);
select * from identity.issue_staff_invitation(
  '019af000-0000-7000-8000-000000000006', (select organization_id from resend_gym),
  'email', 'dup@example.test', 'staff', extensions.digest('T-IDN-RESEND-01 c7', 'sha256'), 1::smallint,
  'e0000000-0000-4000-8000-000000000007', '019af000-0000-7000-8000-000000000507',
  decode(repeat('e7', 32), 'hex')
);
select set_config('app.actor_kind', '', true);
select set_config('app.actor_person_id', '', true);

-- ---------------------------------------------------------------------------
-- Who resends
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select identity.list_backoffice_team_invitations(
    '019af000-0000-7000-8000-000000000005', '019af000-0000-7000-8000-000000000045',
    (select organization_id from resend_gym)
  ) $$,
  '42501',
  null,
  'the base role alone does not see a gym''s invitations'
);

select throws_ok(
  $$ select * from identity.resend_team_invitation(
    '019af000-0000-7000-8000-000000000004', '019af000-0000-7000-8000-000000000044',
    (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000501',
    extensions.digest('T-IDN-RESEND-01 a1', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000001', '019af000-0000-7000-8000-000000000600',
    extensions.digest('T-IDN-RESEND-01 a1', 'sha256')
  ) $$,
  '42501',
  null,
  'the lifecycle duty does not resend a team invitation'
);

select throws_ok(
  $$ select identity.list_backoffice_team_invitations(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000045',
    (select organization_id from resend_gym)
  ) $$,
  '42501',
  null,
  'a session that is not the operator''s own opens nothing'
);

-- ---------------------------------------------------------------------------
-- What support sees
-- ---------------------------------------------------------------------------

create temporary table support_listing on commit drop as
select identity.list_backoffice_team_invitations(
  '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
  (select organization_id from resend_gym)
) as listing;

select is(
  (select jsonb_array_length(listing->'items') from support_listing),
  6,
  'support sees the gym''s team invitations and none from another gym'
);

select is(
  (select array_agg(item->>'invitation_id' order by item->>'invitation_id')
   from support_listing, jsonb_array_elements(listing->'items') as item
   where (item->>'resendable')::boolean),
  array[
    '019af000-0000-7000-8000-000000000501',
    '019af000-0000-7000-8000-000000000502',
    '019af000-0000-7000-8000-000000000507'
  ],
  'only a live invitation or an expired one without an equal pending one can be resent'
);

select is(
  (select array_agg((item->>'invitation_id') || ':' || (item->>'state')
                    order by item->>'invitation_id')
   from support_listing, jsonb_array_elements(listing->'items') as item),
  array[
    '019af000-0000-7000-8000-000000000501:pending',
    '019af000-0000-7000-8000-000000000502:expired',
    '019af000-0000-7000-8000-000000000503:revoked',
    '019af000-0000-7000-8000-000000000504:accepted',
    '019af000-0000-7000-8000-000000000506:expired',
    '019af000-0000-7000-8000-000000000507:pending'
  ],
  'each invitation says whether it is pending, expired, revoked or accepted'
);

select ok(
  (select position('live.coach@' in listing::text) = 0
     and position('eta.invitee@' in listing::text) = 0
     and exists (
       select 1 from jsonb_array_elements(listing->'items') as item
       where item->>'invitation_id' = '019af000-0000-7000-8000-000000000501'
         and item->>'contact_hint' = 'l***@example.test'
     )
   from support_listing),
  'contacts are masked, never shown in full'
);

select throws_ok(
  $$ select identity.list_backoffice_team_invitations(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    '019af000-0000-7000-8000-000000009999'
  ) $$,
  'P0002',
  null,
  'a gym that does not exist has no invitations'
);

select is(
  (select count(*)::integer from privacy.access_events as event
   where event.actor_person_id = '019af000-0000-7000-8000-000000000003'),
  0,
  'listing invitations records no access, because an invitation names no person yet'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — a live invitation goes out again as it is
-- ---------------------------------------------------------------------------

create temporary table live_before on commit drop as
select invitation.expires_at from identity.invitations as invitation
where invitation.id = '019af000-0000-7000-8000-000000000501';

create temporary table redelivered on commit drop as
select * from identity.resend_team_invitation(
  '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
  (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000501',
  extensions.digest('T-IDN-RESEND-01 a2', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000002', '019af000-0000-7000-8000-000000000601',
  extensions.digest('T-IDN-RESEND-01 a2', 'sha256')
);

select ok(
  (select result->>'outcome' = 'redelivered'
     and result->>'invitation_id' = '019af000-0000-7000-8000-000000000501'
     and not replayed
   from redelivered),
  'a live invitation is sent again as the same invitation'
);

select ok(
  not exists (
    select 1 from identity.invitations as invitation
    where invitation.id = '019af000-0000-7000-8000-000000000601'
  )
  and (select invitation.expires_at from identity.invitations as invitation
       where invitation.id = '019af000-0000-7000-8000-000000000501')
      > (select expires_at from live_before),
  'redelivering creates no invitation and gives the same one its full validity again'
);

select is(
  (select count(*)::integer from system.outbox_events as event
   where event.event_type = 'organization.staff_invited.v1'
     and event.aggregate_id = '019af000-0000-7000-8000-000000000501'),
  2,
  'the invitation email is queued again for the same invitation'
);

select ok(
  (select count(*) = 1
     and bool_and(resend.delivered_invitation_id = resend.invitation_id
                  and resend.kind = 'membership'
                  and resend.outcome = 'redelivered'
                  and resend.actor_person_id = '019af000-0000-7000-8000-000000000003'
                  and resend.actor_duty_assignment_id = (
                    select assignment.id from support.platform_duty_assignments as assignment
                    where assignment.person_id = '019af000-0000-7000-8000-000000000003'
                  ))
   from identity.invitation_resends as resend
   where resend.invitation_id = '019af000-0000-7000-8000-000000000501'),
  'the resend is recorded with what was sent, who sent it and under which duty'
);

-- ---------------------------------------------------------------------------
-- Criteria 3 and 5 — an expired invitation is replaced by an identical one
-- ---------------------------------------------------------------------------

create temporary table reissued on commit drop as
select * from identity.resend_team_invitation(
  '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
  (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000502',
  extensions.digest('T-IDN-RESEND-01 a3', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000003', '019af000-0000-7000-8000-000000000602',
  extensions.digest('T-IDN-RESEND-01 a3', 'sha256')
);

select ok(
  (select result->>'outcome' = 'reissued'
     and result->>'invitation_id' = '019af000-0000-7000-8000-000000000602'
     and result->>'state' = 'pending'
   from reissued),
  'an expired invitation is replaced by a new one'
);

select ok(
  (select renewed.organization_id = original.organization_id
     and renewed.contact = original.contact
     and renewed.channel = original.channel
     and renewed.proposal_hash = original.proposal_hash
     and renewed.status = 'pending'
     and renewed.expires_at > clock_timestamp()
     and (select intent.proposed_role_code from identity.invitation_intents as intent
          where intent.invitation_id = renewed.id) = 'staff'
   from identity.invitations as renewed
   join identity.invitations as original on original.id = '019af000-0000-7000-8000-000000000502'
   where renewed.id = '019af000-0000-7000-8000-000000000602'),
  'the new invitation keeps the gym, the contact and the role'
);

select ok(
  (select invitation.status = 'expired'
     and (select intent.status from identity.invitation_intents as intent
          where intent.invitation_id = invitation.id) = 'expired'
   from identity.invitations as invitation
   where invitation.id = '019af000-0000-7000-8000-000000000502'),
  'the expired invitation stays expired and never works again'
);

select ok(
  (select invitation.issued_by_membership_id is null
     and invitation.issued_by_person_id = '019af000-0000-7000-8000-000000000003'
     and invitation.issued_by_duty_assignment_id is not null
     and invitation.reissues_invitation_id = '019af000-0000-7000-8000-000000000502'
   from identity.invitations as invitation
   where invitation.id = '019af000-0000-7000-8000-000000000602'),
  'the new invitation is signed by Allfit and points at the one it replaces'
);

select is(
  (select count(*)::integer from system.outbox_events as event
   where event.event_type = 'organization.staff_invited.v1'
     and event.aggregate_id = '019af000-0000-7000-8000-000000000602'),
  1,
  'the new invitation email is queued'
);

select ok(
  exists (
    select 1 from identity.invitation_resends as resend
    where resend.invitation_id = '019af000-0000-7000-8000-000000000502'
      and resend.delivered_invitation_id = '019af000-0000-7000-8000-000000000602'
      and resend.outcome = 'reissued'
      and resend.kind = 'membership'
  ),
  'the reissue is recorded against the invitation it replaced'
);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000007', true);
select set_config('app.actor_verified_email', 'eta.invitee@example.test', true);
create temporary table reissue_accepted on commit drop as
select * from identity.decide_staff_invitation(
  '019af000-0000-7000-8000-000000000007', extensions.digest('T-IDN-RESEND-01 a3', 'sha256'),
  (select intent.id from identity.invitation_intents as intent
   where intent.invitation_id = '019af000-0000-7000-8000-000000000602'),
  'accepted', 'a0000000-0000-4000-8000-000000000033', '019af000-0000-7000-8000-000000000633',
  decode(repeat('b3', 32), 'hex')
);
select set_config('app.actor_kind', '', true);
select set_config('app.actor_person_id', '', true);
select set_config('app.actor_verified_email', '', true);

select ok(
  (select intent_status = 'accepted' from reissue_accepted)
  and exists (
    select 1
    from organizations.organization_memberships as membership
    join organizations.membership_roles as membership_role
      on membership_role.membership_id = membership.id
    where membership.organization_id = (select organization_id from resend_gym)
      and membership.person_id = '019af000-0000-7000-8000-000000000007'
      and membership_role.role_code = 'staff'
  ),
  'the person accepts the reissued invitation and joins with the role first proposed'
);

-- ---------------------------------------------------------------------------
-- What is never resent
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from identity.resend_team_invitation(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000503',
    extensions.digest('T-IDN-RESEND-01 a4', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000004', '019af000-0000-7000-8000-000000000604',
    extensions.digest('T-IDN-RESEND-01 a4', 'sha256')
  ) $$,
  '55000',
  null,
  'a revoked invitation is not resent: the gym withdrew it'
);

select throws_ok(
  $$ select * from identity.resend_team_invitation(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000504',
    extensions.digest('T-IDN-RESEND-01 a5', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000005', '019af000-0000-7000-8000-000000000605',
    extensions.digest('T-IDN-RESEND-01 a5', 'sha256')
  ) $$,
  '55000',
  null,
  'an accepted invitation is not resent'
);

select throws_ok(
  $$ select * from identity.resend_team_invitation(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000505',
    extensions.digest('T-IDN-RESEND-01 a6', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000006', '019af000-0000-7000-8000-000000000606',
    extensions.digest('T-IDN-RESEND-01 a6', 'sha256')
  ) $$,
  'P0002',
  null,
  'an invitation from another gym is not found under this one'
);

select throws_ok(
  $$ select * from identity.resend_team_invitation(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000506',
    extensions.digest('T-IDN-RESEND-01 a7', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000007', '019af000-0000-7000-8000-000000000607',
    extensions.digest('T-IDN-RESEND-01 a7', 'sha256')
  ) $$,
  '55000',
  null,
  'an expired invitation is not reissued while an equal one is already pending'
);

select throws_ok(
  $$ select * from identity.resend_team_invitation(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000502',
    extensions.digest('T-IDN-RESEND-01 a8', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000008', '019af000-0000-7000-8000-000000000608',
    extensions.digest('T-IDN-RESEND-01 a8', 'sha256')
  ) $$,
  '55000',
  null,
  'an invitation already reissued is not reissued again'
);

-- ---------------------------------------------------------------------------
-- Retries and limits
-- ---------------------------------------------------------------------------

select ok(
  (select replayed and result->>'invitation_id' = '019af000-0000-7000-8000-000000000501'
   from identity.resend_team_invitation(
     '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
     (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000501',
     extensions.digest('T-IDN-RESEND-01 a2', 'sha256'), 1::smallint,
     'a0000000-0000-4000-8000-000000000002', '019af000-0000-7000-8000-000000000601',
     extensions.digest('T-IDN-RESEND-01 a2', 'sha256')
   ))
  and (select count(*) = 2 from system.outbox_events as event
       where event.event_type = 'organization.staff_invited.v1'
         and event.aggregate_id = '019af000-0000-7000-8000-000000000501')
  and (select count(*) = 1 from identity.invitation_resends as resend
       where resend.invitation_id = '019af000-0000-7000-8000-000000000501'),
  'a retried resend answers the same result and sends nothing more'
);

select * from identity.resend_team_invitation(
  '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
  (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000501',
  extensions.digest('T-IDN-RESEND-01 a9', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000009', '019af000-0000-7000-8000-000000000609',
  extensions.digest('T-IDN-RESEND-01 a9', 'sha256')
);
select * from identity.resend_team_invitation(
  '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
  (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000501',
  extensions.digest('T-IDN-RESEND-01 aa', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000010', '019af000-0000-7000-8000-000000000610',
  extensions.digest('T-IDN-RESEND-01 aa', 'sha256')
);

select throws_ok(
  $$ select * from identity.resend_team_invitation(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    (select organization_id from resend_gym), '019af000-0000-7000-8000-000000000501',
    extensions.digest('T-IDN-RESEND-01 ab', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000011', '019af000-0000-7000-8000-000000000611',
    extensions.digest('T-IDN-RESEND-01 ab', 'sha256')
  ) $$,
  'P0001',
  null,
  'support is held to the same daily limit per destination as the gym'
);

-- ---------------------------------------------------------------------------
-- The database keeps a reissue identical, even for the table owner
-- ---------------------------------------------------------------------------

insert into identity.invitations (
  id, organization_id, issued_by_person_id, issued_by_duty_assignment_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party, expires_at
)
select '019af000-0000-7000-8000-000000000701', invitation.organization_id,
       '019af000-0000-7000-8000-000000000003',
       (select assignment.id from support.platform_duty_assignments as assignment
        where assignment.person_id = '019af000-0000-7000-8000-000000000003'),
       'email', 'fresh@example.test', extensions.digest('T-IDN-RESEND-01 71', 'sha256'), 1,
       decode(repeat('72', 32), 'hex'), invitation.responsible_party,
       clock_timestamp() + interval '7 days'
from identity.invitations as invitation
where invitation.id = '019af000-0000-7000-8000-000000000501';

select throws_ok(
  $$ insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
     values ('019af000-0000-7000-8000-000000000701', 'membership', 'staff') $$,
  '23514',
  null,
  'Allfit cannot author a team invitation that replaces none'
);

insert into identity.invitations (
  id, organization_id, issued_by_person_id, issued_by_duty_assignment_id,
  reissues_invitation_id, channel, contact, token_hash, token_key_version, proposal_hash,
  responsible_party, expires_at
)
select '019af000-0000-7000-8000-000000000702', invitation.organization_id,
       invitation.issued_by_person_id, invitation.issued_by_duty_assignment_id,
       '019af000-0000-7000-8000-000000000502', 'email', 'eta.invitee@example.test',
       extensions.digest('T-IDN-RESEND-01 73', 'sha256'), 1,
       (select original.proposal_hash from identity.invitations as original
        where original.id = '019af000-0000-7000-8000-000000000502'),
       invitation.responsible_party, clock_timestamp() + interval '7 days'
from identity.invitations as invitation
where invitation.id = '019af000-0000-7000-8000-000000000701';

select throws_ok(
  $$ insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
     values ('019af000-0000-7000-8000-000000000702', 'membership', 'coach') $$,
  '23514',
  null,
  'a reissue cannot propose a different role'
);

select throws_ok(
  $$ insert into identity.invitations (
       id, organization_id, issued_by_person_id, issued_by_duty_assignment_id,
       reissues_invitation_id, channel, contact, token_hash, token_key_version, proposal_hash,
       responsible_party, expires_at
     )
     select '019af000-0000-7000-8000-000000000703', invitation.organization_id,
            invitation.issued_by_person_id, invitation.issued_by_duty_assignment_id,
            '019af000-0000-7000-8000-000000000506', 'email', 'someone.else@example.test',
            extensions.digest('T-IDN-RESEND-01 74', 'sha256'), 1,
            (select original.proposal_hash from identity.invitations as original
             where original.id = '019af000-0000-7000-8000-000000000506'),
            invitation.responsible_party, clock_timestamp() + interval '7 days'
     from identity.invitations as invitation
     where invitation.id = '019af000-0000-7000-8000-000000000702' $$,
  '23514',
  null,
  'a reissue cannot go to a different contact'
);

select throws_ok(
  $$ update identity.invitation_resends set outcome = 'reissued' $$,
  '55000',
  null,
  'the resend record cannot be rewritten'
);

select throws_ok(
  $$ delete from identity.invitation_resends $$,
  '55000',
  null,
  'the resend record cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- Criterion 6 — ownership resends are recorded the same way
-- ---------------------------------------------------------------------------

create temporary table handed_over on commit drop as
select * from organizations.create_unclaimed_organization(
  '019af000-0000-7000-8000-000000000004', '019af000-0000-7000-8000-000000000044',
  'Reenvío Dueño', 'gym', 'legal_entity', 'Reenvío Dueño SAS', null, null,
  'dueno@example.test', extensions.digest('T-IDN-RESEND-01 81', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000081', '019af000-0000-7000-8000-000000000801',
  extensions.digest('T-IDN-RESEND-01 81', 'sha256')
);

select * from organizations.resend_ownership_invitation(
  '019af000-0000-7000-8000-000000000004', '019af000-0000-7000-8000-000000000044',
  (select (result->>'organization_id')::uuid from handed_over),
  extensions.digest('T-IDN-RESEND-01 82', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000082', '019af000-0000-7000-8000-000000000802',
  extensions.digest('T-IDN-RESEND-01 82', 'sha256')
);

select ok(
  exists (
    select 1 from identity.invitation_resends as resend
    where resend.invitation_id = '019af000-0000-7000-8000-000000000801'
      and resend.delivered_invitation_id = '019af000-0000-7000-8000-000000000801'
      and resend.kind = 'ownership'
      and resend.outcome = 'redelivered'
      and resend.actor_person_id = '019af000-0000-7000-8000-000000000004'
  ),
  'resending a live ownership invitation is recorded as a redelivery'
);

update identity.invitations as invitation
set created_at = clock_timestamp() - interval '8 days',
    expires_at = clock_timestamp() - interval '1 day'
where invitation.id = '019af000-0000-7000-8000-000000000801';

select * from organizations.resend_ownership_invitation(
  '019af000-0000-7000-8000-000000000004', '019af000-0000-7000-8000-000000000044',
  (select (result->>'organization_id')::uuid from handed_over),
  extensions.digest('T-IDN-RESEND-01 83', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000083', '019af000-0000-7000-8000-000000000803',
  extensions.digest('T-IDN-RESEND-01 83', 'sha256')
);

select ok(
  exists (
    select 1 from identity.invitation_resends as resend
    where resend.invitation_id = '019af000-0000-7000-8000-000000000801'
      and resend.delivered_invitation_id = '019af000-0000-7000-8000-000000000803'
      and resend.kind = 'ownership'
      and resend.outcome = 'reissued'
  )
  and (select invitation.reissues_invitation_id = '019af000-0000-7000-8000-000000000801'
       from identity.invitations as invitation
       where invitation.id = '019af000-0000-7000-8000-000000000803'),
  'reissuing a lapsed ownership invitation is recorded and linked to the one it replaces'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'allfit_api', 'identity.list_backoffice_team_invitations(uuid,uuid,uuid)', 'EXECUTE'
  )
  and has_function_privilege(
    'allfit_api',
    'identity.resend_team_invitation(uuid,uuid,uuid,uuid,bytea,smallint,uuid,uuid,bytea)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'allfit_api', 'identity.require_invitation_resender(uuid,uuid)', 'EXECUTE'
  )
  and not has_table_privilege('allfit_api', 'identity.invitation_resends', 'SELECT')
  and not has_table_privilege('allfit_api', 'identity.invitations', 'SELECT'),
  'the runtime role lists and resends through the functions, never the tables'
);

select * from finish();
rollback;
