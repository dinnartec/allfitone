-- T-SUP-ATTN-01 — NEW-SUP-ATTENTION: what needs attention.
--
-- `HU-BO-005`. The panel is the first thing an operator reads, which is exactly why
-- it must not become a way around every other door. What this test is built around.
--
-- **A counter is shown only to whoever resolves it.** Each notice is gated by the
-- duty of the screen it leads to. A notice the operator could not act on is
-- withheld — never zero, which would say nothing is pending — and an operator whose
-- duties act on no notice is refused the panel, because the base role authorizes
-- nothing by itself.
--
-- **Counters reveal nobody.** No name, no contact, no organization, no aggregate
-- identifier and no payload leave through it, so reading it records no access: there
-- is no person to record it against.
--
-- **Repeated means repeated.** A single failed attempt is noise; the same thing
-- failing twice in the window is a notice. A tripped delivery circuit is listed on
-- its own, because it already is the repetition detector.
--
-- **What has no table is not modelled.** Payments arrived on 2026-10-12, so criterion 1
-- is answered now: the charges a store could not collect, the renewals in grace and the
-- plans already paused. A gym charge that fails is still invisible —the gateway worker
-- of `OP-PAY-016` records it and is not built— so that half says `not_modelled` instead
-- of zero, which would claim the gyms are collecting everything.

begin;

select plan(26);

/*
 * The panel, read the way the API reads it: the operator asked about is also the actor
 * of the transaction. It matters now because the billing notice counts rows whose
 * policy asks who is reading, and a disagreement is refused rather than counted as
 * zero. Four operators read this panel, so each read sets its own actor.
 */
create function pg_temp.panel_for(p_person uuid, p_session uuid)
returns jsonb
language plpgsql
as $fn$
begin
  perform set_config('app.actor_kind', 'support', true);
  perform set_config('app.actor_person_id', p_person::text, true);
  return support.read_attention_panel(p_person, p_session);
