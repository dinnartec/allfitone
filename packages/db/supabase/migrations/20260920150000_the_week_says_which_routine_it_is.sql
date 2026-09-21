-- La semana dice de qué rutina es cada sesión — `AFO-186`.
--
-- Hoy dibuja el carrusel de la semana con la portada que el programa le dio a cada
-- rutina, y esa portada vive en la rutina que responde `OP-PLN-025`
-- (`read_my_content`). La semana la responde `OP-PLN-016` (`read_week_plan`), así que
-- la pantalla tiene que unir las dos respuestas —y hoy no tiene con qué:
-- `planned_session_id`, `title`, `discipline_code`, `status`, `program_day`,
-- `scheduled_at`, las dos cuentas, `done` y `open_execution_id`. Ninguno dice **qué
-- rutina es**.
--
-- **Unir por el título sería unir por una cosa que se repite.** Dos rutinas pueden
-- llamarse «Empuje» y la misma rutina se llama distinto de una versión a otra; una
-- portada colgada del nombre acabaría en la tarjeta equivocada. Lo que la sesión
-- planificada apunta es `template_version_id`, y es eso lo que se responde.
--
-- **Es un campo, no una tabla.** La portada sigue viviendo donde vive y sólo ahí:
-- copiarla dentro de la semana sería una segunda verdad del mismo dato, que envejece
-- por su cuenta. Y no hay consulta nueva: el lateral ya unía
-- `session_template_versions` para sacar el título.
--
-- Lo demás de la lectura no se toca. Sigue sembrando la semana antes de enseñarla,
-- sigue contando ejercicios y series igual, sigue ordenando por `scheduled_at` y sigue
-- siendo del dueño de la asignación y de nadie más.

begin;

set lock_timeout = '5s';
set statement_timeout = '60s';

-- La misma lectura de `20260920120000`, con un campo más en cada entrada.
CREATE OR REPLACE FUNCTION planning.read_week_plan(p_person_id uuid, p_timezone text)
 RETURNS TABLE(assignment_id uuid, program_version_id uuid, program_title text, program_week integer, week_starts_on date, sessions jsonb)
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  limit 1;
end
$function$;

alter function planning.read_week_plan(uuid, text) owner to allfit_owner;
revoke all on function planning.read_week_plan(uuid, text) from public;
grant execute on function planning.read_week_plan(uuid, text) to allfit_api;

commit;
