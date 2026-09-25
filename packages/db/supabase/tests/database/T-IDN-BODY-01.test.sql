-- T-IDN-BODY-01 — OP-IDN-006, OP-IDN-007 and OP-SUP-003 over body progress
-- (`HU-SP-025`, `HU-SP-026`, `HU-SP-027`, `HU-BO-009`).
--
-- **A measurement is the person's, and only theirs.** Space records it for the person
-- the token resolves to, nobody reads the table directly, and one person's list never
-- shows another's.
--
-- **Deleting is physical, and it leaves evidence.** The record is gone in the same
-- transaction; what stays is a disposition case saying which kind of data was deleted,
-- under which policy and when — never the value, never a pointer to a row that no
-- longer exists.
--
-- **Support reads it only through its own restricted window**, and the read carries the
-- values without a photo reference.

begin;

select plan(50);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b5000-0000-7000-8000-000000000001', 'Subject', 'Body', 'active'),
  ('019b5000-0000-7000-8000-000000000002', 'Other', 'Body', 'active'),
  ('019b5000-0000-7000-8000-000000000003', 'Closed', 'Body', 'closed'),
  ('019b5000-0000-7000-8000-000000000011', 'Manager', 'Alpha', 'active'),
  ('019b5000-0000-7000-8000-000000000012', 'Manager', 'Beta', 'active'),
  ('019b5000-0000-7000-8000-000000000013', 'Requester', 'Gamma', 'active'),
  ('019b5000-0000-7000-8000-000000000014', 'Approver', 'Delta', 'active'),
  ('019b5000-0000-7000-8000-000000000015', 'Approver', 'Epsilon', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b5000-0000-7000-8000-000000000101', 'workos', 'https://issuer.test', 'subject_body',
    '019b5000-0000-7000-8000-000000000001'),
  ('019b5000-0000-7000-8000-000000000102', 'workos', 'https://issuer.test', 'other_body',
    '019b5000-0000-7000-8000-000000000002'),
  ('019b5000-0000-7000-8000-000000000103', 'workos', 'https://issuer.test', 'closed_body',
    '019b5000-0000-7000-8000-000000000003'),
  ('019b5000-0000-7000-8000-000000000104', 'workos', 'https://issuer.test', 'pending_body', null),
  ('019b5000-0000-7000-8000-000000000111', 'workos', 'https://issuer.test', 'alpha_body', null),
  ('019b5000-0000-7000-8000-000000000112', 'workos', 'https://issuer.test', 'beta_body', null),
  ('019b5000-0000-7000-8000-000000000113', 'workos', 'https://issuer.test', 'gamma_body',
    '019b5000-0000-7000-8000-000000000013'),
  ('019b5000-0000-7000-8000-000000000114', 'workos', 'https://issuer.test', 'delta_body',
    '019b5000-0000-7000-8000-000000000014'),
  ('019b5000-0000-7000-8000-000000000115', 'workos', 'https://issuer.test', 'epsilon_body',
    '019b5000-0000-7000-8000-000000000015');

select support.bootstrap_backoffice_administrators(
  '019b5000-0000-7000-8000-000000000011', 'alpha_body',
  '019b5000-0000-7000-8000-000000000012', 'beta_body',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-BODY-01'
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
  ('019b5000-0000-7000-8000-000000000211'::uuid, '019b5000-0000-7000-8000-000000000111'::uuid,
    'alpha_body', 'b1'),
  ('019b5000-0000-7000-8000-000000000213'::uuid, '019b5000-0000-7000-8000-000000000113'::uuid,
    'gamma_body', 'b3'),
  ('019b5000-0000-7000-8000-000000000214'::uuid, '019b5000-0000-7000-8000-000000000114'::uuid,
    'delta_body', 'b4'),
  ('019b5000-0000-7000-8000-000000000215'::uuid, '019b5000-0000-7000-8000-000000000115'::uuid,
    'epsilon_body', 'b5')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b5000-0000-7000-8000-000000000011', '019b5000-0000-7000-8000-000000000211',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b5000-0000-7000-8000-000000000013'::uuid, '019b5000-0000-7000-8000-000000000313'::uuid,
    '019b5000-0000-7000-8000-000000000413'::uuid, 'c3'),
  ('019b5000-0000-7000-8000-000000000014'::uuid, '019b5000-0000-7000-8000-000000000314'::uuid,
    '019b5000-0000-7000-8000-000000000414'::uuid, 'c4'),
  ('019b5000-0000-7000-8000-000000000015'::uuid, '019b5000-0000-7000-8000-000000000315'::uuid,
    '019b5000-0000-7000-8000-000000000415'::uuid, 'c5')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019b5000-0000-7000-8000-000000000011', '019b5000-0000-7000-8000-000000000211',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-009', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b5000-0000-7000-8000-000000000013'::uuid, 'request_break_glass',
    '019b5000-0000-7000-8000-000000000323'::uuid, '019b5000-0000-7000-8000-000000000423'::uuid, 'd3'),
  ('019b5000-0000-7000-8000-000000000014'::uuid, 'approve_break_glass',
    '019b5000-0000-7000-8000-000000000324'::uuid, '019b5000-0000-7000-8000-000000000424'::uuid, 'd4'),
  ('019b5000-0000-7000-8000-000000000015'::uuid, 'approve_break_glass',
    '019b5000-0000-7000-8000-000000000325'::uuid, '019b5000-0000-7000-8000-000000000425'::uuid, 'd5')
) as duty_row(person_id, duty_code, key, command, hash_byte);

