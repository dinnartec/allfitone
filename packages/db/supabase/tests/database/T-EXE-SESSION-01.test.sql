-- T-EXE-SESSION-01 — OP-EXE-004, OP-EXE-005, OP-EXE-006, OP-EXE-014, OP-EXE-015 and
-- OP-SUP-003 over a person's own sessions (`HU-SP-052`, `HU-SP-055`, `HU-SP-056`, `HU-SP-057`,
-- `HU-BO-008`).
--
-- **A free session is the person's.** Space starts it under the published default result
-- contract of its activity type, replaces its results under the revision the device last saw,
-- and finishes it. Until ADR-013 fixes how minimums are written, a finished session is
-- `completed` with its validation `pending` and no certified level: nothing pretends to have
-- checked what no rule describes.
--
-- **Support reads it only through a standard window for prior training history.**

begin;

select plan(64);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b8000-0000-7000-8000-000000000001', 'Subject', 'Training', 'active'),
  ('019b8000-0000-7000-8000-000000000002', 'Other', 'Training', 'active'),
  ('019b8000-0000-7000-8000-000000000003', 'Closed', 'Training', 'closed'),
  ('019b8000-0000-7000-8000-000000000011', 'Manager', 'Alpha', 'active'),
  ('019b8000-0000-7000-8000-000000000012', 'Manager', 'Beta', 'active'),
  ('019b8000-0000-7000-8000-000000000013', 'Requester', 'Gamma', 'active'),
  ('019b8000-0000-7000-8000-000000000014', 'Approver', 'Delta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b8000-0000-7000-8000-000000000101', 'workos', 'https://issuer.test', 'subject_training',
    '019b8000-0000-7000-8000-000000000001'),
  ('019b8000-0000-7000-8000-000000000102', 'workos', 'https://issuer.test', 'other_training',
    '019b8000-0000-7000-8000-000000000002'),
  ('019b8000-0000-7000-8000-000000000103', 'workos', 'https://issuer.test', 'closed_training',
    '019b8000-0000-7000-8000-000000000003'),
  ('019b8000-0000-7000-8000-000000000111', 'workos', 'https://issuer.test', 'alpha_training', null),
  ('019b8000-0000-7000-8000-000000000112', 'workos', 'https://issuer.test', 'beta_training', null),
  ('019b8000-0000-7000-8000-000000000113', 'workos', 'https://issuer.test', 'gamma_training',
    '019b8000-0000-7000-8000-000000000013'),
  ('019b8000-0000-7000-8000-000000000114', 'workos', 'https://issuer.test', 'delta_training',
    '019b8000-0000-7000-8000-000000000014');

select support.bootstrap_backoffice_administrators(
  '019b8000-0000-7000-8000-000000000011', 'alpha_training',
  '019b8000-0000-7000-8000-000000000012', 'beta_training',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-TRAINING-01'
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
  ('019b8000-0000-7000-8000-000000000211'::uuid, '019b8000-0000-7000-8000-000000000111'::uuid,
    'alpha_training', 'e1'),
  ('019b8000-0000-7000-8000-000000000213'::uuid, '019b8000-0000-7000-8000-000000000113'::uuid,
    'gamma_training', 'e3'),
  ('019b8000-0000-7000-8000-000000000214'::uuid, '019b8000-0000-7000-8000-000000000114'::uuid,
    'delta_training', 'e4')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b8000-0000-7000-8000-000000000011', '019b8000-0000-7000-8000-000000000211',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b8000-0000-7000-8000-000000000013'::uuid, '019b8000-0000-7000-8000-000000000313'::uuid,
    '019b8000-0000-7000-8000-000000000413'::uuid, 'f3'),
  ('019b8000-0000-7000-8000-000000000014'::uuid, '019b8000-0000-7000-8000-000000000314'::uuid,
    '019b8000-0000-7000-8000-000000000414'::uuid, 'f4')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019b8000-0000-7000-8000-000000000011', '019b8000-0000-7000-8000-000000000211',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-012', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b8000-0000-7000-8000-000000000013'::uuid, 'request_break_glass',
    '019b8000-0000-7000-8000-000000000323'::uuid, '019b8000-0000-7000-8000-000000000423'::uuid, 'a3'),
  ('019b8000-0000-7000-8000-000000000014'::uuid, 'approve_break_glass',
    '019b8000-0000-7000-8000-000000000324'::uuid, '019b8000-0000-7000-8000-000000000424'::uuid, 'a4')
) as duty_row(person_id, duty_code, key, command, hash_byte);

