begin;

select plan(11);

insert into identity.people (id, given_name, family_name)
values
  ('0198e000-0000-7000-8000-000000000001', 'Ada', 'Owner'),
  ('0198e000-0000-7000-8000-000000000002', 'Grace', 'Other');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '0198e000-0000-7000-8000-000000000001', true);

select is(
  (select count(*) from organizations.list_organization_types()),
  5::bigint,
  'T-ORG-API-01 exposes the five governed organization types'
);

create temporary table test_organization as
select *
from organizations.create_organization(
  '0198e000-0000-7000-8000-000000000001',
  'Ada Performance',
  'professional_practice',
  'natural_person',
  'Forged Responsible Name',
  '22222222-2222-4222-8222-222222222221',
  '22222222-2222-4222-8222-222222222222',
  decode(repeat('21', 32), 'hex')
);

select is((select role_code from test_organization), 'owner', 'T-ORG-INT-01 creates the owner role');
select is(
  (select responsible_party ->> 'party_name' from organizations.organizations where id = (select organization_id from test_organization)),
  'Ada Owner',
  'an individual practice derives its natural responsible party from the authenticated creator'
);
select is(
  (select count(*) from organizations.organization_memberships where organization_id = (select organization_id from test_organization)),
  1::bigint,
  'organization creation creates one membership'
);
select is(
  (select count(*) from organizations.membership_roles where membership_id = (select membership_id from test_organization) and role_code = 'owner' and valid_to is null),
  1::bigint,
  'organization creation leaves exactly one active owner'
);
select is(
  (select organization_id from organizations.create_organization(
    '0198e000-0000-7000-8000-000000000001',
    'Ada Performance',
    'professional_practice',
    'natural_person',
    'Ada Owner',
    '22222222-2222-4222-8222-222222222221',
    '22222222-2222-4222-8222-222222222222',
    decode(repeat('21', 32), 'hex')
  )),
  (select organization_id from test_organization),
  'T-ORG-IDEM-01 replays return the same organization'
);
select is(
  (select count(*) from organizations.list_my_memberships('0198e000-0000-7000-8000-000000000001')),
  1::bigint,
  'the owner lists their active membership'
);
select is(
  (select roles from organizations.list_my_memberships('0198e000-0000-7000-8000-000000000001')),
  array['owner']::text[],
  'membership projection carries the effective role'
);

select set_config('app.actor_person_id', '0198e000-0000-7000-8000-000000000002', true);
select is_empty(
  $$ select id from organizations.organizations $$,
  'T-ORG-RLS-01 another person cannot read the organization'
);
select is_empty(
  $$ select * from organizations.list_my_memberships('0198e000-0000-7000-8000-000000000002') $$,
  'another person has no membership projection'
);
select throws_ok(
  $$ insert into organizations.organizations (type_code, display_name, responsible_party) values ('gym', 'Forged', '{"party_kind":"natural_person","party_name":"Forged","purpose":"studio_operations"}') $$,
  '42501',
  null,
  'allfit_api cannot create organizations directly'
);

reset role;
select * from finish();
rollback;
