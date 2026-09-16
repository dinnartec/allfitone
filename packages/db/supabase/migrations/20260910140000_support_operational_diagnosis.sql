-- Technical diagnosis for `OP-SUP-005`: `HU-BO-031`.
--
-- The story asks to see the technical state of an operation that failed
-- "without opening anyone's data". That phrase decides the shape of this
-- projection more than anything else.
--
-- `system.outbox_events.payload` and `system.idempotency_keys.response` are
-- arbitrary documents that may carry anything a domain put in them, so neither
-- leaves here. Neither does `principal_fingerprint` or `request_hash`. What
-- travels is identifiers, states, timestamps, error codes and counters — the
-- five things criterion 1 names, and nothing else.
--
-- **No access record.** Criteria 4 of `HU-BO-006` and `HU-BO-007` demand one;
-- this story's does not, and there is nothing to record it against: a delivery
-- queue has no subject. Adding a row to `support.metadata_queries`, which is
-- shaped for looking a person up, would be recording a search nobody made.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Derived states
-- ---------------------------------------------------------------------------

-- A notification is only "stuck" in the sense the operator means: it was never
-- delivered and something already went wrong. `pending` covers the ordinary case
-- of one not sent yet, so a healthy queue does not read as a pile of failures.
create or replace function support.outbox_event_state(
  p_published_at timestamptz,
  p_dead_lettered_at timestamptz,
  p_attempt_count integer
)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_dead_lettered_at is not null then 'dead_lettered'
    when p_published_at is not null then 'delivered'
    when p_attempt_count > 0 then 'retrying'
    else 'pending'
  end
$function$;

-- The one invented number in this migration. A command still `processing` five
-- minutes after it started is not in flight, it is stranded — an HTTP request
-- that outlived its own transaction. Criterion 2 asks to see "si algo falló al
-- sincronizar", and without a threshold that state has no name at all.
create or replace function support.command_state(
  p_status system.idempotency_status,
  p_created_at timestamptz
)
returns text
language sql
stable
set search_path = pg_catalog
as $function$
  select case
    when p_status = 'processing' and p_created_at < clock_timestamp() - interval '5 minutes'
      then 'stalled'
    else p_status::text
  end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-005 — the operational event feed
-- ---------------------------------------------------------------------------

create or replace function support.list_operational_events(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_source text,
  p_state text,
  p_aggregate_id uuid,
  p_limit integer,
  p_cursor_occurred_at timestamptz,
  p_cursor_id uuid
)
returns table (
  source text,
  reference_id uuid,
  subject_kind text,
  subject_id uuid,
  label text,
  state text,
  occurred_at timestamptz,
  attempt_count integer,
  last_error_code text,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform support.require_support_diagnostician(p_actor_person_id, p_actor_session_id);

  if p_source is not null and p_source not in ('notification', 'command') then
    raise exception 'an operational event is a notification or a command'
      using errcode = '22023';
  end if;

  return query
  with feed as (
    select
      'notification'::text as source,
      event.id as reference_id,
      event.aggregate_type as subject_kind,
      event.aggregate_id as subject_id,
      event.event_type as label,
      support.outbox_event_state(
        event.published_at, event.dead_lettered_at, event.attempt_count
      ) as state,
      event.occurred_at,
      event.attempt_count,
      event.last_error_code,
      event.published_at as resolved_at
    from system.outbox_events as event
    where p_source is distinct from 'command'

    union all

    select
      'command'::text,
      receipt.id,
      receipt.aggregate_type,
      receipt.aggregate_id,
      receipt.operation_code,
      support.command_state(receipt.status, receipt.created_at),
      receipt.created_at,
      0,
      receipt.outcome_code,
      receipt.completed_at
    from system.idempotency_keys as receipt
    where p_source is distinct from 'notification'
  )
  select
    feed.source, feed.reference_id, feed.subject_kind, feed.subject_id, feed.label,
    feed.state, feed.occurred_at, feed.attempt_count, feed.last_error_code, feed.resolved_at
  from feed
  where (p_state is null or feed.state = p_state)
    and (p_aggregate_id is null or feed.subject_id = p_aggregate_id)
    and (
      p_cursor_occurred_at is null
      or (feed.occurred_at, feed.reference_id) < (p_cursor_occurred_at, p_cursor_id)
    )
  order by feed.occurred_at desc, feed.reference_id desc
  limit greatest(p_limit, 1);
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-005 — delivery health
-- ---------------------------------------------------------------------------

-- Answers "is the whole channel down" before anyone chases one notification.
-- Nothing here belongs to a person: it is a counter per event type.
create or replace function support.list_delivery_circuits(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns table (
  event_type text,
  state text,
  window_started_at timestamptz,
  success_count integer,
  failure_count integer,
  opened_until timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform support.require_support_diagnostician(p_actor_person_id, p_actor_session_id);

  return query
  select
    circuit.event_type, circuit.state, circuit.window_started_at,
    circuit.success_count, circuit.failure_count, circuit.opened_until
  from system.outbox_delivery_circuits as circuit
  order by circuit.failure_count desc, circuit.event_type;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function support.outbox_event_state(timestamptz, timestamptz, integer) owner to allfit_owner;
alter function support.command_state(system.idempotency_status, timestamptz) owner to allfit_owner;
alter function support.list_operational_events(uuid, uuid, text, text, uuid, integer, timestamptz, uuid) owner to allfit_owner;
alter function support.list_delivery_circuits(uuid, uuid) owner to allfit_owner;

revoke all on function support.outbox_event_state(timestamptz, timestamptz, integer) from public;
revoke all on function support.command_state(system.idempotency_status, timestamptz) from public;
revoke all on function support.list_operational_events(uuid, uuid, text, text, uuid, integer, timestamptz, uuid) from public;
revoke all on function support.list_delivery_circuits(uuid, uuid) from public;

grant execute on function support.list_operational_events(uuid, uuid, text, text, uuid, integer, timestamptz, uuid) to allfit_api;
grant execute on function support.list_delivery_circuits(uuid, uuid) to allfit_api;
