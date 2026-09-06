-- T-CAT-COMMANDS-01 — PR-14 / OP-CAT-006: publishing result contracts.
--
-- Covers HU-BO-023: a published version is immutable, correcting one publishes
-- the next, publishing does not reinterpret what was already recorded, and the
-- operation needs `curate_global_catalog` with AAL2 — never the base role alone.

begin;

select plan(23);

insert into identity.people (id, given_name, family_name)
values
  ('019a5000-0000-7000-8000-000000000001', 'Manager', 'Alpha'),
  ('019a5000-0000-7000-8000-000000000002', 'Manager', 'Beta'),
  ('019a5000-0000-7000-8000-000000000003', 'Curator', 'Gamma');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a5000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha', null),
  ('019a5000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta', null),
  ('019a5000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma',
    '019a5000-0000-7000-8000-000000000003');

select support.bootstrap_backoffice_administrators(
  '019a5000-0000-7000-8000-000000000001', 'alpha',
  '019a5000-0000-7000-8000-000000000002', 'beta',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-CAT-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019a5000-0000-7000-8000-000000000021', '019a5000-0000-7000-8000-000000000011',
    'sid_alpha_3', 'backoffice', decode(repeat('c1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a5000-0000-7000-8000-000000000023', '019a5000-0000-7000-8000-000000000013',
    'sid_gamma_3', 'backoffice', decode(repeat('c3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019a5000-0000-7000-8000-000000000001', '019a5000-0000-7000-8000-000000000021',
  '019a5000-0000-7000-8000-000000000003', 'allfit_admin',
  '019a5000-0000-7000-8000-000000000101', '019a5000-0000-7000-8000-000000000201',
  decode(repeat('31', 32), 'hex')
);

insert into catalog.disciplines (code, name, status)
values ('test_contract_discipline', 'Contract discipline', 'published')
on conflict do nothing;

insert into catalog.activity_types (id, discipline_code, code, name, content_scope, status)
values (
  '019a5000-0000-7000-8000-000000000301', 'test_contract_discipline',
  'test_contract_activity', 'Contract activity', 'global', 'published'
);

-- The API sets the actor context before every call; the catalogue policies read
-- it, so the test has to establish it too or it would exercise a path nobody has.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019a5000-0000-7000-8000-000000000003', true);

-- T-DUTY-06 · the base role alone never publishes the global catalogue.
select throws_ok(
  $$ select catalog.publish_result_contract(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'test.backoffice_publication', 'strength', '{"kind":"envelope"}'::jsonb, '{"sets":1}'::jsonb,
    '[{"kind":"valid","payload":{"sets":2},"expected":"accepted"},
      {"kind":"invalid","payload":{},"expected":"missing_sets"}]'::jsonb,
    '019a5000-0000-7000-8000-000000000301', true,
    '019a5000-0000-7000-8000-000000000102', '019a5000-0000-7000-8000-000000000202',
    decode(repeat('32', 32), 'hex')
  ) $$,
  '42501',
  'publishing the global catalogue requires an effective duty',
  'a base role without curate_global_catalog cannot publish a contract'
);

select support.assign_platform_duty(
  '019a5000-0000-7000-8000-000000000001', '019a5000-0000-7000-8000-000000000021',
  '019a5000-0000-7000-8000-000000000003', 'curate_global_catalog',
  null, clock_timestamp() + interval '30 days', 'CASE-CURATE-01',
  '019a5000-0000-7000-8000-000000000103', '019a5000-0000-7000-8000-000000000203',
  decode(repeat('33', 32), 'hex')
);

select is(
  (select actor_mode from support.platform_duty_assignments
    where person_id = '019a5000-0000-7000-8000-000000000003'
      and duty_code = 'curate_global_catalog'),
  'A11',
  'curating the global catalogue is an A11 duty'
);

-- Fails closed without a demonstrated failure: a rule nobody proved rejecting.
select throws_ok(
  $$ select catalog.publish_result_contract(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'test.backoffice_publication', 'strength', '{"kind":"envelope"}'::jsonb, '{"sets":1}'::jsonb,
    '[{"kind":"valid","payload":{"sets":2},"expected":"accepted"}]'::jsonb,
    '019a5000-0000-7000-8000-000000000301', true,
    '019a5000-0000-7000-8000-000000000104', '019a5000-0000-7000-8000-000000000204',
    decode(repeat('34', 32), 'hex')
  ) $$,
  '22023',
  'a result contract needs a passing and a failing fixture',
  'publishing without a failing fixture is refused'
);

select throws_ok(
  $$ select catalog.publish_result_contract(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'test.backoffice_publication', 'strength', '{"kind":"envelope"}'::jsonb, '{"sets":1}'::jsonb,
    '[{"kind":"invalid","payload":{},"expected":"missing_sets"}]'::jsonb,
    '019a5000-0000-7000-8000-000000000301', true,
    '019a5000-0000-7000-8000-000000000105', '019a5000-0000-7000-8000-000000000205',
    decode(repeat('35', 32), 'hex')
  ) $$,
  '22023',
  'a result contract needs a passing and a failing fixture',
  'publishing without a passing fixture is refused'
);

select throws_ok(
  $$ select catalog.publish_result_contract(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'test.backoffice_publication', 'strength', '{"kind":"envelope"}'::jsonb, '{"sets":1}'::jsonb,
    '[{"kind":"valid","payload":{"sets":2},"expected":"accepted"},
      {"kind":"invalid","payload":{},"expected":"missing_sets"}]'::jsonb,
    '019a5000-0000-7000-8000-000000000399', true,
    '019a5000-0000-7000-8000-000000000106', '019a5000-0000-7000-8000-000000000206',
    decode(repeat('36', 32), 'hex')
  ) $$,
  'P0002',
  'activity type not found in the global catalogue',
  'a contract is never bound to an activity type outside the global catalogue'
);

-- The first published version.
select is(
  (select (result->>'version_number')::integer from catalog.publish_result_contract(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'test.backoffice_publication', 'strength', '{"kind":"envelope"}'::jsonb, '{"sets":1}'::jsonb,
    '[{"kind":"valid","payload":{"sets":2},"expected":"accepted"},
      {"kind":"invalid","payload":{},"expected":"missing_sets"}]'::jsonb,
    '019a5000-0000-7000-8000-000000000301', true,
    '019a5000-0000-7000-8000-000000000107', '019a5000-0000-7000-8000-000000000207',
    decode(repeat('37', 32), 'hex')
  )),
  1,
  'the server assigns the first version number'
);

select is(
  (select status::text from catalog.result_contracts
    where contract_code = 'test.backoffice_publication' and version_number = 1),
  'published',
  'the contract is published, not left as a draft'
);

select is(
  (select count(*) from catalog.contract_fixtures as fixture
    join catalog.result_contracts as contract on contract.id = fixture.result_contract_id
    where contract.contract_code = 'test.backoffice_publication'),
  2::bigint,
  'both fixtures are stored with the contract'
);

select is(
  (select count(*) from catalog.activity_type_result_contracts
    where activity_type_id = '019a5000-0000-7000-8000-000000000301'
      and is_default and valid_to is null),
  1::bigint,
  'the contract becomes the effective default for its activity type'
);

select is(
  (select count(*) from system.outbox_events
    where event_type = 'catalog.result_contract_published.v1'),
  1::bigint,
  'publication emits exactly one domain event'
);

-- Criterion 2 · a published version is not edited.
select throws_ok(
  $$ update catalog.result_contracts set minimums = '{"sets":5}'::jsonb
     where contract_code = 'test.backoffice_publication' and version_number = 1 $$,
  '55000',
  'published result contract is immutable',
  'the rules of a published contract cannot be rewritten'
);

select throws_ok(
  $$ delete from catalog.result_contracts
     where contract_code = 'test.backoffice_publication' and version_number = 1 $$,
  '55000',
  'published result contract is immutable',
  'a published contract cannot be deleted'
);

select throws_ok(
  $$ update catalog.contract_fixtures set expected = 'anything'
     where result_contract_id = (select id from catalog.result_contracts
       where contract_code = 'test.backoffice_publication' and version_number = 1) $$,
  '23514',
  'the fixtures of a published contract are immutable',
  'the evidence a published contract was demonstrated with is immutable'
);

-- Criterion 2 · correcting means publishing the next version.
select is(
  (select (result->>'version_number')::integer from catalog.publish_result_contract(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'test.backoffice_publication', 'strength', '{"kind":"envelope"}'::jsonb, '{"sets":3}'::jsonb,
    '[{"kind":"valid","payload":{"sets":4},"expected":"accepted"},
      {"kind":"invalid","payload":{"sets":1},"expected":"below_minimum"}]'::jsonb,
    '019a5000-0000-7000-8000-000000000301', true,
    '019a5000-0000-7000-8000-000000000108', '019a5000-0000-7000-8000-000000000208',
    decode(repeat('38', 32), 'hex')
  )),
  2,
  'correcting a contract publishes the next version'
);

