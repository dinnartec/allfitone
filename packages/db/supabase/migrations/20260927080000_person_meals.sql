-- OP-NUT-001, OP-NUT-002, OP-NUT-004 and OP-SUP-003 over meals — what a person ate, deleting
-- it, and support reading it through a restricted window (`HU-SP-067`, `HU-SP-068`,
-- `HU-SP-070`, `HU-BO-009`).
--
-- **A meal is recorded whole or not at all.** One function writes the meal, its items and
-- their nutrient values in one transaction; any invalid part rolls all of it back. Nutrients
-- come only from the published V1 catalogue, each in its one canonical unit and never
-- negative (`IX-29`), and every child row carries its meal and its person (`IX-28`). The
-- moment, the zone and the day it belongs to are fixed at recording: the day is the day in
-- that zone, so a dinner at 18:30 in Bogotá is not filed under tomorrow in UTC.
--
-- The shapes are the published contract's: the client numbers its items, a nutrient carries
-- its `unit` and an item its `quantity_unit`, and a page is a range of local days.
--
-- **Not built here.** Revising a meal and its photo (OP-NUT-003) and the daily summaries
-- (OP-NUT-005) are their own pieces. Until revision exists a recorded meal is not rewritten,
-- and no photo is accepted, so a meal never claims one.
--
-- **Deleting a meal takes its items and values with it** through the shared owner
-- disposition, under the nutrition policy, and announces `nutrition.meal_deleted.v1`.
--
-- **Support reads meals only through its own restricted window**, and a nutrition intake
-- window refuses to be pointed at any other kind of data.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists nutrition authorization allfit_owner;
grant usage on schema nutrition to allfit_api;

-- ---------------------------------------------------------------------------
-- Units and the nutrient catalogue
-- ---------------------------------------------------------------------------

-- A gram is a mass like any other; energy and volume get their own canonical units.
insert into catalog.units (code, dimension, is_canonical, to_canonical_factor)
values
  ('g', 'mass', false, 0.001),
  ('kcal', 'energy', true, 1),
  ('ml', 'volume', true, 1);

create type nutrition.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack', 'other');

create table nutrition.nutrient_definitions (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  canonical_unit_code text not null,
  maximum_value numeric not null,
  status catalog.publication_status not null default 'published',
  published_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_nutrient_definitions primary key (id),
  constraint uq_nutrient_definitions_code unique (code),
  constraint fk_nutrient_definitions_unit foreign key (canonical_unit_code) references catalog.units(code) on delete restrict,
  -- The closed V1 catalogue: each code with the only unit it is ever written in.
  constraint ck_nutrient_definitions_code_unit check (
    (code, canonical_unit_code) in (
      ('energy', 'kcal'), ('protein', 'g'), ('carbohydrates', 'g'), ('fat', 'g'),
      ('fiber', 'g'), ('water', 'ml')
    )
  ),
  constraint ck_nutrient_definitions_name check (btrim(name) <> '' and char_length(name) <= 60),
  -- Per item; it rejects typos, not large meals.
  constraint ck_nutrient_definitions_maximum check (maximum_value > 0)
);

create index idx_nutrient_definitions_status on nutrition.nutrient_definitions (status, code);
create index idx_nutrient_definitions_unit on nutrition.nutrient_definitions (canonical_unit_code);

insert into nutrition.nutrient_definitions (code, name, canonical_unit_code, maximum_value)
values
  ('energy', 'Energía', 'kcal', 10000),
  ('protein', 'Proteína', 'g', 1000),
  ('carbohydrates', 'Carbohidratos', 'g', 2000),
  ('fat', 'Grasa', 'g', 1000),
  ('fiber', 'Fibra', 'g', 500),
  ('water', 'Agua', 'ml', 10000);

create or replace function nutrition.reject_nutrient_rewrite_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a published nutrient is never rewritten; the history uses it'
    using errcode = '55000';
end
$function$;

create trigger trg_nutrient_definitions_immutable
before update or delete on nutrition.nutrient_definitions
for each row execute function nutrition.reject_nutrient_rewrite_tg();

-- ---------------------------------------------------------------------------
-- Meals
-- ---------------------------------------------------------------------------

