-- T-PAY-PRO-01 — ADR-043, OP-PAY-018..021 and OP-PAY-023: what a person's Pro is, where
-- it comes from, and how a store purchase and its notifications move it (`HU-SP-084..088`).
--
-- **Pro is resolved on read, never stored as a flag.** A live subscription of one's own
-- gives its frozen version; otherwise an active relationship with an active gym gives the
-- version of `pro` in force; otherwise the free plan in force. Any doubt resolves to free.
--
-- **The store charges, the API verifies, the database records.** A purchase arrives already
-- verified; it belongs to one person only, repeats do nothing, and a notification that
-- repeats or arrives late changes nothing.

begin;

select plan(49);

-- ---------------------------------------------------------------------------
-- Fixture: two commercial managers publish the free plan and Pro
-- ---------------------------------------------------------------------------

insert into identity.people (id, given_name, family_name, status)
values
  ('019b5000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019b5000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019b5000-0000-7000-8000-000000000003', 'Commerce', 'Gamma', 'active'),
  ('019b5000-0000-7000-8000-000000000004', 'Commerce', 'Delta', 'active'),
  ('019b5000-0000-7000-8000-000000000031', 'Ana', 'Paga', 'active'),
  ('019b5000-0000-7000-8000-000000000032', 'Bruno', 'Gimnasio', 'active'),
  ('019b5000-0000-7000-8000-000000000033', 'Carla', 'Gratis', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b5000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha_pro', null),
  ('019b5000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta_pro', null),
  ('019b5000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma_pro',
    '019b5000-0000-7000-8000-000000000003'),
  ('019b5000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta_pro',
    '019b5000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019b5000-0000-7000-8000-000000000001', 'alpha_pro',
  '019b5000-0000-7000-8000-000000000002', 'beta_pro',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-PAY-PRO-01'
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
  ('019b5000-0000-7000-8000-000000000021'::uuid, '019b5000-0000-7000-8000-000000000011'::uuid,
    'alpha_pro', 'f1'),
  ('019b5000-0000-7000-8000-000000000023'::uuid, '019b5000-0000-7000-8000-000000000013'::uuid,
    'gamma_pro', 'f3'),
  ('019b5000-0000-7000-8000-000000000024'::uuid, '019b5000-0000-7000-8000-000000000014'::uuid,
    'delta_pro', 'f4')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b5000-0000-7000-8000-000000000001', '019b5000-0000-7000-8000-000000000021',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b5000-0000-7000-8000-000000000003'::uuid, '019b5000-0000-7000-8000-000000000103'::uuid,
    '019b5000-0000-7000-8000-000000000203'::uuid, '83'),
  ('019b5000-0000-7000-8000-000000000004'::uuid, '019b5000-0000-7000-8000-000000000104'::uuid,
    '019b5000-0000-7000-8000-000000000204'::uuid, '84')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019b5000-0000-7000-8000-000000000001', '019b5000-0000-7000-8000-000000000021',
  person_id, 'manage_platform_commercial', clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-043', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b5000-0000-7000-8000-000000000003'::uuid,
    '019b5000-0000-7000-8000-000000000113'::uuid, '019b5000-0000-7000-8000-000000000213'::uuid, '93'),
  ('019b5000-0000-7000-8000-000000000004'::uuid,
    '019b5000-0000-7000-8000-000000000114'::uuid, '019b5000-0000-7000-8000-000000000214'::uuid, '94')
) as duty_row(person_id, key, command, hash_byte);

-- The catalogue ships empty until product decides it; this feature exists only here.
insert into payments.platform_features (code, name, unit)
values ('meal_logs_per_day', 'Comidas registradas por día', 'items');

select set_config('app.actor_kind', 'support', true);

create function pg_temp.publish_version(
  p_plan uuid, p_amount bigint, p_currency text, p_period text, p_limit integer
)
returns uuid
language plpgsql
as $fn$
declare
  version uuid;
