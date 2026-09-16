-- OP-IDN-006, OP-IDN-007 and OP-SUP-003 over body progress — a person's measurements,
-- deleting one, and support reading them through a restricted window (`HU-SP-025`,
-- `HU-SP-026`, `HU-SP-027`, `HU-BO-009`).
--
-- **The measurement is the person's.** Space records it for the person the token's
-- subject resolves to, in the database, and nothing else can write it. It is stored in
-- the canonical unit of its dimension — kilograms, metres, percent — with what the person
-- typed kept beside it when that was something else. A recorded measurement is never
-- rewritten: it is kept or deleted. Photos are not accepted yet: removing their metadata
-- on the server is its own piece, and a record never claims a photo it does not have.
--
-- **Deleting is physical, and it leaves evidence.** OP-IDN-007 opens a unit disposition
-- case, names the policy it follows, deletes the row and closes the case, all in one
-- transaction. What stays is a closed case saying which kind of data was deleted, under
-- which policy and when; the append-only event is the execution itself.
--
-- This is the first piece of `privacy.disposition_*`, and it departs from the dictionary
-- in one place on purpose. The dictionary gives each item a target foreign key with
-- `ON DELETE RESTRICT` and demands exactly one target — which would make the physical
-- deletion it exists for impossible. Here a pending item holds its target exactly that
-- way, so nothing deletes the row around it, and an executed deletion releases it: the
-- item keeps `target_kind`, never a pointer to a row that no longer exists. The
-- erasure request column arrives with `privacy.erasure_requests`.
--
-- The only policy published is the one the operation already states: when the owner asks,
-- body data is deleted now. Retention on any other trigger is DB-P5-015 and is not
-- decided here.
--
-- **Support reads it only through its own restricted window.** The window was already
-- authorised and audited; now a body window returns the measurements, with whether a
-- photo exists and never where it is, and refuses to be pointed at another kind of data.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Units and measurements
-- ---------------------------------------------------------------------------

-- SI where there is one: a waist is stored in metres so length has one canonical unit
-- whether it is a waist or a run.
insert into catalog.units (code, dimension, is_canonical, to_canonical_factor)
values
  ('kg', 'mass', true, 1),
  ('lb', 'mass', false, 0.45359237),
  ('m', 'length', true, 1),
  ('cm', 'length', false, 0.01),
  ('in', 'length', false, 0.0254),
  ('percent', 'ratio', true, 1);

create table identity.body_progress_metrics (
  code text not null,
  name text not null,
  dimension text not null,
  maximum_value numeric not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_body_progress_metrics primary key (code),
  constraint ck_body_progress_metrics_code check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint ck_body_progress_metrics_name check (btrim(name) <> '' and char_length(name) <= 60),
  constraint ck_body_progress_metrics_dimension check (dimension in ('mass', 'length', 'ratio')),
  -- In the dimension's canonical unit; it rejects typos, not unusual bodies.
  constraint ck_body_progress_metrics_maximum check (maximum_value > 0)
);

insert into identity.body_progress_metrics (code, name, dimension, maximum_value)
values
  ('weight', 'Peso', 'mass', 700),
  ('muscle_mass', 'Masa muscular', 'mass', 400),
  ('body_fat', 'Grasa corporal', 'ratio', 100),
  ('waist', 'Cintura', 'length', 5),
  ('hip', 'Cadera', 'length', 5),
  ('chest', 'Pecho', 'length', 5),
  ('arm', 'Brazo', 'length', 3),
  ('thigh', 'Muslo', 'length', 3);

create table identity.body_progress_records (
  id uuid not null,
  person_id uuid not null,
  metric_code text not null,
  value_numeric numeric(12, 3) not null,
  unit_code text not null,
  original_value numeric(12, 3),
  original_unit_code text,
  measured_on date not null,
  media_ref text,
  has_media boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_body_progress_records primary key (id),
  constraint fk_body_progress_records_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_body_progress_records_metric foreign key (metric_code) references identity.body_progress_metrics(code) on delete restrict,
  constraint fk_body_progress_records_unit foreign key (unit_code) references catalog.units(code) on delete restrict,
  constraint fk_body_progress_records_original_unit foreign key (original_unit_code) references catalog.units(code) on delete restrict,
  constraint ck_body_progress_records_value check (value_numeric > 0),
  constraint ck_body_progress_records_original check (
    (original_value is null) = (original_unit_code is null)
    and (original_value is null or original_value > 0)
  ),
  constraint ck_body_progress_records_media check (has_media = (media_ref is not null))
);

