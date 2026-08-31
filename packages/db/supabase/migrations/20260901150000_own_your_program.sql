-- Taking a program is keeping it, and the week is what counts.
--
-- Two changes that go together because neither works alone.
--
-- **Taking a global program forks it.** The assignment used to point at Allfit's
-- version. Immutability already protected the person from changes — a published
-- version cannot be mutated and the calendar was already materialised — but the
-- program was not *theirs*: it could not appear among their own in any real sense
-- and could never be edited. Forking gives them ownership, which is the thing
-- immutability cannot give. It happens inside `self_assign_program` rather than as
-- its own operation: splitting the act in two would leave somebody owning a copy
-- with no assignment if the second half failed.
--
-- **A session belongs to a week, not to a day.** `Hoy` used to show the session
-- dated today, so wanting legs instead of chest meant rescheduling. Life moves
-- sessions, and a product that charges a fee for that gets abandoned. The week is
-- the calendar week, Monday to Sunday, and `week_starts_on` is what decides what is
-- offered; `scheduled_at` stays as the suggested day and decides nothing.
--
-- The cost, stated plainly: somebody who takes a four-day program on a Friday has
-- three days for four sessions that week, and what does not fit does not carry
-- over. That is what a calendar week means. Starting the following Monday instead
-- would break `HU-SP-100`'s promise of sessions **from today**.

begin;

-- The week a session belongs to. Derived for what already exists, from the day it
-- was pinned to.
alter table planning.planned_sessions
  add column week_starts_on date;

update planning.planned_sessions
set week_starts_on = date_trunc('week', (scheduled_at at time zone timezone))::date;

alter table planning.planned_sessions
  alter column week_starts_on set not null;

create index idx_planned_sessions_person_week
  on planning.planned_sessions (person_id, week_starts_on);

