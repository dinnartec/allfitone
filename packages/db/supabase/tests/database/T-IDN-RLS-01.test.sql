begin;

select plan(12);

select has_role('allfit_owner', 'owner role exists');
select has_role('allfit_migrator', 'migrator role exists');
select has_role('allfit_api', 'runtime role exists');
select ok(not rolsuper and not rolbypassrls, 'runtime role is neither superuser nor BYPASSRLS')
from pg_catalog.pg_roles
where rolname = 'allfit_api';

insert into identity.people (id, given_name, family_name)
values
  ('0198c000-0000-7000-8000-000000000001', 'Ada', 'One'),
  ('0198c000-0000-7000-8000-000000000002', 'Grace', 'Two');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('0198c000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'user_one', '0198c000-0000-7000-8000-000000000001'),
  ('0198c000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'user_two', '0198c000-0000-7000-8000-000000000002');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_account_id', '0198c000-0000-7000-8000-000000000011', true);
select set_config('app.actor_person_id', '0198c000-0000-7000-8000-000000000001', true);

select results_eq(
  $$ select id from identity.people order by id $$,
  $$ values ('0198c000-0000-7000-8000-000000000001'::uuid) $$,
  'a person reads only their own row'
);
select results_eq(
  $$ select id from identity.access_accounts order by id $$,
  $$ values ('0198c000-0000-7000-8000-000000000011'::uuid) $$,
  'an actor reads only their own access account'
);
select throws_ok(
  $$ insert into identity.people (given_name, family_name) values ('Forbidden', 'Insert') $$,
  '42501',
  null,
  'allfit_api cannot insert people'
);
select throws_ok(
  $$ insert into identity.access_accounts (provider, issuer, subject) values ('workos', 'https://issuer.test', 'forged') $$,
  '42501',
  null,
  'allfit_api cannot insert access accounts directly'
);
select ok(not has_table_privilege('allfit_api', 'identity.access_sessions', 'SELECT'), 'runtime cannot select session secrets');
select ok(not has_table_privilege('allfit_api', 'identity.access_sessions', 'INSERT'), 'runtime cannot insert sessions directly');
select ok(not has_table_privilege('public', 'identity.access_sessions', 'SELECT'), 'PUBLIC cannot read sessions');
select ok(not has_function_privilege('public', 'identity.load_access_session(bytea, identity.access_session_surface)', 'EXECUTE'), 'PUBLIC cannot execute session loaders');

reset role;
select * from finish();
rollback;