create index idx_body_progress_records_person
  on identity.body_progress_records (person_id, measured_on desc, id desc);
create index idx_body_progress_records_metric on identity.body_progress_records (metric_code);
create index idx_body_progress_records_unit on identity.body_progress_records (unit_code);
create index idx_body_progress_records_original_unit
  on identity.body_progress_records (original_unit_code);

create or replace function identity.body_progress_record_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  metric_dimension text;
  unit_row catalog.units%rowtype;
  original_dimension text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'a recorded measurement is never rewritten' using errcode = '55000';
  end if;

  select metric.dimension into metric_dimension
  from identity.body_progress_metrics as metric
  where metric.code = new.metric_code;

  select * into unit_row from catalog.units as unit where unit.code = new.unit_code;
  if unit_row.dimension is distinct from metric_dimension or not unit_row.is_canonical then
    raise exception 'a measurement is stored in the canonical unit of its dimension'
      using errcode = '23514';
  end if;

  if new.original_unit_code is not null then
    select unit.dimension into original_dimension
    from catalog.units as unit
    where unit.code = new.original_unit_code;
    if original_dimension is distinct from metric_dimension then
      raise exception 'the unit the person typed measures the same thing' using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

create trigger trg_body_progress_records_guard
before insert or update on identity.body_progress_records
for each row execute function identity.body_progress_record_guard_tg();

-- ---------------------------------------------------------------------------
-- Disposition
-- ---------------------------------------------------------------------------

create type privacy.disposition_action as enum ('delete', 'anonymize', 'retain_restricted');
create type privacy.disposition_status as enum ('pending', 'executed', 'suspended');

create table privacy.retention_policies (
  id uuid not null default extensions.uuid_generate_v7(),
  data_classification_code text not null,
  jurisdiction text not null,
  version_number integer not null,
  default_action privacy.disposition_action not null,
  retention_period interval not null,
  trigger text not null,
  published_at timestamptz not null default clock_timestamp(),
  constraint pk_retention_policies primary key (id),
  constraint uq_retention_policies_version unique (data_classification_code, jurisdiction, version_number),
  constraint fk_retention_policies_classification foreign key (data_classification_code) references privacy.data_classifications(code) on delete restrict,
  constraint ck_retention_policies_jurisdiction check (jurisdiction ~ '^[A-Z]{2}$'),
  constraint ck_retention_policies_version check (version_number > 0),
  constraint ck_retention_policies_period check (retention_period >= interval '0'),
  constraint ck_retention_policies_trigger check (trigger ~ '^[a-z][a-z0-9_]{1,63}$')
);

insert into privacy.retention_policies (
  data_classification_code, jurisdiction, version_number, default_action, retention_period, trigger
) values ('body', 'CO', 1, 'delete', interval '0', 'owner_request');

create table privacy.disposition_cases (
  id uuid not null default extensions.uuid_generate_v7(),
  subject_person_id uuid not null,
  origin text not null,
  status text not null default 'open',
  requested_by_person_id uuid,
  opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  constraint pk_disposition_cases primary key (id),
  constraint uq_disposition_cases_subject unique (id, subject_person_id),
  constraint fk_disposition_cases_subject foreign key (subject_person_id) references identity.people(id) on delete restrict,
  constraint fk_disposition_cases_requester foreign key (requested_by_person_id) references identity.people(id) on delete restrict,
  constraint ck_disposition_cases_origin check (
    origin in ('request', 'retention', 'closure', 'disconnection', 'expiry')
  ),
  constraint ck_disposition_cases_status check (status in ('open', 'closed')),
  constraint ck_disposition_cases_closed check ((status = 'closed') = (closed_at is not null)),
  -- A case opened on request names who asked, and today only the subject asks.
  constraint ck_disposition_cases_requester check (
    (origin = 'request') = (requested_by_person_id is not null)
    and (requested_by_person_id is null or requested_by_person_id = subject_person_id)
  )
);