-- The copy, whole: templates, their versions, their steps, their targets, the
-- program, its version, its composition and its segmentation.
--
-- Nothing here needs a new policy. `programs_all_actor_access` and
-- `session_templates_all_actor_access` already admit `owner_person_id =
-- access_control.person()`, and versions, steps and targets inherit from their
-- parent — the schema was built for personal content before anything wrote any.
--
-- The `app.planning_publication` gate is the same one `publish_global_program`
-- uses. Writing a second publication path would let the copy's hashes and
-- materialised targets drift from the original's.
create function planning.fork_program_version(p_person_id uuid, p_program_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  source record;
  new_program_id uuid;
  new_version_id uuid;
  mapping jsonb := '{}'::jsonb;
  template record;
  new_template_id uuid;
  new_template_version_id uuid;
  step record;
  new_step_id uuid;
begin
  select version.id, version.title, version.notes, version.content_hash, version.sex_affinity
  into source
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id
    and version.status = 'published'
    and program.content_scope = 'global'
    and program.status = 'published';
  if source.id is null then
    raise exception 'program version is not forkable' using errcode = '42501';
  end if;

  perform set_config('app.planning_publication', 'true', true);

  -- One copy per distinct template the program composes, remembered so the new
  -- composition points at the person's own versions and never at Allfit's.
  for template in
    select distinct source_version.id as version_id,
           source_version.template_id,
           source_version.discipline_code,
           source_version.activity_type_id,
           source_version.title,
           source_version.content_hash,
           source_template.discipline_code as template_discipline
    from planning.program_version_sessions as composition
    join planning.session_template_versions as source_version
      on source_version.id = composition.template_version_id
    join planning.session_templates as source_template
      on source_template.id = source_version.template_id
    where composition.program_version_id = p_program_version_id
  loop
    insert into planning.session_templates (
      content_scope, owner_person_id, author_person_id, discipline_code, status
    ) values ('person', p_person_id, p_person_id, template.template_discipline, 'published')
    returning id into new_template_id;

    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id, title,
      content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title, template.content_hash, 'published', clock_timestamp()
    ) returning id into new_template_version_id;

    for step in
      select id, position, movement_id, activity_type_id, notes
      from planning.planned_steps
      where template_version_id = template.version_id
      order by position
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes
      ) values (
        new_template_version_id, step.position, step.movement_id, step.activity_type_id, step.notes
      ) returning id into new_step_id;

      insert into planning.strength_targets (
        planned_step_id, target_sets, target_reps, target_load_value, target_load_unit_code, target_rpe
      )
      select new_step_id, target_sets, target_reps, target_load_value, target_load_unit_code, target_rpe
      from planning.strength_targets where planned_step_id = step.id;

      insert into planning.endurance_targets (
        planned_step_id, target_distance_value, target_distance_unit_code,
        target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      )
      select new_step_id, target_distance_value, target_distance_unit_code,
             target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      from planning.endurance_targets where planned_step_id = step.id;

      insert into planning.interval_targets (
        planned_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      )
      select new_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      from planning.interval_targets where planned_step_id = step.id;

      insert into planning.mobility_targets (
        planned_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      )
      select new_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      from planning.mobility_targets where planned_step_id = step.id;
    end loop;

    mapping := mapping || jsonb_build_object(template.version_id::text, new_template_version_id);
  end loop;

  insert into planning.programs (content_scope, owner_person_id, author_person_id, status)
  values ('person', p_person_id, p_person_id, 'published')
  returning id into new_program_id;

  insert into planning.program_versions (
    program_id, version_number, title, notes, content_hash, status, published_at, sex_affinity
  ) values (
    new_program_id, 1, source.title, source.notes, source.content_hash,
    'published', clock_timestamp(), source.sex_affinity
  ) returning id into new_version_id;

  insert into planning.program_version_sessions (
    program_version_id, template_version_id, position, week, day
  )
  select new_version_id,
         (mapping->>composition.template_version_id::text)::uuid,
         composition.position, composition.week, composition.day
  from planning.program_version_sessions as composition
  where composition.program_version_id = p_program_version_id;

  -- The segmentation travels with the copy: it is what the catalogue matched on,
  -- and a copy that forgot it would stop being findable as the thing it is.
  insert into planning.program_version_goals (program_version_id, goal_code)
  select new_version_id, goal_code from planning.program_version_goals
  where program_version_id = p_program_version_id;
  insert into planning.program_version_levels (program_version_id, experience_code)
  select new_version_id, experience_code from planning.program_version_levels
  where program_version_id = p_program_version_id;
  insert into planning.program_version_emphases (program_version_id, focus_area_code)
  select new_version_id, focus_area_code from planning.program_version_emphases
  where program_version_id = p_program_version_id;

  return new_version_id;
end
$function$;

commit;

begin;

-- `OP-PLN-011`, now with ownership and weeks.
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
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'assignment person does not match the authenticated actor' using errcode = '42501';
  end if;

  -- The only validation the zone needs, and it has to happen before anything is
  -- written: the whole calendar is expressed in it.
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

  -- What `OP-PLN-011` calls "propia o global". Read under the caller's own row
  -- security, so a version they cannot see is a version they cannot assign.
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

  insert into planning.program_assignments (
    person_id, program_version_id, lifecycle, starts_on, timezone
  ) values (p_person_id, assigned_version_id, 'personal', starts, p_timezone)
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

alter function planning.fork_program_version(uuid, uuid) owner to allfit_owner;
revoke all on function planning.fork_program_version(uuid, uuid) from public;

commit;

begin;