-- A global movement, a draft activity type and one with no contract, beside the seeded ones.
insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019b8000-0000-7000-8000-000000000601', 'test_strength', 'Sentadilla', 'sentadilla',
  'global', 'published');

insert into catalog.activity_types (id, discipline_code, code, name, status)
values
  ('019b8000-0000-7000-8000-000000000611', 'test_strength', 'draft_training_session',
    'Sesión en borrador', 'draft'),
  ('019b8000-0000-7000-8000-000000000612', 'test_strength', 'uncontracted_session',
    'Sesión sin contrato', 'published'),
  ('019b8000-0000-7000-8000-000000000613', 'test_strength', 'draft_contract_session',
    'Sesión con contrato en borrador', 'published');

insert into catalog.result_contracts (id, contract_code, version_number, activity_family, envelope, minimums)
values ('019b8000-0000-7000-8000-000000000621', 'test.draft_strength', 1, 'strength', '{"schema":1}',
  '{}');

-- The draft type has a contract, so only its own status can refuse it.
insert into catalog.activity_type_result_contracts (activity_type_id, result_contract_id, is_default, valid_from)
values
  ('019b8000-0000-7000-8000-000000000611', '019c0000-0000-7000-8000-000000000031', true, clock_timestamp()),
  ('019b8000-0000-7000-8000-000000000613', '019b8000-0000-7000-8000-000000000621', true, clock_timestamp());

create function pg_temp.start(
  p_subject text, p_session uuid, p_type text, p_at timestamptz,
  p_zone text default 'America/Bogota', p_level text default 'summary',
  p_source text default 'manual', p_key uuid default gen_random_uuid(),
  p_hash bytea default extensions.gen_random_bytes(32)
) returns table (result jsonb, replayed boolean)
language sql as $fn$
  select * from execution.start_session(
    'workos', 'https://issuer.test', p_subject, p_session, p_type, p_at, p_zone, p_level,
    p_source, p_key, p_hash
  )
$fn$;

create function pg_temp.results(
  p_subject text, p_session uuid, p_revision bigint, p_segments jsonb, p_sets jsonb,
  p_laps jsonb default '[]', p_key uuid default gen_random_uuid(),
  p_command uuid default extensions.uuid_generate_v7(),
  p_hash bytea default extensions.gen_random_bytes(32)
) returns table (result jsonb, replayed boolean)
language sql as $fn$
  select * from execution.replace_session_results(
    'workos', 'https://issuer.test', p_subject, p_session, p_revision, p_segments, p_sets,
    p_laps, p_key, p_command, p_hash
  )
$fn$;

create function pg_temp.finish(
  p_subject text, p_session uuid, p_revision bigint, p_ended timestamptz,
  p_key uuid default gen_random_uuid(), p_command uuid default extensions.uuid_generate_v7(),
  p_hash bytea default extensions.gen_random_bytes(32)
) returns table (result jsonb, replayed boolean)
language sql as $fn$
  select * from execution.finalize_session(
    'workos', 'https://issuer.test', p_subject, p_session, p_revision, p_ended, p_key,
    p_command, p_hash
  )
$fn$;

create function pg_temp.strength_segment() returns jsonb language sql as $fn$
  select '[{"position": 1, "activity_type_code": "test_strength_session"}]'::jsonb
$fn$;

-- ---------------------------------------------------------------------------
-- What a session can be
-- ---------------------------------------------------------------------------

