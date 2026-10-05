-- T-CAT-GLOBAL-01 — NEW-CAT-GLOBAL-PUBLISH / OP-CAT-004 and OP-CAT-005.
--
-- `HU-BO-022`: only Allfit publishes the global catalogue, a published code is stable,
-- and archiving withdraws an entry from search without breaking what already used it.
--
-- **Only the platform publishes.** Publishing and archiving need `curate_global_catalog`
-- with AAL2; the base role is not enough. The commands accept no scope and no owner, so
-- there is no way to push a gym's private content into the global catalogue, and
-- archiving a private entry through these routes does not find it.
--
-- **A code is stable.** Publishing a code that is already published is refused, and
-- republishing an archived one works only with the same name, because the code means the
-- same thing before and after.
--
-- **Archiving breaks nothing.** The archived entry disappears from `/catalog/v1` but
-- still exists, and what references it still resolves: the database refuses to delete it.

begin;

select plan(41);

insert into identity.people (id, given_name, family_name)
values
  ('019b2000-0000-7000-8000-000000000001', 'Manager', 'Alpha'),
  ('019b2000-0000-7000-8000-000000000002', 'Manager', 'Beta'),
  ('019b2000-0000-7000-8000-000000000003', 'Curator', 'Gamma'),
  ('019b2000-0000-7000-8000-000000000004', 'Owner', 'Delta');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b2000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha_cat', null),
  ('019b2000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta_cat', null),
  ('019b2000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma_cat',
    '019b2000-0000-7000-8000-000000000003');

select support.bootstrap_backoffice_administrators(
  '019b2000-0000-7000-8000-000000000001', 'alpha_cat',
  '019b2000-0000-7000-8000-000000000002', 'beta_cat',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-CAT-GLOBAL-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019b2000-0000-7000-8000-000000000021', '019b2000-0000-7000-8000-000000000011',
    'sid_alpha_cat', 'backoffice', decode(repeat('e1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019b2000-0000-7000-8000-000000000023', '019b2000-0000-7000-8000-000000000013',
    'sid_gamma_cat', 'backoffice', decode(repeat('e3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019b2000-0000-7000-8000-000000000001', '019b2000-0000-7000-8000-000000000021',
  '019b2000-0000-7000-8000-000000000003', 'allfit_admin',
  '019b2000-0000-7000-8000-000000000101', '019b2000-0000-7000-8000-000000000201',
  decode(repeat('41', 32), 'hex')
);

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Only the platform, and only with the duty in force
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select catalog.list_global_catalog(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023'
  ) $$,
  '42501', null,
  'the base role does not read the global catalogue with its drafts'
);

select throws_ok(
  $$ select * from catalog.publish_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga', 'Yoga',
    'c0000000-0000-4000-8000-000000000001', '019b2000-0000-7000-8000-000000000601',
    decode(repeat('51', 32), 'hex')
  ) $$,
  '42501', null,
  'the base role does not publish a discipline'
);

select support.assign_platform_duty(
  '019b2000-0000-7000-8000-000000000001', '019b2000-0000-7000-8000-000000000021',
  '019b2000-0000-7000-8000-000000000003', 'curate_global_catalog',
  null, clock_timestamp() + interval '30 days', 'CASE-CURATE-22',
  '019b2000-0000-7000-8000-000000000103', '019b2000-0000-7000-8000-000000000203',
  decode(repeat('43', 32), 'hex')
);

-- ---------------------------------------------------------------------------
-- Publishing a discipline
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from catalog.publish_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'Yoga Global', 'Yoga',
    'c0000000-0000-4000-8000-000000000002', '019b2000-0000-7000-8000-000000000602',
    decode(repeat('52', 32), 'hex')
  ) $$,
  '22023', null,
  'a code that is not a stable identifier is refused'
);

select throws_ok(
  $$ select * from catalog.publish_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga', '   ',
    'c0000000-0000-4000-8000-000000000003', '019b2000-0000-7000-8000-000000000603',
    decode(repeat('53', 32), 'hex')
  ) $$,
  '22023', null,
  'a discipline without a name is refused'
);

