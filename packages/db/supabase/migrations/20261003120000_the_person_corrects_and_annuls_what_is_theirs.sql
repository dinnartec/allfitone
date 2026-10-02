-- The person corrects and annuls what is theirs, and repeats it (ADR-038).
--
-- A finished session opens on its own detail (OP-EXE-023): every set with its kind, the
-- best set of each exercise, the set that beat everything before, and the last time the
-- same routine was done. From there the person can:
--
-- - correct it (OP-EXE-007). Append-only: each correction keeps the session as it was in
--   `execution_revisions`, before and after, and the derived figures follow by themselves,
--   because records, streak and totals are read, never stored (ADR-036).
-- - annul it (OP-EXE-009). Nothing is deleted; the session stops counting, with a default
--   reason when the person gives none. OP-EXE-024 says beforehand what that changes.
-- - repeat it: another attempt at the same planned session, opening with the exercises
--   the session ended with and no sets.
--
-- Additive: one table, an internal helper that `replace_execution_results` now shares, and
-- `read_execution` redefined so an annulled session is no longer «last time».

set lock_timeout = '5s';
set statement_timeout = '120s';

begin;

-- ———————————————————————————————————————— revisions, append-only

create table execution.execution_revisions (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  person_id uuid not null,
  revision_from bigint not null,
  revision_to bigint not null,
  actor_person_id uuid not null,
  reason text not null,
  before jsonb not null,
  after jsonb not null,
  created_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_execution_revisions primary key (id),
  constraint fk_execution_revisions_session foreign key (executed_session_id) references execution.executed_sessions (id) on delete restrict,
  constraint ck_execution_revisions_order check (revision_to > revision_from),
  constraint ck_execution_revisions_reason check (btrim(reason) <> '')
);

create index idx_execution_revisions_session
  on execution.execution_revisions (executed_session_id, created_at);

alter table execution.execution_revisions owner to allfit_owner;
revoke all on execution.execution_revisions from public;
alter table execution.execution_revisions enable row level security;
alter table execution.execution_revisions force row level security;

create policy execution_revisions_select_self on execution.execution_revisions
  for select to allfit_owner
  using (person_id = access_control.person());

create policy execution_revisions_insert_self on execution.execution_revisions
  for insert to allfit_owner
  with check (person_id = access_control.person());

-- Per statement, so even a change that matches no row is refused: the original value of a
-- correction is the one thing nobody, the owner included, may rewrite.
create function execution.refuse_revision_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a revision is never rewritten' using errcode = '42501';
end
$function$;

alter function execution.refuse_revision_change() owner to allfit_owner;
revoke all on function execution.refuse_revision_change() from public;

create trigger trg_execution_revisions_append_only
  before update or delete or truncate on execution.execution_revisions
  for each statement execute function execution.refuse_revision_change();

-- ———————————————————————————————————————— writing a session's sets, in one place

-- What `replace_execution_results` did inline, so a correction writes sets the same way.
-- Internal: no grant, reached only from the commands that checked the actor first.
create function execution.write_session_results(
  p_executed_session_id uuid,
  p_results jsonb,
  p_exercises jsonb
)
returns void
language plpgsql
set search_path = pg_catalog
as $function$
declare
  entry jsonb;
  owner_exercise uuid;
