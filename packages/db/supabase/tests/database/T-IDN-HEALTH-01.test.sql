-- T-IDN-HEALTH-01 — OP-IDN-008, OP-IDN-049, OP-IDN-050 and OP-SUP-003 over health context
-- (`HU-SP-014`, `HU-SP-028`, `HU-BO-009`).
--
-- **The most protected category V1 keeps.** A person declares a pain, a limitation or a
-- recovery in plain words; it is theirs, nobody reads the table directly, and it is never
-- a clinical record: three types, a short description, an optional body area.
--
-- **Deleting it goes through the same disposition as a measurement**, now shared: a
-- closed case that says which kind of data was deleted and under which policy.
--
-- **Support reads it only through its own restricted window.**

begin;

select plan(46);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b6000-0000-7000-8000-000000000001', 'Subject', 'Health', 'active'),
  ('019b6000-0000-7000-8000-000000000002', 'Other', 'Health', 'active'),
  ('019b6000-0000-7000-8000-000000000003', 'Closed', 'Health', 'closed'),
  ('019b6000-0000-7000-8000-000000000011', 'Manager', 'Alpha', 'active'),
  ('019b6000-0000-7000-8000-000000000012', 'Manager', 'Beta', 'active'),
  ('019b6000-0000-7000-8000-000000000013', 'Requester', 'Gamma', 'active'),
  ('019b6000-0000-7000-8000-000000000014', 'Approver', 'Delta', 'active'),
  ('019b6000-0000-7000-8000-000000000015', 'Approver', 'Epsilon', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b6000-0000-7000-8000-000000000101', 'workos', 'https://issuer.test', 'subject_health',
    '019b6000-0000-7000-8000-000000000001'),
  ('019b6000-0000-7000-8000-000000000102', 'workos', 'https://issuer.test', 'other_health',
    '019b6000-0000-7000-8000-000000000002'),
  ('019b6000-0000-7000-8000-000000000103', 'workos', 'https://issuer.test', 'closed_health',
    '019b6000-0000-7000-8000-000000000003'),
  ('019b6000-0000-7000-8000-000000000111', 'workos', 'https://issuer.test', 'alpha_health', null),
  ('019b6000-0000-7000-8000-000000000112', 'workos', 'https://issuer.test', 'beta_health', null),
  ('019b6000-0000-7000-8000-000000000113', 'workos', 'https://issuer.test', 'gamma_health',
    '019b6000-0000-7000-8000-000000000013'),
  ('019b6000-0000-7000-8000-000000000114', 'workos', 'https://issuer.test', 'delta_health',
    '019b6000-0000-7000-8000-000000000014'),
  ('019b6000-0000-7000-8000-000000000115', 'workos', 'https://issuer.test', 'epsilon_health',
    '019b6000-0000-7000-8000-000000000015');

select support.bootstrap_backoffice_administrators(
  '019b6000-0000-7000-8000-000000000011', 'alpha_health',
  '019b6000-0000-7000-8000-000000000012', 'beta_health',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-HEALTH-01'
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
  ('019b6000-0000-7000-8000-000000000211'::uuid, '019b6000-0000-7000-8000-000000000111'::uuid,
    'alpha_health', 'c1'),
  ('019b6000-0000-7000-8000-000000000213'::uuid, '019b6000-0000-7000-8000-000000000113'::uuid,
    'gamma_health', 'c3'),
  ('019b6000-0000-7000-8000-000000000214'::uuid, '019b6000-0000-7000-8000-000000000114'::uuid,
    'delta_health', 'c4'),
  ('019b6000-0000-7000-8000-000000000215'::uuid, '019b6000-0000-7000-8000-000000000115'::uuid,
    'epsilon_health', 'c5')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b6000-0000-7000-8000-000000000011', '019b6000-0000-7000-8000-000000000211',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b6000-0000-7000-8000-000000000013'::uuid, '019b6000-0000-7000-8000-000000000313'::uuid,
    '019b6000-0000-7000-8000-000000000413'::uuid, 'e3'),
  ('019b6000-0000-7000-8000-000000000014'::uuid, '019b6000-0000-7000-8000-000000000314'::uuid,
    '019b6000-0000-7000-8000-000000000414'::uuid, 'e4'),
  ('019b6000-0000-7000-8000-000000000015'::uuid, '019b6000-0000-7000-8000-000000000315'::uuid,
    '019b6000-0000-7000-8000-000000000415'::uuid, 'e5')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019b6000-0000-7000-8000-000000000011', '019b6000-0000-7000-8000-000000000211',
  person_id, duty_code, clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-010', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b6000-0000-7000-8000-000000000013'::uuid, 'request_break_glass',
    '019b6000-0000-7000-8000-000000000323'::uuid, '019b6000-0000-7000-8000-000000000423'::uuid, 'f3'),
  ('019b6000-0000-7000-8000-000000000014'::uuid, 'approve_break_glass',
    '019b6000-0000-7000-8000-000000000324'::uuid, '019b6000-0000-7000-8000-000000000424'::uuid, 'f4'),
  ('019b6000-0000-7000-8000-000000000015'::uuid, 'approve_break_glass',
    '019b6000-0000-7000-8000-000000000325'::uuid, '019b6000-0000-7000-8000-000000000425'::uuid, 'f5')
) as duty_row(person_id, duty_code, key, command, hash_byte);

