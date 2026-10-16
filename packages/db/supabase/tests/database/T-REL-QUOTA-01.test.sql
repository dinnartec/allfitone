-- T-REL-QUOTA-01 — OP-REL-001 against the guest quota (`HU-STUDIO-087`).
--
-- `OP-IDN-051` is held to the same quota, and that is asserted where that command
-- already has its file: `T-IDN-CLIENT-RESEND-01`.
--
-- A gym holds as many people as Allfit sold it, and an invitation that would take a
-- place the gym does not have is refused before anything is written.
--
-- **A coach is refused too.** A coach holds `invite_clients` and not `view_directory`,
-- so the ordinary read policy shows a coach only the relationships assigned to them.
-- Counted under that policy a coach would see a half-empty gym and the quota would be
-- bypassed by the role that invites most clients. That case is asserted on its own.
--
-- **What frees a place is asserted one cause at a time.** A rejected invitation, a
-- revoked one, one that ran out of time and a terminated relationship each free
-- exactly the place they held, and the next invitation then succeeds.
--
-- **Reusing an invitation is not taking another place.** Re-sending the same offer to
-- the same contact reuses the pending invitation, so a full gym is not refused it.
--
-- **A retry is not a new invitation.** Replaying `OP-REL-001` with the original
-- command after the gym filled returns the original receipt instead of refusing it.
--
-- **Lowering the quota ends nothing.** It only closes the door behind the people
-- already inside.

begin;

select plan(27);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b3000-0000-7000-8000-000000000001', 'Ana', 'Client', 'active'),
  ('019b3000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019b3000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active'),
  ('019b3000-0000-7000-8000-000000000021', 'Xavier', 'Invitee', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019b3000-0000-7000-8000-000000000101', 'gym', 'Quota Gym',
    '{"party_kind":"legal_entity","party_name":"Quota SAS","purpose":"studio_operations"}'),
  ('019b3000-0000-7000-8000-000000000102', 'gym', 'Unlimited Gym',
    '{"party_kind":"legal_entity","party_name":"Unlimited SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019b3000-0000-7000-8000-000000000201', '019b3000-0000-7000-8000-000000000101',
    '019b3000-0000-7000-8000-000000000011', 'active'),
  ('019b3000-0000-7000-8000-000000000202', '019b3000-0000-7000-8000-000000000101',
    '019b3000-0000-7000-8000-000000000012', 'active'),
  ('019b3000-0000-7000-8000-000000000203', '019b3000-0000-7000-8000-000000000102',
    '019b3000-0000-7000-8000-000000000011', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values
  ('019b3000-0000-7000-8000-000000000201', 'owner'),
  ('019b3000-0000-7000-8000-000000000202', 'coach'),
  ('019b3000-0000-7000-8000-000000000203', 'owner');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019b3000-0000-7000-8000-000000000301', 'body_progress', 1, 'published', clock_timestamp());

-- One live client, never assigned to the coach. Two places of two are sold.
insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019b3000-0000-7000-8000-000000000401', '019b3000-0000-7000-8000-000000000001',
  '019b3000-0000-7000-8000-000000000101', 'active');
update organizations.organizations set guest_quota_seats = 2
where id = '019b3000-0000-7000-8000-000000000101';

-- The n-th invitation: the same n is the same command and the same request.
create function pg_temp.invite(p_actor uuid, p_organization uuid, p_email text, p_n integer)
returns table (invitation_id uuid, reused boolean, replayed boolean)
language sql
as $$
  select issued.invitation_id, issued.reused, issued.replayed
  from identity.issue_client_invitation(
    p_actor, p_organization, 'email', p_email,
    '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
       "presented_snapshot":{"title":"Progreso"}}]'::jsonb,
    extensions.digest('token-' || p_email, 'sha256'), 1::smallint,
    ('019b3000-0000-7000-8000-' || lpad(p_n::text, 12, '0'))::uuid,
    ('019b3000-0000-7000-8000-' || lpad(p_n::text, 12, '0'))::uuid,
    extensions.digest('request-' || p_n::text, 'sha256')
  ) as issued
$$;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000011', true),
       set_config('app.actor_org_id', '019b3000-0000-7000-8000-000000000101', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

-- Each place that is taken, and only those.
select is(
  (select occupied from organizations.organization_guest_occupancy('019b3000-0000-7000-8000-000000000101')),
  1,
  'one live relationship takes one place'
);

select lives_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x1@example.test', 9001)$$,
  'the owner invites while a place is left'
);

select is(
  (select occupied from organizations.organization_guest_occupancy('019b3000-0000-7000-8000-000000000101')),
  2,
  'an unanswered invitation takes the second place'
);

select throws_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x2@example.test', 9002)$$,
  '55000',
  'the gym has no places left in its guest quota',
  'with no places left the owner is refused'
);

select is(
  (select count(*) from identity.invitations
   where organization_id = '019b3000-0000-7000-8000-000000000101'),
  1::bigint,
  'and the refusal wrote nothing'
);

-- The coach: the point of counting under a purpose-scoped policy.
select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000012', true);

select is(
  (select occupied from organizations.organization_guest_occupancy('019b3000-0000-7000-8000-000000000101')),
  2,
  'a coach with no assignment still counts the whole gym'
);

select throws_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000012',
      '019b3000-0000-7000-8000-000000000101', 'x2@example.test', 9003)$$,
  '55000',
  'the gym has no places left in its guest quota',
  'with no places left a coach is refused as well'
);