begin
  perform set_config('app.actor_person_id', '019b5000-0000-7000-8000-000000000003', true);
  select (result->'proposal'->>'id')::uuid into version
  from payments.propose_platform_plan_version(
    '019b5000-0000-7000-8000-000000000003', '019b5000-0000-7000-8000-000000000023',
    p_plan, p_amount, p_currency, p_period,
    jsonb_build_array(jsonb_build_object(
      'feature_code', 'meal_logs_per_day', 'enabled', true, 'limit_value', p_limit
    )),
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  );
  perform set_config('app.actor_person_id', '019b5000-0000-7000-8000-000000000004', true);
  perform payments.publish_platform_plan_version(
    '019b5000-0000-7000-8000-000000000004', '019b5000-0000-7000-8000-000000000024',
    p_plan, version,
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  );
  return version;
end
$fn$;

create temporary table plan_ids as
select
  (select (result->>'id')::uuid from payments.create_platform_plan(
    '019b5000-0000-7000-8000-000000000003', '019b5000-0000-7000-8000-000000000023',
    'free', 'Gratis', 'free',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  )) as free_plan,
  (select (result->>'id')::uuid from payments.create_platform_plan(
    '019b5000-0000-7000-8000-000000000003', '019b5000-0000-7000-8000-000000000023',
    'pro', 'Pro', 'paid',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  )) as pro_plan;

create temporary table versions as
select
  pg_temp.publish_version(free_plan, 0, null, null, 2) as free_v1,
  pg_temp.publish_version(pro_plan, 19900, 'COP', 'month', null) as pro_v1
from plan_ids;

insert into payments.platform_store_products (store, product_id, platform_plan_version_id)
select 'app_store'::payments.platform_store, 'allfit.pro.monthly.v1', pro_v1 from versions
union all
select 'google_play', 'allfit.pro.monthly.v1', pro_v1 from versions;

insert into organizations.organizations (id, type_code, display_name, responsible_party, claimed_at)
values ('019b5000-0000-7000-8000-000000000301', 'gym', 'Bodytech',
  '{"party_kind":"legal_entity","party_name":"Bodytech SAS","purpose":"studio_operations"}',
  clock_timestamp());
insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019b5000-0000-7000-8000-000000000401', '019b5000-0000-7000-8000-000000000032',
    '019b5000-0000-7000-8000-000000000301', 'active'),
  ('019b5000-0000-7000-8000-000000000402', '019b5000-0000-7000-8000-000000000031',
    '019b5000-0000-7000-8000-000000000301', 'active');

-- A purchase as the API hands it over once the store verified it.
create function pg_temp.purchase(
  p_store text, p_ref text, p_transaction text, p_account text,
  p_product text default 'allfit.pro.monthly.v1'
)
returns jsonb
language sql
as $fn$
  select jsonb_build_object(
    'store', p_store,
    'environment', 'sandbox',
    'product_id', p_product,
    'subscription_ref', p_ref,
    'transaction_id', p_transaction,
    'account_token', p_account,
    'status', 'active',
    'auto_renews', true,
    'current_period_end', clock_timestamp() + interval '30 days',
    'grace_until', null,
    'observed_at', clock_timestamp(),
    'amount_minor', 19900,
    'currency_code', 'COP'
  )
$fn$;

create function pg_temp.as_person(p_person uuid)
returns void
language sql
as $fn$
  select set_config('app.actor_kind', 'person', true),
         set_config('app.actor_person_id', p_person::text, true)
$fn$;

-- ---------------------------------------------------------------------------
-- What each plan offers (OP-PAY-018)
-- ---------------------------------------------------------------------------

select pg_temp.as_person('019b5000-0000-7000-8000-000000000033');

select is(
  (select jsonb_agg(entry->>'code') from jsonb_array_elements(
    payments.list_pro_plans('019b5000-0000-7000-8000-000000000033')->'plans') as entry),
  '["free", "pro"]'::jsonb,
  'a person sees the free plan first, then Pro'
);

select is(
  (select entry->'store_products' from jsonb_array_elements(
    payments.list_pro_plans('019b5000-0000-7000-8000-000000000033')->'plans') as entry
   where entry->>'code' = 'pro'),
  '[{"store": "app_store", "product_id": "allfit.pro.monthly.v1"},
    {"store": "google_play", "product_id": "allfit.pro.monthly.v1"}]'::jsonb,
  'Pro is sold by the store products of its version in force'
);