begin
  -- Replaced whole, so there is never a half-applied session.
  delete from execution.strength_sets where executed_session_id = p_executed_session_id;
  delete from execution.endurance_laps where executed_session_id = p_executed_session_id;
  delete from execution.interval_results where executed_session_id = p_executed_session_id;
  delete from execution.round_results where executed_session_id = p_executed_session_id;
  delete from execution.mobility_results where executed_session_id = p_executed_session_id;

  -- The exercise list travels with the sets and is replaced with them. Without one, an
  -- older client keeps the list the session already has.
  if p_exercises is not null then
    -- IX-50: a superset is contiguous, as it is in the plan (IX-46).
    if exists (
      select 1
      from jsonb_array_elements(p_exercises) as item
      where nullif(item->>'superset_group', '') is not null
      group by (item->>'superset_group')::smallint
      having max((item->>'position')::integer) - min((item->>'position')::integer) + 1 <> count(*)
    ) then
      raise exception 'a superset has to be contiguous' using errcode = '23514';
    end if;

    delete from execution.session_exercises where executed_session_id = p_executed_session_id;
    insert into execution.session_exercises (
      executed_session_id, position, movement_id, planned_step_id, superset_group, rest_seconds
    )
    select p_executed_session_id, (item->>'position')::integer,
           nullif(item->>'movement_id', '')::uuid, nullif(item->>'planned_step_id', '')::uuid,
           nullif(item->>'superset_group', '')::smallint,
           nullif(item->>'rest_seconds', '')::integer
    from jsonb_array_elements(p_exercises) as item;
  end if;

  for entry in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    case entry->>'family'
      when 'strength' then
        -- The set belongs to the exercise at its position; an older client that does not
        -- say lands on the first exercise of the same movement.
        if nullif(entry->>'exercise_position', '') is not null then
          select exercise.id into owner_exercise
          from execution.session_exercises as exercise
          where exercise.executed_session_id = p_executed_session_id
            and exercise.position = (entry->>'exercise_position')::integer;
          if owner_exercise is null then
            raise exception 'set belongs to no exercise of this session' using errcode = '23514';
          end if;
        else
          select exercise.id into owner_exercise
          from execution.session_exercises as exercise
          where exercise.executed_session_id = p_executed_session_id
            and exercise.movement_id is not distinct from nullif(entry->>'movement_id', '')::uuid
          order by exercise.position
          limit 1;
        end if;

        insert into execution.strength_sets (
          executed_session_id, movement_id, set_order, achieved_reps,
          load_value, load_unit_code, rpe, kind, session_exercise_id
        ) values (
          p_executed_session_id,
          nullif(entry->>'movement_id', '')::uuid,
          (entry->>'set_order')::integer,
          nullif(entry->>'achieved_reps', '')::integer,
          nullif(entry->>'load_value', '')::numeric,
          nullif(entry->>'load_unit_code', ''),
          nullif(entry->>'rpe', '')::numeric,
          coalesce(nullif(entry->>'kind', ''), 'normal')::planning.set_kind,
          owner_exercise
        );
      when 'endurance' then
        insert into execution.endurance_laps (
          executed_session_id, lap_number, distance_value, distance_unit_code, duration_seconds
        ) values (
          p_executed_session_id,
          (entry->>'lap_number')::integer,
          (entry->>'distance_value')::numeric,
          entry->>'distance_unit_code',
          (entry->>'duration_seconds')::numeric
        );
      when 'interval' then
        insert into execution.interval_results (
          executed_session_id, interval_number, work_duration_seconds,
          rest_duration_seconds, achieved_repetitions, completed
        ) values (
          p_executed_session_id,
          (entry->>'interval_number')::integer,
          (entry->>'work_duration_seconds')::numeric,
          nullif(entry->>'rest_duration_seconds', '')::numeric,
          nullif(entry->>'achieved_repetitions', '')::integer,
          coalesce((entry->>'completed')::boolean, true)
        );
      when 'mobility' then
        insert into execution.mobility_results (
          executed_session_id, sequence_position, movement_id, side,
          hold_duration_seconds, completed_repetitions
        ) values (
          p_executed_session_id,
          (entry->>'sequence_position')::integer,
          nullif(entry->>'movement_id', '')::uuid,
          coalesce(nullif(entry->>'side', ''), 'not_applicable'),
          nullif(entry->>'hold_duration_seconds', '')::numeric,
          nullif(entry->>'completed_repetitions', '')::integer
        );
      else
        raise exception 'unknown result family' using errcode = '22023';
    end case;
  end loop;
end
$function$;

alter function execution.write_session_results(uuid, jsonb, jsonb) owner to allfit_owner;
revoke all on function execution.write_session_results(uuid, jsonb, jsonb) from public;

CREATE OR REPLACE FUNCTION execution.replace_execution_results(p_person_id uuid, p_executed_session_id uuid, p_expected_revision bigint, p_results jsonb, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea, p_exercises jsonb DEFAULT NULL)
 RETURNS TABLE(id uuid, revision_number bigint, result_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  session record;
  written integer;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-005', p_idempotency_key, p_command_id, p_request_hash
  );

  select * into session
  from execution.executed_sessions as executed
  where executed.id = p_executed_session_id and executed.person_id = p_person_id
  for update;
  if session.id is null then
    raise exception 'execution is not this person''s' using errcode = '42501';
  end if;

  if not receipt.claimed then
    return query select session.id, session.revision_number, execution.result_count(session.id);
    return;
  end if;

  if session.execution_status <> 'in_progress' then
    raise exception 'execution is not open' using errcode = '23514';
  end if;
  if session.revision_number <> p_expected_revision then
    raise exception 'stale-execution' using errcode = '40001';
  end if;

  perform execution.write_session_results(p_executed_session_id, p_results, p_exercises);

  update execution.executed_sessions as executed
  set revision_number = executed.revision_number + 1
  where executed.id = p_executed_session_id;

  written := execution.result_count(p_executed_session_id);

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'results-replaced', 'executed_session', p_executed_session_id
  );

  return query select p_executed_session_id, session.revision_number + 1, written;