create function pg_temp.declare(
  p_subject text, p_claim uuid, p_type text, p_description text, p_area text,
  p_from timestamptz, p_to timestamptz default null,
  p_key uuid default gen_random_uuid(), p_hash bytea default extensions.gen_random_bytes(32)
) returns table (result jsonb, replayed boolean)
language sql as $fn$
  select * from identity.record_health_context(
    'workos', 'https://issuer.test', p_subject, p_claim, p_type, p_description, p_area,
    p_from, p_to, p_key, p_hash
  )
$fn$;

create function pg_temp.forget(
  p_subject text, p_claim uuid, p_key uuid default gen_random_uuid(),
  p_command uuid default extensions.uuid_generate_v7(),
  p_hash bytea default extensions.gen_random_bytes(32)
) returns table (result jsonb, replayed boolean)
language sql as $fn$
  select * from identity.delete_health_context(
    'workos', 'https://issuer.test', p_subject, p_claim, p_key, p_command, p_hash
  )
$fn$;

-- ---------------------------------------------------------------------------
-- Where a claim comes from
-- ---------------------------------------------------------------------------

select is(
  enum_range(null::identity.provenance)::text[],
  array['person_declared', 'professional_observation', 'device_observed', 'system_inferred',
        'authority_verified'],
  'provenance is one of the five origins the glossary names'
);

-- ---------------------------------------------------------------------------
-- Declaring
-- ---------------------------------------------------------------------------

create temporary table knee on commit drop as
select * from pg_temp.declare(
  'subject_health', '019b6000-0000-7000-8000-000000000501', 'pain',
  'Me duele la rodilla al bajar escaleras', 'knee', now() - interval '10 days', null,
  'a0000000-0000-4000-8000-000000000501', decode(repeat('51', 32), 'hex')
);

select results_eq(
  $$ select result->>'context_type', result->>'description', result->>'body_area',
            result->>'provenance', result->'valid_to', replayed
     from knee $$,
  $$ values ('pain'::text, 'Me duele la rodilla al bajar escaleras'::text, 'knee'::text,
             'person_declared'::text, 'null'::jsonb, false) $$,
  'a person declares a pain in their own words, and it is theirs to declare'
);

select is(
  (select person_id from identity.health_context_claims
   where id = '019b6000-0000-7000-8000-000000000501'),
  '019b6000-0000-7000-8000-000000000001'::uuid,
  'the claim belongs to the person the token resolves to, and its id is the command'
);

select results_eq(
  $$ select result->>'context_type', replayed
     from pg_temp.declare('subject_health', '019b6000-0000-7000-8000-000000000501', 'pain',
       'Me duele la rodilla al bajar escaleras', 'knee', now() - interval '10 days', null,
       'a0000000-0000-4000-8000-000000000501', decode(repeat('51', 32), 'hex')) $$,
  $$ values ('pain'::text, true) $$,
  'a retried declaration answers the same claim instead of a second one'
);

select throws_ok(
  $$ select * from pg_temp.declare('subject_health', '019b6000-0000-7000-8000-000000000501',
       'pain', 'Me duele mucho', 'knee', now() - interval '10 days', null,
       'a0000000-0000-4000-8000-000000000501', decode(repeat('52', 32), 'hex')) $$,
  '23505', null,
  'the same key with other words is a conflict, not a correction'
);

