-- What the two screens read.
--
-- `Hoy` and `Sesión en curso` are the first screens that need facts from three
-- domains at once — what is scheduled, what has been trained, what somebody weighs —
-- so each domain answers for its own and the API composes. A single reader spanning
-- all three would put planning in the business of reading body measurements.
--
-- **Calories are absent and that is deliberate.** The canvas shows them beside the
-- hours trained and the body weight; those two are derivable and the third is
-- nutrition, which has no tables. A number invented here would be a number somebody
-- trusts.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- Today's session, and whether one is already open on it.
create function planning.read_today_session(p_person_id uuid, p_timezone text)
returns table (
  planned_session_id uuid,
  assignment_id uuid,
  program_title text,
  session_title text,
  discipline_code text,
  scheduled_on date,
  status text,
  exercise_count integer,
  executed_session_id uuid,
  execution_status text
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select session.id,
         session.assignment_id,
         version.title,
         template_version.title,
         template_version.discipline_code,
         (session.scheduled_at at time zone session.timezone)::date,
         session.status,
         (select count(*)::integer from planning.planned_steps as step
           where step.template_version_id = session.template_version_id),
         open_attempt.executed_session_id,
         open_attempt.execution_status::text
  from planning.planned_sessions as session
  join planning.program_assignments as assignment on assignment.id = session.assignment_id
  join planning.program_versions as version on version.id = assignment.program_version_id
  join planning.session_template_versions as template_version
    on template_version.id = session.template_version_id
  left join lateral (
    select attempt.executed_session_id, executed.execution_status
    from execution.planned_session_executions as attempt
    join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
    where attempt.planned_session_id = session.id
      and executed.execution_status = 'in_progress'
    order by attempt.attempt_number desc
    limit 1
  ) as open_attempt on true
  where session.person_id = p_person_id
    and (session.scheduled_at at time zone session.timezone)::date
        = (clock_timestamp() at time zone p_timezone)::date
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by session.scheduled_at
  limit 1
$function$;

-- The week the screen draws, and what it can honestly say about it.
create function execution.read_week_summary(p_person_id uuid, p_timezone text)
returns table (
  trained_seconds numeric,
  sessions_completed integer,
  latest_weight_value numeric,
  latest_weight_unit text,
  history jsonb
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select coalesce(week.seconds, 0),
         coalesce(week.sessions, 0),
         weight.value_numeric,
         weight.unit_code,
         coalesce(recent.history, '[]'::jsonb)
  from (select 1) as anchor
  left join lateral (
    select sum(extract(epoch from (executed.ended_at - executed.started_at))) as seconds,
           count(*)::integer as sessions
    from execution.executed_sessions as executed
    where executed.person_id = p_person_id
      and executed.execution_status = 'completed'
      and executed.ended_at is not null
      -- The seven days ending today, in the person's zone: a calendar week would
      -- reset the number on a Monday nobody trained differently.
      and (executed.started_at at time zone p_timezone)::date
          > (clock_timestamp() at time zone p_timezone)::date - 7
  ) as week on true
  left join lateral (
    select record.value_numeric, record.unit_code
    from identity.body_progress_records as record
    where record.person_id = p_person_id and record.metric_code = 'body_weight'
    order by record.measured_on desc, record.id desc
    limit 1
  ) as weight on true
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

-- One session as `X-1` needs it: what was planned, and what has been recorded.
create function execution.read_execution(p_person_id uuid, p_executed_session_id uuid)
returns table (
  executed_session_id uuid,
  execution_status text,
  started_at timestamptz,
  revision_number bigint,
  title text,
  discipline_code text,
  program_title text,
  week integer,
  planned jsonb,
  results jsonb
)
language sql
security definer
set search_path = pg_catalog
as $function$
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
             coalesce(last_time.sets, '[]'::jsonb) as previous
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
             sets.rpe as rpe
      from execution.strength_sets as sets
      where sets.executed_session_id = executed.id
    ) as entry
  ) as recorded on true
  where executed.id = p_executed_session_id
    and executed.person_id = p_person_id
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

do $$
declare
  routine text;
begin
  foreach routine in array array[
    'planning.read_today_session(uuid, text)',
    'execution.read_week_summary(uuid, text)',
    'execution.read_execution(uuid, uuid)'
  ] loop
    execute format('alter function %s owner to allfit_owner', routine);
    execute format('revoke all on function %s from public', routine);
    execute format('grant execute on function %s to allfit_api', routine);
  end loop;
end
$$;

commit;
