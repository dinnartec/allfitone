-- Closed administration of the Backoffice base role and platform duties.
--
-- `OP-SUP-007` and `OP-SUP-010`. The base role lets a person sign in; the duty
-- authorizes an operation. Both are re-resolved here, inside the transaction,
-- against the tables — never from a claim, a group, a header or a cached value.
--
-- The runtime role receives EXECUTE on these functions and nothing else: no
-- INSERT, no UPDATE and no DELETE on the two tables. That is what makes the
-- closed catalogue, the ninety-day bound, the independent grantor and the
-- append-only history properties of the database rather than of this API.
--
-- Idempotency was previously claimed with the surface hardcoded to `studio`.
-- A Backoffice command needs its own scope, so the claim gains a surface-aware
-- form and the original five-argument form now delegates to it unchanged.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function system.begin_idempotency(
  p_principal_id uuid,
  p_surface system.command_surface,
  p_client_id text,
  p_operation_code text,
  p_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (claimed boolean, receipt_id uuid, aggregate_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  principal_hash bytea;
  inserted_id uuid;
  existing system.idempotency_keys%rowtype;
begin
  if p_principal_id is null or octet_length(p_request_hash) <> 32 or btrim(p_client_id) = '' then
    raise exception 'invalid idempotency identity' using errcode = '22023';
  end if;

  principal_hash := extensions.digest(convert_to(p_principal_id::text, 'UTF8'), 'sha256');

  insert into system.idempotency_keys (
    principal_fingerprint, client_id, surface, operation_code,
    key, command_id, request_hash, status
  ) values (
    principal_hash, p_client_id, p_surface, p_operation_code,
    p_key, p_command_id, p_request_hash, 'processing'
  )
  on conflict do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return query select true, inserted_id, null::uuid;
    return;
  end if;

  select receipt.* into existing
  from system.idempotency_keys as receipt
  where receipt.principal_fingerprint = principal_hash
    and receipt.surface = p_surface
    and receipt.operation_code = p_operation_code
    and (
      (receipt.client_id = p_client_id and receipt.key = p_key)
      or receipt.command_id = p_command_id
    )
  order by receipt.created_at
  limit 1;

  if existing.id is null then
    raise exception 'idempotency conflict could not be resolved' using errcode = '40001';
  end if;
  if existing.request_hash <> p_request_hash then
    raise exception 'idempotency identity reused with a different request' using errcode = '23505';
  end if;
  if existing.status = 'processing' then
    raise exception 'idempotency command is still processing' using errcode = '40001';
  end if;

  return query select false, existing.id, existing.aggregate_id;
end
$function$;

create or replace function system.begin_idempotency(
  p_principal_id uuid,
  p_operation_code text,
  p_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (claimed boolean, receipt_id uuid, aggregate_id uuid)
language sql
security definer
set search_path = pg_catalog
as $function$
  select *
  from system.begin_idempotency(
    p_principal_id, 'studio'::system.command_surface, 'studio',
    p_operation_code, p_key, p_command_id, p_request_hash
  )
$function$;

alter function system.begin_idempotency(
  uuid, system.command_surface, text, text, uuid, uuid, bytea
) owner to allfit_owner;
revoke all on function system.begin_idempotency(
  uuid, system.command_surface, text, text, uuid, uuid, bytea
) from public;

create or replace function support.platform_role_assignment_projection(p_assignment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', assignment.id,
    'person_id', assignment.person_id,
    'platform_role', assignment.platform_role,
    'status', assignment.status,
    'granted_by_person_id', assignment.granted_by_person_id,
    'granted_at', assignment.granted_at,
    'revoked_by_person_id', assignment.revoked_by_person_id,
    'revoked_at', assignment.revoked_at
  )
  from support.platform_role_assignments as assignment
  where assignment.id = p_assignment_id
$function$;

-- `expired` is derived from the clock, not from a job. A duty past its window
-- stops authorizing in the next transaction whether or not a row was updated,
-- so the projection must not present it as still effective.
create or replace function support.platform_duty_assignment_projection(p_assignment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', assignment.id,
    'person_id', assignment.person_id,
    'duty_code', assignment.duty_code,
    'actor_mode', assignment.actor_mode,
    'status', case
      when assignment.status in ('scheduled', 'active')
        and assignment.valid_to <= clock_timestamp() then 'expired'
      else assignment.status
    end,
    'valid_from', assignment.valid_from,
    'valid_to', assignment.valid_to,
    'required_aal', assignment.required_aal,
    'granted_by_person_id', assignment.granted_by_person_id,
    'recertified_by_person_id', assignment.recertified_by_person_id,
    'recertified_at', assignment.recertified_at,
    'suspended_by_person_id', assignment.suspended_by_person_id,
    'suspended_at', assignment.suspended_at,
    'revoked_by_person_id', assignment.revoked_by_person_id,
    'revoked_at', assignment.revoked_at,
    'reason_code', assignment.reason_code
  )
  from support.platform_duty_assignments as assignment
  where assignment.id = p_assignment_id
$function$;

create or replace function support.require_platform_access_manager(
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
      p_actor_person_id, p_actor_session_id, 'manage_platform_access'
    ) then
    raise exception 'platform access management requires an effective duty'
      using errcode = '42501';
  end if;
end
$function$;

create or replace function support.grant_platform_role(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_person_id uuid,
  p_platform_role text,
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
  assignment_id uuid;
  response jsonb;
begin
  perform support.require_platform_access_manager(p_actor_person_id, p_actor_session_id);

  -- Rejected here for a precise answer; the CHECK on the table is what actually
  -- guarantees it, including against a direct insert.
  if p_person_id = p_actor_person_id then
    raise exception 'a platform role is never self-assigned' using errcode = '42501';
  end if;
  if p_platform_role is distinct from 'allfit_admin' then
    raise exception 'platform role outside the closed catalogue' using errcode = '22023';
  end if;
  if not exists (
    select 1 from identity.people as person
    where person.id = p_person_id and person.status = 'active'
  ) then
    raise exception 'target person not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-SUP-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select support.platform_role_assignment_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent platform role grant not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  insert into support.platform_role_assignments (
    person_id, platform_role, granted_by_person_id
  ) values (
    p_person_id, p_platform_role, p_actor_person_id
  )
  on conflict do nothing
  returning id into assignment_id;

  if assignment_id is null then
    -- Granting a role the person already holds converges on that assignment.
    select assignment.id into assignment_id
    from support.platform_role_assignments as assignment
    where assignment.person_id = p_person_id
      and assignment.platform_role = p_platform_role
      and assignment.status = 'active';
    if assignment_id is null then
      raise exception 'platform role grant could not be resolved' using errcode = '40001';
    end if;
  else
    perform system.enqueue_outbox_event(
      'platform_role_assignment', assignment_id, 'support.platform_role_granted.v1',
      jsonb_build_object('assignment_id', assignment_id, 'person_id', p_person_id)
    );
  end if;

  response := support.platform_role_assignment_projection(assignment_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'platform-role-granted',
    'platform_role_assignment', assignment_id
  );
  return query select response, false;
end
$function$;

create or replace function support.revoke_platform_role(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_assignment_id uuid,
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
  target support.platform_role_assignments%rowtype;
  response jsonb;
begin
  perform support.require_platform_access_manager(p_actor_person_id, p_actor_session_id);

  select assignment.* into target
  from support.platform_role_assignments as assignment
  where assignment.id = p_assignment_id
  for update;

  if target.id is null then
    raise exception 'platform role assignment not found' using errcode = 'P0002';
  end if;
  if target.person_id = p_actor_person_id then
    raise exception 'a platform role is never self-revoked' using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-SUP-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select support.platform_role_assignment_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent platform role revocation not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  -- Withdrawing the role cascades through `close_revoked_platform_access`: it
  -- closes every effective duty, revokes the Backoffice sessions and terminates
  -- the open authentication attempts, all in this transaction.
  if target.status = 'active' then
    update support.platform_role_assignments
    set status = 'revoked',
        revoked_by_person_id = p_actor_person_id,
        revoked_at = clock_timestamp()
    where id = target.id;

    perform system.enqueue_outbox_event(
      'platform_role_assignment', target.id, 'support.platform_role_revoked.v1',
      jsonb_build_object('assignment_id', target.id, 'person_id', target.person_id)
    );
  end if;

  response := support.platform_role_assignment_projection(target.id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'platform-role-revoked',
    'platform_role_assignment', target.id
  );
  return query select response, false;
end
$function$;

create or replace function support.grant_platform_duty(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_person_id uuid,
  p_duty_code text,
  p_valid_from timestamptz,
  p_valid_to timestamptz,
  p_reason_code text,
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
  assignment_id uuid;
  starts_at timestamptz := coalesce(p_valid_from, clock_timestamp());
  response jsonb;
begin
  perform support.require_platform_access_manager(p_actor_person_id, p_actor_session_id);

  if p_person_id = p_actor_person_id then
    raise exception 'a platform duty is never self-assigned' using errcode = '42501';
  end if;
  if p_valid_to is null
    or p_valid_to <= starts_at
    or p_valid_to <= clock_timestamp()
    or p_valid_to > starts_at + interval '90 days'
    or btrim(coalesce(p_reason_code, '')) = '' then
    raise exception 'invalid platform duty window' using errcode = '22023';
  end if;
  if not exists (
    select 1 from support.platform_role_assignments as assignment
    where assignment.person_id = p_person_id
      and assignment.platform_role = 'allfit_admin'
      and assignment.status = 'active'
  ) then
    raise exception 'a platform duty requires an active base role' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-SUP-010', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select support.platform_duty_assignment_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent platform duty grant not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  -- `actor_mode` is derived from the duty code by the table's CHECK. Computing it
  -- here would create a second, drifting source for the same closed mapping.
  insert into support.platform_duty_assignments (
    person_id, duty_code, actor_mode, status, valid_from, valid_to,
    granted_by_person_id, reason_code
  )
  select
    p_person_id,
    p_duty_code,
    case
      when p_duty_code in (
        'curate_global_catalog', 'verify_professional_credentials', 'manage_platform_commercial'
      ) then 'A11'
      when p_duty_code in (
        'manage_platform_access', 'audit_platform_access', 'approve_break_glass',
        'audit_break_glass', 'manage_privacy_requests'
      ) then 'A12'
      else 'A10'
    end,
    case when starts_at > clock_timestamp() then 'scheduled' else 'active' end,
    starts_at,
    p_valid_to,
    p_actor_person_id,
    btrim(p_reason_code)
  on conflict do nothing
  returning id into assignment_id;

  if assignment_id is null then
    select assignment.id into assignment_id
    from support.platform_duty_assignments as assignment
    where assignment.person_id = p_person_id
      and assignment.duty_code = p_duty_code
      and assignment.status in ('scheduled', 'active');
    if assignment_id is null then
      -- A suspended assignment still occupies the partial unique index. It is
      -- revoked and re-granted, never silently reopened.
      raise exception 'the person already holds a suspended assignment of this duty'
        using errcode = '23505';
    end if;
  else
    perform system.enqueue_outbox_event(
      'platform_duty_assignment', assignment_id, 'support.platform_duty_granted.v1',
      jsonb_build_object(
        'assignment_id', assignment_id, 'person_id', p_person_id, 'duty_code', p_duty_code
      )
    );
  end if;

  response := support.platform_duty_assignment_projection(assignment_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'platform-duty-granted',
    'platform_duty_assignment', assignment_id
  );
  return query select response, false;
end
$function$;

-- Suspension and revocation share everything except the target state and the
-- event, so they share one closed body rather than two that can drift apart.
--
-- Withdrawing `request_break_glass` must also close that person's open windows.
-- `support.break_glass_requests` does not exist yet; the slice that creates it
-- replaces this function and adds the closure with its own tests.
create or replace function support.close_platform_duty(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_assignment_id uuid,
  p_target_status text,
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
  target support.platform_duty_assignments%rowtype;
  response jsonb;
begin
  perform support.require_platform_access_manager(p_actor_person_id, p_actor_session_id);

  if p_target_status not in ('suspended', 'revoked') then
    raise exception 'unsupported platform duty transition' using errcode = '22023';
  end if;

  select assignment.* into target
  from support.platform_duty_assignments as assignment
  where assignment.id = p_assignment_id
  for update;

  if target.id is null then
    raise exception 'platform duty assignment not found' using errcode = 'P0002';
  end if;
  if target.person_id = p_actor_person_id then
    raise exception 'a platform duty is never self-administered' using errcode = '42501';
  end if;
  -- Repeating a closure converges; reopening a terminal assignment never does.
  if target.status = 'expired' or (target.status = 'revoked' and p_target_status = 'suspended') then
    raise exception 'the platform duty is already closed' using errcode = '23514';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-SUP-010', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select support.platform_duty_assignment_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent platform duty closure not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  if target.status <> p_target_status then
    if p_target_status = 'suspended' then
      update support.platform_duty_assignments
      set status = 'suspended',
          suspended_by_person_id = p_actor_person_id,
          suspended_at = clock_timestamp()
      where id = target.id;
    else
      update support.platform_duty_assignments
      set status = 'revoked',
          revoked_by_person_id = p_actor_person_id,
          revoked_at = clock_timestamp()
      where id = target.id;
    end if;

    perform system.enqueue_outbox_event(
      'platform_duty_assignment',
      target.id,
      case
        when p_target_status = 'suspended' then 'support.platform_duty_suspended.v1'
        else 'support.platform_duty_revoked.v1'
      end,
      jsonb_build_object(
        'assignment_id', target.id, 'person_id', target.person_id, 'duty_code', target.duty_code
      )
    );
  end if;

  response := support.platform_duty_assignment_projection(target.id);
  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    case when p_target_status = 'suspended' then 'platform-duty-suspended'
      else 'platform-duty-revoked' end,
    'platform_duty_assignment',
    target.id
  );
  return query select response, false;
end
$function$;

alter function support.platform_role_assignment_projection(uuid) owner to allfit_owner;
alter function support.platform_duty_assignment_projection(uuid) owner to allfit_owner;
alter function support.require_platform_access_manager(uuid, uuid) owner to allfit_owner;
alter function support.grant_platform_role(uuid, uuid, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function support.revoke_platform_role(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function support.grant_platform_duty(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, uuid, bytea
) owner to allfit_owner;
alter function support.close_platform_duty(uuid, uuid, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;

revoke all on function support.platform_role_assignment_projection(uuid) from public;
revoke all on function support.platform_duty_assignment_projection(uuid) from public;
revoke all on function support.require_platform_access_manager(uuid, uuid) from public;
revoke all on function support.grant_platform_role(uuid, uuid, uuid, text, uuid, uuid, bytea)
  from public;
revoke all on function support.revoke_platform_role(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;
revoke all on function support.grant_platform_duty(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, uuid, bytea
) from public;
revoke all on function support.close_platform_duty(uuid, uuid, uuid, text, uuid, uuid, bytea)
  from public;

-- The runtime role reaches these tables only through these four commands. The
-- projections stay internal: reading the inventory is `OP-SUP-008`/`OP-SUP-011`.
grant execute on function support.grant_platform_role(uuid, uuid, uuid, text, uuid, uuid, bytea)
  to allfit_api;
grant execute on function support.revoke_platform_role(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function support.grant_platform_duty(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, uuid, bytea
) to allfit_api;
grant execute on function support.close_platform_duty(uuid, uuid, uuid, text, uuid, uuid, bytea)
  to allfit_api;
