begin;

select plan(29);

insert into identity.people (id, given_name, family_name)
values
  ('0199c000-0000-7000-8000-000000000001', 'Olivia', 'Owner'),
  ('0199c000-0000-7000-8000-000000000002', 'Alex', 'Invitee'),
  ('0199c000-0000-7000-8000-000000000003', 'Robin', 'Rejector'),
  ('0199c000-0000-7000-8000-000000000004', 'Sam', 'Existing'),
  ('0199c000-0000-7000-8000-000000000005', 'Casey', 'Coach');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);

create temporary table invitation_lifecycle_organization as
select *
from organizations.create_organization(
  '0199c000-0000-7000-8000-000000000001',
  'Studio Invitation Lifecycle',
  'studio',
  'natural_person',
  'Ignored',
  'c1111111-1111-4111-8111-111111111111',
  '0199c000-0000-7000-8000-000000000011',
  decode(repeat('c1', 32), 'hex')
);

create temporary table accepted_invitation as
select * from identity.issue_staff_invitation(
  '0199c000-0000-7000-8000-000000000001',
  (select organization_id from invitation_lifecycle_organization),
  'email', 'alex@example.test', 'staff', decode(repeat('11', 32), 'hex'), 1::smallint,
  'c2222222-2222-4222-8222-222222222222',
  '0199c000-0000-7000-8000-000000000021',
  decode(repeat('c2', 32), 'hex')
);

select set_config('app.actor_kind', 'anonymous', true);
select is(
  (select count(*) from identity.resolve_staff_invitation(decode(repeat('11', 32), 'hex'))),
  1::bigint,
  'a pending token resolves to one Studio presentation'
);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000002', true);
select set_config('app.actor_verified_email', 'alex@example.test', true);

create temporary table accepted_decision as
select * from identity.decide_staff_invitation(
  '0199c000-0000-7000-8000-000000000002',
  decode(repeat('11', 32), 'hex'),
  (select invitation_intent_id from accepted_invitation),
  'accepted',
  'c3333333-3333-4333-8333-333333333333',
  '0199c000-0000-7000-8000-000000000022',
  decode(repeat('c3', 32), 'hex')
);

reset role;
select is((select intent_status from accepted_decision), 'accepted', 'the invited person accepts');
select is(
  (select count(*) from organizations.organization_memberships
   where organization_id = (select organization_id from invitation_lifecycle_organization)
     and person_id = '0199c000-0000-7000-8000-000000000002' and status = 'active'),
  1::bigint,
  'acceptance creates one active membership'
);
select is(
  (select count(*) from organizations.membership_roles
   where membership_id = (select membership_id from accepted_decision)
     and role_code = 'staff' and valid_to is null),
  1::bigint,
  'acceptance assigns the proposed role once'
);
select is(
  (select count(*) from organizations.membership_events
   where membership_id = (select membership_id from accepted_decision)
     and event_type = 'organization.role_granted.v1'),
  1::bigint,
  'new invitation acceptances emit the canonical role-granted event'
);
select is(
  (select materialized_membership_id from identity.invitation_intents
   where id = (select invitation_intent_id from accepted_invitation)),
  (select membership_id from accepted_decision),
  'the intent records its materialized membership'
);
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000002', true);
select set_config('app.actor_verified_email', 'alex@example.test', true);
select results_eq(
  $$
    select intent_status, membership_id, replayed
    from identity.decide_staff_invitation(
      '0199c000-0000-7000-8000-000000000002', decode(repeat('11', 32), 'hex'),
      (select invitation_intent_id from accepted_invitation), 'accepted',
      'c3333333-3333-4333-8333-333333333333',
      '0199c000-0000-7000-8000-000000000022', decode(repeat('c3', 32), 'hex')
    )
  $$,
  $$ select 'accepted'::text, membership_id, true from accepted_decision $$,
  'the same decision command replays its durable result'
);
select throws_ok(
  $$
    select * from identity.decide_staff_invitation(
      '0199c000-0000-7000-8000-000000000002', decode(repeat('11', 32), 'hex'),
      (select invitation_intent_id from accepted_invitation), 'accepted',
      'c4444444-4444-4444-8444-444444444444',
      '0199c000-0000-7000-8000-000000000023', decode(repeat('c4', 32), 'hex')
    )
  $$,
  'P0002', null,
  'a new command cannot decide a completed invitation'
);
select set_config('app.actor_kind', 'anonymous', true);
select is(
  (select count(*) from identity.resolve_staff_invitation(decode(repeat('11', 32), 'hex'))),
  0::bigint,
  'a completed invitation is indistinguishable from an invalid token'
);

