-- The order the person put their programmes in.
--
-- The training tab opens on the first one, so the order is not decoration: it is
-- which programme the app is about when somebody taps Entrenar. That makes it worth
-- a column rather than a preference held on a device — a phone reinstall must not
-- change which programme opens.
--
-- **Newest first by default, without a rule.** A new assignment takes a lower order
-- than every existing one, so it opens the tab the moment it is taken and nothing
-- has to special-case "the last created".

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

alter table planning.program_assignments
  add column display_order integer;

-- Existing assignments keep the order they already read in: newest first.
update planning.program_assignments as assignment
set display_order = ranked.position
from (
  select id, row_number() over (partition by person_id order by assigned_at desc) as position
  from planning.program_assignments
) as ranked
where ranked.id = assignment.id;

alter table planning.program_assignments
  alter column display_order set not null;

create index idx_program_assignments_person_order
  on planning.program_assignments (person_id, display_order);

-- `OP-PLN-011` again, with the new assignment landing in front.
create or replace function planning.self_assign_program(
  p_person_id uuid,
  p_program_version_id uuid,
  p_timezone text,
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
  new_assignment_id uuid;
  starts date;
  first_week date;
  reachable boolean;
  is_global boolean;
  assigned_version_id uuid;
  front integer;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'assignment person does not match the authenticated actor' using errcode = '42501';
  end if;

  begin
    starts := (clock_timestamp() at time zone p_timezone)::date;
  exception when others then
    raise exception 'invalid timezone' using errcode = '22023';
  end;
  first_week := date_trunc('week', starts::timestamp)::date;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-011', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return receipt.aggregate_id;
  end if;

  select exists (
    select 1
    from planning.program_versions as version
    join planning.programs as program on program.id = version.program_id
    where version.id = p_program_version_id
      and version.status = 'published'
      and (
        program.content_scope = 'global' and program.status = 'published'
        or program.owner_person_id = p_person_id
      )
  ),
  exists (
    select 1
    from planning.program_versions as version
    join planning.programs as program on program.id = version.program_id
    where version.id = p_program_version_id and program.content_scope = 'global'
  )
  into reachable, is_global;
  if not reachable then
    raise exception 'program version is not available to this person' using errcode = '42501';
  end if;

  -- Taking Allfit's program is keeping it. The copy is what makes it editable
  -- later; immutability alone only makes it stable.
  assigned_version_id := case
    when is_global then planning.fork_program_version(p_person_id, p_program_version_id)
    else p_program_version_id
  end;

  -- In front of everything, so the tab opens on what was just taken.
  select coalesce(min(assignment.display_order), 1) - 1 into front
  from planning.program_assignments as assignment
  where assignment.person_id = p_person_id;

  insert into planning.program_assignments (
    person_id, program_version_id, lifecycle, starts_on, timezone, display_order
  ) values (p_person_id, assigned_version_id, 'personal', starts, p_timezone, front)
  returning id into new_assignment_id;

  -- Week N of the program is calendar week N, counted from the one that contains
  -- today. The day inside the week is a suggestion, so it is only ever used to
  -- order the list — never to decide what can be trained.
  insert into planning.planned_sessions (
    assignment_id, person_id, template_version_id, week_starts_on, scheduled_at, timezone
  )
  select new_assignment_id, p_person_id, composition.template_version_id,
         first_week + ((composition.week - 1) * 7),
         greatest(
           (first_week + ((composition.week - 1) * 7) + composition.day - 1)::timestamp,
           starts::timestamp
         ) at time zone p_timezone,
         p_timezone
  from planning.program_version_sessions as composition
  where composition.program_version_id = assigned_version_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-assignment-created',
    'program_assignment', new_assignment_id
  );
  return new_assignment_id;
end
$function$;

