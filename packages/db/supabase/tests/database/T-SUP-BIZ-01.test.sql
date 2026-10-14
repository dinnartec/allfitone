-- T-SUP-BIZ-01 — NEW-SUP-DASHBOARD: how the business is going (`HU-BO-004`).
--
-- **A number without a period is not shown.** Every metric carries the window it was
-- measured over, because a count means nothing until it says since when.
--
-- **What cannot be computed is empty, never zero.** The rule has not changed; what it
-- applies to has. Payments arrived on 2026-10-12, so subscriptions, billing and Pro are
-- figures now, and the two assertions that proved them `not_modelled` were right about
-- a schema that no longer exists. Zero would still be a claim about the business, and
-- `not_modelled` one about the platform: the two must never be confused.
--
-- **Money is not a count.** It travels in its own array with its currency, is never
-- summed across currencies, and is withheld when too few people paid: with two payers a
-- total is one subtraction away from what each of them pays.
--
-- **A count of people hides a small group.** Below the declared minimum the figure is
-- withheld, so no metric narrows the platform down to somebody. A true zero is still
-- shown, because it singles out nobody.
--
-- The panel needs `view_platform_metrics`, an `A10` duty: the base role reads nothing.

begin;

select plan(40);

create function pg_temp.metric(p_panel jsonb, p_key text) returns integer
language sql immutable as $fn$
  select (entry->>'value')::integer
  from jsonb_array_elements(p_panel->'metrics') as entry
  where entry->>'key' = p_key
$fn$;

create function pg_temp.metric_field(p_panel jsonb, p_key text, p_field text) returns text
language sql immutable as $fn$
  select entry #>> string_to_array(p_field, '.')
  from jsonb_array_elements(p_panel->'metrics') as entry
  where entry->>'key' = p_key
$fn$;

insert into identity.people (id, given_name, family_name, status)
values
  ('019b3000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019b3000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019b3000-0000-7000-8000-000000000003', 'Founder', 'Gamma', 'active'),
  ('019b3000-0000-7000-8000-000000000004', 'Owner', 'Delta', 'active');

-- Enough people to clear the minimum before the first reading, so every count below
-- is a difference this test caused and not whatever the database already held.
insert into identity.people (id, given_name, family_name, status, created_at, activated_at)
select ('019b3000-0000-7000-8000-00000000010' || step)::uuid, 'Baseline', 'Person' || step,
  'active', clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days'
from generate_series(1, 8) as step;

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b3000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha_biz', null),
  ('019b3000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta_biz', null),
  ('019b3000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma_biz',
    '019b3000-0000-7000-8000-000000000003'),
  ('019b3000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta_biz',
    '019b3000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019b3000-0000-7000-8000-000000000001', 'alpha_biz',
  '019b3000-0000-7000-8000-000000000002', 'beta_biz',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-SUP-BIZ-01'
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
  ('019b3000-0000-7000-8000-000000000021'::uuid, '019b3000-0000-7000-8000-000000000011'::uuid,
    'alpha_biz', 'f1'),
  ('019b3000-0000-7000-8000-000000000023'::uuid, '019b3000-0000-7000-8000-000000000013'::uuid,
    'gamma_biz', 'f3')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000021',
  '019b3000-0000-7000-8000-000000000003', 'allfit_admin',
  '019b3000-0000-7000-8000-000000000103', '019b3000-0000-7000-8000-000000000203',
  decode(repeat('71', 32), 'hex')
);

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Who reads the panel
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select support.read_business_panel(
    '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
  ) $$,
  '42501',
  null,
  'the base role alone does not read how the business is going'
);

select support.assign_platform_duty(
  '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000021',
  '019b3000-0000-7000-8000-000000000003', 'view_platform_metrics',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-004',
  '019b3000-0000-7000-8000-000000000113', '019b3000-0000-7000-8000-000000000213',
  decode(repeat('73', 32), 'hex')
);

select is(
  (select actor_mode::text from support.platform_duty_assignments
   where person_id = '019b3000-0000-7000-8000-000000000003'
     and duty_code = 'view_platform_metrics'),
  'A10',
  'reading platform metrics is an A10 duty'
);

select throws_ok(
  $$ select support.read_business_panel(
    '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000021'
  ) $$,
  '42501',
  null,
  'a session that is not the operator''s own reads nothing'
);

