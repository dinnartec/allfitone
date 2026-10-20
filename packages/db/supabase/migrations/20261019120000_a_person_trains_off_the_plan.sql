-- A person trains something that was not on the agenda (OP-EXE-004, HU-SP-052).
--
-- A free session is an execution with no planned session behind it: the link to the
-- agenda lives in `planned_session_executions`, so a free session simply has no row
-- there, and every reader already derives `is_free` from that absence. What was missing
-- is the command that starts one.
--
-- It starts empty (ADR-034): the person adds what they train as they go. The contract is
-- frozen exactly as for a routine of their own — the one published global activity type
-- of the discipline and its current default contract (`create_my_session_template`) —
-- and a discipline that does not have exactly one is refused, never guessed.
--
-- One free session is open at a time. A second tap, or a retry with a new key after a
-- lost answer, must land on the session already running rather than leave two behind;
-- `read_open_free_session` is how Today finds it to offer it back.
--
-- `finalize_execution` is redefined only in its replay: it answered through the link
-- table, which a free session has no row in, so finishing one twice answered nothing.

set lock_timeout = '5s';
set statement_timeout = '120s';

create function execution.start_free_session(
  p_person_id uuid,
  p_discipline_code text,
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
  contract record;
  candidates integer;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-EXE-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query
      select executed.id, executed.revision_number, executed.result_contract_id,
             executed.contract_version, executed.requested_level::text
      from execution.executed_sessions as executed
      where executed.id = receipt.aggregate_id;
    return;
  end if;

  -- Serialises this person's starts, so two at once cannot both find nothing open.
  perform 1 from identity.people as person where person.id = p_person_id for update;

  if exists (
    select 1
    from execution.executed_sessions as executed
    where executed.person_id = p_person_id
      and executed.execution_status = 'in_progress'
      and not exists (
        select 1 from execution.planned_session_executions as attempt
        where attempt.executed_session_id = executed.id
      )
  ) then
    raise exception 'a free session is already open' using errcode = '55006';
  end if;

  select count(*)::integer into candidates
  from catalog.activity_types as activity
  where activity.discipline_code = p_discipline_code
    and activity.content_scope = 'global'
    and activity.status = 'published';
  if candidates <> 1 then
    raise exception 'discipline has no single published activity type' using errcode = '23514';
  end if;

  select activity.id as activity_type_id,
         association.result_contract_id,
         published.version_number
  into contract
  from catalog.activity_types as activity
  join catalog.activity_type_result_contracts as association
    on association.activity_type_id = activity.id
   and association.is_default
   and association.valid_from <= clock_timestamp()
   and (association.valid_to is null or association.valid_to > clock_timestamp())
  join catalog.result_contracts as published on published.id = association.result_contract_id
  where activity.discipline_code = p_discipline_code
    and activity.content_scope = 'global'
    and activity.status = 'published';
  if contract.result_contract_id is null then
    raise exception 'activity type has no result contract' using errcode = '23514';
  end if;

  insert into execution.executed_sessions (
    id, person_id, activity_type_id, result_contract_id, contract_version,
    started_at, timezone, requested_level, capture_source
  ) values (
    p_command_id, p_person_id, contract.activity_type_id, contract.result_contract_id,
    contract.version_number, p_started_at, p_timezone, p_requested_level, p_capture_source
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'free-session-started', 'executed_session', p_command_id
  );

  return query
    select p_command_id, 0::bigint, contract.result_contract_id,
           contract.version_number, p_requested_level::text;
end
$function$;

create function execution.read_open_free_session(p_person_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  open_id uuid;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'execution person does not match the authenticated actor' using errcode = '42501';
  end if;

  select executed.id into open_id
  from execution.executed_sessions as executed
  where executed.person_id = p_person_id
    and executed.execution_status = 'in_progress'
    and not exists (
      select 1 from execution.planned_session_executions as attempt
      where attempt.executed_session_id = executed.id
    )
  order by executed.started_at desc
  limit 1;
  return open_id;
end
$function$;

CREATE OR REPLACE FUNCTION execution.finalize_execution(p_person_id uuid, p_executed_session_id uuid, p_ended_at timestamp with time zone, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(id uuid, revision_number bigint, achieved_level text, is_primary boolean, result_contract_id uuid, contract_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    -- The attempt is optional: a free session has none and still answers its replay.
    select attempt.is_primary into primary_attempt
    from execution.planned_session_executions as attempt
    where attempt.executed_session_id = session.id;
    return query select session.id, session.revision_number, session.achieved_level::text,
                        coalesce(primary_attempt, false), session.result_contract_id,
                        session.contract_version;
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

alter function execution.start_free_session(uuid, text, timestamptz, text, catalog.completeness_level, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function execution.start_free_session(uuid, text, timestamptz, text, catalog.completeness_level, text, uuid, uuid, bytea) from public;
grant execute on function execution.start_free_session(uuid, text, timestamptz, text, catalog.completeness_level, text, uuid, uuid, bytea) to allfit_api;
alter function execution.read_open_free_session(uuid) owner to allfit_owner;
revoke all on function execution.read_open_free_session(uuid) from public;
grant execute on function execution.read_open_free_session(uuid) to allfit_api;
alter function execution.finalize_execution(uuid, uuid, timestamp with time zone, uuid, uuid, bytea) owner to allfit_owner;
