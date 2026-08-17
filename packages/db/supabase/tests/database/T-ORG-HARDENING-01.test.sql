begin;

select plan(8);

insert into identity.people (id, given_name, family_name)
values
  ('0198e100-0000-7000-8000-000000000001', 'Ada', 'Owner'),
  ('0198e100-0000-7000-8000-000000000002', 'Grace', 'Member'),
  ('0198e100-0000-7000-8000-000000000003', 'Linus', 'Outsider');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0198e100-0000-7000-8000-000000000001', true);

create temporary table hardened_organization as
select *
from organizations.create_organization(
  '0198e100-0000-7000-8000-000000000001',
  'Invariant Lab',
  'professional_practice',
  'natural_person',
  'Ada Owner',
  '42222222-2222-4222-8222-222222222221',
  '42222222-2222-4222-8222-222222222222',
  decode(repeat('41', 32), 'hex')
);

reset role;

select is(
  (
    select count(*)
    from organizations.membership_events
    where membership_id = (select membership_id from hardened_organization)
      and event_type = 'organization.membership_created.v1'
  ),
  1::bigint,
  'T-EVENT-2 organization creation emits one membership-created event'
);

select is(
  (
    select "after" ->> 'status'
    from organizations.membership_events
    where membership_id = (select membership_id from hardened_organization)
      and event_type = 'organization.membership_created.v1'
  ),
  'active',
  'membership-created event carries the active membership snapshot'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0198e100-0000-7000-8000-000000000001', true);
select organizations.create_organization(
  '0198e100-0000-7000-8000-000000000001',
  'Invariant Lab',
  'professional_practice',
  'natural_person',
  'Ada Owner',
  '42222222-2222-4222-8222-222222222221',
  '42222222-2222-4222-8222-222222222222',
  decode(repeat('41', 32), 'hex')
);

reset role;

select is(
  (
    select count(*)
    from organizations.membership_events
    where membership_id = (select membership_id from hardened_organization)
      and event_type = 'organization.membership_created.v1'
  ),
  1::bigint,
  'T-ORG-IDEM-02 an idempotent replay does not duplicate membership events'
);

set local role allfit_api;
select throws_ok(
  $$
    update organizations.membership_events
    set "after" = '{}'::jsonb
    where membership_id = (select membership_id from hardened_organization)
  $$,
  '42501',
  null,
  'T-EVENT-1 runtime cannot mutate membership events'
);

select throws_ok(
  $$
    delete from organizations.membership_events
    where membership_id = (select membership_id from hardened_organization)
  $$,
  '42501',
  null,
  'runtime cannot delete membership events'
);

reset role;
set constraints all immediate;

select throws_ok(
  $$
    update organizations.membership_roles
    set valid_to = clock_timestamp()
    where membership_id = (select membership_id from hardened_organization)
      and role_code = 'owner'
      and valid_to is null
  $$,
  '23514',
  null,
  'T-MEMB-3 an active organization cannot be left without an active owner'
);

insert into organizations.organization_memberships (
  id,
  organization_id,
  person_id,
  status
) values (
  '0198e100-0000-7000-8000-000000000011',
  (select organization_id from hardened_organization),
  '0198e100-0000-7000-8000-000000000002',
  'active'
);

select throws_ok(
  $$
    insert into organizations.membership_roles (membership_id, role_code)
    values ('0198e100-0000-7000-8000-000000000011', 'owner')
  $$,
  '23514',
  null,
  'T-MEMB-6 an active organization cannot have a second active owner'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0198e100-0000-7000-8000-000000000003', true);

select throws_ok(
  $$ select id from organizations.membership_events $$,
  '42501',
  null,
  'T-EVENT-RLS-01 runtime cannot read membership events directly'
);

reset role;
select * from finish();
rollback;