create table nutrition.meals (
  id uuid not null,
  person_id uuid not null,
  occurred_at timestamptz not null,
  timezone text not null,
  local_date date not null,
  meal_type nutrition.meal_type not null,
  note text,
  revision_number integer not null default 0,
  media_ref text,
  has_media boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_meals primary key (id),
  constraint uq_meals_person unique (id, person_id),
  constraint fk_meals_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint ck_meals_revision check (revision_number >= 0),
  constraint ck_meals_media check (has_media = (media_ref is not null)),
  constraint ck_meals_note check (note is null or (btrim(note) <> '' and char_length(note) <= 1000)),
  constraint ck_meals_timezone check (char_length(timezone) between 3 and 100)
);

create index idx_meals_person on nutrition.meals (person_id, occurred_at desc, id desc);
create index idx_meals_person_day on nutrition.meals (person_id, local_date);

create or replace function nutrition.meal_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a recorded meal is not rewritten until revising it exists' using errcode = '55000';
  end if;

  if not exists (select 1 from pg_timezone_names as zone where zone.name = new.timezone) then
    raise exception 'a meal happens in a real time zone' using errcode = '23514';
  end if;
  if new.local_date <> (new.occurred_at at time zone new.timezone)::date then
    raise exception 'the day of a meal is the day of its moment in its zone' using errcode = '23514';
  end if;
  return new;
end
$function$;

create trigger trg_meals_guard
before insert or update on nutrition.meals
for each row execute function nutrition.meal_guard_tg();

create table nutrition.meal_items (
  id uuid not null default extensions.uuid_generate_v7(),
  meal_id uuid not null,
  person_id uuid not null,
  position integer not null,
  name text not null,
  quantity_numeric numeric(12, 3),
  quantity_unit_code text,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_meal_items primary key (id),
  constraint uq_meal_items_carrier unique (id, meal_id, person_id),
  constraint uq_meal_items_person unique (id, person_id),
  constraint uq_meal_items_position unique (meal_id, position),
  constraint fk_meal_items_meal foreign key (meal_id, person_id) references nutrition.meals(id, person_id) on delete cascade,
  constraint fk_meal_items_unit foreign key (quantity_unit_code) references catalog.units(code) on delete restrict,
  constraint ck_meal_items_position check (position between 1 and 100),
  constraint ck_meal_items_name check (btrim(name) <> '' and char_length(name) <= 160),
  constraint ck_meal_items_quantity check (
    (quantity_numeric is null) = (quantity_unit_code is null)
    and (quantity_numeric is null or quantity_numeric > 0)
  )
);

create index idx_meal_items_meal on nutrition.meal_items (meal_id, person_id);
create index idx_meal_items_unit on nutrition.meal_items (quantity_unit_code);

create or replace function nutrition.meal_item_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE' then
    raise exception 'an item changes only with its meal''s revision' using errcode = '55000';
  end if;
  if new.quantity_unit_code is not null and not exists (
    select 1 from catalog.units as unit
    where unit.code = new.quantity_unit_code and unit.dimension in ('mass', 'volume')
  ) then
    raise exception 'a quantity is a mass or a volume' using errcode = '23514';
  end if;
  return new;
end
$function$;

create trigger trg_meal_items_guard
before insert or update on nutrition.meal_items
for each row execute function nutrition.meal_item_guard_tg();

create table nutrition.meal_nutrient_values (
  id uuid not null default extensions.uuid_generate_v7(),
  meal_item_id uuid not null,
  meal_id uuid not null,
  person_id uuid not null,
  nutrient_definition_id uuid not null,
  value_numeric numeric(12, 3) not null,
  unit_code text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_meal_nutrient_values primary key (id),
  constraint uq_meal_nutrient_values_item unique (meal_item_id, nutrient_definition_id),
  constraint fk_meal_nutrient_values_item foreign key (meal_item_id, meal_id, person_id) references nutrition.meal_items(id, meal_id, person_id) on delete cascade,
  constraint fk_meal_nutrient_values_meal foreign key (meal_id, person_id) references nutrition.meals(id, person_id) on delete cascade,
  constraint fk_meal_nutrient_values_nutrient foreign key (nutrient_definition_id) references nutrition.nutrient_definitions(id) on delete restrict,
  constraint fk_meal_nutrient_values_unit foreign key (unit_code) references catalog.units(code) on delete restrict,
  constraint ck_meal_nutrient_values_value check (value_numeric >= 0)
);

create index idx_meal_nutrient_values_item
  on nutrition.meal_nutrient_values (meal_item_id, meal_id, person_id);
