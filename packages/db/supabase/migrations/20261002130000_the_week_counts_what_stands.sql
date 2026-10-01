-- The week counts what was finished and stands.
--
-- `read_week_summary` gains the week's **work sets**: Hoy was adding up the sets of the
-- last three sessions of all time and calling it the week. And an annulled session no
-- longer adds time to the week nor shows in its recent history, as it already did not
-- add to the tonnage. The return type grows a column, so the function is recreated.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

drop function execution.read_week_summary(uuid, text);

create function execution.read_week_summary(p_person_id uuid, p_timezone text)
 RETURNS TABLE(trained_seconds numeric, sessions_completed integer, sessions_planned integer, tonnage_kg numeric, history jsonb, work_sets integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(week.seconds, 0),
         coalesce(plan.done, 0),
         coalesce(plan.planned, 0),
         lifted.tonnage,
         coalesce(recent.history, '[]'::jsonb),
         coalesce(lifted.work_sets, 0)
  from (select 1) as anchor
  left join lateral (
    select sum(extract(epoch from (executed.ended_at - executed.started_at))) as seconds
    from execution.executed_sessions as executed
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.annulled_at is null
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
    end as tonnage,
    count(*)::integer as work_sets
    from execution.executed_sessions as executed
    join execution.strength_sets as recorded
      on recorded.executed_session_id = executed.id and recorded.kind <> 'warmup'
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
               where sets.executed_session_id = executed.id
                 and sets.kind <> 'warmup')::integer as sets_recorded
      from execution.executed_sessions as executed
      left join execution.planned_session_executions as attempt
        on attempt.executed_session_id = executed.id
      left join planning.planned_sessions as session on session.id = attempt.planned_session_id
      left join planning.session_template_versions as template_version
        on template_version.id = session.template_version_id
      where executed.person_id = p_person_id and executed.execution_status = 'completed'
        and executed.annulled_at is null
      order by executed.started_at desc
      limit 3
    ) as entry
  ) as recent on true
  where access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

alter function execution.read_week_summary(uuid, text) owner to allfit_owner;
revoke all on function execution.read_week_summary(uuid, text) from public;
grant execute on function execution.read_week_summary(uuid, text) to allfit_api;

commit;
