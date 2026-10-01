-- The executed set says what kind it was, and a warmup is not work (ADR-033).
--
-- `execution.strength_sets` gains `kind`, typed with `planning.set_kind` rather than a
-- second enum of the same four values, which the physical catalogue forbids. Every
-- existing row reads as `normal`, which is what it was taken to be until now.
--
-- The session is sent the sets its routine asked for, so each row opens with the kind
-- the plan wrote; the person can change it, and what is recorded is what they did. An
-- executed set is still not linked to the planned set that asked for it.
--
-- A warmup is recorded and shown, but it no longer counts towards the tonnage or the
-- sets of «la última vez» and of the week. The plan's own counts do not change here.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table execution.strength_sets
  add column kind planning.set_kind not null default 'normal';

CREATE OR REPLACE FUNCTION execution.replace_execution_results(p_person_id uuid, p_executed_session_id uuid, p_expected_revision bigint, p_results jsonb, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(id uuid, revision_number bigint, result_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  session record;
  entry jsonb;
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

  -- Replaced whole, so there is never a half-applied session.
  delete from execution.strength_sets where executed_session_id = p_executed_session_id;
  delete from execution.endurance_laps where executed_session_id = p_executed_session_id;
  delete from execution.interval_results where executed_session_id = p_executed_session_id;
  delete from execution.round_results where executed_session_id = p_executed_session_id;
  delete from execution.mobility_results where executed_session_id = p_executed_session_id;

  for entry in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    case entry->>'family'
      when 'strength' then
        insert into execution.strength_sets (
          executed_session_id, movement_id, set_order, achieved_reps,
          load_value, load_unit_code, rpe, kind
        ) values (
          p_executed_session_id,
          nullif(entry->>'movement_id', '')::uuid,
          (entry->>'set_order')::integer,
          nullif(entry->>'achieved_reps', '')::integer,
          nullif(entry->>'load_value', '')::numeric,
          nullif(entry->>'load_unit_code', ''),
          nullif(entry->>'rpe', '')::numeric,
          coalesce(nullif(entry->>'kind', ''), 'normal')::planning.set_kind
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

CREATE OR REPLACE FUNCTION execution.read_execution(p_person_id uuid, p_executed_session_id uuid)
 RETURNS TABLE(executed_session_id uuid, execution_status text, started_at timestamp with time zone, revision_number bigint, title text, discipline_code text, program_title text, week integer, planned jsonb, results jsonb)
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
         coalesce(recorded.sets, '[]'::jsonb)
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
             sets.kind as kind
      from execution.strength_sets as sets
      where sets.executed_session_id = executed.id
    ) as entry
  ) as recorded on true
  where executed.id = p_executed_session_id
    and executed.person_id = p_person_id
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

CREATE OR REPLACE FUNCTION planning.read_week_plan(p_person_id uuid, p_timezone text)
 RETURNS TABLE(assignment_id uuid, program_version_id uuid, program_title text, program_week integer, week_starts_on date, sessions jsonb)
 LANGUAGE plpgsql
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
                          where recorded.executed_session_id = executed.id
                            and recorded.kind <> 'warmup'),
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
                            and recorded.kind <> 'warmup'
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

CREATE OR REPLACE FUNCTION execution.read_week_summary(p_person_id uuid, p_timezone text)
 RETURNS TABLE(trained_seconds numeric, sessions_completed integer, sessions_planned integer, tonnage_kg numeric, history jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      order by executed.started_at desc
      limit 3
    ) as entry
  ) as recent on true
  where access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;
