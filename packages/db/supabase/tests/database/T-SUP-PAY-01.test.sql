-- T-SUP-PAY-01 — NEW-SUP-PERSON-PAYMENTS: what a person pays (`HU-BO-018`).
--
-- The screen somebody opens when a person writes «me cobraron y no debían». Four
-- decisions shape what it may say.
--
-- **It is a billing read, not a diagnosis.** It asks for `view_billing_metadata` and
-- nothing else stands in for it: the support duty that opens the person's card does
-- not open her money, and the test proves that denial from inside the Backoffice.
--
-- **A case reference, and the read is recorded.** Payments are not a break-glass
-- category — the dictionary is explicit — so this is an ordinary support read with
-- the same ritual as the card: a traceable case, and one `privacy.access_events` row
-- written before the content travels.
--
-- **No card data, because Allfit holds none.** Criterion 4 is honoured by there being
-- nothing to hide: the schema stores a store transaction id and an amount, never a
-- means of payment. Asserted over the whole projection and over the columns.
--
-- **What Allfit does not charge, it does not know.** A person may also pay her gym,
-- and that bond is shown with its state — hiding it would leave the operator guessing
-- about the complaint in front of them. But the gym collects through its own gateway
-- and `OP-PAY-016` does not exist, so the charges of that bond are `not_modelled`
-- rather than an empty list that would read as «never charged».

begin;

select plan(17);

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019c8000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active', null),
  ('019c8000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active', null),
  ('019c8000-0000-7000-8000-000000000003', 'Billing', 'Gamma', 'active', null),
  ('019c8000-0000-7000-8000-000000000004', 'Support', 'Delta', 'active', null),
  ('019c8000-0000-7000-8000-000000000011', 'Paga', 'Directo', 'active', null),
  ('019c8000-0000-7000-8000-000000000012', 'Pro', 'PorGimnasio', 'active', null),
  ('019c8000-0000-7000-8000-000000000013', 'Cobro', 'Suspendido', 'active', null);

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019c8000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'alpha_pay', null),
  ('019c8000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'beta_pay', null),
  ('019c8000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'gamma_pay',
    '019c8000-0000-7000-8000-000000000003'),
  ('019c8000-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'delta_pay',
    '019c8000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019c8000-0000-7000-8000-000000000001', 'alpha_pay',
  '019c8000-0000-7000-8000-000000000002', 'beta_pay',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-SUP-PAY-01'
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
  ('019c8000-0000-7000-8000-000000000041'::uuid, '019c8000-0000-7000-8000-000000000021'::uuid,
    'alpha_pay', 'd1'),
  ('019c8000-0000-7000-8000-000000000043'::uuid, '019c8000-0000-7000-8000-000000000023'::uuid,
    'gamma_pay', 'd3'),
  ('019c8000-0000-7000-8000-000000000044'::uuid, '019c8000-0000-7000-8000-000000000024'::uuid,
    'delta_pay', 'd4')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019c8000-0000-7000-8000-000000000001', '019c8000-0000-7000-8000-000000000041',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019c8000-0000-7000-8000-000000000003'::uuid, '019c8000-0000-7000-8000-000000000103'::uuid,
    '019c8000-0000-7000-8000-000000000203'::uuid, '73'),
  ('019c8000-0000-7000-8000-000000000004'::uuid, '019c8000-0000-7000-8000-000000000104'::uuid,
    '019c8000-0000-7000-8000-000000000204'::uuid, '74')
) as role_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019c8000-0000-7000-8000-000000000001', '019c8000-0000-7000-8000-000000000041',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-018', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019c8000-0000-7000-8000-000000000003'::uuid, 'view_billing_metadata',
    '019c8000-0000-7000-8000-000000000113'::uuid, '019c8000-0000-7000-8000-000000000213'::uuid,
    '83'),
  ('019c8000-0000-7000-8000-000000000004'::uuid, 'diagnose_support_metadata',
    '019c8000-0000-7000-8000-000000000114'::uuid, '019c8000-0000-7000-8000-000000000214'::uuid,
    '84')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- ---------------------------------------------------------------------------
