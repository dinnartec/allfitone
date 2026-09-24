-- T-PRV-HOLD-01 — PR-013 / OP-PRV-009 + OP-PRV-010: suspending a disposition.
--
-- `HU-BO-033`. A legal hold is the one thing in this system that stops a person's
-- erasure from running, so the file is mostly about the limits on it.
--
-- **There are no indefinite holds.** `valid_to` is not nullable, it has to be in
-- the future, and a hold that lapses is still a hold somebody has to release:
-- nothing here quietly resumes a disposition on a date.
--
-- **A hold suspends, it does not reveal.** Applying one returns the hold, never
-- the data it protects, and it grants nothing: the same officer reading that
-- person's file still needs a break-glass window.
--
-- **Whoever asked to look cannot decide to keep.** An officer who requested or
-- approved a break-glass window over a person is refused a hold over that same
-- person's data. Concentrating "let me see it" and "nobody may delete it" in one
-- pair of hands is the failure this rule exists to prevent.
--
-- Releasing puts the item back where it was — `pending` — and nowhere else. It
-- does not execute the disposition, because deciding to delete is not the
-- reviewer's call to make on somebody else's behalf.

begin;

select plan(38);

-- ---------------------------------------------------------------------------
-- People, sessions, roles and duties
-- ---------------------------------------------------------------------------

