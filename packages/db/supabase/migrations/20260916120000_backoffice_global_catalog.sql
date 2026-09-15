-- NEW-CAT-GLOBAL-PUBLISH / OP-CAT-004 and OP-CAT-005 — curating the global catalogue
-- from Backoffice (`HU-BO-022`).
--
-- The tables already exist and every product reads them; what was missing was the way to
-- put something in them. These are the six commands and the one read that give
-- `curate_global_catalog` that power, and nothing else gains it: the commands take no
-- scope and no owner, so a gym's private content can never be pushed into the global
-- catalogue, and the archive commands do not find it.
--
-- **A published code is stable.** Publishing a code that is already published is refused.
-- An archived entry is republished only under the name it had: the code means the same
-- thing before and after, which is what lets a template written last year still resolve.
--
-- **Archiving withdraws, it does not delete.** `/catalog/v1` reads published rows only, so
-- an archived entry leaves search at once, while the row and its references stay: a
-- trigger refuses to delete a global entry, and the foreign keys refuse to orphan one.
-- A discipline is archived only once its global content already is — the alternative,
-- cascading, would retire content nobody asked to retire.
--
-- **Equipment has no table in V1.** The read says so rather than answering an empty list,
-- because "Allfit does not store this yet" and "there is none" are different facts.
--
-- No access record is written: the catalogue is not anyone's data.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Invariants the curation commands rely on
-- ---------------------------------------------------------------------------

-- Two global movements with the same name are the same movement written twice.
create unique index uidx_movements_global_name on catalog.movements (normalized_name)
  where content_scope = 'global';

create or replace function catalog.reject_global_catalog_deletion()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if old.content_scope = 'global' then
    raise exception 'a global catalogue entry is archived, never deleted' using errcode = '55000';
  end if;
  return old;
end
$function$;

create trigger trg_activity_types_before_delete_global
before delete on catalog.activity_types
for each row execute function catalog.reject_global_catalog_deletion();

create trigger trg_movements_before_delete_global
before delete on catalog.movements
for each row execute function catalog.reject_global_catalog_deletion();

-- The platform writes the global catalogue through its own functions. Reading a draft or
-- an archived row is part of curating, and no other actor may do either.
create policy disciplines_select_platform
  on catalog.disciplines
  for select to allfit_owner
  using (access_control.actor_kind() = 'support'::identity.actor_kind);

create policy disciplines_insert_platform
  on catalog.disciplines
  for insert to allfit_owner
  with check (access_control.actor_kind() = 'support'::identity.actor_kind);

create policy disciplines_update_platform
  on catalog.disciplines
  for update to allfit_owner
  using (access_control.actor_kind() = 'support'::identity.actor_kind)
  with check (access_control.actor_kind() = 'support'::identity.actor_kind);

create policy activity_types_all_platform
  on catalog.activity_types
  for all to allfit_owner
  using (
    content_scope = 'global'::catalog.content_scope
    and access_control.actor_kind() = 'support'::identity.actor_kind
  )
  with check (
    content_scope = 'global'::catalog.content_scope
    and owner_organization_id is null
    and access_control.actor_kind() = 'support'::identity.actor_kind
  );