end
$function$;

-- A session as it stands: its time, its exercises and its strength sets. What a revision
-- keeps on both sides.
create function execution.session_snapshot(p_executed_session_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'started_at', executed.started_at,
    'ended_at', executed.ended_at,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
               'position', item.position, 'movement_id', item.movement_id,
               'planned_step_id', item.planned_step_id, 'superset_group', item.superset_group,
               'rest_seconds', item.rest_seconds) order by item.position)
      from execution.session_exercises as item
      where item.executed_session_id = executed.id), '[]'::jsonb),
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'set_order', sets.set_order, 'movement_id', sets.movement_id,
               'achieved_reps', sets.achieved_reps, 'load_value', sets.load_value,
               'load_unit_code', sets.load_unit_code, 'rpe', sets.rpe, 'kind', sets.kind,
               'exercise_position', owner.position) order by sets.set_order)
      from execution.strength_sets as sets
      left join execution.session_exercises as owner on owner.id = sets.session_exercise_id
      where sets.executed_session_id = executed.id), '[]'::jsonb))
  from execution.executed_sessions as executed
  where executed.id = p_executed_session_id
$function$;

alter function execution.session_snapshot(uuid) owner to allfit_owner;
revoke all on function execution.session_snapshot(uuid) from public;

-- Kilos lifted without warmups; null when nothing was weighed, as in the summary.
create function execution.session_volume_kg(p_executed_session_id uuid)
returns numeric
language sql
stable
set search_path = pg_catalog
as $function$
  select round(sum(sets.load_value * unit.to_canonical_factor * sets.achieved_reps), 2)
  from execution.strength_sets as sets
  left join catalog.units as unit on unit.code = sets.load_unit_code and unit.dimension = 'mass'
  where sets.executed_session_id = p_executed_session_id and sets.kind <> 'warmup'
$function$;

alter function execution.session_volume_kg(uuid) owner to allfit_owner;
revoke all on function execution.session_volume_kg(uuid) from public;

-- ———————————————————————————————————————— correct (OP-EXE-007)