end
$fn$;

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019ae000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active', null),
  ('019ae000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active', null),
  ('019ae000-0000-7000-8000-000000000003', 'Support', 'Gamma', 'active', null),
  ('019ae000-0000-7000-8000-000000000004', 'Lifecycle', 'Delta', 'active', null),
  ('019ae000-0000-7000-8000-000000000005', 'Verifier', 'Epsilon', 'active', null),
  ('019ae000-0000-7000-8000-000000000006', 'Badged', 'Zeta', 'active', null),
  ('019ae000-0000-7000-8000-000000000007', 'Auditor', 'Eta', 'active', null),
  ('019ae000-0000-7000-8000-000000000008', 'Secreto', 'Theta', 'active', 'secreto@example.test'),
  ('019ae000-0000-7000-8000-000000000009', 'Renueva', 'Iota', 'active', null),
  ('019ae000-0000-7000-8000-000000000010', 'Billing', 'Kappa', 'active', null);

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019ae000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'alpha_attn', null),
  ('019ae000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'beta_attn', null),
  ('019ae000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'gamma_attn',
    '019ae000-0000-7000-8000-000000000003'),
  ('019ae000-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'delta_attn',
    '019ae000-0000-7000-8000-000000000004'),
  ('019ae000-0000-7000-8000-000000000025', 'workos', 'https://issuer.test', 'epsilon_attn',
    '019ae000-0000-7000-8000-000000000005'),
  ('019ae000-0000-7000-8000-000000000026', 'workos', 'https://issuer.test', 'zeta_attn',
    '019ae000-0000-7000-8000-000000000006'),
  ('019ae000-0000-7000-8000-000000000027', 'workos', 'https://issuer.test', 'eta_attn',
    '019ae000-0000-7000-8000-000000000007'),
  ('019ae000-0000-7000-8000-000000000030', 'workos', 'https://issuer.test', 'kappa_attn',
    '019ae000-0000-7000-8000-000000000010');

select support.bootstrap_backoffice_administrators(
  '019ae000-0000-7000-8000-000000000001', 'alpha_attn',
  '019ae000-0000-7000-8000-000000000002', 'beta_attn',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-SUP-ATTN-01'
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
  ('019ae000-0000-7000-8000-000000000041'::uuid, '019ae000-0000-7000-8000-000000000021'::uuid,
    'alpha_attn', 'c1'),
  ('019ae000-0000-7000-8000-000000000043'::uuid, '019ae000-0000-7000-8000-000000000023'::uuid,
    'gamma_attn', 'c3'),
  ('019ae000-0000-7000-8000-000000000044'::uuid, '019ae000-0000-7000-8000-000000000024'::uuid,
    'delta_attn', 'c4'),
  ('019ae000-0000-7000-8000-000000000045'::uuid, '019ae000-0000-7000-8000-000000000025'::uuid,
    'epsilon_attn', 'c5'),
  ('019ae000-0000-7000-8000-000000000046'::uuid, '019ae000-0000-7000-8000-000000000026'::uuid,
    'zeta_attn', 'c6'),
  ('019ae000-0000-7000-8000-000000000047'::uuid, '019ae000-0000-7000-8000-000000000027'::uuid,
    'eta_attn', 'c7'),
  ('019ae000-0000-7000-8000-000000000050'::uuid, '019ae000-0000-7000-8000-000000000030'::uuid,
    'kappa_attn', 'ca')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000041',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ae000-0000-7000-8000-000000000003'::uuid, '019ae000-0000-7000-8000-000000000103'::uuid,
    '019ae000-0000-7000-8000-000000000203'::uuid, '63'),
  ('019ae000-0000-7000-8000-000000000004'::uuid, '019ae000-0000-7000-8000-000000000104'::uuid,
    '019ae000-0000-7000-8000-000000000204'::uuid, '64'),
  ('019ae000-0000-7000-8000-000000000005'::uuid, '019ae000-0000-7000-8000-000000000105'::uuid,
    '019ae000-0000-7000-8000-000000000205'::uuid, '65'),
  ('019ae000-0000-7000-8000-000000000006'::uuid, '019ae000-0000-7000-8000-000000000106'::uuid,
    '019ae000-0000-7000-8000-000000000206'::uuid, '66'),
  ('019ae000-0000-7000-8000-000000000007'::uuid, '019ae000-0000-7000-8000-000000000107'::uuid,
    '019ae000-0000-7000-8000-000000000207'::uuid, '67'),
  ('019ae000-0000-7000-8000-000000000010'::uuid, '019ae000-0000-7000-8000-000000000110'::uuid,
    '019ae000-0000-7000-8000-000000000210'::uuid, '6a')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000041',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-005', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019ae000-0000-7000-8000-000000000003'::uuid, 'diagnose_support_metadata',
    '019ae000-0000-7000-8000-000000000113'::uuid, '019ae000-0000-7000-8000-000000000213'::uuid, '73'),
  ('019ae000-0000-7000-8000-000000000004'::uuid, 'manage_organization_lifecycle',
    '019ae000-0000-7000-8000-000000000114'::uuid, '019ae000-0000-7000-8000-000000000214'::uuid, '74'),
  ('019ae000-0000-7000-8000-000000000005'::uuid, 'verify_professional_credentials',
    '019ae000-0000-7000-8000-000000000115'::uuid, '019ae000-0000-7000-8000-000000000215'::uuid, '75'),
  ('019ae000-0000-7000-8000-000000000007'::uuid, 'audit_platform_access',
    '019ae000-0000-7000-8000-000000000117'::uuid, '019ae000-0000-7000-8000-000000000217'::uuid, '77'),
  ('019ae000-0000-7000-8000-000000000010'::uuid, 'view_billing_metadata',
    '019ae000-0000-7000-8000-000000000120'::uuid, '019ae000-0000-7000-8000-000000000220'::uuid, '7a')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- ---------------------------------------------------------------------------
-- Who reads the panel
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select pg_temp.panel_for(
    '019ae000-0000-7000-8000-000000000006', '019ae000-0000-7000-8000-000000000046'
  ) $$,
  '42501',
  null,
  'the base role alone does not open the panel'
);

select throws_ok(
  $$ select pg_temp.panel_for(
    '019ae000-0000-7000-8000-000000000007', '019ae000-0000-7000-8000-000000000047'
  ) $$,
  '42501',
  null,
  'a duty that resolves no notice does not open the panel'
);