select throws_ok(
  $$ select * from pg_temp.declare('subject_health', extensions.uuid_generate_v7(), 'diagnosis',
       'Tendinitis rotuliana', null, now()) $$,
  '22023', null,
  'a diagnosis is not a type V1 keeps'
);

select throws_ok(
  $$ select * from pg_temp.declare('subject_health', extensions.uuid_generate_v7(), 'pain',
       '   ', null, now()) $$,
  '22023', null,
  'a claim says something'
);

select throws_ok(
  $$ select * from pg_temp.declare('subject_health', extensions.uuid_generate_v7(), 'pain',
       repeat('a', 501), null, now()) $$,
  '22023', null,
  'and says it briefly: this is not a clinical record'
);

select throws_ok(
  $$ select * from pg_temp.declare('subject_health', extensions.uuid_generate_v7(), 'pain',
       'Molestia', 'left_pinky_toe', now()) $$,
  '22023', null,
  'a body area comes from the closed list'
);

select throws_ok(
  $$ select * from pg_temp.declare('subject_health', extensions.uuid_generate_v7(), 'limitation',
       'No puedo correr', null, now() + interval '3 days') $$,
  '22023', null,
  'a claim does not start next week'
);

select throws_ok(
  $$ select * from pg_temp.declare('subject_health', extensions.uuid_generate_v7(), 'recovery',
       'Recuperación de esguince', 'ankle_foot', now() - interval '1 day',
       now() - interval '2 days') $$,
  '22023', null,
  'nor ends before it starts'
);

select throws_ok(
  $$ select * from pg_temp.declare('nobody_health', extensions.uuid_generate_v7(), 'pain',
       'Molestia', null, now()) $$,
  '42501', null,
  'a token that resolves to no account declares nothing'
);

select throws_ok(
  $$ select * from pg_temp.declare('closed_health', extensions.uuid_generate_v7(), 'pain',
       'Molestia', null, now()) $$,
  '42501', null,
  'nor does a closed person'
);

select is(
  (select array_agg(field order by field)
   from system.outbox_events, jsonb_object_keys(payload) as field
   where aggregate_id = '019b6000-0000-7000-8000-000000000501'
     and event_type = 'identity.health_context_declared.v1'),
  array['health_context_claim_id'],
  'the event says a claim exists, never what it says'
);

select is(
  (select count(*)::integer from system.outbox_events
   where aggregate_id = '019b6000-0000-7000-8000-000000000501'),
  1,
  'and says it once, however many times the declaration is retried'
);

select throws_ok(
  $$ update identity.health_context_claims set description = 'Ya no duele'
     where id = '019b6000-0000-7000-8000-000000000501' $$,
  '55000', null,
  'a declared claim is never rewritten: it is deleted or kept'
);

select throws_ok(
  $$ insert into identity.health_context_claims (
       id, person_id, context_type, description, provenance, valid_from
     ) values (
       extensions.uuid_generate_v7(), '019b6000-0000-7000-8000-000000000001', 'pain', '',
       'person_declared', now()
     ) $$,
  '23514', null,
  'the table refuses an empty claim even from its owner'
);

-- ---------------------------------------------------------------------------
-- Reading my own
-- ---------------------------------------------------------------------------

select * from pg_temp.declare('subject_health', '019b6000-0000-7000-8000-000000000502',
  'limitation', 'No puedo levantar los brazos por encima de la cabeza', 'shoulder',
  now() - interval '5 days');
select * from pg_temp.declare('subject_health', '019b6000-0000-7000-8000-000000000503',
  'recovery', 'Recuperación de esguince', 'ankle_foot', now() - interval '2 days',
  now() + interval '20 days');
select * from pg_temp.declare('other_health', '019b6000-0000-7000-8000-000000000601',
  'pain', 'Dolor lumbar', 'lower_back', now() - interval '1 day');

select results_eq(
  $$ select entry->>'id' from jsonb_array_elements(identity.list_health_context(
       'workos', 'https://issuer.test', 'subject_health', 50
     )->'items') as entry $$,
  $$ values ('019b6000-0000-7000-8000-000000000503'::text),
            ('019b6000-0000-7000-8000-000000000502'::text),
            ('019b6000-0000-7000-8000-000000000501'::text) $$,
  'a person reads their own claims, newest first, and nobody else''s'
);

