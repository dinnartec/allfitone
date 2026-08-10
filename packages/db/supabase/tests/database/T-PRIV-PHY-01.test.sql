begin;

select plan(8);

select is(
  (
    select array_agg(child.relname::text order by child.relname)
    from pg_catalog.pg_inherits as inheritance
    join pg_catalog.pg_class as parent on parent.oid = inheritance.inhparent
    join pg_catalog.pg_namespace as parent_namespace on parent_namespace.oid = parent.relnamespace
    join pg_catalog.pg_class as child on child.oid = inheritance.inhrelid
    where parent_namespace.nspname = 'privacy'
      and parent.relname = 'access_events'
  ),
  array[
    'access_events_2026_08',
    'access_events_2026_09',
    'access_events_2026_10',
    'access_events_2026_11',
    'access_events_2026_12',
    'access_events_2027_01',
    'access_events_2027_02',
    'access_events_2027_03',
    'access_events_2027_04',
    'access_events_2027_05',
    'access_events_2027_06',
    'access_events_2027_07',
    'access_events_2027_08',
    'access_events_2027_09',
    'access_events_2027_10',
    'access_events_2027_11',
    'access_events_2027_12',
    'access_events_default'
  ]::text[],
  'access auditing has the complete monthly horizon and a default partition'
);

select is(
  (
    select pg_catalog.pg_get_expr(partition.relpartbound, partition.oid)
    from pg_catalog.pg_class as partition
    join pg_catalog.pg_namespace as namespace on namespace.oid = partition.relnamespace
    where namespace.nspname = 'privacy'
      and partition.relname = 'access_events_default'
  ),
  'DEFAULT',
  'the fallback audit partition is the default partition'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_inherits as inheritance
    join pg_catalog.pg_class as parent on parent.oid = inheritance.inhparent
    join pg_catalog.pg_namespace as parent_namespace on parent_namespace.oid = parent.relnamespace
    join pg_catalog.pg_class as child on child.oid = inheritance.inhrelid
    join pg_catalog.pg_roles as owner_role on owner_role.oid = child.relowner
    where parent_namespace.nspname = 'privacy'
      and parent.relname = 'access_events'
      and owner_role.rolname <> 'allfit_owner'
  ),
  'every audit partition belongs to allfit_owner'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_inherits as inheritance
    join pg_catalog.pg_class as parent on parent.oid = inheritance.inhparent
    join pg_catalog.pg_namespace as parent_namespace on parent_namespace.oid = parent.relnamespace
    join pg_catalog.pg_class as child on child.oid = inheritance.inhrelid
    where parent_namespace.nspname = 'privacy'
      and parent.relname = 'access_events'
      and (not child.relrowsecurity or not child.relforcerowsecurity)
  ),
  'every audit partition enables and forces RLS'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'privacy'
      and table_name like 'access_events_%'
      and grantee in ('PUBLIC', 'allfit_api')
  ),
  'runtime and public receive no direct audit partition privileges'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_inherits as table_inheritance
    join pg_catalog.pg_class as parent_table on parent_table.oid = table_inheritance.inhparent
    join pg_catalog.pg_namespace as parent_namespace on parent_namespace.oid = parent_table.relnamespace
    join pg_catalog.pg_class as child_table on child_table.oid = table_inheritance.inhrelid
    where parent_namespace.nspname = 'privacy'
      and parent_table.relname = 'access_events'
      and (
        select count(*)
        from pg_catalog.pg_index as child_index
        where child_index.indrelid = child_table.oid
      ) < 4
  ),
  'every audit partition receives the parent primary and secondary indexes'
);

insert into identity.people (id, given_name, family_name)
values ('01991600-0000-7000-8000-000000000091', 'Audit', 'Partition');

insert into privacy.access_events (
  actor_person_id,
  target_person_id,
  resource_type,
  purpose,
  decision,
  request_id,
  occurred_at
) values (
  '01991600-0000-7000-8000-000000000091',
  '01991600-0000-7000-8000-000000000091',
  'professional_profile',
  'profile_management',
  'allowed',
  '39999999-9999-4999-8999-999999999991',
  '2026-12-15T12:00:00Z'
);

select is(
  (
    select tableoid::regclass::text
    from privacy.access_events
    where request_id = '39999999-9999-4999-8999-999999999991'
  ),
  'privacy.access_events_2026_12',
  'December 2026 audit events route to their monthly partition'
);

insert into privacy.access_events (
  actor_person_id,
  target_person_id,
  resource_type,
  purpose,
  decision,
  request_id,
  occurred_at
) values (
  '01991600-0000-7000-8000-000000000091',
  '01991600-0000-7000-8000-000000000091',
  'professional_profile',
  'profile_management',
  'allowed',
  '39999999-9999-4999-8999-999999999992',
  '2035-06-15T12:00:00Z'
);

select is(
  (
    select tableoid::regclass::text
    from privacy.access_events
    where request_id = '39999999-9999-4999-8999-999999999992'
  ),
  'privacy.access_events_default',
  'out-of-horizon audit events route to the default partition'
);

select * from finish();
rollback;
