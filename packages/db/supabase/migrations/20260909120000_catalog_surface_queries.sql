-- Global catalogue reads for the `/catalog/v1` surface.
--
-- `OP-CAT-007`, `OP-CAT-008` and `OP-CAT-012`. The catalogue has no subject and
-- no tenant: it is global published content that Space, Studio and Backoffice all
-- read. What it does require is an authenticated, active person — the existing
-- read policies already refuse a null actor, and these functions refuse an actor
-- that is not an active person, so an abandoned session cannot keep reading.
--
-- The result-contract query exists to give a client useful messages before it
-- syncs, never to authorize anything. Validation stays on the server: publishing
-- and freezing a contract remain `OP-CAT-006` and the execution slice.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function catalog.require_catalog_reader()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  reader uuid := access_control.person();
begin
  if reader is null or not exists (
    select 1 from identity.people as person
    where person.id = reader and person.status = 'active'
  ) then
    raise exception 'the global catalogue requires an active authenticated person'
      using errcode = '42501';
  end if;
  return reader;
end
$function$;

-- No pagination in V1: the global catalogue is small and closed, and a stable
-- code is what a client caches against.
create or replace function catalog.list_disciplines()
returns table (code text, name text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform catalog.require_catalog_reader();
  return query
  select discipline.code, discipline.name
  from catalog.disciplines as discipline
  where discipline.status = 'published'
  order by discipline.code;
end
$function$;

create or replace function catalog.list_activity_types()
returns table (id uuid, discipline_code text, code text, name text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform catalog.require_catalog_reader();
  return query
  select activity.id, activity.discipline_code, activity.code, activity.name
  from catalog.activity_types as activity
  where activity.status = 'published'
    and activity.content_scope = 'global'
  order by activity.discipline_code, activity.code;
end
$function$;

-- Only effective associations. A superseded one keeps its window in the table
-- for the executions frozen under it, but a client validating a draft today must
-- not see it as available.
create or replace function catalog.list_activity_type_result_contracts(p_activity_type_id uuid)
returns table (
  result_contract_id uuid,
  contract_code text,
  version_number integer,
  activity_family catalog.activity_family,
  contract_schema_version smallint,
  envelope jsonb,
  minimums jsonb,
  is_default boolean,
  valid_from timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform catalog.require_catalog_reader();

  if not exists (
    select 1 from catalog.activity_types as activity
    where activity.id = p_activity_type_id
      and activity.status = 'published'
      and activity.content_scope = 'global'
  ) then
    raise exception 'activity type not found in the global catalogue' using errcode = 'P0002';
  end if;

  return query
  select
    contract.id,
    contract.contract_code,
    contract.version_number,
    contract.activity_family,
    contract.contract_schema_version,
    contract.envelope,
    contract.minimums,
    binding.is_default,
    binding.valid_from
  from catalog.activity_type_result_contracts as binding
  join catalog.result_contracts as contract
    on contract.id = binding.result_contract_id
   and contract.status = 'published'
  where binding.activity_type_id = p_activity_type_id
    and binding.valid_from <= clock_timestamp()
    and (binding.valid_to is null or binding.valid_to > clock_timestamp())
  order by binding.is_default desc, contract.contract_code, contract.version_number desc;
end
$function$;

alter function catalog.require_catalog_reader() owner to allfit_owner;
alter function catalog.list_disciplines() owner to allfit_owner;
alter function catalog.list_activity_types() owner to allfit_owner;
alter function catalog.list_activity_type_result_contracts(uuid) owner to allfit_owner;

revoke all on function catalog.require_catalog_reader() from public;
revoke all on function catalog.list_disciplines() from public;
revoke all on function catalog.list_activity_types() from public;
revoke all on function catalog.list_activity_type_result_contracts(uuid) from public;

-- The guard stays internal: the runtime role executes the three queries, never
-- the check that decides whether it may.
grant execute on function catalog.list_disciplines() to allfit_api;
grant execute on function catalog.list_activity_types() to allfit_api;
grant execute on function catalog.list_activity_type_result_contracts(uuid) to allfit_api;
