-- T-PRV-ERASURE-01 — PR-013 + PR-023 / OP-PRV-021: following erasure requests.
--
-- `HU-BO-032`. The panel answers "what did this person ask us to erase, and did we
-- finish it". It is a tracking screen, so much of what is asserted here is about
-- what it must *not* turn into: a way to read the person's data, a way to read
-- their name, or a list that quietly drops the case somebody is waiting on.
--
-- Two things are worth reading carefully.
--
-- The panel lists **requests**, not every disposition. A case opened by a retention
-- policy disposes of the same data under the same rules, but nobody asked for it
-- and nobody is waiting on an answer, so it does not belong on a screen whose whole
-- purpose is the thirty-day clock. The origin travels anyway, so widening the list
-- later is a filter and not a new projection.
--
-- The thirty days are returned as an instant, never as "days left". A number of
-- days computed here is computed in the database's zone, and the officer reading
-- the screen is the one who has to know whether it is late.
--
-- Today every owner request opens and closes inside one transaction, so the open
-- half of this file is fed by cases inserted directly. That is deliberate: the
-- moment one disposition needs a worker or a legal hold, the panel already knows
-- how to show it, and this file already says what it should look like.

begin;

select plan(30);

-- ---------------------------------------------------------------------------
-- People, sessions and roles
-- ---------------------------------------------------------------------------