create index idx_meal_nutrient_values_meal on nutrition.meal_nutrient_values (meal_id, person_id);
create index idx_meal_nutrient_values_nutrient
  on nutrition.meal_nutrient_values (nutrient_definition_id);
create index idx_meal_nutrient_values_unit on nutrition.meal_nutrient_values (unit_code);

create or replace function nutrition.reject_nutrient_value_rewrite_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a nutrient value changes only with its meal''s revision' using errcode = '55000';
end
$function$;

create trigger trg_meal_nutrient_values_immutable
before update on nutrition.meal_nutrient_values
for each row execute function nutrition.reject_nutrient_value_rewrite_tg();

-- IX-29: deferrable so a future revision can replace rows in any order; immediate by default.
create or replace function nutrition.enforce_nutrient_unit_ct()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if not exists (
    select 1 from nutrition.nutrient_definitions as nutrient
    where nutrient.id = new.nutrient_definition_id
      and nutrient.canonical_unit_code = new.unit_code
      and nutrient.status = 'published'
  ) then
    raise exception 'a nutrient value is written in the unit its definition publishes'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create constraint trigger trg_meal_nutrient_values_unit
after insert or update on nutrition.meal_nutrient_values
deferrable initially immediate
for each row execute function nutrition.enforce_nutrient_unit_ct();

insert into privacy.retention_policies (
  data_classification_code, jurisdiction, version_number, default_action, retention_period, trigger
) values ('nutrition', 'CO', 1, 'delete', interval '0', 'owner_request');

-- ---------------------------------------------------------------------------
-- The disposition learns meals
-- ---------------------------------------------------------------------------

alter table privacy.disposition_items add column target_nutrition_meal_id uuid;

alter table privacy.disposition_items
  add constraint fk_disposition_items_nutrition_meal foreign key (target_nutrition_meal_id) references nutrition.meals(id) on delete restrict;

create index idx_disposition_items_nutrition_meal
  on privacy.disposition_items (target_nutrition_meal_id);

alter table privacy.disposition_items drop constraint ck_disposition_items_target_kind;
alter table privacy.disposition_items
  add constraint ck_disposition_items_target_kind check (
    target_kind in ('body_progress', 'health_context', 'nutrition_meal')
  );

-- An executed deletion releases its target; anything else holds exactly one, of its kind.
alter table privacy.disposition_items drop constraint ck_disposition_items_target;
alter table privacy.disposition_items
  add constraint ck_disposition_items_target check (
    case
      when status = 'executed' and action = 'delete'
        then num_nonnulls(
          target_body_progress_id, target_health_context_id, target_nutrition_meal_id
        ) = 0
      else num_nonnulls(
          target_body_progress_id, target_health_context_id, target_nutrition_meal_id
        ) = 1
        and case target_kind
          when 'body_progress' then target_body_progress_id is not null
          when 'health_context' then target_health_context_id is not null
          when 'nutrition_meal' then target_nutrition_meal_id is not null
          else false
        end
    end
  );

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
    if (new.target_body_progress_id is distinct from old.target_body_progress_id
        and new.target_body_progress_id is not null)
       or (new.target_health_context_id is distinct from old.target_health_context_id
        and new.target_health_context_id is not null)
       or (new.target_nutrition_meal_id is distinct from old.target_nutrition_meal_id
        and new.target_nutrition_meal_id is not null) then
      raise exception 'a disposition never changes what it targets' using errcode = '55000';
    end if;
    return new;
  end if;

  select policy.data_classification_code into policy_classification
  from privacy.retention_policies as policy
  where policy.id = new.retention_policy_id;
  if policy_classification is distinct from new.data_classification_code
     or (new.target_kind = 'body_progress' and new.data_classification_code <> 'body')
     or (new.target_kind = 'health_context' and new.data_classification_code <> 'health')
     or (new.target_kind = 'nutrition_meal' and new.data_classification_code <> 'nutrition') then
    raise exception 'a disposition follows the policy of the data it targets' using errcode = '23514';
  end if;

  -- IX-26: the target belongs to the subject of the case.
  if (new.target_body_progress_id is not null and not exists (
        select 1 from identity.body_progress_records as record
        where record.id = new.target_body_progress_id
          and record.person_id = new.subject_person_id
      ))
     or (new.target_health_context_id is not null and not exists (
        select 1 from identity.health_context_claims as claim
        where claim.id = new.target_health_context_id
          and claim.person_id = new.subject_person_id
      ))
     or (new.target_nutrition_meal_id is not null and not exists (
        select 1 from nutrition.meals as meal
        where meal.id = new.target_nutrition_meal_id
          and meal.person_id = new.subject_person_id
      )) then
    raise exception 'a disposition targets its own subject''s data' using errcode = '23514';
  end if;

  return new;