create function pg_temp.record(
  p_subject text, p_record uuid, p_metric text, p_value numeric, p_unit text, p_on date,
  p_key uuid default gen_random_uuid(), p_hash bytea default extensions.gen_random_bytes(32)
) returns table (result jsonb, replayed boolean)
language sql as $fn$
  select * from identity.record_body_progress(
    'workos', 'https://issuer.test', p_subject, p_record, p_metric, p_value, p_unit, p_on,
    p_key, p_hash
  )
$fn$;

create function pg_temp.forget(
  p_subject text, p_record uuid, p_key uuid default gen_random_uuid(),
  p_command uuid default extensions.uuid_generate_v7(),
  p_hash bytea default extensions.gen_random_bytes(32)
) returns table (result jsonb, replayed boolean)
language sql as $fn$
  select * from identity.delete_body_progress(
    'workos', 'https://issuer.test', p_subject, p_record, p_key, p_command, p_hash
  )
$fn$;

-- ---------------------------------------------------------------------------
-- What can be measured, and in what
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select code, dimension from identity.body_progress_metrics order by code $$,
  $$ values ('arm'::text, 'length'::text), ('body_fat'::text, 'ratio'::text),
            ('body_height'::text, 'length'::text), ('body_weight'::text, 'mass'::text),
            ('chest'::text, 'length'::text), ('hip'::text, 'length'::text),
            ('muscle_mass'::text, 'mass'::text), ('thigh'::text, 'length'::text),
            ('waist'::text, 'length'::text) $$,
  'nine measurements, each of one dimension'
);

select results_eq(
  $$ select dimension, code from catalog.units
     where is_canonical and dimension in ('mass', 'length', 'ratio') order by dimension $$,
  $$ values ('length'::text, 'cm'::text), ('mass'::text, 'kg'::text), ('ratio'::text, 'percent'::text) $$,
  'each dimension has exactly one canonical unit'
);

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------

create temporary table first_weight on commit drop as
select * from pg_temp.record(
  'subject_body', '019b5000-0000-7000-8000-000000000501', 'body_weight', 80, 'kg',
  current_date - 3, 'a0000000-0000-4000-8000-000000000501', decode(repeat('51', 32), 'hex')
);

select results_eq(
  $$ select result->>'metric_code', (result->>'value')::numeric, result->>'unit_code',
            result->'original_value', result->'original_unit_code', result->'has_media', replayed
     from first_weight $$,
  $$ values ('body_weight'::text, 80::numeric, 'kg'::text, 'null'::jsonb, 'null'::jsonb,
             'false'::jsonb, false) $$,
  'a weight in kilograms is stored as it came, with no original to keep'
);

select is(
  (select person_id from identity.body_progress_records
   where id = '019b5000-0000-7000-8000-000000000501'),
  '019b5000-0000-7000-8000-000000000001'::uuid,
  'the record belongs to the person the token resolves to, and its id is the command'
);

select results_eq(
  $$ select (result->>'value')::numeric, result->>'unit_code',
            (result->>'original_value')::numeric, result->>'original_unit_code'
     from pg_temp.record('subject_body', '019b5000-0000-7000-8000-000000000502', 'body_weight',
       176.37, 'lb', current_date - 2) $$,
  $$ values (80.000::numeric, 'kg'::text, 176.37::numeric, 'lb'::text) $$,
  'pounds are kept as written and stored in kilograms'
);