create temporary table biz_before on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

-- ---------------------------------------------------------------------------
-- Every figure says of what period it is
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from biz_before, jsonb_array_elements(panel->'metrics') as entry
   where entry->'period'->>'kind' is null or entry->'period'->>'to' is null),
  0::bigint,
  'no figure is published without the period it was measured over'
);

select is(
  (select count(*) from biz_before, jsonb_array_elements(panel->'metrics') as entry
   where entry->>'availability' not in ('available', 'below_threshold', 'not_modelled')),
  0::bigint,
  'a figure is available, below the minimum, or not modelled at all'
);

select is(
  (select (panel->>'minimum_aggregate')::integer from biz_before),
  5,
  'the panel states the smallest group of people it will report'
);

-- ---------------------------------------------------------------------------
-- Money is not a count, and does not travel with them
-- ---------------------------------------------------------------------------

-- An amount needs its currency, and minor units of a peso overflow the integer a count
-- fits in. So it has its own array, and a month with nothing collected is an amount of
-- zero rather than a gap: the condition is known.
select is(
  (select jsonb_typeof(panel->'money') from biz_before),
  'array',
  'what Allfit billed is published apart from the counts'
);

select is(
  (select entry->'period'->>'kind'
   from biz_before, jsonb_array_elements(panel->'money') as entry
   where entry->>'key' = 'billed_this_month'),
  'month',
  'and says of which month it is, like every other figure says of its period'
);

-- ---------------------------------------------------------------------------
-- People: how many registered, how many arrived this week
-- ---------------------------------------------------------------------------

insert into identity.people (id, given_name, family_name, status, created_at, activated_at)
select ('019b3000-0000-7000-8000-00000000030' || step)::uuid, 'Fresh', 'Person' || step, 'active',
  clock_timestamp(), clock_timestamp()
from generate_series(1, 6) as step;

insert into identity.people (id, given_name, family_name, status, created_at, activated_at)
values
  ('019b3000-0000-7000-8000-000000000401', 'Older', 'Person', 'active',
    clock_timestamp() - interval '40 days', clock_timestamp() - interval '40 days'),
  ('019b3000-0000-7000-8000-000000000402', 'Closed', 'Person', 'closed',
    clock_timestamp(), clock_timestamp());

create temporary table biz_people on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

select is(
  (select pg_temp.metric(a.panel, 'registered_people') - pg_temp.metric(b.panel, 'registered_people')
   from biz_people as a, biz_before as b),
  7,
  'seven more people registered, and the one who closed their account is not among them'
);

select is(
  (select pg_temp.metric(a.panel, 'new_people_this_week')
        - pg_temp.metric(b.panel, 'new_people_this_week')
   from biz_people as a, biz_before as b),
  6,
  'only those who arrived inside the window are new this week'
);

select is(
  (select pg_temp.metric_field(panel, 'new_people_this_week', 'period.kind') from biz_people),
  'week',
  'the arrivals figure is a weekly one and says so'
);

select is(
  (select pg_temp.metric_field(panel, 'registered_people', 'period.kind') from biz_people),
  'total',
  'the registered figure is a running total and says so'
);

-- ---------------------------------------------------------------------------
-- Professionals working in Studio: the only activity the platform records
-- ---------------------------------------------------------------------------

select is(
  (select pg_temp.metric_field(panel, 'studio_active_professionals_this_week', 'availability')
   from biz_people),
  'available',
  'nobody working in Studio is a figure the panel can give: a real zero'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, last_activity_at
) values (
  '019b3000-0000-7000-8000-000000000024', '019b3000-0000-7000-8000-000000000014',
  'sid_delta_studio', 'studio', decode(repeat('f4', 32), 'hex'), 'v1.delta',
  clock_timestamp() + interval '5 minutes', clock_timestamp()
);

create temporary table biz_studio on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

select results_eq(
  $$ select entry->>'availability', entry->>'value'
     from biz_studio, jsonb_array_elements(panel->'metrics') as entry
     where entry->>'key' = 'studio_active_professionals_this_week' $$,
  $$ values ('below_threshold'::text, null::text) $$,
  'a group of people smaller than the minimum is withheld instead of counted out loud'
);

-- ---------------------------------------------------------------------------
-- People training: who was active this week
-- ---------------------------------------------------------------------------

