-- Pay the debt `AFO-241` recorded in a comment.
--
-- `support.close_platform_duty` said: "Withdrawing `request_break_glass` must
-- also close that person's open windows. `support.break_glass_requests` does not
-- exist yet; the slice that creates it replaces this function and adds the
-- closure with its own tests." This is that slice.
--
-- Criterion 5 of `HU-BO-028` is what this completes: suspending, revoking or
-- expiring a duty cuts its operations immediately *and* closes the affected
-- requester's break-glass windows. Without this, a revoked operator kept an open
-- window until it timed out on its own — the duty said no while the window still
-- said yes.

set lock_timeout = '5s';
set statement_timeout = '60s';
-- Suspension and revocation share everything except the target state and the
-- event, so they share one closed body rather than two that can drift apart.
--
-- Withdrawing `request_break_glass` also closes that person's open windows, which
-- is the half the break-glass slice supplies.
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

    -- Closed in the same transaction as the withdrawal. Leaving it open until its
    -- own timeout would mean the duty said no while the window still said yes.
    if target.duty_code = 'request_break_glass' then
      perform support.close_break_glass_for_withdrawn_duty(target.person_id);
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