insert into identity.people (id, given_name, family_name, status)
values
  ('019ae000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019ae000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019ae000-0000-7000-8000-000000000003', 'Officer', 'Gamma', 'active'),
  ('019ae000-0000-7000-8000-000000000004', 'Operator', 'Delta', 'active'),
  ('019ae000-0000-7000-8000-000000000005', 'Subject', 'Zeta', 'active'),
  ('019ae000-0000-7000-8000-000000000006', 'Subject', 'Eta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019ae000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alphaH', null),
  ('019ae000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'betaH', null),
  ('019ae000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gammaH',
    '019ae000-0000-7000-8000-000000000003'),
  ('019ae000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'deltaH',
    '019ae000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019ae000-0000-7000-8000-000000000001', 'alphaH',
  '019ae000-0000-7000-8000-000000000002', 'betaH',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-HOLD-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019ae000-0000-7000-8000-000000000021', '019ae000-0000-7000-8000-000000000011',
    'sid_alpha_h', 'backoffice', decode(repeat('e1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ae000-0000-7000-8000-000000000023', '019ae000-0000-7000-8000-000000000013',
    'sid_gamma_h', 'backoffice', decode(repeat('e3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ae000-0000-7000-8000-000000000025', '019ae000-0000-7000-8000-000000000014',
    'sid_delta_h', 'backoffice', decode(repeat('e5', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000021',
  '019ae000-0000-7000-8000-000000000003', 'allfit_admin',
  '019ae000-0000-7000-8000-000000000101', '019ae000-0000-7000-8000-000000000201',
  decode(repeat('71', 32), 'hex')
);
select support.assign_platform_role(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000021',
  '019ae000-0000-7000-8000-000000000004', 'allfit_admin',
  '019ae000-0000-7000-8000-000000000102', '019ae000-0000-7000-8000-000000000202',
  decode(repeat('72', 32), 'hex')
);

-- ---------------------------------------------------------------------------
-- Two people with a disposition waiting on somebody
-- ---------------------------------------------------------------------------

insert into identity.body_progress_records (
  id, person_id, metric_code, value_numeric, unit_code, measured_on
) values
  ('019ae000-0000-7000-8000-000000000301', '019ae000-0000-7000-8000-000000000005',
    'weight', 70, 'kg', date '2026-09-01'),
  ('019ae000-0000-7000-8000-000000000302', '019ae000-0000-7000-8000-000000000005',
    'waist', 0.8, 'm', date '2026-09-01'),
  ('019ae000-0000-7000-8000-000000000303', '019ae000-0000-7000-8000-000000000006',
    'weight', 80, 'kg', date '2026-09-02'),
  ('019ae000-0000-7000-8000-000000000304', '019ae000-0000-7000-8000-000000000006',
    'hip', 0.9, 'm', date '2026-09-02');

insert into privacy.disposition_cases (
  id, subject_person_id, origin, status, requested_by_person_id, opened_at
) values
  ('019ae000-0000-7000-8000-000000000501', '019ae000-0000-7000-8000-000000000005',
    'request', 'open', '019ae000-0000-7000-8000-000000000005',
    clock_timestamp() - interval '2 days'),
  ('019ae000-0000-7000-8000-000000000502', '019ae000-0000-7000-8000-000000000006',
    'request', 'open', '019ae000-0000-7000-8000-000000000006',
    clock_timestamp() - interval '1 day');

insert into privacy.disposition_items (
  id, disposition_case_id, subject_person_id, data_classification_code,
  retention_policy_id, action, status, target_kind, target_body_progress_id
) values
  ('019ae000-0000-7000-8000-000000000601', '019ae000-0000-7000-8000-000000000501',
    '019ae000-0000-7000-8000-000000000005', 'body',
    (select id from privacy.retention_policies
      where data_classification_code = 'body' and jurisdiction = 'CO'
      order by version_number desc limit 1),
    'delete', 'pending', 'body_progress', '019ae000-0000-7000-8000-000000000301'),
  ('019ae000-0000-7000-8000-000000000602', '019ae000-0000-7000-8000-000000000501',
    '019ae000-0000-7000-8000-000000000005', 'body',
    (select id from privacy.retention_policies
      where data_classification_code = 'body' and jurisdiction = 'CO'
      order by version_number desc limit 1),
    'delete', 'pending', 'body_progress', '019ae000-0000-7000-8000-000000000302'),
  ('019ae000-0000-7000-8000-000000000603', '019ae000-0000-7000-8000-000000000502',
    '019ae000-0000-7000-8000-000000000006', 'body',
    (select id from privacy.retention_policies
      where data_classification_code = 'body' and jurisdiction = 'CO'
      order by version_number desc limit 1),
    'delete', 'pending', 'body_progress', '019ae000-0000-7000-8000-000000000303'),
  ('019ae000-0000-7000-8000-000000000604', '019ae000-0000-7000-8000-000000000502',
    '019ae000-0000-7000-8000-000000000006', 'body',
    (select id from privacy.retention_policies
      where data_classification_code = 'body' and jurisdiction = 'CO'
      order by version_number desc limit 1),
    'delete', 'pending', 'body_progress', '019ae000-0000-7000-8000-000000000304');

-- ---------------------------------------------------------------------------
-- Criterion 5 — the duty, and only the duty
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000025',
    'Mediciones de la persona en el expediente 2026-114', 'judicial_order',
    'JUZGADO-2026-114', clock_timestamp() + interval '90 days',
    array['019ae000-0000-7000-8000-000000000601']::uuid[],
    '019ae000-0000-4000-8000-000000000901', '019ae000-0000-7000-8000-000000000a01',
    decode(repeat('81', 32), 'hex')
  ) $$,
  '42501',
  null,
  'the platform administrator role alone cannot suspend a disposition'
);

select support.assign_platform_duty(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000021',
  '019ae000-0000-7000-8000-000000000003', 'manage_privacy_requests',
  clock_timestamp(), clock_timestamp() + interval '7 days', 'CASE-HOLD-GAMMA',
  '019ae000-0000-7000-8000-000000000103', '019ae000-0000-7000-8000-000000000203',
  decode(repeat('73', 32), 'hex')
);

-- ---------------------------------------------------------------------------
-- Criterion 1 — scope, reason, vigency and who answers for it
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    'Mediciones', 'judicial_order', 'JUZGADO-2026-114',
    clock_timestamp() - interval '1 day',
    array['019ae000-0000-7000-8000-000000000601']::uuid[],
    '019ae000-0000-4000-8000-000000000902', '019ae000-0000-7000-8000-000000000a02',
    decode(repeat('82', 32), 'hex')
  ) $$,
  '23514',
  null,
  'a hold that ends before it starts is refused'
);

select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    'Mediciones', 'porque_si', 'JUZGADO-2026-114',
    clock_timestamp() + interval '90 days',
    array['019ae000-0000-7000-8000-000000000601']::uuid[],
    '019ae000-0000-4000-8000-000000000903', '019ae000-0000-7000-8000-000000000a03',
    decode(repeat('83', 32), 'hex')
  ) $$,
  '23514',
  null,
  'the reason comes from a closed list, not from a sentence somebody typed'
);

select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    '   ', 'judicial_order', 'JUZGADO-2026-114', clock_timestamp() + interval '90 days',
    array['019ae000-0000-7000-8000-000000000601']::uuid[],
    '019ae000-0000-4000-8000-000000000904', '019ae000-0000-7000-8000-000000000a04',
    decode(repeat('84', 32), 'hex')
  ) $$,
  '23514',
  null,
  'a hold without a scope in words is refused'
);