create temporary table yoga on commit drop as
select * from catalog.publish_discipline(
  '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
  'test_global_yoga', 'Yoga',
  'c0000000-0000-4000-8000-000000000004', '019b2000-0000-7000-8000-000000000604',
  decode(repeat('54', 32), 'hex')
);

select results_eq(
  $$ select result->>'kind', result->>'code', result->>'name', result->>'status',
            (result->>'in_use_count')::integer, replayed
     from yoga $$,
  $$ values ('discipline'::text, 'test_global_yoga'::text, 'Yoga'::text, 'published'::text, 0,
             false) $$,
  'the discipline is published with nothing depending on it yet'
);

select is(
  (select replayed from catalog.publish_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga', 'Yoga',
    'c0000000-0000-4000-8000-000000000004', '019b2000-0000-7000-8000-000000000604',
    decode(repeat('54', 32), 'hex')
  )),
  true,
  'retrying the same command answers the same without publishing again'
);

select throws_ok(
  $$ select * from catalog.publish_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga', 'Yoga',
    'c0000000-0000-4000-8000-000000000005', '019b2000-0000-7000-8000-000000000605',
    decode(repeat('55', 32), 'hex')
  ) $$,
  '55000', null,
  'a discipline that is already published is not published twice'
);

select is(
  (select count(*) from catalog.list_disciplines() where code = 'test_global_yoga'),
  1::bigint,
  'the published discipline reaches the catalogue the products read'
);

-- ---------------------------------------------------------------------------
-- Global activity types
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from catalog.publish_activity_type(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_absent', 'test_global_flow', 'Flow',
    'c0000000-0000-4000-8000-000000000006', '019b2000-0000-7000-8000-000000000606',
    decode(repeat('56', 32), 'hex')
  ) $$,
  'P0002', null,
  'an activity type under a discipline that does not exist is not published'
);

create temporary table flow on commit drop as
select * from catalog.publish_activity_type(
  '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
  'test_global_yoga', 'test_global_flow', 'Flow',
  'c0000000-0000-4000-8000-000000000007', '019b2000-0000-7000-8000-000000000607',
  decode(repeat('57', 32), 'hex')
);

select results_eq(
  $$ select result->>'kind', result->>'discipline_code', result->>'code', result->>'status'
     from flow $$,
  $$ values ('activity_type'::text, 'test_global_yoga'::text, 'test_global_flow'::text,
             'published'::text) $$,
  'the activity type is published under its discipline'
);

select results_eq(
  $$ select content_scope::text, owner_organization_id from catalog.activity_types
     where code = 'test_global_flow' $$,
  $$ values ('global'::text, null::uuid) $$,
  'what Allfit publishes is global and has no owner'
);

select throws_ok(
  $$ select * from catalog.publish_activity_type(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga', 'test_global_flow', 'Flow',
    'c0000000-0000-4000-8000-000000000018', '019b2000-0000-7000-8000-000000000618',
    decode(repeat('63', 32), 'hex')
  ) $$,
  '55000', null,
  'an activity type that is already published is not published twice'
);

-- A gym creates its own private content; these routes never touch it.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000004', true);

create temporary table catalog_gym on commit drop as
select * from organizations.create_organization(
  '019b2000-0000-7000-8000-000000000004', 'Catálogo Norte', 'studio', 'natural_person',
  'Ignored', 'f0000000-0000-4000-8000-000000000001',
  '019b2000-0000-7000-8000-000000000801', decode(repeat('61', 32), 'hex')
);

insert into catalog.activity_types (
  id, discipline_code, code, name, content_scope, owner_organization_id, status
)
select '019b2000-0000-7000-8000-000000000701', 'test_global_yoga', 'test_private_flow',
       'Flow privado', 'organization', organization_id, 'published'
from catalog_gym;

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000003', true);

select throws_ok(
  $$ select * from catalog.archive_activity_type(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_private_flow',
    'c0000000-0000-4000-8000-000000000008', '019b2000-0000-7000-8000-000000000608',
    decode(repeat('58', 32), 'hex')
  ) $$,
  'P0002', null,
  'a gym''s private content is not archived from the global catalogue'
);