create index idx_disposition_cases_subject on privacy.disposition_cases (subject_person_id, status);
create index idx_disposition_cases_requester on privacy.disposition_cases (requested_by_person_id);

create table privacy.disposition_items (
  id uuid not null default extensions.uuid_generate_v7(),
  disposition_case_id uuid not null,
  subject_person_id uuid not null,
  data_classification_code text not null,
  retention_policy_id uuid not null,
  action privacy.disposition_action not null,
  status privacy.disposition_status not null default 'pending',
  due_at timestamptz not null default clock_timestamp(),
  target_kind text not null,
  target_body_progress_id uuid,
  executed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_disposition_items primary key (id),
  constraint fk_disposition_items_case foreign key (disposition_case_id, subject_person_id) references privacy.disposition_cases(id, subject_person_id) on delete cascade,
  constraint fk_disposition_items_classification foreign key (data_classification_code) references privacy.data_classifications(code) on delete restrict,
  constraint fk_disposition_items_policy foreign key (retention_policy_id) references privacy.retention_policies(id) on delete restrict,
  constraint fk_disposition_items_body_progress foreign key (target_body_progress_id) references identity.body_progress_records(id) on delete restrict,
  constraint ck_disposition_items_target_kind check (target_kind in ('body_progress')),
  -- An executed deletion releases its target; anything else holds exactly one, of its kind.
  constraint ck_disposition_items_target check (
    case
      when status = 'executed' and action = 'delete'
        then num_nonnulls(target_body_progress_id) = 0
      else num_nonnulls(target_body_progress_id) = 1
        and (target_kind <> 'body_progress' or target_body_progress_id is not null)
    end
  ),
  constraint ck_disposition_items_executed check ((status = 'executed') = (executed_at is not null))
);

create index idx_disposition_items_due on privacy.disposition_items (status, due_at);
create index idx_disposition_items_case
  on privacy.disposition_items (disposition_case_id, subject_person_id);
create index idx_disposition_items_classification
  on privacy.disposition_items (data_classification_code);
create index idx_disposition_items_policy on privacy.disposition_items (retention_policy_id);
create index idx_disposition_items_body_progress
  on privacy.disposition_items (target_body_progress_id);

create table privacy.disposition_events (
  id uuid not null,
  executed_at timestamptz not null,
  disposition_item_id uuid not null,
  action privacy.disposition_action not null,
  result text not null,
  actor text not null,
  constraint pk_disposition_events primary key (id, executed_at),
  constraint fk_disposition_events_item foreign key (disposition_item_id) references privacy.disposition_items(id) on delete restrict,
  -- The identifier carries its own time, so an event cannot be filed in another month.
  constraint ck_disposition_events_time check (executed_at = extensions.uuid_v7_timestamp(id)),
  constraint ck_disposition_events_result check (
    result in ('deleted', 'anonymized', 'retained', 'failed')
  ),
  constraint ck_disposition_events_actor check (actor in ('owner_request', 'privacy_worker'))
) partition by range (executed_at);

create table privacy.disposition_events_2026_09 partition of privacy.disposition_events
  for values from ('2026-09-01') to ('2026-10-01');
create table privacy.disposition_events_2026_10 partition of privacy.disposition_events
  for values from ('2026-10-01') to ('2026-11-01');
create table privacy.disposition_events_2026_11 partition of privacy.disposition_events
  for values from ('2026-11-01') to ('2026-12-01');
create table privacy.disposition_events_2026_12 partition of privacy.disposition_events
  for values from ('2026-12-01') to ('2027-01-01');
create table privacy.disposition_events_2027_01 partition of privacy.disposition_events
  for values from ('2027-01-01') to ('2027-02-01');
create table privacy.disposition_events_2027_02 partition of privacy.disposition_events
  for values from ('2027-02-01') to ('2027-03-01');
create table privacy.disposition_events_2027_03 partition of privacy.disposition_events
  for values from ('2027-03-01') to ('2027-04-01');
create table privacy.disposition_events_2027_04 partition of privacy.disposition_events
  for values from ('2027-04-01') to ('2027-05-01');