-- Six of the fresh people trained inside the window, one of them twice. The person
-- who arrived forty days ago trained then, and the one who closed their account
-- trained today: neither is an active person this week.
insert into execution.executed_sessions (
  id, person_id, activity_type_id, result_contract_id, contract_version,
  started_at, timezone, requested_level, capture_source
)
select
  ('019b3000-0000-7000-8000-00000000060' || step)::uuid,
  ('019b3000-0000-7000-8000-00000000030' || step)::uuid,
  '019c0000-0000-7000-8000-000000000011', '019c0000-0000-7000-8000-000000000031', 1,
  clock_timestamp() - interval '1 day', 'America/Bogota', 'summary', 'manual'
from generate_series(1, 6) as step;

insert into execution.executed_sessions (
  id, person_id, activity_type_id, result_contract_id, contract_version,
  started_at, timezone, requested_level, capture_source
) values
  ('019b3000-0000-7000-8000-000000000611', '019b3000-0000-7000-8000-000000000301',
    '019c0000-0000-7000-8000-000000000011', '019c0000-0000-7000-8000-000000000031', 1,
    clock_timestamp() - interval '3 days', 'America/Bogota', 'summary', 'manual'),
  ('019b3000-0000-7000-8000-000000000612', '019b3000-0000-7000-8000-000000000401',
    '019c0000-0000-7000-8000-000000000011', '019c0000-0000-7000-8000-000000000031', 1,
    clock_timestamp() - interval '40 days', 'America/Bogota', 'summary', 'manual'),
  ('019b3000-0000-7000-8000-000000000613', '019b3000-0000-7000-8000-000000000402',
    '019c0000-0000-7000-8000-000000000011', '019c0000-0000-7000-8000-000000000031', 1,
    clock_timestamp() - interval '1 day', 'America/Bogota', 'summary', 'manual');

create temporary table biz_training on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

select is(
  (select pg_temp.metric(panel, 'active_people_this_week') from biz_training),
  6,
  'a person who trained this week was active, counted once however often they trained'
);

select is(
  (select pg_temp.metric_field(panel, 'active_people_this_week', 'period.kind')
   from biz_training),
  'week',
  'and the figure says it is a weekly one'
);

-- Somebody without the duty reads no figure at all, so this cannot become a way to
-- learn who trains by watching the count move.
select throws_ok(
  $$ select support.read_business_panel(
       '019b3000-0000-7000-8000-000000000004', '019b3000-0000-7000-8000-000000000024'
     ) $$,
  '42501', null,
  'and the training figure is behind the same duty as every other one'
);

-- The floor the panel counts on. The panel refuses an operator without the duty
-- before the policy is consulted, so the policy is asked on its own.

select ok(
  access_control.counts_platform_metrics(),
  'the duty is what lets the count see the training at all'
);

select ok(
  not (
    select access_control.counts_platform_metrics()
    from (select set_config('app.actor_person_id',
      '019b3000-0000-7000-8000-000000000001', true)) as other_actor
  ),
  'and an administrator with other duties and not this one sees no row to count'
);

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Gyms: how many exist, and how many actually operate
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000004', true);

select * from organizations.create_organization(
  '019b3000-0000-7000-8000-000000000004', 'Negocio Norte', 'gym', 'natural_person', null,
  'b0000000-0000-4000-8000-000000000001', '019b3000-0000-7000-8000-000000000501',
  decode(repeat('81', 32), 'hex')
);

insert into organizations.organizations (
  id, type_code, display_name, status, claimed_at, cancelled_at, responsible_party
) values
  ('019b3000-0000-7000-8000-000000000601', 'gym', 'Negocio Sin Reclamar', 'unclaimed',
    null, null,
    '{"party_kind":"legal_entity","party_name":"Sin Reclamar SAS","purpose":"studio_operations"}'),
  ('019b3000-0000-7000-8000-000000000602', 'gym', 'Negocio Cancelado', 'cancelled',
    null, clock_timestamp(),
    '{"party_kind":"legal_entity","party_name":"Cancelado SAS","purpose":"studio_operations"}'),
  ('019b3000-0000-7000-8000-000000000603', 'gym', 'Negocio Vacio', 'active',
    clock_timestamp(), null,
    '{"party_kind":"legal_entity","party_name":"Vacio SAS","purpose":"studio_operations"}');

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000003', true);

create temporary table biz_gyms on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