select is(
  (select status::text from catalog.activity_types where code = 'test_private_flow'),
  'published',
  'and it stays published for its gym'
);

-- ---------------------------------------------------------------------------
-- Global movements
-- ---------------------------------------------------------------------------

create temporary table warrior on commit drop as
select * from catalog.publish_global_movement(
  '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
  'test_global_yoga', '  Guerrero  II ',
  'c0000000-0000-4000-8000-000000000009', '019b2000-0000-7000-8000-000000000609',
  decode(repeat('59', 32), 'hex')
);

select results_eq(
  $$ select result->>'kind', result->>'name', result->>'status' from warrior $$,
  $$ values ('movement'::text, 'Guerrero II'::text, 'published'::text) $$,
  'the movement keeps its name without the extra spaces'
);

select results_eq(
  $$ select content_scope::text, normalized_name, owner_organization_id, owner_person_id
     from catalog.movements where name = 'Guerrero II' $$,
  $$ values ('global'::text, 'guerrero ii'::text, null::uuid, null::uuid) $$,
  'a global movement has no owner and is normalised to be compared'
);

select throws_ok(
  $$ select * from catalog.publish_global_movement(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga', 'guerrero  ii',
    'c0000000-0000-4000-8000-000000000010', '019b2000-0000-7000-8000-000000000610',
    decode(repeat('5a', 32), 'hex')
  ) $$,
  '55000', null,
  'the same movement spelled differently is not published twice'
);

select throws_ok(
  $$ insert into catalog.movements (discipline_code, name, normalized_name, content_scope, status)
     values ('test_global_yoga', 'Guerrero II', 'guerrero ii', 'global', 'published') $$,
  '23505', null,
  'not even the owner of the table duplicates a global movement'
);

-- ---------------------------------------------------------------------------
-- Archiving: withdrawn from search, and nothing that used it breaks
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from catalog.archive_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga',
    'c0000000-0000-4000-8000-000000000011', '019b2000-0000-7000-8000-000000000611',
    decode(repeat('5b', 32), 'hex')
  ) $$,
  '55000', null,
  'a discipline with published global content is not half archived'
);

select is(
  (select result->>'status' from catalog.archive_activity_type(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_flow',
    'c0000000-0000-4000-8000-000000000012', '019b2000-0000-7000-8000-000000000612',
    decode(repeat('5c', 32), 'hex')
  )),
  'archived',
  'the activity type is archived'
);

select is(
  (select count(*) from catalog.list_activity_types() where code = 'test_global_flow'),
  0::bigint,
  'and disappears from the catalogue the products read'
);

select is(
  (select discipline_code from catalog.activity_types where code = 'test_global_flow'),
  'test_global_yoga',
  'without losing which discipline it belonged to'
);

select throws_ok(
  $$ delete from catalog.activity_types where code = 'test_global_flow' $$,
  '55000', null,
  'an entry of the global catalogue is never deleted'
);

select is(
  (select result->>'status' from catalog.archive_global_movement(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    (select id from catalog.movements where normalized_name = 'guerrero ii'),
    'c0000000-0000-4000-8000-000000000013', '019b2000-0000-7000-8000-000000000613',
    decode(repeat('5d', 32), 'hex')
  )),
  'archived',
  'the movement is archived'
);

select is(
  (select result->>'status' from catalog.archive_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga',
    'c0000000-0000-4000-8000-000000000014', '019b2000-0000-7000-8000-000000000614',
    decode(repeat('5e', 32), 'hex')
  )),
  'archived',
  'and only then is the discipline archived'
);

select is(
  (select count(*) from catalog.list_disciplines() where code = 'test_global_yoga'),
  0::bigint,
  'the archived discipline is withdrawn from search'
);

select throws_ok(
  $$ delete from catalog.disciplines where code = 'test_global_yoga' $$,
  '23503', null,
  'and cannot be deleted while anything references it'
);

select throws_ok(
  $$ select * from catalog.archive_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga',
    'c0000000-0000-4000-8000-000000000015', '019b2000-0000-7000-8000-000000000615',
    decode(repeat('5f', 32), 'hex')
  ) $$,
  '55000', null,
  'archiving twice makes no sense and is refused'
);

