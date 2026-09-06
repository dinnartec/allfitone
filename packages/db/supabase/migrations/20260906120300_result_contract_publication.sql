-- Publication and deprecation of result contracts, with their fixture suite.
--
-- `OP-CAT-006`. A result contract says what a session must carry to count as
-- complete for one activity family. Publishing it is the only way to change it:
-- a published version is immutable, and correcting one means publishing the next.
--
-- That immutability is what keeps history honest. An execution freezes the
-- contract and version it was validated against, so publishing v2 cannot
-- reinterpret a session recorded under v1, and deprecating v1 only stops new
-- executions from freezing it. Neither operation rewrites anything already
-- recorded — which is why the guards below reject an UPDATE of a published row
-- rather than trusting the command to be well written.
--
-- The fixtures are the reason a contract can be trusted at all: a rule nobody
-- demonstrated failing is a rule nobody tested. Publishing without at least one
-- passing and one failing case is refused.

set lock_timeout = '5s';
set statement_timeout = '60s';

create table catalog.contract_fixtures (
  id uuid not null default extensions.uuid_generate_v7(),
  result_contract_id uuid not null,
  kind text not null,
  payload_schema_version smallint not null default 1,
  payload jsonb not null,
  expected text not null,
  constraint pk_contract_fixtures primary key (id),
  constraint fk_contract_fixtures_result_contract foreign key (result_contract_id) references catalog.result_contracts(id) on delete cascade,
  constraint ck_contract_fixtures_kind check (kind in ('valid', 'invalid')),
  constraint ck_contract_fixtures_schema_version check (payload_schema_version = 1),
  constraint ck_contract_fixtures_payload check (jsonb_typeof(payload) = 'object'),
  constraint ck_contract_fixtures_expected check (
    btrim(expected) <> '' and char_length(expected) <= 200
  )
);

create index idx_contract_fixtures_contract_kind
  on catalog.contract_fixtures (result_contract_id, kind);

alter table catalog.contract_fixtures owner to allfit_owner;
alter table catalog.contract_fixtures enable row level security;
alter table catalog.contract_fixtures force row level security;

create policy contract_fixtures_all_owner on catalog.contract_fixtures
  for all to allfit_owner using (true) with check (true);

-- Fixtures are the platform's own evidence. Neither product surface reads them.
revoke all on catalog.contract_fixtures from public, allfit_api;

-- These two tables carried a read policy but no write path, so the platform
-- could not publish through them at all. The write policies are deliberately
-- separate from the read one: widening the existing SELECT would let every other
-- security-definer function see unpublished contracts, which is exactly what
-- `result_contracts_select_actor` exists to prevent. What actually protects a
-- published version is `catalog.prevent_published_result_contract_mutation`,
-- which already refuses every change to a published row except the exact flip to
-- deprecated, plus the duty check in the command below.
--
-- The extra SELECT policy is what makes closing an association possible at all.
-- PostgreSQL requires an updated row to remain visible, and the effective-only
-- read policy hides a row the moment `valid_to` passes — so setting `valid_to`
-- was rejected by the very policy that describes the lifecycle. It is scoped to
-- the support actor, a context only the Backoffice path establishes, so product
-- reads keep seeing effective associations and nothing more.
create policy result_contracts_insert_platform on catalog.result_contracts
  for insert to allfit_owner with check (true);
create policy result_contracts_update_platform on catalog.result_contracts
  for update to allfit_owner using (true) with check (true);
create policy activity_type_result_contracts_insert_platform
  on catalog.activity_type_result_contracts
  for insert to allfit_owner with check (true);
create policy activity_type_result_contracts_update_platform
  on catalog.activity_type_result_contracts
  for update to allfit_owner using (true) with check (true);
create policy activity_type_result_contracts_select_platform
  on catalog.activity_type_result_contracts
  for select to allfit_owner
  using (access_control.actor_kind() = 'support');