select is(
  (select identity.list_health_context('workos', 'https://issuer.test', 'subject_health', 2)
     ->>'has_more'),
  'true',
  'the list says when there is more than it returned'
);

select results_eq(
  $$ select entry->>'id' from jsonb_array_elements(identity.list_health_context(
       'workos', 'https://issuer.test', 'subject_health', 50,
       (select valid_from from identity.health_context_claims
        where id = '019b6000-0000-7000-8000-000000000502'),
       '019b6000-0000-7000-8000-000000000502'
     )->'items') as entry $$,
  $$ values ('019b6000-0000-7000-8000-000000000501'::text) $$,
  'and continues after the last one it returned'
);

select throws_ok(
  $$ select identity.list_health_context('workos', 'https://issuer.test', 'nobody_health', 10) $$,
  '42501', null,
  'a token that resolves to nobody reads nothing'
);

select throws_ok(
  $$ select identity.list_health_context('workos', 'https://issuer.test', 'subject_health', 0) $$,
  '22023', null,
  'a page has a size'
);

-- ---------------------------------------------------------------------------
-- Support reads it through its own restricted window
-- ---------------------------------------------------------------------------

-- Each API request is its own transaction; this one switches actor explicitly.
select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b6000-0000-7000-8000-000000000013', true);

create temporary table health_window on commit drop as
select result from support.request_break_glass(
  '019b6000-0000-7000-8000-000000000013', '019b6000-0000-7000-8000-000000000213',
  '019b6000-0000-7000-8000-000000000001', array['health_context'],
  'customer_support_request', 'CASE-2026-010',
  'b0000000-0000-4000-8000-000000000711', '019b6000-0000-7000-8000-000000000711',
  decode(repeat('71', 32), 'hex')
);

select support.decide_break_glass(
  person_id, session_id, (select (result->>'id')::uuid from health_window), 'approved',
  'REASON-OK', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b6000-0000-7000-8000-000000000014'::uuid, '019b6000-0000-7000-8000-000000000214'::uuid,
    'b0000000-0000-4000-8000-000000000712'::uuid, '019b6000-0000-7000-8000-000000000712'::uuid, '72'),
  ('019b6000-0000-7000-8000-000000000015'::uuid, '019b6000-0000-7000-8000-000000000215'::uuid,
    'b0000000-0000-4000-8000-000000000713'::uuid, '019b6000-0000-7000-8000-000000000713'::uuid, '73')
) as approval(person_id, session_id, key, command, hash_byte);

create temporary table health_read on commit drop as
select support.exercise_break_glass(
  '019b6000-0000-7000-8000-000000000013', '019b6000-0000-7000-8000-000000000213',
  (select (result->>'id')::uuid from health_window), 'health_context',
  'identity.health_context_claims', null
) as answer;

select results_eq(
  $$ select answer->>'outcome', jsonb_array_length(answer->'content'->'health_context')
     from health_read $$,
  $$ values ('allowed'::text, 3) $$,
  'the approved window reads the subject''s three claims'
);

select ok(
  (select bool_and(entry ? 'context_type' and entry ? 'description' and entry ? 'provenance'
                   and entry ? 'valid_from' and not entry ? 'person_id')
   from health_read, jsonb_array_elements(answer->'content'->'health_context') as entry),
  'each carries what was declared and where it came from, never whose it is'
);

select ok(
  (select position('019b6000-0000-7000-8000-000000000601' in answer::text) = 0
     and position('Dolor lumbar' in answer::text) = 0
   from health_read),
  'another person''s claim never enters the window'
);

select is(
  (select result from privacy.access_events
   where actor_person_id = '019b6000-0000-7000-8000-000000000013'
     and subject_person_id = '019b6000-0000-7000-8000-000000000001'
     and resource = 'identity.health_context_claims'
   order by occurred_at desc limit 1),
  'allowed',
  'the read is recorded against the person before the content is returned'
);

select is(
  (select support.exercise_break_glass(
     '019b6000-0000-7000-8000-000000000013', '019b6000-0000-7000-8000-000000000213',
     (select (result->>'id')::uuid from health_window), 'health_context',
     'identity.body_progress_records', null
   )->>'reason_code'),
  'resource_out_of_scope',
  'a health window cannot be pointed at another kind of data'
);