select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    'Mediciones', 'judicial_order', 'JUZGADO-2026-114',
    clock_timestamp() + interval '90 days', array[]::uuid[],
    '019ae000-0000-4000-8000-000000000905', '019ae000-0000-7000-8000-000000000a05',
    decode(repeat('85', 32), 'hex')
  ) $$,
  '22023',
  null,
  'a hold over nothing in particular is refused'
);

-- ---------------------------------------------------------------------------
-- Applying one
-- ---------------------------------------------------------------------------

create temporary table applied on commit drop as
select * from privacy.apply_legal_hold(
  '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
  'Mediciones de la persona en el expediente 2026-114', 'judicial_order',
  'JUZGADO-2026-114', clock_timestamp() + interval '90 days',
  array[
    '019ae000-0000-7000-8000-000000000601',
    '019ae000-0000-7000-8000-000000000602'
  ]::uuid[],
  '019ae000-0000-4000-8000-000000000906', '019ae000-0000-7000-8000-000000000a06',
  decode(repeat('86', 32), 'hex')
);

select is(
  (select (result->>'status') from applied),
  'active',
  'the hold exists and is active'
);

select is(
  (select (result->>'suspended_items')::int from applied),
  2,
  'and it says how many dispositions it stopped'
);

select is(
  (select count(*)::int from privacy.disposition_items
    where id in (
      '019ae000-0000-7000-8000-000000000601', '019ae000-0000-7000-8000-000000000602'
    ) and status = 'suspended'),
  2,
  'the dispositions it names stop waiting their turn'
);

select is(
  (select status::text from privacy.disposition_items
    where id = '019ae000-0000-7000-8000-000000000603'),
  'pending',
  'and nothing outside its scope is touched'
);

select is(
  (select count(*)::int from privacy.hold_applications
    where legal_hold_id = (select (result->>'id')::uuid from applied) and status = 'active'),
  2,
  'each suspended disposition records which hold stopped it'
);

-- Criterion 2 — a hold suspends; it reveals nothing.
select is(
  (select array_agg(field order by field) from applied, jsonb_object_keys(result) as field),
  array[
    'applied_by_person_id', 'case_reference', 'id', 'items', 'reason_code',
    'released_at', 'released_by_person_id', 'scope_description', 'status',
    'suspended_items', 'valid_from', 'valid_to'
  ]::text[],
  'the answer carries the hold and no field of the data it protects'
);

select is(
  (select count(*)::int from privacy.access_events
    where actor_person_id = '019ae000-0000-7000-8000-000000000003'),
  0,
  'suspending reads nothing, so it records no access'
);

select is(
  (select count(*)::int from system.outbox_events
    where event_type = 'privacy.legal_hold_applied.v1'
      and aggregate_id = (select (result->>'id')::uuid from applied)),
  1,
  'and the platform hears that a disposition was suspended'
);

select is(
  (select (payload ? 'subject_person_id')::boolean from system.outbox_events
    where event_type = 'privacy.legal_hold_applied.v1'
      and aggregate_id = (select (result->>'id')::uuid from applied)),
  false,
  'the event carries identifiers of the hold, not of whose data it is'
);

-- ---------------------------------------------------------------------------
-- What the panel says about a held disposition
-- ---------------------------------------------------------------------------

create temporary table held_panel on commit drop as
select category
from privacy.erasure_request_categories('019ae000-0000-7000-8000-000000000501') as categories,
  jsonb_array_elements(categories) as category
where category->>'status' = 'suspended';

select is(
  (select (category->>'items')::int from held_panel),
  2,
  'the panel reports the held categories as suspended, not as pending work'
);

select is(
  (select category->'hold'->>'reason_code' from held_panel),
  'judicial_order',
  'and says on what ground they are held'
);

select is(
  (select date_trunc('day', (category->'hold'->>'valid_to')::timestamptz) from held_panel),
  date_trunc('day', clock_timestamp() + interval '90 days'),
  'and until when, so nobody has to open the hold to find out'
);

-- ---------------------------------------------------------------------------
-- What a second hold cannot do
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    'Otra vez lo mismo', 'regulatory_request', 'SIC-2026-9',
    clock_timestamp() + interval '30 days',
    array['019ae000-0000-7000-8000-000000000601']::uuid[],
    '019ae000-0000-4000-8000-000000000907', '019ae000-0000-7000-8000-000000000a07',
    decode(repeat('87', 32), 'hex')
  ) $$,
  '23505',
  null,
  'one disposition is held by one hold, so the second says so instead of hiding'
);