select is(
  (select pg_temp.metric(a.panel, 'organizations') - pg_temp.metric(b.panel, 'organizations')
   from biz_gyms as a, biz_studio as b),
  4,
  'every gym counts in the total, whatever state it is in'
);

select is(
  (select pg_temp.metric(a.panel, 'operating_organizations')
        - pg_temp.metric(b.panel, 'operating_organizations')
   from biz_gyms as a, biz_studio as b),
  1,
  'only the one somebody actually runs counts as operating, not the one left empty'
);

select is(
  (select pg_temp.metric(a.panel, 'unclaimed_organizations')
        - pg_temp.metric(b.panel, 'unclaimed_organizations')
   from biz_gyms as a, biz_studio as b),
  1,
  'the one nobody claimed is counted apart: it exists, but it does not operate'
);

select is(
  (select pg_temp.metric_field(panel, 'operating_organizations', 'period.kind') from biz_gyms),
  'total',
  'the operating figure is a total at the moment it was read'
);

-- ---------------------------------------------------------------------------
-- A figure leads nowhere
-- ---------------------------------------------------------------------------

select ok(
  (select position('019b3000-0000-7000-8000' in panel::text) = 0
     and position('Negocio' in panel::text) = 0
     and position('Baseline' in panel::text) = 0
     and position('@' in panel::text) = 0
   from biz_gyms),
  'no identifier, no name and no contact travels in the panel: counts only'
);

select is(
  (select count(*) from privacy.access_events as event
   where event.actor_person_id = '019b3000-0000-7000-8000-000000000003'),
  0::bigint,
  'counting nobody in particular reaches nobody, so no access is recorded'
);

-- ---------------------------------------------------------------------------
-- A figure and its availability never disagree
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from biz_gyms, jsonb_array_elements(panel->'metrics') as entry
   where entry->>'availability' = 'available' and entry->'value' = 'null'::jsonb),
  0::bigint,
  'an available figure always carries its number'
);

select is(
  (select count(*) from biz_gyms, jsonb_array_elements(panel->'metrics') as entry
   where entry->>'availability' <> 'available' and entry->'value' <> 'null'::jsonb),
  0::bigint,
  'and one that is not available never carries one'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('allfit_api', 'support.read_business_panel(uuid,uuid)', 'EXECUTE')
  and not has_table_privilege('allfit_api', 'organizations.organizations', 'SELECT')
  and not has_table_privilege('allfit_api', 'organizations.organization_memberships', 'SELECT')
  and not has_table_privilege('allfit_api', 'identity.access_sessions', 'SELECT'),
  'the runtime reads the panel, never the tables the figures come from'
);

select ok(
  not has_function_privilege(
    'allfit_api', 'support.require_platform_metrics_reader(uuid,uuid)', 'EXECUTE'
  ),
  'the duty check behind it stays private'
);

-- ---------------------------------------------------------------------------
-- Pro, what it billed, and what the gyms bill their own clients
-- ---------------------------------------------------------------------------

-- A plan of Allfit in the state the catalogue leaves it in. Inserted rather than
-- commanded: `HU-BO-025` owns that command and proves it, and what this panel needs is
-- the state, not the ceremony.
insert into payments.platform_plans (
  id, code, name, plan_kind, status, created_by_person_id, created_by_duty_assignment_id
)
select '019b3000-0000-7000-8000-000000001001', 'pro', 'Pro', 'paid', 'published',
  '019b3000-0000-7000-8000-000000000001', duty.id
from support.platform_duty_assignments as duty
where duty.person_id = '019b3000-0000-7000-8000-000000000003'
  and duty.duty_code = 'view_platform_metrics';

insert into payments.platform_plan_versions (
  id, platform_plan_id, plan_kind, version_number, amount_minor, currency_code,
  billing_period, status, proposed_by_person_id, proposed_by_duty_assignment_id,
  published_by_person_id, published_by_duty_assignment_id, published_at
)
select '019b3000-0000-7000-8000-000000001002', '019b3000-0000-7000-8000-000000001001',
  'paid', 1, 1990000, 'COP', 'month', 'published',
  '019b3000-0000-7000-8000-000000000001', duty.id,
  '019b3000-0000-7000-8000-000000000002', duty.id, clock_timestamp()
from support.platform_duty_assignments as duty
where duty.person_id = '019b3000-0000-7000-8000-000000000003'
  and duty.duty_code = 'view_platform_metrics';

