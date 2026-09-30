-- The rest travels with the session (ADR-035).
--
-- Rest between sets was a prescription on the routine only, so the session had nothing
-- to count down from. Each session exercise now carries its own `rest_seconds`, copied
-- from `strength_targets.target_rest_seconds` when the attempt starts and replaced with
-- the list from then on: changing it while training is today's rest, never the plan's.
--
-- Additive: a nullable column with its origin's range, a backfill through the step each
-- exercise came from, and the three functions of ADR-034 redefined with the same
-- signatures.

set lock_timeout = '5s';
set statement_timeout = '120s';

alter table execution.session_exercises add column rest_seconds integer;
alter table execution.session_exercises
  add constraint ck_session_exercises_rest check (rest_seconds is null or rest_seconds between 0 and 3600);

update execution.session_exercises as item
set rest_seconds = target.target_rest_seconds
from planning.strength_targets as target
where target.planned_step_id = item.planned_step_id;

CREATE OR REPLACE FUNCTION execution.start_planned_session_attempt(p_person_id uuid, p_planned_session_id uuid, p_started_at timestamp with time zone, p_timezone text, p_requested_level catalog.completeness_level, p_capture_source text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(id uuid, attempt_number integer, revision_number bigint, result_contract_id uuid, contract_version integer, requested_level text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  planned record;
  contract record;
  next_attempt integer;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-001', p_idempotency_key, p_command_id, p_request_hash
  );
  -- A replay answers the attempt that was already started, whole: the caller cannot
  -- tell a retry from the first call, which is the point of the receipt.
  if not receipt.claimed then
    return query
      select executed.id, attempt.attempt_number, executed.revision_number,
             executed.result_contract_id, executed.contract_version,
             executed.requested_level::text
      from execution.executed_sessions as executed
      join execution.planned_session_executions as attempt
        on attempt.executed_session_id = executed.id
      where executed.id = receipt.aggregate_id;
    return;
  end if;

  select session.id, session.template_version_id, session.status
  into planned
  from planning.planned_sessions as session
  where session.id = p_planned_session_id and session.person_id = p_person_id
  for update;
  if planned.id is null then
    raise exception 'planned session is not this person''s' using errcode = '42501';
  end if;
  -- Cancelled and paused are refusals; completed is not. Somebody who wants to do
  -- their push day twice has done it twice, and the history should say so.
  if planned.status in ('cancelled', 'paused') then
    raise exception 'planned session is not open' using errcode = '23514';
  end if;

  -- The contract is frozen onto the execution: what a result means must not change
  -- underneath a session somebody already recorded.
  select version.activity_type_id,
         association.result_contract_id,
         published.version_number
  into contract
  from planning.session_template_versions as version
  join catalog.activity_type_result_contracts as association
    on association.activity_type_id = version.activity_type_id
   and association.is_default
   and association.valid_from <= clock_timestamp()
   and (association.valid_to is null or association.valid_to > clock_timestamp())
  join catalog.result_contracts as published on published.id = association.result_contract_id
  where version.id = planned.template_version_id;
  if contract.result_contract_id is null then
    raise exception 'session template has no result contract' using errcode = '23514';
  end if;

  insert into execution.executed_sessions (
    id, person_id, activity_type_id, result_contract_id, contract_version,
    started_at, timezone, requested_level, capture_source
  ) values (
    p_command_id, p_person_id, contract.activity_type_id, contract.result_contract_id,
    contract.version_number, p_started_at, p_timezone, p_requested_level, p_capture_source
  );

  select coalesce(max(attempt.attempt_number), 0) + 1 into next_attempt
  from execution.planned_session_executions as attempt
  where attempt.planned_session_id = p_planned_session_id;

  insert into execution.planned_session_executions (
    planned_session_id, executed_session_id, person_id, attempt_number
  ) values (p_planned_session_id, p_command_id, p_person_id, next_attempt);

  -- The session starts as a copy of its routine, supersets and rest included; from here
  -- on it is the session's own list, and the plan does not decide it again (ADR-034/035).
  insert into execution.session_exercises (
    executed_session_id, position, movement_id, planned_step_id, superset_group, rest_seconds
  )
  select p_command_id, row_number() over (order by step.position), step.movement_id,
         step.id, step.superset_group, target.target_rest_seconds
  from planning.planned_steps as step
  left join planning.strength_targets as target on target.planned_step_id = step.id
  where step.template_version_id = planned.template_version_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'attempt-started', 'executed_session', p_command_id
  );

  return query
    select p_command_id, next_attempt, 0::bigint, contract.result_contract_id,
           contract.version_number, p_requested_level::text;
end
$function$;