select throws_ok(
  $$ select pg_temp.panel_for(
    '019ae000-0000-7000-8000-000000000005', '019ae000-0000-7000-8000-000000000043'
  ) $$,
  '42501',
  null,
  'a session that is not the operator''s own opens nothing'
);

-- What each operator saw before anything needed attention, so every count below is
-- a difference this test caused rather than whatever the database already held.
create temporary table support_before on commit drop as
select pg_temp.panel_for(
  '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043'
) as panel;

create temporary table lifecycle_before on commit drop as
select pg_temp.panel_for(
  '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000044'
) as panel;

create temporary table verifier_before on commit drop as
select pg_temp.panel_for(
  '019ae000-0000-7000-8000-000000000005', '019ae000-0000-7000-8000-000000000045'
) as panel;

-- ---------------------------------------------------------------------------
-- Things that need attention
-- ---------------------------------------------------------------------------

-- Two credentials waiting for a first review, and a verified one about to lapse.
insert into identity.professional_profiles (id, person_id, headline, bio, practice_started_year)
values
  ('019ae000-0000-7000-8000-000000000308', '019ae000-0000-7000-8000-000000000008',
    'Fisioterapeuta', 'Rehabilitación deportiva.', 2018),
  ('019ae000-0000-7000-8000-000000000309', '019ae000-0000-7000-8000-000000000009',
    'Entrenador', 'Fuerza y acondicionamiento.', 2015);

insert into identity.professional_credentials (
  id, professional_profile_id, credential_type_code, issuer, name, identifier
) values
  ('019ae000-0000-7000-8000-000000000318', '019ae000-0000-7000-8000-000000000308',
    'professional_license', 'Colegio Colombiano de Fisioterapeutas', 'Tarjeta profesional',
    'TP-ATTN-1'),
  ('019ae000-0000-7000-8000-000000000319', '019ae000-0000-7000-8000-000000000308',
    'professional_certification', 'NSCA', 'CSCS', 'CSCS-ATTN-1'),
  ('019ae000-0000-7000-8000-000000000320', '019ae000-0000-7000-8000-000000000309',
    'professional_certification', 'NSCA', 'CSCS', 'CSCS-ATTN-2');

update identity.credential_verification_requests
set status = 'cancelled', cancelled_at = clock_timestamp()
where professional_credential_id = '019ae000-0000-7000-8000-000000000320'
  and status = 'pending';

insert into identity.professional_credential_verifications (
  professional_credential_id, verifier_person_id, policy_code, method, source_authority,
  source_jurisdiction, source_reference, source_status, source_checked_at,
  evidence_fingerprint, result, decided_at, valid_from, valid_to
) values (
  '019ae000-0000-7000-8000-000000000320', '019ae000-0000-7000-8000-000000000005',
  'issuer_confirmation_v1', 'issuer_confirmation', 'NSCA', 'US', 'CSCS-ATTN-2', 'active',
  clock_timestamp() - interval '11 months', decode(repeat('9a', 32), 'hex'), 'verified',
  clock_timestamp() - interval '11 months', clock_timestamp() - interval '11 months',
  clock_timestamp() + interval '10 days'
);

-- Two gyms nobody claimed: one still waiting, one whose invitation lapsed. An
-- operating gym and a cancelled creation are not pending anything.
select * from organizations.create_unclaimed_organization(
  '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000044',
  'Atención Norte', 'gym', 'legal_entity', 'Atención Norte SAS', null, null,
  'norte@example.test', decode(repeat('b1', 32), 'hex'), 1::smallint,
  'e1000000-0000-4000-8000-000000000001', '019ae000-0000-7000-8000-000000000501',
  decode(repeat('d1', 32), 'hex')
);

select * from organizations.create_unclaimed_organization(
  '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000044',
  'Atención Sur', 'gym', 'legal_entity', 'Atención Sur SAS', null, null,
  'sur@example.test', decode(repeat('b2', 32), 'hex'), 1::smallint,
  'e1000000-0000-4000-8000-000000000002', '019ae000-0000-7000-8000-000000000502',
  decode(repeat('d2', 32), 'hex')
);

