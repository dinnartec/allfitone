-- T-PAY-PLAN-01 — NEW-PAY-PLATFORM-PLAN, OP-PAY-017, OP-PAY-024..026: Allfit's own plans
-- (`HU-BO-025`, `HU-BO-026`).
--
-- **A published version never changes.** Whoever subscribed to a version keeps exactly
-- what they accepted; changing a price or a limit is publishing another version.
--
-- **Two people publish.** One proposes, somebody else publishes, and the proposal shows
-- what changes against the version in force. A proposal that changes nothing is refused.
--
-- **The free plan is a plan.** There is one, its price is zero, and its limits are data.
--
-- **Privacy is never for sale.** No privacy function can enter the feature catalogue, a
-- version cannot name a function the catalogue does not hold, and the runtime writes
-- the catalogue through nothing at all.

begin;

select plan(48);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b4000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019b4000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019b4000-0000-7000-8000-000000000003', 'Commerce', 'Gamma', 'active'),
  ('019b4000-0000-7000-8000-000000000004', 'Commerce', 'Delta', 'active'),
  ('019b4000-0000-7000-8000-000000000005', 'Support', 'Epsilon', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b4000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha_plan', null),
  ('019b4000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta_plan', null),
  ('019b4000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma_plan',
    '019b4000-0000-7000-8000-000000000003'),
  ('019b4000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta_plan',
    '019b4000-0000-7000-8000-000000000004'),
  ('019b4000-0000-7000-8000-000000000015', 'workos', 'https://issuer.test', 'epsilon_plan',
    '019b4000-0000-7000-8000-000000000005');

select support.bootstrap_backoffice_administrators(
  '019b4000-0000-7000-8000-000000000001', 'alpha_plan',
  '019b4000-0000-7000-8000-000000000002', 'beta_plan',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-PAY-PLAN-01'
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
  ('019b4000-0000-7000-8000-000000000021'::uuid, '019b4000-0000-7000-8000-000000000011'::uuid,
    'alpha_plan', 'e1'),
  ('019b4000-0000-7000-8000-000000000023'::uuid, '019b4000-0000-7000-8000-000000000013'::uuid,
    'gamma_plan', 'e3'),
  ('019b4000-0000-7000-8000-000000000024'::uuid, '019b4000-0000-7000-8000-000000000014'::uuid,
    'delta_plan', 'e4'),
  ('019b4000-0000-7000-8000-000000000025'::uuid, '019b4000-0000-7000-8000-000000000015'::uuid,
    'epsilon_plan', 'e5')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b4000-0000-7000-8000-000000000001', '019b4000-0000-7000-8000-000000000021',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b4000-0000-7000-8000-000000000003'::uuid, '019b4000-0000-7000-8000-000000000103'::uuid,
    '019b4000-0000-7000-8000-000000000203'::uuid, '63'),
  ('019b4000-0000-7000-8000-000000000004'::uuid, '019b4000-0000-7000-8000-000000000104'::uuid,
    '019b4000-0000-7000-8000-000000000204'::uuid, '64'),
  ('019b4000-0000-7000-8000-000000000005'::uuid, '019b4000-0000-7000-8000-000000000105'::uuid,
    '019b4000-0000-7000-8000-000000000205'::uuid, '65')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019b4000-0000-7000-8000-000000000001', '019b4000-0000-7000-8000-000000000021',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-025', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b4000-0000-7000-8000-000000000003'::uuid, 'manage_platform_commercial',
    '019b4000-0000-7000-8000-000000000113'::uuid, '019b4000-0000-7000-8000-000000000213'::uuid, '73'),
  ('019b4000-0000-7000-8000-000000000004'::uuid, 'manage_platform_commercial',
    '019b4000-0000-7000-8000-000000000114'::uuid, '019b4000-0000-7000-8000-000000000214'::uuid, '74'),
  ('019b4000-0000-7000-8000-000000000005'::uuid, 'diagnose_support_metadata',
    '019b4000-0000-7000-8000-000000000115'::uuid, '019b4000-0000-7000-8000-000000000215'::uuid, '75')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- The catalogue ships empty until product decides it; these two exist only here.
insert into payments.platform_features (code, name, unit)
values
  ('meal_logs_per_day', 'Comidas registradas por día', 'items'),
  ('history_weeks', 'Semanas de historial comparado', 'weeks');

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b4000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Who manages Allfit's plans
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select payments.list_platform_plans(
    '019b4000-0000-7000-8000-000000000005', '019b4000-0000-7000-8000-000000000025'
  ) $$,
  '42501', null,
  'a support duty does not read Allfit''s plans'
);

