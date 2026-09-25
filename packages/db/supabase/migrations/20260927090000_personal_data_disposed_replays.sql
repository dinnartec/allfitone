-- T-IDEM-08 for body progress and health context: replaying a recording whose effect was
-- deleted since answers AF410, the command-effect-disposed verdict (410), instead of an empty
-- result.
--
-- OP-IDN-006 and OP-IDN-008 kept replaying through their projection, which finds nothing once
-- the owner deleted the row, so a device retrying an old command was told it succeeded with no
-- content. Meals (OP-NUT-001) already answer this way; these two now match. The command never
-- recreates what was deleted.
--
-- The check reads whether the aggregate still exists rather than
-- `system.idempotency_keys.effect_disposed_at`: nothing sets that column yet, and the absence of
-- the row is the fact that matters here.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function identity.record_body_progress(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_record_id uuid,
  p_metric_code text,
  p_value numeric,
  p_unit_code text,
  p_measured_on date,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  metric identity.body_progress_metrics%rowtype;
  unit_row catalog.units%rowtype;
  canonical_code text;
  canonical_value numeric;
  receipt record;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  if p_record_id is null then
    raise exception 'a measurement is identified by its command' using errcode = '22023';
  end if;
  select * into metric from identity.body_progress_metrics as candidate
  where candidate.code = p_metric_code;
  if metric.code is null then
    raise exception 'that measurement is not in the catalogue' using errcode = '22023';
  end if;
  select * into unit_row from catalog.units as candidate where candidate.code = p_unit_code;
  if unit_row.code is null or unit_row.dimension <> metric.dimension then
    raise exception 'that unit does not measure this' using errcode = '22023';
  end if;
  if p_measured_on is null
     or p_measured_on > current_date + 1
     or p_measured_on < date '1900-01-01' then
    raise exception 'a measurement is taken on a real day, not a future one' using errcode = '22023';
  end if;

  canonical_value := round(p_value * unit_row.to_canonical_factor, 3);
  if p_value is null or p_value <= 0 or canonical_value <= 0
     or canonical_value > metric.maximum_value then
    raise exception 'a measurement is positive and within what a body can be' using errcode = '22023';
  end if;

  select unit.code into canonical_code
  from catalog.units as unit
  where unit.dimension = metric.dimension and unit.is_canonical;

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-IDN-006', p_idempotency_key, p_record_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent measurement not found' using errcode = '40001';
    end if;
    if not exists (
      select 1 from identity.body_progress_records as record where record.id = receipt.aggregate_id
    ) then
      raise exception 'the measurement this command recorded was deleted' using errcode = 'AF410';
    end if;
    return query select identity.body_progress_projection(receipt.aggregate_id), true;
    return;
  end if;

  insert into identity.body_progress_records (
    id, person_id, metric_code, value_numeric, unit_code,
    original_value, original_unit_code, measured_on
  ) values (
    p_record_id, person, metric.code, canonical_value, canonical_code,
    case when unit_row.code <> canonical_code then p_value end,
    case when unit_row.code <> canonical_code then unit_row.code end,
    p_measured_on
  );

  -- That a measurement exists, never what it says.
  perform system.enqueue_outbox_event(
    'body_progress_record', p_record_id, 'identity.body_progress_recorded.v1',
    jsonb_build_object('body_progress_record_id', p_record_id)
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'body-progress-recorded',
    'body_progress_record', p_record_id
  );
  return query select identity.body_progress_projection(p_record_id), false;
end
$function$;

create or replace function identity.record_health_context(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_claim_id uuid,
  p_context_type text,
  p_description text,
  p_body_area text,
  p_valid_from timestamptz,
  p_valid_to timestamptz,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  receipt record;
  words text := btrim(p_description);
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  if p_claim_id is null then
    raise exception 'a claim is identified by its command' using errcode = '22023';
  end if;
  if p_context_type is null or p_context_type not in ('pain', 'limitation', 'recovery') then
    raise exception 'V1 keeps pains, limitations and recoveries, nothing else' using errcode = '22023';
  end if;
  if words is null or words = '' or char_length(words) > 500 then
    raise exception 'a claim says something, briefly' using errcode = '22023';
  end if;
  if p_body_area is not null and p_body_area not in (
    'neck', 'shoulder', 'upper_back', 'lower_back', 'chest', 'abdomen', 'arm', 'elbow',
    'wrist_hand', 'hip', 'thigh', 'knee', 'lower_leg', 'ankle_foot'
  ) then
    raise exception 'that body area is not in the list' using errcode = '22023';
  end if;
  if p_valid_from is null
     or p_valid_from > clock_timestamp() + interval '1 day'
     or p_valid_from < timestamptz '1900-01-01 00:00:00+00' then
    raise exception 'a claim starts on a real day, not a future one' using errcode = '22023';
  end if;
  if p_valid_to is not null and p_valid_to <= p_valid_from then
    raise exception 'a claim ends after it starts' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-IDN-008', p_idempotency_key, p_claim_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent claim not found' using errcode = '40001';
    end if;
    if not exists (
      select 1 from identity.health_context_claims as claim where claim.id = receipt.aggregate_id
    ) then
      raise exception 'the claim this command declared was deleted' using errcode = 'AF410';
    end if;
    return query select identity.health_context_projection(receipt.aggregate_id), true;
    return;
  end if;

  insert into identity.health_context_claims (
    id, person_id, context_type, description, body_area, provenance, valid_from, valid_to
  ) values (
    p_claim_id, person, p_context_type, words, p_body_area, 'person_declared',
    p_valid_from, p_valid_to
  );

  -- That a claim exists, never what it says.
  perform system.enqueue_outbox_event(
    'health_context_claim', p_claim_id, 'identity.health_context_declared.v1',
    jsonb_build_object('health_context_claim_id', p_claim_id)
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'health-context-declared',
    'health_context_claim', p_claim_id
  );
  return query select identity.health_context_projection(p_claim_id), false;
end
$function$;

alter function identity.record_body_progress(
  text, text, text, uuid, text, numeric, text, date, uuid, bytea
) owner to allfit_owner;
alter function identity.record_health_context(
  text, text, text, uuid, text, text, text, timestamptz, timestamptz, uuid, bytea
) owner to allfit_owner;

revoke all on function identity.record_body_progress(
  text, text, text, uuid, text, numeric, text, date, uuid, bytea
) from public;
revoke all on function identity.record_health_context(
  text, text, text, uuid, text, text, text, timestamptz, timestamptz, uuid, bytea
) from public;

grant execute on function identity.record_body_progress(
  text, text, text, uuid, text, numeric, text, date, uuid, bytea
) to allfit_api;
grant execute on function identity.record_health_context(
  text, text, text, uuid, text, text, text, timestamptz, timestamptz, uuid, bytea
) to allfit_api;
