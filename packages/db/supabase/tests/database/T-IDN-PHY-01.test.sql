begin;

select plan(23);

select has_schema('identity', 'identity schema exists');
select has_schema('access_control', 'access_control schema exists');
select has_function('extensions', 'uuid_generate_v7', array[]::text[], 'UUIDv7 generator exists');
select has_function('extensions', 'uuid_is_v7', array['uuid'], 'UUIDv7 predicate exists');
select has_function('extensions', 'uuid_v7_timestamp', array['uuid'], 'UUIDv7 timestamp reader exists');

select ok(extensions.uuid_is_v7(extensions.uuid_generate_v7()), 'generated identifiers are UUIDv7');
select ok(
  abs(extract(epoch from (extensions.uuid_v7_timestamp(extensions.uuid_generate_v7()) - clock_timestamp()))) < 2,
  'UUIDv7 embeds the current timestamp'
);

select has_table('identity', 'people', 'people table exists');
select has_table('identity', 'access_accounts', 'access_accounts table exists');
select has_table('identity', 'access_sessions', 'access_sessions table exists');
select col_is_null('identity', 'access_accounts', 'person_id', 'an account may exist before a person');
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'identity.access_accounts'::regclass
      and conname = 'uq_access_accounts_provider_identity'
      and contype = 'u'
  ),
  'external account identity is unique'
);

select col_is_pk('identity', 'people', 'id', 'people uses the canonical primary-key constraint');
select has_index('identity', 'people', 'uidx_people_contact_email', 'contact email index is canonical');
select has_index('identity', 'people', 'uidx_people_contact_phone', 'contact phone index is canonical');
select has_index('identity', 'access_accounts', 'idx_access_accounts_person_id', 'account person index is canonical');
select has_index('identity', 'access_sessions', 'idx_access_sessions_access_account_id', 'session account index is canonical');
select has_trigger('identity', 'people', 'trg_people_update_set_updated_at', 'people trigger is canonical');
select policies_are(
  'identity',
  'people',
  array['people_all_owner', 'people_select_self'],
  'people policies use canonical names'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_object
    join pg_catalog.pg_class as relation on relation.oid = constraint_object.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('identity', 'access_control')
      and constraint_object.contype <> 't'
      and constraint_object.conname !~ '^(pk|fk|uq|ck|ex)_'
  ),
  'all application constraints use canonical names'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as index_object
    join pg_catalog.pg_namespace as namespace on namespace.oid = index_object.relnamespace
    where namespace.nspname in ('identity', 'access_control')
      and index_object.relkind = 'i'
      and index_object.relname !~ '^(pk|uq|idx|uidx)_'
  ),
  'all application indexes use canonical names'
);
select ok(
  not exists (
    select 1
    from information_schema.triggers
    where trigger_schema in ('identity', 'access_control')
      and trigger_name !~ '^trg_'
  ),
  'all application triggers use canonical names'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname in ('identity', 'access_control')
      and policyname !~ '^[a-z][a-z0-9_]*_(select|insert|update|delete|all)_[a-z0-9_]+$'
  ),
  'all application policies use canonical names'
);

select * from finish();
rollback;
