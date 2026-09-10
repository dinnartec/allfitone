-- T-SUP-RLS-03 — PR-22 / OP-SUP-005: the minimised support projection.
--
-- Covers `HU-BO-006` and `HU-BO-007`. The base role alone opens nothing; the
-- projection never carries a name, a full contact or the provider's subject;
-- there is no exploratory search; and a search that found nobody is recorded
-- anyway, which is the whole reason `support.metadata_queries` exists.

begin;

select plan(21);

insert into identity.people (
  id, given_name, family_name, contact_email, contact_phone, status
) values
  ('019a5000-0000-7000-8000-000000000001', 'Manager', 'Alpha', null, null, 'active'),
  ('019a5000-0000-7000-8000-000000000002', 'Manager', 'Beta', null, null, 'active'),
  ('019a5000-0000-7000-8000-000000000003', 'Diagnostician', 'Gamma', null, null, 'active'),
  ('019a5000-0000-7000-8000-000000000004', 'Badged', 'Delta', null, null, 'active'),
  ('019a5000-0000-7000-8000-000000000005', 'Subject', 'Epsilon',
    'subject.epsilon@example.test', '+573001234567', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019a5000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha', null),
  ('019a5000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta', null),
  ('019a5000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma',
    '019a5000-0000-7000-8000-000000000003'),
  ('019a5000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta',
    '019a5000-0000-7000-8000-000000000004'),
  ('019a5000-0000-7000-8000-000000000015', 'workos', 'https://issuer.test',
    'subject-external-secret', '019a5000-0000-7000-8000-000000000005');

select support.bootstrap_backoffice_administrators(
  '019a5000-0000-7000-8000-000000000001', 'alpha',
  '019a5000-0000-7000-8000-000000000002', 'beta',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-SUP-03'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019a5000-0000-7000-8000-000000000021', '019a5000-0000-7000-8000-000000000011',
    'sid_alpha_3', 'backoffice', decode(repeat('c1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a5000-0000-7000-8000-000000000023', '019a5000-0000-7000-8000-000000000013',
    'sid_gamma_3', 'backoffice', decode(repeat('c3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019a5000-0000-7000-8000-000000000024', '019a5000-0000-7000-8000-000000000014',
    'sid_delta_3', 'backoffice', decode(repeat('c4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

-- Both candidates carry the base role. Only one of them gets the duty, so the
-- denial below is about the duty and not about being unknown to the platform.
select support.assign_platform_role(
  '019a5000-0000-7000-8000-000000000001', '019a5000-0000-7000-8000-000000000021',
  '019a5000-0000-7000-8000-000000000003', 'allfit_admin',
  '019a5000-0000-7000-8000-000000000101', '019a5000-0000-7000-8000-000000000201',
  decode(repeat('31', 32), 'hex')
);
select support.assign_platform_role(
  '019a5000-0000-7000-8000-000000000001', '019a5000-0000-7000-8000-000000000021',
  '019a5000-0000-7000-8000-000000000004', 'allfit_admin',
  '019a5000-0000-7000-8000-000000000102', '019a5000-0000-7000-8000-000000000202',
  decode(repeat('32', 32), 'hex')
);
select support.assign_platform_duty(
  '019a5000-0000-7000-8000-000000000001', '019a5000-0000-7000-8000-000000000021',
  '019a5000-0000-7000-8000-000000000003', 'diagnose_support_metadata',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-003',
  '019a5000-0000-7000-8000-000000000103', '019a5000-0000-7000-8000-000000000203',
  decode(repeat('33', 32), 'hex')
);

-- ---------------------------------------------------------------------------
-- The base role opens nothing on its own
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from support.search_people(
    '019a5000-0000-7000-8000-000000000004', '019a5000-0000-7000-8000-000000000024',
    'CASE-2026-100', 'email', 'subject.epsilon@example.test'
  ) $$,
  '42501',
  'reading support metadata requires an effective duty',
  'the base role alone cannot search for a person'
);

select throws_ok(
  $$ select support.person_metadata(
    '019a5000-0000-7000-8000-000000000004', '019a5000-0000-7000-8000-000000000024',
    'CASE-2026-100', '019a5000-0000-7000-8000-000000000005'
  ) $$,
  '42501',
  'reading support metadata requires an effective duty',
  'the base role alone cannot open an operational state'
);

select is(
  (select count(*) from support.metadata_queries)::integer,
  0,
  'a refused search is not recorded as a search: it never happened'
);

-- ---------------------------------------------------------------------------
-- HU-BO-006 — exact match, and nothing else
-- ---------------------------------------------------------------------------

select is(
  (select (result->>'person_id')::uuid from support.search_people(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'CASE-2026-101', 'email', 'subject.epsilon@example.test'
  )),
  '019a5000-0000-7000-8000-000000000005'::uuid,
  'an exact email finds the person who handed it over'
);

select is(
  (select count(*) from support.search_people(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'CASE-2026-102', 'email', 'subject.epsilon'
  ))::integer,
  0,
  'a partial email matches nothing: there is no exploratory search'
);

select is(
  (select count(*) from support.search_people(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'CASE-2026-103', 'phone', '+573001234567'
  ))::integer,
  1,
  'an exact phone finds the person too'
);

select throws_ok(
  $$ select * from support.search_people(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'CASE-2026-104', 'name', 'Epsilon'
  ) $$,
  '22023',
  'a support search is by identifier, email or phone',
  'searching by name is refused by the function, not by a convention'
);

-- ---------------------------------------------------------------------------
-- The record every search leaves, found or not
-- ---------------------------------------------------------------------------

select is(
  (select result_count from support.metadata_queries where case_reference = 'CASE-2026-102'),
  0,
  'a search that found nobody is recorded, with its empty result'
);

select is(
  (select count(*) from support.metadata_queries where case_reference = 'CASE-2026-104')::integer,
  0,
  'a malformed search is refused before it becomes a record'
);

select ok(
  (select lookup_hash = extensions.digest('subject.epsilon@example.test', 'sha256')
   from support.metadata_queries where case_reference = 'CASE-2026-101'),
  'the looked-up value is stored as a digest, never in clear'
);

select is(
  (select actor_person_id from support.metadata_queries where case_reference = 'CASE-2026-101'),
  '019a5000-0000-7000-8000-000000000003'::uuid,
  'the record names who searched'
);

select throws_ok(
  $$ update support.metadata_queries set result_count = 99 $$,
  '55000',
  'the record of a support search is append-only',
  'a search record cannot be rewritten'
);

select throws_ok(
  $$ delete from support.metadata_queries $$,
  '55000',
  'the record of a support search is append-only',
  'a search record cannot be deleted'
);

select throws_ok(
  $$ select support.search_people(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'el usuario no puede entrar', 'email', 'subject.epsilon@example.test'
  ) $$,
  '23514',
  null,
  'a case reference cannot be free prose'
);

-- ---------------------------------------------------------------------------
-- HU-BO-007 — minimisation
-- ---------------------------------------------------------------------------

select ok(
  (select support.person_metadata(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'CASE-2026-105', '019a5000-0000-7000-8000-000000000005'
  ) ?& array['person_id', 'account_status', 'contact_email_masked', 'email_verified_at']),
  'the operational state carries identifiers, states and timestamps'
);

select ok(
  not (
    select support.person_metadata(
      '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
      'CASE-2026-106', '019a5000-0000-7000-8000-000000000005'
    ) ?| array['given_name', 'family_name', 'display_name', 'username', 'contact_email',
               'contact_phone', 'subject']
  ),
  'no name, no full contact and no provider subject ever leave the projection'
);

select is(
  (select support.person_metadata(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'CASE-2026-107', '019a5000-0000-7000-8000-000000000005'
  )->>'contact_email_masked'),
  '••••••••on@example.test',
  'the contact is masked to what confirms a case, not to what identifies a person'
);

select is(
  (select support.person_metadata(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'CASE-2026-108', '019a5000-0000-7000-8000-000000000005'
  )->>'relationships_availability'),
  'not_modelled',
  'an absent domain says so, instead of reading as a person with no relationships'
);

select throws_ok(
  $$ select support.person_metadata(
    '019a5000-0000-7000-8000-000000000003', '019a5000-0000-7000-8000-000000000023',
    'CASE-2026-109', '019a5000-0000-7000-8000-0000000009ff'
  ) $$,
  'P0002',
  'person not found in the support projection',
  'a person outside the projection is not found rather than empty'
);

select ok(
  (select count(*) from privacy.access_events
   where subject_person_id = '019a5000-0000-7000-8000-000000000005'
     and resource = 'support.v_support_metadata'
     and purpose = 'support_diagnosis') >= 4,
  'every opened operational state was recorded before its content travelled'
);

-- ---------------------------------------------------------------------------
-- Minimal grants
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'allfit_api', 'support.search_people(uuid,uuid,text,text,text)', 'EXECUTE'
  )
    and has_function_privilege(
      'allfit_api', 'support.person_metadata(uuid,uuid,text,uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'allfit_api', 'support.require_support_diagnostician(uuid,uuid)', 'EXECUTE'
    )
    and not has_table_privilege('allfit_api', 'support.v_support_metadata', 'SELECT')
    and not has_table_privilege('allfit_api', 'support.metadata_queries', 'SELECT'),
  'the runtime role executes the two operations and reaches neither the guard nor the tables'
);

select * from finish();
rollback;