update identity.invitations as invitation
set created_at = clock_timestamp() - interval '8 days',
    expires_at = clock_timestamp() - interval '1 day'
where invitation.id = '019ae000-0000-7000-8000-000000000502';

insert into organizations.organizations (id, type_code, display_name, legal_name, responsible_party)
values (
  '019ae000-0000-7000-8000-000000000601', 'gym', 'Atención Operando', 'Operando SAS',
  '{"party_kind":"legal_entity","party_name":"Operando SAS","purpose":"studio_operations"}'::jsonb
);
insert into organizations.organizations (
  id, type_code, display_name, legal_name, status, claimed_at, cancelled_at, responsible_party
) values (
  '019ae000-0000-7000-8000-000000000602', 'gym', 'Atención Cancelado', 'Cancelado SAS',
  'cancelled', null, clock_timestamp(),
  '{"party_kind":"legal_entity","party_name":"Cancelado SAS","purpose":"studio_operations"}'::jsonb
);

-- Notifications: one type failing again and again, one that gave up within the
-- window, one that failed once, one that gave up days ago and one that got through.
insert into system.outbox_events (
  id, aggregate_type, aggregate_id, event_type, payload_schema_version, payload,
  occurred_at, attempt_count, last_error_code, published_at, dead_lettered_at
) values
  ('019ae000-0000-7000-8000-000000000701', 'invitation',
    '019ae000-0000-7000-8000-000000000801', 'attention.retry_probe.v1', 1,
    '{"contact":"secreto@example.test","given_name":"Secreto"}',
    clock_timestamp() - interval '20 minutes', 3, 'smtp_timeout', null, null),
  ('019ae000-0000-7000-8000-000000000702', 'invitation',
    '019ae000-0000-7000-8000-000000000802', 'attention.retry_probe.v1', 1, '{}',
    clock_timestamp() - interval '10 minutes', 2, 'smtp_rejected', null, null),
  ('019ae000-0000-7000-8000-000000000703', 'invitation',
    '019ae000-0000-7000-8000-000000000803', 'attention.dead_probe.v1', 1, '{}',
    clock_timestamp() - interval '3 hours', 5, 'provider_down', null,
    clock_timestamp() - interval '1 hour'),
  ('019ae000-0000-7000-8000-000000000704', 'invitation',
    '019ae000-0000-7000-8000-000000000804', 'attention.single_probe.v1', 1, '{}',
    clock_timestamp() - interval '5 minutes', 1, 'smtp_timeout', null, null),
  ('019ae000-0000-7000-8000-000000000705', 'invitation',
    '019ae000-0000-7000-8000-000000000805', 'attention.old_probe.v1', 1, '{}',
    clock_timestamp() - interval '3 days', 6, 'provider_down', null,
    clock_timestamp() - interval '2 days'),
  ('019ae000-0000-7000-8000-000000000706', 'invitation',
    '019ae000-0000-7000-8000-000000000806', 'attention.delivered_probe.v1', 1, '{}',
    clock_timestamp() - interval '30 minutes', 4, 'smtp_timeout',
    clock_timestamp() - interval '25 minutes', null);

-- Commands: one operation stranded twice, one stranded once, one stranded days ago.
insert into system.idempotency_keys (
  id, principal_fingerprint, client_id, surface, operation_code, key, command_id,
  request_hash, status, aggregate_type, aggregate_id, created_at
)
select
  receipt_id, decode(repeat(hash_byte, 32), 'hex'), 'studio', 'studio', operation_code,
  key, command_id, decode(repeat(hash_byte, 32), 'hex'), 'processing', 'person',
  '019ae000-0000-7000-8000-000000000807', clock_timestamp() - age