select results_eq(
  $$ select (result->>'value')::numeric, result->>'unit_code', result->>'original_unit_code'
     from pg_temp.record('subject_body', '019b5000-0000-7000-8000-000000000503', 'waist',
       32, 'in', current_date - 1) $$,
  $$ values (81.280::numeric, 'cm'::text, 'in'::text) $$,
  'a waist in inches is kept as written and stored in centimetres'
);

select results_eq(
  $$ select result->>'metric_code', replayed
     from pg_temp.record('subject_body', '019b5000-0000-7000-8000-000000000501', 'body_weight', 80,
       'kg', current_date - 3, 'a0000000-0000-4000-8000-000000000501',
       decode(repeat('51', 32), 'hex')) $$,
  $$ values ('body_weight'::text, true) $$,
  'a retried recording answers the same record instead of a second one'
);

select throws_ok(
  $$ select * from pg_temp.record('subject_body', '019b5000-0000-7000-8000-000000000501',
       'body_weight', 81, 'kg', current_date - 3, 'a0000000-0000-4000-8000-000000000501',
       decode(repeat('52', 32), 'hex')) $$,
  '23505', null,
  'the same key with a different measurement is a conflict, not a correction'
);

select throws_ok(
  $$ select * from pg_temp.record('subject_body', extensions.uuid_generate_v7(), 'body_weight', 80,
       'cm', current_date) $$,
  '22023', null,
  'a weight is not measured in centimetres'
);

select throws_ok(
  $$ select * from pg_temp.record('subject_body', extensions.uuid_generate_v7(), 'shoe_size',
       42, 'cm', current_date) $$,
  '22023', null,
  'a measurement outside the catalogue is refused'
);

select throws_ok(
  $$ select * from pg_temp.record('subject_body', extensions.uuid_generate_v7(), 'body_weight', 0,
       'kg', current_date) $$,
  '22023', null,
  'a measurement is positive'
);

select throws_ok(
  $$ select * from pg_temp.record('subject_body', extensions.uuid_generate_v7(), 'body_fat',
       120, 'percent', current_date) $$,
  '22023', null,
  'a percentage does not pass one hundred'
);

select throws_ok(
  $$ select * from pg_temp.record('subject_body', extensions.uuid_generate_v7(), 'body_weight', 80,
       'kg', current_date + 5) $$,
  '22023', null,
  'nobody measured themselves next week'
);

select throws_ok(
  $$ select * from pg_temp.record('nobody_body', extensions.uuid_generate_v7(), 'body_weight', 80,
       'kg', current_date) $$,
  '42501', null,
  'a token that resolves to no account records nothing'
);

select throws_ok(
  $$ select * from pg_temp.record('pending_body', extensions.uuid_generate_v7(), 'body_weight', 80,
       'kg', current_date) $$,
  '42501', null,
  'nor does an account without a Fitness ID'
);

select throws_ok(
  $$ select * from pg_temp.record('closed_body', extensions.uuid_generate_v7(), 'body_weight', 80,
       'kg', current_date) $$,
  '42501', null,
  'nor a closed person'
);

select is(
  (select array_agg(field order by field)
   from system.outbox_events, jsonb_object_keys(payload) as field
   where aggregate_id = '019b5000-0000-7000-8000-000000000501'
     and event_type = 'identity.body_progress_recorded.v1'),
  array['body_progress_record_id'],
  'the event says a measurement exists, never what it says'
);

select is(
  (select count(*)::integer from system.outbox_events
   where aggregate_id = '019b5000-0000-7000-8000-000000000501'),
  1,
  'and says it once, however many times the recording is retried'
);

select throws_ok(
  $$ insert into identity.body_progress_records (
       id, person_id, metric_code, value_numeric, unit_code, measured_on, media_ref, has_media
     ) values (
       extensions.uuid_generate_v7(), '019b5000-0000-7000-8000-000000000001', 'body_weight', 80, 'kg',
       current_date, 'photos/1', false
     ) $$,
  '23514', null,
  'a photo reference never exists without the flag that says there is one'
);

select throws_ok(
  $$ update identity.body_progress_records set value_numeric = 70
     where id = '019b5000-0000-7000-8000-000000000501' $$,
  '55000', null,
  'a recorded measurement is never rewritten: it is deleted or kept'
);

-- ---------------------------------------------------------------------------
-- Reading my own
-- ---------------------------------------------------------------------------

