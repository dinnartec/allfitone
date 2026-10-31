-- DT-018 and HU-SP-061 — comparing periods, and recognising meals by photo, with Pro.
--
-- OP-EXE-026 reads the person's training week by week or month by month: what was
-- trained, the time, the work sets, the volume and how much of the plan was kept, and,
-- for each movement, its best load against the previous period it was trained in. It
-- needs `period_analysis`. Warm-up sets never count and nothing weighed is not zero.
--
-- Each period also says how its work sets fall across the muscles, its volume day by
-- day, and each movement its best in every period, which is what the progress screen
-- draws. A set belongs to one muscle, the movement's primary: the rule a routine's own
-- count already follows.
--
-- `p_program` reads one programme (an assignment id) or `free` (sessions with no plan
-- behind them); null reads everything. Whatever is chosen, `programs` lists every
-- programme with sessions in the window, so the screen can offer the choice.
--
-- Recognising a meal by photo runs outside the database, in the API. Before it sends
-- anything to the model it asks here, so the limit lives with the others:
-- `meal_photo_recognition`. Recording a meal by hand stays free.

set lock_timeout = '5s';
set statement_timeout = '60s';

create function execution.compare_my_periods(
  p_person_id uuid, p_timezone text, p_period text, p_count integer, p_program text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  step interval;
  current_start date;
  first_start date;
  result jsonb;
  chosen uuid;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'periods are read only by their own person' using errcode = '42501';
  end if;
  if p_period not in ('week', 'month') or p_count is null or p_count not between 2 and 12 then
    raise exception 'periods are 2 to 12 weeks or months' using errcode = '22023';
  end if;
  perform payments.require_feature(p_person_id, 'period_analysis');
  if p_program is not null and p_program <> 'free' then
    chosen := p_program::uuid;
  end if;

  step := case p_period when 'week' then interval '1 week' else interval '1 month' end;
  current_start := date_trunc(p_period, clock_timestamp() at time zone p_timezone)::date;
  first_start := (current_start - step * (p_count - 1))::date;

  with
  periods as (
    select series.index, (current_start - step * (p_count - 1 - series.index))::date as starts_on
    from generate_series(0, p_count - 1) as series(index)
  ),
  bounded as (
    select periods.index, periods.starts_on, (periods.starts_on + step)::date as ends_before
    from periods
  ),
  finished as (
    select executed.id, executed.started_at, executed.ended_at,
           (executed.started_at at time zone p_timezone)::date as trained_on,
           attempt.planned_session_id
    from execution.executed_sessions as executed
    left join execution.planned_session_executions as attempt on attempt.executed_session_id = executed.id
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
      and executed.ended_at is not null
      and (executed.started_at at time zone p_timezone)::date >= first_start
      and (
        p_program is null
        or (p_program = 'free' and attempt.planned_session_id is null)
        or exists (
          select 1 from planning.planned_sessions as owner
          where owner.id = attempt.planned_session_id and owner.assignment_id = chosen
        )
      )
  ),
  -- Sessions with no plan behind them, never filtered: the choice «Libres» depends on it.
  unplanned as (
    select (executed.started_at at time zone p_timezone)::date as trained_on
    from execution.executed_sessions as executed
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
      and executed.ended_at is not null
      and (executed.started_at at time zone p_timezone)::date >= first_start
      and not exists (
        select 1 from execution.planned_session_executions as attempt
        where attempt.executed_session_id = executed.id
      )
  ),
  work as (
    select finished.id, finished.trained_on, sets.movement_id,
           sets.load_value * unit.to_canonical_factor as load_kg, sets.achieved_reps
    from finished
    join execution.strength_sets as sets on sets.executed_session_id = finished.id
    left join catalog.units as unit on unit.code = sets.load_unit_code and unit.dimension = 'mass'
    where sets.kind <> 'warmup'
  ),
  -- The primary muscle, and the lowest display order when a movement has more than one.
  loading as (
    select distinct on (link.movement_id) link.movement_id, muscle.code, muscle.name
    from catalog.movement_muscles as link
    join catalog.muscles as muscle on muscle.id = link.muscle_id
    where muscle.status = 'published'
      and link.movement_id in (select work.movement_id from work)
    order by link.movement_id, link.is_primary desc, muscle.display_order
  ),
  -- Every programme with sessions in the window, planned and kept per period.
  programmes as (
    select assignment.id, assignment.display_order, version.title,
           assignment.origin_relationship_id is not null as from_gym
    from planning.program_assignments as assignment
    join planning.program_versions as version on version.id = assignment.program_version_id
    where assignment.person_id = p_person_id
      and exists (
        select 1 from planning.planned_sessions as session
        where session.assignment_id = assignment.id
          and session.status not in ('cancelled', 'paused')
          and (session.scheduled_at at time zone p_timezone)::date >= first_start
      )
  ),
  muscles as (
    select bounded.index, loading.code, loading.name, count(*)::integer as sets
    from work
    join bounded on work.trained_on >= bounded.starts_on and work.trained_on < bounded.ends_before
    join loading on loading.movement_id = work.movement_id
    group by bounded.index, loading.code, loading.name
  ),
  per_period as (
    select bounded.index, bounded.starts_on,
           (select count(*)::integer from finished
            where finished.trained_on >= bounded.starts_on and finished.trained_on < bounded.ends_before) as sessions,
           (select count(distinct finished.trained_on)::integer from finished
            where finished.trained_on >= bounded.starts_on and finished.trained_on < bounded.ends_before) as active_days,
           coalesce((select sum(extract(epoch from (finished.ended_at - finished.started_at)))::integer from finished
                     where finished.trained_on >= bounded.starts_on and finished.trained_on < bounded.ends_before), 0)
             as trained_seconds,
           (select count(*)::integer from work
            where work.trained_on >= bounded.starts_on and work.trained_on < bounded.ends_before) as work_sets,
           (select round(sum(work.load_kg * work.achieved_reps), 2) from work
            where work.trained_on >= bounded.starts_on and work.trained_on < bounded.ends_before) as volume_kg,
           (select count(*)::integer from planning.planned_sessions as session
            where session.person_id = p_person_id
              and p_program is distinct from 'free'
              and (chosen is null or session.assignment_id = chosen)
              and session.status not in ('cancelled', 'paused')
              and (session.scheduled_at at time zone p_timezone)::date >= bounded.starts_on
              and (session.scheduled_at at time zone p_timezone)::date < bounded.ends_before) as planned,
           (select count(distinct finished.planned_session_id)::integer from finished
            join planning.planned_sessions as session on session.id = finished.planned_session_id
            where (session.scheduled_at at time zone p_timezone)::date >= bounded.starts_on
              and (session.scheduled_at at time zone p_timezone)::date < bounded.ends_before) as fulfilled
    from bounded
  ),
  best as (
    select work.movement_id, bounded.index, max(work.load_kg) as best_kg
    from work
    join bounded on work.trained_on >= bounded.starts_on and work.trained_on < bounded.ends_before
    where work.load_kg is not null and work.achieved_reps > 0
    group by work.movement_id, bounded.index
  ),
  -- Each movement's latest period, against the last period before it in which it was trained.
  compared as (
    select latest.movement_id, latest.best_kg,
           (select earlier.best_kg from best as earlier
            where earlier.movement_id = latest.movement_id and earlier.index < latest.index
            order by earlier.index desc limit 1) as previous_best_kg
    from best as latest
    where latest.index = (select max(other.index) from best as other where other.movement_id = latest.movement_id)
  )
  select jsonb_build_object(
    'period', p_period,
    'periods', (select jsonb_agg(jsonb_build_object(
        'starts_on', per_period.starts_on,
        'sessions', per_period.sessions,
        'active_days', per_period.active_days,
        'trained_seconds', per_period.trained_seconds,
        'work_sets', per_period.work_sets,
        'volume_kg', per_period.volume_kg,
        'planned', per_period.planned,
        'fulfilled', per_period.fulfilled,
        'unplanned', (select count(*)::integer from unplanned
          where unplanned.trained_on >= per_period.starts_on
            and unplanned.trained_on < (select bounded.ends_before from bounded
                                        where bounded.index = per_period.index)),
        'days', coalesce((select jsonb_agg(jsonb_build_object(
            'trained_on', daily.trained_on, 'volume_kg', daily.volume_kg) order by daily.trained_on)
          from (
            select finished.trained_on,
                   (select round(sum(work.load_kg * work.achieved_reps), 2) from work
                    where work.id in (select same.id from finished as same
                                      where same.trained_on = finished.trained_on)) as volume_kg
            from finished
            where finished.trained_on >= per_period.starts_on
              and finished.trained_on < (select bounded.ends_before from bounded
                                         where bounded.index = per_period.index)
            group by finished.trained_on
          ) as daily), '[]'::jsonb),
        'muscles', coalesce((select jsonb_agg(jsonb_build_object(
            'code', muscles.code, 'name', muscles.name, 'sets', muscles.sets)
            order by muscles.sets desc, muscles.name)
          from muscles where muscles.index = per_period.index), '[]'::jsonb))
        order by per_period.index) from per_period),
    'programs', coalesce((select jsonb_agg(jsonb_build_object(
        'assignment_id', programmes.id,
        'title', programmes.title,
        'from_gym', programmes.from_gym,
        'planned', (select jsonb_agg((
            select count(*) from planning.planned_sessions as session
            where session.assignment_id = programmes.id
              and session.status not in ('cancelled', 'paused')
              and (session.scheduled_at at time zone p_timezone)::date >= bounded.starts_on
              and (session.scheduled_at at time zone p_timezone)::date < bounded.ends_before)
            order by bounded.index) from bounded),
        'fulfilled', (select jsonb_agg((
            select count(distinct attempt.planned_session_id)
            from execution.planned_session_executions as attempt
            join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
            join planning.planned_sessions as session on session.id = attempt.planned_session_id
            where session.assignment_id = programmes.id
              and executed.execution_status = 'completed'
              and executed.annulled_at is null
              and (session.scheduled_at at time zone p_timezone)::date >= bounded.starts_on
              and (session.scheduled_at at time zone p_timezone)::date < bounded.ends_before)
            order by bounded.index) from bounded))
        order by programmes.display_order, programmes.title) from programmes), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object(
        'movement_id', compared.movement_id,
        'name', movement.name,
        'best_kg', round(compared.best_kg, 2),
        'previous_best_kg', round(compared.previous_best_kg, 2),
        'change_kg', round(compared.best_kg - compared.previous_best_kg, 2),
        'bests', (select jsonb_agg(round(each_best.best_kg, 2) order by bounded.index)
          from bounded
          left join best as each_best
            on each_best.movement_id = compared.movement_id and each_best.index = bounded.index))
        order by compared.best_kg desc, movement.name)
      from compared
      join catalog.movements as movement on movement.id = compared.movement_id), '[]'::jsonb))
  into result;

  return result;
end
$function$;

-- Asked by the API before a photo goes to the model.
create function nutrition.require_recognition(p_person_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'recognition person does not match the authenticated actor' using errcode = '42501';
  end if;
  perform payments.require_feature(p_person_id, 'meal_photo_recognition');
end
$function$;

alter function execution.compare_my_periods(uuid, text, text, integer, text) owner to allfit_owner;
alter function nutrition.require_recognition(uuid) owner to allfit_owner;
revoke all on function execution.compare_my_periods(uuid, text, text, integer, text) from public;
revoke all on function nutrition.require_recognition(uuid) from public;
grant execute on function execution.compare_my_periods(uuid, text, text, integer, text) to allfit_api;
grant execute on function nutrition.require_recognition(uuid) to allfit_api;