create function execution.revise_execution(
  p_person_id uuid,
  p_executed_session_id uuid,
  p_expected_revision bigint,
  p_results jsonb,
  p_exercises jsonb,
  p_started_at timestamp with time zone,
  p_ended_at timestamp with time zone,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (id uuid, revision_number bigint, result_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  session record;
  kept jsonb;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-007', p_idempotency_key, p_command_id, p_request_hash
  );

  select * into session
  from execution.executed_sessions as executed
  where executed.id = p_executed_session_id and executed.person_id = p_person_id
  for update;
  if session.id is null then
    raise exception 'execution is not this person''s' using errcode = '42501';
  end if;

  if not receipt.claimed then
    return query select session.id, session.revision_number, execution.result_count(session.id);
    return;
  end if;

  if session.execution_status <> 'completed' or session.annulled_at is not null then
    raise exception 'execution is not finished' using errcode = '23514';
  end if;
  if session.revision_number <> p_expected_revision then
    raise exception 'stale-execution' using errcode = '40001';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at < p_started_at then
    raise exception 'a session cannot end before it began' using errcode = '23514';
  end if;
  -- Emptying a finished session is annulling it, which is its own command.
  if jsonb_array_length(coalesce(p_results, '[]'::jsonb)) = 0 then
    raise exception 'a finished session keeps at least one result' using errcode = '23514';
  end if;

  kept := execution.session_snapshot(p_executed_session_id);

  perform execution.write_session_results(p_executed_session_id, p_results, p_exercises);

  update execution.executed_sessions as executed
  set revision_number = executed.revision_number + 1,
      started_at = p_started_at,
      ended_at = p_ended_at
  where executed.id = p_executed_session_id;

  insert into execution.execution_revisions (
    executed_session_id, person_id, revision_from, revision_to, actor_person_id, reason, before, after
  ) values (
    p_executed_session_id, p_person_id, session.revision_number, session.revision_number + 1,
    p_person_id, 'Corrección de la persona', kept, execution.session_snapshot(p_executed_session_id)
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'execution-revised', 'executed_session', p_executed_session_id
  );

  return query select p_executed_session_id, session.revision_number + 1,
                      execution.result_count(p_executed_session_id);
end
$function$;

-- ———————————————————————————————————————— annul (OP-EXE-009)

create function execution.annul_execution(
  p_person_id uuid,
  p_executed_session_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (id uuid, annulled_at timestamp with time zone)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  session record;
  stamped timestamp with time zone := clock_timestamp();
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-009', p_idempotency_key, p_command_id, p_request_hash
  );

  select * into session
  from execution.executed_sessions as executed
  where executed.id = p_executed_session_id and executed.person_id = p_person_id
  for update;
  if session.id is null then
    raise exception 'execution is not this person''s' using errcode = '42501';
  end if;

  if not receipt.claimed then
    return query select session.id, session.annulled_at;
    return;
  end if;

  if session.execution_status <> 'completed' or session.annulled_at is not null then
    raise exception 'execution is not finished' using errcode = '23514';
  end if;

  -- Marked, never deleted: what was trained is still the person's, it just stops counting.
  update execution.executed_sessions as executed
  set validation_status = 'annulled',
      annulled_at = stamped,
      annulment_reason = coalesce(nullif(btrim(p_reason), ''), 'La persona lo eliminó')
  where executed.id = p_executed_session_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'execution-annulled', 'executed_session', p_executed_session_id
  );

  return query select p_executed_session_id, stamped;
end
$function$;

-- ———————————————————————————————————————— what annulling would change (OP-EXE-024)

-- Weeks in a row with something finished, ending this week or, while this one is still
-- empty, the last. `p_without` leaves one session out, to say what annulling it costs.
create function execution.streak_weeks(
  p_person_id uuid,
  p_timezone text,
  p_today date,
  p_without uuid
)
returns integer
language sql
stable
set search_path = pg_catalog
as $function$
  with
  weeks as (
    select distinct date_trunc('week', executed.started_at at time zone p_timezone)::date as week
    from execution.executed_sessions as executed
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
      and executed.id is distinct from p_without
      and (executed.started_at at time zone p_timezone)::date <= p_today
  ),
  anchor as (
    select case when exists (select 1 from weeks where weeks.week = date_trunc('week', p_today)::date)
                then date_trunc('week', p_today)::date
                else (date_trunc('week', p_today) - interval '7 days')::date end as week
  ),
  ranked as (
    select weeks.week, row_number() over (order by weeks.week desc) as rn
    from weeks, anchor
    where weeks.week <= anchor.week
  )
  select count(*)::integer
  from ranked, anchor
  where ranked.week = anchor.week - ((ranked.rn - 1) * 7)::integer
$function$;

alter function execution.streak_weeks(uuid, text, date, uuid) owner to allfit_owner;
revoke all on function execution.streak_weeks(uuid, text, date, uuid) from public;

