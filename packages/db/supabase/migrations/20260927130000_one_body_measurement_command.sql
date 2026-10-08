-- One command records a body measurement, and it is the one Space's onboarding calls.
--
-- The merge left two. This one is keyed on the onboarding account; a second, added in the
-- Backoffice branch for the same operation, was keyed on the token subject. Both wrote
-- `identity.body_progress_records`, and only this one was ever reachable: two routers
-- claimed `POST /space/v1/body-progress` and Hono answers with whichever registered
-- first. The other is dropped here rather than left as an unreachable SECURITY DEFINER
-- function over health data.
--
-- What the dropped one enforced moves here, because it enforced more:
--
--   * the metric comes from `identity.body_progress_metrics`, so adding one is a row and
--     not a code change. The two-metric CASE it replaces could not name a waist, which
--     made the nine-metric catalogue decoration;
--   * a measurement stays under the maximum that metric declares;
--   * a closed person records nothing, while one who has not activated still can,
--     because this command runs during onboarding;
--   * replaying a command whose measurement the owner has since deleted answers `AF410`
--     rather than a row of nulls that claims the recording succeeded;
--   * the recording is announced once, ids only.
--
-- The signature, the returned columns, the SQLSTATEs and the exact conversion are
-- unchanged, so the handler and its tests keep working. The conversion is deliberately
-- not rounded: the unit the person read is stored beside it, so dropping digits would
-- lose the only figure that is not recoverable.

set lock_timeout = '5s';
set statement_timeout = '60s';

drop function identity.record_body_progress(
  text, text, text, uuid, text, numeric, text, date, uuid, bytea
);

-- The dimension is a column of the catalogue now, so the oracle that answered for two
-- metrics has nothing left to answer.
drop function identity.metric_dimension(text);

create or replace function identity.record_body_progress(
  p_account_id uuid,
  p_metric_code text,
  p_value numeric,
  p_unit_code text,
  p_measured_on date,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  record_id uuid,
  metric_code text,
  value_numeric numeric,
  unit_code text,
  original_value numeric,
  original_unit_code text,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject_person_id uuid;
  metric identity.body_progress_metrics%rowtype;
  chosen catalog.units%rowtype;
  canonical catalog.units%rowtype;
  stored numeric;
  created identity.body_progress_records%rowtype;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  -- The person is the subject of the measurement. Without one there is nothing to measure.
  select access_account.person_id into subject_person_id
  from identity.access_accounts as access_account
  where access_account.id = p_account_id;

  if subject_person_id is null then
    raise exception 'the account owns no person yet' using errcode = '42501';
  end if;

  -- A closed person is not measured again. Onboarding still records for a person who has
  -- not activated yet, which is the whole reason this command exists.
  if exists (
    select 1 from identity.people as person
    where person.id = subject_person_id and person.status = 'closed'
  ) then
    raise exception 'a closed person records nothing' using errcode = '42501';
  end if;

  -- Everything is validated before idempotency is touched: an invalid request that burned
  -- the key would leave the correct retry failing.
  select * into metric from identity.body_progress_metrics as candidate
  where candidate.code = p_metric_code;
  if metric.code is null then
    raise exception 'unknown body metric' using errcode = '23514';
  end if;
  if p_measured_on is null or p_measured_on > current_date then
    raise exception 'a measurement cannot be taken in the future' using errcode = '23514';
  end if;

  select * into chosen from catalog.units where code = p_unit_code;
  if chosen.code is null or chosen.dimension <> metric.dimension then
    raise exception 'the unit does not belong to the dimension of the metric' using errcode = '23514';
  end if;

  select * into canonical
  from catalog.units
  where catalog.units.dimension = metric.dimension and catalog.units.is_canonical;

  if canonical.code is null then
    raise exception 'the dimension has no canonical unit' using errcode = '23514';
  end if;

  stored := p_value * chosen.to_canonical_factor;
  if p_value is null or p_value <= 0 or stored > metric.maximum_value then
    raise exception 'a measurement is positive and within what a body can be' using errcode = '23514';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-006',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    select * into created from identity.body_progress_records where id = receipt.aggregate_id;

    -- The owner deleted it. Saying "already recorded" and returning nulls would tell the
    -- device it succeeded; the command never recreates what was deleted.
    if created.id is null then
      raise exception 'the measurement this command recorded was deleted' using errcode = 'AF410';
    end if;

    return query select created.id, created.metric_code, created.value_numeric, created.unit_code,
                        created.original_value, created.original_unit_code, true;
    return;
  end if;

  -- The id is the device's Command-Id, as OP-IDN-006 fixes: the primary key rejects a
  -- second measurement of the same command on its own.
  --
  -- The original is stored only when the chosen unit was not the canonical one, so
  -- "original is not null" means exactly "she read it in another unit".
  insert into identity.body_progress_records (
    id, person_id, metric_code, value_numeric, unit_code,
    original_value, original_unit_code, measured_on
  ) values (
    p_command_id,
    subject_person_id,
    p_metric_code,
    stored,
    canonical.code,
    case when chosen.is_canonical then null else p_value end,
    case when chosen.is_canonical then null else chosen.code end,
    p_measured_on
  )
  returning * into created;

  -- That a measurement exists, never what it says.
  perform system.enqueue_outbox_event(
    'body_progress_record', created.id, 'identity.body_progress_recorded.v1',
    jsonb_build_object('body_progress_record_id', created.id)
  );

  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'body-progress-recorded',
    'body_progress_record',
    created.id
  );

  return query select created.id, created.metric_code, created.value_numeric, created.unit_code,
                      created.original_value, created.original_unit_code, false;
end
$function$;

alter function identity.record_body_progress(uuid, text, numeric, text, date, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.record_body_progress(uuid, text, numeric, text, date, uuid, uuid, bytea) from public;
grant execute on function identity.record_body_progress(uuid, text, numeric, text, date, uuid, uuid, bytea) to allfit_api;
