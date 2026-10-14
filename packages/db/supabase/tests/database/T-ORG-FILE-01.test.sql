-- T-ORG-FILE-01 — NEW-SUP-ORG-DETAIL: a gym's file as Allfit's team reads it.
--
-- `HU-BO-013`, the part that has tables behind it: its data, its owner, its sites
-- and its team. What this test is built around.
--
-- **The file is about the organization, never about names.** ADR-028 keeps ordinary
-- support to identifiers, states, dates and counters. The owner and the team are
-- identifiers with their roles; no name, no contact, and no responsible party that
-- for an independent professional is a person's name.
--
-- **Every person it reveals is an access.** Belonging to a gym is personal data, so
-- each active member the file returns is recorded before the file travels, and a
-- member it does not return is not.
--
-- **A home is not a site.** An independent professional often works from home, so a
-- natural person's site address is withheld and the file says it was.
--
-- **What does not exist is not zero.** People served, plans, the payment method and
-- Premium have no tables yet, and the file says so instead of inventing an answer.

begin;

select plan(34);

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019ad000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active', null),
  ('019ad000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active', null),
  ('019ad000-0000-7000-8000-000000000003', 'Support', 'Gamma', 'active', null),
  ('019ad000-0000-7000-8000-000000000004', 'Lifecycle', 'Delta', 'active', null),
  ('019ad000-0000-7000-8000-000000000005', 'Verifier', 'Epsilon', 'active', null),
  ('019ad000-0000-7000-8000-000000000006', 'Owner', 'Zeta', 'active', 'owner.zeta@example.test'),
  ('019ad000-0000-7000-8000-000000000007', 'Badged', 'Eta', 'active', null),
  ('019ad000-0000-7000-8000-000000000008', 'Coach', 'Theta', 'active', null),
  ('019ad000-0000-7000-8000-000000000009', 'Admin', 'Iota', 'active', null),
  ('019ad000-0000-7000-8000-000000000010', 'Former', 'Kappa', 'active', null),
  ('019ad000-0000-7000-8000-000000000011', 'Solo', 'Lambda', 'active', null);

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019ad000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'alpha13', null),
  ('019ad000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'beta13', null),
  ('019ad000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'gamma13',
    '019ad000-0000-7000-8000-000000000003'),
  ('019ad000-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'delta13',
    '019ad000-0000-7000-8000-000000000004'),
  ('019ad000-0000-7000-8000-000000000025', 'workos', 'https://issuer.test', 'epsilon13',
    '019ad000-0000-7000-8000-000000000005'),
  ('019ad000-0000-7000-8000-000000000027', 'workos', 'https://issuer.test', 'eta13',
    '019ad000-0000-7000-8000-000000000007');

select support.bootstrap_backoffice_administrators(
  '019ad000-0000-7000-8000-000000000001', 'alpha13',
  '019ad000-0000-7000-8000-000000000002', 'beta13',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-ORG-FILE-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019ad000-0000-7000-8000-000000000031', '019ad000-0000-7000-8000-000000000021',
    'sid_alpha_13', 'backoffice', decode(repeat('f1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ad000-0000-7000-8000-000000000033', '019ad000-0000-7000-8000-000000000023',
    'sid_gamma_13', 'backoffice', decode(repeat('f3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ad000-0000-7000-8000-000000000034', '019ad000-0000-7000-8000-000000000024',
    'sid_delta_13', 'backoffice', decode(repeat('f4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ad000-0000-7000-8000-000000000035', '019ad000-0000-7000-8000-000000000025',
    'sid_epsilon_13', 'backoffice', decode(repeat('f5', 32), 'hex'), 'v1.epsilon',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ad000-0000-7000-8000-000000000037', '019ad000-0000-7000-8000-000000000027',
    'sid_eta_13', 'backoffice', decode(repeat('f7', 32), 'hex'), 'v1.eta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019ad000-0000-7000-8000-000000000001', '019ad000-0000-7000-8000-000000000031',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ad000-0000-7000-8000-000000000003'::uuid, '019ad000-0000-7000-8000-000000000103'::uuid,
    '019ad000-0000-7000-8000-000000000203'::uuid, '83'),
  ('019ad000-0000-7000-8000-000000000004'::uuid, '019ad000-0000-7000-8000-000000000104'::uuid,
    '019ad000-0000-7000-8000-000000000204'::uuid, '84'),
  ('019ad000-0000-7000-8000-000000000005'::uuid, '019ad000-0000-7000-8000-000000000105'::uuid,
    '019ad000-0000-7000-8000-000000000205'::uuid, '85'),
  ('019ad000-0000-7000-8000-000000000007'::uuid, '019ad000-0000-7000-8000-000000000107'::uuid,
    '019ad000-0000-7000-8000-000000000207'::uuid, '87')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019ad000-0000-7000-8000-000000000001', '019ad000-0000-7000-8000-000000000031',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-013', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ad000-0000-7000-8000-000000000003'::uuid, 'diagnose_support_metadata',
    '019ad000-0000-7000-8000-000000000113'::uuid, '019ad000-0000-7000-8000-000000000213'::uuid, '93'),
  ('019ad000-0000-7000-8000-000000000004'::uuid, 'manage_organization_lifecycle',
    '019ad000-0000-7000-8000-000000000114'::uuid, '019ad000-0000-7000-8000-000000000214'::uuid, '94'),
  ('019ad000-0000-7000-8000-000000000005'::uuid, 'verify_professional_credentials',
    '019ad000-0000-7000-8000-000000000115'::uuid, '019ad000-0000-7000-8000-000000000215'::uuid, '95')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- A company gym with an owner, a coach, an admin, a former member and two sites.
insert into organizations.organizations (
  id, type_code, display_name, legal_name, responsible_party, created_at
) values (
  '019ad000-0000-7000-8000-000000000301', 'gym', 'Ficha Norte', 'Norte Fitness SAS',
  '{"party_kind":"legal_entity","party_name":"Norte Fitness SAS","purpose":"studio_operations"}'::jsonb,
  clock_timestamp() - interval '90 days'
);
insert into organizations.organization_memberships (id, organization_id, person_id, status, joined_at)
values
  ('019ad000-0000-7000-8000-000000000311', '019ad000-0000-7000-8000-000000000301',
    '019ad000-0000-7000-8000-000000000006', 'active', clock_timestamp() - interval '90 days'),
  ('019ad000-0000-7000-8000-000000000312', '019ad000-0000-7000-8000-000000000301',
    '019ad000-0000-7000-8000-000000000008', 'active', clock_timestamp() - interval '60 days'),
  ('019ad000-0000-7000-8000-000000000313', '019ad000-0000-7000-8000-000000000301',
    '019ad000-0000-7000-8000-000000000009', 'active', clock_timestamp() - interval '30 days');
insert into organizations.membership_roles (membership_id, role_code, valid_from)
values
  ('019ad000-0000-7000-8000-000000000311', 'owner', clock_timestamp() - interval '90 days'),
  ('019ad000-0000-7000-8000-000000000312', 'coach', clock_timestamp() - interval '60 days'),
  ('019ad000-0000-7000-8000-000000000313', 'admin', clock_timestamp() - interval '30 days');
insert into organizations.organization_memberships (
  id, organization_id, person_id, status, joined_at, ended_at
) values (
  '019ad000-0000-7000-8000-000000000314', '019ad000-0000-7000-8000-000000000301',
  '019ad000-0000-7000-8000-000000000010', 'terminated',
  clock_timestamp() - interval '80 days', clock_timestamp() - interval '10 days'
);
insert into organizations.organization_sites (organization_id, name, address, status)
values
  ('019ad000-0000-7000-8000-000000000301', 'Sede Calle 80', 'Calle 80 # 1-10', 'active'),
  ('019ad000-0000-7000-8000-000000000301', 'Sede Vieja', null, 'inactive');

-- An independent professional who works from home.
insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019ad000-0000-7000-8000-000000000302', 'professional_practice', 'Ficha Práctica',
  '{"party_kind":"natural_person","party_name":"Solo Lambda","purpose":"studio_operations"}'::jsonb
);
insert into organizations.organization_memberships (id, organization_id, person_id, status)
values (
  '019ad000-0000-7000-8000-000000000321', '019ad000-0000-7000-8000-000000000302',
  '019ad000-0000-7000-8000-000000000011', 'active'
);
insert into organizations.membership_roles (membership_id, role_code)
values ('019ad000-0000-7000-8000-000000000321', 'owner');
insert into organizations.organization_sites (organization_id, name, address, status)
values ('019ad000-0000-7000-8000-000000000302', 'Consultorio', 'Carrera 7 # 12-30 apto 301', 'active');

insert into organizations.organizations (id, type_code, display_name, status, claimed_at, responsible_party)
values (
  '019ad000-0000-7000-8000-000000000303', 'gym', 'Ficha Sin Reclamar', 'unclaimed', null,
  '{"party_kind":"legal_entity","party_name":"Sin Reclamar SAS","purpose":"studio_operations"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Who reads a file
-- ---------------------------------------------------------------------------

-- The actor context the API sets on every Backoffice request, and the file now
-- requires it: the figures it counts come from tables whose policies ask who is
-- reading, so the person asked about and the person acting have to be the same one.
-- Set per reader below, because each of these is a different operator.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000007', true);

select throws_ok(
  $$ select organizations.read_backoffice_organization(
    '019ad000-0000-7000-8000-000000000007', '019ad000-0000-7000-8000-000000000037',
    '019ad000-0000-7000-8000-000000000301'
  ) $$,
  '42501',
  null,
  'the base role alone does not open a gym''s file'
);

select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000005', true);

select throws_ok(
  $$ select organizations.read_backoffice_organization(
    '019ad000-0000-7000-8000-000000000005', '019ad000-0000-7000-8000-000000000035',
    '019ad000-0000-7000-8000-000000000301'
  ) $$,
  '42501',
  null,
  'an unrelated duty does not stand in for reading a gym'
);

select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000003', true);

select throws_ok(
  $$ select organizations.read_backoffice_organization(
    '019ad000-0000-7000-8000-000000000003', '019ad000-0000-7000-8000-000000000033',
    '019ad000-0000-7000-8000-000000009999'
  ) $$,
  'P0002',
  null,
  'a gym that does not exist has no file'
);

create temporary table norte_file on commit drop as
select organizations.read_backoffice_organization(
  '019ad000-0000-7000-8000-000000000003', '019ad000-0000-7000-8000-000000000033',
  '019ad000-0000-7000-8000-000000000301'
) as file;

select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000004', true);

select ok(
  (select organizations.read_backoffice_organization(
     '019ad000-0000-7000-8000-000000000004', '019ad000-0000-7000-8000-000000000034',
     '019ad000-0000-7000-8000-000000000301'
   ) is not null),
  'whoever manages the lifecycle opens the file as well as support'
);

select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Criterion 1 — its data, its owner and its sites
-- ---------------------------------------------------------------------------

select ok(
  (select file->'organization'->>'display_name' = 'Ficha Norte'
     and file->'organization'->>'status' = 'active'
     and file->'organization'->>'party_kind' = 'legal_entity'
     and file->'organization'->>'legal_name' = 'Norte Fitness SAS'
     and file->'organization'->>'type_name' = 'Gimnasio'
   from norte_file),
  'the file says what the gym is, how it answers and in which state it is'
);

select ok(
  (select file->'owner'->>'person_id' = '019ad000-0000-7000-8000-000000000006'
     and file->'owner'->>'membership_id' = '019ad000-0000-7000-8000-000000000311'
   from norte_file),
  'the owner is the person behind the active owner role, by identifier'
);

select ok(
  (select jsonb_array_length(file->'sites') = 2
     and (select bool_or(site->>'name' = 'Sede Calle 80' and site->>'address' = 'Calle 80 # 1-10'
                         and site->>'status' = 'active')
          from jsonb_array_elements(file->'sites') as site)
   from norte_file),
  'a company''s sites carry their address and state'
);

create temporary table practice_file on commit drop as
select organizations.read_backoffice_organization(
  '019ad000-0000-7000-8000-000000000003', '019ad000-0000-7000-8000-000000000033',
  '019ad000-0000-7000-8000-000000000302'
) as file;

select ok(
  (select site->'address' = 'null'::jsonb and (site->>'address_withheld')::boolean
   from practice_file, jsonb_array_elements(file->'sites') as site),
  'a natural person''s site address is withheld, because it can be their home'
);

select ok(
  (select position('Lambda' in file::text) = 0
     and file->'organization'->'legal_name' = 'null'::jsonb
   from practice_file),
  'the responsible party of an independent professional is never named'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — the team, by role
-- ---------------------------------------------------------------------------

select is(
  (select array_agg((member->>'person_id') || ':' || (member->'roles'->>0)
                    order by member->>'person_id')
   from norte_file, jsonb_array_elements(file->'team') as member),
  array[
    '019ad000-0000-7000-8000-000000000006:owner',
    '019ad000-0000-7000-8000-000000000008:coach',
    '019ad000-0000-7000-8000-000000000009:admin'
  ],
  'the team lists each active member with the role they hold'
);

select ok(
  (select (file->'team_counts'->>'active')::integer = 3
     and (file->'team_counts'->>'terminated')::integer = 1
     and not exists (
       select 1 from jsonb_array_elements(file->'team') as member
       where member->>'person_id' = '019ad000-0000-7000-8000-000000000010'
     )
   from norte_file),
  'a former member is counted, never listed'
);

select ok(
  (select position('Theta' in file::text) = 0
     and position('Iota' in file::text) = 0
     and position('Zeta' in file::text) = 0
     and position('example.test' in file::text) = 0
   from norte_file),
  'no member is named and no contact travels in the file'
);

-- Criteria 4 to 6 are answered at the end of this file, where the plans, the gateway
-- and the Pro of a gym are set up. They used to be asserted here as `not_modelled`,
-- which was true of a schema without `payments` and stopped being true on 2026-10-12.

-- ---------------------------------------------------------------------------
-- Every person revealed is an access
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(event.subject_person_id::text order by event.subject_person_id)
   from privacy.access_events as event
   where event.actor_person_id = '019ad000-0000-7000-8000-000000000003'
     and event.resource = 'organizations.organization_memberships'),
  array[
    '019ad000-0000-7000-8000-000000000006',
    '019ad000-0000-7000-8000-000000000008',
    '019ad000-0000-7000-8000-000000000009',
    '019ad000-0000-7000-8000-000000000011'
  ],
  'each active member a file returns is recorded, and nobody else'
);

select ok(
  (select bool_and(event.access_mode = 'support_metadata' and event.result = 'allowed')
   from privacy.access_events as event
   where event.actor_person_id = '019ad000-0000-7000-8000-000000000003'
     and event.resource = 'organizations.organization_memberships'),
  'the reads are recorded as reads by Allfit''s team, not as a person''s permission'
);

create temporary table unclaimed_file on commit drop as
select organizations.read_backoffice_organization(
  '019ad000-0000-7000-8000-000000000003', '019ad000-0000-7000-8000-000000000033',
  '019ad000-0000-7000-8000-000000000303'
) as file;

select ok(
  (select file->'owner' = 'null'::jsonb
     and jsonb_array_length(file->'team') = 0
     and file->'organization'->>'status' = 'unclaimed'
   from unclaimed_file),
  'a gym nobody has claimed has no owner and no team to show'
);

select is(
  (select count(*)::integer from privacy.access_events as event
   where event.actor_person_id = '019ad000-0000-7000-8000-000000000003'
     and event.resource = 'organizations.organization_memberships'),
  4,
  'a file that reveals nobody records nobody'
);

select ok(
  not exists (
    select 1 from privacy.access_events as event
    where event.actor_person_id in (
      '019ad000-0000-7000-8000-000000000005', '019ad000-0000-7000-8000-000000000007'
    )
  ),
  'a refused read records no access, because nothing was reached'
);

-- ---------------------------------------------------------------------------
-- Criterion 3 — how many people it serves, and in what state
-- ---------------------------------------------------------------------------

-- Two people it serves now, one it no longer does, and one at another gym that must
-- not be counted here.
insert into relationships.service_relationships (
  id, person_id, organization_id, status, started_at, ended_at, ended_reason, ended_by_kind
) values
  ('019ad000-0000-7000-8000-000000000801', '019ad000-0000-7000-8000-000000000006',
    '019ad000-0000-7000-8000-000000000301', 'active', clock_timestamp() - interval '60 days',
    null, null, null),
  ('019ad000-0000-7000-8000-000000000802', '019ad000-0000-7000-8000-000000000007',
    '019ad000-0000-7000-8000-000000000301', 'active', clock_timestamp() - interval '30 days',
    null, null, null),
  ('019ad000-0000-7000-8000-000000000803', '019ad000-0000-7000-8000-000000000005',
    '019ad000-0000-7000-8000-000000000301', 'terminated', clock_timestamp() - interval '90 days',
    clock_timestamp() - interval '10 days', 'moved_away', 'person'),
  ('019ad000-0000-7000-8000-000000000804', '019ad000-0000-7000-8000-000000000006',
    '019ad000-0000-7000-8000-000000000302', 'active', clock_timestamp() - interval '20 days',
    null, null, null);

-- Still support, still the same person. Left here because what follows asserts the
-- counts, and reading it next to them is worth the repetition.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000003', true);

create temporary table served_file on commit drop as
select organizations.read_backoffice_organization(
  '019ad000-0000-7000-8000-000000000003', '019ad000-0000-7000-8000-000000000033',
  '019ad000-0000-7000-8000-000000000301'
) as file;

select is(
  (select (file->>'people_served')::integer from served_file),
  2,
  'the file says how many people the gym serves, and only the ones it still serves'
);

select results_eq(
  $$ select (file->'relationship_counts'->>'active')::integer,
            (file->'relationship_counts'->>'terminated')::integer
     from served_file $$,
  $$ values (2, 1) $$,
  'and in what state those relationships are, the way it already does for the team'
);

-- A count is a count. Reaching a person still means going through the door that asks
-- for a case reference.
select ok(
  (select not (file::text like '%019ad000-0000-7000-8000-000000000801%')
     and not (file::text like '%019ad000-0000-7000-8000-000000000005%')
   from served_file),
  'and never which relationship it is, nor whose'
);

-- The floor under the count, asserted on its own: the file refuses a reader without
-- the duty before the policy is ever consulted, so the only way to know the policy
-- would refuse too is to ask it directly.

select ok(
  access_control.holds_backoffice_duty('diagnose_support_metadata'),
  'the duty is what lets the count see a relationship at all'
);

select ok(
  not access_control.holds_backoffice_duty('manage_privacy_requests'),
  'and it is that duty, not any duty the reader happens to hold'
);

select ok(
  not (
    select access_control.holds_backoffice_duty('diagnose_support_metadata')
    from (select set_config('app.actor_person_id',
      '019ad000-0000-7000-8000-000000000005', true)) as other_actor
  ),
  'and somebody who only verifies credentials sees no row to count'
);

select set_config('app.actor_person_id', '019ad000-0000-7000-8000-000000000003', true);

-- The predicate also demands a live AAL2 Backoffice session, and that branch is not
-- asserted here: every session in this file already is one, so relaxing it changes
-- nothing. Isolating it needs a reader whose only session is another surface's.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'allfit_api', 'organizations.read_backoffice_organization(uuid,uuid,uuid)', 'EXECUTE'
  )
  and not has_table_privilege('allfit_api', 'organizations.organization_memberships', 'SELECT')
  and not has_table_privilege('allfit_api', 'organizations.organization_sites', 'SELECT'),
  'the runtime role opens the file, never the tables behind it'
);

select ok(
  (select pg_get_function_result(p.oid) = 'jsonb'
   from pg_proc as p
   join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'organizations' and p.proname = 'read_backoffice_organization'),
  'the file is one closed projection built by the database'
);

-- ---------------------------------------------------------------------------
-- Criteria 4 to 6 — its plans, its gateway, and whether it gives Pro
-- ---------------------------------------------------------------------------

-- A plan the gym publishes, a price in force, and two of its clients paying it. The
-- draft beside it is not an offer and must not appear.
insert into payments.organization_plans (id, organization_id, name, status)
values
  ('019ad000-0000-7000-8000-000000000501', '019ad000-0000-7000-8000-000000000301',
    'Mensual', 'published'),
  ('019ad000-0000-7000-8000-000000000502', '019ad000-0000-7000-8000-000000000301',
    'Anual', 'draft');

insert into payments.plan_versions (
  id, plan_id, organization_id, version_number, amount_minor, currency_code,
  billing_period, status, published_at
)
values ('019ad000-0000-7000-8000-000000000511', '019ad000-0000-7000-8000-000000000501',
  '019ad000-0000-7000-8000-000000000301', 1, 12000000, 'COP', 'month', 'published',
  clock_timestamp());

insert into payments.plan_subscriptions (
  id, person_id, organization_id, plan_version_id, status, current_period_end
)
values
  ('019ad000-0000-7000-8000-000000000521', '019ad000-0000-7000-8000-000000000008',
    '019ad000-0000-7000-8000-000000000301', '019ad000-0000-7000-8000-000000000511',
    'active', (clock_timestamp() + interval '30 days')::date),
  ('019ad000-0000-7000-8000-000000000522', '019ad000-0000-7000-8000-000000000010',
    '019ad000-0000-7000-8000-000000000301', '019ad000-0000-7000-8000-000000000511',
    'active', (clock_timestamp() + interval '30 days')::date);

-- The gateway account, and the credential hanging off it that nobody here may read.
insert into payments.gateway_connections (id, organization_id, provider, status)
values ('019ad000-0000-7000-8000-000000000531', '019ad000-0000-7000-8000-000000000301',
  'mercado_pago', 'active');

insert into payments.gateway_credentials
  (connection_id, organization_id, external_account_ref, credential_secret_ref)
values ('019ad000-0000-7000-8000-000000000531', '019ad000-0000-7000-8000-000000000301',
  'mp_acct_norte', 'vault://gateway/norte');

-- Pro exists as a published plan of Allfit, which is one of the two conditions
-- criterion 6 depends on. The other is the gym being active.
insert into payments.platform_plans (
  id, code, name, plan_kind, status, created_by_person_id, created_by_duty_assignment_id
)
select '019ad000-0000-7000-8000-000000000541', 'pro', 'Pro', 'paid', 'published',
  '019ad000-0000-7000-8000-000000000001', duty.id
from support.platform_duty_assignments as duty
where duty.person_id = '019ad000-0000-7000-8000-000000000003'
  and duty.duty_code = 'diagnose_support_metadata';

insert into payments.platform_plan_versions (
  id, platform_plan_id, plan_kind, version_number, amount_minor, currency_code,
  billing_period, status, proposed_by_person_id, proposed_by_duty_assignment_id,
  published_by_person_id, published_by_duty_assignment_id, published_at
)
select '019ad000-0000-7000-8000-000000000542', '019ad000-0000-7000-8000-000000000541',
  'paid', 1, 1990000, 'COP', 'month', 'published',
  '019ad000-0000-7000-8000-000000000001', duty.id,
  '019ad000-0000-7000-8000-000000000002', duty.id, clock_timestamp()
from support.platform_duty_assignments as duty
where duty.person_id = '019ad000-0000-7000-8000-000000000003'
  and duty.duty_code = 'diagnose_support_metadata';

create temporary table billing_file on commit drop as
select organizations.read_backoffice_organization(
  '019ad000-0000-7000-8000-000000000003', '019ad000-0000-7000-8000-000000000033',
  '019ad000-0000-7000-8000-000000000301'
) as file;

create temporary table unclaimed_pro_file on commit drop as
select organizations.read_backoffice_organization(
  '019ad000-0000-7000-8000-000000000003', '019ad000-0000-7000-8000-000000000033',
  '019ad000-0000-7000-8000-000000000303'
) as file;

select is(
  (select jsonb_array_length(file->'plans') from billing_file),
  1,
  'the file lists the plan the gym publishes and not the draft beside it'
);

select results_eq(
  $$ select item->>'name', (item->>'amount_minor')::bigint, item->>'currency_code',
            (item->>'subscribers')::integer
     from billing_file, jsonb_array_elements(file->'plans') as item $$,
  $$ values ('Mensual'::text, 12000000::bigint, 'COP'::text, 2) $$,
  'with the price in force and how many of its clients pay it'
);

select ok(
  (select (file->'payment_method'->>'connected')::boolean
     and file->'payment_method'->>'provider' = 'mercado_pago'
   from billing_file),
  'and that the gym can be paid, naming the provider and nothing else'
);

-- Criterion 5, the half that matters: the account reference and the vault key are not
-- in the file, and not for lack of selecting them.
select ok(
  (select position('mp_acct_norte' in file::text) = 0
     and position('vault://' in file::text) = 0
     and position('credential' in file::text) = 0
   from billing_file),
  'no credential and no account reference travels in the file'
);

select ok(
  (select (file->'premium'->>'gives_pro')::boolean
     and file->'premium'->>'reason' is null
   from billing_file),
  'an active gym gives Pro to the people it serves, which by ADR-043 needs no switch'
);

select ok(
  (select not (file->'premium'->>'gives_pro')::boolean
     and file->'premium'->>'reason' = 'organization_not_active'
   from unclaimed_pro_file),
  'and one nobody has claimed gives nothing, with the reason said out loud'
);

-- The gym it belongs to does not appear in another gym's file.
select is(
  (select jsonb_array_length(file->'plans') from unclaimed_pro_file),
  0,
  'a gym with no plans published has an empty list, which is a fact and not a gap'
);

-- And the table itself refuses the credential, which is what the file depends on. With
-- a policy on `gateway_credentials` this assertion fails, and that is its whole point.
set local role allfit_owner;

select is_empty(
  $$ select 1 from payments.gateway_credentials
      where organization_id = '019ad000-0000-7000-8000-000000000301' $$,
  'Allfit''s own team cannot read the gym''s credential at all: there is no policy for it'
);

select isnt_empty(
  $$ select 1 from payments.gateway_connections
      where organization_id = '019ad000-0000-7000-8000-000000000301' $$,
  'while the fact that it can be paid is readable, which is the split the schema is for'
);

reset role;

select * from finish();
rollback;