select is(
  enum_range(null::catalog.completeness_level)::text[],
  array['partial', 'summary', 'detailed', 'sensor_enriched'],
  'four completeness levels, partial being an ingestion state'
);

select is(
  enum_range(null::execution.execution_status)::text[],
  array['in_progress', 'paused', 'completed', 'abandoned'],
  'a session runs, pauses, completes or is abandoned'
);

select is(
  enum_range(null::execution.validation_status)::text[],
  array['pending', 'valid', 'invalid', 'annulled'],
  'and its validation is a separate dimension'
);

-- ---------------------------------------------------------------------------
-- Starting a free session
-- ---------------------------------------------------------------------------

create temporary table squat_day on commit drop as
select * from pg_temp.start(
  'subject_training', '019b8000-0000-7000-8000-000000000501', 'test_strength_session',
  now() - interval '2 hours', 'America/Bogota', 'detailed', 'manual',
  'a0000000-0000-4000-8000-000000000501', decode(repeat('51', 32), 'hex')
);

select results_eq(
  $$ select result->>'status', (result->>'revision_number')::integer,
            result->>'activity_type_code', result->'result_contract'->>'id',
            (result->'result_contract'->>'version')::integer,
            result->'result_contract'->>'requested_level', replayed
     from squat_day $$,
  $$ values ('in_progress'::text, 0, 'test_strength_session'::text,
             '019c0000-0000-7000-8000-000000000031'::text, 1, 'detailed'::text, false) $$,
  'a session starts under the published default contract of its activity type, frozen'
);

select results_eq(
  $$ select person_id, is_autonomous, capture_provenance::text, validation_status::text,
            achieved_level is null
     from execution.executed_sessions where id = '019b8000-0000-7000-8000-000000000501' $$,
  $$ values ('019b8000-0000-7000-8000-000000000001'::uuid, true, 'person_declared'::text,
             'pending'::text, true) $$,
  'it is the person''s own, declared by them, and not validated yet'
);

select results_eq(
  $$ select result->>'id', replayed
     from pg_temp.start('subject_training', '019b8000-0000-7000-8000-000000000501',
       'test_strength_session', now() - interval '2 hours', 'America/Bogota', 'detailed',
       'manual', 'a0000000-0000-4000-8000-000000000501', decode(repeat('51', 32), 'hex')) $$,
  $$ values ('019b8000-0000-7000-8000-000000000501'::text, true) $$,
  'a retried start answers the same session'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', '019b8000-0000-7000-8000-000000000501',
       'test_endurance_session', now(), 'America/Bogota', 'summary', 'manual',
       'a0000000-0000-4000-8000-000000000501', decode(repeat('52', 32), 'hex')) $$,
  '23505', null,
  'the same key for another session is a conflict'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', extensions.uuid_generate_v7(),
       'underwater_chess', now()) $$,
  '22023', null,
  'an activity type outside the catalogue is refused'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', extensions.uuid_generate_v7(),
       'draft_training_session', now()) $$,
  '22023', null,
  'so is one that is not published'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', extensions.uuid_generate_v7(),
       'uncontracted_session', now()) $$,
  '22023', null,
  'and one with no default contract to freeze'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', extensions.uuid_generate_v7(),
       'draft_contract_session', now()) $$,
  '22023', null,
  'or one whose default contract is not published'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', extensions.uuid_generate_v7(),
       'test_strength_session', now() + interval '3 days') $$,
  '22023', null,
  'nobody starts a session next week'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', extensions.uuid_generate_v7(),
       'test_strength_session', now(), 'Mars/Olympus_Mons') $$,
  '22023', null,
  'a session happens in a real time zone'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', extensions.uuid_generate_v7(),
       'test_strength_session', now(), 'America/Bogota', 'certified') $$,
  '22023', null,
  'the requested level is one of the four'
);

