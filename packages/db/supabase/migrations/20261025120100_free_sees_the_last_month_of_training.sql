-- DT-018 and HU-SP-086 — the free plan sees the last month of its training.
--
-- `training_history_months` sets where the person's visible history starts. The four
-- reads of past training in Space (the list, the month, a finished session and its
-- summary) leave out what started before it; opening an older session says Pro shows it
-- again (AF402) instead of pretending it does not exist. Nothing is deleted.
--
-- What stays whole on purpose: records and «the last time» keep comparing against all
-- of the history, because the reference to the last time is free and a record counted
-- against one month would be false. The streak counts weeks, not sessions shown.
--
-- Bodies are the ones in force (20261002120000 and 20261003120000) with the window added.

set lock_timeout = '5s';
set statement_timeout = '60s';

CREATE OR REPLACE FUNCTION execution.list_my_executions(p_person_id uuid, p_timezone text, p_month date, p_discipline text, p_with_record boolean, p_free boolean, p_query text, p_cursor text, p_limit integer, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  folded text := execution.fold_text(p_query);
  start record;
  result jsonb;
  cutoff timestamptz := payments.history_cutoff(p_person_id, 'training_history_months', p_timezone);
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return jsonb_build_object('data', '[]'::jsonb,
      'page', jsonb_build_object('next_cursor', null, 'has_more', false));
  end if;

  select * into start from execution.history_cursor_parts(p_cursor);

  with
  finished as (
    select executed.id, executed.started_at, executed.ended_at, activity.discipline_code,
           version.title,
           attempt.executed_session_id is null as is_free
    from execution.executed_sessions as executed
    join catalog.activity_types as activity on activity.id = executed.activity_type_id
    left join execution.planned_session_executions as attempt
      on attempt.executed_session_id = executed.id
    left join planning.planned_sessions as planned on planned.id = attempt.planned_session_id
    left join planning.session_template_versions as version on version.id = planned.template_version_id
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
      and executed.ended_at is not null
      and (cutoff is null or executed.started_at >= cutoff)
      and (p_month is null
           or date_trunc('month', executed.started_at at time zone p_timezone)::date
              = date_trunc('month', p_month)::date)
      and (p_day is null or (executed.started_at at time zone p_timezone)::date = p_day)
      and (p_discipline is null or activity.discipline_code = p_discipline)
      and (p_free is null or (attempt.executed_session_id is null) = p_free)
      and (start.sort_id is null
           or (executed.started_at, executed.id) < (start.sort_started, start.sort_id))
  ),
  matched as (
    select finished.*,
           (select count(*)::integer
            from execution.session_records(p_person_id, finished.id)) as record_count
    from finished
    where folded = ''
       or execution.fold_text(finished.title) like '%' || folded || '%'
       or exists (
         select 1
         from execution.session_exercises as item
         join catalog.movements as movement on movement.id = item.movement_id
         where item.executed_session_id = finished.id
           and execution.fold_text(movement.name) like '%' || folded || '%')
  ),
  chosen as (
    select * from matched
    where p_with_record is null or (matched.record_count > 0) = p_with_record
    order by matched.started_at desc, matched.id desc
    limit size + 1
  ),
  page as (
    select * from chosen order by chosen.started_at desc, chosen.id desc limit size
  ),
  rows as (
    select page.*,
           (select count(*)::integer from execution.strength_sets as sets
            where sets.executed_session_id = page.id and sets.kind <> 'warmup') as work_sets,
           -- Nothing weighed is not zero lifted.
           (select sum(sets.load_value * unit.to_canonical_factor * sets.achieved_reps)
            from execution.strength_sets as sets
            left join catalog.units as unit
              on unit.code = sets.load_unit_code and unit.dimension = 'mass'
            where sets.executed_session_id = page.id and sets.kind <> 'warmup') as total_volume_kg,
           -- The routine's cover, the same photograph Hoy and the share card show.
           execution.session_cover(p_person_id, page.id) as thumbnail_object_key
    from page
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(jsonb_build_object(
        'executed_session_id', rows.id,
        'status', 'completed',
        'started_at', rows.started_at,
        'trained_on', (rows.started_at at time zone p_timezone)::date,
        'title', rows.title,
        'is_free', rows.is_free,
        'discipline_code', rows.discipline_code,
        'duration_seconds', extract(epoch from (rows.ended_at - rows.started_at))::integer,
        'work_sets', rows.work_sets,
        'total_volume_kg', round(rows.total_volume_kg, 2),
        'record_count', rows.record_count,
        'thumbnail_object_key', rows.thumbnail_object_key)
        order by rows.started_at desc, rows.id desc) from rows), '[]'::jsonb),
    -- Where the visible history starts, and whether anything older is kept behind it.
    'window', jsonb_build_object(
      'visible_from', (cutoff at time zone p_timezone)::date,
      'has_hidden', cutoff is not null and exists (
        select 1 from execution.executed_sessions as older
        where older.person_id = p_person_id and older.execution_status = 'completed'
          and older.annulled_at is null and older.started_at < cutoff)),
    'page', jsonb_build_object(
      'next_cursor', (
        select execution.history_cursor(last.started_at, last.id)
        from (select page.started_at, page.id from page
              order by page.started_at asc, page.id asc limit 1) as last
        where (select count(*) from chosen) > size),
      'has_more', (select count(*) from chosen) > size))
  into result;

  return result;