-- Criterion 3 · publishing v2 does not reinterpret what v1 already governed.
select is(
  (select minimums->>'sets' from catalog.result_contracts
    where contract_code = 'test.backoffice_publication' and version_number = 1),
  '1',
  'the previous version keeps the rules it was published with'
);

select is(
  (select status::text from catalog.result_contracts
    where contract_code = 'test.backoffice_publication' and version_number = 1),
  'published',
  'publishing a newer version does not retire the older one by itself'
);

select is(
  (select count(*) from catalog.activity_type_result_contracts as binding
    join catalog.result_contracts as contract on contract.id = binding.result_contract_id
    where contract.contract_code = 'test.backoffice_publication' and contract.version_number = 1
      and binding.valid_to is not null),
  1::bigint,
  'the superseded association is closed with a window instead of being deleted'
);

select ok(
  (select bool_and(binding->>'valid_to' is not null)
    from catalog.result_contracts as contract,
         jsonb_array_elements(
           catalog.result_contract_projection(contract.id)->'activity_type_bindings'
         ) as binding
    where contract.contract_code = 'test.backoffice_publication' and contract.version_number = 1),
  'the operator sees the superseded association with the window that closed it'
);

-- Deprecation stops new executions from freezing it, and nothing else.
select is(
  (select (result->>'status') from catalog.deprecate_result_contract(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    (select id from catalog.result_contracts
      where contract_code = 'test.backoffice_publication' and version_number = 1),
    '019a5000-0000-7000-8000-000000000109', '019a5000-0000-7000-8000-000000000209',
    decode(repeat('39', 32), 'hex')
  )),
  'deprecated',
  'a published contract can be deprecated'
);