-- ---------------------------------------------------------------------------
-- Deleting my own
-- ---------------------------------------------------------------------------

create temporary table forgotten on commit drop as
select * from pg_temp.forget(
  'subject_health', '019b6000-0000-7000-8000-000000000502', 'a0000000-0000-4000-8000-000000000802',
  '019b6000-0000-7000-8000-000000000803', decode(repeat('82', 32), 'hex')
);

select results_eq(
  $$ select result->>'health_context_claim_id', result->>'status', replayed from forgotten $$,
  $$ values ('019b6000-0000-7000-8000-000000000502'::text, 'deleted'::text, false) $$,
  'a person deletes their own claim'
);

select is(
  (select count(*)::integer from identity.health_context_claims
   where id = '019b6000-0000-7000-8000-000000000502'),
  0,
  'and it is gone from the table, not hidden'
);

select results_eq(
  $$ select dcase.origin, dcase.status, item.data_classification_code, item.action::text,
            item.status::text, item.target_kind, item.target_health_context_id is null,
            item.target_body_progress_id is null, item.executed_at is not null
     from privacy.disposition_cases as dcase
     join privacy.disposition_items as item on item.disposition_case_id = dcase.id
     where dcase.id = (select (result->>'disposition_case_id')::uuid from forgotten) $$,
  $$ values ('request'::text, 'closed'::text, 'health'::text, 'delete'::text, 'executed'::text,
             'health_context'::text, true, true, true) $$,
  'what stays is a closed health case with no pointer to what it deleted'
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
     and policy.data_classification_code = 'health' and policy.jurisdiction = 'CO'
     and policy.trigger = 'owner_request' and policy.default_action = 'delete'),
  true,
  'and it names the health policy it followed'
);

select results_eq(
  $$ select (result->>'disposition_case_id'), replayed
     from pg_temp.forget('subject_health', '019b6000-0000-7000-8000-000000000502',
       'a0000000-0000-4000-8000-000000000802', '019b6000-0000-7000-8000-000000000803',
       decode(repeat('82', 32), 'hex')) $$,
  $$ select result->>'disposition_case_id', true from forgotten $$,
  'a retried deletion answers the same case instead of opening another'
);

-- T-IDEM-08: the declaration ran, and its claim is gone.
select * from pg_temp.declare(
  'subject_health', '019b6000-0000-7000-8000-000000000504', 'pain', 'Molestia pasajera', null,
  now() - interval '3 days', null,
  'a0000000-0000-4000-8000-000000000504', decode(repeat('54', 32), 'hex')
);
select * from pg_temp.forget('subject_health', '019b6000-0000-7000-8000-000000000504');

select throws_ok(
  $$ select * from pg_temp.declare(
       'subject_health', '019b6000-0000-7000-8000-000000000504', 'pain', 'Molestia pasajera',
       null, now() - interval '3 days', null,
       'a0000000-0000-4000-8000-000000000504', decode(repeat('54', 32), 'hex')) $$,
  'AF410', null,
  'replaying the declaration of a deleted claim says it was deleted, and does not bring it back'
);

select throws_ok(
  $$ select * from pg_temp.forget('other_health', '019b6000-0000-7000-8000-000000000501') $$,
  'P0002', null,
  'nobody deletes someone else''s claim'
);

select is(
  (select count(*)::integer from identity.health_context_claims
   where id = '019b6000-0000-7000-8000-000000000501'),
  1,
  'and trying leaves it where it was'
);

select throws_ok(
  $$ select * from pg_temp.forget('subject_health', '019b6000-0000-7000-8000-000000000999') $$,
  'P0002', null,
  'a claim that does not exist is not found'
);

select is(
  (select count(*)::integer from system.outbox_events
   where event_type = 'privacy.disposition_case_opened.v1'
     and aggregate_id = (select (result->>'disposition_case_id')::uuid from forgotten)),
  1,
  'the case opening is announced once'
);

-- ---------------------------------------------------------------------------
-- One disposition for both kinds of data
-- ---------------------------------------------------------------------------

-- A statement does not see rows written by functions it calls, so each step is its own.
create temporary table weighed on commit drop as
select * from identity.record_body_progress(
  'workos', 'https://issuer.test', 'subject_health', '019b6000-0000-7000-8000-000000000551',
  'body_weight', 70, 'kg', current_date, gen_random_uuid(), extensions.gen_random_bytes(32)
);

