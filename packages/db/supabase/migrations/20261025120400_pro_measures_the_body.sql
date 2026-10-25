-- DT-018 and HU-SP-025..027 — body measurements and photos with Pro.
--
-- Weight and height are the profile and stay free. Every other measurement needs
-- `body_measurements`. Photos need `body_photos` and live in a table of their own: a
-- measurement is a value in a unit, a photo is an object in storage.
--
-- **A body photo is the person's alone.** No consent scope covers it, so no gym and no
-- professional reads it; the API signs a short-lived URL only for its owner. The object
-- key carries the person (`body/{person}/…`) and a check refuses any other. Deleting a
-- photo queues its object in `body_photo_disposals` in the same transaction; the API
-- removes it from storage after the commit and seals the row, as meals do. Reading and
-- deleting one's own photos is never limited by a plan.
--
-- `record_body_progress` is the body in force (20260927130000) with the check added.

set lock_timeout = '5s';
set statement_timeout = '60s';

create table identity.body_photos (
  id uuid not null,
  person_id uuid not null,
  taken_on date not null,
  media_ref text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_body_photos primary key (id),
  constraint fk_body_photos_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint uq_body_photos_media unique (media_ref),
  constraint ck_body_photos_media check (media_ref like 'body/' || person_id::text || '/%')
);

create index idx_body_photos_person on identity.body_photos (person_id, taken_on desc);

create table identity.body_photo_disposals (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  media_ref text not null,
  requested_at timestamptz not null default clock_timestamp(),
  sealed_at timestamptz,
  constraint pk_body_photo_disposals primary key (id),
  constraint fk_body_photo_disposals_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint ck_body_photo_disposals_ref check (media_ref ~ '^body/')
);

create index idx_body_photo_disposals_person on identity.body_photo_disposals (person_id);
create index idx_body_photo_disposals_pending on identity.body_photo_disposals (requested_at)
  where sealed_at is null;

alter table identity.body_photos owner to allfit_owner;
alter table identity.body_photo_disposals owner to allfit_owner;
alter table identity.body_photos enable row level security;
alter table identity.body_photos force row level security;
alter table identity.body_photo_disposals enable row level security;
alter table identity.body_photo_disposals force row level security;

create policy body_photos_all_self on identity.body_photos
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));
create policy body_photo_disposals_all_self on identity.body_photo_disposals
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

revoke all on identity.body_photos, identity.body_photo_disposals from public, allfit_api;

-- OP-IDN-056 — keeping a photo of one's body.
create function identity.record_body_photo(
  p_person_id uuid, p_taken_on date, p_media_ref text,
  p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'body photo person does not match the authenticated actor' using errcode = '42501';
  end if;
  if p_taken_on is null or p_taken_on > current_date + 1 then
    raise exception 'a photo cannot be taken in the future' using errcode = '23514';
  end if;
  if p_media_ref is null or p_media_ref not like 'body/' || p_person_id::text || '/%' then
    raise exception 'a body photo is stored under its person' using errcode = '23514';
  end if;
  perform payments.require_feature(p_person_id, 'body_photos');

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-IDN-056', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return receipt.aggregate_id;
  end if;

  insert into identity.body_photos (id, person_id, taken_on, media_ref)
  values (p_command_id, p_person_id, p_taken_on, p_media_ref);

  -- That a photo exists, never where.
  perform system.enqueue_outbox_event(
    'body_photo', p_command_id, 'identity.body_photo_recorded.v1',
    jsonb_build_object('body_photo_id', p_command_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'body-photo-recorded', 'body_photo', p_command_id
  );
  return p_command_id;
end
$function$;

-- The person's photos, newest first. The key never leaves the API: it signs a URL.
create function identity.list_my_body_photos(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'body photos are read only by their own person' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', photo.id, 'taken_on', photo.taken_on, 'media_ref', photo.media_ref,
      'created_at', photo.created_at) order by photo.taken_on desc, photo.created_at desc)
    from identity.body_photos as photo
    where photo.person_id = p_person_id), '[]'::jsonb);
end
$function$;

-- OP-IDN-057 — deleting a photo; answers the object to remove once committed.
create function identity.delete_my_body_photo(
  p_person_id uuid, p_photo_id uuid,
  p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  removed text;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'body photo person does not match the authenticated actor' using errcode = '42501';
  end if;
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-IDN-057', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return (select disposal.media_ref from identity.body_photo_disposals as disposal
            where disposal.person_id = p_person_id and disposal.id = receipt.aggregate_id);
  end if;

  delete from identity.body_photos as photo
  where photo.id = p_photo_id and photo.person_id = p_person_id
  returning photo.media_ref into removed;
  if removed is null then
    raise exception 'body photo not found' using errcode = 'P0002';
  end if;

  insert into identity.body_photo_disposals (id, person_id, media_ref)
  values (p_command_id, p_person_id, removed);

  perform system.enqueue_outbox_event(
    'body_photo', p_photo_id, 'identity.body_photo_deleted.v1',
    jsonb_build_object('body_photo_id', p_photo_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'body-photo-deleted', 'body_photo_disposal', p_command_id
  );
  return removed;
end
$function$;

create function identity.seal_body_photo_disposal(p_person_id uuid, p_media_ref text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'body photo person does not match the authenticated actor' using errcode = '42501';
  end if;
  update identity.body_photo_disposals
  set sealed_at = clock_timestamp()
  where person_id = p_person_id and media_ref = p_media_ref and sealed_at is null;
end
$function$;

CREATE OR REPLACE FUNCTION identity.record_body_progress(p_account_id uuid, p_metric_code text, p_value numeric, p_unit_code text, p_measured_on date, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(record_id uuid, metric_code text, value_numeric numeric, unit_code text, original_value numeric, original_unit_code text, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  subject_person_id uuid;
  metric identity.body_progress_metrics%rowtype;
  chosen catalog.units%rowtype;
  canonical catalog.units%rowtype;
  stored numeric;
  created identity.body_progress_records%rowtype;
  previous_person text;
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
  -- Weight and height are the profile, always free; every other measurement is Pro.
  -- The caller is the account, so the plan is read as the person it was just proven to own:
  -- without that, the gym that makes her Pro is out of sight. Restored straight after.
  if metric.code not in ('body_weight', 'body_height') then
    previous_person := current_setting('app.actor_person_id', true);
    perform set_config('app.actor_person_id', subject_person_id::text, true);
    perform payments.require_feature(subject_person_id, 'body_measurements');
    perform set_config('app.actor_person_id', coalesce(previous_person, ''), true);
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

alter function identity.record_body_photo(uuid, date, text, uuid, uuid, bytea) owner to allfit_owner;
alter function identity.list_my_body_photos(uuid) owner to allfit_owner;
alter function identity.delete_my_body_photo(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
alter function identity.seal_body_photo_disposal(uuid, text) owner to allfit_owner;

revoke all on function identity.record_body_photo(uuid, date, text, uuid, uuid, bytea) from public;
revoke all on function identity.list_my_body_photos(uuid) from public;
revoke all on function identity.delete_my_body_photo(uuid, uuid, uuid, uuid, bytea) from public;
revoke all on function identity.seal_body_photo_disposal(uuid, text) from public;

grant execute on function identity.record_body_photo(uuid, date, text, uuid, uuid, bytea) to allfit_api;
grant execute on function identity.list_my_body_photos(uuid) to allfit_api;
grant execute on function identity.delete_my_body_photo(uuid, uuid, uuid, uuid, bytea) to allfit_api;
grant execute on function identity.seal_body_photo_disposal(uuid, text) to allfit_api;
