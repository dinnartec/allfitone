-- The history lists what was finished, and each row is summarised as it is read (ADR-037).
--
-- `OP-EXE-014` lists a person's own executions; `OP-EXE-022` sums up one month of them.
-- Space's first history shows finished sessions only: abandoned attempts, annulled
-- sessions and corrections are deferred, and every row says its `status` so they can be
-- added without breaking the contract.
--
-- **A row counts its records and shows its cover with the summary's own rules.** The
-- records of `ADR-036` and the routine's cover move out of `read_execution_summary` into
-- `execution.session_records` and `execution.session_cover`, which both the summary and
-- the history call, so a row and the card of that session can never disagree.
--
-- **Search folds case and the Spanish accents, on both sides.** `unaccent` is not
-- installed, so the folding is an explicit `translate` of the letters Spanish uses:
-- «tiron» finds «Tirón», and «pres» finds a session with a press in it.
--
-- **Keyset, not offset.** The order is start descending with the identifier as the
-- tie-break, and the opaque cursor carries that exact pair, as `read_movements` does.
--
-- Additive: no table changes.

set lock_timeout = '5s';
set statement_timeout = '120s';

begin;

-- ———————————————————————————————————————— records, in one place

create function execution.session_records(p_person_id uuid, p_executed_session_id uuid)
returns table (
  movement_id uuid,
  kind text,
  ord integer,
  value numeric,
  previous_value numeric,
  previous_started timestamp with time zone
)
language sql
stable
set search_path = pg_catalog
as $function$
  with
  target as (
    select executed.id, executed.started_at
    from execution.executed_sessions as executed
    where executed.id = p_executed_session_id and executed.person_id = p_person_id
  ),
  -- Every work set the person finished, in kilograms. A unit that is not a mass leaves
  -- the load unknown rather than wrong.
  lifted as (
    select sets.executed_session_id as session_id,
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
      and executed.started_at <= (select target.started_at from target)
      and sets.kind <> 'warmup'
  ),
  here as (select * from lifted where lifted.session_id = (select target.id from target)),
  before as (
    select * from lifted
    where lifted.session_id <> (select target.id from target)
      and lifted.session_started < (select target.started_at from target)
  ),
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
  )
  -- A first time has nothing to beat, and an equal is not a record.
  select measured.movement_id, measured.kind, measured.ord, measured.value,
         measured.previous_value, measured.previous_started
  from measured
  where measured.value is not null and measured.previous_value is not null
    and measured.value > measured.previous_value
$function$;

alter function execution.session_records(uuid, uuid) owner to allfit_owner;
revoke all on function execution.session_records(uuid, uuid) from public;

-- ———————————————————————————————————————— the cover, in one place

-- The routine's cover as Hoy picks it, for the session that came from that routine: the
-- region its steps weigh most in, then `pick_routine_cover`. Null for a free session.
create function execution.session_cover(p_person_id uuid, p_executed_session_id uuid)
returns text
language sql
stable
set search_path = pg_catalog
as $function$
  with
  routine as (
    select version.id as version_id, version.template_id
    from execution.planned_session_executions as attempt
    join planning.planned_sessions as session on session.id = attempt.planned_session_id
    join planning.session_template_versions as version on version.id = session.template_version_id
    where attempt.executed_session_id = p_executed_session_id
      and attempt.person_id = p_person_id
    limit 1
  ),
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
  select planning.pick_routine_cover(routine.template_id, (select region.region from region), p_person_id)
  from routine
$function$;

alter function execution.session_cover(uuid, uuid) owner to allfit_owner;
revoke all on function execution.session_cover(uuid, uuid) from public;

-- The summary, unchanged in what it answers, now reading its records and cover from the helpers.
create or replace function execution.read_execution_summary(
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

-- ———————————————————————————————————————— search and cursor

-- Lower case and the letters Spanish accents, folded on both sides of the comparison.
create function execution.fold_text(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select translate(lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g')),
                   'áéíóúüñàèìòù', 'aeiouunaeiou')
$function$;

alter function execution.fold_text(text) owner to allfit_owner;
revoke all on function execution.fold_text(text) from public;

create function execution.history_cursor(p_started_at timestamp with time zone, p_id uuid)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select encode(convert_to(
    to_char(p_started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || chr(31) || p_id::text,
    'UTF8'), 'base64')
$function$;

alter function execution.history_cursor(timestamp with time zone, uuid) owner to allfit_owner;
revoke all on function execution.history_cursor(timestamp with time zone, uuid) from public;

create function execution.history_cursor_parts(p_cursor text)
returns table (sort_started timestamp with time zone, sort_id uuid)
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  parts text[];
begin
  if p_cursor is null or btrim(p_cursor) = '' then
    return;
  end if;
  begin
    parts := string_to_array(convert_from(decode(p_cursor, 'base64'), 'UTF8'), chr(31));
    if array_length(parts, 1) <> 2 then
      raise exception 'invalid cursor';
    end if;
    sort_started := (parts[1] || '+00')::timestamp with time zone;
    sort_id := parts[2]::uuid;
  exception when others then
    raise exception 'invalid cursor' using errcode = '22023';
  end;
  return next;
end;
$function$;

alter function execution.history_cursor_parts(text) owner to allfit_owner;
revoke all on function execution.history_cursor_parts(text) from public;

-- ———————————————————————————————————————— OP-EXE-014

create function execution.list_my_executions(
  p_person_id uuid,
  p_timezone text,
  p_month date,
  p_discipline text,
  p_with_record boolean,
  p_free boolean,
  p_query text,
  p_cursor text,
  p_limit integer,
  -- A day picked on the month's calendar; it narrows further than the month.
  p_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  folded text := execution.fold_text(p_query);
  start record;
  result jsonb;
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

alter function execution.list_my_executions(uuid, text, date, text, boolean, boolean, text, text, integer, date)
  owner to allfit_owner;
revoke all on function execution.list_my_executions(uuid, text, date, text, boolean, boolean, text, text, integer, date)
  from public;
grant execute on function execution.list_my_executions(uuid, text, date, text, boolean, boolean, text, text, integer, date)
  to allfit_api;

-- ———————————————————————————————————————— OP-EXE-022

create function execution.read_history_month(p_person_id uuid, p_timezone text, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  first_day date := date_trunc('month', p_month)::date;
  last_day date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  result jsonb;
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

alter function execution.read_history_month(uuid, text, date) owner to allfit_owner;
revoke all on function execution.read_history_month(uuid, text, date) from public;
grant execute on function execution.read_history_month(uuid, text, date) to allfit_api;

commit;