select throws_ok(
  $$ select * from pg_temp.start('subject_training', extensions.uuid_generate_v7(),
       'test_strength_session', now(), 'America/Bogota', 'summary', 'telepathy') $$,
  '22023', null,
  'a session is captured by hand or by a device'
);

select throws_ok(
  $$ select * from pg_temp.start('closed_training', extensions.uuid_generate_v7(),
       'test_strength_session', now()) $$,
  '42501', null,
  'a closed person starts nothing'
);

select is(
  (select array_agg(field order by field)
   from system.outbox_events, jsonb_object_keys(payload) as field
   where aggregate_id = '019b8000-0000-7000-8000-000000000501'
     and event_type = 'execution.session_started.v1'),
  array['executed_session_id'],
  'the start is announced with the session id and nothing it holds'
);

select * from pg_temp.start(
  'subject_training', '019b8000-0000-7000-8000-000000000502', 'test_endurance_session',
  now() - interval '1 hour', 'America/Bogota', 'summary', 'device'
);

select is(
  (select capture_provenance::text from execution.executed_sessions
   where id = '019b8000-0000-7000-8000-000000000502'),
  'device_observed',
  'a device capture is recorded as observed by the device'
);

select throws_ok(
  $$ insert into execution.executed_sessions (
       id, person_id, activity_type_id, result_contract_id, contract_version,
       context_relationship_id, context_organization_id, is_autonomous, started_at, timezone,
       requested_level, capture_source, capture_provenance
     ) values (
       extensions.uuid_generate_v7(), '019b8000-0000-7000-8000-000000000001',
       '019c0000-0000-7000-8000-000000000011', '019c0000-0000-7000-8000-000000000031', 1,
       gen_random_uuid(), gen_random_uuid(), false, now(), 'America/Bogota', 'summary',
       'manual', 'person_declared'
     ) $$,
  '23514', null,
  'no session belongs to a relationship until relationships exist'
);

select throws_ok(
  $$ insert into execution.executed_sessions (
       id, person_id, activity_type_id, result_contract_id, contract_version, started_at,
       timezone, requested_level, capture_source, capture_provenance
     ) values (
       extensions.uuid_generate_v7(), '019b8000-0000-7000-8000-000000000001',
       '019c0000-0000-7000-8000-000000000011', '019c0000-0000-7000-8000-000000000031', 7,
       now(), 'America/Bogota', 'summary', 'manual', 'person_declared'
     ) $$,
  '23514', null,
  'a session freezes the version its contract actually has'
);

-- ---------------------------------------------------------------------------
-- Replacing its results
-- ---------------------------------------------------------------------------

create temporary table first_sets on commit drop as
select * from pg_temp.results(
  'subject_training', '019b8000-0000-7000-8000-000000000501', 0, pg_temp.strength_segment(),
  '[{"segment_position": 1, "order": 1, "movement_id": "019b8000-0000-7000-8000-000000000601",
     "achieved_reps": 8, "load": {"value": 80, "unit": "kg"}, "rpe": 7},
    {"segment_position": 1, "order": 2, "movement_id": "019b8000-0000-7000-8000-000000000601",
     "achieved_reps": 6, "load": {"value": 176.37, "unit": "lb"}, "rpe": 8.5}]'::jsonb,
  '[]'::jsonb, 'a0000000-0000-4000-8000-000000000601', '019b8000-0000-7000-8000-000000000701',
  decode(repeat('61', 32), 'hex')
);

select results_eq(
  $$ select result->>'status', (result->>'revision_number')::integer,
            (result->>'segment_count')::integer, (result->>'result_count')::integer, replayed
     from first_sets $$,
  $$ values ('in_progress'::text, 1, 1, 2, false) $$,
  'results replace the working set and move the revision forward'
);