end
$function$;

CREATE OR REPLACE FUNCTION execution.read_history_month(p_person_id uuid, p_timezone text, p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  first_day date := date_trunc('month', p_month)::date;
  last_day date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  result jsonb;
  cutoff timestamptz := payments.history_cutoff(p_person_id, 'training_history_months', p_timezone);
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return jsonb_build_object('month', first_day, 'sessions', 0, 'trained_seconds', 0,
      'work_sets', 0, 'total_volume_kg', null, 'records', 0, 'weeks', '[]'::jsonb,
      'days', '[]'::jsonb, 'months_available', '[]'::jsonb, 'disciplines', '[]'::jsonb);
  end if;

  with
  finished as (
    select executed.id, executed.started_at, executed.ended_at, activity.discipline_code,
           (executed.started_at at time zone p_timezone)::date as trained_on,
           attempt.executed_session_id is null as is_free,
           attempt.planned_session_id
    from execution.executed_sessions as executed
    join catalog.activity_types as activity on activity.id = executed.activity_type_id
    left join execution.planned_session_executions as attempt
      on attempt.executed_session_id = executed.id
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
      and executed.ended_at is not null
      and (cutoff is null or executed.started_at >= cutoff)
  ),
  in_month as (
    select * from finished where finished.trained_on between first_day and last_day
  ),
  sets as (
    select sets.executed_session_id,
           sets.load_value * unit.to_canonical_factor * sets.achieved_reps as volume
    from execution.strength_sets as sets
    join in_month on in_month.id = sets.executed_session_id
    left join catalog.units as unit
      on unit.code = sets.load_unit_code and unit.dimension = 'mass'
    where sets.kind <> 'warmup'
  ),
  -- Every ISO week that touches the month, even one with nothing in it.
  weeks as (
    select generate_series(date_trunc('week', first_day)::date, last_day, interval '7 days')::date as week
  ),
  days as (
    select in_month.trained_on,
           count(*)::integer as sessions,
           sum(extract(epoch from (in_month.ended_at - in_month.started_at)))::integer as trained_seconds,
           coalesce(sum((select count(*) from sets where sets.executed_session_id = in_month.id)), 0)::integer as work_sets,
           (select round(sum(sets.volume), 2) from sets
            join in_month as same on same.id = sets.executed_session_id
            where same.trained_on = in_month.trained_on) as volume_kg,
           coalesce(sum((select count(*) from execution.session_records(p_person_id, in_month.id))), 0)::integer as records
    from in_month
    group by in_month.trained_on
  ),
  -- What was on the calendar and not called off, over whole weeks: a week across two
  -- months says the same from either.
  planned as (
    select session.id,
           date_trunc('week', session.scheduled_at at time zone p_timezone)::date as week
    from planning.planned_sessions as session
    where session.person_id = p_person_id
      and session.status not in ('cancelled', 'paused')
      and (session.scheduled_at at time zone p_timezone)::date
          between date_trunc('week', first_day)::date and last_day + 6
  )
  select jsonb_build_object(
    'month', first_day,
    'visible_from', (cutoff at time zone p_timezone)::date,
    'sessions', (select count(*)::integer from in_month),
    'trained_seconds', coalesce((select sum(extract(epoch from (in_month.ended_at - in_month.started_at)))::integer
                                 from in_month), 0),
    'work_sets', (select count(*)::integer from sets),
    'total_volume_kg', (select round(sum(sets.volume), 2) from sets),
    'records', coalesce((select sum((select count(*) from execution.session_records(p_person_id, in_month.id)))::integer
                         from in_month), 0),
    'weeks', (select jsonb_agg(jsonb_build_object(
                'week_starts_on', weeks.week,
                'completed', (select count(*)::integer from finished
                              where date_trunc('week', finished.trained_on)::date = weeks.week),
                'planned', (select count(*)::integer from planned where planned.week = weeks.week),
                -- Each planned session once, however many times it was done that week.
                'fulfilled', (select count(*)::integer from planned
                              where planned.week = weeks.week
                                and exists (select 1 from finished
                                            where finished.planned_session_id = planned.id
                                              and date_trunc('week', finished.trained_on)::date = weeks.week)))
                order by weeks.week) from weeks),
    -- The month card's calendar: only the days something was finished on.
    'days', coalesce((select jsonb_agg(to_jsonb(days) order by days.trained_on) from days), '[]'::jsonb),
    'months_available', coalesce((select jsonb_agg(month order by month desc)
                                   from (select distinct date_trunc('month', finished.trained_on)::date as month
                                         from finished) as months), '[]'::jsonb),
    -- With the catalogue's name, so the filter says «Fuerza» without the app keeping a copy.
    'disciplines', coalesce((select jsonb_agg(jsonb_build_object('code', discipline.code,
                                                                 'name', discipline.name)
                                              order by discipline.code)
                             from catalog.disciplines as discipline
                             where discipline.code in (select in_month.discipline_code from in_month)),
                            '[]'::jsonb))
  into result;

  return result;
end
$function$;

CREATE OR REPLACE FUNCTION execution.read_finished_execution(p_person_id uuid, p_executed_session_id uuid, p_timezone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target record;
  previous record;
  volume numeric;
  result jsonb;
  cutoff timestamptz := payments.history_cutoff(p_person_id, 'training_history_months', p_timezone);
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
  if cutoff is not null and target.started_at < cutoff then
    raise exception 'Pro shows this session again' using errcode = 'AF402',
      detail = 'training_history_months';
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

CREATE OR REPLACE FUNCTION execution.read_execution_summary(p_person_id uuid, p_executed_session_id uuid, p_timezone text)
 RETURNS TABLE(executed_session_id uuid, started_at timestamp with time zone, ended_at timestamp with time zone, duration_seconds numeric, title text, work_sets integer, exercise_count integer, total_volume_kg numeric, exercises jsonb, records jsonb, streak_weeks integer, session_number integer, given_name text, username text, cover_object_key text, algorithm_version integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target record;
  cutoff timestamptz := payments.history_cutoff(p_person_id, 'training_history_months', p_timezone);
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
  if cutoff is not null and target.started_at < cutoff then
    raise exception 'Pro shows this session again' using errcode = 'AF402',
      detail = 'training_history_months';
  end if;

  return query
  with
  here as (
    select sets.session_exercise_id,
           sets.movement_id,
           sets.achieved_reps as reps,
           sets.load_value * unit.to_canonical_factor as load_kg
    from execution.strength_sets as sets
    left join catalog.units as unit
      on unit.code = sets.load_unit_code and unit.dimension = 'mass'
    where sets.executed_session_id = target.id
      and sets.kind <> 'warmup'
  ),
  beaten as (
    select * from execution.session_records(p_person_id, target.id)
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
           count(here.session_exercise_id)::integer as work_sets,
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
         execution.session_cover(p_person_id, target.id),
         1
  from identity.people as person
  where person.id = p_person_id;
end
$function$;