create function execution.read_annulment_preview(
  p_person_id uuid,
  p_executed_session_id uuid,
  p_timezone text,
  p_today date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  today date := coalesce(p_today, (clock_timestamp() at time zone p_timezone)::date);
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return null;
  end if;
  if not exists (
    select 1 from execution.executed_sessions as executed
    where executed.id = p_executed_session_id and executed.person_id = p_person_id
      and executed.execution_status = 'completed' and executed.annulled_at is null
  ) then
    return null;
  end if;

  return jsonb_build_object(
    'records', (select count(*)::integer from execution.session_records(p_person_id, p_executed_session_id)),
    'streak_weeks', execution.streak_weeks(p_person_id, p_timezone, today, null),
    'streak_weeks_after', execution.streak_weeks(p_person_id, p_timezone, today, p_executed_session_id));
end
$function$;

-- ———————————————————————————————————————— repeat

create function execution.repeat_execution(
  p_person_id uuid,
  p_source_id uuid,
  p_started_at timestamp with time zone,
  p_timezone text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (id uuid, attempt_number integer, revision_number bigint)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  source record;
  started record;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-025', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query
      select executed.id, attempt.attempt_number, executed.revision_number
      from execution.executed_sessions as executed
      join execution.planned_session_executions as attempt on attempt.executed_session_id = executed.id
      where executed.id = receipt.aggregate_id;
    return;
  end if;

  select executed.id, executed.execution_status, executed.annulled_at, executed.requested_level,
         executed.capture_source, attempt.planned_session_id
  into source
  from execution.executed_sessions as executed
  left join execution.planned_session_executions as attempt on attempt.executed_session_id = executed.id
  where executed.id = p_source_id and executed.person_id = p_person_id;
  if source.id is null then
    raise exception 'execution is not this person''s' using errcode = '42501';
  end if;
  if source.execution_status <> 'completed' or source.annulled_at is not null then
    raise exception 'execution is not finished' using errcode = '23514';
  end if;
  if source.planned_session_id is null then
    raise exception 'a free session has no routine to repeat' using errcode = '23514';
  end if;
  -- One session open at a time: the second would leave the first behind, unfinished.
  if exists (
    select 1 from execution.executed_sessions as open
    where open.person_id = p_person_id and open.execution_status in ('in_progress', 'paused')
  ) then
    raise exception 'another session is still open' using errcode = '55006';
  end if;

  -- Its own receipt, under OP-EXE-001, so a repeat is an attempt like any other.
  select * into started from execution.start_planned_session_attempt(
    p_person_id, source.planned_session_id, p_started_at, p_timezone, source.requested_level,
    source.capture_source, p_idempotency_key, p_command_id, p_request_hash
  );

  -- The exercises the session ended with, not the routine's: «the same workout».
  delete from execution.session_exercises where executed_session_id = started.id;
  insert into execution.session_exercises (
    executed_session_id, position, movement_id, planned_step_id, superset_group, rest_seconds
  )
  select started.id, item.position, item.movement_id, item.planned_step_id,
         item.superset_group, item.rest_seconds
  from execution.session_exercises as item
  where item.executed_session_id = p_source_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'execution-repeated', 'executed_session', started.id
  );

  return query select started.id, started.attempt_number, started.revision_number;
end
$function$;

-- ———————————————————————————————————————— the detail (OP-EXE-023)

create function execution.read_finished_execution(
  p_person_id uuid,
  p_executed_session_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
  previous record;
  volume numeric;
  result jsonb;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return null;
  end if;

  select executed.id, executed.started_at, executed.ended_at, executed.revision_number,
         attempt.planned_session_id, planned.status as planned_status,
         version.title, version.template_id
  into target
  from execution.executed_sessions as executed
  left join execution.planned_session_executions as attempt on attempt.executed_session_id = executed.id
  left join planning.planned_sessions as planned on planned.id = attempt.planned_session_id
  left join planning.session_template_versions as version on version.id = planned.template_version_id
  where executed.id = p_executed_session_id and executed.person_id = p_person_id
    and executed.execution_status = 'completed' and executed.annulled_at is null
    and executed.ended_at is not null;
  if target.id is null then
    return null;
  end if;

  volume := execution.session_volume_kg(target.id);

  -- The last time the same routine was finished, whatever version of it.
  select earlier.id, earlier.started_at, execution.session_volume_kg(earlier.id) as volume
  into previous
  from execution.executed_sessions as earlier
  join execution.planned_session_executions as attempt on attempt.executed_session_id = earlier.id
  join planning.planned_sessions as planned on planned.id = attempt.planned_session_id
  join planning.session_template_versions as version on version.id = planned.template_version_id
  where target.template_id is not null
    and version.template_id = target.template_id
    and earlier.person_id = p_person_id
    and earlier.id <> target.id
    and earlier.execution_status = 'completed'
    and earlier.annulled_at is null
    and earlier.started_at < target.started_at
  order by earlier.started_at desc
  limit 1;

  with
  records as (select * from execution.session_records(p_person_id, target.id)),
  work as (
    select sets.id, sets.session_exercise_id, sets.set_order, sets.kind, sets.movement_id,
           sets.achieved_reps, sets.load_value * unit.to_canonical_factor as load_kg
    from execution.strength_sets as sets
    left join catalog.units as unit on unit.code = sets.load_unit_code and unit.dimension = 'mass'
    where sets.executed_session_id = target.id
  ),
  -- The best set of an exercise is its highest estimated max, the first of equals.
  best as (
    select distinct on (work.session_exercise_id) work.session_exercise_id, work.id,
           work.load_kg, work.achieved_reps, work.movement_id
    from work
    where work.kind <> 'warmup' and work.load_kg is not null and work.achieved_reps is not null
    order by work.session_exercise_id, work.load_kg * (1 + work.achieved_reps / 30.0) desc, work.set_order
  )
  select jsonb_build_object(
    'executed_session_id', target.id,
    'revision_number', target.revision_number,
    'started_at', target.started_at,
    'ended_at', target.ended_at,
    'duration_seconds', extract(epoch from (target.ended_at - target.started_at))::integer,
    'title', target.title,
    'planned_session_id', target.planned_session_id,
    'repeatable', target.planned_session_id is not null
                  and target.planned_status not in ('cancelled', 'paused'),
    'session_number', (
      select count(*)::integer from execution.executed_sessions as counted
      where counted.person_id = p_person_id and counted.execution_status = 'completed'
        and counted.annulled_at is null and counted.started_at <= target.started_at),
    'work_sets', (select count(*)::integer from work where work.kind <> 'warmup'),
    'total_volume_kg', volume,
    'record_count', (select count(*)::integer from records),
    'previous', case when previous.id is null then null else jsonb_build_object(
      'executed_session_id', previous.id,
      'started_at', previous.started_at,
      'total_volume_kg', previous.volume,
      'change_percent', case when previous.volume > 0 and volume is not null
                             then round((volume - previous.volume) / previous.volume * 100) end) end,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', item.position,
        'movement_id', item.movement_id,
        'movement', movement.name,
        'superset_group', item.superset_group,
        'record', exists (select 1 from records where records.movement_id = item.movement_id),
        'best_set', (select jsonb_build_object('load_kg', best.load_kg, 'reps', best.achieved_reps)
                     from best where best.session_exercise_id = item.id),
        'sets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'set_order', work.set_order,
            'kind', work.kind,
            'load_value', sets.load_value,
            'load_unit_code', sets.load_unit_code,
            'achieved_reps', work.achieved_reps,
            'rpe', sets.rpe,
            -- The best set, when it is also the best ever: a record a set can hold.
            'best_ever', exists (
              select 1 from best
              join records on records.movement_id = best.movement_id
                          and records.kind in ('heaviest', 'e1rm', 'best_set')
              where best.id = work.id)) order by work.set_order)
          from work join execution.strength_sets as sets on sets.id = work.id
          where work.session_exercise_id = item.id), '[]'::jsonb))
        order by item.position)
      from execution.session_exercises as item
      left join catalog.movements as movement on movement.id = item.movement_id
      where item.executed_session_id = target.id), '[]'::jsonb))
  into result;

  return result;