select throws_ok(
  $$ select * from payments.create_platform_plan(
    '019b4000-0000-7000-8000-000000000005', '019b4000-0000-7000-8000-000000000025',
    'premium', 'Premium', 'paid',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  ) $$,
  '42501', null,
  'nor creates one'
);

select throws_ok(
  $$ select payments.list_platform_plans(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000024'
  ) $$,
  '42501', null,
  'a session that is not the operator''s own reads nothing'
);

select is(
  (select jsonb_agg(entry->>'code' order by entry->>'code')
   from jsonb_array_elements(payments.list_platform_plans(
     '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023'
   )->'feature_catalog') as entry),
  '["history_weeks", "meal_logs_per_day"]'::jsonb,
  'the commercial duty reads the feature catalogue a plan can limit'
);

-- ---------------------------------------------------------------------------
-- Creating plans
-- ---------------------------------------------------------------------------

create temporary table free_plan on commit drop as
select * from payments.create_platform_plan(
  '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
  'free', 'Gratis', 'free',
  'a1000000-0000-4000-8000-000000000001', '019b4000-0000-7000-8000-000000000301',
  decode(repeat('a1', 32), 'hex')
);

select results_eq(
  $$ select result->>'plan_kind', result->>'status', result->'current_version', replayed
     from free_plan $$,
  $$ values ('free'::text, 'draft'::text, 'null'::jsonb, false) $$,
  'a new plan is a draft with nothing in force yet'
);

select results_eq(
  $$ select (result->>'id')::uuid, replayed from payments.create_platform_plan(
       '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
       'free', 'Gratis', 'free',
       'a1000000-0000-4000-8000-000000000001', '019b4000-0000-7000-8000-000000000301',
       decode(repeat('a1', 32), 'hex')
     ) $$,
  $$ select (result->>'id')::uuid, true from free_plan $$,
  'retrying the creation returns the same plan instead of a second one'
);

select throws_ok(
  $$ select * from payments.create_platform_plan(
    '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
    'basico', 'Básico', 'free',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  ) $$,
  '23505', null,
  'there is one free plan: its limits change by versions, not by replacing it'
);

create temporary table paid_plan on commit drop as
select * from payments.create_platform_plan(
  '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
  'premium', 'Premium', 'paid',
  gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
);

select throws_ok(
  $$ select * from payments.create_platform_plan(
    '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
    'premium', 'Otro Premium', 'paid',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  ) $$,
  '23505', null,
  'a plan code is taken once'
);

select throws_ok(
  $$ select * from payments.create_platform_plan(
    '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
    'Premium Plus', 'Premium Plus', 'paid',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  ) $$,
  '22023', null,
  'a plan code is a stable lowercase identifier'
);

-- ---------------------------------------------------------------------------
-- What a proposal must say
-- ---------------------------------------------------------------------------

create function pg_temp.propose(
  p_actor uuid, p_session uuid, p_plan uuid, p_amount bigint, p_currency text,
  p_period text, p_features jsonb
) returns jsonb
language sql as $fn$
  select result from payments.propose_platform_plan_version(
    p_actor, p_session, p_plan, p_amount, p_currency, p_period, p_features,
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  )
$fn$;

