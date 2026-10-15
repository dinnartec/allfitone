-- OP-SUP-006 and T-BGG-10 — reviewing a break-glass case that was used (`HU-BO-008`).
--
-- Break-glass is the one path in this platform that reads a person's data without
-- that person. Every other control on it fires before the reading: the duty, the
-- quorum, the category, the window. This is the only one that fires after, and it was
-- the governance obligation with no code behind it — the columns were on the table
-- since the windows shipped, and nothing ever wrote them.
--
-- **The obligation attaches to the first exercise, not to the approval.** A window
-- somebody opened and never used read nothing, so there is nothing to judge. The
-- queue is what is still owed, and a case enters it the moment it is first used.
--
-- **Independence is the whole value of the review.** The reviewer is not the
-- requester, not the subject, and not anybody who approved the case. A CHECK already
-- holds the first two because they are columns of the row; the third is a row in
-- another table, so it is this function's job and it is the reason the function
-- exists rather than an UPDATE.
--
-- **The twenty-four hours are an obligation, not a filter.** The operations matrix
-- lists "review within 24 hours" among the mandatory filters and, two lines down,
-- requires that 100% of exercised cases be reviewed. Those cannot both be enforced:
-- a filter that refuses a late review leaves that case unreviewed for good and makes
-- the 100% unreachable by construction. The deadline is kept as what it is useful
-- for — making the delay visible — so a late review is accepted, recorded and marked
-- late, and the queue sorts by what is most overdue.
--
-- **A verdict is written once.** Two reviewers racing resolve as one review and one
-- conflict; the same command replays. And the row, once reviewed, is closed to
-- rewriting, which the immutability trigger did not cover because there was nothing
-- to cover yet.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- When the clock started, and whether it ran out
-- ---------------------------------------------------------------------------

