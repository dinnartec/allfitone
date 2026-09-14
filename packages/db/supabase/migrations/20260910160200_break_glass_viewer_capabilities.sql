-- What the viewer of a break-glass file may do with it.
--
-- The Backoffice session is minimised and does not carry the operator's own
-- person identifier, which is correct: a session says who authenticated, not who
-- they are in the domain. So the screen cannot work out whether this operator may
-- decide on a given request.
--
-- The alternative was to widen the session. This is better: the rule — an
-- approver is never the requester, never the subject and never somebody who
-- already decided — is the same rule the trigger enforces, and computing it in
-- two places is how the two drift apart. The projection answers it once, for the
-- caller who asked.
--
-- These are hints for a screen, never authority. Every command revalidates
-- everything in its own transaction.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function support.break_glass_viewer_projection(
  p_request_id uuid,
  p_viewer_person_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select support.break_glass_request_projection(file.id) || jsonb_build_object(
    'viewer_is_requester', file.requester_person_id = p_viewer_person_id,
    'viewer_can_decide',
      support.effective_break_glass_status(
        file.status, file.request_expires_at, file.window_ends_at
      ) = 'requested'
      and file.requester_person_id <> p_viewer_person_id
      and file.subject_person_id <> p_viewer_person_id
      and not exists (
        select 1 from support.break_glass_approvals as approval
        where approval.request_id = file.id
          and approval.approver_person_id = p_viewer_person_id
      ),
    'viewer_can_exercise',
      support.effective_break_glass_status(
        file.status, file.request_expires_at, file.window_ends_at
      ) = 'approved'
      and file.requester_person_id = p_viewer_person_id
  )
  from support.break_glass_requests as file
  where file.id = p_request_id
$function$;

create or replace function support.list_break_glass_requests(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_mine boolean,
  p_status text,
  p_limit integer
)
returns table (result jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
    or not (
      access_control.has_platform_duty(p_actor_person_id, p_actor_session_id, 'request_break_glass')
      or access_control.has_platform_duty(p_actor_person_id, p_actor_session_id, 'approve_break_glass')
      or access_control.has_platform_duty(p_actor_person_id, p_actor_session_id, 'audit_break_glass')
    ) then
    raise exception 'reading the break-glass tray requires an effective duty'
      using errcode = '42501';
  end if;

  return query
  select support.break_glass_viewer_projection(file.id, p_actor_person_id)
  from support.break_glass_requests as file
  where (not p_mine or file.requester_person_id = p_actor_person_id)
    and (
      p_status is null
      or support.effective_break_glass_status(
        file.status, file.request_expires_at, file.window_ends_at
      ) = p_status
    )
  order by file.requested_at desc
  limit greatest(p_limit, 1);
end
$function$;

alter function support.break_glass_viewer_projection(uuid, uuid) owner to allfit_owner;
revoke all on function support.break_glass_viewer_projection(uuid, uuid) from public;