-- An executed disposition is over; there is nothing left to suspend.
select privacy.log_disposition_event(
  '019ae000-0000-7000-8000-000000000603', 'delete', 'deleted', 'privacy_worker'
);
update privacy.disposition_items
set status = 'executed', executed_at = clock_timestamp(), target_body_progress_id = null
where id = '019ae000-0000-7000-8000-000000000603';

select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    'Lo que ya se borró', 'judicial_order', 'JUZGADO-2026-200',
    clock_timestamp() + interval '30 days',
    array['019ae000-0000-7000-8000-000000000603']::uuid[],
    '019ae000-0000-4000-8000-000000000908', '019ae000-0000-7000-8000-000000000a08',
    decode(repeat('88', 32), 'hex')
  ) $$,
  '55000',
  null,
  'what has already been disposed of cannot be held'
);

select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    'Algo que no existe', 'judicial_order', 'JUZGADO-2026-201',
    clock_timestamp() + interval '30 days',
    array['019ae000-0000-7000-8000-000000000999']::uuid[],
    '019ae000-0000-4000-8000-000000000909', '019ae000-0000-7000-8000-000000000a09',
    decode(repeat('89', 32), 'hex')
  ) $$,
  'P0002',
  null,
  'a hold over a disposition that does not exist is refused, not silently empty'
);

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------

create temporary table replayed on commit drop as
select * from privacy.apply_legal_hold(
  '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
  'Mediciones de la persona en el expediente 2026-114', 'judicial_order',
  'JUZGADO-2026-114', clock_timestamp() + interval '90 days',
  array[
    '019ae000-0000-7000-8000-000000000601',
    '019ae000-0000-7000-8000-000000000602'
  ]::uuid[],
  '019ae000-0000-4000-8000-000000000906', '019ae000-0000-7000-8000-000000000a06',
  decode(repeat('86', 32), 'hex')
);

select is(
  (select replayed from replayed),
  true,
  'the same command under the same key is a replay'
);

select is(
  (select (result->>'id') from replayed),
  (select (result->>'id') from applied),
  'and it answers the hold that already exists'
);

select is(
  (select count(*)::int from privacy.legal_holds
    where case_reference = 'JUZGADO-2026-114'),
  1,
  'so a retried request never files a second hold'
);

-- ---------------------------------------------------------------------------
-- Criterion 5 — whoever asked to look cannot decide to keep
-- ---------------------------------------------------------------------------

select support.assign_platform_duty(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000021',
  '019ae000-0000-7000-8000-000000000004', 'manage_privacy_requests',
  clock_timestamp(), clock_timestamp() + interval '7 days', 'CASE-HOLD-DELTA',
  '019ae000-0000-7000-8000-000000000104', '019ae000-0000-7000-8000-000000000204',
  decode(repeat('74', 32), 'hex')
);

select support.assign_platform_duty(
  '019ae000-0000-7000-8000-000000000001', '019ae000-0000-7000-8000-000000000021',
  '019ae000-0000-7000-8000-000000000004', 'request_break_glass',
  clock_timestamp(), clock_timestamp() + interval '7 days', 'CASE-2026-500',
  '019ae000-0000-7000-8000-000000000105', '019ae000-0000-7000-8000-000000000205',
  decode(repeat('75', 32), 'hex')
);

-- The window is opened as the support actor, the way the API opens one.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019ae000-0000-7000-8000-000000000004', true);

select support.request_break_glass(
  '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000025',
  '019ae000-0000-7000-8000-000000000006', array['prior_training_history'],
  'service_dispute', 'CASE-2026-500',
  '019ae000-0000-4000-8000-0000000009a1', '019ae000-0000-7000-8000-000000000b01',
  decode(repeat('91', 32), 'hex')
);

-- Delta asked to look at Eta's file, so Delta cannot be the one who freezes it.
select throws_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000025',
    'Datos de la persona del caso 500', 'service_dispute', 'CASE-2026-500',
    clock_timestamp() + interval '30 days',
    array['019ae000-0000-7000-8000-000000000604']::uuid[],
    '019ae000-0000-4000-8000-00000000090a', '019ae000-0000-7000-8000-000000000a0a',
    decode(repeat('8a', 32), 'hex')
  ) $$,
  'AF403',
  null,
  'whoever asked for an exceptional read of that person cannot hold their data'
);