create table privacy.disposition_events_2027_05 partition of privacy.disposition_events
  for values from ('2027-05-01') to ('2027-06-01');
create table privacy.disposition_events_2027_06 partition of privacy.disposition_events
  for values from ('2027-06-01') to ('2027-07-01');
create table privacy.disposition_events_2027_07 partition of privacy.disposition_events
  for values from ('2027-07-01') to ('2027-08-01');
create table privacy.disposition_events_2027_08 partition of privacy.disposition_events
  for values from ('2027-08-01') to ('2027-09-01');
create table privacy.disposition_events_2027_09 partition of privacy.disposition_events
  for values from ('2027-09-01') to ('2027-10-01');
create table privacy.disposition_events_2027_10 partition of privacy.disposition_events
  for values from ('2027-10-01') to ('2027-11-01');
create table privacy.disposition_events_2027_11 partition of privacy.disposition_events
  for values from ('2027-11-01') to ('2027-12-01');
create table privacy.disposition_events_2027_12 partition of privacy.disposition_events
  for values from ('2027-12-01') to ('2028-01-01');
create table privacy.disposition_events_default partition of privacy.disposition_events default;

create index idx_disposition_events_item
  on privacy.disposition_events (disposition_item_id, executed_at);

-- Guards: nothing here is deleted, and nothing moves backwards.

create or replace function privacy.reject_disposition_policy_rewrite_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a published retention policy is never rewritten; publish another version'
    using errcode = '55000';
end
$function$;

create trigger trg_retention_policies_immutable
before update or delete on privacy.retention_policies
for each row execute function privacy.reject_disposition_policy_rewrite_tg();

create or replace function privacy.disposition_case_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a disposition case is never deleted' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.subject_person_id is distinct from old.subject_person_id
     or new.origin is distinct from old.origin
     or new.requested_by_person_id is distinct from old.requested_by_person_id
     or new.opened_at is distinct from old.opened_at
     or old.status = 'closed' then
    raise exception 'a disposition case keeps its subject and origin, and a closed one stays closed'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_disposition_cases_guard
before update or delete on privacy.disposition_cases
for each row execute function privacy.disposition_case_guard_tg();

create or replace function privacy.disposition_item_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  policy_classification text;
begin
  if tg_op = 'DELETE' then
    raise exception 'a disposition item is never deleted' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.disposition_case_id is distinct from old.disposition_case_id
       or new.subject_person_id is distinct from old.subject_person_id
       or new.data_classification_code is distinct from old.data_classification_code
       or new.retention_policy_id is distinct from old.retention_policy_id
       or new.action is distinct from old.action
       or new.target_kind is distinct from old.target_kind
       or new.due_at is distinct from old.due_at
       or new.created_at is distinct from old.created_at then
      raise exception 'a disposition item keeps what it disposes and under which policy'
        using errcode = '55000';
    end if;
    if not (
      (old.status = 'pending' and new.status in ('executed', 'suspended'))
      or (old.status = 'suspended' and new.status in ('pending', 'executed'))
    ) then
      raise exception 'a disposition moves forward, and an executed one is final'
        using errcode = '55000';
    end if;
    -- The only change a target may see is being released by its own execution.
    if new.target_body_progress_id is distinct from old.target_body_progress_id
       and new.target_body_progress_id is not null then
      raise exception 'a disposition never changes what it targets' using errcode = '55000';
    end if;
    return new;
  end if;

  select policy.data_classification_code into policy_classification
  from privacy.retention_policies as policy
  where policy.id = new.retention_policy_id;
  if policy_classification is distinct from new.data_classification_code
     or (new.target_kind = 'body_progress' and new.data_classification_code <> 'body') then
    raise exception 'a disposition follows the policy of the data it targets' using errcode = '23514';
  end if;

  -- IX-26: the target belongs to the subject of the case.
  if new.target_body_progress_id is not null and not exists (
    select 1 from identity.body_progress_records as record
    where record.id = new.target_body_progress_id
      and record.person_id = new.subject_person_id
  ) then
    raise exception 'a disposition targets its own subject''s data' using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger trg_disposition_items_guard
before insert or update or delete on privacy.disposition_items
for each row execute function privacy.disposition_item_guard_tg();