CREATE OR REPLACE FUNCTION execution.replace_execution_results(p_person_id uuid, p_executed_session_id uuid, p_expected_revision bigint, p_results jsonb, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea, p_exercises jsonb DEFAULT NULL)
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
  owner_exercise uuid;
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

  -- The exercise list travels with the sets and is replaced with them. Without one, an
  -- older client keeps the list the session already has.
  if p_exercises is not null then
    -- IX-50: a superset is contiguous, as it is in the plan (IX-46).
    if exists (
      select 1
      from jsonb_array_elements(p_exercises) as item
      where nullif(item->>'superset_group', '') is not null
      group by (item->>'superset_group')::smallint
      having max((item->>'position')::integer) - min((item->>'position')::integer) + 1 <> count(*)
    ) then
      raise exception 'a superset has to be contiguous' using errcode = '23514';
    end if;

    delete from execution.session_exercises where executed_session_id = p_executed_session_id;
    insert into execution.session_exercises (
      executed_session_id, position, movement_id, planned_step_id, superset_group, rest_seconds
    )
    select p_executed_session_id, (item->>'position')::integer,
           nullif(item->>'movement_id', '')::uuid, nullif(item->>'planned_step_id', '')::uuid,
           nullif(item->>'superset_group', '')::smallint,
           nullif(item->>'rest_seconds', '')::integer
    from jsonb_array_elements(p_exercises) as item;
  end if;

  for entry in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    case entry->>'family'
      when 'strength' then
        -- The set belongs to the exercise at its position; an older client that does not
        -- say lands on the first exercise of the same movement.
        if nullif(entry->>'exercise_position', '') is not null then
          select exercise.id into owner_exercise
          from execution.session_exercises as exercise
          where exercise.executed_session_id = p_executed_session_id
            and exercise.position = (entry->>'exercise_position')::integer;
          if owner_exercise is null then
            raise exception 'set belongs to no exercise of this session' using errcode = '23514';
          end if;
        else
          select exercise.id into owner_exercise
          from execution.session_exercises as exercise
          where exercise.executed_session_id = p_executed_session_id
            and exercise.movement_id is not distinct from nullif(entry->>'movement_id', '')::uuid
          order by exercise.position
          limit 1;
        end if;

        insert into execution.strength_sets (
          executed_session_id, movement_id, set_order, achieved_reps,
          load_value, load_unit_code, rpe, kind, session_exercise_id
        ) values (
          p_executed_session_id,
          nullif(entry->>'movement_id', '')::uuid,
          (entry->>'set_order')::integer,
          nullif(entry->>'achieved_reps', '')::integer,
          nullif(entry->>'load_value', '')::numeric,
          nullif(entry->>'load_unit_code', ''),
          nullif(entry->>'rpe', '')::numeric,
          coalesce(nullif(entry->>'kind', ''), 'normal')::planning.set_kind,
          owner_exercise
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
 RETURNS TABLE(executed_session_id uuid, execution_status text, started_at timestamp with time zone, revision_number bigint, title text, discipline_code text, program_title text, week integer, planned jsonb, results jsonb, exercises jsonb)
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
         coalesce(recorded.sets, '[]'::jsonb),
         coalesce(listed.items, '[]'::jsonb)
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
  -- The session's own list, in its order: what was trained, not what was planned.
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.position) as items
    from (
      select item.position as position,
             movement.id as movement_id,
             movement.name as movement,
             item.planned_step_id as planned_step_id,
             item.superset_group as superset_group,
             item.rest_seconds as rest_seconds,
             coalesce(strength.target, endurance.target, interval_step.target, mobility.target) as target,
             coalesce(last_time.sets, '[]'::jsonb) as previous,
             coalesce(prescribed.sets, '[]'::jsonb) as sets
      from execution.session_exercises as item
      left join planning.planned_steps as step on step.id = item.planned_step_id
      left join catalog.movements as movement on movement.id = item.movement_id
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
      where item.executed_session_id = executed.id
    ) as entry
  ) as listed on true
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
             sets.kind as kind,
             owner.position as exercise_position
      from execution.strength_sets as sets
      left join execution.session_exercises as owner on owner.id = sets.session_exercise_id
      where sets.executed_session_id = executed.id
    ) as entry
  ) as recorded on true
  where executed.id = p_executed_session_id
    and executed.person_id = p_person_id
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

alter function execution.start_planned_session_attempt(uuid, uuid, timestamp with time zone, text, catalog.completeness_level, text, uuid, uuid, bytea) owner to allfit_owner;
alter function execution.replace_execution_results(uuid, uuid, bigint, jsonb, uuid, uuid, bytea, jsonb) owner to allfit_owner;
revoke all on function execution.replace_execution_results(uuid, uuid, bigint, jsonb, uuid, uuid, bytea, jsonb) from public;
grant execute on function execution.replace_execution_results(uuid, uuid, bigint, jsonb, uuid, uuid, bytea, jsonb) to allfit_api;
alter function execution.read_execution(uuid, uuid) owner to allfit_owner;
revoke all on function execution.read_execution(uuid, uuid) from public;
grant execute on function execution.read_execution(uuid, uuid) to allfit_api;