-- ---------------------------------------------------------------------------
-- A published code is never reused for something else
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from catalog.publish_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga', 'Pilates',
    'c0000000-0000-4000-8000-000000000016', '019b2000-0000-7000-8000-000000000616',
    decode(repeat('60', 32), 'hex')
  ) $$,
  '55000', null,
  'an archived code is not reused for something else'
);

select is(
  (select result->>'status' from catalog.publish_discipline(
    '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023',
    'test_global_yoga', 'Yoga',
    'c0000000-0000-4000-8000-000000000017', '019b2000-0000-7000-8000-000000000617',
    decode(repeat('62', 32), 'hex')
  )),
  'published',
  'but the same thing it was is published again'
);

select is(
  (select id from catalog.disciplines where code = 'test_global_yoga'),
  (select (result->>'id')::uuid from yoga),
  'and it is still the same entry, not a new one'
);

-- ---------------------------------------------------------------------------
-- What the team sees
-- ---------------------------------------------------------------------------

create temporary table listed on commit drop as
select catalog.list_global_catalog(
  '019b2000-0000-7000-8000-000000000003', '019b2000-0000-7000-8000-000000000023'
) as body;

select is(
  (select count(*) from listed, jsonb_array_elements(body->'disciplines') as entry
   where entry->>'code' = 'test_global_yoga' and entry->>'status' = 'published'),
  1::bigint,
  'the team sees the published discipline'
);

select is(
  (select count(*) from listed, jsonb_array_elements(body->'activity_types') as entry
   where entry->>'code' = 'test_global_flow' and entry->>'status' = 'archived'),
  1::bigint,
  'and the archived one the products no longer show'
);

select is(
  (select count(*) from listed, jsonb_array_elements(body->'activity_types') as entry
   where entry->>'code' = 'test_private_flow'),
  0::bigint,
  'a gym''s private content never appears here'
);

select is(
  (select body->>'equipment_availability' from listed),
  'not_modelled',
  'equipment is declared absent rather than shown empty'
);

select is(
  (select count(*) from listed, jsonb_array_elements(body->'disciplines') as entry
   where entry->>'code' = 'test_global_yoga' and (entry->>'in_use_count')::integer >= 1),
  1::bigint,
  'the discipline says how much depends on it before anyone archives it'
);

-- ---------------------------------------------------------------------------
-- None of this is personal data
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from privacy.access_events
   where actor_person_id = '019b2000-0000-7000-8000-000000000003'
     and resource like 'catalog.%'),
  0::bigint,
  'curating the catalogue reaches nobody''s data, so it records no access'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('allfit_api', 'catalog.list_global_catalog(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'catalog.publish_discipline(uuid, uuid, text, text, uuid, uuid, bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'catalog.archive_discipline(uuid, uuid, text, uuid, uuid, bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'catalog.publish_activity_type(uuid, uuid, text, text, text, uuid, uuid, bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'catalog.archive_activity_type(uuid, uuid, text, uuid, uuid, bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'catalog.publish_global_movement(uuid, uuid, text, text, uuid, uuid, bytea)', 'EXECUTE')
  and has_function_privilege('allfit_api',
    'catalog.archive_global_movement(uuid, uuid, uuid, uuid, uuid, bytea)', 'EXECUTE'),
  'the runtime executes the list and the six commands'
);

select ok(
  not has_function_privilege('allfit_api',
    'catalog.require_global_catalog_curator(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('allfit_api',
    'catalog.global_catalog_entry_projection(text, uuid)', 'EXECUTE'),
  'the duty check and the projection stay private'
);

set local role allfit_api;

select throws_ok(
  $$ insert into catalog.disciplines (code, name, status)
     values ('test_forged', 'Forjada', 'published') $$,
  '42501', null,
  'the runtime does not write the catalogue directly'
);

select throws_ok(
  $$ update catalog.activity_types set status = 'published' where code = 'test_global_flow' $$,
  '42501', null,
  'nor unarchive an activity type on its own'
);

reset role;

select * from finish();
rollback;