end
$function$;

create or replace function privacy.dispose_on_owner_request(
  p_subject_person_id uuid,
  p_classification text,
  p_target_kind text,
  p_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  policy_id uuid;
  case_id uuid;
  item_id uuid;
begin
  select policy.id into policy_id
  from privacy.retention_policies as policy
  where policy.data_classification_code = p_classification
    and policy.jurisdiction = 'CO'
    and policy.trigger = 'owner_request'
    and policy.default_action = 'delete'
  order by policy.version_number desc
  limit 1;
  if policy_id is null then
    raise exception 'no published policy deletes this data on request' using errcode = '55000';
  end if;

  insert into privacy.disposition_cases (subject_person_id, origin, requested_by_person_id)
  values (p_subject_person_id, 'request', p_subject_person_id)
  returning id into case_id;

  insert into privacy.disposition_items (
    disposition_case_id, subject_person_id, data_classification_code, retention_policy_id,
    action, target_kind, target_body_progress_id, target_health_context_id,
    target_nutrition_meal_id
  ) values (
    case_id, p_subject_person_id, p_classification, policy_id, 'delete', p_target_kind,
    case when p_target_kind = 'body_progress' then p_target_id end,
    case when p_target_kind = 'health_context' then p_target_id end,
    case when p_target_kind = 'nutrition_meal' then p_target_id end
  )
  returning id into item_id;

  perform system.enqueue_outbox_event(
    'disposition_case', case_id, 'privacy.disposition_case_opened.v1',
    jsonb_build_object('disposition_case_id', case_id, 'origin', 'request')
  );

  perform privacy.log_disposition_event(item_id, 'delete', 'deleted', 'owner_request');

  update privacy.disposition_items as item
  set status = 'executed',
      executed_at = clock_timestamp(),
      target_body_progress_id = null,
      target_health_context_id = null,
      target_nutrition_meal_id = null
  where item.id = item_id;

  update privacy.disposition_cases as dcase
  set status = 'closed', closed_at = clock_timestamp()
  where dcase.id = case_id;

  return case_id;
end
$function$;

-- ---------------------------------------------------------------------------
-- What a meal looks like outside its tables
-- ---------------------------------------------------------------------------

create or replace function nutrition.meal_projection(p_meal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', meal.id,
    'occurred_at', meal.occurred_at,
    'timezone', meal.timezone,
    'local_date', meal.local_date,
    'meal_type', meal.meal_type,
    'note', meal.note,
    'revision_number', meal.revision_number,
    'has_media', meal.has_media,
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'position', item.position,
            'name', item.name,
            'quantity', item.quantity_numeric,
            'quantity_unit', item.quantity_unit_code,
            'nutrients', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'nutrient_code', nutrient.code,
                    'value', value.value_numeric,
                    'unit', value.unit_code
                  )
                  order by nutrient.code
                )
                from nutrition.meal_nutrient_values as value
                join nutrition.nutrient_definitions as nutrient
                  on nutrient.id = value.nutrient_definition_id
                where value.meal_item_id = item.id
              ),
              '[]'::jsonb
            )
          )
          order by item.position
        )
        from nutrition.meal_items as item
        where item.meal_id = meal.id
      ),
      '[]'::jsonb
    )
  )
  from nutrition.meals as meal
  where meal.id = p_meal_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-NUT-001 — record a meal
-- ---------------------------------------------------------------------------