end
$function$;

-- ———————————————————————————————————————— «last time» leaves annulled sessions out

CREATE OR REPLACE FUNCTION execution.read_execution(p_person_id uuid, p_executed_session_id uuid)
 RETURNS TABLE(executed_session_id uuid, execution_status text, started_at timestamp with time zone, revision_number bigint, title text, discipline_code text, program_title text, week integer, planned jsonb, results jsonb, exercises jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select executed.id,
         executed.execution_status::text,
         executed.started_at,
         executed.revision_number,
         template_version.title,
         template_version.discipline_code,
         version.title,
         -- Derived, not stored: the same number in two places is one of them wrong.
         case when assignment.id is null then null
              else ((session.scheduled_at at time zone session.timezone)::date
                    - assignment.starts_on) / 7 + 1 end,
         coalesce(planned.steps, '[]'::jsonb),
         coalesce(recorded.sets, '[]'::jsonb),
         coalesce(listed.items, '[]'::jsonb)
  from execution.executed_sessions as executed
  left join execution.planned_session_executions as attempt
    on attempt.executed_session_id = executed.id
  left join planning.planned_sessions as session on session.id = attempt.planned_session_id
  left join planning.program_assignments as assignment on assignment.id = session.assignment_id
  left join planning.program_versions as version on version.id = assignment.program_version_id
  left join planning.session_template_versions as template_version
    on template_version.id = session.template_version_id
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.position) as steps
    from (
      select step.position as position,
             movement.id as movement_id,
             movement.name as movement,
             coalesce(strength.target, endurance.target, interval_step.target, mobility.target) as target,
             coalesce(last_time.sets, '[]'::jsonb) as previous,
             coalesce(prescribed.sets, '[]'::jsonb) as sets
      from planning.planned_steps as step
      left join catalog.movements as movement on movement.id = step.movement_id
      left join lateral (
        select jsonb_build_object('family', 'strength', 'target_sets', target.target_sets,
          'target_reps', target.target_reps, 'target_rpe', target.target_rpe) as target
        from planning.strength_targets as target where target.planned_step_id = step.id
      ) as strength on true
      left join lateral (
        select jsonb_build_object('family', 'endurance',
          'target_distance_value', target.target_distance_value,
          'target_distance_unit_code', target.target_distance_unit_code,
          'target_duration_seconds', target.target_duration_seconds) as target
        from planning.endurance_targets as target where target.planned_step_id = step.id
      ) as endurance on true
      left join lateral (
        select jsonb_build_object('family', 'interval', 'rounds', target.rounds,
          'work_duration_seconds', target.work_duration_seconds,
          'rest_duration_seconds', target.rest_duration_seconds) as target
        from planning.interval_targets as target where target.planned_step_id = step.id
      ) as interval_step on true
      left join lateral (
        select jsonb_build_object('family', 'mobility',
          'hold_duration_seconds', target.hold_duration_seconds,
          'target_repetitions', target.target_repetitions) as target
        from planning.mobility_targets as target where target.planned_step_id = step.id
      ) as mobility on true
      -- What this movement weighed last time. The column exists so nobody has to
      -- remember the number they hit a week ago, which is the whole point of a log.
      left join lateral (
        select jsonb_agg(jsonb_build_object(
                 'load_value', done.load_value,
                 'achieved_reps', done.achieved_reps) order by done.set_order) as sets
        from execution.strength_sets as done
        where done.movement_id = movement.id
          and done.executed_session_id = (
            select earlier.id
            from execution.executed_sessions as earlier
            join execution.strength_sets as earlier_set
              on earlier_set.executed_session_id = earlier.id
             and earlier_set.movement_id = movement.id
            where earlier.person_id = executed.person_id
              and earlier.id <> executed.id
              and earlier.execution_status = 'completed'
              and earlier.annulled_at is null
            order by earlier.started_at desc
            limit 1
          )
      ) as last_time on true
      -- The sets the routine asked for, so the session opens each row with its kind.
      -- Empty for a step published before sets existed; the client falls back then.
      left join lateral (
        select jsonb_agg(jsonb_build_object(
                 'set_order', prescribed_set.set_order,
                 'kind', prescribed_set.kind,
                 'target_reps', prescribed_set.target_reps,
                 'target_load_value', prescribed_set.target_load_value,
                 'target_load_unit_code', prescribed_set.target_load_unit_code)
               order by prescribed_set.set_order) as sets
        from planning.planned_sets as prescribed_set
        where prescribed_set.planned_step_id = step.id
      ) as prescribed on true
      where step.template_version_id = template_version.id
    ) as entry
  ) as planned on true
  -- The session's own list, in its order: what was trained, not what was planned.
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.position) as items
    from (
      select item.position as position,
             movement.id as movement_id,
             movement.name as movement,
             item.planned_step_id as planned_step_id,
             item.superset_group as superset_group,
             item.rest_seconds as rest_seconds,
             coalesce(strength.target, endurance.target, interval_step.target, mobility.target) as target,
             coalesce(last_time.sets, '[]'::jsonb) as previous,
             coalesce(prescribed.sets, '[]'::jsonb) as sets
      from execution.session_exercises as item
      left join planning.planned_steps as step on step.id = item.planned_step_id
      left join catalog.movements as movement on movement.id = item.movement_id
      left join lateral (
        select jsonb_build_object('family', 'strength', 'target_sets', target.target_sets,
          'target_reps', target.target_reps, 'target_rpe', target.target_rpe) as target
        from planning.strength_targets as target where target.planned_step_id = step.id
      ) as strength on true
      left join lateral (
        select jsonb_build_object('family', 'endurance',
          'target_distance_value', target.target_distance_value,
          'target_distance_unit_code', target.target_distance_unit_code,
          'target_duration_seconds', target.target_duration_seconds) as target
        from planning.endurance_targets as target where target.planned_step_id = step.id
      ) as endurance on true
      left join lateral (
        select jsonb_build_object('family', 'interval', 'rounds', target.rounds,
          'work_duration_seconds', target.work_duration_seconds,
          'rest_duration_seconds', target.rest_duration_seconds) as target
        from planning.interval_targets as target where target.planned_step_id = step.id
      ) as interval_step on true
      left join lateral (
        select jsonb_build_object('family', 'mobility',
          'hold_duration_seconds', target.hold_duration_seconds,
          'target_repetitions', target.target_repetitions) as target
        from planning.mobility_targets as target where target.planned_step_id = step.id
      ) as mobility on true
      left join lateral (
        select jsonb_agg(jsonb_build_object(
                 'load_value', done.load_value,
                 'achieved_reps', done.achieved_reps) order by done.set_order) as sets
        from execution.strength_sets as done
        where done.movement_id = movement.id
          and done.executed_session_id = (
            select earlier.id
            from execution.executed_sessions as earlier
            join execution.strength_sets as earlier_set
              on earlier_set.executed_session_id = earlier.id
             and earlier_set.movement_id = movement.id
            where earlier.person_id = executed.person_id
              and earlier.id <> executed.id
              and earlier.execution_status = 'completed'
              and earlier.annulled_at is null
            order by earlier.started_at desc
            limit 1
          )
      ) as last_time on true
      left join lateral (
        select jsonb_agg(jsonb_build_object(
                 'set_order', prescribed_set.set_order,
                 'kind', prescribed_set.kind,
                 'target_reps', prescribed_set.target_reps,
                 'target_load_value', prescribed_set.target_load_value,
                 'target_load_unit_code', prescribed_set.target_load_unit_code)
               order by prescribed_set.set_order) as sets
        from planning.planned_sets as prescribed_set
        where prescribed_set.planned_step_id = step.id
      ) as prescribed on true
      where item.executed_session_id = executed.id
    ) as entry
  ) as listed on true
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.set_order) as sets
    from (
      select 'strength' as family,
             sets.set_order as set_order,
             sets.movement_id as movement_id,
             sets.achieved_reps as achieved_reps,
             sets.load_value as load_value,
             sets.load_unit_code as load_unit_code,
             sets.rpe as rpe,
             sets.kind as kind,
             owner.position as exercise_position
      from execution.strength_sets as sets
      left join execution.session_exercises as owner on owner.id = sets.session_exercise_id
      where sets.executed_session_id = executed.id
    ) as entry
  ) as recorded on true
  where executed.id = p_executed_session_id
    and executed.person_id = p_person_id
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