select results_eq(
  $$ select set_order, load_value, load_unit_code, original_load_value, original_load_unit_code
     from execution.strength_sets
     where executed_session_id = '019b8000-0000-7000-8000-000000000501' order by set_order $$,
  $$ values (1, 80.000::numeric, 'kg'::text, null::numeric, null::text),
            (2, 80.000::numeric, 'kg'::text, 176.370::numeric, 'lb'::text) $$,
  'a load is stored in kilograms, with what the person typed kept beside it (IX-18)'
);

select results_eq(
  $$ select (result->>'revision_number')::integer, replayed
     from pg_temp.results(
       'subject_training', '019b8000-0000-7000-8000-000000000501', 0, pg_temp.strength_segment(),
       '[{"segment_position": 1, "order": 1, "movement_id": "019b8000-0000-7000-8000-000000000601",
          "achieved_reps": 8, "load": {"value": 80, "unit": "kg"}, "rpe": 7},
         {"segment_position": 1, "order": 2, "movement_id": "019b8000-0000-7000-8000-000000000601",
          "achieved_reps": 6, "load": {"value": 176.37, "unit": "lb"}, "rpe": 8.5}]'::jsonb,
       '[]'::jsonb, 'a0000000-0000-4000-8000-000000000601',
       '019b8000-0000-7000-8000-000000000701', decode(repeat('61', 32), 'hex')) $$,
  $$ values (1, true) $$,
  'a retried replacement answers the state it produced'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 0,
       pg_temp.strength_segment(), '[{"segment_position": 1, "order": 1, "achieved_reps": 5}]') $$,
  'AF409', null,
  'a replacement based on a revision the session has left is stale'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(), '[{"segment_position": 2, "order": 1, "achieved_reps": 5}]') $$,
  '22023', null,
  'a set belongs to a segment the session has'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(),
       '[{"segment_position": 1, "order": 1, "achieved_reps": 5},
         {"segment_position": 1, "order": 1, "achieved_reps": 6}]') $$,
  '22023', null,
  'two sets never share an order'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(), '[{"segment_position": 1, "order": 1, "achieved_reps": 0}]') $$,
  '22023', null,
  'a set that was done has at least one repetition; not doing it is not recording it'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(),
       '[{"segment_position": 1, "order": 1, "achieved_reps": 5, "rpe": 11}]') $$,
  '22023', null,
  'effort is rated from zero to ten'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(),
       '[{"segment_position": 1, "order": 1, "load": {"value": 20, "unit": "cm"}}]') $$,
  '22023', null,
  'a load is a mass'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(),
       '[{"segment_position": 1, "order": 1, "achieved_reps": 5,
          "planned_step_id": "019b8000-0000-7000-8000-000000000999"}]') $$,
  '22023', null,
  'a free session follows no planned step'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(),
       '[{"segment_position": 1, "order": 1, "achieved_reps": 5,
          "movement_id": "019b8000-0000-7000-8000-000000000999"}]') $$,
  '22023', null,
  'a movement comes from the catalogue'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(), '[]') $$,
  '22023', null,
  'a replacement records at least one result'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       '[{"position": 1, "activity_type_code": "underwater_chess"}]',
       '[{"segment_position": 1, "order": 1, "achieved_reps": 5}]') $$,
  '22023', null,
  'a segment names a published activity type'
);

select throws_ok(
  $$ select * from pg_temp.results('other_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(), '[{"segment_position": 1, "order": 1, "achieved_reps": 5}]') $$,
  'P0002', null,
  'nobody replaces the results of someone else''s session'
);

select results_eq(
  $$ select (result->>'revision_number')::integer, (result->>'result_count')::integer
     from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 1,
       pg_temp.strength_segment(),
       '[{"segment_position": 1, "order": 1, "movement_id": "019b8000-0000-7000-8000-000000000601",
          "achieved_reps": 10, "load": {"value": 60, "unit": "kg"}}]') $$,
  $$ values (2, 1) $$,
  'replacing again leaves exactly the new results'
);