select is(
  (select count(*) from identity.invitations
   where organization_id = '019b3000-0000-7000-8000-000000000101'),
  1::bigint,
  'and the coach wrote nothing either'
);

-- Reuse and retry hold a place already, so neither is refused.
select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000011', true);

select is(
  (select reused from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x1@example.test', 9004)),
  true,
  'the same offer to the same contact is reused, not refused, in a full gym'
);

select is(
  (select replayed from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x1@example.test', 9001)),
  true,
  'replaying the original command after the gym filled returns its receipt'
);

select is(
  (select count(*) from identity.invitations
   where organization_id = '019b3000-0000-7000-8000-000000000101'),
  1::bigint,
  'and neither took another place'
);

-- No quota is no limit.
select set_config('app.actor_org_id', '019b3000-0000-7000-8000-000000000102', true);

select lives_ok(
  $$select pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000102', 'u1@example.test', 9011),
     pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000102', 'u2@example.test', 9012),
     pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000102', 'u3@example.test', 9013)$$,
  'a gym with no quota is never refused'
);

select set_config('app.actor_org_id', '019b3000-0000-7000-8000-000000000101', true);

-- Cause 1: the person declines.
select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000021', true),
       set_config('app.actor_verified_email', 'x1@example.test', true);
select lives_ok(
  $$select * from identity.decide_client_invitation(
      '019b3000-0000-7000-8000-000000000021',
      extensions.digest('token-x1@example.test', 'sha256'),
      (select intent.id from identity.invitation_intents as intent
         join identity.invitations as invitation on invitation.id = intent.invitation_id
         where invitation.contact::text = 'x1@example.test' and intent.kind = 'service_relationship'),
      'rejected', '{}'::jsonb,
      '019b3000-0000-7000-8000-000000009101',
      '019b3000-0000-7000-8000-000000009101',
      extensions.digest('request-decline', 'sha256')
    )$$,
  'the person declines the invitation'
);
select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000011', true);
select is(
  (select occupied from organizations.organization_guest_occupancy('019b3000-0000-7000-8000-000000000101')),
  1,
  'a declined invitation frees its place'
);
select lives_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x2@example.test', 9005)$$,
  'and the next invitation takes it'
);

-- Cause 2: the invitation is revoked.
update identity.invitation_intents set status = 'revoked', decided_at = clock_timestamp()
where invitation_id = '019b3000-0000-7000-8000-000000009005';
update identity.invitations set status = 'revoked'
where id = '019b3000-0000-7000-8000-000000009005';
select is(
  (select occupied from organizations.organization_guest_occupancy('019b3000-0000-7000-8000-000000000101')),
  1,
  'a revoked invitation frees its place'
);
select lives_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x3@example.test', 9006)$$,
  'and the next invitation takes it'
);

-- Cause 3: the invitation runs out of time, with no sweep having relabelled it yet.
update identity.invitations
set created_at = clock_timestamp() - interval '2 minutes',
    expires_at = clock_timestamp() - interval '1 minute'
where id = '019b3000-0000-7000-8000-000000009006';
select is(
  (select occupied from organizations.organization_guest_occupancy('019b3000-0000-7000-8000-000000000101')),
  1,
  'a lapsed invitation frees its place before anything relabels it'
);
select lives_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x4@example.test', 9007)$$,
  'and the next invitation takes it'
);

-- Cause 4: the relationship ends.
update relationships.service_relationships
set status = 'terminated', ended_at = clock_timestamp(), ended_reason = 'left'
where id = '019b3000-0000-7000-8000-000000000401';
select is(
  (select occupied from organizations.organization_guest_occupancy('019b3000-0000-7000-8000-000000000101')),
  1,
  'a terminated relationship frees its place'
);
select lives_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x5@example.test', 9008)$$,
  'and the next invitation takes it'
);

-- Full again; Allfit now lowers the quota below what the gym holds.
select is(
  (select occupied from organizations.organization_guest_occupancy('019b3000-0000-7000-8000-000000000101')),
  2,
  'the gym is full once more'
);
update organizations.organizations set guest_quota_seats = 1
where id = '019b3000-0000-7000-8000-000000000101';

select is(
  (select count(*) from identity.invitations
   where organization_id = '019b3000-0000-7000-8000-000000000101' and status = 'pending'
     and expires_at > clock_timestamp()),
  2::bigint,
  'lowering the quota ended no invitation'
);
select is(
  (organizations.guest_quota_projection('019b3000-0000-7000-8000-000000000101')->>'over_quota')::boolean,
  true,
  'the gym is over its quota and says so'
);
select throws_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x6@example.test', 9009)$$,
  '55000',
  'the gym has no places left in its guest quota',
  'but it can invite nobody new'
);
select is(
  (select reused from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x5@example.test', 9010)),
  true,
  'while what it already offered stays in force and may be reused'
);

-- Lifting the limit opens the door again.
update organizations.organizations set guest_quota_seats = null
where id = '019b3000-0000-7000-8000-000000000101';
select lives_ok(
  $$select * from pg_temp.invite('019b3000-0000-7000-8000-000000000011',
      '019b3000-0000-7000-8000-000000000101', 'x6@example.test', 9009)$$,
  'removing the quota lets the gym invite again'
);

select * from finish();

rollback;