create or replace function privacy.reject_disposition_event_rewrite_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a disposition event is append-only' using errcode = '55000';
end
$function$;

create trigger trg_disposition_events_append_only
before update or delete on privacy.disposition_events
for each row execute function privacy.reject_disposition_event_rewrite_tg();

-- The only way in: the caller supplies neither the identifier nor the time.
create or replace function privacy.log_disposition_event(
  p_item_id uuid,
  p_action privacy.disposition_action,
  p_result text,
  p_actor text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  event_id uuid := extensions.uuid_generate_v7();
begin
  insert into privacy.disposition_events (id, executed_at, disposition_item_id, action, result, actor)
  values (event_id, extensions.uuid_v7_timestamp(event_id), p_item_id, p_action, p_result, p_actor);
  return event_id;
end
$function$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table identity.body_progress_metrics enable row level security;
alter table identity.body_progress_metrics force row level security;
alter table identity.body_progress_records enable row level security;
alter table identity.body_progress_records force row level security;
alter table privacy.retention_policies enable row level security;
alter table privacy.retention_policies force row level security;
alter table privacy.disposition_cases enable row level security;
alter table privacy.disposition_cases force row level security;
alter table privacy.disposition_items enable row level security;
alter table privacy.disposition_items force row level security;
alter table privacy.disposition_events enable row level security;
alter table privacy.disposition_events force row level security;
alter table privacy.disposition_events_2026_09 enable row level security;
alter table privacy.disposition_events_2026_09 force row level security;
alter table privacy.disposition_events_2026_10 enable row level security;
alter table privacy.disposition_events_2026_10 force row level security;
alter table privacy.disposition_events_2026_11 enable row level security;
alter table privacy.disposition_events_2026_11 force row level security;
alter table privacy.disposition_events_2026_12 enable row level security;
alter table privacy.disposition_events_2026_12 force row level security;
alter table privacy.disposition_events_2027_01 enable row level security;
alter table privacy.disposition_events_2027_01 force row level security;
alter table privacy.disposition_events_2027_02 enable row level security;
alter table privacy.disposition_events_2027_02 force row level security;
alter table privacy.disposition_events_2027_03 enable row level security;
alter table privacy.disposition_events_2027_03 force row level security;
alter table privacy.disposition_events_2027_04 enable row level security;
alter table privacy.disposition_events_2027_04 force row level security;
alter table privacy.disposition_events_2027_05 enable row level security;
alter table privacy.disposition_events_2027_05 force row level security;
alter table privacy.disposition_events_2027_06 enable row level security;
alter table privacy.disposition_events_2027_06 force row level security;
alter table privacy.disposition_events_2027_07 enable row level security;
alter table privacy.disposition_events_2027_07 force row level security;
alter table privacy.disposition_events_2027_08 enable row level security;
alter table privacy.disposition_events_2027_08 force row level security;
alter table privacy.disposition_events_2027_09 enable row level security;
alter table privacy.disposition_events_2027_09 force row level security;
alter table privacy.disposition_events_2027_10 enable row level security;
alter table privacy.disposition_events_2027_10 force row level security;
alter table privacy.disposition_events_2027_11 enable row level security;
alter table privacy.disposition_events_2027_11 force row level security;
alter table privacy.disposition_events_2027_12 enable row level security;
alter table privacy.disposition_events_2027_12 force row level security;
alter table privacy.disposition_events_default enable row level security;
alter table privacy.disposition_events_default force row level security;

create policy body_progress_metrics_all_owner
  on identity.body_progress_metrics
  for all to allfit_owner using (true) with check (true);
create policy body_progress_records_all_owner
  on identity.body_progress_records
  for all to allfit_owner using (true) with check (true);
create policy retention_policies_all_owner
  on privacy.retention_policies
  for all to allfit_owner using (true) with check (true);
create policy disposition_cases_all_owner
  on privacy.disposition_cases
  for all to allfit_owner using (true) with check (true);
create policy disposition_items_all_owner
  on privacy.disposition_items
  for all to allfit_owner using (true) with check (true);
create policy disposition_events_all_owner
  on privacy.disposition_events
  for all to allfit_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Who the token belongs to
-- ---------------------------------------------------------------------------

-- The subject resolves to a person here, never in the API: an account without a Fitness
-- ID, or a closed person, writes and reads nothing. Resolving is also what establishes
-- the actor, transaction-locally, since the API cannot know the person before this.
create or replace function identity.require_space_person(
  p_provider text,
  p_issuer text,
  p_subject text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  resolved uuid;
begin
  select person.id into resolved
  from identity.access_accounts as account
  join identity.people as person on person.id = account.person_id
  where account.provider = p_provider
    and account.issuer = p_issuer
    and account.subject = p_subject
    and person.status = 'active';

  if resolved is null then
    raise exception 'no active person behind this token' using errcode = '42501';
  end if;

  perform set_config('app.actor_kind', 'person', true);
  perform set_config('app.actor_person_id', resolved::text, true);
  return resolved;
end
$function$;

create or replace function identity.body_progress_projection(p_record_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', record.id,
    'metric_code', record.metric_code,
    'value', record.value_numeric,
    'unit_code', record.unit_code,
    'original_value', record.original_value,
    'original_unit_code', record.original_unit_code,
    'measured_on', record.measured_on,
    'has_media', record.has_media,
    'recorded_at', record.created_at
  )
  from identity.body_progress_records as record
  where record.id = p_record_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-006 — record a measurement
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- My measurements
-- ---------------------------------------------------------------------------

create or replace function identity.list_body_progress(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_limit integer,
  p_before_measured_on date default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  page jsonb;
  more boolean;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);
  if p_limit is null or p_limit < 1 or p_limit > 200
     or (p_before_measured_on is null) <> (p_before_id is null) then
    raise exception 'a page has a size and, after the first, a complete cursor' using errcode = '22023';
  end if;

  with ordered as (
    select record.id, record.measured_on,
           row_number() over (order by record.measured_on desc, record.id desc) as position
    from identity.body_progress_records as record
    where record.person_id = person
      and (
        p_before_measured_on is null
        or (record.measured_on, record.id) < (p_before_measured_on, p_before_id)
      )
    order by record.measured_on desc, record.id desc
    limit p_limit + 1
  )
  select
    coalesce(
      jsonb_agg(identity.body_progress_projection(ordered.id) order by ordered.position)
        filter (where ordered.position <= p_limit),
      '[]'::jsonb
    ),
    count(*) > p_limit
  into page, more
  from ordered;

  return jsonb_build_object('items', page, 'has_more', more);
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-007 — delete a measurement
-- ---------------------------------------------------------------------------

create or replace function identity.delete_body_progress(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_record_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
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
  target_id uuid;
  policy_id uuid;
  case_id uuid;
  item_id uuid;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-IDN-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent deletion not found' using errcode = '40001';
    end if;
    return query select jsonb_build_object(
      'body_progress_record_id', p_record_id,
      'disposition_case_id', receipt.aggregate_id,
      'status', 'deleted'
    ), true;
    return;
  end if;

  -- Someone else's record and a record that does not exist answer the same.
  select record.id into target_id
  from identity.body_progress_records as record
  where record.id = p_record_id and record.person_id = person
  for update;
  if target_id is null then
    raise exception 'measurement not found' using errcode = 'P0002';
  end if;

  select policy.id into policy_id
  from privacy.retention_policies as policy
  where policy.data_classification_code = 'body'
    and policy.jurisdiction = 'CO'
    and policy.trigger = 'owner_request'
  order by policy.version_number desc
  limit 1;
  if policy_id is null then
    raise exception 'no published policy disposes of this data' using errcode = '55000';
  end if;

  insert into privacy.disposition_cases (subject_person_id, origin, requested_by_person_id)
  values (person, 'request', person)
  returning id into case_id;

  insert into privacy.disposition_items (
    disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
    action, target_kind, target_body_progress_id
  ) values (
    case_id, person, 'body', policy_id, 'delete', 'body_progress', target_id
  )
  returning id into item_id;

  perform system.enqueue_outbox_event(
    'disposition_case', case_id, 'privacy.disposition_case_opened.v1',
    jsonb_build_object('disposition_case_id', case_id, 'origin', 'request')
  );

  -- The owner asked and the policy retains nothing, so it is executed now.
  perform privacy.log_disposition_event(item_id, 'delete', 'deleted', 'owner_request');

  update privacy.disposition_items as item
  set status = 'executed', executed_at = clock_timestamp(), target_body_progress_id = null
  where item.id = item_id;

  delete from identity.body_progress_records as record where record.id = target_id;

  update privacy.disposition_cases as dcase
  set status = 'closed', closed_at = clock_timestamp()
  where dcase.id = case_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'body-progress-deleted', 'disposition_case', case_id
  );
  return query select jsonb_build_object(
    'body_progress_record_id', p_record_id,
    'disposition_case_id', case_id,
    'status', 'deleted'
  ), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-003 — a restricted window now reads body progress
-- ---------------------------------------------------------------------------

create or replace function support.exercise_break_glass(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_request_id uuid,
  p_category text,
  p_resource_type text,
  p_resource_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  duty_id uuid;
  file support.break_glass_requests%rowtype;
  approvals integer;
  denial text;
  event_id uuid;
  occurred timestamptz := clock_timestamp();
begin
  -- The only raise before the evidence is written: without a file there is
  -- nothing to attach an event to, so there is no evidence to lose.
  select * into file from support.break_glass_requests where id = p_request_id;
  if file.id is null then
    raise exception 'break-glass request not found' using errcode = 'P0002';
  end if;

  duty_id := file.requester_duty_assignment_id;

  select count(*) into approvals
  from support.break_glass_approvals as approval
  where approval.request_id = p_request_id and approval.decision = 'approved';

  -- Each refusal carries its own reason. A category that now returns content reads
  -- only its own kind of data, so a body window cannot be pointed at meals.
  denial := case
    when file.requester_person_id <> p_actor_person_id then 'not_the_requester'
    when not access_control.has_platform_role(
      p_actor_person_id, p_actor_session_id, 'allfit_admin'
    ) or not access_control.has_platform_duty(
      p_actor_person_id, p_actor_session_id, 'request_break_glass'
    ) then 'duty_not_effective'
    when support.effective_break_glass_status(
      file.status, file.request_expires_at, file.window_ends_at
    ) <> 'approved' then 'window_not_open'
    when approvals < file.required_approvals then 'quorum_incomplete'
    when not (p_category = any (file.categories)) then 'category_out_of_scope'
    when p_category = 'body_progress'
      and p_resource_type <> 'identity.body_progress_records' then 'resource_out_of_scope'
    else null
  end;

  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, resource_id, purpose, result,
    request_id, access_mode, occurred_at
  ) values (
    p_actor_person_id, file.subject_person_id, p_resource_type, p_resource_id,
    file.purpose::text, case when denial is null then 'allowed' else 'denied' end,
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    'break_glass'::privacy.access_mode, occurred
  )
  returning id into event_id;

  insert into support.break_glass_events (
    request_id, requester_person_id, requester_duty_assignment_id, subject_person_id,
    category, result, resource_type, resource_id, operation_code, reason_code,
    occurred_at, access_event_id, access_event_occurred_at
  ) values (
    p_request_id, file.requester_person_id, file.requester_duty_assignment_id,
    file.subject_person_id, p_category,
    case when denial is null then 'allowed' else 'denied' end,
    p_resource_type, p_resource_id, 'OP-SUP-003',
    coalesce(denial, 'authorized_exercise'), occurred, event_id, occurred
  );

  -- Returned, never raised: the evidence above has to survive the refusal.
  if denial is not null then
    return jsonb_build_object(
      'outcome', 'denied',
      'reason_code', denial,
      'break_glass_event_id', event_id,
      'occurred_at', occurred
    );
  end if;

  if p_category = 'body_progress' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'body_progress', coalesce(
          (
            select jsonb_agg(
              identity.body_progress_projection(latest.id)
              order by latest.measured_on desc, latest.id desc
            )
            from (
              select record.id, record.measured_on
              from identity.body_progress_records as record
              where record.person_id = file.subject_person_id
              order by record.measured_on desc, record.id desc
              limit 500
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  -- The categories whose data does not exist yet stay honest about it.
  return jsonb_build_object(
    'outcome', 'content_unavailable',
    'reason_code', 'execution_and_nutrition_absent',
    'break_glass_event_id', event_id,
    'occurred_at', occurred,
    'category', p_category
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter table identity.body_progress_metrics owner to allfit_owner;
alter table identity.body_progress_records owner to allfit_owner;
alter table privacy.retention_policies owner to allfit_owner;
alter table privacy.disposition_cases owner to allfit_owner;
alter table privacy.disposition_items owner to allfit_owner;
alter table privacy.disposition_events owner to allfit_owner;
alter table privacy.disposition_events_2026_09 owner to allfit_owner;
alter table privacy.disposition_events_2026_10 owner to allfit_owner;
alter table privacy.disposition_events_2026_11 owner to allfit_owner;
alter table privacy.disposition_events_2026_12 owner to allfit_owner;
alter table privacy.disposition_events_2027_01 owner to allfit_owner;
alter table privacy.disposition_events_2027_02 owner to allfit_owner;
alter table privacy.disposition_events_2027_03 owner to allfit_owner;
alter table privacy.disposition_events_2027_04 owner to allfit_owner;
alter table privacy.disposition_events_2027_05 owner to allfit_owner;
alter table privacy.disposition_events_2027_06 owner to allfit_owner;
alter table privacy.disposition_events_2027_07 owner to allfit_owner;
alter table privacy.disposition_events_2027_08 owner to allfit_owner;
alter table privacy.disposition_events_2027_09 owner to allfit_owner;
alter table privacy.disposition_events_2027_10 owner to allfit_owner;
alter table privacy.disposition_events_2027_11 owner to allfit_owner;
alter table privacy.disposition_events_2027_12 owner to allfit_owner;
alter table privacy.disposition_events_default owner to allfit_owner;
alter type privacy.disposition_action owner to allfit_owner;
alter type privacy.disposition_status owner to allfit_owner;

alter function identity.body_progress_record_guard_tg() owner to allfit_owner;
alter function privacy.reject_disposition_policy_rewrite_tg() owner to allfit_owner;
alter function privacy.disposition_case_guard_tg() owner to allfit_owner;
alter function privacy.disposition_item_guard_tg() owner to allfit_owner;
alter function privacy.reject_disposition_event_rewrite_tg() owner to allfit_owner;
alter function privacy.log_disposition_event(uuid, privacy.disposition_action, text, text)
  owner to allfit_owner;
alter function identity.require_space_person(text, text, text) owner to allfit_owner;
alter function identity.body_progress_projection(uuid) owner to allfit_owner;
alter function identity.record_body_progress(
  text, text, text, uuid, text, numeric, text, date, uuid, bytea
) owner to allfit_owner;
alter function identity.list_body_progress(text, text, text, integer, date, uuid)
  owner to allfit_owner;
alter function identity.delete_body_progress(text, text, text, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  owner to allfit_owner;

revoke all on function identity.body_progress_record_guard_tg() from public;
revoke all on function privacy.reject_disposition_policy_rewrite_tg() from public;
revoke all on function privacy.disposition_case_guard_tg() from public;
revoke all on function privacy.disposition_item_guard_tg() from public;
revoke all on function privacy.reject_disposition_event_rewrite_tg() from public;
revoke all on function privacy.log_disposition_event(uuid, privacy.disposition_action, text, text)
  from public;
revoke all on function identity.require_space_person(text, text, text) from public;
revoke all on function identity.body_progress_projection(uuid) from public;
revoke all on function identity.record_body_progress(
  text, text, text, uuid, text, numeric, text, date, uuid, bytea
) from public;
revoke all on function identity.list_body_progress(text, text, text, integer, date, uuid)
  from public;
revoke all on function identity.delete_body_progress(text, text, text, uuid, uuid, uuid, bytea)
  from public;
revoke all on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  from public;

grant execute on function identity.record_body_progress(
  text, text, text, uuid, text, numeric, text, date, uuid, bytea
) to allfit_api;
grant execute on function identity.list_body_progress(text, text, text, integer, date, uuid)
  to allfit_api;
grant execute on function identity.delete_body_progress(text, text, text, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  to allfit_api;
