-- The week's weight is what you lifted, not what you weigh.
--
-- The week block on Hoy summarises **what was done**: minutes training, sets recorded
-- and now kilos lifted. Body weight was standing in that third slot and it does not
-- belong there — it is a measurement of the body, not an act, and it already has a home
-- in body progress (`OP-IDN-015`). Keeping it here made the row read as three facts
-- about the week when one of them was a fact about the person.
--
-- **Replaced, not added.** The screen was its only consumer, so leaving `latest_weight`
-- in the projection would leave a field nobody reads and a second answer to "what does
-- this row mean".
--
-- The load is canonised the same way `planning.read_week_plan` does it for `last_time`:
-- `catalog.units.to_canonical_factor` is the one place the factor lives, so a session
-- logged in pounds and one in kilos add up. A load whose unit does not resolve as a mass
-- makes the whole figure null rather than quietly dropping out of the sum.
--
-- **Null, never zero.** No load recorded is not the same as having moved nothing, and
-- the difference is what the screen needs in order not to lie.

-- Se suelta antes de crearla: PostgreSQL no deja que `create or replace` cambie las
-- columnas que una función devuelve, y aquí `latest_weight_*` deja su sitio al tonelaje.
drop function if exists execution.read_week_summary(uuid, text);

create function execution.read_week_summary(p_person_id uuid, p_timezone text)
returns table (
  trained_seconds numeric,
  sessions_completed integer,
  sessions_planned integer,
  tonnage_kg numeric,
  history jsonb
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select coalesce(week.seconds, 0),
         coalesce(plan.done, 0),
         coalesce(plan.planned, 0),
         lifted.tonnage,
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
    select case
      -- Nada con carga: no es que se moviera cero, es que no se pesó.
      when count(*) filter (
        where recorded.load_value is not null
          and recorded.achieved_reps is not null) = 0 then null
      -- Una unidad que no resuelve como masa anula el total: sumar sólo lo que sí
      -- resuelve daría una cifra más baja que la real.
      when count(*) filter (
        where recorded.load_value is not null
          and unit.to_canonical_factor is null) > 0 then null
      else sum(recorded.achieved_reps * recorded.load_value * unit.to_canonical_factor)
           filter (where recorded.load_value is not null
                     and recorded.achieved_reps is not null)
    end as tonnage
    from execution.executed_sessions as executed
    join execution.strength_sets as recorded on recorded.executed_session_id = executed.id
    left join catalog.units as unit
      on unit.code = recorded.load_unit_code and unit.dimension = 'mass'
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
      and (executed.started_at at time zone p_timezone)::date
          >= date_trunc('week', (clock_timestamp() at time zone p_timezone))::date
  ) as lifted on true
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

comment on function execution.read_week_summary(uuid, text) is
  'The calendar week in progress: minutes trained, sessions closed of those planned, '
  'kilos lifted and the last three sessions. The weight is what was lifted, canonised '
  'by catalog.units; body weight belongs to body progress.';