insert into payments.platform_store_products (store, product_id, platform_plan_version_id)
values ('app_store', 'allfit.pro.monthly.biz', '019b3000-0000-7000-8000-000000001002');

-- Six people paying Allfit through a store, which clears the minimum on that route
-- alone so the figure is a figure and not a withholding.
insert into identity.people (id, given_name, family_name, status)
select ('019b3000-0000-7000-8000-00000000101' || step)::uuid, 'Payer', 'Person' || step, 'active'
from generate_series(1, 6) as step;

insert into payments.platform_subscriptions (
  id, person_id, platform_plan_version_id, store, store_product_id, store_subscription_ref,
  environment, status, auto_renews, current_period_end, last_observed_at
)
select ('019b3000-0000-7000-8000-00000000102' || step)::uuid,
  ('019b3000-0000-7000-8000-00000000101' || step)::uuid,
  '019b3000-0000-7000-8000-000000001002', 'app_store', 'allfit.pro.monthly.biz',
  'ref-biz-' || step, 'production', 'active', true,
  clock_timestamp() + interval '20 days', clock_timestamp()
from generate_series(1, 6) as step;

-- What the stores reported as collected this month, in two currencies, because a store
-- charges each person in theirs. They are never added together.
insert into payments.platform_payment_records (
  platform_subscription_id, person_id, store, store_transaction_id, amount_minor,
  currency_code, result, occurred_at
)
select ('019b3000-0000-7000-8000-00000000102' || step)::uuid,
  ('019b3000-0000-7000-8000-00000000101' || step)::uuid,
  'app_store', 'txn-biz-' || step,
  case when step <= 4 then 1990000 else 599 end,
  case when step <= 4 then 'COP' else 'USD' end,
  'succeeded', date_trunc('month', clock_timestamp()) + interval '1 hour'
from generate_series(1, 6) as step;

-- A charge the store could not collect. It is not billing and is not added to it.
insert into payments.platform_payment_records (
  platform_subscription_id, person_id, store, store_transaction_id, amount_minor,
  currency_code, result, failure_code, occurred_at
)
values ('019b3000-0000-7000-8000-000000001021', '019b3000-0000-7000-8000-000000001011',
  'app_store', 'txn-biz-failed', 9900000, 'COP', 'failed', 'billing_retry',
  clock_timestamp() - interval '2 hours');

-- A gym with six clients, five of whom pay it a plan. Training there is what gives them
-- Pro; the plan is what they pay the gym. Two different bonds, counted apart.
insert into organizations.organizations (id, type_code, display_name, responsible_party, status)
values ('019b3000-0000-7000-8000-000000001031', 'gym', 'Gimnasio Panel',
  '{"party_kind":"legal_entity","party_name":"Panel SAS","purpose":"studio_operations"}',
  'active');

insert into identity.people (id, given_name, family_name, status)
select ('019b3000-0000-7000-8000-00000000104' || step)::uuid, 'Client', 'Person' || step, 'active'
from generate_series(1, 6) as step;

insert into relationships.service_relationships (id, person_id, organization_id, status)
select ('019b3000-0000-7000-8000-00000000105' || step)::uuid,
  ('019b3000-0000-7000-8000-00000000104' || step)::uuid,
  '019b3000-0000-7000-8000-000000001031', 'active'
from generate_series(1, 6) as step;

insert into payments.organization_plans (id, organization_id, name, status)
values ('019b3000-0000-7000-8000-000000001061', '019b3000-0000-7000-8000-000000001031',
  'Mensual', 'published');

insert into payments.plan_versions (
  id, plan_id, organization_id, version_number, amount_minor, currency_code,
  billing_period, status, published_at
)
values ('019b3000-0000-7000-8000-000000001062', '019b3000-0000-7000-8000-000000001061',
  '019b3000-0000-7000-8000-000000001031', 1, 12000000, 'COP', 'month', 'published',
  clock_timestamp());

insert into payments.plan_subscriptions (
  id, person_id, organization_id, plan_version_id, status, current_period_end
)
select ('019b3000-0000-7000-8000-00000000107' || step)::uuid,
  ('019b3000-0000-7000-8000-00000000104' || step)::uuid,
  '019b3000-0000-7000-8000-000000001031', '019b3000-0000-7000-8000-000000001062',
  'active', (clock_timestamp() + interval '30 days')::date