-- What there is to look at
-- ---------------------------------------------------------------------------

insert into payments.platform_plans (
  id, code, name, plan_kind, status, created_by_person_id, created_by_duty_assignment_id
)
select '019c8000-0000-7000-8000-000000000301', 'pro', 'Pro', 'paid', 'published',
  '019c8000-0000-7000-8000-000000000001', duty.id
from support.platform_duty_assignments as duty
where duty.person_id = '019c8000-0000-7000-8000-000000000003';

insert into payments.platform_plan_versions (
  id, platform_plan_id, plan_kind, version_number, amount_minor, currency_code,
  billing_period, status, proposed_by_person_id, proposed_by_duty_assignment_id,
  published_by_person_id, published_by_duty_assignment_id, published_at
)
select '019c8000-0000-7000-8000-000000000302', '019c8000-0000-7000-8000-000000000301',
  'paid', 1, 1990000, 'COP', 'month', 'published',
  '019c8000-0000-7000-8000-000000000001', duty.id,
  '019c8000-0000-7000-8000-000000000002', duty.id, clock_timestamp()
from support.platform_duty_assignments as duty
where duty.person_id = '019c8000-0000-7000-8000-000000000003';

insert into payments.platform_store_products (store, product_id, platform_plan_version_id)
values
  ('app_store', 'allfit.pro.monthly.pay', '019c8000-0000-7000-8000-000000000302'),
  ('google_play', 'allfit.pro.monthly.pay', '019c8000-0000-7000-8000-000000000302');

-- She pays Apple every month, and one charge failed before the last one went through.
insert into payments.platform_subscriptions (
  id, person_id, platform_plan_version_id, store, store_product_id, store_subscription_ref,
  environment, status, auto_renews, current_period_end, last_observed_at
)
values ('019c8000-0000-7000-8000-000000000311', '019c8000-0000-7000-8000-000000000011',
  '019c8000-0000-7000-8000-000000000302', 'app_store', 'allfit.pro.monthly.pay',
  'ref-pay-directo', 'production', 'active', true,
  clock_timestamp() + interval '18 days', clock_timestamp());

insert into payments.platform_payment_records (
  platform_subscription_id, person_id, store, store_transaction_id, amount_minor,
  currency_code, result, failure_code, occurred_at
)
values
  ('019c8000-0000-7000-8000-000000000311', '019c8000-0000-7000-8000-000000000011',
    'app_store', 'txn-pay-1', 1990000, 'COP', 'succeeded', null,
    clock_timestamp() - interval '12 days'),
  ('019c8000-0000-7000-8000-000000000311', '019c8000-0000-7000-8000-000000000011',
    'app_store', 'txn-pay-0', 1990000, 'COP', 'failed', 'billing_retry',
    clock_timestamp() - interval '13 days');

-- Her Pro stopped because the store could not collect, and the file has to say since
-- when: criterion 3 is a date, not a flag.
insert into payments.platform_subscriptions (
  id, person_id, platform_plan_version_id, store, store_product_id, store_subscription_ref,
  environment, status, auto_renews, current_period_end, suspended_at, last_observed_at
)
values ('019c8000-0000-7000-8000-000000000313', '019c8000-0000-7000-8000-000000000013',
  '019c8000-0000-7000-8000-000000000302', 'google_play', 'allfit.pro.monthly.pay',
  'ref-pay-suspendida', 'production', 'suspended', true,
  clock_timestamp() - interval '9 days', clock_timestamp() - interval '4 days',
  clock_timestamp());