-- Repeating a session that was already closed is legitimate. `finalize_execution`
-- already protects what matters: only the first valid attempt is primary, so a
-- repeat cannot inflate the week.
create or replace function execution.start_planned_session_attempt(
  p_person_id uuid,
  p_planned_session_id uuid,
  p_started_at timestamptz,
  p_timezone text,
  p_requested_level catalog.completeness_level,
  p_capture_source text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  id uuid,
  attempt_number integer,
  revision_number bigint,
  result_contract_id uuid,
  contract_version integer,
  requested_level text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  planned record;
  contract record;
  next_attempt integer;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-001', p_idempotency_key, p_command_id, p_request_hash
  );
  -- A replay answers the attempt that was already started, whole: the caller cannot
  -- tell a retry from the first call, which is the point of the receipt.
  if not receipt.claimed then
    return query
      select executed.id, attempt.attempt_number, executed.revision_number,
             executed.result_contract_id, executed.contract_version,
             executed.requested_level::text
      from execution.executed_sessions as executed
      join execution.planned_session_executions as attempt
        on attempt.executed_session_id = executed.id
      where executed.id = receipt.aggregate_id;
    return;
  end if;

  select session.id, session.template_version_id, session.status
  into planned
  from planning.planned_sessions as session
  where session.id = p_planned_session_id and session.person_id = p_person_id
  for update;
  if planned.id is null then
    raise exception 'planned session is not this person''s' using errcode = '42501';
  end if;
  -- Cancelled and paused are refusals; completed is not. Somebody who wants to do
  -- their push day twice has done it twice, and the history should say so.
  if planned.status in ('cancelled', 'paused') then
    raise exception 'planned session is not open' using errcode = '23514';
  end if;

  -- The contract is frozen onto the execution: what a result means must not change
  -- underneath a session somebody already recorded.
  select version.activity_type_id,
         association.result_contract_id,
         published.version_number
  into contract
  from planning.session_template_versions as version
  join catalog.activity_type_result_contracts as association
    on association.activity_type_id = version.activity_type_id
   and association.is_default
   and association.valid_from <= clock_timestamp()
   and (association.valid_to is null or association.valid_to > clock_timestamp())
  join catalog.result_contracts as published on published.id = association.result_contract_id
  where version.id = planned.template_version_id;
  if contract.result_contract_id is null then
    raise exception 'session template has no result contract' using errcode = '23514';
  end if;

  insert into execution.executed_sessions (
    id, person_id, activity_type_id, result_contract_id, contract_version,
    started_at, timezone, requested_level, capture_source
  ) values (
    p_command_id, p_person_id, contract.activity_type_id, contract.result_contract_id,
    contract.version_number, p_started_at, p_timezone, p_requested_level, p_capture_source
  );

  select coalesce(max(attempt.attempt_number), 0) + 1 into next_attempt
  from execution.planned_session_executions as attempt
  where attempt.planned_session_id = p_planned_session_id;

  insert into execution.planned_session_executions (
    planned_session_id, executed_session_id, person_id, attempt_number
  ) values (p_planned_session_id, p_command_id, p_person_id, next_attempt);

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'attempt-started', 'executed_session', p_command_id
  );

  return query
    select p_command_id, next_attempt, 0::bigint, contract.result_contract_id,
           contract.version_number, p_requested_level::text;
end
$function$;

commit;

begin;

-- What `E-2` draws: the programme in force and the routines of the calendar week
-- in progress, each with enough to decide by — how much work it is, whether it has
-- been done, and whether an attempt is already open on it.
create function planning.read_week_plan(p_person_id uuid, p_timezone text)
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
         -- The programme's own week number, which is what its content is written
         -- against, derived from how far the calendar has moved.
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
  order by assignment.assigned_at desc
  limit 1
$function$;

-- The selector's list. Ordered by when it was taken, newest first, which is the
-- default the person expects; an explicit order is its own slice and its own
-- column, not something to fake here.
create function planning.read_my_programs(p_person_id uuid)
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
  order by assignment.assigned_at desc
$function$;