insert into identity.people (id, given_name, family_name, status)
values
  ('019ac000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019ac000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019ac000-0000-7000-8000-000000000003', 'Officer', 'Gamma', 'active'),
  ('019ac000-0000-7000-8000-000000000004', 'Operator', 'Delta', 'active'),
  ('019ac000-0000-7000-8000-000000000005', 'Subject', 'Zeta', 'active'),
  ('019ac000-0000-7000-8000-000000000006', 'Subject', 'Eta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019ac000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alphaE', null),
  ('019ac000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'betaE', null),
  ('019ac000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gammaE',
    '019ac000-0000-7000-8000-000000000003'),
  ('019ac000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'deltaE',
    '019ac000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019ac000-0000-7000-8000-000000000001', 'alphaE',
  '019ac000-0000-7000-8000-000000000002', 'betaE',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-ERA-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019ac000-0000-7000-8000-000000000021', '019ac000-0000-7000-8000-000000000011',
    'sid_alpha_e', 'backoffice', decode(repeat('c1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ac000-0000-7000-8000-000000000023', '019ac000-0000-7000-8000-000000000013',
    'sid_gamma_e', 'backoffice', decode(repeat('c3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  -- The same officer, signed in to a different product.
  ('019ac000-0000-7000-8000-000000000024', '019ac000-0000-7000-8000-000000000013',
    'sid_gamma_studio_e', 'studio', decode(repeat('c4', 32), 'hex'), 'v1.gammastudio',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019ac000-0000-7000-8000-000000000025', '019ac000-0000-7000-8000-000000000014',
    'sid_delta_e', 'backoffice', decode(repeat('c5', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019ac000-0000-7000-8000-000000000001', '019ac000-0000-7000-8000-000000000021',
  '019ac000-0000-7000-8000-000000000003', 'allfit_admin',
  '019ac000-0000-7000-8000-000000000101', '019ac000-0000-7000-8000-000000000201',
  decode(repeat('61', 32), 'hex')
);
select support.assign_platform_role(
  '019ac000-0000-7000-8000-000000000001', '019ac000-0000-7000-8000-000000000021',
  '019ac000-0000-7000-8000-000000000004', 'allfit_admin',
  '019ac000-0000-7000-8000-000000000102', '019ac000-0000-7000-8000-000000000202',
  decode(repeat('62', 32), 'hex')
);

-- ---------------------------------------------------------------------------
-- What the officer will be following
-- ---------------------------------------------------------------------------

-- A pending item holds exactly one target, so what it disposes of has to exist.
insert into identity.body_progress_records (
  id, person_id, metric_code, value_numeric, unit_code, measured_on
) values
  ('019ac000-0000-7000-8000-000000000301', '019ac000-0000-7000-8000-000000000005',
    'body_weight', 70, 'kg', date '2026-09-01'),
  ('019ac000-0000-7000-8000-000000000303', '019ac000-0000-7000-8000-000000000006',
    'body_weight', 80, 'kg', date '2026-09-02'),
  ('019ac000-0000-7000-8000-000000000304', '019ac000-0000-7000-8000-000000000005',
    'hip', 95, 'cm', date '2026-09-03'),
  ('019ac000-0000-7000-8000-000000000305', '019ac000-0000-7000-8000-000000000005',
    'chest', 100, 'cm', date '2026-09-05');

insert into identity.health_context_claims (
  id, person_id, context_type, description, body_area, provenance, valid_from
) values (
  '019ac000-0000-7000-8000-000000000311', '019ac000-0000-7000-8000-000000000005',
  'pain', 'Molestia declarada', 'knee', 'person_declared', clock_timestamp()
);

-- A policy that keeps data instead of deleting it, so the panel has something to
-- report as retained. Nothing in V1 publishes one yet.
insert into privacy.retention_policies (
  id, data_classification_code, jurisdiction, version_number,
  default_action, retention_period, trigger
) values (
  '019ac000-0000-7000-8000-000000000401', 'health', 'CO', 2,
  'retain_restricted', interval '365 days', 'legal_obligation'
);

insert into privacy.disposition_cases (
  id, subject_person_id, origin, status, requested_by_person_id, opened_at
) values
  -- Twenty-six days old: inside the thirty, and close enough to matter.
  ('019ac000-0000-7000-8000-000000000501', '019ac000-0000-7000-8000-000000000005',
    'request', 'open', '019ac000-0000-7000-8000-000000000005',
    clock_timestamp() - interval '26 days'),
  -- Forty days old: past the target date.
  ('019ac000-0000-7000-8000-000000000502', '019ac000-0000-7000-8000-000000000006',
    'request', 'open', '019ac000-0000-7000-8000-000000000006',
    clock_timestamp() - interval '40 days'),
  -- Nobody asked for this one, and nobody is waiting on it.
  ('019ac000-0000-7000-8000-000000000503', '019ac000-0000-7000-8000-000000000005',
    'retention', 'open', null, clock_timestamp() - interval '3 days');

insert into privacy.disposition_items (
  id, disposition_case_id, subject_person_id, data_classification_code,
  retention_policy_id, action, status, target_kind,
  target_body_progress_id, target_health_context_id
) values
  ('019ac000-0000-7000-8000-000000000601', '019ac000-0000-7000-8000-000000000501',
    '019ac000-0000-7000-8000-000000000005', 'body',
    (select id from privacy.retention_policies
      where data_classification_code = 'body' and version_number = 1),
    'delete', 'pending', 'body_progress',
    '019ac000-0000-7000-8000-000000000301', null),
  ('019ac000-0000-7000-8000-000000000602', '019ac000-0000-7000-8000-000000000501',
    '019ac000-0000-7000-8000-000000000005', 'health',
    '019ac000-0000-7000-8000-000000000401',
    'retain_restricted', 'pending', 'health_context',
    null, '019ac000-0000-7000-8000-000000000311'),
  ('019ac000-0000-7000-8000-000000000603', '019ac000-0000-7000-8000-000000000502',
    '019ac000-0000-7000-8000-000000000006', 'body',
    (select id from privacy.retention_policies
      where data_classification_code = 'body' and version_number = 1),
    'delete', 'pending', 'body_progress',
    '019ac000-0000-7000-8000-000000000303', null),
  ('019ac000-0000-7000-8000-000000000604', '019ac000-0000-7000-8000-000000000503',
    '019ac000-0000-7000-8000-000000000005', 'body',
    (select id from privacy.retention_policies
      where data_classification_code = 'body' and version_number = 1),
    'delete', 'pending', 'body_progress',
    '019ac000-0000-7000-8000-000000000304', null);

-- The retained item is resolved: kept, and the panel has to say until when.
select privacy.log_disposition_event(
  '019ac000-0000-7000-8000-000000000602', 'retain_restricted', 'retained', 'privacy_worker'
);
update privacy.disposition_items
set status = 'executed', executed_at = clock_timestamp() - interval '20 days'
where id = '019ac000-0000-7000-8000-000000000602';

-- And one request that went the whole way through the real path, which closes it.
select privacy.dispose_on_owner_request(
  '019ac000-0000-7000-8000-000000000005', 'body', 'body_progress',
  '019ac000-0000-7000-8000-000000000305'
);

-- ---------------------------------------------------------------------------
-- Criterion 4 — the duty, and only the duty, opens this
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from privacy.list_erasure_requests(
    '019ac000-0000-7000-8000-000000000004', '019ac000-0000-7000-8000-000000000025',
    'open', 50, null, null
  ) $$,
  '42501',
  null,
  'the platform administrator role alone cannot follow erasure requests'
);

select support.assign_platform_duty(
  '019ac000-0000-7000-8000-000000000001', '019ac000-0000-7000-8000-000000000021',
  '019ac000-0000-7000-8000-000000000004', 'audit_platform_access',
  clock_timestamp(), clock_timestamp() + interval '7 days', 'CASE-ERA-DELTA',
  '019ac000-0000-7000-8000-000000000103', '019ac000-0000-7000-8000-000000000203',
  decode(repeat('63', 32), 'hex')
);

select throws_ok(
  $$ select * from privacy.list_erasure_requests(
    '019ac000-0000-7000-8000-000000000004', '019ac000-0000-7000-8000-000000000025',
    'open', 50, null, null
  ) $$,
  '42501',
  null,
  'another duty does not open the erasure panel'
);

select support.assign_platform_duty(
  '019ac000-0000-7000-8000-000000000001', '019ac000-0000-7000-8000-000000000021',
  '019ac000-0000-7000-8000-000000000003', 'manage_privacy_requests',
  clock_timestamp(), clock_timestamp() + interval '7 days', 'CASE-ERA-GAMMA',
  '019ac000-0000-7000-8000-000000000104', '019ac000-0000-7000-8000-000000000204',
  decode(repeat('64', 32), 'hex')
);

select throws_ok(
  $$ select * from privacy.list_erasure_requests(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000024',
    'open', 50, null, null
  ) $$,
  '42501',
  null,
  'a session signed in to another product does not carry the duty'
);

-- ---------------------------------------------------------------------------
-- The audit trail, written before anything is shown
-- ---------------------------------------------------------------------------

create temporary table open_list on commit drop as
select * from privacy.list_erasure_requests(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  'open', 50, null, null
) as listed
where true
  and subject_person_id in (
    '019ac000-0000-7000-8000-000000000005', '019ac000-0000-7000-8000-000000000006'
  );

select is(
  (select count(*)::int from privacy.access_events
    where actor_person_id = '019ac000-0000-7000-8000-000000000003'
      and resource = 'privacy.disposition_cases'
      and subject_person_id in (
        '019ac000-0000-7000-8000-000000000005', '019ac000-0000-7000-8000-000000000006'
      )),
  2,
  'every request revealed is recorded before the officer sees it'
);

select is(
  (select count(*)::int from privacy.access_events
    where actor_person_id = '019ac000-0000-7000-8000-000000000003'
      and resource = 'privacy.disposition_cases'
      and purpose = 'privacy_request_tracking'
      and access_mode = 'support_metadata'
      and result = 'allowed'
      and subject_person_id in (
        '019ac000-0000-7000-8000-000000000005', '019ac000-0000-7000-8000-000000000006'
      )),
  2,
  'the record says it was a minimised support read, allowed'
);

select is(
  (select count(*)::int from privacy.access_events
    where actor_person_id = '019ac000-0000-7000-8000-000000000004'),
  0,
  'a refused read reveals nothing, so it records no access'
);

-- ---------------------------------------------------------------------------
-- Criterion 1 — the open requests, since when, and what is missing
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from open_list),
  2,
  'the panel lists the two open requests'
);

select is(
  (select count(*)::int from open_list where id = '019ac000-0000-7000-8000-000000000503'),
  0,
  'a case nobody asked for is not an erasure request'
);

select is(
  (select date_trunc('day', opened_at) from open_list
    where id = '019ac000-0000-7000-8000-000000000502'),
  date_trunc('day', clock_timestamp() - interval '40 days'),
  'each request says since when it has been waiting'
);

select is(
  (select due_at from open_list where id = '019ac000-0000-7000-8000-000000000501'),
  (select opened_at + interval '30 days' from open_list
    where id = '019ac000-0000-7000-8000-000000000501'),
  'the target date is thirty days after the request arrived'
);

select ok(
  (select due_at < clock_timestamp() from open_list
    where id = '019ac000-0000-7000-8000-000000000502'),
  'a request older than thirty days is already past its target date'
);

select is(
  (select pending_items from open_list where id = '019ac000-0000-7000-8000-000000000501'),
  1,
  'what is missing to close a request is counted'
);

select is(
  (select resolved_items from open_list where id = '019ac000-0000-7000-8000-000000000501'),
  1,
  'what is already resolved is counted apart from what is missing'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — the resolution, category by category
-- ---------------------------------------------------------------------------

select is(
  (select jsonb_array_length(categories) from open_list
    where id = '019ac000-0000-7000-8000-000000000501'),
  2,
  'the resolution is reported one line per category and outcome'
);

select is(
  (select category->>'action' from open_list,
    jsonb_array_elements(categories) as category
    where id = '019ac000-0000-7000-8000-000000000501'
      and category->>'data_classification_code' = 'body'),
  'delete',
  'the category still waiting says it will be deleted'
);

select is(
  (select category->>'status' from open_list,
    jsonb_array_elements(categories) as category
    where id = '019ac000-0000-7000-8000-000000000501'
      and category->>'data_classification_code' = 'body'),
  'pending',
  'and that it has not happened yet'
);

select is(
  (select category->>'result' from open_list,
    jsonb_array_elements(categories) as category
    where id = '019ac000-0000-7000-8000-000000000501'
      and category->>'data_classification_code' = 'health'),
  'retained',
  'the category that was kept says so'
);

select is(
  (select date_trunc('day', (category->>'retained_until')::timestamptz) from open_list,
    jsonb_array_elements(categories) as category
    where id = '019ac000-0000-7000-8000-000000000501'
      and category->>'data_classification_code' = 'health'),
  date_trunc('day', clock_timestamp() + interval '345 days'),
  'what is kept says until when, from its own policy'
);

-- A hold names the dispositions it stops, so the panel has to carry them.
select is(
  (select jsonb_array_length(category->'item_ids') from open_list,
    jsonb_array_elements(categories) as category
    where id = '019ac000-0000-7000-8000-000000000501'
      and category->>'data_classification_code' = 'body'),
  1,
  'each line carries the dispositions it is made of'
);

select ok(
  (select (category->>'retained_until') is null from open_list,
    jsonb_array_elements(categories) as category
    where id = '019ac000-0000-7000-8000-000000000501'
      and category->>'data_classification_code' = 'body'),
  'what is deleted is not kept until any date'
);

-- ---------------------------------------------------------------------------
-- The closed half, and the real path
-- ---------------------------------------------------------------------------

create temporary table closed_list on commit drop as
select * from privacy.list_erasure_requests(
  '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
  'closed', 50, null, null
) as listed
where true
  and subject_person_id in (
    '019ac000-0000-7000-8000-000000000005', '019ac000-0000-7000-8000-000000000006'
  );

select is(
  (select count(*)::int from closed_list),
  1,
  'a request the platform already resolved moves to the closed list'
);

select is(
  (select pending_items from closed_list),
  0,
  'a closed request has nothing left to do'
);

select isnt(
  (select closed_at from closed_list),
  null,
  'and it says when it was closed'
);

select is(
  (select category->>'result' from closed_list,
    jsonb_array_elements(categories) as category),
  'deleted',
  'and what was erased'
);

-- ---------------------------------------------------------------------------
-- Minimisation, order and paging
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(row_to_json(entry)::text not like '%Zeta%') from open_list as entry),
  'the panel names the person by identifier and never by name'
);

select is(
  (select array_agg(id order by rank) from (
    select id, row_number() over () as rank from privacy.list_erasure_requests(
      '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
      'open', 50, null, null
    ) as listed
    where true
  and subject_person_id in (
    '019ac000-0000-7000-8000-000000000005', '019ac000-0000-7000-8000-000000000006'
  )
  ) as ordered),
  array[
    '019ac000-0000-7000-8000-000000000502'::uuid,
    '019ac000-0000-7000-8000-000000000501'::uuid
  ],
  'the request that has waited longest is answered first'
);

select is(
  (select count(*)::int from privacy.list_erasure_requests(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    'open', 50,
    (select opened_at from open_list where id = '019ac000-0000-7000-8000-000000000502'),
    '019ac000-0000-7000-8000-000000000502'
  ) as listed
  where true
  and subject_person_id in (
    '019ac000-0000-7000-8000-000000000005', '019ac000-0000-7000-8000-000000000006'
  )),
  1,
  'the page continues after the request it was given'
);

select is(
  (select id from privacy.list_erasure_requests(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    'open', 1,
    (select opened_at - interval '1 second' from open_list
      where id = '019ac000-0000-7000-8000-000000000502'),
    '00000000-0000-0000-0000-000000000000'
  )),
  '019ac000-0000-7000-8000-000000000502'::uuid,
  'a page of one carries the request that has waited longest'
);

select throws_ok(
  $$ select * from privacy.list_erasure_requests(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    'everything', 50, null, null
  ) $$,
  '22023',
  null,
  'a state the panel does not have is refused instead of ignored'
);

-- Half a cursor would page from the start, which on this screen reads as
-- "nothing else is owed".
select throws_ok(
  $$ select * from privacy.list_erasure_requests(
    '019ac000-0000-7000-8000-000000000003', '019ac000-0000-7000-8000-000000000023',
    'open', 50, clock_timestamp(), null
  ) $$,
  '22023',
  null,
  'a cursor without the request it continues after is refused'
);

select * from finish();

rollback;