select results_eq(
  $$ select (result->>'result_count')::integer
     from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000502', 0,
       '[{"position": 1, "activity_type_code": "test_endurance_session"}]', '[]',
       '[{"segment_position": 1, "lap_number": 1, "distance": {"value": 5, "unit": "km"},
          "duration_seconds": 1800}]') $$,
  $$ values (1) $$,
  'an endurance session records its laps'
);

select results_eq(
  $$ select distance_value, distance_unit_code, original_distance_value,
            original_distance_unit_code, duration_seconds
     from execution.endurance_laps
     where executed_session_id = '019b8000-0000-7000-8000-000000000502' $$,
  $$ values (5000.000::numeric, 'm'::text, 5.000::numeric, 'km'::text, 1800.000::numeric) $$,
  'a distance is stored in metres, with what the person typed kept beside it'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000502', 1,
       '[{"position": 1, "activity_type_code": "test_endurance_session"}]', '[]',
       '[{"segment_position": 1, "lap_number": 1, "distance": {"value": 0, "unit": "km"},
          "duration_seconds": 1800}]') $$,
  '22023', null,
  'a lap covers some distance'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000502', 1,
       '[{"position": 1, "activity_type_code": "test_endurance_session"}]', '[]',
       '[{"segment_position": 1, "lap_number": 1, "distance": {"value": 5, "unit": "km"},
          "duration_seconds": 0}]') $$,
  '22023', null,
  'and takes some time'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 2,
       pg_temp.strength_segment(), '[]',
       '[{"segment_position": 1, "lap_number": 1, "distance": {"value": 5, "unit": "km"},
          "duration_seconds": 1800}]') $$,
  '22023', null,
  'a lap is not recorded in a strength segment'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000502', 1,
       '[{"position": 1, "activity_type_code": "test_endurance_session"}]',
       '[{"segment_position": 1, "order": 1, "achieved_reps": 5}]') $$,
  '22023', null,
  'nor a set in an endurance segment'
);

select throws_ok(
  $$ update execution.strength_sets set achieved_reps = 12
     where executed_session_id = '019b8000-0000-7000-8000-000000000501' $$,
  '55000', null,
  'a recorded set is replaced, never edited in place'
);

-- ---------------------------------------------------------------------------
-- Finishing it
-- ---------------------------------------------------------------------------

create temporary table finished on commit drop as
select * from pg_temp.finish(
  'subject_training', '019b8000-0000-7000-8000-000000000501', 2, now() - interval '1 hour',
  'a0000000-0000-4000-8000-000000000801', '019b8000-0000-7000-8000-000000000801',
  decode(repeat('81', 32), 'hex')
);

select results_eq(
  $$ select result->>'status', result->>'validation_status', result->'achieved_level',
            (result->>'revision_number')::integer, result->'is_primary',
            result->'contract'->>'id', (result->'contract'->>'version')::integer, replayed
     from finished $$,
  $$ values ('completed'::text, 'pending'::text, 'null'::jsonb, 3, 'false'::jsonb,
             '019c0000-0000-7000-8000-000000000031'::text, 1, false) $$,
  'a finished session is completed, with its validation pending and no certified level'
);

select results_eq(
  $$ select replayed from pg_temp.finish(
       'subject_training', '019b8000-0000-7000-8000-000000000501', 2, now() - interval '1 hour',
       'a0000000-0000-4000-8000-000000000801', '019b8000-0000-7000-8000-000000000801',
       decode(repeat('81', 32), 'hex')) $$,
  $$ values (true) $$,
  'a retried finish answers the same outcome'
);

select throws_ok(
  $$ select * from pg_temp.finish('subject_training', '019b8000-0000-7000-8000-000000000501', 3,
       now()) $$,
  '55000', null,
  'a finished session is not finished twice'
);

select throws_ok(
  $$ select * from pg_temp.results('subject_training', '019b8000-0000-7000-8000-000000000501', 3,
       pg_temp.strength_segment(), '[{"segment_position": 1, "order": 1, "achieved_reps": 5}]') $$,
  '55000', null,
  'and its results no longer change through replacement'
);

