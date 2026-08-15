begin;

select plan(12);

insert into identity.people (id, given_name, family_name, status)
values
  ('0199c000-0000-7000-8000-000000000001', 'Active', 'Person', 'active'),
  ('0199c000-0000-7000-8000-000000000002', 'Closed', 'Person', 'closed');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('0199c000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'actor_active', '0199c000-0000-7000-8000-000000000001'),
  ('0199c000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'actor_closed', '0199c000-0000-7000-8000-000000000002'),
  ('0199c000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'actor_incomplete', null);

set local session_replication_role = replica;
insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('0199c000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'actor_inconsistent', '0199c000-0000-7000-8000-000000000099');
set local session_replication_role = origin;

select has_function(
  'identity',
  'resolve_actor_registration',
  array['uuid'],
  'T-IDN-RLS-02: actor registration resolver exists'
);
select ok(
  not has_function_privilege('public', 'identity.resolve_actor_registration(uuid)', 'EXECUTE'),
  'PUBLIC cannot execute actor registration resolution'
);
select ok(
  has_function_privilege('allfit_api', 'identity.resolve_actor_registration(uuid)', 'EXECUTE'),
  'the runtime role can execute actor registration resolution'
);
select is(
  (
    select routine.prosecdef
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'identity'
      and routine.proname = 'resolve_actor_registration'
      and pg_catalog.pg_get_function_identity_arguments(routine.oid) = 'p_account_id uuid'
  ),
  false,
  'actor registration resolution is SECURITY INVOKER'
);

set local role allfit_api;

select results_eq(
  $$ select person_id, person_status from identity.resolve_actor_registration('0199c000-0000-7000-8000-000000000011') $$,
  $$ values ('0199c000-0000-7000-8000-000000000001'::uuid, 'active'::text) $$,
  'an active linked person resolves through RLS'
);
select results_eq(
  $$ select person_id, person_status from identity.resolve_actor_registration('0199c000-0000-7000-8000-000000000012') $$,
  $$ values ('0199c000-0000-7000-8000-000000000002'::uuid, 'closed'::text) $$,
  'a closed linked person remains distinguishable for fail-closed revocation'
);
select results_eq(
  $$ select person_id, person_status from identity.resolve_actor_registration('0199c000-0000-7000-8000-000000000013') $$,
  $$ values (null::uuid, null::text) $$,
  'an unlinked account resolves as registration incomplete'
);
select is_empty(
  $$ select * from identity.resolve_actor_registration('0199c000-0000-7000-8000-000000000099') $$,
  'an unknown account cannot be resolved'
);
select results_eq(
  $$ select person_id, person_status from identity.resolve_actor_registration('0199c000-0000-7000-8000-000000000014') $$,
  $$ values ('0199c000-0000-7000-8000-000000000099'::uuid, null::text) $$,
  'an inconsistent person reference is visible to the API as unresolved'
);
select is_empty(
  $$ select id from identity.people $$,
  'resolving an incomplete account clears any earlier person context'
);

reset role;

set local app.actor_kind = 'anonymous';
set local app.actor_account_id = '';
set local app.actor_person_id = '';
savepoint before_actor_resolution;
set local role allfit_api;
select results_eq(
  $$ select person_id, person_status from identity.resolve_actor_registration('0199c000-0000-7000-8000-000000000011') $$,
  $$ values ('0199c000-0000-7000-8000-000000000001'::uuid, 'active'::text) $$,
  'the account and person context remain inside the resolver transaction'
);
reset role;
rollback to savepoint before_actor_resolution;
select is(
  pg_catalog.current_setting('app.actor_person_id', true),
  '',
  'rolling back the statement scope restores the previous actor context'
);

select * from finish();
rollback;