select is(
  (select entry->'features' from jsonb_array_elements(
    payments.list_pro_plans('019b5000-0000-7000-8000-000000000033')->'plans') as entry
   where entry->>'code' = 'free'),
  '[{"code": "meal_logs_per_day", "name": "Comidas registradas por día", "unit": "items",
     "enabled": true, "limit_value": 2}]'::jsonb,
  'and each plan says exactly what it includes, with its limit'
);

select throws_ok(
  $$ select payments.list_pro_plans('019b5000-0000-7000-8000-000000000031') $$,
  '42501', null,
  'one person does not read the plans in another person''s name'
);

-- ---------------------------------------------------------------------------
-- Resolving Pro (OP-PAY-020)
-- ---------------------------------------------------------------------------

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000033')->'plan'->>'code',
  'free',
  'without a subscription or a gym, a person has the free plan'
);

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000033')->>'effective_source',
  'free',
  'and it says so'
);

select pg_temp.as_person('019b5000-0000-7000-8000-000000000032');

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000032')->'plan'->>'code',
  'pro',
  'an active relationship with an active gym gives Pro'
);

select is(
  (payments.read_my_pro('019b5000-0000-7000-8000-000000000032')->'sources'),
  '[{"kind": "organization", "organization_id": "019b5000-0000-7000-8000-000000000301",
     "organization_name": "Bodytech"}]'::jsonb,
  'and names the gym it comes from'
);

select is(
  (payments.read_my_pro('019b5000-0000-7000-8000-000000000032')->'plan'->>'version_id')::uuid,
  (select pro_v1 from versions),
  'the gym gives the version of Pro in force'
);

select is(
  (select entry->'limit_value' from jsonb_array_elements(
    payments.read_my_pro('019b5000-0000-7000-8000-000000000032')->'features') as entry),
  'null'::jsonb,
  'with that version''s limits'
);

select throws_ok(
  $$ select payments.read_my_pro('019b5000-0000-7000-8000-000000000031') $$,
  '42501', null,
  'nobody reads another person''s Pro'
);

-- ---------------------------------------------------------------------------
-- Recording a verified purchase (OP-PAY-019)
-- ---------------------------------------------------------------------------

select pg_temp.as_person('019b5000-0000-7000-8000-000000000031');

select throws_ok(
  $$ select * from payments.record_store_subscription(
    '019b5000-0000-7000-8000-000000000031',
    pg_temp.purchase('app_store', '2000000000000001', '2000000000000001',
      '019b5000-0000-7000-8000-000000000032'),
    'b1000000-0000-4000-8000-000000000001', '019b5000-0000-7000-8000-000000000501',
    decode(repeat('b1', 32), 'hex')
  ) $$,
  '42501', null,
  'a purchase made for another account is not this person''s'
);

select throws_ok(
  $$ select * from payments.record_store_subscription(
    '019b5000-0000-7000-8000-000000000031',
    pg_temp.purchase('app_store', '2000000000000001', '2000000000000001',
      '019b5000-0000-7000-8000-000000000031', 'allfit.unknown'),
    'b1000000-0000-4000-8000-000000000002', '019b5000-0000-7000-8000-000000000502',
    decode(repeat('b2', 32), 'hex')
  ) $$,
  '22023', null,
  'a product Allfit does not sell gives nothing'
);

select is(
  (select result->'plan'->>'code' from payments.record_store_subscription(
    '019b5000-0000-7000-8000-000000000031',
    pg_temp.purchase('app_store', '2000000000000001', '2000000000000001',
      '019b5000-0000-7000-8000-000000000031'),
    'b1000000-0000-4000-8000-000000000003', '019b5000-0000-7000-8000-000000000503',
    decode(repeat('b3', 32), 'hex')
  )),
  'pro',
  'a verified purchase gives Pro'
);

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000031')->>'effective_source',
  'subscription',
  'and the limits come from what the person pays'
);

