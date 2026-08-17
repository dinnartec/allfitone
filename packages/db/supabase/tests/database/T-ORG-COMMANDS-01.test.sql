begin;

select plan(83);

select has_table('organizations', 'organization_sites', 'T-ORG-PHY-01 sites are governed');
select has_table('organizations', 'organization_type_transitions', 'T-ORG-INT-45 type transitions are governed');
select has_column('organizations', 'organizations', 'revision_number', 'T-ORG-PHY-02 organizations carry the ETag revision');
select ok(not has_table_privilege('allfit_api', 'organizations.organizations', 'SELECT'), 'T-ORG-RLS-01 runtime cannot select organization base table');
select has_function('organizations', 'update_organization', array['uuid', 'uuid', 'bigint', 'jsonb', 'uuid', 'uuid', 'bytea'], 'T-ORG-IDEM-01 updates enter through a closed command');
select has_function('system', 'expire_idempotency_response', array['uuid'], 'T-ORG-IDEM-18 replay documents have a closed expiry entry point');
select function_privs_are(
  'system',
  'expire_idempotency_response',
  array['uuid'],
  'allfit_api',
  array[]::text[],
  'T-ORG-IDEM-19 runtime cannot expire durable command receipts'
);
select has_column('privacy', 'access_events', 'subject_organization_id', 'T-ORG-RLS-02 reads have an audited organization subject');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class as relation
   join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'organizations' and relation.relname = 'organization_sites'),
  'T-ORG-PHY-03 sites enable and force RLS'
);
select ok(not has_table_privilege('allfit_api', 'organizations.organization_sites', 'SELECT'), 'T-ORG-RLS-03 runtime cannot select site base table');
select ok(not has_table_privilege('allfit_api', 'organizations.organization_sites', 'INSERT'), 'T-ORG-5 runtime has no direct site INSERT privilege');
select ok(not has_table_privilege('allfit_api', 'organizations.organization_sites', 'UPDATE'), 'T-ORG-5 runtime has no direct site UPDATE privilege');
select ok(not has_table_privilege('allfit_api', 'organizations.organization_sites', 'DELETE'), 'T-ORG-5 runtime has no direct site DELETE privilege');
select policies_are(
  'organizations',
  'organization_sites',
  array['organization_sites_all_owner'],
  'T-ORG-5 sites expose no runtime RLS policy'
);
select results_eq(
  $$ select from_type_code, to_type_code from organizations.organization_type_transitions where status = 'active' order by 1, 2 $$,
  $$ values ('professional_practice'::text, 'gym'::text), ('professional_practice'::text, 'studio'::text) $$,
  'T-ORG-INT-45 only approved V1 transitions are active'
);

insert into identity.people (id, given_name, family_name)
values
  ('019a1000-0000-7000-8000-000000000101', 'Olivia', 'Owner'),
  ('019a1000-0000-7000-8000-000000000102', 'Amelia', 'Admin'),
  ('019a1000-0000-7000-8000-000000000103', 'Taylor', 'Target'),
  ('019a1000-0000-7000-8000-000000000104', 'Morgan', 'Member'),
  ('019a1000-0000-7000-8000-000000000105', 'Oscar', 'Outsider');

