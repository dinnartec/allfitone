-- The close of a session is summarised; records, streak and number are derived (ADR-036).
--
-- «Compártelo» shows what a finished session achieved. Everything it says is read from
-- what is already recorded, never stored a second time:
--
-- - **Records** compare each movement against the person's earlier finished sessions,
--   work sets only. Four kinds: the heaviest load, the best estimated 1RM (Epley), the
--   best single set (load × reps) and the most volume of the movement in one session.
--   A first time is not a record, and equalling the best is not beating it.
-- - **The streak** counts ISO weeks in a row, in the person's timezone, with at least one
--   finished session, back from the week of this one.
-- - **The number** counts every finished session of the person up to this one.
--
-- An abandoned or annulled session counts for none of them. The function is additive: no
-- table changes.

set lock_timeout = '5s';
set statement_timeout = '120s';

create function execution.read_execution_summary(
  p_person_id uuid,
  p_executed_session_id uuid,
  p_timezone text
)
returns table (
  executed_session_id uuid,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration_seconds numeric,
  title text,
  work_sets integer,
  exercise_count integer,
  total_volume_kg numeric,
  exercises jsonb,
  records jsonb,
  streak_weeks integer,
  session_number integer,
  given_name text,
  username text,
  cover_object_key text,
  algorithm_version integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
begin
  -- Absent and someone else's are the same answer: no row.
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return;
  end if;

  select executed.id, executed.execution_status, executed.annulled_at,
         executed.started_at, executed.ended_at
  into target
  from execution.executed_sessions as executed
  where executed.id = p_executed_session_id and executed.person_id = p_person_id;
  if target.id is null then
    return;
  end if;
  if target.execution_status <> 'completed' or target.annulled_at is not null
     or target.ended_at is null then
    raise exception 'execution is not finished' using errcode = '55000';
  end if;

  return query
  with
  -- Every work set the person finished, in kilograms. A unit that is not a mass leaves
  -- the load unknown rather than wrong.
  lifted as (
    select sets.executed_session_id as session_id,
           sets.session_exercise_id,
           sets.movement_id,
           sets.achieved_reps as reps,
           sets.load_value * unit.to_canonical_factor as load_kg,
           executed.started_at as session_started
    from execution.strength_sets as sets
    join execution.executed_sessions as executed on executed.id = sets.executed_session_id
    left join catalog.units as unit
      on unit.code = sets.load_unit_code and unit.dimension = 'mass'
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
      and executed.started_at <= target.started_at
      and sets.kind <> 'warmup'
  ),
  here as (select * from lifted where lifted.session_id = target.id),
  before as (select * from lifted where lifted.session_id <> target.id
                                     and lifted.session_started < target.started_at),
  -- What this session did with each movement.
  now_best as (
    select here.movement_id,
           max(here.load_kg) as heaviest,
           max(here.load_kg * (1 + here.reps / 30.0)) as e1rm,
           max(here.load_kg * here.reps) as best_set,
           sum(here.load_kg * here.reps) as session_volume
    from here
    where here.movement_id is not null
    group by here.movement_id
  ),
  -- The best each earlier session reached, per movement, so the date can be told.
  earlier as (
    select before.movement_id, before.session_id, min(before.session_started) as started,
           max(before.load_kg) as heaviest,
           max(before.load_kg * (1 + before.reps / 30.0)) as e1rm,
           max(before.load_kg * before.reps) as best_set,
           sum(before.load_kg * before.reps) as session_volume
    from before
    where before.movement_id is not null
    group by before.movement_id, before.session_id
  ),
  measured as (
    select now_best.movement_id, kind.name as kind, kind.ord,
           case kind.name
             when 'heaviest' then now_best.heaviest
             when 'e1rm' then now_best.e1rm
             when 'best_set' then now_best.best_set
             else now_best.session_volume end as value,
           prior.value as previous_value,
           prior.started as previous_started
    from now_best
    cross join (values ('heaviest', 1), ('e1rm', 2), ('best_set', 3), ('session_volume', 4))
      as kind(name, ord)
    left join lateral (
      select case kind.name
               when 'heaviest' then earlier.heaviest
               when 'e1rm' then earlier.e1rm
               when 'best_set' then earlier.best_set
               else earlier.session_volume end as value,
             earlier.started
      from earlier
      where earlier.movement_id = now_best.movement_id
      order by 1 desc nulls last, earlier.started desc
      limit 1
    ) as prior on true
  ),
  beaten as (
    select measured.*
    from measured
    -- A first time has nothing to beat, and an equal is not a record.
    where measured.value is not null and measured.previous_value is not null
      and measured.value > measured.previous_value
  ),
  -- The weeks with something finished, back from this session's own week.
  weeks as (
    select distinct date_trunc('week', (executed.started_at at time zone p_timezone))::date as week
    from execution.executed_sessions as executed
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
      and executed.started_at <= target.started_at
  ),
  numbered as (
    select weeks.week, row_number() over (order by weeks.week desc) as rn from weeks
  ),
  listed as (
    select item.position, item.movement_id, movement.name as movement,
           count(here.session_id)::integer as work_sets,
           min(here.reps) as reps_min, max(here.reps) as reps_max
    from execution.session_exercises as item
    left join catalog.movements as movement on movement.id = item.movement_id
    left join here on here.session_exercise_id = item.id
    where item.executed_session_id = target.id
    group by item.position, item.movement_id, movement.name
  ),
  routine as (
    select version.id as version_id, version.template_id, version.title
    from execution.planned_session_executions as attempt
    join planning.planned_sessions as session on session.id = attempt.planned_session_id
    join planning.session_template_versions as version on version.id = session.template_version_id
    where attempt.executed_session_id = target.id
    limit 1
  ),
  -- The region that weighs most, read as Hoy reads it, so the photograph is the same one.
  region as (
    select muscle.region
    from routine
    join planning.planned_steps as step on step.template_version_id = routine.version_id
    join catalog.movement_muscles as link on link.movement_id = step.movement_id
    join catalog.muscles as muscle on muscle.id = link.muscle_id
    where muscle.status = 'published'
    group by muscle.region
    order by count(*) filter (where link.is_primary) desc, count(*) desc, muscle.region
    limit 1
  )
  select target.id,
         target.started_at,
         target.ended_at,
         extract(epoch from (target.ended_at - target.started_at))::numeric,
         (select routine.title from routine),
         (select count(*)::integer from here),
         (select count(*)::integer from listed where listed.work_sets > 0),
         -- Nothing weighed is not zero lifted.
         (select sum(here.load_kg * here.reps) from here),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'position', listed.position,
                     'movement_id', listed.movement_id,
                     'movement', listed.movement,
                     'work_sets', listed.work_sets,
                     'reps_min', listed.reps_min,
                     'reps_max', listed.reps_max) order by listed.position)
                   from listed where listed.work_sets > 0), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'movement_id', beaten.movement_id,
                     'movement', movement.name,
                     'kind', beaten.kind,
                     'value', round(beaten.value, 2),
                     'reps', case when beaten.kind = 'heaviest' then (
                               select max(here.reps) from here
                               where here.movement_id = beaten.movement_id
                                 and here.load_kg = beaten.value) end,
                     'previous_value', round(beaten.previous_value, 2),
                     'previous_on', (beaten.previous_started at time zone p_timezone)::date)
                     order by first_seen.position, beaten.ord)
                   from beaten
                   join catalog.movements as movement on movement.id = beaten.movement_id
                   join lateral (
                     select min(listed.position) as position from listed
                     where listed.movement_id = beaten.movement_id
                   ) as first_seen on true), '[]'::jsonb),
         (select count(*)::integer from numbered
          where numbered.week
                = date_trunc('week', (target.started_at at time zone p_timezone))::date
                  - ((numbered.rn - 1) * 7)::integer),
         (select count(*)::integer
          from execution.executed_sessions as executed
          where executed.person_id = p_person_id
            and executed.execution_status = 'completed'
            and executed.annulled_at is null
            and (executed.started_at < target.started_at
                 or (executed.started_at = target.started_at and executed.id <= target.id))),
         person.given_name,
         person.username::text,
         (select planning.pick_routine_cover(routine.template_id, (select region.region from region), p_person_id)
          from routine),
         1
  from identity.people as person
  where person.id = p_person_id;
end
$function$;

alter function execution.read_execution_summary(uuid, uuid, text) owner to allfit_owner;
revoke all on function execution.read_execution_summary(uuid, uuid, text) from public;
grant execute on function execution.read_execution_summary(uuid, uuid, text) to allfit_api;