reset role;
insert into organizations.organization_memberships (
  id, organization_id, person_id, joined_at
)
select
  '0199c000-0000-7000-8000-000000000031', organization_id,
  '0199c000-0000-7000-8000-000000000004', '2026-01-15T12:00:00Z'::timestamptz
from invitation_lifecycle_organization;

insert into organizations.organization_memberships (id, organization_id, person_id)
select '0199c000-0000-7000-8000-000000000032', organization_id, '0199c000-0000-7000-8000-000000000005'
from invitation_lifecycle_organization;
insert into organizations.membership_roles (membership_id, role_code)
values ('0199c000-0000-7000-8000-000000000032', 'coach');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);

create temporary table existing_invitation as
select * from identity.issue_staff_invitation(
  '0199c000-0000-7000-8000-000000000001',
  (select organization_id from invitation_lifecycle_organization),
  'email', 'sam@example.test', 'coach', decode(repeat('12', 32), 'hex'), 1::smallint,
  'c5555555-5555-4555-8555-555555555555',
  '0199c000-0000-7000-8000-000000000024',
  decode(repeat('c5', 32), 'hex')
);

select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000004', true);
select set_config('app.actor_verified_email', 'sam@example.test', true);
create temporary table existing_decision as
select * from identity.decide_staff_invitation(
  '0199c000-0000-7000-8000-000000000004', decode(repeat('12', 32), 'hex'),
  (select invitation_intent_id from existing_invitation), 'accepted',
  'c6666666-6666-4666-8666-666666666666',
  '0199c000-0000-7000-8000-000000000025', decode(repeat('c6', 32), 'hex')
);

reset role;
select is(
  (select membership_id from existing_decision),
  '0199c000-0000-7000-8000-000000000031'::uuid,
  'acceptance reuses an existing active membership'
);
select is(
  (select joined_at from organizations.organization_memberships
   where id = '0199c000-0000-7000-8000-000000000031'),
  '2026-01-15T12:00:00Z'::timestamptz,
  'reusing a membership preserves joined_at'
);
select is(
  (select count(*) from organizations.membership_roles
   where membership_id = '0199c000-0000-7000-8000-000000000031'
     and role_code = 'coach' and valid_to is null),
  1::bigint,
  'a missing role is assigned exactly once'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);
create temporary table rejected_invitation as
select * from identity.issue_staff_invitation(
  '0199c000-0000-7000-8000-000000000001',
  (select organization_id from invitation_lifecycle_organization),
  'email', 'robin@example.test', 'staff', decode(repeat('13', 32), 'hex'), 1::smallint,
  'c7777777-7777-4777-8777-777777777777',
  '0199c000-0000-7000-8000-000000000026', decode(repeat('c7', 32), 'hex')
);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000003', true);
select set_config('app.actor_verified_email', 'robin@example.test', true);
create temporary table rejected_decision as
select * from identity.decide_staff_invitation(
  '0199c000-0000-7000-8000-000000000003', decode(repeat('13', 32), 'hex'),
  (select invitation_intent_id from rejected_invitation), 'rejected',
  'c8888888-8888-4888-8888-888888888888',
  '0199c000-0000-7000-8000-000000000027', decode(repeat('c8', 32), 'hex')
);
reset role;
select is((select intent_status from rejected_decision), 'rejected', 'the invited person can reject');
select is(
  (select count(*) from organizations.organization_memberships
   where organization_id = (select organization_id from invitation_lifecycle_organization)
     and person_id = '0199c000-0000-7000-8000-000000000003'),
  0::bigint,
  'rejection creates no membership'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);
create temporary table revocable_invitation as
select * from identity.issue_staff_invitation(
  '0199c000-0000-7000-8000-000000000001',
  (select organization_id from invitation_lifecycle_organization),
  'email', 'different@example.test', 'staff', decode(repeat('14', 32), 'hex'), 1::smallint,
  'c9999999-9999-4999-8999-999999999999',
  '0199c000-0000-7000-8000-000000000028', decode(repeat('c9', 32), 'hex')
);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000003', true);
select set_config('app.actor_verified_email', 'wrong@example.test', true);
select throws_ok(
  $$
    select * from identity.decide_staff_invitation(
      '0199c000-0000-7000-8000-000000000003', decode(repeat('14', 32), 'hex'),
      (select invitation_intent_id from revocable_invitation), 'accepted',
      'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '0199c000-0000-7000-8000-000000000029', decode(repeat('ca', 32), 'hex')
    )
  $$,
  '42501', null,
  'a different verified email cannot decide the invitation'
);