select throws_ok(
  $$ select * from pg_temp.finish('subject_training', '019b8000-0000-7000-8000-000000000502', 0,
       now()) $$,
  'AF409', null,
  'a finish based on a revision the session has left is stale'
);

select throws_ok(
  $$ select * from pg_temp.finish('subject_training', '019b8000-0000-7000-8000-000000000502', 1,
       now() - interval '3 hours') $$,
  '22023', null,
  'a session does not end before it starts'
);

select * from pg_temp.start('subject_training', '019b8000-0000-7000-8000-000000000503',
  'test_strength_session', now() - interval '30 minutes');

select throws_ok(
  $$ select * from pg_temp.finish('subject_training', '019b8000-0000-7000-8000-000000000503', 0,
       now()) $$,
  '22023', null,
  'a session with nothing recorded is not finished'
);

select is(
  (select count(*)::integer from system.outbox_events
   where aggregate_id = '019b8000-0000-7000-8000-000000000501'
     and event_type = 'execution.finalized.v1'
     and payload = jsonb_build_object('executed_session_id', aggregate_id)),
  1,
  'the finish is announced once, with the session id only'
);

-- ---------------------------------------------------------------------------
-- Reading my own
-- ---------------------------------------------------------------------------

select * from pg_temp.start('other_training', '019b8000-0000-7000-8000-000000000651',
  'test_strength_session', now() - interval '10 minutes');

select results_eq(
  $$ select entry->>'id', entry->>'status' from jsonb_array_elements(execution.list_sessions(
       'workos', 'https://issuer.test', 'subject_training', 50)->'items') as entry $$,
  $$ values ('019b8000-0000-7000-8000-000000000503'::text, 'in_progress'::text),
            ('019b8000-0000-7000-8000-000000000502'::text, 'in_progress'::text),
            ('019b8000-0000-7000-8000-000000000501'::text, 'completed'::text) $$,
  'a person lists their own sessions, most recent start first, and nobody else''s'
);

select results_eq(
  $$ select entry->>'id' from jsonb_array_elements(execution.list_sessions(
       'workos', 'https://issuer.test', 'subject_training', 50,
       (select started_at from execution.executed_sessions
        where id = '019b8000-0000-7000-8000-000000000502'),
       '019b8000-0000-7000-8000-000000000502')->'items') as entry $$,
  $$ values ('019b8000-0000-7000-8000-000000000501'::text) $$,
  'and continues after the last one it returned'
);

select results_eq(
  $$ select detail->>'activity_type_code', detail->>'status',
            jsonb_array_length(detail->'segments'), jsonb_array_length(detail->'strength_sets'),
            detail->'strength_sets'->0->>'movement_name',
            (detail->'strength_sets'->0->'load'->>'value')::numeric,
            detail->'strength_sets'->0->'load'->>'unit'
     from execution.session_detail('workos', 'https://issuer.test', 'subject_training',
       '019b8000-0000-7000-8000-000000000501') as detail $$,
  $$ values ('test_strength_session'::text, 'completed'::text, 1, 1, 'Sentadilla'::text,
             60::numeric, 'kg'::text) $$,
  'a person opens their own session and sees what they recorded'
);

select ok(
  (select not detail ? 'person_id'
   from execution.session_detail('workos', 'https://issuer.test', 'subject_training',
     '019b8000-0000-7000-8000-000000000501') as detail),
  'the detail never says whose session it is'
);

select throws_ok(
  $$ select execution.session_detail('workos', 'https://issuer.test', 'other_training',
       '019b8000-0000-7000-8000-000000000501') $$,
  'P0002', null,
  'someone else''s session is not found'
);

select throws_ok(
  $$ select execution.list_sessions('workos', 'https://issuer.test', 'subject_training', 0) $$,
  '22023', null,
  'a page has a size'
);

-- ---------------------------------------------------------------------------
-- Support reads it through its own standard window
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b8000-0000-7000-8000-000000000013', true);