select * from pg_temp.record('other_body', '019b5000-0000-7000-8000-000000000601', 'body_weight', 60,
  'kg', current_date);

select results_eq(
  $$ select entry->>'id' from jsonb_array_elements(identity.list_body_progress(
       'workos', 'https://issuer.test', 'subject_body', 50
     )->'items') as entry $$,
  $$ values ('019b5000-0000-7000-8000-000000000503'::text),
            ('019b5000-0000-7000-8000-000000000502'::text),
            ('019b5000-0000-7000-8000-000000000501'::text) $$,
  'a person reads their own measurements, newest first, and nobody else''s'
);

select is(
  (select identity.list_body_progress('workos', 'https://issuer.test', 'subject_body', 2)
     ->>'has_more'),
  'true',
  'the list says when there is more than it returned'
);

select results_eq(
  $$ select entry->>'id' from jsonb_array_elements(identity.list_body_progress(
       'workos', 'https://issuer.test', 'subject_body', 50, current_date - 2,
       '019b5000-0000-7000-8000-000000000502'
     )->'items') as entry $$,
  $$ values ('019b5000-0000-7000-8000-000000000501'::text) $$,
  'and continues after the last one it returned'
);

select throws_ok(
  $$ select identity.list_body_progress('workos', 'https://issuer.test', 'nobody_body', 10) $$,
  '42501', null,
  'a token that resolves to nobody reads nothing'
);

-- ---------------------------------------------------------------------------
-- Support reads it through its own restricted window
-- ---------------------------------------------------------------------------

-- Each API request is its own transaction; this one switches actor explicitly.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b5000-0000-7000-8000-000000000013', true);

create temporary table body_window on commit drop as
select result from support.request_break_glass(
  '019b5000-0000-7000-8000-000000000013', '019b5000-0000-7000-8000-000000000213',
  '019b5000-0000-7000-8000-000000000001', array['body_progress'],
  'customer_support_request', 'CASE-2026-009',
  'b0000000-0000-4000-8000-000000000701', '019b5000-0000-7000-8000-000000000701',
  decode(repeat('71', 32), 'hex')
);

select support.decide_break_glass(
  person_id, session_id, (select (result->>'id')::uuid from body_window), 'approved', 'REASON-OK',
  key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b5000-0000-7000-8000-000000000014'::uuid, '019b5000-0000-7000-8000-000000000214'::uuid,
    'b0000000-0000-4000-8000-000000000702'::uuid, '019b5000-0000-7000-8000-000000000702'::uuid, '72'),
  ('019b5000-0000-7000-8000-000000000015'::uuid, '019b5000-0000-7000-8000-000000000215'::uuid,
    'b0000000-0000-4000-8000-000000000703'::uuid, '019b5000-0000-7000-8000-000000000703'::uuid, '73')
) as approval(person_id, session_id, key, command, hash_byte);

create temporary table body_read on commit drop as
select support.exercise_break_glass(
  '019b5000-0000-7000-8000-000000000013', '019b5000-0000-7000-8000-000000000213',
  (select (result->>'id')::uuid from body_window), 'body_progress',
  'identity.body_progress_records', null
) as answer;

select results_eq(
  $$ select answer->>'outcome', jsonb_array_length(answer->'content'->'body_progress') from body_read $$,
  $$ values ('allowed'::text, 3) $$,
  'the approved window reads the subject''s three measurements'
);

select ok(
  (select bool_and(entry ? 'value' and entry ? 'measured_on' and entry ? 'has_media'
                   and not entry ? 'media_ref' and not entry ? 'person_id')
   from body_read, jsonb_array_elements(answer->'content'->'body_progress') as entry),
  'each carries its value and whether a photo exists, never where the photo is'
);

select ok(
  (select position('019b5000-0000-7000-8000-000000000601' in answer::text) = 0 from body_read),
  'another person''s measurement never enters the window'
);

select is(
  (select result from privacy.access_events
   where actor_person_id = '019b5000-0000-7000-8000-000000000013'
     and subject_person_id = '019b5000-0000-7000-8000-000000000001'
     and resource = 'identity.body_progress_records'
   order by occurred_at desc limit 1),
  'allowed',
  'the read is recorded against the person before the content is returned'
);