from (values
  ('019ae000-0000-7000-8000-000000000711'::uuid, 'e1', 'OP-TST-901',
    'a1111111-1111-4111-8111-111111111111'::uuid, '019ae000-0000-7000-8000-000000000721'::uuid,
    interval '30 minutes'),
  ('019ae000-0000-7000-8000-000000000712'::uuid, 'e2', 'OP-TST-901',
    'a2222222-2222-4222-8222-222222222222'::uuid, '019ae000-0000-7000-8000-000000000722'::uuid,
    interval '2 hours'),
  ('019ae000-0000-7000-8000-000000000713'::uuid, 'e3', 'OP-TST-902',
    'a3333333-3333-4333-8333-333333333333'::uuid, '019ae000-0000-7000-8000-000000000723'::uuid,
    interval '40 minutes'),
  ('019ae000-0000-7000-8000-000000000714'::uuid, 'e4', 'OP-TST-902',
    'a4444444-4444-4444-8444-444444444444'::uuid, '019ae000-0000-7000-8000-000000000724'::uuid,
    interval '2 days')
) as receipt_row(receipt_id, hash_byte, operation_code, key, command_id, age);

insert into system.outbox_delivery_circuits (
  event_type, state, window_started_at, success_count, failure_count, opened_until
) values
  ('attention.retry_probe.v1', 'open', clock_timestamp() - interval '1 hour', 0, 12,
    clock_timestamp() + interval '1 hour'),
  ('attention.dead_probe.v1', 'closed', clock_timestamp() - interval '1 hour', 40, 0, null);

-- Three things the billing notice is about, each in the state an operator would act on:
-- a Pro renewal the store could not collect, a Pro subscription already suspended, and
-- a gym plan paused for not paying. Inserted in the state the commands leave behind;
-- `T-PAY-PRO-01` and `T-PAY-LIFECYCLE-01` own the commands themselves.
insert into payments.platform_plans (
  id, code, name, plan_kind, status, created_by_person_id, created_by_duty_assignment_id
)
select '019ae000-0000-7000-8000-000000000801', 'pro', 'Pro', 'paid', 'published',
  '019ae000-0000-7000-8000-000000000001', duty.id
from support.platform_duty_assignments as duty
where duty.person_id = '019ae000-0000-7000-8000-000000000010'
  and duty.duty_code = 'view_billing_metadata';

insert into payments.platform_plan_versions (
  id, platform_plan_id, plan_kind, version_number, amount_minor, currency_code,
  billing_period, status, proposed_by_person_id, proposed_by_duty_assignment_id,
  published_by_person_id, published_by_duty_assignment_id, published_at
)
select '019ae000-0000-7000-8000-000000000802', '019ae000-0000-7000-8000-000000000801',
  'paid', 1, 1990000, 'COP', 'month', 'published',
  '019ae000-0000-7000-8000-000000000001', duty.id,
  '019ae000-0000-7000-8000-000000000002', duty.id, clock_timestamp()
from support.platform_duty_assignments as duty
where duty.person_id = '019ae000-0000-7000-8000-000000000010'
  and duty.duty_code = 'view_billing_metadata';

insert into payments.platform_store_products (store, product_id, platform_plan_version_id)
values ('app_store', 'allfit.pro.monthly.attn', '019ae000-0000-7000-8000-000000000802');

insert into identity.people (id, given_name, family_name, status)
values
  ('019ae000-0000-7000-8000-000000000811', 'Gracia', 'Pendiente', 'active'),
  ('019ae000-0000-7000-8000-000000000812', 'Suspendida', 'Pro', 'active'),
  ('019ae000-0000-7000-8000-000000000813', 'Suspendida', 'Gimnasio', 'active');

insert into payments.platform_subscriptions (
  id, person_id, platform_plan_version_id, store, store_product_id, store_subscription_ref,
  environment, status, auto_renews, current_period_end, grace_until, last_observed_at
)
values
  ('019ae000-0000-7000-8000-000000000821', '019ae000-0000-7000-8000-000000000811',
    '019ae000-0000-7000-8000-000000000802', 'app_store', 'allfit.pro.monthly.attn',
    'ref-attn-grace', 'production', 'grace', true,
    clock_timestamp() - interval '1 day', clock_timestamp() + interval '6 days',
    clock_timestamp());

insert into payments.platform_subscriptions (
  id, person_id, platform_plan_version_id, store, store_product_id, store_subscription_ref,
  environment, status, auto_renews, current_period_end, suspended_at, last_observed_at
)
values
  ('019ae000-0000-7000-8000-000000000822', '019ae000-0000-7000-8000-000000000812',
    '019ae000-0000-7000-8000-000000000802', 'app_store', 'allfit.pro.monthly.attn',
    'ref-attn-suspended', 'production', 'suspended', true,
    clock_timestamp() - interval '10 days', clock_timestamp() - interval '3 days',
    clock_timestamp());

