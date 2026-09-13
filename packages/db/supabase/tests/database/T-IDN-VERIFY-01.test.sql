-- T-IDN-VERIFY-01 — PR-002 + T-VG-01..06 / OP-IDN-011: verifying a professional
-- credential.
--
-- `HU-BO-021`. A verification is what lets a credential count — for nutrition it
-- is the predicate ADR-027 hangs off — so almost every assertion here is about
-- what must *not* become `verified`.
--
-- Three things this test is built around.
--
-- **The queue fills itself.** Declaring or revising a credential opens a pending
-- request for that exact version, and retiring it withdraws the request. Nobody has
-- to remember to ask, and criterion 7 — a revised credential gets a review of its
-- own — is the same mechanism rather than a separate rule.
--
-- **The conflicts are checked against the data, not declared.** ADR-026 lists five.
-- The subject and the shared active membership are checkable today and are
-- asserted here. A professional relationship cannot be checked because
-- `relationships` does not exist — which also means no such relationship can exist
-- yet — and appeals are not built. Both are recorded where the check lives.
--
-- **Nothing is verified by omission.** There is no default result, the validity is
-- derived rather than accepted, and a source that says the credential lapsed cannot
-- produce `verified` at all.

begin;

select plan(33);

insert into identity.people (id, given_name, family_name, status)
values
  ('019aa000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019aa000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019aa000-0000-7000-8000-000000000003', 'Verifier', 'Gamma', 'active'),
  ('019aa000-0000-7000-8000-000000000004', 'Curator', 'Delta', 'active'),
  ('019aa000-0000-7000-8000-000000000005', 'Professional', 'Epsilon', 'active'),
  ('019aa000-0000-7000-8000-000000000006', 'Colleague', 'Zeta', 'active'),
  ('019aa000-0000-7000-8000-000000000007', 'Badged', 'Eta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019aa000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha10', null),
  ('019aa000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta10', null),
  ('019aa000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma10',
    '019aa000-0000-7000-8000-000000000003'),
  ('019aa000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta10',
    '019aa000-0000-7000-8000-000000000004'),
  ('019aa000-0000-7000-8000-000000000015', 'workos', 'https://issuer.test', 'epsilon10',
    '019aa000-0000-7000-8000-000000000005'),
  ('019aa000-0000-7000-8000-000000000016', 'workos', 'https://issuer.test', 'zeta10',
    '019aa000-0000-7000-8000-000000000006'),
  ('019aa000-0000-7000-8000-000000000017', 'workos', 'https://issuer.test', 'eta10',
    '019aa000-0000-7000-8000-000000000007');