-- And the officer who never asked still can.
select lives_ok(
  $$ select * from privacy.apply_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    'Mediciones de la otra persona', 'regulatory_request', 'SIC-2026-9',
    clock_timestamp() + interval '30 days',
    array['019ae000-0000-7000-8000-000000000604']::uuid[],
    '019ae000-0000-4000-8000-00000000090b', '019ae000-0000-7000-8000-000000000a0b',
    decode(repeat('8b', 32), 'hex')
  ) $$,
  'an officer with no interest in that person may hold it'
);

-- ---------------------------------------------------------------------------
-- Criterion 4 — releasing puts the disposition back in the queue
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from privacy.release_legal_hold(
    '019ae000-0000-7000-8000-000000000004', '019ae000-0000-7000-8000-000000000025',
    (select id from privacy.legal_holds where case_reference = 'SIC-2026-9'),
    '019ae000-0000-4000-8000-00000000090c', '019ae000-0000-7000-8000-000000000a0c',
    decode(repeat('8c', 32), 'hex')
  ) $$,
  'AF403',
  null,
  'whoever asked for an exceptional read cannot release the hold either'
);

create temporary table released on commit drop as
select * from privacy.release_legal_hold(
  '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
  (select (result->>'id')::uuid from applied),
  '019ae000-0000-4000-8000-00000000090d', '019ae000-0000-7000-8000-000000000a0d',
  decode(repeat('8d', 32), 'hex')
);

select is(
  (select (result->>'status') from released),
  'released',
  'a released hold says so'
);

select isnt(
  (select (result->>'released_at') from released),
  null,
  'and says when it was released'
);

select is(
  (select count(*)::int from privacy.disposition_items
    where id in (
      '019ae000-0000-7000-8000-000000000601', '019ae000-0000-7000-8000-000000000602'
    ) and status = 'pending'),
  2,
  'the disposition goes back to waiting its turn, and no further'
);

select is(
  (select count(*)::int from privacy.disposition_items
    where id in (
      '019ae000-0000-7000-8000-000000000601', '019ae000-0000-7000-8000-000000000602'
    ) and status = 'executed'),
  0,
  'releasing a hold never executes what it was holding'
);

select is(
  (select count(*)::int from privacy.hold_applications
    where legal_hold_id = (select (result->>'id')::uuid from applied) and status = 'active'),
  0,
  'and no application is left saying it still holds something'
);

select is(
  (select count(*)::int from system.outbox_events
    where event_type = 'privacy.legal_hold_released.v1'
      and aggregate_id = (select (result->>'id')::uuid from applied)),
  1,
  'the platform hears that the disposition may continue'
);

select throws_ok(
  $$ select * from privacy.release_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    (select (result->>'id')::uuid from applied),
    '019ae000-0000-4000-8000-00000000090e', '019ae000-0000-7000-8000-000000000a0e',
    decode(repeat('8e', 32), 'hex')
  ) $$,
  '55000',
  null,
  'a hold is released once; the second attempt says so instead of pretending'
);

select throws_ok(
  $$ select * from privacy.release_legal_hold(
    '019ae000-0000-7000-8000-000000000003', '019ae000-0000-7000-8000-000000000023',
    '019ae000-0000-7000-8000-000000000fff',
    '019ae000-0000-4000-8000-00000000090f', '019ae000-0000-7000-8000-000000000a0f',
    decode(repeat('8f', 32), 'hex')
  ) $$,
  'P0002',
  null,
  'releasing a hold that does not exist is refused'
);

-- ---------------------------------------------------------------------------
-- What the officer sees afterwards
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from privacy.legal_holds
    where status = 'released' and released_by_person_id = '019ae000-0000-7000-8000-000000000003'),
  1,
  'the hold records who released it, not only that it was released'
);

select is(
  (select applied_by_person_id from privacy.legal_holds
    where id = (select (result->>'id')::uuid from applied)),
  '019ae000-0000-7000-8000-000000000003'::uuid,
  'and who applied it, taken from the session and never from the request'
);

select ok(
  (select valid_to > clock_timestamp() from privacy.legal_holds
    where id = (select (result->>'id')::uuid from applied)),
  'every hold carries an end date, because indefinite holds do not exist'
);

select is(
  (select count(*)::int from privacy.legal_holds where valid_to is null),
  0,
  'and the column will not hold one either'
);

select * from finish();

rollback;
