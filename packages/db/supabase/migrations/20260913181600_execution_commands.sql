-- Starting a session, writing what happened, and closing it.
--
-- Three commands and two readers, which is the whole of what `X-1` needs.
--
-- **Results are replaced, never patched.** `OP-EXE-005` is a `PUT`, and that is the
-- right shape for a screen where somebody edits the set they logged four sets ago:
-- the client holds the working state and sends it whole, so there is never a
-- half-applied session and never a merge to reason about. The revision number is the
-- optimistic lock, so two phones cannot both win.
--
-- **Closing requires something to close.** An execution with no result rows is
-- somebody who opened the screen and left, and calling that a finished session would
-- put a lie in their history. `X-3` is the screen for what is missing.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- How many results a session holds, across the four families. Three callers ask it
-- and a second copy would drift from this one.
create function execution.result_count(p_executed_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select (select count(*) from execution.strength_sets where executed_session_id = p_executed_session_id)
       + (select count(*) from execution.endurance_laps where executed_session_id = p_executed_session_id)
       + (select count(*) from execution.interval_results where executed_session_id = p_executed_session_id)
       + (select count(*) from execution.round_results where executed_session_id = p_executed_session_id)
       + (select count(*) from execution.mobility_results where executed_session_id = p_executed_session_id)
$function$;

create function execution.start_planned_session_attempt(
  p_person_id uuid,
  p_planned_session_id uuid,
  p_started_at timestamptz,
  p_timezone text,
  p_requested_level catalog.completeness_level,
  p_capture_source text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  id uuid,
  attempt_number integer,
  revision_number bigint,
  result_contract_id uuid,
  contract_version integer,
  requested_level text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
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
  if planned.status <> 'scheduled' then
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

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'attempt-started', 'executed_session', p_command_id
  );

  return query
    select p_command_id, next_attempt, 0::bigint, contract.result_contract_id,
           contract.version_number, p_requested_level::text;
end
$function$;

create function execution.replace_execution_results(
  p_person_id uuid,
  p_executed_session_id uuid,
  p_expected_revision bigint,
  p_results jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (id uuid, revision_number bigint, result_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
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
          load_value, load_unit_code, rpe
        ) values (
          p_executed_session_id,
          nullif(entry->>'movement_id', '')::uuid,
          (entry->>'set_order')::integer,
          nullif(entry->>'achieved_reps', '')::integer,
          nullif(entry->>'load_value', '')::numeric,
          nullif(entry->>'load_unit_code', ''),
          nullif(entry->>'rpe', '')::numeric
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

create function execution.finalize_execution(
  p_person_id uuid,
  p_executed_session_id uuid,
  p_ended_at timestamptz,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  id uuid,
  revision_number bigint,
  achieved_level text,
  is_primary boolean,
  result_contract_id uuid,
  contract_version integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  session execution.executed_sessions;
  recorded integer;
  primary_attempt boolean;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-006', p_idempotency_key, p_command_id, p_request_hash
  );

  select * into session
  from execution.executed_sessions as executed
  where executed.id = p_executed_session_id and executed.person_id = p_person_id
  for update;
  if session.id is null then
    raise exception 'execution is not this person''s' using errcode = '42501';
  end if;
  if not receipt.claimed then
    return query select session.id, session.revision_number, session.achieved_level::text,
                        coalesce(attempt.is_primary, false), session.result_contract_id,
                        session.contract_version
                 from execution.planned_session_executions as attempt
                 where attempt.executed_session_id = session.id;
    return;
  end if;
  if session.execution_status <> 'in_progress' then
    raise exception 'execution is not open' using errcode = '23514';
  end if;

  recorded := execution.result_count(session.id);
  -- Somebody who opened the screen and left did not finish a session, and calling it
  -- finished would put a lie in their history.
  if recorded = 0 then
    raise exception 'execution has nothing recorded' using errcode = '23514';
  end if;

  update execution.executed_sessions as executed
  set ended_at = p_ended_at,
      execution_status = 'completed',
      validation_status = 'valid',
      achieved_level = executed.requested_level,
      revision_number = executed.revision_number + 1
  where executed.id = p_executed_session_id
  returning * into session;

  -- The first valid attempt is the primary one; a later change of mind is
  -- `OP-EXE-018`, which is not built.
  update execution.planned_session_executions as attempt
  set is_primary = true
  where attempt.executed_session_id = p_executed_session_id
    and not exists (
      select 1 from execution.planned_session_executions as other
      where other.planned_session_id = attempt.planned_session_id
        and other.is_primary
    );

  update planning.planned_sessions as session_row
  set status = 'completed'
  where session_row.id in (
    select attempt.planned_session_id from execution.planned_session_executions as attempt
    where attempt.executed_session_id = p_executed_session_id
  );

  select attempt.is_primary into primary_attempt
  from execution.planned_session_executions as attempt
  where attempt.executed_session_id = p_executed_session_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'execution-finalized', 'executed_session', p_executed_session_id
  );

  return query select session.id, session.revision_number, session.achieved_level::text,
                      coalesce(primary_attempt, false), session.result_contract_id,
                      session.contract_version;
end
$function$;

-- `OP-EXE-003`. Abandoning keeps what was recorded: the attempt stays in the history
-- with whatever it reached, it is never primary, and the day it belongs to goes back
-- to scheduled so it can be tried again. Deleting instead would erase training that
-- actually happened.
create function execution.abandon_execution(
  p_person_id uuid,
  p_executed_session_id uuid,
  p_ended_at timestamptz,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (id uuid, revision_number bigint, result_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  session execution.executed_sessions;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-003', p_idempotency_key, p_command_id, p_request_hash
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

  -- Finalised is finished. Abandoning one would rewrite a history somebody already has.
  if session.execution_status = 'completed' then
    raise exception 'execution is already finished' using errcode = '23514';
  end if;

  update execution.executed_sessions as executed
  set ended_at = p_ended_at,
      execution_status = 'abandoned',
      revision_number = executed.revision_number + 1
  where executed.id = p_executed_session_id
  returning * into session;

  -- Never primary, and never counted for adherence.
  update execution.planned_session_executions as attempt
  set is_primary = false
  where attempt.executed_session_id = p_executed_session_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'attempt-abandoned', 'executed_session', p_executed_session_id
  );

  return query select session.id, session.revision_number, execution.result_count(session.id);
end
$function$;

do $$
declare
  routine text;
begin
  foreach routine in array array[
    'execution.result_count(uuid)',
    'execution.start_planned_session_attempt(uuid, uuid, timestamptz, text, catalog.completeness_level, text, uuid, uuid, bytea)',
    'execution.replace_execution_results(uuid, uuid, bigint, jsonb, uuid, uuid, bytea)',
    'execution.finalize_execution(uuid, uuid, timestamptz, uuid, uuid, bytea)',
    'execution.abandon_execution(uuid, uuid, timestamptz, uuid, uuid, bytea)'
  ] loop
    execute format('alter function %s owner to allfit_owner', routine);
    execute format('revoke all on function %s from public', routine);
    execute format('grant execute on function %s to allfit_api', routine);
  end loop;
end
$$;

commit;
