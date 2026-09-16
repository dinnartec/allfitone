-- T-CAT-RLS-01 — PR-14 / OP-CAT-007, OP-CAT-008, OP-CAT-012.
--
-- The global catalogue has no subject, but it is not public: it needs an active
-- authenticated person. It also never leaks organisation-scoped content, never
-- shows an unpublished row, and never offers an association whose window closed.

begin;

select plan(14);

insert into identity.people (id, given_name, family_name, status)
values
  ('019ab000-0000-7000-8000-000000000001', 'Reader', 'Active', 'active'),
  ('019ab000-0000-7000-8000-000000000002', 'Reader', 'Closed', 'closed');

insert into catalog.disciplines (code, name, status)
values
  ('test_cat_published', 'Publicada', 'published'),
  ('test_cat_draft', 'Borrador', 'draft');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019ab000-0000-7000-8000-000000000101', 'studio', 'Cat Studio',
  '{"party_kind":"legal_entity","party_name":"Cat Studio SAS","purpose":"studio_operations"}'
);

insert into catalog.activity_types (
  id, discipline_code, code, name, content_scope, owner_organization_id, status
) values
  ('019ab000-0000-7000-8000-000000000201', 'test_cat_published', 'test_cat_global',
    'Global publicada', 'global', null, 'published'),
  ('019ab000-0000-7000-8000-000000000202', 'test_cat_published', 'test_cat_draft_type',
    'Global borrador', 'global', null, 'draft'),
  ('019ab000-0000-7000-8000-000000000203', 'test_cat_published', 'test_cat_org',
    'De la organización', 'organization', '019ab000-0000-7000-8000-000000000101', 'published');

insert into catalog.result_contracts (
  id, contract_code, version_number, activity_family, envelope, minimums, status, published_at
) values
  ('019ab000-0000-7000-8000-000000000301', 'test.cat.v1', 1, 'strength',
    '{"schema":1}', '{"sets":1}', 'published', clock_timestamp()),
  ('019ab000-0000-7000-8000-000000000302', 'test.cat.v2', 2, 'strength',
    '{"schema":1}', '{"sets":3}', 'published', clock_timestamp());

insert into catalog.activity_type_result_contracts (
  id, activity_type_id, result_contract_id, is_default, valid_from, valid_to
) values
  ('019ab000-0000-7000-8000-000000000401', '019ab000-0000-7000-8000-000000000201',
    '019ab000-0000-7000-8000-000000000301', false,
    clock_timestamp() - interval '10 days', clock_timestamp() - interval '1 second'),
  ('019ab000-0000-7000-8000-000000000402', '019ab000-0000-7000-8000-000000000201',
    '019ab000-0000-7000-8000-000000000302', true, clock_timestamp() - interval '1 minute', null);

-- Without an actor the catalogue is closed, not empty.
select throws_ok(
  $$ select * from catalog.list_disciplines() $$,
  '42501',
  'the global catalogue requires an active authenticated person',
  'an anonymous caller cannot read the catalogue'
);

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ab000-0000-7000-8000-000000000002', true);

select throws_ok(
  $$ select * from catalog.list_activity_types() $$,
  '42501',
  'the global catalogue requires an active authenticated person',
  'a closed person cannot read the catalogue'
);

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019ab000-0000-7000-8000-000000000001', true);

-- OP-CAT-007
select is(
  (select count(*) from catalog.list_disciplines()
    where code in ('test_cat_published', 'test_cat_draft')),
  1::bigint,
  'only published disciplines are listed'
);

select is(
  (select name from catalog.list_disciplines() where code = 'test_cat_published'),
  'Publicada',
  'a published discipline carries its name'
);

-- OP-CAT-008
select is(
  (select count(*) from catalog.list_activity_types()
    where id = '019ab000-0000-7000-8000-000000000201'),
  1::bigint,
  'a published global activity type is listed'
);

select is(
  (select count(*) from catalog.list_activity_types()
    where id = '019ab000-0000-7000-8000-000000000202'),
  0::bigint,
  'a draft activity type is never listed'
);

-- The catalogue is global: organisation content belongs to its own surface.
select is(
  (select count(*) from catalog.list_activity_types()
    where id = '019ab000-0000-7000-8000-000000000203'),
  0::bigint,
  'organisation-scoped content never leaks into the global catalogue'
);

select ok(
  (select bool_and(discipline_code is not null and code is not null)
    from catalog.list_activity_types()),
  'every listed activity type carries its discipline and stable code'
);

-- OP-CAT-012
select is(
  (select count(*) from catalog.list_activity_type_result_contracts(
    '019ab000-0000-7000-8000-000000000201'
  )),
  1::bigint,
  'only the effective association is offered'
);

select is(
  (select contract_code from catalog.list_activity_type_result_contracts(
    '019ab000-0000-7000-8000-000000000201'
  )),
  'test.cat.v2',
  'the superseded contract is not offered for a new draft'
);

select ok(
  (select is_default from catalog.list_activity_type_result_contracts(
    '019ab000-0000-7000-8000-000000000201'
  )),
  'the client can tell which contract is the default'
);

select is(
  (select minimums->>'sets' from catalog.list_activity_type_result_contracts(
    '019ab000-0000-7000-8000-000000000201'
  )),
  '3',
  'the minimums travel so a client can explain a rejection before syncing'
);

select throws_ok(
  $$ select * from catalog.list_activity_type_result_contracts(
    '019ab000-0000-7000-8000-000000000203'
  ) $$,
  'P0002',
  'activity type not found in the global catalogue',
  'an organisation activity type is not addressable from the global catalogue'
);

-- Minimal grants: the guard is not something the runtime role may call alone.
select ok(
  has_function_privilege('allfit_api', 'catalog.list_disciplines()', 'EXECUTE')
    and has_function_privilege('allfit_api', 'catalog.list_activity_types()', 'EXECUTE')
    and has_function_privilege(
      'allfit_api', 'catalog.list_activity_type_result_contracts(uuid)', 'EXECUTE'
    )
    and not has_function_privilege('allfit_api', 'catalog.require_catalog_reader()', 'EXECUTE'),
  'the runtime role executes the three queries and not the guard'
);

select * from finish();
rollback;