-- And she has Pro for training somewhere, which is the other half of criterion 1.
insert into organizations.organizations (id, type_code, display_name, responsible_party, status)
values ('019c8000-0000-7000-8000-000000000401', 'gym', 'Gimnasio Pagos',
  '{"party_kind":"legal_entity","party_name":"Pagos SAS","purpose":"studio_operations"}',
  'active');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019c8000-0000-7000-8000-000000000411', '019c8000-0000-7000-8000-000000000012',
  '019c8000-0000-7000-8000-000000000401', 'active');

-- She also pays that gym a plan. Allfit never sees that money.
insert into payments.organization_plans (id, organization_id, name, status)
values ('019c8000-0000-7000-8000-000000000421', '019c8000-0000-7000-8000-000000000401',
  'Mensual', 'published');

insert into payments.plan_versions (
  id, plan_id, organization_id, version_number, amount_minor, currency_code,
  billing_period, status, published_at
)
values ('019c8000-0000-7000-8000-000000000422', '019c8000-0000-7000-8000-000000000421',
  '019c8000-0000-7000-8000-000000000401', 1, 12000000, 'COP', 'month', 'published',
  clock_timestamp());

insert into payments.plan_subscriptions (
  id, person_id, organization_id, plan_version_id, status, current_period_end
)
values ('019c8000-0000-7000-8000-000000000431', '019c8000-0000-7000-8000-000000000012',
  '019c8000-0000-7000-8000-000000000401', '019c8000-0000-7000-8000-000000000422',
  'active', (clock_timestamp() + interval '25 days')::date);

-- ---------------------------------------------------------------------------
-- Who may look, and with what
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019c8000-0000-7000-8000-000000000004', true);

select throws_ok(
  $$ select support.person_payments(
    '019c8000-0000-7000-8000-000000000004', '019c8000-0000-7000-8000-000000000044',
    'CASE-2026-018', '019c8000-0000-7000-8000-000000000011'
  ) $$,
  '42501',
  null,
  'the duty that opens the person''s card does not open her money'
);

select set_config('app.actor_person_id', '019c8000-0000-7000-8000-000000000003', true);

select throws_ok(
  $$ select support.person_payments(
    '019c8000-0000-7000-8000-000000000003', '019c8000-0000-7000-8000-000000000043',
    'sin caso', '019c8000-0000-7000-8000-000000000011'
  ) $$,
  '22023',
  null,
  'and no read happens without a traceable case reference'
);

select throws_ok(
  $$ select support.person_payments(
    '019c8000-0000-7000-8000-000000000003', '019c8000-0000-7000-8000-000000000043',
    'CASE-2026-018', '019c8000-0000-7000-8000-000000009999'
  ) $$,
  'P0002',
  null,
  'a person who does not exist has no payments to look at'
);

-- ---------------------------------------------------------------------------
-- What she pays Allfit
-- ---------------------------------------------------------------------------

create temporary table directo on commit drop as
select support.person_payments(
  '019c8000-0000-7000-8000-000000000003', '019c8000-0000-7000-8000-000000000043',
  'CASE-2026-018', '019c8000-0000-7000-8000-000000000011'
) as file;

select is(
  (select file->'pro'->>'source' from directo),
  'subscription',
  'whoever pays Allfit directly is shown as paying Allfit directly'
);

select results_eq(
  $$ select file->'pro'->'subscription'->>'store',
            (file->'pro'->'subscription'->>'amount_minor')::bigint,
            file->'pro'->'subscription'->>'currency_code',
            file->'pro'->'subscription'->>'status'
     from directo $$,
  $$ values ('app_store'::text, 1990000::bigint, 'COP'::text, 'active'::text) $$,
  'with the store that charges her, what it charges and in which currency'
);

select isnt(
  (select file->'pro'->'subscription'->>'current_period_end' from directo),
  null,
  'and when the next charge falls, which is what a complaint about one needs'
);

select is(
  (select jsonb_array_length(file->'payments') from directo),
  2,
  'every charge appears, the one that went through and the one that did not'
);