select is(
  (select jsonb_agg(entry->>'kind' order by entry->>'kind') from jsonb_array_elements(
    payments.read_my_pro('019b5000-0000-7000-8000-000000000031')->'sources') as entry),
  '["organization", "subscription"]'::jsonb,
  'while the gym is still listed, so the person knows they do not depend on it'
);

select results_eq(
  $$ select (result->'plan'->>'code'), replayed from payments.record_store_subscription(
       '019b5000-0000-7000-8000-000000000031',
       pg_temp.purchase('app_store', '2000000000000001', '2000000000000001',
         '019b5000-0000-7000-8000-000000000031'),
       'b1000000-0000-4000-8000-000000000003', '019b5000-0000-7000-8000-000000000503',
       decode(repeat('b3', 32), 'hex')
     ) $$,
  $$ values ('pro'::text, true) $$,
  'retrying the same command replays it'
);

select is(
  (select count(*)::integer from payments.platform_subscriptions
   where person_id = '019b5000-0000-7000-8000-000000000031'),
  1,
  'and leaves one subscription'
);

select is(
  (select count(*)::integer from payments.platform_payment_records
   where person_id = '019b5000-0000-7000-8000-000000000031'),
  1,
  'with its one charge'
);

select lives_ok(
  $$ select * from payments.record_store_subscription(
    '019b5000-0000-7000-8000-000000000031',
    pg_temp.purchase('app_store', '2000000000000001', '2000000000000001',
      '019b5000-0000-7000-8000-000000000031'),
    'b1000000-0000-4000-8000-000000000004', '019b5000-0000-7000-8000-000000000504',
    decode(repeat('b4', 32), 'hex')
  ) $$,
  'presenting the same purchase again, as a restore does, is accepted'
);

select is(
  (select count(*)::integer from payments.platform_subscriptions
   where person_id = '019b5000-0000-7000-8000-000000000031'),
  1,
  'without a second subscription'
);

select pg_temp.as_person('019b5000-0000-7000-8000-000000000033');

select throws_ok(
  $$ select * from payments.record_store_subscription(
    '019b5000-0000-7000-8000-000000000033',
    pg_temp.purchase('app_store', '2000000000000001', '2000000000000002',
      '019b5000-0000-7000-8000-000000000033'),
    'b1000000-0000-4000-8000-000000000005', '019b5000-0000-7000-8000-000000000505',
    decode(repeat('b5', 32), 'hex')
  ) $$,
  '23505', null,
  'a store subscription that belongs to one person cannot be claimed by another'
);

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000033')->'plan'->>'code',
  'free',
  'who tried keeps the free plan'
);

-- ---------------------------------------------------------------------------
-- A price is frozen with the version (HU-SP-085, HU-SP-086)
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true);

create temporary table later as
select pg_temp.publish_version(pro_plan, 24900, 'COP', 'month', 30) as pro_v2 from plan_ids;

insert into payments.platform_store_products (store, product_id, platform_plan_version_id)
select 'app_store', 'allfit.pro.monthly.v2', pro_v2 from later;

select pg_temp.as_person('019b5000-0000-7000-8000-000000000031');

select is(
  (payments.read_my_pro('019b5000-0000-7000-8000-000000000031')->'plan'->>'version_id')::uuid,
  (select pro_v1 from versions),
  'whoever pays keeps the version they accepted after another is published'
);

select pg_temp.as_person('019b5000-0000-7000-8000-000000000032');

select is(
  (payments.read_my_pro('019b5000-0000-7000-8000-000000000032')->'plan'->>'version_id')::uuid,
  (select pro_v2 from later),
  'whoever has Pro through a gym follows the version in force'
);

select throws_ok(
  $$ update payments.platform_subscriptions
     set platform_plan_version_id = (select pro_v2 from later) $$,
  '55000', null,
  'a subscription never changes its version'
);

select throws_ok(
  $$ insert into payments.platform_store_products (store, product_id, platform_plan_version_id)
     select 'app_store', 'allfit.free', free_v1 from versions $$,
  '22023', null,
  'the free plan is not sold in a store'
);