select is(
  (select support.exercise_break_glass(
     '019b5000-0000-7000-8000-000000000013', '019b5000-0000-7000-8000-000000000213',
     (select (result->>'id')::uuid from body_window), 'body_progress',
     'nutrition.meals', null
   )->>'reason_code'),
  'resource_out_of_scope',
  'a body window cannot be pointed at another kind of data'
);

select is(
  (select count(*)::integer from support.break_glass_events
   where request_id = (select (result->>'id')::uuid from body_window)
     and reason_code = 'resource_out_of_scope' and result = 'denied'),
  1,
  'and the attempt is evidence like any other'
);

-- ---------------------------------------------------------------------------
-- Deleting my own
-- ---------------------------------------------------------------------------

create temporary table forgotten on commit drop as
select * from pg_temp.forget(
  'subject_body', '019b5000-0000-7000-8000-000000000502', 'a0000000-0000-4000-8000-000000000802',
  '019b5000-0000-7000-8000-000000000803', decode(repeat('82', 32), 'hex')
);

select results_eq(
  $$ select result->>'status', replayed from forgotten $$,
  $$ values ('deleted'::text, false) $$,
  'a person deletes their own measurement'
);

select is(
  (select count(*)::integer from identity.body_progress_records
   where id = '019b5000-0000-7000-8000-000000000502'),
  0,
  'and it is gone from the table, not hidden'
);

select results_eq(
  $$ select dcase.origin, dcase.status, item.data_classification_code, item.action::text,
            item.status::text, item.target_kind, item.target_body_progress_id is null,
            item.executed_at is not null
     from privacy.disposition_cases as dcase
     join privacy.disposition_items as item on item.disposition_case_id = dcase.id
     where dcase.id = (select (result->>'disposition_case_id')::uuid from forgotten) $$,
  $$ values ('request'::text, 'closed'::text, 'body'::text, 'delete'::text, 'executed'::text,
             'body_progress'::text, true, true) $$,
  'what stays is a closed case: which kind of data, deleted, when — and no pointer to it'
);

select results_eq(
  $$ select event.action::text, event.result, event.actor
     from privacy.disposition_events as event
     join privacy.disposition_items as item on item.id = event.disposition_item_id
     where item.disposition_case_id = (select (result->>'disposition_case_id')::uuid from forgotten) $$,
  $$ values ('delete'::text, 'deleted'::text, 'owner_request'::text) $$,
  'the execution itself is an append-only event'
);

select is(
  (select item.retention_policy_id = policy.id
   from privacy.disposition_items as item, privacy.retention_policies as policy
   where item.disposition_case_id = (select (result->>'disposition_case_id')::uuid from forgotten)
     and policy.data_classification_code = 'body' and policy.jurisdiction = 'CO'
     and policy.trigger = 'owner_request'),
  true,
  'and it names the policy it followed'
);

select results_eq(
  $$ select (result->>'disposition_case_id'), replayed
     from pg_temp.forget('subject_body', '019b5000-0000-7000-8000-000000000502',
       'a0000000-0000-4000-8000-000000000802', '019b5000-0000-7000-8000-000000000803',
       decode(repeat('82', 32), 'hex')) $$,
  $$ select result->>'disposition_case_id', true from forgotten $$,
  'a retried deletion answers the same case instead of opening another'
);

-- T-IDEM-08: the recording ran, and its measurement is gone.
select * from pg_temp.record(
  'subject_body', '019b5000-0000-7000-8000-000000000504', 'hip', 95, 'cm', current_date,
  'a0000000-0000-4000-8000-000000000504', decode(repeat('54', 32), 'hex')
);
select * from pg_temp.forget('subject_body', '019b5000-0000-7000-8000-000000000504');

select throws_ok(
  $$ select * from pg_temp.record(
       'subject_body', '019b5000-0000-7000-8000-000000000504', 'hip', 95, 'cm', current_date,
       'a0000000-0000-4000-8000-000000000504', decode(repeat('54', 32), 'hex')) $$,
  'AF410', null,
  'replaying the recording of a deleted measurement says it was deleted, and does not bring it back'
);

select throws_ok(
  $$ select * from pg_temp.forget('other_body', '019b5000-0000-7000-8000-000000000501') $$,
  'P0002', null,
  'nobody deletes someone else''s measurement'
);

select is(
  (select count(*)::integer from identity.body_progress_records
   where id = '019b5000-0000-7000-8000-000000000501'),
  1,
  'and trying leaves it where it was'
);

select throws_ok(
  $$ select * from pg_temp.forget('subject_body', '019b5000-0000-7000-8000-000000000999') $$,
  'P0002', null,
  'a measurement that does not exist is not found'
);

