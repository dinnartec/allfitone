begin;

select plan(12);

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
      and conname = 'access_accounts_provider_issuer_subject_key'
      and contype = 'u'
  ),
  'external account identity is unique'
);

select * from finish();
rollback;