-- Reordering is a whole-list write, like replacing session results: the client holds
-- the order it is looking at and sends it entire, so there is never a half-applied
-- order and never a merge to reason about.
create function planning.reorder_my_programs(
  p_person_id uuid,
  p_assignment_ids uuid[],
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  owned integer;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'assignment person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-024', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return cardinality(p_assignment_ids);
  end if;

  if p_assignment_ids is null or cardinality(p_assignment_ids) = 0 then
    raise exception 'an order with nothing in it is not an order' using errcode = '22023';
  end if;
  if cardinality(p_assignment_ids) <> cardinality(array(select distinct unnest(p_assignment_ids))) then
    raise exception 'the order repeats an assignment' using errcode = '22023';
  end if;

  -- Every id has to be one of theirs, and all of them have to be there. A partial
  -- order would silently leave whatever was omitted wherever it happened to be.
  select count(*)::integer into owned
  from planning.program_assignments as assignment
  where assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal';
  if owned <> cardinality(p_assignment_ids) then
    raise exception 'the order does not cover every programme' using errcode = '22023';
  end if;

  update planning.program_assignments as assignment
  set display_order = position.ordinality
  from unnest(p_assignment_ids) with ordinality as position(id, ordinality)
  where assignment.id = position.id
    and assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal';

  if not found then
    raise exception 'the order names no assignment of this person''s' using errcode = '42501';
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'programs-reordered', 'person', p_person_id
  );
  return cardinality(p_assignment_ids);
end
$function$;

-- The selector's list, in the order the person put it in.
create or replace function planning.read_my_programs(p_person_id uuid)
returns table (
  assignment_id uuid,
  program_version_id uuid,
  title text,
  weeks integer,
  days_per_week integer,
  starts_on date,
  sessions_done integer,
  sessions_planned integer
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select assignment.id,
         version.id,
         version.title,
         composition.weeks,
         composition.days_per_week,
         assignment.starts_on,
         counted.done,
         counted.planned
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day) filter (where session.week = 1)::integer as days_per_week
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

-- The week plan follows the same order, or the tab would open on one programme and
-- the selector would say another is first.
create or replace function planning.read_week_plan(p_person_id uuid, p_timezone text)
returns table (
  assignment_id uuid,
  program_version_id uuid,
  program_title text,
  program_week integer,
  week_starts_on date,
  sessions jsonb
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select assignment.id,
         version.id,
         version.title,
         (((clock_timestamp() at time zone p_timezone)::date
           - date_trunc('week', assignment.starts_on::timestamp)::date) / 7 + 1)::integer,
         date_trunc('week', (clock_timestamp() at time zone p_timezone))::date,
         coalesce(week.entries, '[]'::jsonb)
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.scheduled_at) as entries
    from (
      select session.id as planned_session_id,
             template_version.title as title,
             template_version.discipline_code,
             session.status,
             session.scheduled_at,
             (select count(*)::integer from planning.planned_steps as step
               where step.template_version_id = session.template_version_id) as exercise_count,
             (select coalesce(sum(target.target_sets), 0)::integer
               from planning.planned_steps as step
               join planning.strength_targets as target on target.planned_step_id = step.id
               where step.template_version_id = session.template_version_id) as set_count,
             exists (
               select 1 from execution.planned_session_executions as attempt
               join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
               where attempt.planned_session_id = session.id
                 and executed.execution_status = 'completed'
             ) as done,
             (
               select attempt.executed_session_id
               from execution.planned_session_executions as attempt
               join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
               where attempt.planned_session_id = session.id
                 and executed.execution_status = 'in_progress'
               order by attempt.attempt_number desc
               limit 1
             ) as open_execution_id
      from planning.planned_sessions as session
      join planning.session_template_versions as template_version
        on template_version.id = session.template_version_id
      where session.assignment_id = assignment.id
        and session.week_starts_on
            = date_trunc('week', (clock_timestamp() at time zone p_timezone))::date
    ) as entry
  ) as week on true
  where assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.display_order, assignment.assigned_at desc
  limit 1
$function$;

alter function planning.reorder_my_programs(uuid, uuid[], uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.reorder_my_programs(uuid, uuid[], uuid, uuid, bytea) from public;
grant execute on function planning.reorder_my_programs(uuid, uuid[], uuid, uuid, bytea) to allfit_api;

commit;
