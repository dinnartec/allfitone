-- T-ORG-DIR-01 — OP-ORG-018 lifecycle states and NEW-SUP-ORG-SEARCH: the organization
-- directory.
--
-- `HU-BO-012`, and the part of `HU-BO-014`/`HU-BO-015` every later slice stands on:
-- an organization can now exist without operating.
--
-- Two things this test is built around.
--
-- **Not operating is structural, not a convention.** Every Studio command already
-- requires `status = 'active'`, so an unclaimed organization cannot invite, publish
-- or be read by anyone. What this test adds is the shape: an unclaimed organization
-- was never claimed and has no members, a cancelled one was never claimed and says
-- when it was cancelled, and an operating one says when it was claimed. The first
-- two cannot be faked by forgetting a column.
--
-- **The directory is organizations, never people.** Search matches the display
-- name only. The legal name — which for an independent professional is a person's
-- name — is neither searched nor returned, and neither is the responsible party.
-- "How many people it serves" is not a guess: `relationships` does not exist, so it
-- comes back empty rather than as a number that means something else.

begin;

select plan(22);

insert into identity.people (id, given_name, family_name, status)
values
  ('019ab000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019ab000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019ab000-0000-7000-8000-000000000003', 'Support', 'Gamma', 'active'),
  ('019ab000-0000-7000-8000-000000000004', 'Lifecycle', 'Delta', 'active'),
  ('019ab000-0000-7000-8000-000000000005', 'Verifier', 'Epsilon', 'active'),
  ('019ab000-0000-7000-8000-000000000006', 'Owner', 'Zeta', 'active'),
  ('019ab000-0000-7000-8000-000000000007', 'Badged', 'Eta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019ab000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha11', null),
  ('019ab000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta11', null),
  ('019ab000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma11',
    '019ab000-0000-7000-8000-000000000003'),
  ('019ab000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta11',
    '019ab000-0000-7000-8000-000000000004'),
  ('019ab000-0000-7000-8000-000000000015', 'workos', 'https://issuer.test', 'epsilon11',
    '019ab000-0000-7000-8000-000000000005'),
  ('019ab000-0000-7000-8000-000000000017', 'workos', 'https://issuer.test', 'eta11',
    '019ab000-0000-7000-8000-000000000007');