select results_eq(
  $$ select charge->>'result', charge->>'failure_code'
     from directo, jsonb_array_elements(file->'payments') as charge $$,
  $$ values ('succeeded'::text, null::text), ('failed'::text, 'billing_retry'::text) $$,
  'newest first, each one with its result and the reason when it failed'
);

-- ---------------------------------------------------------------------------
-- Criterion 4 — there is no card to show
-- ---------------------------------------------------------------------------

select ok(
  (select position('card' in lower(file::text)) = 0
     and position('pan' in lower((file->'pro')::text)) = 0
     and position('cvv' in lower(file::text)) = 0
   from directo),
  'no means of payment travels in the file'
);

-- And not by filtering: the schema holds none. A column named for a card would make
-- this fail, which is the only version of this assertion worth having.
select is(
  (select count(*)::integer from information_schema.columns
    where table_schema = 'payments'
      and column_name ~ '(card|pan|cvv|iban|account_number)'),
  0,
  'because Allfit stores no means of payment at all'
);

-- ---------------------------------------------------------------------------
-- Pro that comes from a gym, and the plan she pays that gym
-- ---------------------------------------------------------------------------

create temporary table por_gimnasio on commit drop as
select support.person_payments(
  '019c8000-0000-7000-8000-000000000003', '019c8000-0000-7000-8000-000000000043',
  'CASE-2026-018', '019c8000-0000-7000-8000-000000000012'
) as file;

select results_eq(
  $$ select file->'pro'->>'source',
            file->'pro'->'organizations'->0->>'organization_name'
     from por_gimnasio $$,
  $$ values ('organization'::text, 'Gimnasio Pagos'::text) $$,
  'whoever has Pro through a gym is shown which gym, by name'
);

select is(
  (select file->'pro'->'subscription' from por_gimnasio),
  'null'::jsonb,
  'and no store subscription, because she pays Allfit nothing'
);

select results_eq(
  $$ select bond->>'organization_name', bond->>'status'
     from por_gimnasio, jsonb_array_elements(file->'organization_subscriptions') as bond $$,
  $$ values ('Gimnasio Pagos'::text, 'active'::text) $$,
  'the plan she pays her gym is shown too: the complaint may be about that one'
);

select is(
  (select file->>'organization_charges_availability' from por_gimnasio),
  'not_modelled',
  'but its charges are not modelled, never an empty list reading as never charged'
);

-- ---------------------------------------------------------------------------
-- Suspended, and since when
-- ---------------------------------------------------------------------------

select ok(
  (select file->'pro'->'subscription'->>'status' = 'suspended'
     and (file->'pro'->'subscription'->>'suspended_at')::timestamptz
       < clock_timestamp() - interval '3 days'
   from (
     select support.person_payments(
       '019c8000-0000-7000-8000-000000000003', '019c8000-0000-7000-8000-000000000043',
       'CASE-2026-018', '019c8000-0000-7000-8000-000000000013'
     ) as file
   ) as suspendida),
  'a suspended subscription says so and says since when, which is a date and not a flag'
);

-- ---------------------------------------------------------------------------
-- The read is recorded against the person it was about
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select subject_person_id, resource, purpose, access_mode::text, result
     from privacy.access_events
     where actor_person_id = '019c8000-0000-7000-8000-000000000003'
       and subject_person_id = '019c8000-0000-7000-8000-000000000011' $$,
  $$ values ('019c8000-0000-7000-8000-000000000011'::uuid, 'payments.person_payments'::text,
             'billing_support'::text, 'support_metadata'::text, 'allowed'::text) $$,
  'one access is recorded for the person whose money was read, before it travelled'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'allfit_api', 'support.person_payments(uuid,uuid,text,uuid)', 'EXECUTE'
  )
  and not has_table_privilege('allfit_api', 'payments.platform_payment_records', 'SELECT')
  and not has_table_privilege('allfit_api', 'payments.platform_subscriptions', 'SELECT'),
  'the runtime reads the file, never the tables behind it'
);

select * from finish();
rollback;