create or replace function nutrition.record_meal(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_meal_id uuid,
  p_occurred_at timestamptz,
  p_timezone text,
  p_meal_type text,
  p_note text,
  p_items jsonb,
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
  words text := nullif(btrim(p_note), '');
  entry jsonb;
  entry_position integer;
  item_name text;
  quantity numeric;
  quantity_unit text;
  item_id uuid;
  numbers integer[] := array[]::integer[];
  nutrient_entry jsonb;
  nutrient nutrition.nutrient_definitions%rowtype;
  amount numeric;
  seen text[];
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  if p_meal_id is null then
    raise exception 'a meal is identified by its command' using errcode = '22023';
  end if;
  if p_occurred_at is null
     or p_occurred_at > clock_timestamp() + interval '1 day'
     or p_occurred_at < timestamptz '1900-01-01 00:00:00+00' then
    raise exception 'a meal happened on a real day, not a future one' using errcode = '22023';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_timezone_names as zone where zone.name = p_timezone) then
    raise exception 'a meal happens in a real time zone' using errcode = '22023';
  end if;
  if p_meal_type is null
     or not (p_meal_type = any (enum_range(null::nutrition.meal_type)::text[])) then
    raise exception 'a meal is one of the five kinds' using errcode = '22023';
  end if;
  if p_note is not null and (words is null or char_length(words) > 1000) then
    raise exception 'a note says something, briefly' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'a meal has between one and a hundred items' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-NUT-001', p_idempotency_key, p_meal_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent meal not found' using errcode = '40001';
    end if;
    -- Allfit-defined: the command ran, and the meal it recorded has been deleted since.
    if not exists (select 1 from nutrition.meals as meal where meal.id = receipt.aggregate_id) then
      raise exception 'the meal this command recorded was deleted' using errcode = 'AF410';
    end if;
    return query select nutrition.meal_projection(receipt.aggregate_id), true;
    return;
  end if;

  insert into nutrition.meals (id, person_id, occurred_at, timezone, local_date, meal_type, note)
  values (
    p_meal_id, person, p_occurred_at, p_timezone,
    (p_occurred_at at time zone p_timezone)::date, p_meal_type::nutrition.meal_type, words
  );

  -- Any invalid part raises, and the whole meal with its receipt rolls back.
  for entry in select element.value from jsonb_array_elements(p_items) as element(value) loop
    if jsonb_typeof(entry) <> 'object'
       or jsonb_typeof(entry->'position') is distinct from 'number'
       or jsonb_typeof(entry->'name') is distinct from 'string'
       or jsonb_typeof(entry->'nutrients') is distinct from 'array'
       or jsonb_array_length(entry->'nutrients') > 6 then
      raise exception 'an item has a position, a name and a list of nutrients' using errcode = '22023';
    end if;
    -- The client numbers its items; a number is used once and fits the meal.
    if (entry->>'position')::numeric not between 1 and 100
       or (entry->>'position')::numeric <> trunc((entry->>'position')::numeric) then
      raise exception 'an item position is a whole number from 1 to 100' using errcode = '22023';
    end if;
    entry_position := (entry->>'position')::integer;
    if entry_position = any (numbers) then
      raise exception 'two items cannot share a position' using errcode = '22023';
    end if;
    numbers := numbers || entry_position;
    item_name := btrim(entry->>'name');
    if item_name = '' or char_length(item_name) > 160 then
      raise exception 'an item has a short name' using errcode = '22023';
    end if;

    quantity := null;
    quantity_unit := null;
    if coalesce(jsonb_typeof(entry->'quantity'), 'null') <> 'null'
       or coalesce(jsonb_typeof(entry->'quantity_unit'), 'null') <> 'null' then
      if jsonb_typeof(entry->'quantity') is distinct from 'number'
         or jsonb_typeof(entry->'quantity_unit') is distinct from 'string' then
        raise exception 'a quantity comes with its unit' using errcode = '22023';
      end if;
      quantity := (entry->>'quantity')::numeric;
      quantity_unit := entry->>'quantity_unit';
      if quantity <= 0 or quantity > 100000 or not exists (
        select 1 from catalog.units as unit
        where unit.code = quantity_unit and unit.dimension in ('mass', 'volume')
      ) then
        raise exception 'a quantity is a positive mass or volume' using errcode = '22023';
      end if;
    end if;

    insert into nutrition.meal_items (
      meal_id, person_id, position, name, quantity_numeric, quantity_unit_code
    ) values (p_meal_id, person, entry_position, item_name, quantity, quantity_unit)
    returning id into item_id;

    seen := array[]::text[];
    for nutrient_entry in select value from jsonb_array_elements(entry->'nutrients') loop
      if jsonb_typeof(nutrient_entry) <> 'object'
         or jsonb_typeof(nutrient_entry->'value') is distinct from 'number' then
        raise exception 'a nutrient has a numeric value' using errcode = '22023';
      end if;
      select * into nutrient from nutrition.nutrient_definitions as candidate
      where candidate.code = nutrient_entry->>'nutrient_code' and candidate.status = 'published';
      if nutrient.id is null then
        raise exception 'that nutrient is not in the catalogue' using errcode = '22023';
      end if;
      if nutrient.code = any (seen) then
        raise exception 'an item says each nutrient once' using errcode = '22023';
      end if;
      seen := seen || nutrient.code;
      if nutrient_entry->>'unit' is distinct from nutrient.canonical_unit_code then
        raise exception 'a nutrient is written in its own unit' using errcode = '22023';
      end if;
      amount := (nutrient_entry->>'value')::numeric;
      if amount < 0 or amount > nutrient.maximum_value then
        raise exception 'a nutrient value is not negative and within reason' using errcode = '22023';
      end if;

      insert into nutrition.meal_nutrient_values (
        meal_item_id, meal_id, person_id, nutrient_definition_id, value_numeric, unit_code
      ) values (item_id, p_meal_id, person, nutrient.id, amount, nutrient.canonical_unit_code);
    end loop;
  end loop;

  -- That a meal exists, never what was eaten.
  perform system.enqueue_outbox_event(
    'meal', p_meal_id, 'nutrition.meal_recorded.v1', jsonb_build_object('meal_id', p_meal_id)
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'meal-recorded', 'meal', p_meal_id
  );
  return query select nutrition.meal_projection(p_meal_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-NUT-002 — my meals
-- ---------------------------------------------------------------------------

create or replace function nutrition.list_meals(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_from date,
  p_to date,
  p_limit integer,
  p_before_occurred_at timestamptz default null,
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
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_before_occurred_at is null) <> (p_before_id is null) then
    raise exception 'a page has a size and, after the first, a complete cursor' using errcode = '22023';
  end if;
  -- The local days of the person's own meals, at most a month of them per read.
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'a page covers from one to thirty-one days' using errcode = '22023';
  end if;

  with ordered as (
    select meal.id,
           row_number() over (order by meal.occurred_at desc, meal.id desc) as position
    from nutrition.meals as meal
    where meal.person_id = person
      and meal.local_date between p_from and p_to
      and (
        p_before_occurred_at is null
        or (meal.occurred_at, meal.id) < (p_before_occurred_at, p_before_id)
      )
    order by meal.occurred_at desc, meal.id desc
    limit p_limit + 1
  )
  select
    coalesce(
      jsonb_agg(nutrition.meal_projection(ordered.id) order by ordered.position)
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
-- OP-NUT-004 — delete a meal
-- ---------------------------------------------------------------------------

create or replace function nutrition.delete_meal(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_meal_id uuid,
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
  case_id uuid;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-NUT-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent deletion not found' using errcode = '40001';
    end if;
    return query select jsonb_build_object(
      'meal_id', p_meal_id,
      'disposition_case_id', receipt.aggregate_id,
      'status', 'deleted'
    ), true;
    return;
  end if;

  -- Someone else's meal and a meal that does not exist answer the same.
  select meal.id into target_id
  from nutrition.meals as meal
  where meal.id = p_meal_id and meal.person_id = person
  for update;
  if target_id is null then
    raise exception 'meal not found' using errcode = 'P0002';
  end if;

  case_id := privacy.dispose_on_owner_request(person, 'nutrition', 'nutrition_meal', target_id);

  perform system.enqueue_outbox_event(
    'meal', target_id, 'nutrition.meal_deleted.v1', jsonb_build_object('meal_id', target_id)
  );

  -- Items and values go with it: no navigable copy stays behind.
  delete from nutrition.meals as meal where meal.id = target_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'meal-deleted', 'disposition_case', case_id
  );
  return query select jsonb_build_object(
    'meal_id', p_meal_id,
    'disposition_case_id', case_id,
    'status', 'deleted'
  ), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-003 — a restricted window now reads meals too
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
  readable_resource text := case p_category
    when 'body_progress' then 'identity.body_progress_records'
    when 'health_context' then 'identity.health_context_claims'
    when 'nutrition_intake' then 'nutrition.meals'
  end;
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

  -- Each refusal carries its own reason. A category that returns content reads only its
  -- own kind of data, so a meal window cannot be pointed at health claims.
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
    when readable_resource is not null
      and p_resource_type is distinct from readable_resource then 'resource_out_of_scope'
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

  if p_category = 'health_context' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'health_context', coalesce(
          (
            select jsonb_agg(
              identity.health_context_projection(latest.id)
              order by latest.valid_from desc, latest.id desc
            )
            from (
              select claim.id, claim.valid_from
              from identity.health_context_claims as claim
              where claim.person_id = file.subject_person_id
              order by claim.valid_from desc, claim.id desc
              limit 500
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  if p_category = 'nutrition_intake' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'nutrition_intake', coalesce(
          (
            select jsonb_agg(
              nutrition.meal_projection(latest.id)
              order by latest.occurred_at desc, latest.id desc
            )
            from (
              select meal.id, meal.occurred_at
              from nutrition.meals as meal
              where meal.person_id = file.subject_person_id
              order by meal.occurred_at desc, meal.id desc
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
-- Access, ownership and grants
-- ---------------------------------------------------------------------------

alter table nutrition.nutrient_definitions enable row level security;
alter table nutrition.nutrient_definitions force row level security;
alter table nutrition.meals enable row level security;
alter table nutrition.meals force row level security;
alter table nutrition.meal_items enable row level security;
alter table nutrition.meal_items force row level security;
alter table nutrition.meal_nutrient_values enable row level security;
alter table nutrition.meal_nutrient_values force row level security;

create policy nutrient_definitions_all_owner
  on nutrition.nutrient_definitions
  for all to allfit_owner using (true) with check (true);
create policy meals_all_owner
  on nutrition.meals
  for all to allfit_owner using (true) with check (true);
create policy meal_items_all_owner
  on nutrition.meal_items
  for all to allfit_owner using (true) with check (true);
create policy meal_nutrient_values_all_owner
  on nutrition.meal_nutrient_values
  for all to allfit_owner using (true) with check (true);

alter table nutrition.nutrient_definitions owner to allfit_owner;
alter table nutrition.meals owner to allfit_owner;
alter table nutrition.meal_items owner to allfit_owner;
alter table nutrition.meal_nutrient_values owner to allfit_owner;
alter type nutrition.meal_type owner to allfit_owner;

alter function nutrition.reject_nutrient_rewrite_tg() owner to allfit_owner;
alter function nutrition.meal_guard_tg() owner to allfit_owner;
alter function nutrition.meal_item_guard_tg() owner to allfit_owner;
alter function nutrition.reject_nutrient_value_rewrite_tg() owner to allfit_owner;
alter function nutrition.enforce_nutrient_unit_ct() owner to allfit_owner;
alter function privacy.disposition_item_guard_tg() owner to allfit_owner;
alter function privacy.dispose_on_owner_request(uuid, text, text, uuid) owner to allfit_owner;
alter function nutrition.meal_projection(uuid) owner to allfit_owner;
alter function nutrition.record_meal(
  text, text, text, uuid, timestamptz, text, text, text, jsonb, uuid, bytea
) owner to allfit_owner;
alter function nutrition.list_meals(text, text, text, date, date, integer, timestamptz, uuid)
  owner to allfit_owner;
alter function nutrition.delete_meal(text, text, text, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  owner to allfit_owner;

revoke all on function nutrition.reject_nutrient_rewrite_tg() from public;
revoke all on function nutrition.meal_guard_tg() from public;
revoke all on function nutrition.meal_item_guard_tg() from public;
revoke all on function nutrition.reject_nutrient_value_rewrite_tg() from public;
revoke all on function nutrition.enforce_nutrient_unit_ct() from public;
revoke all on function privacy.disposition_item_guard_tg() from public;
revoke all on function privacy.dispose_on_owner_request(uuid, text, text, uuid) from public;
revoke all on function nutrition.meal_projection(uuid) from public;
revoke all on function nutrition.record_meal(
  text, text, text, uuid, timestamptz, text, text, text, jsonb, uuid, bytea
) from public;
revoke all on function nutrition.list_meals(text, text, text, date, date, integer, timestamptz, uuid)
  from public;
revoke all on function nutrition.delete_meal(text, text, text, uuid, uuid, uuid, bytea)
  from public;
revoke all on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  from public;

grant execute on function nutrition.record_meal(
  text, text, text, uuid, timestamptz, text, text, text, jsonb, uuid, bytea
) to allfit_api;
grant execute on function nutrition.list_meals(text, text, text, date, date, integer, timestamptz, uuid)
  to allfit_api;
grant execute on function nutrition.delete_meal(text, text, text, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  to allfit_api;
