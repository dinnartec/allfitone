-- Opening a programme you already wrote, and keeping the agenda you are already on.
--
-- Three pieces, and the first is the one that was missing entirely: **nothing returned
-- a programme in the shape it is edited in**. `/space/v1/programs/{id}/draft` had a
-- `PUT` and no `GET`, and the published read answers only what a day is called, never
-- which routine version it trains. You could see that Monday says "Empuje" and not
-- which of your routines that is.
--
-- **A programme with no draft row is a fork.** `fork_program_version` copies the
-- versions and the sessions and never creates a draft, so taking Allfit's programme
-- leaves you something you own and cannot open here. That absence is the discriminator
-- the list needs, and it is why `editable` is `draft.id is not null` rather than a
-- column somebody has to remember to set.
--
-- **Republishing updates the agenda in place rather than starting another one.**
-- Creating a second assignment would restart the week — `self_assign_program` begins
-- today, so editing on a Thursday would hand back a fresh week with the two sessions
-- already trained showing as pending — and would leave a duplicate that nothing can
-- remove, because ending an assignment does not exist. Restating keeps `starts_on`, so
-- the week number is unchanged, and rewrites only what has not been trained.
--
-- Nothing here can lose a training record. `execution.executed_sessions` does not
-- depend on planning at all, and the link from a planned session to its execution is
-- `on delete restrict`: a session that was trained cannot be deleted. The delete below
-- is filtered to untrained sessions because that is the intent, but the guarantee is
-- the constraint's and not this file's.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- `OP-PLN-026`. The counterpart of the `PUT` that has always been there, answering the
-- same projection so the editor reads what it writes.
create or replace function planning.read_my_program_draft(p_person_id uuid, p_program_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  draft_id uuid;
begin
  perform planning.assert_own_content(p_person_id);

  select existing.id into draft_id
  from planning.program_drafts as existing
  join planning.programs as program on program.id = existing.program_id
  where program.id = p_program_id and program.owner_person_id = p_person_id;

  -- Absent and forbidden answer the same. Distinguishing them would let somebody walk
  -- identifiers to learn which programmes exist, and a fork of Allfit's content is
  -- genuinely not editable here rather than merely hidden.
  if draft_id is null then return null; end if;

  return planning.program_draft_projection(draft_id);
end
$function$;

alter function planning.read_my_program_draft(uuid, uuid) owner to allfit_owner;
revoke all on function planning.read_my_program_draft(uuid, uuid) from public;
grant execute on function planning.read_my_program_draft(uuid, uuid) to allfit_api;

-- The list gains what the row needs to act: which programme it is, and whether this
-- editor can open it. Dropped rather than replaced: the return type is defined by OUT
-- parameters and PostgreSQL will not widen those in place.
drop function if exists planning.read_my_programs(uuid);

create function planning.read_my_programs(p_person_id uuid)
returns table (
  assignment_id uuid,
  program_version_id uuid,
  program_id uuid,
  title text,
  weeks integer,
  days_per_week integer,
  starts_on date,
  sessions_done integer,
  sessions_planned integer,
  editable boolean
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select assignment.id,
         version.id,
         version.program_id,
         version.title,
         composition.weeks,
         composition.days_per_week,
         assignment.starts_on,
         counted.done,
         counted.planned,
         -- A draft exists only for a programme somebody wrote here. A fork has none,
         -- and a programme whose weeks differ cannot be said as one repeated week.
         draft.id is not null
           and composition.weeks * composition.days_per_week = composition.sessions
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  left join planning.program_drafts as draft on draft.program_id = version.program_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day) filter (where session.week = 1)::integer as days_per_week,
           count(*)::integer as sessions
    from planning.program_version_sessions as session
    where session.program_version_id = version.id
  ) as composition on true
  join lateral (
    select count(*) filter (where session.status = 'completed')::integer as done,
           count(*)::integer as planned
    from planning.planned_sessions as session
    where session.assignment_id = assignment.id
  ) as counted on true
  where assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.display_order, assignment.assigned_at desc
