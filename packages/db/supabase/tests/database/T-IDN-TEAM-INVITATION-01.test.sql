begin;

select plan(18);

insert into identity.people (id, given_name, family_name)
values
  ('0199b000-0000-7000-8000-000000000001', 'Olivia', 'Owner'),
  ('0199b000-0000-7000-8000-000000000002', 'Sofia', 'Staff'),
  ('0199b000-0000-7000-8000-000000000003', 'Camila', 'Coach');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199b000-0000-7000-8000-000000000001', true);

create temporary table invitation_organization as
select *
from organizations.create_organization(
  '0199b000-0000-7000-8000-000000000001',
  'Equipo Invitaciones',
  'studio',
  'natural_person',
  'Ignored',
  'b1111111-1111-4111-8111-111111111111',
  '0199b000-0000-7000-8000-000000000011',
  decode(repeat('b1', 32), 'hex')
);

reset role;

insert into organizations.organization_memberships (id, organization_id, person_id)
select '0199b000-0000-7000-8000-000000000021', organization_id, '0199b000-0000-7000-8000-000000000002'
from invitation_organization;
insert into organizations.membership_roles (membership_id, role_code)
values ('0199b000-0000-7000-8000-000000000021', 'staff');

insert into organizations.organization_memberships (id, organization_id, person_id)
select '0199b000-0000-7000-8000-000000000022', organization_id, '0199b000-0000-7000-8000-000000000003'
from invitation_organization;
insert into organizations.membership_roles (membership_id, role_code)
values ('0199b000-0000-7000-8000-000000000022', 'coach');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0199b000-0000-7000-8000-000000000001', true);

create temporary table first_invitation as
select *
from identity.issue_staff_invitation(
  '0199b000-0000-7000-8000-000000000001',
  (select organization_id from invitation_organization),
  'email',
  '  PERSONA@Example.com ',
  'staff',
  decode(repeat('a1', 32), 'hex'),
  1::smallint,
  'b2222222-2222-4222-8222-222222222222',
  '0199b000-0000-7000-8000-000000000031',
  decode(repeat('b2', 32), 'hex')
);

reset role;

select is((select status from first_invitation), 'pending', 'an owner creates a pending invitation');
select is((select contact_hint from first_invitation), 'p***@example.com', 'the command returns only a masked contact');
select is((select proposed_role_code from first_invitation), 'staff', 'the membership intent carries the proposed role');
select ok(not (select reused from first_invitation), 'the first command does not report domain reuse');
select is(
  (select count(*) from identity.invitation_intents where invitation_id = (select invitation_id from first_invitation)),
  1::bigint,
  'the invitation owns exactly one membership intent'
);
select is(
  (select count(*) from system.outbox_events where aggregate_id = (select invitation_id from first_invitation)),
  1::bigint,
  'the delivery event is committed with the invitation'
);
select ok(
  not exists (
    select 1 from system.outbox_events
    where aggregate_id = (select invitation_id from first_invitation)
      and payload::text ilike '%persona@example.com%'
  ),
  'the outbox payload does not contain the destination'
);

set local role allfit_api;

create temporary table reused_invitation as
select *
from identity.issue_staff_invitation(
  '0199b000-0000-7000-8000-000000000001',
  (select organization_id from invitation_organization),
  'email',
  'persona@example.com',
  'staff',
  decode(repeat('a2', 32), 'hex'),
  1::smallint,
  'b3333333-3333-4333-8333-333333333333',
  '0199b000-0000-7000-8000-000000000032',
  decode(repeat('b3', 32), 'hex')
);

reset role;

select is(
  (select invitation_id from reused_invitation),
  (select invitation_id from first_invitation),
  'an equivalent active proposal reuses the durable invitation'
);
select ok((select reused from reused_invitation), 'a distinct equivalent command reports domain reuse');
select is(
  (select count(*) from identity.invitations where organization_id = (select organization_id from invitation_organization)),
  1::bigint,
  'equivalent proposals converge to one pending invitation'
);
select is(
  (select count(*) from system.outbox_events where aggregate_id = (select invitation_id from first_invitation)),
  2::bigint,
  'a new equivalent command requests another delivery'
);

set local role allfit_api;

select results_eq(
  $$
    select invitation_id, replayed
    from identity.issue_staff_invitation(
      '0199b000-0000-7000-8000-000000000001',
      (select organization_id from invitation_organization),
      'email', 'persona@example.com', 'staff', decode(repeat('a2', 32), 'hex'), 1::smallint,
      'b3333333-3333-4333-8333-333333333333',
      '0199b000-0000-7000-8000-000000000032',
      decode(repeat('b3', 32), 'hex')
    )
  $$,
  $$ select invitation_id, true from first_invitation $$,
  'an HTTP replay returns the same invitation without another effect'
);

select set_config('app.actor_person_id', '0199b000-0000-7000-8000-000000000002', true);
select lives_ok(
  $$
    select * from identity.issue_staff_invitation(
      '0199b000-0000-7000-8000-000000000002',
      (select organization_id from invitation_organization),
      'email', 'staff2@example.com', 'staff', decode(repeat('a3', 32), 'hex'), 1::smallint,
      'b4444444-4444-4444-8444-444444444444',
      '0199b000-0000-7000-8000-000000000033',
      decode(repeat('b4', 32), 'hex')
    )
  $$,
  'staff can invite another staff member'
);
select throws_ok(
  $$
    select * from identity.issue_staff_invitation(
      '0199b000-0000-7000-8000-000000000002',
      (select organization_id from invitation_organization),
      'email', 'admin@example.com', 'admin', decode(repeat('a4', 32), 'hex'), 1::smallint,
      'b5555555-5555-4555-8555-555555555555',
      '0199b000-0000-7000-8000-000000000034',
      decode(repeat('b5', 32), 'hex')
    )
  $$,
  '42501', null,
  'staff cannot escalate an invitation to admin'
);

select set_config('app.actor_person_id', '0199b000-0000-7000-8000-000000000003', true);
select throws_ok(
  $$
    select * from identity.issue_staff_invitation(
      '0199b000-0000-7000-8000-000000000003',
      (select organization_id from invitation_organization),
      'email', 'blocked@example.com', 'staff', decode(repeat('a5', 32), 'hex'), 1::smallint,
      'b6666666-6666-4666-8666-666666666666',
      '0199b000-0000-7000-8000-000000000035',
      decode(repeat('b6', 32), 'hex')
    )
  $$,
  '42501', null,
  'a coach does not have the invite capability'
);

select throws_ok(
  $$ insert into identity.invitations (organization_id, issued_by_membership_id, channel, contact, token_hash, token_key_version, proposal_hash, responsible_party) values ((select organization_id from invitation_organization), (select membership_id from invitation_organization), 'email', 'forged@example.com', decode(repeat('aa',32),'hex'), 1, decode(repeat('bb',32),'hex'), '{}'::jsonb) $$,
  '42501', null,
  'allfit_api cannot insert invitations directly'
);
select throws_ok(
  $$ update identity.invitation_intents set status = 'accepted' $$,
  '42501', null,
  'allfit_api cannot mutate invitation intents directly'
);
select ok(
  has_function_privilege('allfit_api', 'identity.issue_staff_invitation(uuid,uuid,text,text,text,bytea,smallint,uuid,uuid,bytea)', 'EXECUTE'),
  'the runtime can execute the closed invitation command'
);

select * from finish();
rollback;
