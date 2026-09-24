-- T-SUP-RLS-04 — PR-22 / OP-SUP-005: technical diagnosis.
--
-- `HU-BO-031`. The duty is required, the derived states name what an operator
-- actually needs to see, and — the assertion that matters most — no payload,
-- response body, principal fingerprint or request hash can leave through this
-- projection. The story's whole point is diagnosing "sin abrir el dato de nadie".

begin;

select plan(18);

insert into identity.people (id, given_name, family_name, status)
values
  ('019a6000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019a6000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019a6000-0000-7000-8000-000000000003', 'Diagnostician', 'Gamma', 'active'),
  ('019a6000-0000-7000-8000-000000000004', 'Badged', 'Delta', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a6000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha6', null),
  ('019a6000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta6', null),
  ('019a6000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma6',
    '019a6000-0000-7000-8000-000000000003'),
  ('019a6000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta6',
    '019a6000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019a6000-0000-7000-8000-000000000001', 'alpha6',
  '019a6000-0000-7000-8000-000000000002', 'beta6',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-SUP-04'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019a6000-0000-7000-8000-000000000021', '019a6000-0000-7000-8000-000000000011',
    'sid_alpha_4', 'backoffice', decode(repeat('d1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a6000-0000-7000-8000-000000000023', '019a6000-0000-7000-8000-000000000013',
    'sid_gamma_4', 'backoffice', decode(repeat('d3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a6000-0000-7000-8000-000000000024', '019a6000-0000-7000-8000-000000000014',
    'sid_delta_4', 'backoffice', decode(repeat('d4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019a6000-0000-7000-8000-000000000001', '019a6000-0000-7000-8000-000000000021',
  '019a6000-0000-7000-8000-000000000003', 'allfit_admin',
  '019a6000-0000-7000-8000-000000000101', '019a6000-0000-7000-8000-000000000201',
  decode(repeat('41', 32), 'hex')
);
select support.assign_platform_role(
  '019a6000-0000-7000-8000-000000000001', '019a6000-0000-7000-8000-000000000021',
  '019a6000-0000-7000-8000-000000000004', 'allfit_admin',
  '019a6000-0000-7000-8000-000000000102', '019a6000-0000-7000-8000-000000000202',
  decode(repeat('42', 32), 'hex')
);
select support.assign_platform_duty(
  '019a6000-0000-7000-8000-000000000001', '019a6000-0000-7000-8000-000000000021',
  '019a6000-0000-7000-8000-000000000003', 'diagnose_support_metadata',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-004',
  '019a6000-0000-7000-8000-000000000103', '019a6000-0000-7000-8000-000000000203',
  decode(repeat('43', 32), 'hex')
);

-- A notification carrying something personal in its payload, on purpose: the
-- projection has to refuse to pass it on.
insert into system.outbox_events (
  id, aggregate_type, aggregate_id, event_type, payload_schema_version, payload,
  occurred_at, attempt_count, last_error_code, published_at, dead_lettered_at
) values
  ('019a6000-0000-7000-8000-000000000301', 'invitation',
    '019a6000-0000-7000-8000-000000000401', 'identity.invitation_issued.v1', 1,
    '{"contact":"secreto@example.test","given_name":"Secreto"}',
    clock_timestamp() - interval '10 minutes', 3, 'smtp_timeout', null, null),
  ('019a6000-0000-7000-8000-000000000302', 'invitation',
    '019a6000-0000-7000-8000-000000000402', 'identity.invitation_issued.v1', 1,
    '{"contact":"otro@example.test"}',
    clock_timestamp() - interval '9 minutes', 7, 'smtp_timeout', null,
    clock_timestamp() - interval '1 minute'),
  ('019a6000-0000-7000-8000-000000000303', 'invitation',
    '019a6000-0000-7000-8000-000000000403', 'identity.invitation_issued.v1', 1,
    '{}', clock_timestamp() - interval '8 minutes', 0, null,
    clock_timestamp() - interval '7 minutes', null),
  ('019a6000-0000-7000-8000-000000000304', 'invitation',
    '019a6000-0000-7000-8000-000000000404', 'identity.invitation_issued.v1', 1,
    '{}', clock_timestamp() - interval '7 minutes', 0, null, null, null);

insert into system.idempotency_keys (
  id, principal_fingerprint, client_id, surface, operation_code, key, command_id,
  request_hash, status, aggregate_type, aggregate_id, created_at
) values
  ('019a6000-0000-7000-8000-000000000501', decode(repeat('aa', 32), 'hex'), 'studio',
    'studio', 'OP-IDN-001', '11111111-1111-4111-8111-111111111111',
    '019a6000-0000-7000-8000-000000000601', decode(repeat('bb', 32), 'hex'),
    'processing', 'person', '019a6000-0000-7000-8000-000000000701',
    clock_timestamp() - interval '30 minutes'),
  ('019a6000-0000-7000-8000-000000000502', decode(repeat('cc', 32), 'hex'), 'studio',
    'studio', 'OP-IDN-002', '22222222-2222-4222-8222-222222222222',
    '019a6000-0000-7000-8000-000000000602', decode(repeat('dd', 32), 'hex'),
    'processing', 'person', '019a6000-0000-7000-8000-000000000702', clock_timestamp());

-- ---------------------------------------------------------------------------
-- The duty is the control
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000004', '019a6000-0000-7000-8000-000000000024',
    null, null, null, 50, null, null
  ) $$,
  '42501',
  'reading support metadata requires an effective duty',
  'the base role alone cannot read the operational feed'
);

select throws_ok(
  $$ select * from support.list_delivery_circuits(
    '019a6000-0000-7000-8000-000000000004', '019a6000-0000-7000-8000-000000000024'
  ) $$,
  '42501',
  'reading support metadata requires an effective duty',
  'the base role alone cannot read delivery health'
);

-- ---------------------------------------------------------------------------
-- Nothing personal leaves through here
-- ---------------------------------------------------------------------------

select ok(
  not exists (
    select 1
    from support.list_operational_events(
      '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
      null, null, null, 50, null, null
    ) as feed
    where feed::text like '%secreto@example.test%'
       or feed::text like '%Secreto%'
  ),
  'a payload carrying a contact and a name never reaches the operator'
);

select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'support'
     and column_name in ('payload', 'response', 'principal_fingerprint', 'request_hash')),
  0,
  'the projection has no column that could carry a document or a fingerprint'
);

-- ---------------------------------------------------------------------------
-- Criterion 1 — identifiers, states, timestamps, errors and retries
-- ---------------------------------------------------------------------------

select is(
  (select state from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, null, '019a6000-0000-7000-8000-000000000401', 50, null, null
  )),
  'retrying',
  'a notification that failed and has not been delivered reads as retrying'
);

select is(
  (select attempt_count from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, null, '019a6000-0000-7000-8000-000000000401', 50, null, null
  )),
  3,
  'the retry count travels, because it is what says whether it is still trying'
);

select is(
  (select last_error_code from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, null, '019a6000-0000-7000-8000-000000000401', 50, null, null
  )),
  'smtp_timeout',
  'the error code travels, and it is a code rather than a message'
);