create temporary table training_window on commit drop as
select result from support.request_break_glass(
  '019b8000-0000-7000-8000-000000000013', '019b8000-0000-7000-8000-000000000213',
  '019b8000-0000-7000-8000-000000000001', array['prior_training_history', 'relationship_training'],
  'customer_support_request', 'CASE-2026-012',
  'b0000000-0000-4000-8000-000000000731', '019b8000-0000-7000-8000-000000000731',
  decode(repeat('79', 32), 'hex')
);

select support.decide_break_glass(
  '019b8000-0000-7000-8000-000000000014', '019b8000-0000-7000-8000-000000000214',
  (select (result->>'id')::uuid from training_window), 'approved', 'REASON-OK',
  'b0000000-0000-4000-8000-000000000732', '019b8000-0000-7000-8000-000000000732',
  decode(repeat('7a', 32), 'hex')
);

create temporary table training_read on commit drop as
select support.exercise_break_glass(
  '019b8000-0000-7000-8000-000000000013', '019b8000-0000-7000-8000-000000000213',
  (select (result->>'id')::uuid from training_window), 'prior_training_history',
  'execution.executed_sessions', null
) as answer;

select results_eq(
  $$ select answer->>'outcome', jsonb_array_length(answer->'content'->'prior_training_history')
     from training_read $$,
  $$ values ('allowed'::text, 3) $$,
  'the approved standard window reads the subject''s own sessions'
);

select ok(
  (select bool_and(entry ? 'strength_sets' and entry ? 'endurance_laps' and entry ? 'status'
                   and not entry ? 'person_id')
   from training_read, jsonb_array_elements(answer->'content'->'prior_training_history') as entry),
  'each carries what was recorded, never whose it is'
);

select ok(
  (select position('019b8000-0000-7000-8000-000000000651' in answer::text) = 0 from training_read),
  'another person''s session never enters the window'
);

select is(
  (select result from privacy.access_events
   where actor_person_id = '019b8000-0000-7000-8000-000000000013'
     and subject_person_id = '019b8000-0000-7000-8000-000000000001'
     and resource = 'execution.executed_sessions'
   order by occurred_at desc limit 1),
  'allowed',
  'the read is recorded against the person before the content is returned'
);

select is(
  (select support.exercise_break_glass(
     '019b8000-0000-7000-8000-000000000013', '019b8000-0000-7000-8000-000000000213',
     (select (result->>'id')::uuid from training_window), 'prior_training_history',
     'nutrition.meals', null
   )->>'reason_code'),
  'resource_out_of_scope',
  'a training window cannot be pointed at another kind of data'
);

select results_eq(
  $$ select answer->>'outcome', answer->>'reason_code', answer ? 'content'
     from (select support.exercise_break_glass(
       '019b8000-0000-7000-8000-000000000013', '019b8000-0000-7000-8000-000000000213',
       (select (result->>'id')::uuid from training_window), 'relationship_training',
       'execution.executed_sessions', null) as answer) as read $$,
  $$ values ('content_unavailable'::text, 'category_content_absent'::text, false) $$,
  'training within a relationship stays unavailable while relationships do not exist'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('allfit_api', 'execution.executed_sessions', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'execution.session_segments', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'execution.strength_sets', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'execution.endurance_laps', 'SELECT, INSERT, UPDATE, DELETE'),
  'the runtime touches no session table directly'
);

select ok(
  has_function_privilege('allfit_api',
    'execution.start_session(text,text,text,uuid,text,timestamptz,text,text,text,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'execution.replace_session_results(text,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid,uuid,bytea)',
    'EXECUTE')
  and has_function_privilege('allfit_api',
    'execution.finalize_session(text,text,text,uuid,bigint,timestamptz,uuid,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'execution.list_sessions(text,text,text,integer,timestamptz,uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'execution.session_detail(text,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api', 'execution.session_projection(uuid)', 'EXECUTE'),
  'it runs the five operations and nothing behind them'
);

select * from finish();
rollback;