select support.bootstrap_backoffice_administrators(
  '019ab000-0000-7000-8000-000000000001', 'alpha11',
  '019ab000-0000-7000-8000-000000000002', 'beta11',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-ORG-DIR-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019ab000-0000-7000-8000-000000000021', '019ab000-0000-7000-8000-000000000011',
    'sid_alpha_11', 'backoffice', decode(repeat('d1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ab000-0000-7000-8000-000000000023', '019ab000-0000-7000-8000-000000000013',
    'sid_gamma_11', 'backoffice', decode(repeat('d3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ab000-0000-7000-8000-000000000024', '019ab000-0000-7000-8000-000000000014',
    'sid_delta_11', 'backoffice', decode(repeat('d4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ab000-0000-7000-8000-000000000025', '019ab000-0000-7000-8000-000000000015',
    'sid_epsilon_11', 'backoffice', decode(repeat('d5', 32), 'hex'), 'v1.epsilon',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ab000-0000-7000-8000-000000000027', '019ab000-0000-7000-8000-000000000017',
    'sid_eta_11', 'backoffice', decode(repeat('d7', 32), 'hex'), 'v1.eta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019ab000-0000-7000-8000-000000000001', '019ab000-0000-7000-8000-000000000021',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ab000-0000-7000-8000-000000000003'::uuid, '019ab000-0000-7000-8000-000000000103'::uuid,
    '019ab000-0000-7000-8000-000000000203'::uuid, '43'),
  ('019ab000-0000-7000-8000-000000000004'::uuid, '019ab000-0000-7000-8000-000000000104'::uuid,
    '019ab000-0000-7000-8000-000000000204'::uuid, '44'),
  ('019ab000-0000-7000-8000-000000000005'::uuid, '019ab000-0000-7000-8000-000000000105'::uuid,
    '019ab000-0000-7000-8000-000000000205'::uuid, '45'),
  ('019ab000-0000-7000-8000-000000000007'::uuid, '019ab000-0000-7000-8000-000000000107'::uuid,
    '019ab000-0000-7000-8000-000000000207'::uuid, '47')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019ab000-0000-7000-8000-000000000001', '019ab000-0000-7000-8000-000000000021',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-012', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ab000-0000-7000-8000-000000000003'::uuid, 'diagnose_support_metadata',
    '019ab000-0000-7000-8000-000000000113'::uuid, '019ab000-0000-7000-8000-000000000213'::uuid, '53'),
  ('019ab000-0000-7000-8000-000000000004'::uuid, 'manage_organization_lifecycle',
    '019ab000-0000-7000-8000-000000000114'::uuid, '019ab000-0000-7000-8000-000000000214'::uuid, '54'),
  ('019ab000-0000-7000-8000-000000000005'::uuid, 'verify_professional_credentials',
    '019ab000-0000-7000-8000-000000000115'::uuid, '019ab000-0000-7000-8000-000000000215'::uuid, '55')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- ---------------------------------------------------------------------------
-- The lifecycle shape
-- ---------------------------------------------------------------------------

-- The ordinary Studio path inserts no lifecycle columns at all. It still has to
-- produce a claimed, operating organization.
insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019ab000-0000-7000-8000-000000000300', 'professional_practice', 'Selfmade Practice',
  '{"party_kind":"natural_person","party_name":"Selfmade","purpose":"studio_operations"}'::jsonb
);

select ok(
  (select organization.status = 'active' and organization.claimed_at is not null
   from organizations.organizations as organization
   where organization.id = '019ab000-0000-7000-8000-000000000300'),
  'an organization its owner creates is operating and claimed from the start'
);

select throws_ok(
  $$ insert into organizations.organizations (type_code, display_name, status, claimed_at, responsible_party)
     values ('gym', 'Nobody Claimed This', 'active', null,
       '{"party_kind":"legal_entity","party_name":"X","purpose":"studio_operations"}'::jsonb) $$,
  '23514',
  null,
  'an operating organization always says when it was claimed'
);

select throws_ok(
  $$ insert into organizations.organizations (type_code, display_name, status, claimed_at, responsible_party)
     values ('gym', 'Claimed But Not', 'unclaimed', clock_timestamp(),
       '{"party_kind":"legal_entity","party_name":"X","purpose":"studio_operations"}'::jsonb) $$,
  '23514',
  null,
  'an unclaimed organization cannot carry a claim'
);

insert into organizations.organizations (
  id, type_code, display_name, legal_name, status, claimed_at, responsible_party, created_at
) values
  ('019ab000-0000-7000-8000-000000000301', 'gym', 'Dirtest Norte', 'Zeta Ramírez SAS',
    'active', clock_timestamp() - interval '40 days',
    '{"party_kind":"legal_entity","party_name":"Zeta Ramírez SAS","purpose":"studio_operations"}'::jsonb,
    clock_timestamp() - interval '40 days'),
  ('019ab000-0000-7000-8000-000000000302', 'studio', 'Dirtest Sur', null,
    'unclaimed', null,
    '{"party_kind":"legal_entity","party_name":"Estudio Sur SAS","purpose":"studio_operations"}'::jsonb,
    clock_timestamp() - interval '10 days');

insert into organizations.organizations (
  id, type_code, display_name, status, claimed_at, cancelled_at, responsible_party, created_at
) values (
  '019ab000-0000-7000-8000-000000000303', 'gym', 'Dirtest Cancelado', 'cancelled', null,
  clock_timestamp() - interval '1 day',
  '{"party_kind":"legal_entity","party_name":"Cancelado SAS","purpose":"studio_operations"}'::jsonb,
  clock_timestamp() - interval '20 days'
);

select throws_ok(
  $$ update organizations.organizations
     set status = 'cancelled'
     where id = '019ab000-0000-7000-8000-000000000302' $$,
  '23514',
  null,
  'a cancellation always says when it happened'
);

-- The operating gym has an owner and two sites.
insert into organizations.organization_memberships (id, organization_id, person_id, status)
values (
  '019ab000-0000-7000-8000-000000000311', '019ab000-0000-7000-8000-000000000301',
  '019ab000-0000-7000-8000-000000000006', 'active'
);
insert into organizations.membership_roles (membership_id, role_code, valid_from)
values ('019ab000-0000-7000-8000-000000000311', 'owner', clock_timestamp() - interval '40 days');
insert into organizations.organization_sites (organization_id, name, status, revision_number)
values
  ('019ab000-0000-7000-8000-000000000301', 'Sede Calle 80', 'active', 0),
  ('019ab000-0000-7000-8000-000000000301', 'Sede Chapinero', 'active', 0);

select throws_ok(
  $$ insert into organizations.organization_memberships (organization_id, person_id, status)
     values ('019ab000-0000-7000-8000-000000000302', '019ab000-0000-7000-8000-000000000006', 'active') $$,
  '55000',
  null,
  'an organization nobody has claimed has no members'
);

-- ---------------------------------------------------------------------------
-- Who reads the directory
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000007', '019ab000-0000-7000-8000-000000000027',
    'dirtest', null, 50, null, null
  ) $$,
  '42501',
  null,
  'the base role alone cannot read the organization directory'
);

select throws_ok(
  $$ select * from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000005', '019ab000-0000-7000-8000-000000000025',
    'dirtest', null, 50, null, null
  ) $$,
  '42501',
  null,
  'an unrelated duty does not stand in for reading organizations'
);

insert into relationships.service_relationships (
  id, person_id, organization_id, status, started_at, ended_at, ended_reason, ended_by_kind
) values
  ('019ab000-0000-7000-8000-000000000901', '019ab000-0000-7000-8000-000000000001',
    '019ab000-0000-7000-8000-000000000301', 'active', clock_timestamp() - interval '40 days',
    null, null, null),
  ('019ab000-0000-7000-8000-000000000902', '019ab000-0000-7000-8000-000000000002',
    '019ab000-0000-7000-8000-000000000301', 'active', clock_timestamp() - interval '20 days',
    null, null, null),
  ('019ab000-0000-7000-8000-000000000903', '019ab000-0000-7000-8000-000000000004',
    '019ab000-0000-7000-8000-000000000301', 'terminated', clock_timestamp() - interval '80 days',
    clock_timestamp() - interval '5 days', 'moved_away', 'person');

-- The actor context the API sets on every Backoffice request; the relationship count
-- is behind a policy that asks who is reading.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019ab000-0000-7000-8000-000000000003', true);

create temporary table directory on commit drop as
select * from organizations.list_backoffice_organizations(
  '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
  'dirtest', null, 50, null, null
);

select is((select count(*)::integer from directory), 3, 'a support operator reads the directory');

-- Another operator, so another actor: the directory counts the people each gym serves
-- under the policies of whoever is reading, and the two have to be the same person.
select set_config('app.actor_person_id', '019ab000-0000-7000-8000-000000000004', true);

select is(
  (select count(*)::integer from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000004', '019ab000-0000-7000-8000-000000000024',
    'dirtest', null, 50, null, null
  )),
  3,
  'so does whoever manages the organization lifecycle'
);

