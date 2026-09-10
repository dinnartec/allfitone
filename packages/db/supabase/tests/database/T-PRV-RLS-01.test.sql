-- T-PRV-RLS-01 — PR-007 / OP-PRV-011: published permission definitions.
--
-- `HU-BO-024`. Criterion 3 is the reason this schema looks the way it does:
-- publishing a wider version must not widen what somebody already granted. That
-- is not a check at publish time — it is the consequence of a grant pointing at
-- one specific, frozen version. What this test can prove is the half that makes
-- it possible: versions are independently addressable and a published one can
-- never be rewritten. `privacy.data_grants` does not exist yet, so the other
-- half — an existing grant keeping its old version — waits for that slice.

begin;

select plan(20);

insert into identity.people (id, given_name, family_name, status)
values
  ('019a7000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019a7000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019a7000-0000-7000-8000-000000000003', 'Curator', 'Gamma', 'active'),
  ('019a7000-0000-7000-8000-000000000004', 'Badged', 'Delta', 'active'),
  ('019a7000-0000-7000-8000-000000000005', 'Reader', 'Epsilon', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a7000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha7', null),
  ('019a7000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta7', null),
  ('019a7000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma7',
    '019a7000-0000-7000-8000-000000000003'),
  ('019a7000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta7',
    '019a7000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019a7000-0000-7000-8000-000000000001', 'alpha7',
  '019a7000-0000-7000-8000-000000000002', 'beta7',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-PRV-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019a7000-0000-7000-8000-000000000021', '019a7000-0000-7000-8000-000000000011',
    'sid_alpha_7', 'backoffice', decode(repeat('e1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a7000-0000-7000-8000-000000000023', '019a7000-0000-7000-8000-000000000013',
    'sid_gamma_7', 'backoffice', decode(repeat('e3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a7000-0000-7000-8000-000000000024', '019a7000-0000-7000-8000-000000000014',
    'sid_delta_7', 'backoffice', decode(repeat('e4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019a7000-0000-7000-8000-000000000001', '019a7000-0000-7000-8000-000000000021',
  '019a7000-0000-7000-8000-000000000003', 'allfit_admin',
  '019a7000-0000-7000-8000-000000000101', '019a7000-0000-7000-8000-000000000201',
  decode(repeat('51', 32), 'hex')
);
select support.assign_platform_role(
  '019a7000-0000-7000-8000-000000000001', '019a7000-0000-7000-8000-000000000021',
  '019a7000-0000-7000-8000-000000000004', 'allfit_admin',
  '019a7000-0000-7000-8000-000000000102', '019a7000-0000-7000-8000-000000000202',
  decode(repeat('52', 32), 'hex')
);
select support.assign_platform_duty(
  '019a7000-0000-7000-8000-000000000001', '019a7000-0000-7000-8000-000000000021',
  '019a7000-0000-7000-8000-000000000003', 'curate_global_catalog',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-024',
  '019a7000-0000-7000-8000-000000000103', '019a7000-0000-7000-8000-000000000203',
  decode(repeat('53', 32), 'hex')
);

-- The actor context the API adapter sets on every platform write. The insert
-- policies require it, so a transaction that forgot the ritual writes nothing.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019a7000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Criterion 4 — the curation duty is the control
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from privacy.publish_scope_definition(
    '019a7000-0000-7000-8000-000000000004', '019a7000-0000-7000-8000-000000000024',
    'body_progress',
    '[{"resource":"execution.body_measurements","field":"weight_kg","data_classification_code":"body","max_action":"read"}]',
    '11111111-1111-4111-8111-111111111101', '019a7000-0000-7000-8000-000000000301',
    decode(repeat('61', 32), 'hex')
  ) $$,
  '42501',
  null,
  'the base role alone cannot publish a permission definition'
);

select is(
  (select count(*) from privacy.scope_definitions)::integer,
  0,
  'a refused publication leaves nothing behind'
);

-- ---------------------------------------------------------------------------
-- Criterion 1 — what it includes and what it excludes
-- ---------------------------------------------------------------------------

select ok(
  (select (result->>'version_number')::integer = 1
   from privacy.publish_scope_definition(
     '019a7000-0000-7000-8000-000000000003', '019a7000-0000-7000-8000-000000000023',
     'body_progress',
     '[{"resource":"execution.body_measurements","field":"weight_kg","data_classification_code":"body","max_action":"read","historical_readable":true},
       {"resource":"execution.body_measurements","field":"body_fat_pct","data_classification_code":"body","max_action":"read"},
       {"resource":"nutrition.intake_entries","field":"*","data_classification_code":"nutrition","max_action":"read","is_excluded":true}]',
     '11111111-1111-4111-8111-111111111102', '019a7000-0000-7000-8000-000000000302',
     decode(repeat('62', 32), 'hex')
   )),
  'the first version of a scope is numbered by the server, not by the caller'
);

select is(
  (select jsonb_array_length(
     privacy.scope_definition_projection(definition.id)->'rules'
   )
   from privacy.scope_definitions as definition where definition.scope_code = 'body_progress'),
  3,
  'every enumerated field travels, included and excluded alike'
);

select is(
  (select count(*)::integer from privacy.scope_resource_rules as rule
   join privacy.scope_definitions as definition on definition.id = rule.scope_definition_id
   where definition.scope_code = 'body_progress' and rule.is_excluded),
  1,
  'an exclusion is stored as an exclusion, not as an absence'
);

select throws_ok(
  $$ select * from privacy.publish_scope_definition(
    '019a7000-0000-7000-8000-000000000003', '019a7000-0000-7000-8000-000000000023',
    'health_context', '[]',
    '11111111-1111-4111-8111-111111111103', '019a7000-0000-7000-8000-000000000303',
    decode(repeat('63', 32), 'hex')
  ) $$,
  '22023',
  'a scope version enumerates at least one resource and field',
  'a version that enumerates nothing is refused'
);

-- A permission that includes nothing is not a permission, even if it lists
-- exclusions.
select throws_ok(
  $$ select * from privacy.publish_scope_definition(
    '019a7000-0000-7000-8000-000000000003', '019a7000-0000-7000-8000-000000000023',
    'health_context',
    '[{"resource":"identity.people","field":"contact_email","data_classification_code":"identity_pii","max_action":"read","is_excluded":true}]',
    '11111111-1111-4111-8111-111111111104', '019a7000-0000-7000-8000-000000000304',
    decode(repeat('64', 32), 'hex')
  ) $$,
  '22023',
  'a scope version that includes nothing is not a permission',
  'a version made only of exclusions grants nothing and is refused'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — a published version is immutable
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update privacy.scope_definitions set status = 'deprecated'
     where scope_code = 'body_progress' $$,
  '55000',
  'a published scope version is immutable: publish the next one',
  'a published version cannot be rewritten'
);

select throws_ok(
  $$ delete from privacy.scope_definitions where scope_code = 'body_progress' $$,
  '55000',
  'a scope definition is never deleted',
  'a published version cannot be deleted: grants reference it'
);

select throws_ok(
  $$ update privacy.scope_resource_rules set is_excluded = true
     where scope_definition_id = (
       select id from privacy.scope_definitions where scope_code = 'body_progress'
     ) $$,
  '55000',
  'the rules of a published scope version are immutable',
  'the rules of a published version cannot be edited either'
);

select throws_ok(
  $$ insert into privacy.scope_resource_rules (
       scope_definition_id, resource, field, data_classification_code, max_action
     ) values (
       (select id from privacy.scope_definitions where scope_code = 'body_progress'),
       'execution.body_measurements', 'sneaked_in', 'body', 'read'
     ) $$,
  '55000',
  'the rules of a published scope version are immutable',
  'a field cannot be added to a version after it was published'
);

-- ---------------------------------------------------------------------------
-- Criterion 3 — a wider version does not widen what was granted
-- ---------------------------------------------------------------------------

select ok(
  (select (result->>'version_number')::integer = 2
   from privacy.publish_scope_definition(
     '019a7000-0000-7000-8000-000000000003', '019a7000-0000-7000-8000-000000000023',
     'body_progress',
     '[{"resource":"execution.body_measurements","field":"weight_kg","data_classification_code":"body","max_action":"read"},
       {"resource":"execution.body_measurements","field":"body_fat_pct","data_classification_code":"body","max_action":"read"},
       {"resource":"nutrition.intake_entries","field":"*","data_classification_code":"nutrition","max_action":"read"}]',
     '11111111-1111-4111-8111-111111111105', '019a7000-0000-7000-8000-000000000305',
     decode(repeat('65', 32), 'hex')
   )),
  'correcting a scope means publishing the next version'
);

-- The whole point: version 1 still says what it said. A grant pointing at it is
-- pointing at these rules, not at the wider ones published afterwards.
select is(
  (select count(*)::integer from privacy.scope_resource_rules as rule
   join privacy.scope_definitions as definition on definition.id = rule.scope_definition_id
   where definition.scope_code = 'body_progress' and definition.version_number = 1
     and rule.is_excluded),
  1,
  'the earlier version keeps its exclusion after a wider one is published'
);

select is(
  (select count(*)::integer from privacy.scope_resource_rules as rule
   join privacy.scope_definitions as definition on definition.id = rule.scope_definition_id
   where definition.scope_code = 'body_progress' and definition.version_number = 2
     and rule.is_excluded),
  0,
  'the newer version is genuinely wider, so the two are distinguishable'
);

-- A grant references the pair, so it cannot drift onto another version.
select ok(
  (select count(*) = 1 from pg_constraint
   where conrelid = 'privacy.scope_definitions'::regclass
     and conname = 'uq_scope_definitions_carrier'),
  'the carrier key exists, so a grant can name one version and only that one'
);

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------

select ok(
  (select replayed from privacy.publish_scope_definition(
    '019a7000-0000-7000-8000-000000000003', '019a7000-0000-7000-8000-000000000023',
    'body_progress',
    '[{"resource":"execution.body_measurements","field":"weight_kg","data_classification_code":"body","max_action":"read"},
      {"resource":"execution.body_measurements","field":"body_fat_pct","data_classification_code":"body","max_action":"read"},
      {"resource":"nutrition.intake_entries","field":"*","data_classification_code":"nutrition","max_action":"read"}]',
    '11111111-1111-4111-8111-111111111105', '019a7000-0000-7000-8000-000000000305',
    decode(repeat('65', 32), 'hex')
  )),
  'a repeated command replays its own answer instead of publishing a third version'
);

select is(
  (select count(*)::integer from privacy.scope_definitions where scope_code = 'body_progress'),
  2,
  'and it really did not create another version'
);

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from privacy.list_scope_definitions(
    '019a7000-0000-7000-8000-000000000003', '019a7000-0000-7000-8000-000000000023'
  ))::integer,
  2,
  'the curator reads what is published, newest version of each scope first'
);

select throws_ok(
  $$ select * from privacy.list_scope_definitions(
    '019a7000-0000-7000-8000-000000000004', '019a7000-0000-7000-8000-000000000024'
  ) $$,
  '42501',
  null,
  'reading the published definitions still needs the curation duty'
);

-- ---------------------------------------------------------------------------
-- Minimal grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'allfit_api',
    'privacy.publish_scope_definition(uuid,uuid,text,jsonb,uuid,uuid,bytea)',
    'EXECUTE'
  )
    and has_function_privilege(
      'allfit_api', 'privacy.list_scope_definitions(uuid,uuid)', 'EXECUTE'
    )
    and not has_table_privilege('allfit_api', 'privacy.scope_definitions', 'INSERT')
    and not has_table_privilege('allfit_api', 'privacy.scope_resource_rules', 'INSERT'),
  'the runtime role publishes through the command and never writes the tables'
);

select * from finish();
rollback;