select is(
  (select count(*)::integer from system.outbox_events
   where event_type = 'privacy.disposition_case_opened.v1'
     and aggregate_id = (select (result->>'disposition_case_id')::uuid from forgotten)),
  1,
  'the case opening is announced once'
);

-- ---------------------------------------------------------------------------
-- The evidence cannot be rewritten
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update privacy.disposition_items set status = 'pending'
     where disposition_case_id = (select (result->>'disposition_case_id')::uuid from forgotten) $$,
  '55000', null,
  'an executed disposition never becomes pending again'
);

select throws_ok(
  $$ delete from privacy.disposition_cases
     where id = (select (result->>'disposition_case_id')::uuid from forgotten) $$,
  '55000', null,
  'a disposition case is never deleted'
);

select throws_ok(
  $$ update privacy.disposition_events set result = 'failed' $$,
  '55000', null,
  'a disposition event is never rewritten'
);

select throws_ok(
  $$ insert into privacy.disposition_events (id, executed_at, disposition_item_id, action, result, actor)
     select extensions.uuid_generate_v7(), clock_timestamp() - interval '40 days', item.id,
            'delete', 'deleted', 'owner_request'
     from privacy.disposition_items as item
     where item.disposition_case_id = (select (result->>'disposition_case_id')::uuid from forgotten) $$,
  '23514', null,
  'an event cannot claim a time its own identifier does not carry'
);

-- A pending disposition holds its target: nothing deletes it behind its back, and it
-- cannot name someone else's record.
insert into privacy.disposition_cases (id, subject_person_id, origin, requested_by_person_id)
values ('019b5000-0000-7000-8000-000000000901', '019b5000-0000-7000-8000-000000000001',
  'request', '019b5000-0000-7000-8000-000000000001');

insert into privacy.disposition_items (
  disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
  action, target_kind, target_body_progress_id
)
select '019b5000-0000-7000-8000-000000000901', '019b5000-0000-7000-8000-000000000001', 'body',
  policy.id, 'delete', 'body_progress', '019b5000-0000-7000-8000-000000000503'
from privacy.retention_policies as policy
where policy.data_classification_code = 'body' and policy.trigger = 'owner_request';

select throws_ok(
  $$ delete from identity.body_progress_records
     where id = '019b5000-0000-7000-8000-000000000503' $$,
  '23503', null,
  'a record under a pending disposition is not deleted around it'
);

select throws_ok(
  $$ insert into privacy.disposition_items (
       disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
       action, target_kind, target_body_progress_id
     )
     select '019b5000-0000-7000-8000-000000000901', '019b5000-0000-7000-8000-000000000001',
       'body', policy.id, 'delete', 'body_progress', '019b5000-0000-7000-8000-000000000601'
     from privacy.retention_policies as policy
     where policy.data_classification_code = 'body' and policy.trigger = 'owner_request' $$,
  '23514', null,
  'a disposition cannot target another person''s record'
);

select throws_ok(
  $$ insert into privacy.disposition_items (
       disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
       action, target_kind
     )
     select '019b5000-0000-7000-8000-000000000901', '019b5000-0000-7000-8000-000000000001',
       'body', policy.id, 'delete', 'body_progress'
     from privacy.retention_policies as policy
     where policy.data_classification_code = 'body' and policy.trigger = 'owner_request' $$,
  '23514', null,
  'a pending disposition names exactly one target'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('allfit_api', 'identity.body_progress_records', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'privacy.disposition_cases', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'privacy.disposition_items', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'privacy.disposition_events', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('allfit_api', 'privacy.retention_policies', 'SELECT, INSERT, UPDATE, DELETE'),
  'the runtime writes no measurement and reaches no disposition table'
);

select ok(
  has_function_privilege('allfit_api',
    'identity.record_body_progress(text,text,text,uuid,text,numeric,text,date,uuid,bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.list_body_progress(text,text,text,integer,date,uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.delete_body_progress(text,text,text,uuid,uuid,uuid,bytea)', 'EXECUTE')
  and not has_function_privilege('allfit_api',
    'identity.require_space_person(text,text,text)', 'EXECUTE')
  and not has_function_privilege('allfit_api',
    'privacy.log_disposition_event(uuid,privacy.disposition_action,text,text)', 'EXECUTE'),
  'it runs the three commands and nothing behind them'
);

select * from finish();
rollback;