insert into organizations.organizations (id, type_code, legal_name, display_name, responsible_party)
values
  ('019a1000-0000-7000-8000-000000000201', 'professional_practice', null, 'Core Practice', '{"party_kind":"natural_person","party_name":"Olivia Owner","purpose":"studio_operations"}'),
  ('019a1000-0000-7000-8000-000000000202', 'gym', 'Other Gym SAS', 'Other Gym', '{"party_kind":"legal_entity","party_name":"Other Gym SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id)
values
  ('019a1000-0000-7000-8000-000000000301', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000101'),
  ('019a1000-0000-7000-8000-000000000302', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000102'),
  ('019a1000-0000-7000-8000-000000000303', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000103'),
  ('019a1000-0000-7000-8000-000000000304', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000104'),
  ('019a1000-0000-7000-8000-000000000305', '019a1000-0000-7000-8000-000000000202', '019a1000-0000-7000-8000-000000000105'),
  ('019a1000-0000-7000-8000-000000000306', '019a1000-0000-7000-8000-000000000202', '019a1000-0000-7000-8000-000000000104');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019a1000-0000-7000-8000-000000000301', 'owner'),
  ('019a1000-0000-7000-8000-000000000301', 'admin'),
  ('019a1000-0000-7000-8000-000000000302', 'admin'),
  ('019a1000-0000-7000-8000-000000000303', 'staff'),
  ('019a1000-0000-7000-8000-000000000305', 'owner');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000101', true);
select throws_ok(
  $$ insert into organizations.organization_sites (organization_id, name) values ('019a1000-0000-7000-8000-000000000201', 'Forged site') $$,
  '42501', null, 'T-ORG-5 active owner cannot INSERT a site directly'
);
select throws_ok(
  $$ update organizations.organization_sites set status = 'inactive' where id = '019a1000-0000-7000-8000-000000000999' $$,
  '42501', null, 'T-ORG-5 active owner cannot UPDATE a site directly'
);
select throws_ok(
  $$ delete from organizations.organization_sites where id = '019a1000-0000-7000-8000-000000000999' $$,
  '42501', null, 'T-ORG-5 active owner cannot DELETE a site directly'
);
reset role;

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000104', true);
select set_config('app.request_id', '61111111-1111-4111-8111-111111111111', true);
select is(organizations.read_organization('019a1000-0000-7000-8000-000000000201')->>'id', '019a1000-0000-7000-8000-000000000201', 'T-ORG-RLS-04 active member reads the closed projection');

reset role;
select is((select count(*) from privacy.access_events where subject_organization_id = '019a1000-0000-7000-8000-000000000201' and request_id = '61111111-1111-4111-8111-111111111111'), 1::bigint, 'T-ACCESS-8 read records access before return');
select results_eq(
  $$ select access_mode::text, resource, actor_membership_id::text from privacy.access_events where request_id = '61111111-1111-4111-8111-111111111111' $$,
  $$ values ('organization_operational'::text, 'organizations.organization_context'::text, '019a1000-0000-7000-8000-000000000304'::text) $$,
  'T-ACCESS-9 audit context is closed'
);

create function pg_temp.reject_organization_audit_tg()
returns trigger
language plpgsql
as $function$
begin
  if new.request_id = '61111111-1111-4111-8111-111111111190' then
    raise exception 'forced access audit failure';
  end if;
  return new;
end
$function$;

create trigger trg_access_events_before_insert_test_failure
before insert on privacy.access_events
for each row execute function pg_temp.reject_organization_audit_tg();

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000104', true);
select set_config('app.request_id', '61111111-1111-4111-8111-111111111190', true);
select throws_ok(
  $$ select organizations.read_organization('019a1000-0000-7000-8000-000000000201') $$,
  'P0001', 'forced access audit failure', 'T-ACCESS-3 audit insertion failure prevents the organization projection'
);
reset role;
select is(
  (select count(*) from privacy.access_events where request_id = '61111111-1111-4111-8111-111111111190'),
  0::bigint,
  'T-ACCESS-3 failed read leaves no access event or returned effect'
);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000104', true);
select set_config('app.actor_membership_id', '019a1000-0000-7000-8000-000000000304', true);
select set_config('app.request_id', '61111111-1111-4111-8111-111111111191', true);
select set_config('app.access_purpose', 'studio_organization_context', true);
select throws_ok(
  $$ select privacy.log_access_event(null, null, null, null, null, null, null, 'organization_operational', 'organizations.organization_context', 'allowed') $$,
  '22023', null, 'T-ACCESS-9 rejects an audit event with zero subjects'
);
select throws_ok(
  $$ select privacy.log_access_event('019a1000-0000-7000-8000-000000000104', '019a1000-0000-7000-8000-000000000201', null, null, null, null, null, 'organization_operational', 'organizations.organization_context', 'allowed') $$,
  '22023', null, 'T-ACCESS-9 rejects an audit event with two subjects'
);
select set_config('app.actor_membership_id', '019a1000-0000-7000-8000-000000000306', true);
select throws_ok(
  $$ select privacy.log_access_event(null, '019a1000-0000-7000-8000-000000000201', null, null, null, null, null, 'organization_operational', 'organizations.organization_context', 'allowed') $$,
  '42501', null, 'T-ACCESS-9 rejects a membership from another tenant'
);
select set_config('app.actor_membership_id', '019a1000-0000-7000-8000-000000000303', true);
select throws_ok(
  $$ select privacy.log_access_event(null, '019a1000-0000-7000-8000-000000000201', null, null, null, null, null, 'organization_operational', 'organizations.organization_context', 'allowed') $$,
  '42501', null, 'T-ACCESS-9 rejects another person membership'
);
select set_config('app.actor_membership_id', '019a1000-0000-7000-8000-000000000304', true);
select throws_ok(
  $$ select privacy.log_access_event(null, '019a1000-0000-7000-8000-000000000201', null, null, null, null, null, 'organization_operational', 'organizations.other_context', 'allowed') $$,
  '23514', null, 'T-ACCESS-9 rejects another organization resource'
);
select throws_ok(
  $$ select privacy.log_access_event(null, '019a1000-0000-7000-8000-000000000201', null, null, null, null, null, 'live', 'organizations.organization_context', 'allowed') $$,
  '23514', null, 'T-ACCESS-9 rejects another organization access mode'
);
select throws_ok(
  $$ select privacy.log_access_event(null, '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000999', null, null, null, null, 'organization_operational', 'organizations.organization_context', 'allowed') $$,
  '23514', null, 'T-ACCESS-9 rejects personal context in the organization branch'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000105', true);
select set_config('app.request_id', '61111111-1111-4111-8111-111111111112', true);
select throws_ok($$ select organizations.read_organization('019a1000-0000-7000-8000-000000000201') $$, 'P0002', null, 'T-ORG-RLS-05 another tenant gets hidden not-found');
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000104', true);
select set_config('app.request_id', '', true);
select throws_ok($$ select organizations.read_organization('019a1000-0000-7000-8000-000000000201') $$, '22023', null, 'T-ACCESS-10 missing audit request context fails closed');
select throws_ok($$ select id from organizations.organizations $$, '42501', null, 'T-ORG-RLS-06 runtime cannot bypass closed read');

select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select is((organizations.update_organization('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', 0, '{"display_name":"Core Practice Updated","legal_name":"Core Practice SAS"}', '71111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000401', decode(repeat('71', 32), 'hex'))->>'revision_number')::bigint, 1::bigint, 'T-ORG-IDEM-02 admin update increments revision');
reset role;
select is((select count(*) from organizations.organization_events where organization_id = '019a1000-0000-7000-8000-000000000201' and event_type = 'organization.updated.v1'), 1::bigint, 'T-ORG-INT-46 update emits one event');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select is((organizations.update_organization('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', 0, '{"display_name":"Core Practice Updated","legal_name":"Core Practice SAS"}', '71111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000401', decode(repeat('71', 32), 'hex'))->>'revision_number')::bigint, 1::bigint, 'T-ORG-IDEM-03 replay returns original receipt');
reset role;
select is((select count(*) from organizations.organization_events where organization_id = '019a1000-0000-7000-8000-000000000201' and event_type = 'organization.updated.v1'), 1::bigint, 'T-ORG-IDEM-04 replay emits no event');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select is((organizations.update_organization('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', 1, '{"display_name":"Core Practice Updated"}', '71111111-1111-4111-8111-111111111112', '019a1000-0000-7000-8000-000000000402', decode(repeat('72', 32), 'hex'))->>'revision_number')::bigint, 1::bigint, 'T-ORG-IDEM-05 no-op preserves revision');
reset role;
select is((select count(*) from organizations.organization_events where organization_id = '019a1000-0000-7000-8000-000000000201' and event_type = 'organization.updated.v1'), 1::bigint, 'T-ORG-IDEM-06 no-op emits no event');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select throws_ok($$ select organizations.update_organization('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', 0, '{"display_name":"Stale"}', '71111111-1111-4111-8111-111111111113', '019a1000-0000-7000-8000-000000000403', decode(repeat('73', 32), 'hex')) $$, '40001', null, 'T-ORG-INT-47 stale revision rejected');
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000104', true);
select throws_ok($$ select organizations.update_organization('019a1000-0000-7000-8000-000000000104', '019a1000-0000-7000-8000-000000000201', 1, '{"display_name":"Forbidden"}', '71111111-1111-4111-8111-111111111114', '019a1000-0000-7000-8000-000000000404', decode(repeat('74', 32), 'hex')) $$, '42501', null, 'T-ORG-RLS-07 member cannot update');
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select is(organizations.update_organization('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', 1, '{"type_code":"studio"}', '71111111-1111-4111-8111-111111111115', '019a1000-0000-7000-8000-000000000405', decode(repeat('75', 32), 'hex'))->>'type_code', 'studio', 'T-ORG-INT-48 approved transition succeeds');
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000105', true);
select throws_ok($$ select organizations.update_organization('019a1000-0000-7000-8000-000000000105', '019a1000-0000-7000-8000-000000000202', 0, '{"type_code":"studio"}', '71111111-1111-4111-8111-111111111116', '019a1000-0000-7000-8000-000000000406', decode(repeat('76', 32), 'hex')) $$, '23514', 'IX-45 organization type transition is not active', 'T-ORG-INT-49 unpublished transition fails IX-45');

select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
create temporary table created_site as select organizations.create_site('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', '{"name":"Sede Centro","address":"Carrera 7"}', '81111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000501', decode(repeat('81', 32), 'hex')) as result;
select is(((select result from created_site)->>'revision_number')::bigint, 0::bigint, 'T-ORG-IDEM-07 site starts at revision zero');
select is(organizations.create_site('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', '{"name":"Sede Centro","address":"Carrera 7"}', '81111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000501', decode(repeat('81', 32), 'hex'))->>'id', (select result->>'id' from created_site), 'T-ORG-IDEM-08 site replay returns original');
reset role;
select is((select count(*) from organizations.organization_sites where organization_id = '019a1000-0000-7000-8000-000000000201'), 1::bigint, 'T-ORG-IDEM-09 no duplicate site');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select is((organizations.update_site('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', (select (result->>'id')::uuid from created_site), 0, '{"status":"inactive"}', '81111111-1111-4111-8111-111111111112', '019a1000-0000-7000-8000-000000000502', decode(repeat('82', 32), 'hex'))->>'revision_number')::bigint, 1::bigint, 'T-ORG-IDEM-10 site update increments revision');
reset role;
select is((select count(*) from organizations.organization_events where organization_id = '019a1000-0000-7000-8000-000000000201' and event_type = 'organization.site_updated.v1'), 1::bigint, 'T-ORG-INT-50 site update emits event');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000104', true);
select throws_ok($$ select organizations.create_site('019a1000-0000-7000-8000-000000000104', '019a1000-0000-7000-8000-000000000201', '{"name":"Forbidden"}', '81111111-1111-4111-8111-111111111113', '019a1000-0000-7000-8000-000000000503', decode(repeat('83', 32), 'hex')) $$, '42501', null, 'T-ORG-RLS-08 member cannot create site');
select set_config('app.request_id', '61111111-1111-4111-8111-111111111113', true);
select is(jsonb_array_length(organizations.read_organization('019a1000-0000-7000-8000-000000000201')->'sites'), 1, 'T-ORG-RLS-09 projection includes minimal site context');

select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
create temporary table granted_role as select organizations.grant_membership_role('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000303', 'coach', '91111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000601', decode(repeat('91', 32), 'hex')) as result;
select is((select result->>'role_code' from granted_role), 'coach', 'T-ORG-IDEM-11 admin grants role');
select is(organizations.grant_membership_role('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000303', 'coach', '91111111-1111-4111-8111-111111111112', '019a1000-0000-7000-8000-000000000602', decode(repeat('92', 32), 'hex'))->>'valid_from', (select result->>'valid_from' from granted_role), 'T-ORG-IDEM-12 duplicate command converges');
reset role;
select is((select count(*) from organizations.membership_roles where membership_id = '019a1000-0000-7000-8000-000000000303' and role_code = 'coach' and valid_to is null), 1::bigint, 'T-ORG-INT-51 no duplicate role vigency');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select throws_ok($$ select organizations.grant_membership_role('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000303', 'owner', '91111111-1111-4111-8111-111111111113', '019a1000-0000-7000-8000-000000000603', decode(repeat('93', 32), 'hex')) $$, '22023', null, 'T-ORG-RLS-10 generic management cannot grant owner');
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000104', true);
select throws_ok($$ select organizations.grant_membership_role('019a1000-0000-7000-8000-000000000104', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000303', 'coach', '91111111-1111-4111-8111-111111111114', '019a1000-0000-7000-8000-000000000604', decode(repeat('94', 32), 'hex')) $$, '42501', null, 'T-ORG-RLS-11 member cannot grant role');

reset role;
update organizations.membership_roles set valid_to = clock_timestamp() where membership_id = '019a1000-0000-7000-8000-000000000303' and role_code = 'coach' and valid_to is null;
select is(
  (
    select aggregate_type
    from system.idempotency_keys
    where command_id = '019a1000-0000-7000-8000-000000000601'
  ),
  'membership_role',
  'T-ORG-IDEM-20 role grant receipt references the durable role row'
);
select ok(
  (
    select response = jsonb_build_object(
      'status', 'succeeded',
      'resource_type', aggregate_type,
      'resource_id', aggregate_id
    )
    from system.idempotency_keys
    where command_id = '019a1000-0000-7000-8000-000000000601'
  ),
  'T-ORG-IDEM-21 role receipt stores only the closed non-PII document'
);
update system.idempotency_keys
set response_expires_at = clock_timestamp() - interval '1 second'
where command_id = '019a1000-0000-7000-8000-000000000601';
select ok(
  system.expire_idempotency_response(
    (select id from system.idempotency_keys where command_id = '019a1000-0000-7000-8000-000000000601')
  ),
  'T-ORG-IDEM-22 expired role response is cleared'
);
select ok(
  (
    select response is null
      and response_schema_version is null
      and status = 'succeeded'
      and http_status = 200
      and outcome_code = 'organization-role-granted'
      and aggregate_type = 'membership_role'
      and aggregate_id is not null
      and octet_length(request_hash) = 32
    from system.idempotency_keys
    where command_id = '019a1000-0000-7000-8000-000000000601'
  ),
  'T-ORG-IDEM-23 expiry preserves durable identity, outcome, hash and aggregate reference'
);
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select is(organizations.grant_membership_role('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000303', 'coach', '91111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000601', decode(repeat('91', 32), 'hex'))->>'valid_from', (select result->>'valid_from' from granted_role), 'T-ORG-IDEM-13 replay survives later revocation');
reset role;
select is((select count(*) from organizations.membership_roles where membership_id = '019a1000-0000-7000-8000-000000000303' and role_code = 'coach' and valid_to is null), 0::bigint, 'T-ORG-IDEM-14 replay does not reopen role');

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select throws_ok($$ select organizations.transfer_ownership('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000303', 'a1111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000701', decode(repeat('a1', 32), 'hex')) $$, '42501', null, 'T-ORG-RLS-12 admin cannot transfer ownership');
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000101', true);
select is(organizations.transfer_ownership('019a1000-0000-7000-8000-000000000101', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000303', 'a1111111-1111-4111-8111-111111111112', '019a1000-0000-7000-8000-000000000702', decode(repeat('a2', 32), 'hex'))->>'owner_membership_id', '019a1000-0000-7000-8000-000000000303', 'T-ORG-IDEM-15 owner transfers atomically');

reset role;
set constraints all immediate;
select is((select count(*) from organizations.organization_memberships as membership join organizations.membership_roles as role on role.membership_id = membership.id where membership.organization_id = '019a1000-0000-7000-8000-000000000201' and membership.status = 'active' and role.role_code = 'owner' and role.valid_to is null), 1::bigint, 'T-ORG-INT-52 transfer preserves one owner');
select ok(exists(select 1 from organizations.membership_roles where membership_id = '019a1000-0000-7000-8000-000000000301' and role_code = 'admin' and valid_to is null), 'T-ORG-INT-53 former owner retains explicit roles');
select is((select count(*) from organizations.membership_roles where membership_id = '019a1000-0000-7000-8000-000000000301' and role_code in ('coach', 'staff') and valid_to is null), 0::bigint, 'T-ORG-INT-54 no residual role assigned');
set constraints all deferred;
select is(
  (
    select aggregate_type
    from system.idempotency_keys
    where command_id = '019a1000-0000-7000-8000-000000000702'
  ),
  'organization_ownership_transfer',
  'T-ORG-IDEM-24 transfer receipt references its immutable event'
);
update system.idempotency_keys
set response_expires_at = clock_timestamp() - interval '1 second'
where command_id = '019a1000-0000-7000-8000-000000000702';
select ok(
  system.expire_idempotency_response(
    (select id from system.idempotency_keys where command_id = '019a1000-0000-7000-8000-000000000702')
  ),
  'T-ORG-IDEM-25 expired transfer response is cleared'
);

set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000103', true);
select is(
  organizations.transfer_ownership(
    '019a1000-0000-7000-8000-000000000103',
    '019a1000-0000-7000-8000-000000000201',
    '019a1000-0000-7000-8000-000000000304',
    'a1111111-1111-4111-8111-111111111113',
    '019a1000-0000-7000-8000-000000000703',
    decode(repeat('a3', 32), 'hex')
  )->>'owner_membership_id',
  '019a1000-0000-7000-8000-000000000304',
  'T-ORG-IDEM-26 a later command may move ownership forward'
);

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000101', true);
select is(organizations.transfer_ownership('019a1000-0000-7000-8000-000000000101', '019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000303', 'a1111111-1111-4111-8111-111111111112', '019a1000-0000-7000-8000-000000000702', decode(repeat('a2', 32), 'hex'))->>'owner_membership_id', '019a1000-0000-7000-8000-000000000303', 'T-ORG-IDEM-16 former owner replays durable transfer');

reset role;
select is((select count(*) from organizations.organization_events where organization_id = '019a1000-0000-7000-8000-000000000201' and event_type = 'organization.ownership_transferred.v1'), 2::bigint, 'T-ORG-IDEM-17 replay emits no duplicate transfer event');
select ok(
  not exists (
    select 1
    from system.idempotency_keys as receipt
    where receipt.operation_code in ('OP-ORG-002', 'OP-ORG-003', 'OP-ORG-004', 'OP-ORG-007', 'OP-ORG-011')
      and receipt.response is not null
      and receipt.response <> jsonb_build_object(
        'status', 'succeeded',
        'resource_type', receipt.aggregate_type,
        'resource_id', receipt.aggregate_id
      )
  ),
  'T-ORG-IDEM-27 all organization receipts exclude names, addresses and domain payloads'
);
with expired_receipts as (
  update system.idempotency_keys
  set response_expires_at = clock_timestamp() - interval '1 second'
  where command_id in (
    '019a1000-0000-7000-8000-000000000401',
    '019a1000-0000-7000-8000-000000000501',
    '019a1000-0000-7000-8000-000000000502'
  )
  returning id
)
select ok(
  (
    select bool_and(system.expire_idempotency_response(receipt.id))
    from expired_receipts as receipt
  ),
  'T-ORG-IDEM-28 organization and site replay documents expire after the TTL'
);
select is(
  (
    select count(*)
    from system.idempotency_keys
    where command_id in (
      '019a1000-0000-7000-8000-000000000401',
      '019a1000-0000-7000-8000-000000000501',
      '019a1000-0000-7000-8000-000000000502'
    )
      and response is null
      and response_schema_version is null
  ),
  3::bigint,
  'T-ORG-IDEM-29 all three expired documents retain only durable tombstones'
);
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select is(
  organizations.update_organization('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', 0, '{"display_name":"Core Practice Updated","legal_name":"Core Practice SAS"}', '71111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000401', decode(repeat('71', 32), 'hex'))->>'id',
  '019a1000-0000-7000-8000-000000000201',
  'T-ORG-IDEM-30 expired organization replay reconstructs the governed aggregate'
);
select is(
  organizations.create_site('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', '{"name":"Sede Centro","address":"Carrera 7"}', '81111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000501', decode(repeat('81', 32), 'hex'))->>'id',
  (select result->>'id' from created_site),
  'T-ORG-IDEM-31 expired site creation replay reconstructs the same site'
);
select is(
  (organizations.update_site('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', (select (result->>'id')::uuid from created_site), 0, '{"status":"inactive"}', '81111111-1111-4111-8111-111111111112', '019a1000-0000-7000-8000-000000000502', decode(repeat('82', 32), 'hex'))->>'revision_number')::bigint,
  1::bigint,
  'T-ORG-IDEM-32 expired site update replay reconstructs the governed site'
);
reset role;
select results_eq(
  $$
    select
      (select count(*) from organizations.organization_sites where organization_id = '019a1000-0000-7000-8000-000000000201'),
      (select count(*) from organizations.organization_events where organization_id = '019a1000-0000-7000-8000-000000000201' and event_type = 'organization.updated.v1'),
      (select count(*) from organizations.organization_events where organization_id = '019a1000-0000-7000-8000-000000000201' and event_type = 'organization.site_updated.v1')
  $$,
  $$ values (1::bigint, 2::bigint, 1::bigint) $$,
  'T-ORG-IDEM-33 expired replays do not re-execute any domain effect'
);
update organizations.organization_memberships
set status = 'terminated', ended_at = clock_timestamp()
where id = '019a1000-0000-7000-8000-000000000302';
set local role allfit_api;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019a1000-0000-7000-8000-000000000102', true);
select throws_ok(
  $$ select organizations.update_organization('019a1000-0000-7000-8000-000000000102', '019a1000-0000-7000-8000-000000000201', 0, '{"display_name":"Core Practice Updated","legal_name":"Core Practice SAS"}', '71111111-1111-4111-8111-111111111111', '019a1000-0000-7000-8000-000000000401', decode(repeat('71', 32), 'hex')) $$,
  'P0002', null,
  'T-ORG-IDEM-34 replay rechecks the principal active membership before reconstruction'
);
reset role;
select throws_ok(
  $$ insert into privacy.access_events (subject_organization_id, actor_person_id, actor_membership_id, relationship_id, purpose, access_mode, resource, request_id, result) values ('019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000104', '019a1000-0000-7000-8000-000000000304', '019a1000-0000-7000-8000-000000000999', 'forged_context', 'organization_operational', 'organizations.organization_context', '61111111-1111-4111-8111-111111111199', 'allowed') $$,
  '23514', null, 'T-ORG-INT-55 IX-23 rejects forged organization audit context'
);
update organizations.organization_memberships
set status = 'terminated', ended_at = clock_timestamp()
where id = '019a1000-0000-7000-8000-000000000304';
select throws_ok(
  $$ insert into privacy.access_events (subject_organization_id, actor_person_id, actor_membership_id, purpose, access_mode, resource, request_id, result) values ('019a1000-0000-7000-8000-000000000201', '019a1000-0000-7000-8000-000000000104', '019a1000-0000-7000-8000-000000000304', 'forged_context', 'organization_operational', 'organizations.organization_context', '61111111-1111-4111-8111-111111111198', 'allowed') $$,
  '23514', null, 'T-ORG-INT-57 IX-23 rejects inactive organization audit membership'
);
select ok(
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'organizations'
      and routine_name = 'update_organization'
      and grantee = 'PUBLIC'
      and privilege_type = 'EXECUTE'
  ),
  'T-ORG-PHY-04 public cannot execute commands'
);
select is((select type_code from organizations.organizations where id = '019a1000-0000-7000-8000-000000000201'), 'studio', 'T-ORG-INT-56 team roles never change organization type');

select * from finish();
rollback;