create temporary table unweighed on commit drop as
select * from identity.delete_body_progress(
  'workos', 'https://issuer.test', 'subject_health', '019b6000-0000-7000-8000-000000000551',
  gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
);

select results_eq(
  $$ select item.data_classification_code, item.target_kind
     from privacy.disposition_items as item
     where item.disposition_case_id = (
       select (result->>'disposition_case_id')::uuid from unweighed
     ) $$,
  $$ values ('body'::text, 'body_progress'::text) $$,
  'a measurement is still deleted under the body policy through the shared path'
);

insert into privacy.disposition_cases (id, subject_person_id, origin, requested_by_person_id)
values ('019b6000-0000-7000-8000-000000000901', '019b6000-0000-7000-8000-000000000001',
  'request', '019b6000-0000-7000-8000-000000000001');

insert into privacy.disposition_items (
  disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
  action, target_kind, target_health_context_id
)
select '019b6000-0000-7000-8000-000000000901', '019b6000-0000-7000-8000-000000000001', 'health',
  policy.id, 'delete', 'health_context', '019b6000-0000-7000-8000-000000000503'
from privacy.retention_policies as policy
where policy.data_classification_code = 'health' and policy.trigger = 'owner_request';

select throws_ok(
  $$ delete from identity.health_context_claims
     where id = '019b6000-0000-7000-8000-000000000503' $$,
  '23503', null,
  'a claim under a pending disposition is not deleted around it'
);

select throws_ok(
  $$ insert into privacy.disposition_items (
       disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
       action, target_kind, target_health_context_id
     )
     select '019b6000-0000-7000-8000-000000000901', '019b6000-0000-7000-8000-000000000001',
       'health', policy.id, 'delete', 'health_context', '019b6000-0000-7000-8000-000000000601'
     from privacy.retention_policies as policy
     where policy.data_classification_code = 'health' and policy.trigger = 'owner_request' $$,
  '23514', null,
  'a disposition cannot target another person''s claim'
);

select throws_ok(
  $$ insert into privacy.disposition_items (
       disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
       action, target_kind, target_health_context_id
     )
     select '019b6000-0000-7000-8000-000000000901', '019b6000-0000-7000-8000-000000000001',
       'body', policy.id, 'delete', 'health_context', '019b6000-0000-7000-8000-000000000501'
     from privacy.retention_policies as policy
     where policy.data_classification_code = 'body' and policy.trigger = 'owner_request' $$,
  '23514', null,
  'health data is never disposed of under the body policy'
);

select throws_ok(
  $$ insert into privacy.disposition_items (
       disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
       action, target_kind, target_body_progress_id
     )
     select '019b6000-0000-7000-8000-000000000901', '019b6000-0000-7000-8000-000000000001',
       'health', policy.id, 'delete', 'health_context',
       (select id from identity.body_progress_records
        where person_id = '019b6000-0000-7000-8000-000000000001' limit 1)
     from privacy.retention_policies as policy
     where policy.data_classification_code = 'health' and policy.trigger = 'owner_request' $$,
  '23514', null,
  'a health item never carries a body target'
);

-- A legal move of status, so only the target rule can refuse it.
select throws_ok(
  $$ update privacy.disposition_items
     set status = 'suspended', target_health_context_id = '019b6000-0000-7000-8000-000000000501'
     where disposition_case_id = '019b6000-0000-7000-8000-000000000901' $$,
  '55000', null,
  'a pending disposition never changes what it targets, even while it moves'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('allfit_api', 'identity.health_context_claims', 'SELECT, INSERT, UPDATE, DELETE'),
  'the runtime touches no health claim directly'
);

select ok(
  has_function_privilege('allfit_api',
    'identity.record_health_context(text,text,text,uuid,text,text,text,timestamptz,timestamptz,uuid,bytea)',
    'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.list_health_context(text,text,text,integer,timestamptz,uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'identity.delete_health_context(text,text,text,uuid,uuid,uuid,bytea)', 'EXECUTE')
  and not has_function_privilege('allfit_api',
    'identity.health_context_projection(uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api',
    'privacy.dispose_on_owner_request(uuid,text,text,uuid)', 'EXECUTE'),
  'it runs the three commands and nothing behind them'
);

select * from finish();
rollback;