-- The next session still pending this week, not the one dated today. The day is a
-- suggestion, so what decides is the week and what is left in it.
create or replace function planning.read_today_session(p_person_id uuid, p_timezone text)
returns table (
  planned_session_id uuid,
  assignment_id uuid,
  program_title text,
  session_title text,
  discipline_code text,
  scheduled_on date,
  status text,
  exercise_count integer,
  executed_session_id uuid,
  execution_status text
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select session.id,
         session.assignment_id,
         version.title,
         template_version.title,
         template_version.discipline_code,
         (session.scheduled_at at time zone session.timezone)::date,
         session.status,
         (select count(*)::integer from planning.planned_steps as step
           where step.template_version_id = session.template_version_id),
         open_attempt.executed_session_id,
         open_attempt.execution_status::text
  from planning.planned_sessions as session
  join planning.program_assignments as assignment on assignment.id = session.assignment_id
  join planning.program_versions as version on version.id = assignment.program_version_id
  join planning.session_template_versions as template_version
    on template_version.id = session.template_version_id
  left join lateral (
    select attempt.executed_session_id, executed.execution_status
    from execution.planned_session_executions as attempt
    join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
    where attempt.planned_session_id = session.id
      and executed.execution_status = 'in_progress'
    order by attempt.attempt_number desc
    limit 1
  ) as open_attempt on true
  where session.person_id = p_person_id
    and session.week_starts_on
        = date_trunc('week', (clock_timestamp() at time zone p_timezone))::date
    -- Pending, or already open: an attempt in progress is what somebody comes back
    -- to, and offering the next one instead would strand it.
    and (session.status = 'scheduled' or open_attempt.executed_session_id is not null)
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by open_attempt.executed_session_id nulls last, session.scheduled_at
  limit 1
$function$;

do $$
declare
  routine text;
begin
  foreach routine in array array[
    'planning.read_week_plan(uuid, text)',
    'planning.read_my_programs(uuid)',
    'planning.read_today_session(uuid, text)'
  ] loop
    execute format('alter function %s owner to allfit_owner', routine);
    execute format('revoke all on function %s from public', routine);
    execute format('grant execute on function %s to allfit_api', routine);
  end loop;
end
$$;

commit;

begin;

-- The week's plan and how much of it is done, counted in planned sessions rather
-- than in executions: a repeat is a second execution of the same session and must
-- not move the week's number.
--
-- The same week both screens count, so they cannot disagree. It used to be the
-- seven days ending today, which was right when the day decided things and is
-- wrong now that the week does. Dropped and recreated rather than replaced:
-- PostgreSQL will not let `create or replace` change a return type.
drop function execution.read_week_summary(uuid, text);
create function execution.read_week_summary(p_person_id uuid, p_timezone text)
returns table (
  trained_seconds numeric,
  sessions_completed integer,
  sessions_planned integer,
  latest_weight_value numeric,
  latest_weight_unit text,
  history jsonb
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select coalesce(week.seconds, 0),
         coalesce(plan.done, 0),
         coalesce(plan.planned, 0),
         weight.value_numeric,
         weight.unit_code,
         coalesce(recent.history, '[]'::jsonb)
  from (select 1) as anchor
  left join lateral (
    select sum(extract(epoch from (executed.ended_at - executed.started_at))) as seconds
    from execution.executed_sessions as executed
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.ended_at is not null
      and (executed.started_at at time zone p_timezone)::date
          >= date_trunc('week', (clock_timestamp() at time zone p_timezone))::date
  ) as week on true
  left join lateral (
    select count(*) filter (where session.status = 'completed')::integer as done,
           count(*)::integer as planned
    from planning.planned_sessions as session
    where session.person_id = p_person_id
      and session.week_starts_on
          = date_trunc('week', (clock_timestamp() at time zone p_timezone))::date
  ) as plan on true
  left join lateral (
    select record.value_numeric, record.unit_code
    from identity.body_progress_records as record
    where record.person_id = p_person_id and record.metric_code = 'body_weight'
    order by record.measured_on desc, record.id desc
    limit 1
  ) as weight on true
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.started_at desc) as history
    from (
      select executed.id as executed_session_id,
             (executed.started_at at time zone executed.timezone)::date as trained_on,
             executed.started_at,
             template_version.title as title,
             (select count(*) from execution.strength_sets as sets
               where sets.executed_session_id = executed.id)::integer as sets_recorded
      from execution.executed_sessions as executed
      left join execution.planned_session_executions as attempt
        on attempt.executed_session_id = executed.id
      left join planning.planned_sessions as session on session.id = attempt.planned_session_id
      left join planning.session_template_versions as template_version
        on template_version.id = session.template_version_id
      where executed.person_id = p_person_id and executed.execution_status = 'completed'
      order by executed.started_at desc
      limit 3
    ) as entry
  ) as recent on true
  where access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

commit;