-- The first exercise of a case, which is the instant the review is owed from. Null
-- means the window was never used and nothing is owed.
create or replace function support.break_glass_first_exercised_at(p_request_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select min(event.occurred_at)
  from support.break_glass_events as event
  where event.request_id = p_request_id
$function$;

create or replace function support.break_glass_review_projection(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'request_id', file.id,
    'case_reference', file.case_reference,
    'purpose', file.purpose,
    'categories', to_jsonb(file.categories),
    'sensitivity_tier', file.sensitivity_tier,
    'requester_person_id', file.requester_person_id,
    'subject_person_id', file.subject_person_id,
    'exercise_count', (
      select count(*)::integer from support.break_glass_events as event
      where event.request_id = file.id
    ),
    'first_exercised_at', first_exercise.at,
    -- Null while the case was never used: there is no deadline for an obligation
    -- that has not started.
    'review_due_at', first_exercise.at + interval '24 hours',
    -- Owed, started and not yet met. A reviewed case is never overdue again, however
    -- late the review was — that is what `reviewed_late` is for.
    'overdue',
      first_exercise.at is not null
      and file.reviewed_at is null
      and clock_timestamp() > first_exercise.at + interval '24 hours',
    'reviewed_at', file.reviewed_at,
    'reviewed_by_person_id', file.reviewed_by_person_id,
    'review_outcome', file.review_outcome,
    'reviewed_late',
      case
        when file.reviewed_at is null or first_exercise.at is null then null
        else file.reviewed_at > first_exercise.at + interval '24 hours'
      end
  )
  from support.break_glass_requests as file
  cross join lateral (
    select support.break_glass_first_exercised_at(file.id) as at
  ) as first_exercise
  where file.id = p_request_id
$function$;

-- ---------------------------------------------------------------------------
-- A review is written once
-- ---------------------------------------------------------------------------

-- The rewrite guard gains the review. Everything above this line is the body it
-- already had, copied forward because a trigger function is replaced whole.
create or replace function support.prevent_break_glass_request_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a break-glass request is never deleted' using errcode = '55000';
  end if;
  if new.requester_person_id is distinct from old.requester_person_id
    or new.subject_person_id is distinct from old.subject_person_id
    or new.requester_duty_assignment_id is distinct from old.requester_duty_assignment_id
    or new.categories is distinct from old.categories
    or new.purpose is distinct from old.purpose
    or new.case_reference is distinct from old.case_reference
    or new.sensitivity_tier is distinct from old.sensitivity_tier
    or new.required_approvals is distinct from old.required_approvals
    or new.requested_duration_minutes is distinct from old.requested_duration_minutes
    or new.requested_at is distinct from old.requested_at
    or new.request_expires_at is distinct from old.request_expires_at then
    raise exception 'the subject, scope, purpose and duration of a break-glass request are immutable'
      using errcode = '55000';
  end if;
  -- No reopening and no extension: a terminal state is terminal.
  if old.status in ('rejected', 'closed', 'expired') and new.status <> old.status then
    raise exception 'a closed break-glass window is never reopened: request another'
      using errcode = '55000';
  end if;
  if old.window_starts_at is not null and new.window_starts_at is distinct from old.window_starts_at then
    raise exception 'a break-glass window is never extended' using errcode = '55000';
  end if;
  -- A verdict already given is evidence. Correcting one means a different record,
  -- not an edit of this one.
  if old.reviewed_at is not null and (
    new.reviewed_at is distinct from old.reviewed_at
    or new.reviewed_by_person_id is distinct from old.reviewed_by_person_id
    or new.reviewed_by_duty_assignment_id is distinct from old.reviewed_by_duty_assignment_id
    or new.review_outcome is distinct from old.review_outcome
  ) then
    raise exception 'a break-glass review is written once and never rewritten'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-006 — the review
-- ---------------------------------------------------------------------------

create or replace function support.review_break_glass(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_request_id uuid,
  p_outcome text,
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
  assignment_id uuid;
  receipt record;
  file support.break_glass_requests%rowtype;
  exercised_at timestamptz;
  response jsonb;
begin
  assignment_id := support.require_break_glass_duty(
    p_actor_person_id, p_actor_session_id, 'audit_break_glass'
  );

  if p_outcome not in ('justified', 'unjustified', 'incident_opened') then
    raise exception 'a break-glass review ends in justified, unjustified or incident_opened'
      using errcode = '22023';
  end if;

  select * into file from support.break_glass_requests where id = p_request_id for update;
  if file.id is null then
    raise exception 'break-glass request not found' using errcode = 'P0002';
  end if;

  /*
   * Independence, checked before anything is claimed. The requester and the subject
   * are columns and a CHECK holds them too; the approvers are rows in another table
   * and nothing but this can see them. Approving is what spends the independence, so
   * holding `audit_break_glass` does not restore it.
   */
  if p_actor_person_id = file.requester_person_id
    or p_actor_person_id = file.subject_person_id
    or exists (
      select 1 from support.break_glass_approvals as approval
      where approval.request_id = p_request_id
        and approval.approver_person_id = p_actor_person_id
    ) then
    raise exception 'a break-glass case is reviewed by somebody who neither asked for it, approved it nor is its subject'
      using errcode = '42501';
  end if;

  exercised_at := support.break_glass_first_exercised_at(p_request_id);
  if exercised_at is null then
    raise exception 'only a break-glass case that was exercised is reviewed'
      using errcode = '55000';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-SUP-006', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select support.break_glass_review_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent break-glass review not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  -- One terminal verdict. Two reviewers racing both pass the checks above; the row
  -- lock decides, and the second one reads a case that already has an answer.
  if file.reviewed_at is not null then
    raise exception 'this break-glass case was already reviewed' using errcode = '55000';
  end if;

  update support.break_glass_requests
  set reviewed_at = clock_timestamp(),
      reviewed_by_person_id = p_actor_person_id,
      reviewed_by_duty_assignment_id = assignment_id,
      review_outcome = p_outcome
  where id = p_request_id;

  response := support.break_glass_review_projection(p_request_id);

  /*
   * A review that found nothing wrong is published too: "100% of exercised cases are
   * reviewed" is only provable if the uneventful ones leave a trace as well. An
   * incident is its own event because somebody has to act on it, and a consumer that
   * only listens for trouble should not have to filter the rest.
   */
  perform system.enqueue_outbox_event(
    'break_glass_request', p_request_id,
    case
      when p_outcome = 'incident_opened' then 'support.break_glass_incident_opened.v1'
      else 'support.break_glass_reviewed.v1'
    end,
    jsonb_build_object(
      'request_id', p_request_id,
      'review_outcome', p_outcome,
      'reviewed_late', response->'reviewed_late'
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'break-glass-reviewed',
    'break_glass_request', p_request_id
  );
  return query select response, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- The queue of what is still owed
-- ---------------------------------------------------------------------------

create or replace function support.break_glass_review_queue(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
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
    or not access_control.has_platform_duty(
      p_actor_person_id, p_actor_session_id, 'audit_break_glass'
    ) then
    raise exception 'reading the break-glass review queue requires an effective duty'
      using errcode = '42501';
  end if;

  /*
   * What is owed, most overdue first. The queue is not filtered by who may review
   * each case: a reviewer who turns out not to be independent is refused by the
   * command, and hiding the row would hide an obligation that is still outstanding.
   */
  return query
  select support.break_glass_review_projection(file.id)
  from support.break_glass_requests as file
  join lateral (
    select support.break_glass_first_exercised_at(file.id) as at
  ) as first_exercise on true
  where file.reviewed_at is null
    and first_exercise.at is not null
  order by first_exercise.at asc
  limit greatest(p_limit, 1);
end
$function$;

alter function support.break_glass_first_exercised_at(uuid) owner to allfit_owner;
alter function support.break_glass_review_projection(uuid) owner to allfit_owner;
alter function support.review_break_glass(uuid, uuid, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function support.break_glass_review_queue(uuid, uuid, integer) owner to allfit_owner;

revoke all on function support.break_glass_first_exercised_at(uuid) from public;
revoke all on function support.break_glass_review_projection(uuid) from public;
revoke all on function support.review_break_glass(uuid, uuid, uuid, text, uuid, uuid, bytea)
  from public;
revoke all on function support.break_glass_review_queue(uuid, uuid, integer) from public;

grant execute on function support.review_break_glass(uuid, uuid, uuid, text, uuid, uuid, bytea)
  to allfit_api;
grant execute on function support.break_glass_review_queue(uuid, uuid, integer) to allfit_api;