insert into payments.platform_payment_records (
  platform_subscription_id, person_id, store, store_transaction_id, amount_minor,
  currency_code, result, failure_code, occurred_at
)
values
  ('019ae000-0000-7000-8000-000000000821', '019ae000-0000-7000-8000-000000000811',
    'app_store', 'txn-attn-failed', 1990000, 'COP', 'failed', 'billing_retry',
    clock_timestamp() - interval '3 hours'),
  -- Older than the window. It failed, and it is not what needs attention now.
  ('019ae000-0000-7000-8000-000000000822', '019ae000-0000-7000-8000-000000000812',
    'app_store', 'txn-attn-old', 1990000, 'COP', 'failed', 'billing_retry',
    clock_timestamp() - interval '5 days');

insert into organizations.organizations (id, type_code, display_name, responsible_party, status)
values ('019ae000-0000-7000-8000-000000000831', 'gym', 'Gimnasio Atencion',
  '{"party_kind":"legal_entity","party_name":"Atencion SAS","purpose":"studio_operations"}',
  'active');

insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019ae000-0000-7000-8000-000000000841', '019ae000-0000-7000-8000-000000000813',
  '019ae000-0000-7000-8000-000000000831', 'active');

insert into payments.organization_plans (id, organization_id, name, status)
values ('019ae000-0000-7000-8000-000000000851', '019ae000-0000-7000-8000-000000000831',
  'Mensual', 'published');

insert into payments.plan_versions (
  id, plan_id, organization_id, version_number, amount_minor, currency_code,
  billing_period, status, published_at
)
values ('019ae000-0000-7000-8000-000000000852', '019ae000-0000-7000-8000-000000000851',
  '019ae000-0000-7000-8000-000000000831', 1, 12000000, 'COP', 'month', 'published',
  clock_timestamp());

insert into payments.plan_subscriptions (
  id, person_id, organization_id, plan_version_id, status, current_period_end,
  started_at, suspended_at
)
values ('019ae000-0000-7000-8000-000000000861', '019ae000-0000-7000-8000-000000000813',
  '019ae000-0000-7000-8000-000000000831', '019ae000-0000-7000-8000-000000000852',
  'suspended', (clock_timestamp() + interval '10 days')::date,
  clock_timestamp() - interval '40 days', clock_timestamp() - interval '2 days');
create temporary table support_after on commit drop as
select pg_temp.panel_for(
  '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000043'
) as panel;

create temporary table lifecycle_after on commit drop as
select pg_temp.panel_for(
  '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000044'
) as panel;

create temporary table verifier_after on commit drop as
select pg_temp.panel_for(
  '019ae000-0000-7000-8000-000000000005', '019ae000-0000-7000-8000-000000000045'
) as panel;

create temporary table billing_after on commit drop as
select pg_temp.panel_for(
  '019ae000-0000-7000-8000-000000000010', '019ae000-0000-7000-8000-000000000050'
) as panel;

-- ---------------------------------------------------------------------------
-- Criterion 1 — the charges that failed and the plans in pause
-- ---------------------------------------------------------------------------

select ok(
  (select panel->'billing'->>'availability' = 'available'
     and (panel->'billing'->>'window_hours')::integer = 24
   from billing_after),
  'whoever holds the billing duty is told what needs attention about the money'
);

select ok(
  (select bool_and(panel->'billing'->>'availability' = 'withheld')
   from (
     select panel from support_after union all select panel from lifecycle_after
     union all select panel from verifier_after
   ) as panels),
  'and whoever does not hold it is told nothing, never zero'
);

select results_eq(
  $$ select (panel->'billing'->>'failed_platform_charges')::integer,
            (panel->'billing'->>'platform_subscriptions_in_grace')::integer,
            (panel->'billing'->>'platform_subscriptions_suspended')::integer,
            (panel->'billing'->>'organization_subscriptions_suspended')::integer
     from billing_after $$,
  $$ values (1, 1, 1, 1) $$,
  'one charge failed inside the window, one renewal is in grace, one Pro and one gym plan are paused'
);