create policy movements_all_platform
  on catalog.movements
  for all to allfit_owner
  using (
    content_scope = 'global'::catalog.content_scope
    and access_control.actor_kind() = 'support'::identity.actor_kind
  )
  with check (
    content_scope = 'global'::catalog.content_scope
    and num_nonnulls(owner_organization_id, owner_person_id) = 0
    and access_control.actor_kind() = 'support'::identity.actor_kind
  );

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create or replace function catalog.normalize_movement_name(p_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$function$;

-- How much would stop being findable if this entry were archived. Counted across every
-- scope, because a gym's template referencing a global discipline is exactly the reason
-- archiving must not delete.
create or replace function catalog.global_catalog_entry_projection(p_kind text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case p_kind
    when 'discipline' then (
      select jsonb_build_object(
        'kind', 'discipline',
        'id', discipline.id,
        'code', discipline.code,
        'discipline_code', discipline.code,
        'name', discipline.name,
        'status', discipline.status::text,
        'created_at', discipline.created_at,
        'in_use_count', (
          (select count(*) from catalog.activity_types as activity
            where activity.discipline_code = discipline.code)
          + (select count(*) from catalog.movements as movement
              where movement.discipline_code = discipline.code)
          + (select count(*) from planning.session_templates as template
              where template.discipline_code = discipline.code)
        )::integer
      )
      from catalog.disciplines as discipline
      where discipline.id = p_id
    )
    when 'activity_type' then (
      select jsonb_build_object(
        'kind', 'activity_type',
        'id', activity.id,
        'code', activity.code,
        'discipline_code', activity.discipline_code,
        'name', activity.name,
        'status', activity.status::text,
        'created_at', activity.created_at,
        'in_use_count', (
          (select count(*) from planning.planned_steps as step
            where step.activity_type_id = activity.id)
          + (select count(*) from planning.session_template_versions as version
              where version.activity_type_id = activity.id)
          + (select count(*) from catalog.activity_type_result_contracts as contract
              where contract.activity_type_id = activity.id)
        )::integer
      )
      from catalog.activity_types as activity
      where activity.id = p_id and activity.content_scope = 'global'
    )
    when 'movement' then (
      select jsonb_build_object(
        'kind', 'movement',
        'id', movement.id,
        'code', null::text,
        'discipline_code', movement.discipline_code,
        'name', movement.name,
        'status', movement.status::text,
        'created_at', movement.created_at,
        'in_use_count', (
          select count(*) from planning.planned_steps as step where step.movement_id = movement.id
        )::integer
      )
      from catalog.movements as movement
      where movement.id = p_id and movement.content_scope = 'global'
    )
  end
$function$;

create or replace function catalog.published_discipline(p_code text)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  found catalog.publication_status;
begin
  select discipline.status into found
  from catalog.disciplines as discipline
  where discipline.code = p_code;

  if found is null then
    raise exception 'discipline not found' using errcode = 'P0002';
  end if;
  if found <> 'published' then
    raise exception 'the discipline is not published' using errcode = '55000';
  end if;
  return p_code;
end
$function$;

-- ---------------------------------------------------------------------------
-- NEW-CAT-GLOBAL-PUBLISH — the catalogue as its curator sees it
-- ---------------------------------------------------------------------------

create or replace function catalog.list_global_catalog(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);

  return jsonb_build_object(
    'disciplines', coalesce((
      select jsonb_agg(catalog.global_catalog_entry_projection('discipline', discipline.id)
        order by discipline.code)
      from catalog.disciplines as discipline
    ), '[]'::jsonb),
    'activity_types', coalesce((
      select jsonb_agg(catalog.global_catalog_entry_projection('activity_type', activity.id)
        order by activity.discipline_code, activity.code)
      from catalog.activity_types as activity
      where activity.content_scope = 'global'
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(catalog.global_catalog_entry_projection('movement', movement.id)
        order by movement.discipline_code, movement.normalized_name)
      from catalog.movements as movement
      where movement.content_scope = 'global'
    ), '[]'::jsonb),
    -- Declared absent, not empty: V1 has no equipment table, and an empty list would read
    -- as "Allfit publishes no equipment", which is a claim we cannot make.
    'equipment_availability', 'not_modelled'
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-CAT-004 — publish
-- ---------------------------------------------------------------------------

create or replace function catalog.publish_discipline(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_code text,
  p_name text,
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
  response jsonb;
  target catalog.disciplines%rowtype;
  entry_id uuid;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);
  if coalesce(p_code, '') !~ '^[a-z][a-z0-9_]{1,63}$'
     or btrim(coalesce(p_name, '')) = ''
     or char_length(btrim(p_name)) > 120 then
    raise exception 'a catalogue entry needs a stable code and a name' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-CAT-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := catalog.global_catalog_entry_projection('discipline', receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent discipline publication not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  select * into target
  from catalog.disciplines as discipline
  where discipline.code = p_code
  for update;

  if target.id is null then
    insert into catalog.disciplines (code, name, status)
    values (p_code, btrim(p_name), 'published')
    returning id into entry_id;
  elsif target.status = 'published' then
    raise exception 'that discipline is already published' using errcode = '55000';
  elsif target.name is distinct from btrim(p_name) then
    -- Criterion 2: a code is stable and never becomes another thing.
    raise exception 'that code already names something else' using errcode = '55000';
  else
    update catalog.disciplines as discipline
    set status = 'published'
    where discipline.id = target.id;
    entry_id := target.id;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'discipline-published', 'catalog_discipline', entry_id
  );
  return query select catalog.global_catalog_entry_projection('discipline', entry_id), false;
end
$function$;

create or replace function catalog.publish_activity_type(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_discipline_code text,
  p_code text,
  p_name text,
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
  response jsonb;
  target catalog.activity_types%rowtype;
  entry_id uuid;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);
  if coalesce(p_code, '') !~ '^[a-z][a-z0-9_]{1,63}$'
     or btrim(coalesce(p_name, '')) = ''
     or char_length(btrim(p_name)) > 120 then
    raise exception 'a catalogue entry needs a stable code and a name' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-CAT-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := catalog.global_catalog_entry_projection('activity_type', receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent activity type publication not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  perform catalog.published_discipline(p_discipline_code);

  select * into target
  from catalog.activity_types as activity
  where activity.code = p_code and activity.content_scope = 'global'
  for update;

  if target.id is null then
    insert into catalog.activity_types (discipline_code, code, name, content_scope, status)
    values (p_discipline_code, p_code, btrim(p_name), 'global', 'published')
    returning id into entry_id;
  elsif target.status = 'published' then
    raise exception 'that activity type is already published' using errcode = '55000';
  elsif target.name is distinct from btrim(p_name)
     or target.discipline_code is distinct from p_discipline_code then
    raise exception 'that code already names something else' using errcode = '55000';
  else
    update catalog.activity_types as activity
    set status = 'published'
    where activity.id = target.id;
    entry_id := target.id;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'activity-type-published', 'catalog_activity_type', entry_id
  );
  return query select catalog.global_catalog_entry_projection('activity_type', entry_id), false;
end
$function$;

create or replace function catalog.publish_global_movement(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_discipline_code text,
  p_name text,
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
  response jsonb;
  target catalog.movements%rowtype;
  normalized text;
  entry_id uuid;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);
  normalized := catalog.normalize_movement_name(p_name);
  if normalized = '' or char_length(normalized) > 120 then
    raise exception 'a movement needs a name' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-CAT-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := catalog.global_catalog_entry_projection('movement', receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent movement publication not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  perform catalog.published_discipline(p_discipline_code);

  select * into target
  from catalog.movements as movement
  where movement.normalized_name = normalized and movement.content_scope = 'global'
  for update;

  if target.id is null then
    insert into catalog.movements (
      discipline_code, name, normalized_name, content_scope, status
    ) values (
      p_discipline_code, regexp_replace(btrim(p_name), '\s+', ' ', 'g'), normalized, 'global',
      'published'
    )
    returning id into entry_id;
  elsif target.status = 'published' then
    raise exception 'that movement is already published' using errcode = '55000';
  elsif target.discipline_code is distinct from p_discipline_code then
    raise exception 'that movement belongs to another discipline' using errcode = '55000';
  else
    update catalog.movements as movement
    set status = 'published'
    where movement.id = target.id;
    entry_id := target.id;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'movement-published', 'catalog_movement', entry_id
  );
  return query select catalog.global_catalog_entry_projection('movement', entry_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-CAT-005 — archive
-- ---------------------------------------------------------------------------

create or replace function catalog.archive_discipline(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_code text,
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
  response jsonb;
  target catalog.disciplines%rowtype;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-CAT-005', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := catalog.global_catalog_entry_projection('discipline', receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent discipline archival not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  select * into target
  from catalog.disciplines as discipline
  where discipline.code = p_code
  for update;
  if target.id is null then
    raise exception 'discipline not found' using errcode = 'P0002';
  end if;
  if target.status <> 'published' then
    raise exception 'only a published discipline is archived' using errcode = '55000';
  end if;
  -- No cascade: retiring a discipline must not retire content nobody asked to retire.
  if exists (
    select 1 from catalog.activity_types as activity
    where activity.discipline_code = p_code
      and activity.content_scope = 'global'
      and activity.status = 'published'
  ) or exists (
    select 1 from catalog.movements as movement
    where movement.discipline_code = p_code
      and movement.content_scope = 'global'
      and movement.status = 'published'
  ) then
    raise exception 'archive its published global content first' using errcode = '55000';
  end if;

  update catalog.disciplines as discipline
  set status = 'archived'
  where discipline.id = target.id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'discipline-archived', 'catalog_discipline', target.id
  );
  return query select catalog.global_catalog_entry_projection('discipline', target.id), false;
end
$function$;

create or replace function catalog.archive_activity_type(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_code text,
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
  response jsonb;
  target catalog.activity_types%rowtype;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-CAT-005', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := catalog.global_catalog_entry_projection('activity_type', receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent activity type archival not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  select * into target
  from catalog.activity_types as activity
  where activity.code = p_code and activity.content_scope = 'global'
  for update;
  if target.id is null then
    raise exception 'global activity type not found' using errcode = 'P0002';
  end if;
  if target.status <> 'published' then
    raise exception 'only a published activity type is archived' using errcode = '55000';
  end if;

  update catalog.activity_types as activity
  set status = 'archived'
  where activity.id = target.id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'activity-type-archived', 'catalog_activity_type', target.id
  );
  return query select catalog.global_catalog_entry_projection('activity_type', target.id), false;
end
$function$;

create or replace function catalog.archive_global_movement(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_movement_id uuid,
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
  response jsonb;
  target catalog.movements%rowtype;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-CAT-005', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := catalog.global_catalog_entry_projection('movement', receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent movement archival not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  select * into target
  from catalog.movements as movement
  where movement.id = p_movement_id and movement.content_scope = 'global'
  for update;
  if target.id is null then
    raise exception 'global movement not found' using errcode = 'P0002';
  end if;
  if target.status <> 'published' then
    raise exception 'only a published movement is archived' using errcode = '55000';
  end if;

  update catalog.movements as movement
  set status = 'archived'
  where movement.id = target.id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'movement-archived', 'catalog_movement', target.id
  );
  return query select catalog.global_catalog_entry_projection('movement', target.id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function catalog.reject_global_catalog_deletion() owner to allfit_owner;
alter function catalog.normalize_movement_name(text) owner to allfit_owner;
alter function catalog.global_catalog_entry_projection(text, uuid) owner to allfit_owner;
alter function catalog.published_discipline(text) owner to allfit_owner;
alter function catalog.list_global_catalog(uuid, uuid) owner to allfit_owner;
alter function catalog.publish_discipline(uuid, uuid, text, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function catalog.archive_discipline(uuid, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function catalog.publish_activity_type(uuid, uuid, text, text, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function catalog.archive_activity_type(uuid, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function catalog.publish_global_movement(uuid, uuid, text, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function catalog.archive_global_movement(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;

revoke all on function catalog.reject_global_catalog_deletion() from public, allfit_api;
revoke all on function catalog.normalize_movement_name(text) from public, allfit_api;
revoke all on function catalog.global_catalog_entry_projection(text, uuid) from public, allfit_api;
revoke all on function catalog.published_discipline(text) from public, allfit_api;
revoke all on function catalog.list_global_catalog(uuid, uuid) from public;
revoke all on function catalog.publish_discipline(uuid, uuid, text, text, uuid, uuid, bytea)
  from public;
revoke all on function catalog.archive_discipline(uuid, uuid, text, uuid, uuid, bytea) from public;
revoke all on function catalog.publish_activity_type(uuid, uuid, text, text, text, uuid, uuid, bytea)
  from public;
revoke all on function catalog.archive_activity_type(uuid, uuid, text, uuid, uuid, bytea)
  from public;
revoke all on function catalog.publish_global_movement(uuid, uuid, text, text, uuid, uuid, bytea)
  from public;
revoke all on function catalog.archive_global_movement(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;

grant execute on function catalog.list_global_catalog(uuid, uuid) to allfit_api;
grant execute on function catalog.publish_discipline(uuid, uuid, text, text, uuid, uuid, bytea)
  to allfit_api;
grant execute on function catalog.archive_discipline(uuid, uuid, text, uuid, uuid, bytea)
  to allfit_api;
grant execute on function catalog.publish_activity_type(
  uuid, uuid, text, text, text, uuid, uuid, bytea
) to allfit_api;
grant execute on function catalog.archive_activity_type(uuid, uuid, text, uuid, uuid, bytea)
  to allfit_api;
grant execute on function catalog.publish_global_movement(
  uuid, uuid, text, text, uuid, uuid, bytea
) to allfit_api;
grant execute on function catalog.archive_global_movement(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