select support.bootstrap_backoffice_administrators(
  '019aa000-0000-7000-8000-000000000001', 'alpha10',
  '019aa000-0000-7000-8000-000000000002', 'beta10',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-VERIFY-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019aa000-0000-7000-8000-000000000021', '019aa000-0000-7000-8000-000000000011',
    'sid_alpha_10', 'backoffice', decode(repeat('c1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019aa000-0000-7000-8000-000000000023', '019aa000-0000-7000-8000-000000000013',
    'sid_gamma_10', 'backoffice', decode(repeat('c3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019aa000-0000-7000-8000-000000000024', '019aa000-0000-7000-8000-000000000014',
    'sid_delta_10', 'backoffice', decode(repeat('c4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019aa000-0000-7000-8000-000000000025', '019aa000-0000-7000-8000-000000000015',
    'sid_epsilon_10', 'backoffice', decode(repeat('c5', 32), 'hex'), 'v1.epsilon',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019aa000-0000-7000-8000-000000000026', '019aa000-0000-7000-8000-000000000016',
    'sid_zeta_10', 'backoffice', decode(repeat('c6', 32), 'hex'), 'v1.zeta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019aa000-0000-7000-8000-000000000027', '019aa000-0000-7000-8000-000000000017',
    'sid_eta_10', 'backoffice', decode(repeat('c7', 32), 'hex'), 'v1.eta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

-- Every team member here holds the base role. What differs is the duty.
select support.assign_platform_role(
  '019aa000-0000-7000-8000-000000000001', '019aa000-0000-7000-8000-000000000021',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019aa000-0000-7000-8000-000000000003'::uuid, '019aa000-0000-7000-8000-000000000103'::uuid,
    '019aa000-0000-7000-8000-000000000203'::uuid, '63'),
  ('019aa000-0000-7000-8000-000000000004'::uuid, '019aa000-0000-7000-8000-000000000104'::uuid,
    '019aa000-0000-7000-8000-000000000204'::uuid, '64'),
  ('019aa000-0000-7000-8000-000000000005'::uuid, '019aa000-0000-7000-8000-000000000105'::uuid,
    '019aa000-0000-7000-8000-000000000205'::uuid, '65'),
  ('019aa000-0000-7000-8000-000000000006'::uuid, '019aa000-0000-7000-8000-000000000106'::uuid,
    '019aa000-0000-7000-8000-000000000206'::uuid, '66'),
  ('019aa000-0000-7000-8000-000000000007'::uuid, '019aa000-0000-7000-8000-000000000107'::uuid,
    '019aa000-0000-7000-8000-000000000207'::uuid, '67')
) as grant_row(person_id, key, command, hash_byte);

-- The holder also works at Allfit and holds the verification duty, so the only
-- thing stopping them from verifying their own credential is the conflict rule.
select support.assign_platform_duty(
  '019aa000-0000-7000-8000-000000000001', '019aa000-0000-7000-8000-000000000021',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-021', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019aa000-0000-7000-8000-000000000003'::uuid, 'verify_professional_credentials',
    '019aa000-0000-7000-8000-000000000113'::uuid, '019aa000-0000-7000-8000-000000000213'::uuid, '73'),
  ('019aa000-0000-7000-8000-000000000004'::uuid, 'curate_global_catalog',
    '019aa000-0000-7000-8000-000000000114'::uuid, '019aa000-0000-7000-8000-000000000214'::uuid, '74'),
  ('019aa000-0000-7000-8000-000000000005'::uuid, 'verify_professional_credentials',
    '019aa000-0000-7000-8000-000000000115'::uuid, '019aa000-0000-7000-8000-000000000215'::uuid, '75'),
  ('019aa000-0000-7000-8000-000000000006'::uuid, 'verify_professional_credentials',
    '019aa000-0000-7000-8000-000000000116'::uuid, '019aa000-0000-7000-8000-000000000216'::uuid, '76')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- The colleague and the holder both coach at the same gym.
insert into organizations.organizations (id, type_code, display_name, status, responsible_party)
values (
  '019aa000-0000-7000-8000-000000000301', 'gym', 'Shared Gym', 'active',
  '{"party_kind":"legal_entity","party_name":"Shared Gym SAS","purpose":"studio_operations"}'::jsonb
);
insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019aa000-0000-7000-8000-000000000311', '019aa000-0000-7000-8000-000000000301',
    '019aa000-0000-7000-8000-000000000005', 'active'),
  ('019aa000-0000-7000-8000-000000000312', '019aa000-0000-7000-8000-000000000301',
    '019aa000-0000-7000-8000-000000000006', 'active');

-- ---------------------------------------------------------------------------
-- The holder declares two credentials, the way Studio does
-- ---------------------------------------------------------------------------

set local role allfit_api;
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000005', true);

select * from identity.put_professional_profile(
  '019aa000-0000-7000-8000-000000000005', 'Fisioterapeuta deportiva',
  'Rehabilitación de lesiones deportivas.', 2019, array['personal_training'],
  '11111111-1111-4111-8111-111111111501', '019aa000-0000-7000-8000-000000000401',
  decode(repeat('81', 32), 'hex')
);

create temporary table license on commit drop as
select (credential->>'id')::uuid as id
from identity.declare_professional_credential(
  '019aa000-0000-7000-8000-000000000005', 'professional_license',
  'Colegio Colombiano de Fisioterapeutas', 'Tarjeta profesional', 'TP-12345',
  '2019-06-01', null, 'https://example.test/registry/TP-12345',
  '11111111-1111-4111-8111-111111111502', '019aa000-0000-7000-8000-000000000402',
  decode(repeat('82', 32), 'hex')
);

create temporary table certification on commit drop as
select (credential->>'id')::uuid as id
from identity.declare_professional_credential(
  '019aa000-0000-7000-8000-000000000005', 'professional_certification',
  'NSCA', 'Certified Strength and Conditioning Specialist', 'CSCS-777',
  '2021-01-01', '2029-01-01', 'https://example.test/nsca/CSCS-777',
  '11111111-1111-4111-8111-111111111503', '019aa000-0000-7000-8000-000000000403',
  decode(repeat('83', 32), 'hex')
);

reset role;

-- ---------------------------------------------------------------------------
-- Criterion 1 — the queue fills itself
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer
   from identity.credential_verification_requests as request
   where request.professional_credential_id = (select id from license)
     and request.status = 'pending'),
  1,
  'declaring a credential puts that exact version in the verification queue'
);

select ok(
  (select request.requested_by_person_id = '019aa000-0000-7000-8000-000000000005'
     and request.kind = 'initial'
   from identity.credential_verification_requests as request
   where request.professional_credential_id = (select id from license)),
  'the request names who asked, and it is the holder'
);

-- ---------------------------------------------------------------------------
-- Criterion 8 — the verification duty, and nothing that looks like it
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000007', true);

select throws_ok(
  $$ select * from identity.list_credential_verification_requests(
    '019aa000-0000-7000-8000-000000000007', '019aa000-0000-7000-8000-000000000027', 50
  ) $$,
  '42501',
  null,
  'the base role alone cannot open the verification queue'
);

select set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000004', true);

select throws_ok(
  $$ select * from identity.list_credential_verification_requests(
    '019aa000-0000-7000-8000-000000000004', '019aa000-0000-7000-8000-000000000024', 50
  ) $$,
  '42501',
  null,
  'the catalogue curation duty does not stand in for verification'
);

-- ---------------------------------------------------------------------------
-- The queue says who asked, what they claim and where to check it
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000003', true);

create temporary table queue on commit drop as
select * from identity.list_credential_verification_requests(
  '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023', 50
);

select is((select count(*)::integer from queue), 2, 'the verifier sees every pending request');

select ok(
  (select row.holder_given_name = 'Professional'
     and row.holder_family_name = 'Epsilon'
     and row.credential_identifier = 'TP-12345'
     and row.issuer = 'Colegio Colombiano de Fisioterapeutas'
     and row.verification_url = 'https://example.test/registry/TP-12345'
     and row.suggested_method = 'official_registry_lookup'
   from queue as row
   where row.credential_id = (select id from license)),
  'each request says who asked, what they claim, and which registry to consult'
);

select is(
  (select row.suggested_method from queue as row
   where row.credential_id = (select id from certification)),
  'issuer_confirmation',
  'a certification is confirmed with its issuer, not looked up in a registry'
);

select is(
  (select count(*)::integer
   from privacy.access_events as event
   where event.actor_person_id = '019aa000-0000-7000-8000-000000000003'
     and event.subject_person_id = '019aa000-0000-7000-8000-000000000005'
     and event.purpose = 'professional_credential_verification'),
  2,
  'reading the queue is recorded against the holder, once per credential shown'
);

-- A verifier reads under a platform duty, not under any permission the holder
-- granted. Recorded as `live`, the access log would tell an auditor the opposite.
select is(
  (select count(*)::integer
   from privacy.access_events as event
   where event.actor_person_id = '019aa000-0000-7000-8000-000000000003'
     and event.subject_person_id = '019aa000-0000-7000-8000-000000000005'
     and event.purpose = 'professional_credential_verification'
     and event.access_mode = 'support_metadata'),
  2,
  'a verifier''s read is recorded as a staff read, never as the holder''s own grant'
);

select ok(
  (select bool_and(row.viewer_can_decide) from queue as row),
  'a verifier without a conflict is offered the decision'
);

select set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000006', true);

select ok(
  not (select bool_or(row.viewer_can_decide)
       from identity.list_credential_verification_requests(
         '019aa000-0000-7000-8000-000000000006', '019aa000-0000-7000-8000-000000000026', 50
       ) as row),
  'a verifier who shares a gym with the holder is told they cannot decide'
);

-- ---------------------------------------------------------------------------
-- Criterion 8 — conflicts are checked against the data
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000005', true);

select throws_ok(
  format(
    $$ select * from identity.decide_credential_verification(
      '019aa000-0000-7000-8000-000000000005', '019aa000-0000-7000-8000-000000000025',
      %L, 'verified', 'official_registry_lookup',
      'Colegio Colombiano de Fisioterapeutas', 'CO', 'TP-12345', 'vigente',
      clock_timestamp() - interval '5 minutes', null,
      '11111111-1111-4111-8111-111111111511', '019aa000-0000-7000-8000-000000000411',
      decode(repeat('91', 32), 'hex')
    ) $$,
    (select request.id from identity.credential_verification_requests as request
     where request.professional_credential_id = (select id from license))
  ),
  '42501',
  null,
  'nobody verifies their own credential'
);

select set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000006', true);

select throws_ok(
  format(
    $$ select * from identity.decide_credential_verification(
      '019aa000-0000-7000-8000-000000000006', '019aa000-0000-7000-8000-000000000026',
      %L, 'verified', 'official_registry_lookup',
      'Colegio Colombiano de Fisioterapeutas', 'CO', 'TP-12345', 'vigente',
      clock_timestamp() - interval '5 minutes', null,
      '11111111-1111-4111-8111-111111111512', '019aa000-0000-7000-8000-000000000412',
      decode(repeat('92', 32), 'hex')
    ) $$,
    (select request.id from identity.credential_verification_requests as request
     where request.professional_credential_id = (select id from license))
  ),
  '42501',
  null,
  'a verifier who shares an active gym with the holder cannot decide'
);

-- ---------------------------------------------------------------------------
-- Criterion 5 — nothing is verified by omission
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000003', true);

create temporary table license_request on commit drop as
select request.id
from identity.credential_verification_requests as request
where request.professional_credential_id = (select id from license);

select throws_ok(
  format(
    $$ select * from identity.decide_credential_verification(
      '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023',
      %L, 'verified', 'document_upload',
      'Colegio Colombiano de Fisioterapeutas', 'CO', 'TP-12345', 'vigente',
      clock_timestamp() - interval '5 minutes', null,
      '11111111-1111-4111-8111-111111111513', '019aa000-0000-7000-8000-000000000413',
      decode(repeat('93', 32), 'hex')
    ) $$,
    (select id from license_request)
  ),
  '22023',
  null,
  'a method outside the closed set is refused'
);

select throws_ok(
  format(
    $$ select * from identity.decide_credential_verification(
      '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023',
      %L, null, 'official_registry_lookup',
      'Colegio Colombiano de Fisioterapeutas', 'CO', 'TP-12345', 'vigente',
      clock_timestamp() - interval '5 minutes', null,
      '11111111-1111-4111-8111-111111111514', '019aa000-0000-7000-8000-000000000414',
      decode(repeat('94', 32), 'hex')
    ) $$,
    (select id from license_request)
  ),
  '22023',
  null,
  'there is no default result, so nothing is verified by omission'
);

select throws_ok(
  format(
    $$ select * from identity.decide_credential_verification(
      '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023',
      %L, 'verified', 'official_registry_lookup',
      'Colegio Colombiano de Fisioterapeutas', 'CO', 'TP-12345', 'vencida',
      clock_timestamp() - interval '5 minutes', clock_timestamp() - interval '1 day',
      '11111111-1111-4111-8111-111111111515', '019aa000-0000-7000-8000-000000000415',
      decode(repeat('95', 32), 'hex')
    ) $$,
    (select id from license_request)
  ),
  '22023',
  null,
  'a source that says the credential lapsed cannot produce verified'
);

-- ---------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------

create temporary table license_decision on commit drop as
select *
from identity.decide_credential_verification(
  '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023',
  (select id from license_request), 'verified', 'official_registry_lookup',
  'Colegio Colombiano de Fisioterapeutas', 'CO', 'TP-12345', 'vigente',
  clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '3 months',
  '11111111-1111-4111-8111-111111111516', '019aa000-0000-7000-8000-000000000416',
  decode(repeat('96', 32), 'hex')
);

select ok(
  (select not decision.replayed
     and decision.result->>'status' = 'resolved'
     and decision.result #>> '{verification,result}' = 'verified'
   from license_decision as decision),
  'the verifier records a verification and the request is resolved'
);

-- Criterion 4. The validity is derived, never accepted, so it cannot outlast the
-- source or twelve months.
select ok(
  (select verification.valid_to <= verification.decided_at + interval '12 months'
     and verification.valid_to <= verification.source_valid_to
   from identity.professional_credential_verifications as verification
   where verification.request_id = (select id from license_request)),
  'the validity never outlasts the source or twelve months'
);

-- Criterion 2. What comes back is the outcome, not the evidence.
select ok(
  (select not (decision.result ? 'evidence_fingerprint')
     and not (decision.result->'verification' ? 'evidence_fingerprint')
     and not (decision.result->'verification' ? 'source_reference')
   from license_decision as decision),
  'the decision hands back neither the evidence fingerprint nor the registry reference'
);

-- Criterion 6.
select ok(
  identity.professional_credential_projection((select id from license))
    #>> '{verification,state}' = 'verified'
  and identity.professional_credential_projection((select id from license))
    #>> '{verification,valid_to}' is not null,
  'the holder sees that the credential is verified, and until when'
);

-- Criterion 3.
select is(
  identity.professional_credential_projection((select id from certification))
    #>> '{verification,state}',
  'unverified',
  'verifying one credential marks nothing else as verified'
);

select ok(
  (select decision.replayed
   from identity.decide_credential_verification(
     '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023',
     (select id from license_request), 'verified', 'official_registry_lookup',
     'Colegio Colombiano de Fisioterapeutas', 'CO', 'TP-12345', 'vigente',
     clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '3 months',
     '11111111-1111-4111-8111-111111111516', '019aa000-0000-7000-8000-000000000416',
     decode(repeat('96', 32), 'hex')
   ) as decision)
  and (select count(*) = 1
       from identity.professional_credential_verifications as verification
       where verification.request_id = (select id from license_request)),
  'a replayed decision converges instead of recording twice'
);

select throws_ok(
  format(
    $$ select * from identity.decide_credential_verification(
      '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023',
      %L, 'rejected', 'official_registry_lookup',
      'Colegio Colombiano de Fisioterapeutas', 'CO', 'TP-12345', 'no encontrada',
      clock_timestamp() - interval '5 minutes', null,
      '11111111-1111-4111-8111-111111111517', '019aa000-0000-7000-8000-000000000417',
      decode(repeat('97', 32), 'hex')
    ) $$,
    (select id from license_request)
  ),
  '55000',
  null,
  'a decided request does not take a second decision'
);

-- Criterion 5 — insufficient evidence is a result, with no validity at all.
select * from identity.decide_credential_verification(
  '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023',
  (select request.id from identity.credential_verification_requests as request
   where request.professional_credential_id = (select id from certification)),
  'unverifiable', 'issuer_confirmation', 'NSCA', 'US', 'sin respuesta', 'sin respuesta',
  clock_timestamp() - interval '5 minutes', null,
  '11111111-1111-4111-8111-111111111518', '019aa000-0000-7000-8000-000000000418',
  decode(repeat('98', 32), 'hex')
);

select ok(
  (select verification.result = 'unverifiable'
     and verification.valid_from is null
     and verification.valid_to is null
   from identity.professional_credential_verifications as verification
   where verification.professional_credential_id = (select id from certification)),
  'insufficient evidence is recorded as unverifiable, with no validity'
);

-- ---------------------------------------------------------------------------
-- Criterion 7 — a revision gets its own review, the old one stays intact
-- ---------------------------------------------------------------------------

set local role allfit_api;
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000005', true);

create temporary table revised on commit drop as
select (credential->>'id')::uuid as id
from identity.revise_professional_credential(
  '019aa000-0000-7000-8000-000000000005', (select id from license), 'professional_license',
  'Colegio Colombiano de Fisioterapeutas', 'Tarjeta profesional de fisioterapia', 'TP-12345',
  '2019-06-01', null, 'https://example.test/registry/TP-12345',
  '11111111-1111-4111-8111-111111111521', '019aa000-0000-7000-8000-000000000421',
  decode(repeat('a1', 32), 'hex')
);

reset role;

select is(
  (select count(*)::integer
   from identity.professional_credential_verifications as verification
   where verification.professional_credential_id = (select id from license)
     and verification.result = 'verified'),
  1,
  'the earlier verification is left exactly as it was'
);

select is(
  (select count(*)::integer
   from identity.credential_verification_requests as request
   where request.professional_credential_id = (select id from revised)
     and request.status = 'pending'),
  1,
  'the revised version opens a review of its own'
);

select is(
  identity.professional_credential_projection((select id from revised))
    #>> '{verification,state}',
  'unverified',
  'a new version does not inherit the verification'
);

-- Criterion 7 says the earlier event stays intact. A count cannot prove that, so
-- the rewrite itself is attempted.
select throws_ok(
  $$ update identity.professional_credential_verifications
     set result = 'rejected'
     where professional_credential_id = (select id from license) $$,
  '55000',
  null,
  'a recorded verification cannot be rewritten'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000005', true);

select * from identity.retire_professional_credential(
  '019aa000-0000-7000-8000-000000000005', (select id from revised),
  '11111111-1111-4111-8111-111111111522', '019aa000-0000-7000-8000-000000000422',
  decode(repeat('a2', 32), 'hex')
);

reset role;

select is(
  (select request.status
   from identity.credential_verification_requests as request
   where request.professional_credential_id = (select id from revised)),
  'cancelled',
  'retiring a credential withdraws its pending review'
);

-- ---------------------------------------------------------------------------
-- Criterion 4 — a lapsed verification comes back as a renewal
-- ---------------------------------------------------------------------------

set local role allfit_api;
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000005', true);

create temporary table degree on commit drop as
select (credential->>'id')::uuid as id
from identity.declare_professional_credential(
  '019aa000-0000-7000-8000-000000000005', 'academic_degree',
  'Universidad Nacional', 'Fisioterapia', null, '2018-12-01', null, null,
  '11111111-1111-4111-8111-111111111531', '019aa000-0000-7000-8000-000000000431',
  decode(repeat('b1', 32), 'hex')
);

reset role;

-- A cycle that happened a year ago: the degree was verified, and it lapsed.
update identity.credential_verification_requests
set status = 'resolved', resolved_at = clock_timestamp() - interval '13 months'
where professional_credential_id = (select id from degree);

insert into identity.professional_credential_verifications (
  professional_credential_id, request_id, verifier_person_id, policy_code, method,
  source_authority, source_jurisdiction, source_reference, source_status,
  source_checked_at, evidence_fingerprint, result, decided_at, valid_from, valid_to
) values (
  (select id from degree),
  (select request.id from identity.credential_verification_requests as request
   where request.professional_credential_id = (select id from degree)),
  '019aa000-0000-7000-8000-000000000003', 'professional_credential.issuer.v1',
  'issuer_confirmation', 'Universidad Nacional', 'CO', 'REG-2025-01', 'vigente',
  clock_timestamp() - interval '13 months', decode(repeat('ee', 32), 'hex'), 'verified',
  clock_timestamp() - interval '13 months', clock_timestamp() - interval '13 months',
  clock_timestamp() - interval '1 month'
);

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019aa000-0000-7000-8000-000000000003', true);

select is(
  (select count(*)::integer
   from identity.list_due_credential_renewals(
     '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023', 50
   ) as due
   where due.credential_id = (select id from degree)),
  1,
  'a verification that has lapsed comes back to the queue as a renewal'
);

select * from identity.open_credential_verification_renewal(
  '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023',
  (select id from degree),
  '11111111-1111-4111-8111-111111111532', '019aa000-0000-7000-8000-000000000432',
  decode(repeat('b2', 32), 'hex')
);

select ok(
  (select count(*) = 1
   from identity.credential_verification_requests as request
   where request.professional_credential_id = (select id from degree)
     and request.status = 'pending'
     and request.kind = 'renewal'
     and request.supersedes_request_id is not null)
  and (select count(*) = 0
       from identity.list_due_credential_renewals(
         '019aa000-0000-7000-8000-000000000003', '019aa000-0000-7000-8000-000000000023', 50
       ) as due
       where due.credential_id = (select id from degree)),
  'renewing opens a new request linked to the old one, and it leaves the due list'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 and grants — structure
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer
   from information_schema.columns as column_row
   where column_row.table_schema = 'identity'
     and column_row.table_name in (
       'credential_verification_requests', 'professional_credential_verifications'
     )
     and (
       (column_row.data_type = 'bytea' and column_row.column_name <> 'evidence_fingerprint')
       or column_row.column_name ~ '(document|file|attachment|upload|image|scan)'
     )),
  0,
  'there is nowhere to store a copy of a document'
);

select ok(
  has_function_privilege(
    'allfit_api', 'identity.list_credential_verification_requests(uuid,uuid,integer)', 'EXECUTE'
  )
    and has_function_privilege(
      'allfit_api',
      'identity.decide_credential_verification(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid,bytea)',
      'EXECUTE'
    )
    and has_function_privilege(
      'allfit_api', 'identity.list_due_credential_renewals(uuid,uuid,integer)', 'EXECUTE'
    )
    and has_function_privilege(
      'allfit_api',
      'identity.open_credential_verification_renewal(uuid,uuid,uuid,uuid,uuid,bytea)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'allfit_api', 'identity.require_credential_verifier(uuid,uuid)', 'EXECUTE'
    )
    and not has_table_privilege('allfit_api', 'identity.credential_verification_requests', 'INSERT')
    and not has_table_privilege('allfit_api', 'identity.credential_verification_requests', 'UPDATE')
    and not has_table_privilege(
      'allfit_api', 'identity.professional_credential_verifications', 'INSERT'
    ),
  'the runtime role runs the four operations and never the guard or the tables'
);

select * from finish();
rollback;