-- The fixtures of a published contract are kept for reproducibility: they are the
-- record of what the contract was demonstrated to accept and to refuse.
create or replace function catalog.preserve_published_contract_fixtures()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  contract_status catalog.publication_status;
begin
  select contract.status into contract_status
  from catalog.result_contracts as contract
  where contract.id = coalesce(new.result_contract_id, old.result_contract_id);

  if contract_status is distinct from 'draft' then
    raise exception 'the fixtures of a published contract are immutable'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end
$function$;

alter function catalog.preserve_published_contract_fixtures() owner to allfit_owner;
revoke all on function catalog.preserve_published_contract_fixtures() from public;

create trigger trg_contract_fixtures_change_preserve_publication
before update or delete on catalog.contract_fixtures
for each row execute function catalog.preserve_published_contract_fixtures();

-- The platform actor sees the whole association history, superseded windows
-- included: an operator publishing a correction needs to see what it replaced.
create or replace function catalog.result_contract_projection(p_contract_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', contract.id,
    'contract_code', contract.contract_code,
    'version_number', contract.version_number,
    'activity_family', contract.activity_family,
    'contract_schema_version', contract.contract_schema_version,
    'envelope', contract.envelope,
    'minimums', contract.minimums,
    'status', contract.status,
    'published_at', contract.published_at,
    'fixtures', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', fixture.id,
            'kind', fixture.kind,
            'payload_schema_version', fixture.payload_schema_version,
            'payload', fixture.payload,
            'expected', fixture.expected
          )
          order by fixture.kind, fixture.id
        )
        from catalog.contract_fixtures as fixture
        where fixture.result_contract_id = contract.id
      ),
      '[]'::jsonb
    ),
    'activity_type_bindings', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', binding.id,
            'activity_type_id', binding.activity_type_id,
            'is_default', binding.is_default,
            'valid_from', binding.valid_from,
            'valid_to', binding.valid_to
          )
          order by binding.valid_from desc, binding.id desc
        )
        from catalog.activity_type_result_contracts as binding
        where binding.result_contract_id = contract.id
      ),
      '[]'::jsonb
    )
  )
  from catalog.result_contracts as contract
  where contract.id = p_contract_id
$function$;