-- A gym charge that fails is invisible until the gateway worker exists: `OP-PAY-016`
-- records what a provider reports and is not built. Zero here would say the gyms are
-- collecting everything, which is a claim this platform cannot make.
select is(
  (select panel->'billing'->>'failed_organization_charges_availability' from billing_after),
  'not_modelled',
  'and a failed charge of a gym is not modelled rather than counted as none'
);

-- The notice names nobody. It is a counter, and reaching the person behind it goes
-- through the door that asks for a case reference.
select ok(
  (select position('019ae000-0000-7000-8000-00000000081' in panel->>'billing') = 0
     and position('Suspendida' in panel->>'billing') = 0
   from billing_after),
  'no person and no gym travels in the billing notice: counters only'
);

select ok(
  (select panel->'credential_verifications'->>'availability' = 'withheld'
     and panel->'credential_verifications'->'pending_count' = 'null'::jsonb
     and panel->'unclaimed_organizations'->>'availability' = 'withheld'
     and panel->'unclaimed_organizations'->'count' = 'null'::jsonb
     and panel->'repeated_failures'->>'availability' = 'withheld'
     and panel->'repeated_failures'->'groups' = 'null'::jsonb
   from billing_after),
  'the billing duty opens the panel and sees none of the notices it cannot resolve'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — credentials waiting for a verifier
-- ---------------------------------------------------------------------------

select is(
  (select (a.panel->'credential_verifications'->>'pending_count')::integer
        - (b.panel->'credential_verifications'->>'pending_count')::integer
   from verifier_after as a, verifier_before as b),
  2,
  'a verifier sees how many credentials wait for a first review'
);

select is(
  (select (a.panel->'credential_verifications'->>'renewals_due_count')::integer
        - (b.panel->'credential_verifications'->>'renewals_due_count')::integer
   from verifier_after as a, verifier_before as b),
  1,
  'and how many verified ones are about to lapse without a renewal open'
);

select is(
  (select (panel->'credential_verifications'->>'oldest_requested_at')::timestamptz
   from verifier_after),
  (select min(request.created_at) from identity.credential_verification_requests as request
   where request.status = 'pending'),
  'the notice says since when the oldest one has been waiting'
);

select ok(
  (select bool_and(panel->'credential_verifications'->>'availability' = 'withheld'
                   and panel->'credential_verifications'->'pending_count' = 'null'::jsonb
                   and panel->'credential_verifications'->'renewals_due_count' = 'null'::jsonb)
   from (select panel from support_after union all select panel from lifecycle_after) as panels),
  'without the verification duty the count is withheld, not zero'
);

-- ---------------------------------------------------------------------------
-- Criterion 3 — gyms nobody claimed
-- ---------------------------------------------------------------------------

select is(
  (select (a.panel->'unclaimed_organizations'->>'count')::integer
        - (b.panel->'unclaimed_organizations'->>'count')::integer
   from lifecycle_after as a, lifecycle_before as b),
  2,
  'whoever manages the lifecycle sees the gyms nobody claimed, and not operating or cancelled ones'
);

select is(
  (select (a.panel->'unclaimed_organizations'->>'needs_follow_up_count')::integer
        - (b.panel->'unclaimed_organizations'->>'needs_follow_up_count')::integer
   from lifecycle_after as a, lifecycle_before as b),
  1,
  'a lapsed invitation needs follow-up; one still waiting does not'
);

select ok(
  (select s.panel->'unclaimed_organizations'->>'availability' = 'available'
     and s.panel->'unclaimed_organizations'->'count' = l.panel->'unclaimed_organizations'->'count'
   from support_after as s, lifecycle_after as l),
  'support reads the same count, because it reads the directory the notice leads to'
);

select ok(
  (select panel->'unclaimed_organizations'->>'availability' = 'withheld'
     and panel->'unclaimed_organizations'->'count' = 'null'::jsonb
     and panel->'unclaimed_organizations'->'needs_follow_up_count' = 'null'::jsonb
   from verifier_after),
  'a verifier does not see the gyms, because nothing about them is theirs to resolve'
);

-- ---------------------------------------------------------------------------
-- Criterion 4 — system errors that repeat
-- ---------------------------------------------------------------------------

select ok(
  (select (group_row->>'affected')::integer = 2
     and (group_row->>'failures')::integer = 5
     and group_row->>'source' = 'notification'
     and group_row->>'last_error_code' = 'smtp_rejected'
     and (panel->'repeated_failures'->>'window_hours')::integer = 24
   from support_after, jsonb_array_elements(panel->'repeated_failures'->'groups') as group_row
   where group_row->>'label' = 'attention.retry_probe.v1'),
  'a notification type failing again and again is one notice, with its attempts and last error'
);

select ok(
  (select (group_row->>'affected')::integer = 1
     and (group_row->>'failures')::integer = 5
     and group_row->>'last_error_code' = 'provider_down'
   from support_after, jsonb_array_elements(panel->'repeated_failures'->'groups') as group_row
   where group_row->>'label' = 'attention.dead_probe.v1'),
  'one that gave up after repeated attempts inside the window is a notice too'
);

select ok(
  not exists (
    select 1
    from support_after, jsonb_array_elements(panel->'repeated_failures'->'groups') as group_row
    where group_row->>'label' in (
      'attention.single_probe.v1', 'attention.old_probe.v1', 'attention.delivered_probe.v1'
    )
  ),
  'a single failure, one that gave up days ago and one that got through are not notices'
);

select ok(
  (select count(*) = 1
     and bool_and((group_row->>'affected')::integer = 2 and group_row->>'source' = 'command')
   from support_after, jsonb_array_elements(panel->'repeated_failures'->'groups') as group_row
   where group_row->>'label' like 'OP-TST-%'
     and group_row->>'label' = 'OP-TST-901')
  and not exists (
    select 1
    from support_after, jsonb_array_elements(panel->'repeated_failures'->'groups') as group_row
    where group_row->>'label' in ('OP-TST-902', 'OP-TST-903')
  ),
  'an operation stranded twice is a notice; stranded once, or days ago, is not'
);

select ok(
  (select count(*) = 1
     and bool_and(circuit->>'state' = 'open' and (circuit->>'failure_count')::integer = 12)
   from support_after, jsonb_array_elements(panel->'repeated_failures'->'open_circuits') as circuit
   where circuit->>'event_type' like 'attention.%'),
  'a tripped delivery channel is listed; a healthy one is not'
);

select ok(
  (select bool_and(panel->'repeated_failures'->>'availability' = 'withheld'
                   and panel->'repeated_failures'->'groups' = 'null'::jsonb
                   and panel->'repeated_failures'->'open_circuits' = 'null'::jsonb)
   from (select panel from lifecycle_after union all select panel from verifier_after) as panels),
  'without the diagnosis duty the errors are withheld'
);

-- ---------------------------------------------------------------------------
-- Criterion 6 — a counter opens nothing
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(
     position('Secreto' in panel::text) = 0
     and position('Atención' in panel::text) = 0
     and position('example.test' in panel::text) = 0
     and position('019ae000-0000-7000-8000-00000000080' in panel::text) = 0
     and position('019ae000-0000-7000-8000-00000000031' in panel::text) = 0
   )
   from (
     select panel from support_after union all select panel from lifecycle_after
     union all select panel from verifier_after
   ) as panels),
  'no name, no gym, no contact and no identifier to open a file travels in the panel'
);

select is(
  (select count(*)::integer from privacy.access_events as event
   where event.actor_person_id in (
     '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000004',
     '019ae000-0000-7000-8000-000000000005', '019ae000-0000-7000-8000-000000000010'
   )),
  0,
  'reading counters records no access, because they reveal nobody'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('allfit_api', 'support.read_attention_panel(uuid,uuid)', 'EXECUTE')
  and not has_table_privilege('allfit_api', 'identity.credential_verification_requests', 'SELECT')
  and not has_table_privilege('allfit_api', 'organizations.organizations', 'SELECT')
  and not has_table_privilege('allfit_api', 'system.outbox_events', 'SELECT'),
  'the runtime role reads the panel, never the tables behind it'
);

select * from finish();
rollback;