select throws_ok(
  $$ update catalog.result_contracts set status = 'published'
     where contract_code = 'test.backoffice_publication' and version_number = 1 $$,
  '55000',
  'published result contract is immutable',
  'deprecation is terminal'
);

-- Repeating the same command converges instead of publishing twice.
select is(
  (select replayed from catalog.publish_result_contract(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'test.backoffice_publication', 'strength', '{"kind":"envelope"}'::jsonb, '{"sets":3}'::jsonb,
    '[{"kind":"valid","payload":{"sets":4},"expected":"accepted"},
      {"kind":"invalid","payload":{"sets":1},"expected":"below_minimum"}]'::jsonb,
    '019a5000-0000-7000-8000-000000000301', true,
    '019a5000-0000-7000-8000-000000000108', '019a5000-0000-7000-8000-000000000208',
    decode(repeat('38', 32), 'hex')
  )),
  true,
  'replaying the publication returns the same version instead of creating a third'
);

select is(
  (select count(*) from catalog.result_contracts where contract_code = 'test.backoffice_publication'),
  2::bigint,
  'a replayed publication leaves exactly two versions'
);

-- Minimal grants: fixtures are platform evidence, not product data.
select ok(
  not has_table_privilege('allfit_api', 'catalog.contract_fixtures', 'SELECT')
    and not has_table_privilege('allfit_api', 'catalog.result_contracts', 'INSERT')
    and has_function_privilege(
      'allfit_api',
      'catalog.deprecate_result_contract(uuid,uuid,uuid,uuid,uuid,bytea)',
      'EXECUTE'
    ),
  'the runtime role reaches contracts only through the closed commands'
);

select * from finish();
rollback;