select is(
  (select state from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, null, '019a6000-0000-7000-8000-000000000402', 50, null, null
  )),
  'dead_lettered',
  'one that gave up is dead lettered, not merely retrying'
);

select is(
  (select state from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, null, '019a6000-0000-7000-8000-000000000403', 50, null, null
  )),
  'delivered',
  'a delivered notification says so'
);

-- A queue with nothing sent yet is not a pile of failures.
select is(
  (select state from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, null, '019a6000-0000-7000-8000-000000000404', 50, null, null
  )),
  'pending',
  'one not sent yet is pending, not stuck'
);

-- ---------------------------------------------------------------------------
-- Criterion 2 — what got stuck
-- ---------------------------------------------------------------------------

select is(
  (select state from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, null, '019a6000-0000-7000-8000-000000000701', 50, null, null
  )),
  'stalled',
  'a command still processing long after it started is stranded, not in flight'
);

select is(
  (select state from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, null, '019a6000-0000-7000-8000-000000000702', 50, null, null
  )),
  'processing',
  'one that just started is still processing'
);

select is(
  (select count(*) from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    null, 'dead_lettered', null, 50, null, null
  ))::integer,
  1,
  'the feed filters by state, which is how "show me what broke" is asked'
);

select is(
  (select count(distinct source) from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    'command', null, null, 50, null, null
  ))::integer,
  1,
  'the feed filters by source, so notifications and commands can be read apart'
);

select throws_ok(
  $$ select * from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    'payments', null, null, 50, null, null
  ) $$,
  '22023',
  'an operational event is a notification or a command',
  'the source is a closed vocabulary, not free text'
);

-- ---------------------------------------------------------------------------
-- Paging
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    'notification', null, null, 2, null, null
  ))::integer,
  2,
  'the feed honours its page size'
);

select ok(
  (select min(occurred_at) from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    'notification', null, null, 2, null, null
  ))
  > (select max(occurred_at) from support.list_operational_events(
    '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
    'notification', null, null, 2,
    (select min(occurred_at) from support.list_operational_events(
      '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
      'notification', null, null, 2, null, null
    )),
    (select reference_id from support.list_operational_events(
      '019a6000-0000-7000-8000-000000000003', '019a6000-0000-7000-8000-000000000023',
      'notification', null, null, 2, null, null
    ) order by occurred_at asc limit 1)
  )),
  'the cursor continues where the previous page stopped, newest first'
);

-- ---------------------------------------------------------------------------
-- Minimal grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'allfit_api',
    'support.list_operational_events(uuid,uuid,text,text,uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'allfit_api', 'support.list_delivery_circuits(uuid,uuid)', 'EXECUTE'
    )
    and not has_table_privilege('allfit_api', 'system.outbox_events', 'SELECT')
    and not has_table_privilege('allfit_api', 'system.idempotency_keys', 'SELECT'),
  'the runtime role reads the feed through its functions and never the tables'
);

select * from finish();
rollback;