select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);
create temporary table revoked_result as
select * from identity.revoke_staff_invitation(
  '0199c000-0000-7000-8000-000000000001',
  (select organization_id from invitation_lifecycle_organization),
  (select invitation_id from revocable_invitation),
  'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '0199c000-0000-7000-8000-00000000002a', decode(repeat('cb', 32), 'hex')
);
select is((select status from revoked_result), 'revoked', 'an authorized team member revokes pending');
reset role;
select is(
  (select status::text from identity.invitation_intents
   where id = (select invitation_intent_id from revocable_invitation)),
  'revoked',
  'revocation closes the pending intent'
);
set local role allfit_api;
select set_config('app.actor_kind', 'anonymous', true);
select is(
  (select count(*) from identity.resolve_staff_invitation(decode(repeat('14', 32), 'hex'))),
  0::bigint,
  'a revoked token does not resolve'
);
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);
select lives_ok(
  $$
    select * from identity.revoke_staff_invitation(
      '0199c000-0000-7000-8000-000000000001',
      (select organization_id from invitation_lifecycle_organization),
      (select invitation_id from revocable_invitation),
      'cddddddd-dddd-4ddd-8ddd-dddddddddddd',
      '0199c000-0000-7000-8000-00000000002b', decode(repeat('cd', 32), 'hex')
    )
  $$,
  'revoking an already revoked invitation converges successfully'
);
reset role;
select is(
  (select count(*) from system.outbox_events
   where aggregate_id = (select invitation_id from revocable_invitation)
     and event_type = 'identity.invitation_revoked.v1'),
  1::bigint,
  'convergent revocation does not duplicate evidence'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);
select is(
  (select contact from identity.list_staff_invitations(
    '0199c000-0000-7000-8000-000000000001',
    (select organization_id from invitation_lifecycle_organization), null, 50, null, null
  ) where invitation_id = (select invitation_id from revocable_invitation)),
  'different@example.test',
  'the authorized issuer list returns the complete destination'
);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000005', true);
select throws_ok(
  $$
    select * from identity.list_staff_invitations(
      '0199c000-0000-7000-8000-000000000005',
      (select organization_id from invitation_lifecycle_organization), null, 50, null, null
    )
  $$,
  '42501', null,
  'a coach without invite capability cannot list invitation contacts'
);

select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);
create temporary table expiring_invitation as
select * from identity.issue_staff_invitation(
  '0199c000-0000-7000-8000-000000000001',
  (select organization_id from invitation_lifecycle_organization),
  'email', 'expired@example.test', 'staff', decode(repeat('15', 32), 'hex'), 1::smallint,
  'ceeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '0199c000-0000-7000-8000-00000000002c', decode(repeat('ce', 32), 'hex')
);
reset role;
update identity.invitations
set created_at = clock_timestamp() - interval '8 days',
    expires_at = clock_timestamp() - interval '1 day'
where id = (select invitation_id from expiring_invitation);
set local role allfit_api;
select set_config('app.actor_kind', 'worker', true);
select is(identity.expire_staff_invitations(100), 1, 'the worker expires one due invitation');
reset role;
select is(
  (select status::text from identity.invitations where id = (select invitation_id from expiring_invitation)),
  'expired',
  'the expiration batch closes the invitation'
);
select is(
  (select count(*) from system.outbox_events
   where aggregate_id = (select invitation_id from expiring_invitation)
     and event_type = 'identity.invitation_expired.v1'),
  1::bigint,
  'expiration emits one durable event'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199c000-0000-7000-8000-000000000001', true);
select lives_ok(
  $$
    select identity.consume_staff_invitation_rate_limit(
      '0199c000-0000-7000-8000-000000000001',
      (select organization_id from invitation_lifecycle_organization), 'limited@example.test'
    );
    select identity.consume_staff_invitation_rate_limit(
      '0199c000-0000-7000-8000-000000000001',
      (select organization_id from invitation_lifecycle_organization), 'limited@example.test'
    );
    select identity.consume_staff_invitation_rate_limit(
      '0199c000-0000-7000-8000-000000000001',
      (select organization_id from invitation_lifecycle_organization), 'limited@example.test'
    )
  $$,
  'three destination attempts fit the closed daily limit'
);
select throws_ok(
  $$
    select identity.consume_staff_invitation_rate_limit(
      '0199c000-0000-7000-8000-000000000001',
      (select organization_id from invitation_lifecycle_organization), 'limited@example.test'
    )
  $$,
  'P0001', null,
  'the fourth destination attempt is rate limited'
);
select hasnt_column(
  'system', 'invitation_rate_windows', 'contact',
  'rate windows persist no raw contact dimension'
);
select ok(
  has_function_privilege('allfit_api', 'identity.resolve_staff_invitation(bytea)', 'EXECUTE'),
  'the runtime can execute only the closed public projection'
);

select * from finish();
rollback;
