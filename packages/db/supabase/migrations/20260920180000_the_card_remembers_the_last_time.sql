-- The card remembers the last time.
--
-- Hoy's card flips, and its reverse tells how the last time went: when it was, how long
-- it lasted, how many sets were recorded and how much load was moved. Nothing answered
-- that before, so `HU-SP-089` forbade drawing it; this is what lifts the ban.
--
-- **It is counted per routine, not per version.** A routine takes a new version every
-- time it is published, so matching the execution by `template_version_id` would erase
-- its past the moment somebody edits it. The join climbs one level, to `template_id`.
--
-- **Only what finished counts.** An annulled session and an attempt still open are both
-- left out: the last time is a time that ended. That mirrors the `done` flag this same
-- function already computes, and it is why the open attempt has its own branch.
--
-- **The database converts the load.** `catalog.units.to_canonical_factor` is the one
-- place the factor lives, exactly as body progress already does it, so a session logged
-- in pounds and one logged in kilos add up instead of being two truths about one number.
-- A load whose unit does not resolve as a mass makes the whole tonnage null rather than
-- quietly dropping out of the sum: under-reporting a total is worse than not giving one.
--
-- **Null, never zero.** A routine nobody trained has no figures, and one that is not
-- strength work has no tonnage. A zero would claim a session in which nothing was moved.
--
-- The read still writes only what it wrote before: `plant_my_open_week`, one week,
-- idempotent. None of this touches that.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function planning.read_week_plan(p_person_id uuid, p_timezone text)
returns table (
  assignment_id uuid,
  program_version_id uuid,
  program_title text,
  program_week integer,
  week_starts_on date,
  sessions jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform planning.plant_my_open_week(p_person_id, p_timezone);
  return query
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
             -- Lo que la sesión apunta, no lo que el lateral unió: son la misma fila.
             session.template_version_id,
             template_version.title as title,
             template_version.discipline_code,
             session.status,
             session.program_day,
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
             ) as open_execution_id,
             -- Por plantilla y no por sesión planificada: la última vez que se hizo
             -- **esta rutina**, la haya pedido el programa el día que la haya pedido.
             (
               select jsonb_build_object(
                        'trained_on',
                        (executed.started_at at time zone trained.timezone)::date,
                        'seconds',
                        case
                          when executed.ended_at is null then null
                          else extract(epoch from executed.ended_at - executed.started_at)::integer
                        end,
                        'sets',
                        (select count(*)::integer
                           from execution.strength_sets as recorded
                          where recorded.executed_session_id = executed.id),
                        'tonnage_kg',
                        (
                          select case
                            -- Nada con carga: no es que pesara cero, es que no se pesa.
                            when count(*) filter (
                              where recorded.load_value is not null
                                and recorded.achieved_reps is not null) = 0 then null
                            -- Una unidad que no resuelve como masa anula el total: sumar
                            -- lo que sí resuelve daría un número más bajo que el real.
                            when count(*) filter (
                              where recorded.load_value is not null
                                and unit.to_canonical_factor is null) > 0 then null
                            else sum(recorded.achieved_reps * recorded.load_value
                                     * unit.to_canonical_factor)
                                 filter (where recorded.load_value is not null
                                           and recorded.achieved_reps is not null)
                          end
                          from execution.strength_sets as recorded
                          left join catalog.units as unit
                            on unit.code = recorded.load_unit_code
                           and unit.dimension = 'mass'
                          where recorded.executed_session_id = executed.id
                        )
                      )
               from execution.planned_session_executions as attempt
               join execution.executed_sessions as executed
                 on executed.id = attempt.executed_session_id
               join planning.planned_sessions as trained
                 on trained.id = attempt.planned_session_id
               join planning.session_template_versions as trained_version
                 on trained_version.id = trained.template_version_id
               where trained_version.template_id = template_version.template_id
                 and trained.person_id = p_person_id
                 and executed.execution_status = 'completed'
                 and executed.annulled_at is null
               order by executed.started_at desc
               limit 1
             ) as last_time
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
  limit 1;
end
$function$;

comment on function planning.read_week_plan(uuid, text) is
  'OP-PLN-016. Plants the open week, then answers it. Each session carries how the last '
  'time went, counted per routine rather than per version so publishing does not erase '
  'the past, and with the load canonised to kilograms by catalog.units.';