create function pg_temp.publish(p_actor uuid, p_session uuid, p_plan uuid, p_version uuid)
returns jsonb
language sql as $fn$
  select result from payments.publish_platform_plan_version(
    p_actor, p_session, p_plan, p_version,
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  )
$fn$;

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 1000, 'COP', null,
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":1},
      {"feature_code":"history_weeks","enabled":false,"limit_value":null}]'
  ) $$, (select result->>'id' from free_plan)),
  '22023', null,
  'the free plan costs nothing'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 0, 'COP', 'month',
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
      {"feature_code":"history_weeks","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '22023', null,
  'a paid plan costs something'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 3990000, 'COP', 'weekly',
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
      {"feature_code":"history_weeks","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '22023', null,
  'and is charged monthly or yearly'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 3990000, 'pesos', 'month',
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
      {"feature_code":"history_weeks","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '22023', null,
  'in an ISO 4217 currency'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 3990000, 'COP', 'month',
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
      {"feature_code":"history_weeks","enabled":true,"limit_value":null},
      {"feature_code":"see_who_read_my_data","enabled":false,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '22023', null,
  'a version cannot limit a function the catalogue does not hold'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 3990000, 'COP', 'month',
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '22023', null,
  'a version says what it does with every function, so nothing is left to guess'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 3990000, 'COP', 'month',
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":-1},
      {"feature_code":"history_weeks","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '22023', null,
  'a limit is never negative'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 3990000, 'COP', 'month',
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
      {"feature_code":"meal_logs_per_day","enabled":false,"limit_value":null},
      {"feature_code":"history_weeks","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '22023', null,
  'nor said twice'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, 3990000, 'COP', 'month',
    '[{"feature_code":"meal_logs_per_day","enabled":false,"limit_value":5},
      {"feature_code":"history_weeks","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '22023', null,
  'and a function left out of the plan carries no limit'
);

-- ---------------------------------------------------------------------------
-- Proposing and publishing: two people
-- ---------------------------------------------------------------------------

create temporary table premium_v1 on commit drop as
select pg_temp.propose(
  '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
  (select (result->>'id')::uuid from paid_plan), 3990000, 'COP', 'month',
  '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
    {"feature_code":"history_weeks","enabled":true,"limit_value":12}]'
) as plan;

select results_eq(
  $$ select plan->'proposal'->>'status', (plan->'proposal'->>'version_number')::integer,
            plan->'proposal'->'supersedes_version_id', plan->'proposal'->'changes',
            (plan->'proposal'->>'proposed_by_self')::boolean
     from premium_v1 $$,
  $$ values ('draft'::text, 1, 'null'::jsonb, 'null'::jsonb, true) $$,
  'the first proposal is version 1, supersedes nothing, and is the proposer''s own'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
    %L, 4990000, 'COP', 'month',
    '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
      {"feature_code":"history_weeks","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '55000', null,
  'a plan has one proposal open at a time'
);

select is(
  (select (plan_entry->'proposal'->>'proposed_by_self')::boolean
   from jsonb_array_elements(payments.list_platform_plans(
     '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024'
   )->'plans') as plan_entry
   where plan_entry->>'code' = 'premium'),
  false,
  'another operator sees the proposal as somebody else''s, so it is theirs to review'
);

select throws_ok(
  format($$ select pg_temp.publish(
    '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
    %L, %L
  ) $$,
    (select result->>'id' from paid_plan),
    (select plan->'proposal'->>'id' from premium_v1)),
  '42501', null,
  'nobody publishes their own proposal'
);

create temporary table premium_v1_published on commit drop as
select pg_temp.publish(
  '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
  (select (result->>'id')::uuid from paid_plan),
  (select (plan->'proposal'->>'id')::uuid from premium_v1)
) as plan;

select results_eq(
  $$ select plan->>'status', plan->'current_version'->>'status',
            plan->'current_version'->>'published_by_person_id', plan->'proposal'
     from premium_v1_published $$,
  $$ values ('published'::text, 'published'::text,
             '019b4000-0000-7000-8000-000000000004'::text, 'null'::jsonb) $$,
  'somebody else publishes it, and the plan is published with it'
);

select ok(
  (select version.proposed_by_duty_assignment_id = gamma.id
      and version.published_by_duty_assignment_id = delta.id
   from payments.platform_plan_versions as version,
        support.platform_duty_assignments as gamma,
        support.platform_duty_assignments as delta
   where version.id = (select (plan->'current_version'->>'id')::uuid from premium_v1_published)
     and gamma.person_id = '019b4000-0000-7000-8000-000000000003'
     and gamma.duty_code = 'manage_platform_commercial'
     and delta.person_id = '019b4000-0000-7000-8000-000000000004'
     and delta.duty_code = 'manage_platform_commercial'),
  'each step keeps the duty assignment it was taken under'
);

select results_eq(
  $$ select event_type, count(*)::integer from system.outbox_events
     where aggregate_id in (
       (select (result->>'id')::uuid from paid_plan),
       (select (plan->'current_version'->>'id')::uuid from premium_v1_published)
     )
     group by event_type order by event_type $$,
  $$ values ('payments.platform_plan_published.v1'::text, 1),
            ('payments.platform_plan_version_published.v1'::text, 1) $$,
  'publishing says so once for the plan and once for the version'
);

-- ---------------------------------------------------------------------------
-- A published version never changes
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ update payments.platform_plan_versions set amount_minor = 1 where id = %L $$,
    (select plan->'current_version'->>'id' from premium_v1_published)),
  '55000', null,
  'a published price is never rewritten'
);

select throws_ok(
  format($$ update payments.platform_plan_features set limit_value = 1
            where platform_plan_version_id = %L $$,
    (select plan->'current_version'->>'id' from premium_v1_published)),
  '55000', null,
  'nor a published limit'
);

select throws_ok(
  format($$ insert into payments.platform_plan_features (platform_plan_version_id, feature_code, enabled)
            values (%L, 'meal_logs_per_day', false) $$,
    (select plan->'current_version'->>'id' from premium_v1_published)),
  '55000', null,
  'nor does a published version gain a function'
);

select throws_ok(
  format($$ delete from payments.platform_plan_versions where id = %L $$,
    (select plan->'current_version'->>'id' from premium_v1_published)),
  '55000', null,
  'and no version is ever deleted'
);

select throws_ok(
  format($$ select pg_temp.propose(
    '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
    %L, 3990000, 'COP', 'month',
    '[{"feature_code":"history_weeks","enabled":true,"limit_value":12},
      {"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null}]'
  ) $$, (select result->>'id' from paid_plan)),
  '55000', null,
  'a proposal that changes nothing has nothing to review'
);

-- ---------------------------------------------------------------------------
-- A new version, with what it changes
-- ---------------------------------------------------------------------------

create temporary table premium_v2 on commit drop as
select pg_temp.propose(
  '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
  (select (result->>'id')::uuid from paid_plan), 4490000, 'COP', 'month',
  '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
    {"feature_code":"history_weeks","enabled":true,"limit_value":24}]'
) as plan;

select results_eq(
  $$ select (plan->'proposal'->>'version_number')::integer,
            (plan->'proposal'->>'supersedes_version_id')
     from premium_v2 $$,
  $$ select 2, plan->'current_version'->>'id' from premium_v1_published $$,
  'the next proposal is version 2 and names the version it would replace'
);

select results_eq(
  $$ select change->>'field', change->>'feature_code', change->'before', change->'after'
     from premium_v2, jsonb_array_elements(plan->'proposal'->'changes') as change
     order by 1, 2 $$,
  $$ values ('amount_minor'::text, null::text, '3990000'::jsonb, '4490000'::jsonb),
            ('feature'::text, 'history_weeks'::text,
              '{"enabled": true, "limit_value": 12}'::jsonb,
              '{"enabled": true, "limit_value": 24}'::jsonb) $$,
  'the reviewer sees exactly what changes: the price and one limit, nothing else'
);

create temporary table premium_v2_published on commit drop as
select pg_temp.publish(
  '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
  (select (result->>'id')::uuid from paid_plan),
  (select (plan->'proposal'->>'id')::uuid from premium_v2)
) as plan;

select results_eq(
  $$ select version.version_number, version.status::text, version.deprecated_at is not null,
            version.amount_minor
     from payments.platform_plan_versions as version
     where version.platform_plan_id = (select (result->>'id')::uuid from paid_plan)
     order by version.version_number $$,
  $$ values (1, 'deprecated'::text, true, 3990000::bigint),
            (2, 'published'::text, false, 4490000::bigint) $$,
  'publishing version 2 retires version 1, which still says what its subscribers accepted'
);

select is(
  (select count(*)::integer from payments.platform_plan_versions
   where platform_plan_id = (select (result->>'id')::uuid from paid_plan)
     and status = 'published'),
  1,
  'one version is in force at a time'
);

select is(
  (select limit_value from payments.platform_plan_features
   where platform_plan_version_id = (select (plan->'proposal'->>'id')::uuid from premium_v1)
     and feature_code = 'history_weeks'),
  12,
  'and version 1 keeps its limits'
);

-- ---------------------------------------------------------------------------
-- Withdrawing a proposal
-- ---------------------------------------------------------------------------

create temporary table premium_v3 on commit drop as
select pg_temp.propose(
  '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
  (select (result->>'id')::uuid from paid_plan), 49900000, 'COP', 'year',
  '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
    {"feature_code":"history_weeks","enabled":true,"limit_value":24}]'
) as plan;

select throws_ok(
  format($$ select * from payments.withdraw_platform_plan_version(
    '019b4000-0000-7000-8000-000000000005', '019b4000-0000-7000-8000-000000000025',
    %L, %L, gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  ) $$,
    (select result->>'id' from paid_plan),
    (select plan->'proposal'->>'id' from premium_v3)),
  '42501', null,
  'withdrawing a proposal needs the commercial duty too'
);

create temporary table premium_v3_withdrawn on commit drop as
select result as plan from payments.withdraw_platform_plan_version(
  '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
  (select (result->>'id')::uuid from paid_plan),
  (select (plan->'proposal'->>'id')::uuid from premium_v3),
  gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
);

select results_eq(
  $$ select plan->'proposal', history->>'status', history->>'withdrawn_by_person_id'
     from premium_v3_withdrawn,
          jsonb_array_elements(plan->'history') as history
     where (history->>'version_number')::integer = 3 $$,
  $$ values ('null'::jsonb, 'archived'::text, '019b4000-0000-7000-8000-000000000004'::text) $$,
  'a reviewer who disagrees withdraws the proposal, and the history says who'
);

select throws_ok(
  format($$ select pg_temp.publish(
    '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024', %L, %L
  ) $$,
    (select result->>'id' from paid_plan),
    (select plan->'proposal'->>'id' from premium_v3)),
  '55000', null,
  'a withdrawn proposal is never published'
);

select is(
  (select (pg_temp.propose(
     '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
     (select (result->>'id')::uuid from paid_plan), 49900000, 'COP', 'year',
     '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":null},
       {"feature_code":"history_weeks","enabled":true,"limit_value":24}]'
   )->'proposal'->>'version_number')::integer),
  4,
  'the next proposal takes a new number: a version number is never reused'
);

-- ---------------------------------------------------------------------------
-- The free plan is a plan like any other
-- ---------------------------------------------------------------------------

create temporary table free_v1 on commit drop as
select pg_temp.propose(
  '019b4000-0000-7000-8000-000000000004', '019b4000-0000-7000-8000-000000000024',
  (select (result->>'id')::uuid from free_plan), 0, null, null,
  '[{"feature_code":"meal_logs_per_day","enabled":true,"limit_value":1},
    {"feature_code":"history_weeks","enabled":false,"limit_value":null}]'
) as plan;

select results_eq(
  $$ select plan->>'status', plan->'current_version'->>'amount_minor',
            plan->'current_version'->'billing_period', plan->'current_version'->'currency_code'
     from (select pg_temp.publish(
       '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023',
       (select (result->>'id')::uuid from free_plan),
       (select (plan->'proposal'->>'id')::uuid from free_v1)
     ) as plan) as published $$,
  $$ values ('published'::text, '0'::text, 'null'::jsonb, 'null'::jsonb) $$,
  'the free plan is published the same way, at zero, with its limits as data'
);

select is(
  (select (feature->>'enabled')::boolean
   from jsonb_array_elements(payments.list_platform_plans(
     '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000023'
   )->'plans') as plan_entry,
   jsonb_array_elements(plan_entry->'current_version'->'features') as feature
   where plan_entry->>'code' = 'free' and feature->>'feature_code' = 'history_weeks'),
  false,
  'a function can be left out of the free plan entirely'
);

-- ---------------------------------------------------------------------------
-- Privacy is never for sale
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into payments.platform_features (code, name) values ('access_log_history', 'Registro') $$,
  '23514', null,
  'seeing who read your data is not a function a plan can hold'
);