-- ---------------------------------------------------------------------------
-- Store notifications (OP-PAY-023)
-- ---------------------------------------------------------------------------

select pg_temp.as_person('019b5000-0000-7000-8000-000000000031');

select throws_ok(
  $$ select payments.apply_store_notification('app_store', 'n-1', decode(repeat('c1', 32), 'hex'),
       '{"subscription_ref": "2000000000000001"}'::jsonb) $$,
  '42501', null,
  'a person does not report what the store says'
);

select set_config('app.actor_kind', 'worker', true), set_config('app.actor_person_id', '', true);

select is(
  payments.apply_store_notification('app_store', 'n-0', decode(repeat('c0', 32), 'hex'),
    jsonb_build_object('subscription_ref', '9999999999999999', 'status', 'active',
      'observed_at', clock_timestamp())),
  'ignored',
  'a notification for a subscription nobody recorded is kept and ignored'
);

select is(
  payments.apply_store_notification('app_store', 'n-1', decode(repeat('c1', 32), 'hex'),
    jsonb_build_object(
      'subscription_ref', '2000000000000001', 'product_id', 'allfit.pro.monthly.v1',
      'status', 'suspended', 'auto_renews', true,
      'current_period_end', clock_timestamp() - interval '1 day',
      'observed_at', clock_timestamp() + interval '1 second')),
  'processed',
  'a failed renewal is recorded'
);

select is(
  payments.apply_store_notification('app_store', 'n-1', decode(repeat('c1', 32), 'hex'),
    '{}'::jsonb),
  'replayed',
  'the same notification twice changes nothing'
);

select throws_ok(
  $$ select payments.apply_store_notification('app_store', 'n-1', decode(repeat('c9', 32), 'hex'),
       '{}'::jsonb) $$,
  '23505', null,
  'and one notification id never carries two contents'
);

select pg_temp.as_person('019b5000-0000-7000-8000-000000000031');

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000031')->>'effective_source',
  'organization',
  'a suspended subscription gives nothing, and the gym still does'
);

select set_config('app.actor_kind', 'worker', true), set_config('app.actor_person_id', '', true);

select is(
  payments.apply_store_notification('app_store', 'n-2', decode(repeat('c2', 32), 'hex'),
    jsonb_build_object(
      'subscription_ref', '2000000000000001', 'product_id', 'allfit.pro.monthly.v1',
      'status', 'active', 'auto_renews', true,
      'current_period_end', clock_timestamp() - interval '2 days',
      'observed_at', clock_timestamp() - interval '1 hour')),
  'stale',
  'an older notification that arrives late changes nothing'
);

select is(
  payments.apply_store_notification('app_store', 'n-3', decode(repeat('c3', 32), 'hex'),
    jsonb_build_object(
      'subscription_ref', '2000000000000001', 'product_id', 'allfit.pro.monthly.v1',
      'status', 'grace', 'auto_renews', true,
      'current_period_end', clock_timestamp() - interval '1 day',
      'grace_until', clock_timestamp() + interval '6 days',
      'observed_at', clock_timestamp() + interval '2 seconds')),
  'processed',
  'a grace period is recorded'
);

select pg_temp.as_person('019b5000-0000-7000-8000-000000000031');

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000031')->>'effective_source',
  'subscription',
  'and keeps Pro while it lasts'
);

select set_config('app.actor_kind', 'worker', true), set_config('app.actor_person_id', '', true);

select is(
  payments.apply_store_notification('app_store', 'n-4', decode(repeat('c4', 32), 'hex'),
    jsonb_build_object(
      'subscription_ref', '2000000000000001', 'product_id', 'allfit.pro.monthly.v1',
      'status', 'active', 'auto_renews', false,
      'current_period_end', clock_timestamp() + interval '29 days',
      'transaction_id', '2000000000000009', 'amount_minor', 19900, 'currency_code', 'COP',
      'observed_at', clock_timestamp() + interval '3 seconds')),
  'processed',
  'a renewal that the person then cancels is recorded'
);