alter function execution.revise_execution(uuid, uuid, bigint, jsonb, jsonb, timestamp with time zone, timestamp with time zone, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function execution.revise_execution(uuid, uuid, bigint, jsonb, jsonb, timestamp with time zone, timestamp with time zone, uuid, uuid, bytea) from public;
grant execute on function execution.revise_execution(uuid, uuid, bigint, jsonb, jsonb, timestamp with time zone, timestamp with time zone, uuid, uuid, bytea) to allfit_api;

alter function execution.annul_execution(uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function execution.annul_execution(uuid, uuid, text, uuid, uuid, bytea) from public;
grant execute on function execution.annul_execution(uuid, uuid, text, uuid, uuid, bytea) to allfit_api;

alter function execution.read_annulment_preview(uuid, uuid, text, date) owner to allfit_owner;
revoke all on function execution.read_annulment_preview(uuid, uuid, text, date) from public;
grant execute on function execution.read_annulment_preview(uuid, uuid, text, date) to allfit_api;

alter function execution.repeat_execution(uuid, uuid, timestamp with time zone, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function execution.repeat_execution(uuid, uuid, timestamp with time zone, text, uuid, uuid, bytea) from public;
grant execute on function execution.repeat_execution(uuid, uuid, timestamp with time zone, text, uuid, uuid, bytea) to allfit_api;

alter function execution.read_finished_execution(uuid, uuid, text) owner to allfit_owner;
revoke all on function execution.read_finished_execution(uuid, uuid, text) from public;
grant execute on function execution.read_finished_execution(uuid, uuid, text) to allfit_api;

alter function execution.replace_execution_results(uuid, uuid, bigint, jsonb, uuid, uuid, bytea, jsonb) owner to allfit_owner;
alter function execution.read_execution(uuid, uuid) owner to allfit_owner;

commit;