select throws_ok(
  $$ insert into payments.platform_features (code, name) values ('data_export', 'Exportar') $$,
  '23514', null,
  'nor is taking your data with you, nor deleting it, nor managing who sees it'
);

select ok(
  not exists (
    select 1 from payments.platform_features
    where code ~ '(privacy|consent|grant|permission|access_(log|history|event)|portab|export|erasure|delet|supres|disposition|legal_hold)'
  ),
  'and the catalogue holds none'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('allfit_api', 'payments.platform_plans', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'payments.platform_plan_versions', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'payments.platform_plan_features', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'payments.platform_features', 'SELECT, INSERT, UPDATE, DELETE'),
  'the runtime touches no plan table: the feature catalogue changes only by migration'
);

select ok(
  has_function_privilege('allfit_api', 'payments.list_platform_plans(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'payments.create_platform_plan(uuid,uuid,text,text,text,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'payments.propose_platform_plan_version(uuid,uuid,uuid,bigint,text,text,jsonb,uuid,uuid,bytea)',
    'EXECUTE')
  and has_function_privilege('allfit_api',
    'payments.publish_platform_plan_version(uuid,uuid,uuid,uuid,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'payments.withdraw_platform_plan_version(uuid,uuid,uuid,uuid,uuid,uuid,bytea)', 'EXECUTE'),
  'it runs the read and the four commands'
);

select ok(
  not has_function_privilege('allfit_api',
    'payments.require_platform_commercial_manager(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api',
    'payments.platform_plan_projection(uuid,uuid)', 'EXECUTE'),
  'and nothing behind them'
);

select is(
  (select count(*)::integer from privacy.access_events
   where actor_person_id in (
     '019b4000-0000-7000-8000-000000000003', '019b4000-0000-7000-8000-000000000004'
   )),
  0,
  'a price list is nobody''s data, so managing it records no access'
);

select * from finish();
rollback;