select set_config('app.actor_person_id', '019ab000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Criterion 1 and 3 — what each row says
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(row.status order by lower(row.display_name)) from directory as row),
  array['cancelled', 'active', 'unclaimed'],
  'the directory tells an operating organization from one nobody claimed'
);

select ok(
  (select row.type_name = 'Gimnasio'
     and row.active_member_count = 1
     and row.site_count = 2
     and row.claimed_at is not null
   from directory as row
   where row.organization_id = '019ab000-0000-7000-8000-000000000301')
  and (select row.active_member_count = 0 and row.site_count = 0 and row.claimed_at is null
       from directory as row
       where row.organization_id = '019ab000-0000-7000-8000-000000000302'),
  'each row says its type, its members, its sites and whether it was claimed'
);

select results_eq(
  $$ select row.people_served
     from directory as row
     where row.organization_id = '019ab000-0000-7000-8000-000000000301' $$,
  $$ values (2) $$,
  'and how many people it serves, counting neither the one it stopped serving nor another gym''s'
);

select ok(
  (select bool_and(row.people_served = 0) from directory as row
   where row.organization_id <> '019ab000-0000-7000-8000-000000000301'),
  'a gym with no relationship serves nobody, and here that zero is a fact about it'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — search by name, organizations only
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
    'norte', null, 50, null, null
  )),
  1,
  'searching by name narrows the directory'
);

select is(
  (select count(*)::integer from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
    'ramírez', null, 50, null, null
  )),
  0,
  'the legal name is never searched, because it can be a person'
);

select is(
  (select count(*)::integer from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
    '%%', null, 50, null, null
  )),
  0,
  'wildcards in a search are matched literally, not as a pattern'
);

select is(
  (select count(*)::integer from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
    'dirtest', 'unclaimed', 50, null, null
  )),
  1,
  'the directory filters by lifecycle state'
);

select throws_ok(
  $$ select * from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
    'd', null, 50, null, null
  ) $$,
  '22023',
  null,
  'a one-letter search is refused rather than returning everything'
);

select throws_ok(
  $$ select * from organizations.list_backoffice_organizations(
    '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
    'dirtest', 'suspended_forever', 50, null, null
  ) $$,
  '22023',
  null,
  'an unknown lifecycle state is refused'
);

-- ---------------------------------------------------------------------------
-- Pagination reaches the whole directory
-- ---------------------------------------------------------------------------

select ok(
  (select count(*) = 2 from organizations.list_backoffice_organizations(
     '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
     'dirtest', null, 2, null, null
   ))
  and (select count(*) = 1 and bool_and(row.display_name = 'Dirtest Sur')
       from organizations.list_backoffice_organizations(
         '019ab000-0000-7000-8000-000000000003', '019ab000-0000-7000-8000-000000000023',
         'dirtest', null, 2, 'Dirtest Norte', '019ab000-0000-7000-8000-000000000301'
       ) as row),
  'the next page starts after the last row of the previous one'
);

-- ---------------------------------------------------------------------------
-- Structure and grants
-- ---------------------------------------------------------------------------

select ok(
  (select pg_get_function_result(p.oid) !~ '(legal_name|responsible_party|person)'
   from pg_proc as p
   join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'organizations' and p.proname = 'list_backoffice_organizations'),
  'the directory returns nothing that can identify a person'
);

select ok(
  has_function_privilege(
    'allfit_api',
    'organizations.list_backoffice_organizations(uuid,uuid,text,text,integer,text,uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'allfit_api', 'organizations.require_organization_directory_reader(uuid,uuid)', 'EXECUTE'
    )
    and not has_table_privilege('allfit_api', 'organizations.organizations', 'SELECT'),
  'the runtime role runs the directory, never the guard and never the table'
);

select * from finish();
rollback;