$function$;

alter function planning.read_my_programs(uuid) owner to allfit_owner;
revoke all on function planning.read_my_programs(uuid) from public;
grant execute on function planning.read_my_programs(uuid) to allfit_api;

-- `OP-PLN-027`. Point the agenda somebody is already on at the version just published.
create or replace function planning.restate_my_program_assignment(
  p_person_id uuid,
  p_program_version_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  target_program_id uuid;
  assignment record;
  first_week date;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-027', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then return receipt.aggregate_id; end if;

  select version.program_id into target_program_id
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id and program.owner_person_id = p_person_id;
  if target_program_id is null then
    raise exception 'program version is not available to this person' using errcode = '42501';
  end if;

  -- The assignment for any version of this programme, newest first. Publishing is not
  -- starting: somebody who wrote a programme and never took it has nothing to restate.
  select existing.* into assignment
  from planning.program_assignments as existing
  join planning.program_versions as version on version.id = existing.program_version_id
  where existing.person_id = p_person_id and version.program_id = target_program_id
  order by existing.display_order, existing.assigned_at desc
  limit 1
  for update of existing;

  -- Null says "nothing was following this", which is how publishing knows to take the
  -- programme instead. The receipt names no aggregate: there is none, and
  -- `ck_idempotency_keys_aggregate_pair` requires the type and the id to agree.
  if assignment.id is null then
    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'program-assignment-unchanged', null, null
    );
    return null;
  end if;

  update planning.program_assignments
  set program_version_id = p_program_version_id
  where id = assignment.id;

  -- Only what has not been trained. A completed session is somebody's record of a
  -- morning, and the foreign key from its execution refuses the delete anyway.
  delete from planning.planned_sessions as stale
  where stale.assignment_id = assignment.id
    and stale.status <> 'completed'
    and not exists (
      select 1 from execution.planned_session_executions as attempt
      where attempt.planned_session_id = stale.id
    );

  -- Week N of the programme is calendar week N counted from where the assignment
  -- started, which is what keeps the week number from moving under somebody mid-week.
  first_week := date_trunc('week', assignment.starts_on::timestamp)::date;

  insert into planning.planned_sessions (
    assignment_id, person_id, template_version_id, week_starts_on, scheduled_at, timezone
  )
  select assignment.id, p_person_id, composition.template_version_id,
         first_week + ((composition.week - 1) * 7),
         greatest(
           (first_week + ((composition.week - 1) * 7) + composition.day - 1)::timestamp,
           assignment.starts_on::timestamp
         ) at time zone assignment.timezone,
         assignment.timezone
  from (
    select composed.*,
           row_number() over (partition by composed.week order by composed.day) as slot
    from planning.program_version_sessions as composed
    where composed.program_version_id = p_program_version_id
  ) as composition
  -- How many the week still needs, counted rather than matched by day.
  --
  -- Which day of the base week a planned session came from cannot be recovered: the
  -- table does not store it, and `greatest(..., starts_on)` collapses every day before
  -- the start onto the same date, so three days of week one can share one. What the
  -- domain says is that the day is a suggestion and the week is the unit, so a week
  -- keeps as many sessions as the new version asks for and the trained ones count
  -- towards that. Protecting the whole week instead froze somebody at one of one when
  -- they added a second day.
  where composition.slot > coalesce((
    select count(*) from planning.planned_sessions as kept
    where kept.assignment_id = assignment.id
      and kept.week_starts_on = first_week + ((composition.week - 1) * 7)
      and kept.status = 'completed'
  ), 0);

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'program-assignment-restated',
    'program_assignment', assignment.id
  );
  return assignment.id;
end
$function$;

alter function planning.restate_my_program_assignment(uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
revoke all on function planning.restate_my_program_assignment(uuid, uuid, uuid, uuid, bytea)
  from public;
grant execute on function planning.restate_my_program_assignment(uuid, uuid, uuid, uuid, bytea)
  to allfit_api;

commit;