select is(
  (select count(*)::integer from payments.platform_payment_records
   where person_id = '019b5000-0000-7000-8000-000000000031'),
  2,
  'with the renewal charged once'
);

select pg_temp.as_person('019b5000-0000-7000-8000-000000000031');

select is(
  (select entry->'auto_renews' from jsonb_array_elements(
    payments.read_my_pro('019b5000-0000-7000-8000-000000000031')->'sources') as entry
   where entry->>'kind' = 'subscription'),
  'false'::jsonb,
  'cancelling keeps Pro until the paid period ends, and says it will not renew'
);

select set_config('app.actor_kind', 'worker', true), set_config('app.actor_person_id', '', true);

select is(
  payments.apply_store_notification('app_store', 'n-5', decode(repeat('c5', 32), 'hex'),
    jsonb_build_object(
      'subscription_ref', '2000000000000001', 'product_id', 'allfit.pro.monthly.v1',
      'status', 'ended', 'ended_reason', 'refunded', 'auto_renews', false,
      'current_period_end', clock_timestamp(),
      'observed_at', clock_timestamp() + interval '4 seconds')),
  'processed',
  'a refund ends the subscription'
);

-- ---------------------------------------------------------------------------
-- Losing the gym (HU-SP-088) and doubt resolving to free
-- ---------------------------------------------------------------------------

update relationships.service_relationships
set status = 'terminated', ended_at = clock_timestamp(), ended_reason = 'left', ended_by_kind = 'person'
where id = '019b5000-0000-7000-8000-000000000402';

select pg_temp.as_person('019b5000-0000-7000-8000-000000000031');

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000031')->'plan'->>'code',
  'free',
  'with the subscription ended and the relationship terminated, the person is on the free plan'
);

select is(
  (select count(*)::integer from payments.platform_subscriptions
   where person_id = '019b5000-0000-7000-8000-000000000031')
  + (select count(*)::integer from relationships.service_relationships
     where person_id = '019b5000-0000-7000-8000-000000000031'),
  2,
  'and nothing of theirs was deleted: the subscription and the relationship stay as history'
);

update organizations.organizations set status = 'closed'
where id = '019b5000-0000-7000-8000-000000000301';

select pg_temp.as_person('019b5000-0000-7000-8000-000000000032');

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000032')->'plan'->>'code',
  'free',
  'a gym that is no longer active gives nothing'
);

update organizations.organizations set status = 'active'
where id = '019b5000-0000-7000-8000-000000000301';
alter table payments.platform_plans disable trigger user;
update payments.platform_plans set code = 'pro_old' where code = 'pro';
alter table payments.platform_plans enable trigger user;

select is(
  payments.read_my_pro('019b5000-0000-7000-8000-000000000032')->'plan'->>'code',
  'free',
  'without a published plan called pro, the gym gives the free plan, never more'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('allfit_api', 'payments.platform_subscriptions', 'SELECT')
  and not has_table_privilege('allfit_api', 'payments.platform_subscriptions', 'UPDATE')
  and not has_table_privilege('allfit_api', 'payments.platform_payment_records', 'SELECT')
  and not has_table_privilege('allfit_api', 'payments.platform_store_products', 'INSERT')
  and not has_table_privilege('allfit_api', 'payments.store_notification_receipts', 'SELECT'),
  'the runtime touches no table'
);

select ok(
  has_function_privilege('allfit_api', 'payments.list_pro_plans(uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api', 'payments.read_my_pro(uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'payments.record_store_subscription(uuid,jsonb,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'payments.apply_store_notification(text,text,bytea,jsonb)', 'EXECUTE'),
  'it runs the two reads and the two commands'
);

select ok(
  not has_function_privilege('allfit_api', 'payments.resolve_pro(uuid)', 'EXECUTE'),
  'and never the resolution itself'
);

select is(
  (select count(*)::integer from system.outbox_events
   where event_type = 'payments.platform_subscription_started.v1'),
  1,
  'starting a subscription is announced once'
);

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'payments'
      and column_name ~ '(card|pan|cvv|payload)$'
  ),
  'no table holds card data or a notification''s content'
);

select * from finish();
rollback;