from generate_series(1, 5) as step;

create temporary table biz_money on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

-- `allfit_owner` does not bypass row-level security. Without a policy for this reader
-- every difference below would be zero and the panel would publish a figure it never
-- counted, which is worse than the gap it replaced.
select is(
  (select pg_temp.metric(a.panel, 'pro_people_paying_allfit')
        - pg_temp.metric(b.panel, 'pro_people_paying_allfit')
   from biz_money as a, biz_gyms as b),
  6,
  'six people pay Allfit for Pro'
);

select is(
  (select pg_temp.metric(a.panel, 'pro_people_through_organization')
        - pg_temp.metric(b.panel, 'pro_people_through_organization')
   from biz_money as a, biz_gyms as b),
  6,
  'and six more have it by training at a gym that operates'
);

select is(
  (select pg_temp.metric(a.panel, 'premium_people') - pg_temp.metric(b.panel, 'premium_people')
   from biz_money as a, biz_gyms as b),
  12,
  'twelve people have Pro in all, each counted on one route and never on two'
);

select is(
  (select pg_temp.metric(a.panel, 'active_organization_subscriptions')
        - pg_temp.metric(b.panel, 'active_organization_subscriptions')
   from biz_money as a, biz_gyms as b),
  5,
  'five of that gym''s clients pay it a plan, which is not income of Allfit'
);

-- The restatement pinned to its authority. `payments.resolve_pro` decides the route for
-- one person; the panel restates the same two conditions in set form. If either drifts,
-- these two stop agreeing.
select set_config('app.actor_kind', 'person', true);

select is(
  (select count(*)::integer
   from generate_series(1, 6) as step
   where (payments.resolve_pro(
     ('019b3000-0000-7000-8000-00000000101' || step)::uuid
   )->>'effective_source') = 'subscription'),
  6,
  'and `resolve_pro` says the store subscription is the route for each of those six'
);

select is(
  (select count(*)::integer
   from generate_series(1, 6) as step
   where (payments.resolve_pro(
     ('019b3000-0000-7000-8000-00000000104' || step)::uuid
   )->>'effective_source') = 'organization'),
  6,
  'and the gym is the route for the other six, which is how the panel counted them'
);

select set_config('app.actor_kind', 'support', true);

-- Billing, per currency, with the failed charge in neither.
select results_eq(
  $$ select amount->>'currency_code', (amount->>'amount_minor')::bigint
     from biz_money, jsonb_array_elements(panel->'money') as entry,
          jsonb_array_elements(entry->'amounts') as amount
     where entry->>'key' = 'billed_this_month'
     order by 1 $$,
  $$ values ('COP'::text, 7960000::bigint), ('USD'::text, 1198::bigint) $$,
  'what Allfit billed this month is listed per currency and never added across them'
);

-- The rule itself, on the builder: an amount behind fewer payers than the declared
-- minimum is withheld, because with two payers a total is one subtraction away from
-- what each of them pays.
select is(
  support.business_money_metric(
    'billed_this_month', '[{"currency_code":"COP","amount_minor":500}]'::jsonb, 2,
    'month', clock_timestamp(), clock_timestamp(), 5
  )->>'availability',
  'below_threshold',
  'an amount behind too few payers is withheld, exactly like a count of people'
);

select is(
  support.business_money_metric(
    'billed_this_month', '[{"currency_code":"COP","amount_minor":500}]'::jsonb, 2,
    'month', clock_timestamp(), clock_timestamp(), 5
  )->'amounts',
  'null'::jsonb,
  'and it is withheld by carrying no amount, never by showing zero'
);

-- Who may read the rows the gym figures are counted from. The policy is what answers
-- this, not the function: written `using (true)` the second assertion fails, which is
-- the only reason it is worth having.
set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000001041', true),
       set_config('app.actor_org_id', '', true);

select is(
  (select count(*)::integer from payments.plan_subscriptions
    where organization_id = '019b3000-0000-7000-8000-000000001031'),
  1,
  'a person reads the subscription that is hers and not the four beside it'
);

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000004', true);

select is_empty(
  $$ select 1 from payments.plan_subscriptions
      where organization_id = '019b3000-0000-7000-8000-000000001031' $$,
  'and somebody of Allfit holding no duty at all reads none of them'
);

reset role;

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000003', true);

select * from finish();
rollback;