create or replace function catalog.require_global_catalog_curator(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
    or not access_control.has_platform_duty(
      p_actor_person_id, p_actor_session_id, 'curate_global_catalog'
    ) then
    raise exception 'publishing the global catalogue requires an effective duty'
      using errcode = '42501';
  end if;
end
$function$;

create or replace function catalog.publish_result_contract(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_contract_code text,
  p_activity_family catalog.activity_family,
  p_envelope jsonb,
  p_minimums jsonb,
  p_fixtures jsonb,
  p_activity_type_id uuid,
  p_is_default boolean,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  contract_id uuid;
  next_version integer;
  published timestamptz := clock_timestamp();
  response jsonb;
  valid_count integer;
  invalid_count integer;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);

  if p_contract_code !~ '^[a-z][a-z0-9_.]{1,63}$'
    or jsonb_typeof(p_envelope) <> 'object'
    or jsonb_typeof(p_minimums) <> 'object'
    or jsonb_typeof(p_fixtures) <> 'array' then
    raise exception 'invalid result contract definition' using errcode = '22023';
  end if;

  select
    count(*) filter (where fixture->>'kind' = 'valid'),
    count(*) filter (where fixture->>'kind' = 'invalid')
  into valid_count, invalid_count
  from jsonb_array_elements(p_fixtures) as fixture
  where jsonb_typeof(fixture) = 'object'
    and jsonb_typeof(fixture->'payload') = 'object'
    and btrim(coalesce(fixture->>'expected', '')) <> '';

  -- A contract nobody demonstrated refusing something is not a contract.
  if valid_count < 1 or invalid_count < 1 then
    raise exception 'a result contract needs a passing and a failing fixture'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from catalog.activity_types as activity_type
    where activity_type.id = p_activity_type_id
      and activity_type.status = 'published'
      and activity_type.content_scope = 'global'
  ) then
    raise exception 'activity type not found in the global catalogue' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-CAT-006', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select catalog.result_contract_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent result contract publication not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  -- Versions are assigned by the server. A client-chosen number would race, and
  -- correcting a contract has to produce the next version, never overwrite one.
  select coalesce(max(contract.version_number), 0) + 1 into next_version
  from catalog.result_contracts as contract
  where contract.contract_code = p_contract_code;

  insert into catalog.result_contracts (
    contract_code, version_number, activity_family, envelope, minimums, status, published_at
  ) values (
    p_contract_code, next_version, p_activity_family, p_envelope, p_minimums, 'published', published
  )
  returning id into contract_id;

  insert into catalog.contract_fixtures (result_contract_id, kind, payload, expected)
  select contract_id, fixture->>'kind', fixture->'payload', btrim(fixture->>'expected')
  from jsonb_array_elements(p_fixtures) as fixture;

  -- Closing the previous default is what makes the new one effective. The old
  -- association keeps its window: executions frozen under it stay valid.
  if p_is_default then
    update catalog.activity_type_result_contracts
    set valid_to = published
    where activity_type_id = p_activity_type_id and is_default and valid_to is null;
  end if;

  insert into catalog.activity_type_result_contracts (
    activity_type_id, result_contract_id, is_default, valid_from
  ) values (
    p_activity_type_id, contract_id, coalesce(p_is_default, false), published
  );

  perform system.enqueue_outbox_event(
    'result_contract', contract_id, 'catalog.result_contract_published.v1',
    jsonb_build_object(
      'result_contract_id', contract_id,
      'contract_code', p_contract_code,
      'version_number', next_version
    )
  );

  response := catalog.result_contract_projection(contract_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'result-contract-published',
    'result_contract', contract_id
  );
  return query select response, false;
end
$function$;

create or replace function catalog.deprecate_result_contract(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_contract_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  target catalog.result_contracts%rowtype;
  response jsonb;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);

  select contract.* into target
  from catalog.result_contracts as contract
  where contract.id = p_contract_id
  for update;

  if target.id is null or target.status = 'draft' then
    raise exception 'published result contract not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-CAT-006', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select catalog.result_contract_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent result contract deprecation not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  -- Deprecating stops new executions from freezing this contract. It does not
  -- touch the executions that already froze it, and it never deletes a version.
  if target.status = 'published' then
    update catalog.result_contracts
    set status = 'deprecated'
    where id = target.id;

    update catalog.activity_type_result_contracts
    set valid_to = clock_timestamp()
    where result_contract_id = target.id and valid_to is null;
  end if;

  response := catalog.result_contract_projection(target.id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'result-contract-deprecated',
    'result_contract', target.id
  );
  return query select response, false;
end
$function$;

alter function catalog.result_contract_projection(uuid) owner to allfit_owner;
alter function catalog.require_global_catalog_curator(uuid, uuid) owner to allfit_owner;
alter function catalog.publish_result_contract(
  uuid, uuid, text, catalog.activity_family, jsonb, jsonb, jsonb, uuid, boolean, uuid, uuid, bytea
) owner to allfit_owner;
alter function catalog.deprecate_result_contract(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;

revoke all on function catalog.result_contract_projection(uuid) from public;
revoke all on function catalog.require_global_catalog_curator(uuid, uuid) from public;
revoke all on function catalog.publish_result_contract(
  uuid, uuid, text, catalog.activity_family, jsonb, jsonb, jsonb, uuid, boolean, uuid, uuid, bytea
) from public;
revoke all on function catalog.deprecate_result_contract(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;

grant execute on function catalog.publish_result_contract(
  uuid, uuid, text, catalog.activity_family, jsonb, jsonb, jsonb, uuid, boolean, uuid, uuid, bytea
) to allfit_api;
grant execute on function catalog.deprecate_result_contract(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
