-- Read-only inventory of Backoffice base roles and platform duties.
--
-- `OP-SUP-008` and `OP-SUP-011`. Two duties can read it — `manage_platform_access`
-- and `audit_platform_access` — and neither of them is implied by the base role.
--
-- The inventory is never an authorization cache. Every operation resolves its own
-- duty in its own transaction, and these functions exist so a person can be shown
-- who reaches the data, not so a caller can decide anything from the answer. That
-- is also why `expired` is derived from the clock in one place and reused by both
-- the projection and the filter: a window that elapsed must read as elapsed even
-- when no job has moved the row yet.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function support.effective_platform_duty_status(
  p_status text,
  p_valid_to timestamptz
)
returns text
language sql
stable
set search_path = pg_catalog
as $function$
  select case
    when p_status in ('scheduled', 'active') and p_valid_to <= clock_timestamp() then 'expired'
    else p_status
  end
$function$;

-- Effective authority first, terminated history last. The rank is a sort key, not
-- a state machine: the states themselves live in the table's CHECK.
create or replace function support.platform_role_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_status when 'active' then 0 else 1 end
$function$;

create or replace function support.platform_duty_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_status
    when 'active' then 0
    when 'scheduled' then 1
    when 'suspended' then 2
    when 'expired' then 3
    else 4
  end
$function$;

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
    'status', support.effective_platform_duty_status(assignment.status, assignment.valid_to),
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

create or replace function support.require_platform_access_reader(
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
    or not (
      access_control.has_platform_duty(
        p_actor_person_id, p_actor_session_id, 'manage_platform_access'
      )
      or access_control.has_platform_duty(
        p_actor_person_id, p_actor_session_id, 'audit_platform_access'
      )
    ) then
    raise exception 'reading platform access requires an effective duty'
      using errcode = '42501';
  end if;
end
$function$;

create or replace function support.list_platform_role_assignments(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_limit integer,
  p_cursor_rank integer,
  p_cursor_granted_at timestamptz,
  p_cursor_id uuid
)
returns table (
  result jsonb,
  cursor_rank integer,
  cursor_granted_at timestamptz,
  cursor_id uuid
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
begin
  if p_limit not between 1 and 101 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  perform support.require_platform_access_reader(p_actor_person_id, p_actor_session_id);

  return query
  select
    support.platform_role_assignment_projection(assignment.id),
    support.platform_role_status_rank(assignment.status),
    assignment.granted_at,
    assignment.id
  from support.platform_role_assignments as assignment
  where p_cursor_rank is null
    or support.platform_role_status_rank(assignment.status) > p_cursor_rank
    or (
      support.platform_role_status_rank(assignment.status) = p_cursor_rank
      and (assignment.granted_at, assignment.id) < (p_cursor_granted_at, p_cursor_id)
    )
  order by
    support.platform_role_status_rank(assignment.status) asc,
    assignment.granted_at desc,
    assignment.id desc
  limit p_limit;
end
$function$;

create or replace function support.list_platform_duty_assignments(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_person_id uuid,
  p_duty_code text,
  p_status text,
  p_limit integer,
  p_cursor_rank integer,
  p_cursor_valid_to timestamptz,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid
)
returns table (
  result jsonb,
  cursor_rank integer,
  cursor_valid_to timestamptz,
  cursor_created_at timestamptz,
  cursor_id uuid
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
begin
  if p_limit not between 1 and 101 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  perform support.require_platform_access_reader(p_actor_person_id, p_actor_session_id);

  return query
  select
    support.platform_duty_assignment_projection(assignment.id),
    support.platform_duty_status_rank(
      support.effective_platform_duty_status(assignment.status, assignment.valid_to)
    ),
    assignment.valid_to,
    assignment.created_at,
    assignment.id
  from support.platform_duty_assignments as assignment
  where (p_person_id is null or assignment.person_id = p_person_id)
    and (p_duty_code is null or assignment.duty_code = p_duty_code)
    and (
      p_status is null
      or support.effective_platform_duty_status(assignment.status, assignment.valid_to) = p_status
    )
    and (
      p_cursor_rank is null
      or support.platform_duty_status_rank(
        support.effective_platform_duty_status(assignment.status, assignment.valid_to)
      ) > p_cursor_rank
      or (
        support.platform_duty_status_rank(
          support.effective_platform_duty_status(assignment.status, assignment.valid_to)
        ) = p_cursor_rank
        and (assignment.valid_to, assignment.created_at, assignment.id)
            < (p_cursor_valid_to, p_cursor_created_at, p_cursor_id)
      )
    )
  order by
    support.platform_duty_status_rank(
      support.effective_platform_duty_status(assignment.status, assignment.valid_to)
    ) asc,
    assignment.valid_to desc,
    assignment.created_at desc,
    assignment.id desc
  limit p_limit;
end
$function$;

alter function support.effective_platform_duty_status(text, timestamptz) owner to allfit_owner;
alter function support.platform_role_status_rank(text) owner to allfit_owner;
alter function support.platform_duty_status_rank(text) owner to allfit_owner;
alter function support.require_platform_access_reader(uuid, uuid) owner to allfit_owner;
alter function support.list_platform_role_assignments(uuid, uuid, integer, integer, timestamptz, uuid)
  owner to allfit_owner;
alter function support.list_platform_duty_assignments(
  uuid, uuid, uuid, text, text, integer, integer, timestamptz, timestamptz, uuid
) owner to allfit_owner;

revoke all on function support.effective_platform_duty_status(text, timestamptz) from public;
revoke all on function support.platform_role_status_rank(text) from public;
revoke all on function support.platform_duty_status_rank(text) from public;
revoke all on function support.require_platform_access_reader(uuid, uuid) from public;
revoke all on function support.list_platform_role_assignments(uuid, uuid, integer, integer, timestamptz, uuid)
  from public;
revoke all on function support.list_platform_duty_assignments(
  uuid, uuid, uuid, text, text, integer, integer, timestamptz, timestamptz, uuid
) from public;

grant execute on function support.list_platform_role_assignments(uuid, uuid, integer, integer, timestamptz, uuid)
  to allfit_api;
grant execute on function support.list_platform_duty_assignments(
  uuid, uuid, uuid, text, text, integer, integer, timestamptz, timestamptz, uuid
) to allfit_api;
