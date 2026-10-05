-- What a person eats is theirs: the nutrition schema (ADR-027, ADR-039, ADR-040).
--
-- The eight tables of the Data Dictionary §10A, and the person's half of the domain:
-- recording, reading, correcting and deleting meals (OP-NUT-001..004), the day summed up
-- as it is read with its streak (OP-NUT-005), and the goal line, published by the person
-- or proposed by a professional and decided by the person (OP-NUT-006..008).
--
-- - **Manual and closed.** Six nutrients in their canonical unit, and nothing else: no
--   food catalogue, no estimate. A nutrient left out of an item is not zero, and no
--   total ever turns a missing value into one.
-- - **A meal's hour and day are frozen** when it is recorded, in its own zone; a
--   correction replaces items, note and photo in place under the revision it read, and a
--   stale one is refused rather than merged (OP-NUT-003). Deleting is deleting.
-- - **The photo is a storage key**, never bytes and never an address (ADR-039). A photo
--   that stops being used is queued in `media_disposals` in the same transaction; the
--   API removes it from storage after the commit and seals the row.
-- - **One goal is active**, versioned; publishing supersedes it and accepting a proposal
--   does too. A decision is written once and never rewritten.
--
-- Additive, plus the three units nutrition is counted in.

set lock_timeout = '5s';
set statement_timeout = '120s';

begin;

create schema nutrition;
alter schema nutrition owner to allfit_owner;
revoke all on schema nutrition from public;
-- Usage only: the runtime role reaches nutrition through closed functions, as execution.
grant usage on schema nutrition to allfit_api;

-- Kilocalories, grams and millilitres, and what a meal is weighed or a nutrient measured
-- in. Mass is in kilograms' terms, so the volume a session lifted and the protein a meal
-- carried read off the same catalogue.
insert into catalog.units (code, dimension, is_canonical, to_canonical_factor)
values
  ('kcal',  'energy', true,  1),
  ('g',     'mass',   false, 0.001),
  ('mg',    'mass',   false, 0.000001),
  ('mcg',   'mass',   false, 0.000000001),
  ('oz',    'mass',   false, 0.028349523125),
  ('ml',    'volume', true,  1),
  ('l',     'volume', false, 1000),
  ('fl_oz', 'volume', false, 29.5735);

create type nutrition.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack', 'other');
create type nutrition.goal_origin as enum ('self', 'professional');
create type nutrition.goal_status as enum ('proposed', 'active', 'rejected', 'superseded', 'cancelled');
create type nutrition.goal_target_mode as enum ('minimum', 'maximum', 'range', 'exact');
create type nutrition.goal_decision as enum ('accepted', 'rejected');

-- ———————————————————————————————————————— the nutrient catalogue (§10A.1)

create table nutrition.nutrient_definitions (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  canonical_unit_code text not null,
  nutrient_group text not null,
  -- The Resolución 810 de 2021 daily value for adults, in the canonical unit; null where
  -- it gives none. A person's own goal, when they have one, comes first.
  daily_reference numeric,
  status catalog.publication_status not null default 'published',
  published_at timestamp with time zone,
  constraint pk_nutrient_definitions primary key (id),
  constraint uq_nutrient_definitions_code unique (code),
  constraint fk_nutrient_definitions_unit foreign key (canonical_unit_code) references catalog.units (code) on delete restrict,
  constraint ck_nutrient_definitions_unit check (canonical_unit_code in ('kcal', 'g', 'mg', 'mcg', 'ml')),
  constraint ck_nutrient_definitions_group check (nutrient_group in ('macro', 'detail', 'vitamin', 'mineral')),
  constraint ck_nutrient_definitions_reference check (daily_reference is null or daily_reference > 0)
);

create index idx_nutrient_definitions_status on nutrition.nutrient_definitions (status, code);

-- References: Resolución 810 de 2021, art. 15, tables 9 (needs) and 10 (maximums, for
-- saturated and trans fat, cholesterol and sodium). Total sugars and water have none.
insert into nutrition.nutrient_definitions (code, name, canonical_unit_code, nutrient_group, daily_reference, published_at)
values
  ('energy',           'Energía',              'kcal', 'macro',   2000, clock_timestamp()),
  ('protein',          'Proteína',             'g',    'macro',   50,   clock_timestamp()),
  ('carbohydrates',    'Carbohidratos',        'g',    'macro',   300,  clock_timestamp()),
  ('fat',              'Grasa',                'g',    'macro',   66,   clock_timestamp()),
  ('fiber',            'Fibra',                'g',    'macro',   28,   clock_timestamp()),
  ('water',            'Agua',                 'ml',   'macro',   null, clock_timestamp()),
  ('saturated_fat',    'Grasa saturada',       'g',    'detail',  20,   clock_timestamp()),
  ('trans_fat',        'Grasa trans',          'g',    'detail',  2.2,  clock_timestamp()),
  ('cholesterol',      'Colesterol',           'mg',   'detail',  300,  clock_timestamp()),
  ('sodium',           'Sodio',                'mg',   'detail',  2000, clock_timestamp()),
  ('sugars',           'Azúcares',             'g',    'detail',  null, clock_timestamp()),
  ('vitamin_a',        'Vitamina A',           'mcg',  'vitamin', 800,  clock_timestamp()),
  ('vitamin_c',        'Vitamina C',           'mg',   'vitamin', 83,   clock_timestamp()),
  ('vitamin_d',        'Vitamina D',           'mcg',  'vitamin', 15,   clock_timestamp()),
  ('vitamin_e',        'Vitamina E',           'mg',   'vitamin', 9,    clock_timestamp()),
  ('vitamin_k',        'Vitamina K',           'mcg',  'vitamin', 65,   clock_timestamp()),
  ('thiamin',          'Vitamina B1',          'mg',   'vitamin', 1.15, clock_timestamp()),
  ('riboflavin',       'Vitamina B2',          'mg',   'vitamin', 1.2,  clock_timestamp()),
  ('niacin',           'Vitamina B3',          'mg',   'vitamin', 15,   clock_timestamp()),
  ('pantothenic_acid', 'Vitamina B5',          'mg',   'vitamin', 5,    clock_timestamp()),
  ('vitamin_b6',       'Vitamina B6',          'mg',   'vitamin', 1.3,  clock_timestamp()),
  ('vitamin_b12',      'Vitamina B12',         'mcg',  'vitamin', 2.4,  clock_timestamp()),
  ('folate',           'Folato',               'mcg',  'vitamin', 400,  clock_timestamp()),
  ('calcium',          'Calcio',               'mg',   'mineral', 1000, clock_timestamp()),
  ('iron',             'Hierro',               'mg',   'mineral', 20,   clock_timestamp()),
  ('magnesium',        'Magnesio',             'mg',   'mineral', 310,  clock_timestamp()),
  ('phosphorus',       'Fósforo',              'mg',   'mineral', 700,  clock_timestamp()),
  ('potassium',        'Potasio',              'mg',   'mineral', 4700, clock_timestamp()),
  ('zinc',             'Zinc',                 'mg',   'mineral', 11,   clock_timestamp()),
  ('selenium',         'Selenio',              'mcg',  'mineral', 70,   clock_timestamp()),
  ('copper',           'Cobre',                'mg',   'mineral', 0.9,  clock_timestamp());

-- ———————————————————————————————————————— meals (§10A.2–10A.4)

create table nutrition.meals (
  id uuid not null,
  person_id uuid not null,
  occurred_at timestamp with time zone not null,
  timezone text not null,
  local_date date not null,
  meal_type nutrition.meal_type not null,
  note text,
  revision_number integer not null default 0,
  media_ref text,
  has_media boolean not null default false,
  created_at timestamp with time zone not null default clock_timestamp(),
  updated_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_meals primary key (id),
  constraint uq_meals_carrier unique (id, person_id),
  constraint fk_meals_person foreign key (person_id) references identity.people (id) on delete restrict,
  constraint ck_meals_revision check (revision_number >= 0),
  constraint ck_meals_media check (has_media = (media_ref is not null)),
  constraint ck_meals_note check (note is null or char_length(note) <= 1000)
);

create index idx_meals_person_time on nutrition.meals (person_id, occurred_at desc, id desc);
create index idx_meals_person_day on nutrition.meals (person_id, local_date);

create table nutrition.meal_items (
  id uuid not null default extensions.uuid_generate_v7(),
  meal_id uuid not null,
  person_id uuid not null,
  position integer not null,
  name text not null,
  quantity_numeric numeric,
  quantity_unit_code text,
  created_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_meal_items primary key (id),
  constraint uq_meal_items_carrier unique (id, meal_id, person_id),
  constraint uq_meal_items_person_carrier unique (id, person_id),
  constraint uq_meal_items_position unique (meal_id, position),
  constraint fk_meal_items_meal foreign key (meal_id, person_id) references nutrition.meals (id, person_id) on delete cascade,
  constraint fk_meal_items_unit foreign key (quantity_unit_code) references catalog.units (code) on delete restrict,
  constraint ck_meal_items_position check (position between 1 and 100),
  constraint ck_meal_items_name check (char_length(btrim(name)) between 1 and 160),
  constraint ck_meal_items_quantity check (
    (quantity_numeric is null and quantity_unit_code is null)
    or (quantity_numeric > 0 and quantity_unit_code is not null))
);

create table nutrition.meal_nutrient_values (
  id uuid not null default extensions.uuid_generate_v7(),
  meal_item_id uuid not null,
  meal_id uuid not null,
  person_id uuid not null,
  nutrient_definition_id uuid not null,
  value_numeric numeric not null,
  unit_code text not null,
  created_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_meal_nutrient_values primary key (id),
  constraint uq_meal_nutrient_values_item unique (meal_item_id, nutrient_definition_id),
  constraint fk_meal_nutrient_values_item foreign key (meal_item_id, meal_id, person_id) references nutrition.meal_items (id, meal_id, person_id) on delete cascade,
  constraint fk_meal_nutrient_values_meal foreign key (meal_id, person_id) references nutrition.meals (id, person_id) on delete cascade,
  constraint fk_meal_nutrient_values_definition foreign key (nutrient_definition_id) references nutrition.nutrient_definitions (id) on delete restrict,
  constraint fk_meal_nutrient_values_unit foreign key (unit_code) references catalog.units (code) on delete restrict,
  constraint ck_meal_nutrient_values_value check (value_numeric >= 0)
);

create index idx_meal_nutrient_values_definition on nutrition.meal_nutrient_values (nutrient_definition_id);
create index idx_meal_nutrient_values_meal on nutrition.meal_nutrient_values (meal_id);

-- ———————————————————————————————————————— photos no longer used (ADR-039)

create table nutrition.media_disposals (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  media_ref text not null,
  requested_at timestamp with time zone not null default clock_timestamp(),
  sealed_at timestamp with time zone,
  constraint pk_media_disposals primary key (id),
  constraint fk_media_disposals_person foreign key (person_id) references identity.people (id) on delete restrict,
  constraint ck_media_disposals_ref check (media_ref ~ '^nutrition/')
);

create index idx_media_disposals_pending on nutrition.media_disposals (requested_at) where sealed_at is null;

-- ———————————————————————————————————————— goals (§10A.5–10A.8)

create table nutrition.goal_sets (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  created_at timestamp with time zone not null default clock_timestamp(),
  updated_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_goal_sets primary key (id),
  constraint uq_goal_sets_person unique (person_id),
  constraint uq_goal_sets_carrier unique (id, person_id),
  constraint fk_goal_sets_person foreign key (person_id) references identity.people (id) on delete restrict
);

create table nutrition.goal_versions (
  id uuid not null,
  goal_set_id uuid not null,
  person_id uuid not null,
  version_number integer not null,
  origin nutrition.goal_origin not null,
  status nutrition.goal_status not null,
  rationale text,
  author_person_id uuid not null,
  author_membership_id uuid,
  author_assignment_id uuid,
  origin_relationship_id uuid,
  origin_organization_id uuid,
  credential_verification_id uuid,
  created_at timestamp with time zone not null default clock_timestamp(),
  activated_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  constraint pk_goal_versions primary key (id),
  constraint uq_goal_versions_carrier unique (id, person_id),
  constraint uq_goal_versions_number unique (goal_set_id, version_number),
  constraint fk_goal_versions_set foreign key (goal_set_id, person_id) references nutrition.goal_sets (id, person_id) on delete restrict,
  constraint fk_goal_versions_author foreign key (author_person_id) references identity.people (id) on delete restrict,
  constraint fk_goal_versions_relationship foreign key (origin_relationship_id, person_id, origin_organization_id) references relationships.service_relationships (id, person_id, organization_id) on delete restrict,
  constraint fk_goal_versions_membership foreign key (author_membership_id, origin_organization_id, author_person_id) references organizations.organization_memberships (id, organization_id, person_id) on delete restrict,
  constraint fk_goal_versions_assignment foreign key (author_assignment_id, origin_relationship_id, person_id, origin_organization_id, author_membership_id) references relationships.relationship_professional_assignments (id, relationship_id, person_id, organization_id, membership_id) on delete restrict,
  constraint fk_goal_versions_credential foreign key (credential_verification_id) references identity.professional_credential_verifications (id) on delete restrict,
  constraint ck_goal_versions_number check (version_number >= 1),
  constraint ck_goal_versions_rationale check (rationale is null or char_length(rationale) <= 2000),
  -- A person's own goal carries no professional context; a proposal carries all of it,
  -- and says why.
  constraint ck_goal_versions_origin check (
    (origin = 'self' and author_person_id = person_id and author_membership_id is null
      and author_assignment_id is null and origin_relationship_id is null
      and origin_organization_id is null and credential_verification_id is null)
    or (origin = 'professional' and author_membership_id is not null and author_assignment_id is not null
      and origin_relationship_id is not null and origin_organization_id is not null
      and nullif(btrim(rationale), '') is not null))
);

create unique index uidx_goal_versions_active on nutrition.goal_versions (goal_set_id) where status = 'active';
create unique index uidx_goal_versions_pending on nutrition.goal_versions (goal_set_id, origin_relationship_id) where status = 'proposed';
create index idx_goal_versions_person_status on nutrition.goal_versions (person_id, status);
create index idx_goal_versions_set_created on nutrition.goal_versions (goal_set_id, created_at desc, id desc);
create index idx_goal_versions_relationship on nutrition.goal_versions (origin_relationship_id, created_at desc, id desc);

create table nutrition.goal_targets (
  id uuid not null default extensions.uuid_generate_v7(),
  goal_version_id uuid not null,
  nutrient_definition_id uuid not null,
  mode nutrition.goal_target_mode not null,
  minimum_value numeric,
  maximum_value numeric,
  exact_value numeric,
  unit_code text not null,
  created_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_goal_targets primary key (id),
  constraint uq_goal_targets_nutrient unique (goal_version_id, nutrient_definition_id),
  constraint fk_goal_targets_version foreign key (goal_version_id) references nutrition.goal_versions (id) on delete cascade,
  constraint fk_goal_targets_definition foreign key (nutrient_definition_id) references nutrition.nutrient_definitions (id) on delete restrict,
  constraint fk_goal_targets_unit foreign key (unit_code) references catalog.units (code) on delete restrict,
  constraint ck_goal_targets_values check (
    coalesce(minimum_value, 0) >= 0 and coalesce(maximum_value, 0) >= 0 and coalesce(exact_value, 0) >= 0),
  -- Each mode fills its own fields and only them.
  constraint ck_goal_targets_mode check (
    (mode = 'minimum' and minimum_value is not null and maximum_value is null and exact_value is null)
    or (mode = 'maximum' and minimum_value is null and maximum_value is not null and exact_value is null)
    or (mode = 'range' and minimum_value is not null and maximum_value is not null and exact_value is null
        and minimum_value <= maximum_value)
    or (mode = 'exact' and minimum_value is null and maximum_value is null and exact_value is not null))
);

create table nutrition.goal_decisions (
  id uuid not null,
  goal_version_id uuid not null,
  person_id uuid not null,
  decision nutrition.goal_decision not null,
  decided_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_goal_decisions primary key (id),
  constraint uq_goal_decisions_version unique (goal_version_id),
  constraint fk_goal_decisions_version foreign key (goal_version_id, person_id) references nutrition.goal_versions (id, person_id) on delete restrict
);

create index idx_goal_decisions_person on nutrition.goal_decisions (person_id, decided_at desc);

-- ———————————————————————————————————————— ownership and row-level security

alter table nutrition.nutrient_definitions owner to allfit_owner;
alter table nutrition.meals owner to allfit_owner;
alter table nutrition.meal_items owner to allfit_owner;
alter table nutrition.meal_nutrient_values owner to allfit_owner;
alter table nutrition.media_disposals owner to allfit_owner;
alter table nutrition.goal_sets owner to allfit_owner;
alter table nutrition.goal_versions owner to allfit_owner;
alter table nutrition.goal_targets owner to allfit_owner;
alter table nutrition.goal_decisions owner to allfit_owner;
revoke all on nutrition.nutrient_definitions, nutrition.meals, nutrition.meal_items,
  nutrition.meal_nutrient_values, nutrition.media_disposals, nutrition.goal_sets,
  nutrition.goal_versions, nutrition.goal_targets, nutrition.goal_decisions from public;

alter table nutrition.nutrient_definitions enable row level security;
alter table nutrition.nutrient_definitions force row level security;
alter table nutrition.meals enable row level security;
alter table nutrition.meals force row level security;
alter table nutrition.meal_items enable row level security;
alter table nutrition.meal_items force row level security;
alter table nutrition.meal_nutrient_values enable row level security;
alter table nutrition.meal_nutrient_values force row level security;
alter table nutrition.media_disposals enable row level security;
alter table nutrition.media_disposals force row level security;
alter table nutrition.goal_sets enable row level security;
alter table nutrition.goal_sets force row level security;
alter table nutrition.goal_versions enable row level security;
alter table nutrition.goal_versions force row level security;
alter table nutrition.goal_targets enable row level security;
alter table nutrition.goal_targets force row level security;
alter table nutrition.goal_decisions enable row level security;
alter table nutrition.goal_decisions force row level security;

create policy nutrient_definitions_select_published on nutrition.nutrient_definitions
  for select to allfit_owner using (status = 'published');

create policy meals_all_self on nutrition.meals
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

create policy meal_items_all_self on nutrition.meal_items
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

create policy meal_nutrient_values_all_self on nutrition.meal_nutrient_values
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

create policy media_disposals_all_self on nutrition.media_disposals
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

create policy goal_sets_all_self on nutrition.goal_sets
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

create policy goal_versions_all_self on nutrition.goal_versions
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

-- Targets inherit from their version, as the session's children do from the session.
create policy goal_targets_all_self on nutrition.goal_targets
  for all to allfit_owner
  using (exists (
    select 1 from nutrition.goal_versions as version
    where version.id = goal_targets.goal_version_id and access_control.is_self(version.person_id)))
  with check (exists (
    select 1 from nutrition.goal_versions as version
    where version.id = goal_targets.goal_version_id and access_control.is_self(version.person_id)));

create policy goal_decisions_all_self on nutrition.goal_decisions
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

-- ———————————————————————————————————————— what the base enforces by itself

-- IX-29 and IX-34: a value is written in its nutrient's unit, never converted on the way.
create function nutrition.enforce_canonical_unit()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if not exists (
    select 1 from nutrition.nutrient_definitions as definition
    where definition.id = new.nutrient_definition_id and definition.canonical_unit_code = new.unit_code
  ) then
    raise exception 'a nutrient is written in its own unit' using errcode = '23514';
  end if;
  return new;
end
$function$;

alter function nutrition.enforce_canonical_unit() owner to allfit_owner;
revoke all on function nutrition.enforce_canonical_unit() from public;

create trigger trg_meal_nutrient_values_unit
  before insert or update on nutrition.meal_nutrient_values
  for each row execute function nutrition.enforce_canonical_unit();

create trigger trg_goal_targets_unit
  before insert or update on nutrition.goal_targets
  for each row execute function nutrition.enforce_canonical_unit();

-- Per statement, so even a change that matches no row is refused: a decision is the
-- person's and stands as they made it.
create function nutrition.refuse_decision_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a goal decision is never rewritten' using errcode = '42501';
end
$function$;

alter function nutrition.refuse_decision_change() owner to allfit_owner;
revoke all on function nutrition.refuse_decision_change() from public;

create trigger trg_goal_decisions_append_only
  before update or delete or truncate on nutrition.goal_decisions
  for each statement execute function nutrition.refuse_decision_change();

-- ———————————————————————————————————————— reading a meal

-- A meal as the API answers it, with its storage key for the API to sign and drop.
create function nutrition.meal_json(p_meal_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', meal.id,
    'occurred_at', meal.occurred_at,
    'local_date', meal.local_date,
    'timezone', meal.timezone,
    'meal_type', meal.meal_type,
    'note', meal.note,
    'revision_number', meal.revision_number,
    'media_ref', meal.media_ref,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', item.position,
        'name', item.name,
        'quantity', item.quantity_numeric,
        'quantity_unit', item.quantity_unit_code,
        'nutrients', coalesce((
          select jsonb_agg(jsonb_build_object(
            'nutrient_code', definition.code, 'value', value.value_numeric, 'unit', value.unit_code)
            order by definition.code)
          from nutrition.meal_nutrient_values as value
          join nutrition.nutrient_definitions as definition on definition.id = value.nutrient_definition_id
          where value.meal_item_id = item.id), '[]'::jsonb))
        order by item.position)
      from nutrition.meal_items as item
      where item.meal_id = meal.id), '[]'::jsonb))
  from nutrition.meals as meal
  where meal.id = p_meal_id
$function$;

alter function nutrition.meal_json(uuid) owner to allfit_owner;
revoke all on function nutrition.meal_json(uuid) from public;

-- Items and their nutrients, written whole. Internal: no grant, reached only from the
-- commands that checked the actor and own the meal.
create function nutrition.write_items(p_meal_id uuid, p_person_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = pg_catalog
as $function$
declare
  entry jsonb;
  nutrient jsonb;
  item_id uuid;
  definition record;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'a meal has between one and a hundred items' using errcode = '23514';
  end if;

  for entry in select value from jsonb_array_elements(p_items) loop
    if nullif(entry->>'quantity_unit', '') is not null
       and not exists (select 1 from catalog.units where code = entry->>'quantity_unit') then
      raise exception 'an item''s quantity is in a unit the catalogue has' using errcode = '23514';
    end if;

    insert into nutrition.meal_items (meal_id, person_id, position, name, quantity_numeric, quantity_unit_code)
    values (p_meal_id, p_person_id, (entry->>'position')::integer, entry->>'name',
            nullif(entry->>'quantity', '')::numeric, nullif(entry->>'quantity_unit', ''))
    returning id into item_id;

    for nutrient in select value from jsonb_array_elements(coalesce(entry->'nutrients', '[]'::jsonb)) loop
      select * into definition from nutrition.nutrient_definitions
      where code = nutrient->>'nutrient_code' and status = 'published';
      if definition.id is null then
        raise exception 'a nutrient the catalogue does not publish' using errcode = '23514';
      end if;
      insert into nutrition.meal_nutrient_values (
        meal_item_id, meal_id, person_id, nutrient_definition_id, value_numeric, unit_code
      ) values (item_id, p_meal_id, p_person_id, definition.id, (nutrient->>'value')::numeric, nutrient->>'unit');
    end loop;
  end loop;
end
$function$;

alter function nutrition.write_items(uuid, uuid, jsonb) owner to allfit_owner;
revoke all on function nutrition.write_items(uuid, uuid, jsonb) from public;

-- ———————————————————————————————————————— record (OP-NUT-001)

create function nutrition.record_meal(
  p_person_id uuid,
  p_meal jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  zone text := p_meal->>'timezone';
  occurred timestamp with time zone;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'nutrition person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-NUT-001', p_idempotency_key, p_command_id, p_request_hash
  );
  -- A replay answers the meal it recorded; null when that meal was deleted since.
  if not receipt.claimed then
    return nutrition.meal_json(receipt.aggregate_id);
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  occurred := (p_meal->>'occurred_at')::timestamp with time zone;

  insert into nutrition.meals (id, person_id, occurred_at, timezone, local_date, meal_type, note)
  values (p_command_id, p_person_id, occurred, zone, (occurred at time zone zone)::date,
          (p_meal->>'meal_type')::nutrition.meal_type, nullif(btrim(p_meal->>'note'), ''));

  perform nutrition.write_items(p_command_id, p_person_id, coalesce(p_meal->'items', '[]'::jsonb));

  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'meal-recorded', 'nutrition_meal', p_command_id);

  return nutrition.meal_json(p_command_id);
end
$function$;

-- ———————————————————————————————————————— read and list (OP-NUT-002)

create function nutrition.read_meal(p_person_id uuid, p_meal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return null;
  end if;
  if not exists (select 1 from nutrition.meals where id = p_meal_id and person_id = p_person_id) then
    return null;
  end if;
  return nutrition.meal_json(p_meal_id);
end
$function$;

-- Opaque: base64 of the instant and the id the page ended on.
create function nutrition.meal_cursor(p_occurred timestamp with time zone, p_id uuid)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select translate(encode(convert_to(
    to_char(p_occurred at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || p_id::text, 'UTF8'),
    'base64'), E'\n', '')
$function$;

alter function nutrition.meal_cursor(timestamp with time zone, uuid) owner to allfit_owner;
revoke all on function nutrition.meal_cursor(timestamp with time zone, uuid) from public;

create function nutrition.list_my_meals(
  p_person_id uuid,
  p_from date,
  p_to date,
  p_cursor text,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  size integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  after_at timestamp with time zone;
  after_id uuid;
  decoded text;
  rows jsonb;
  more boolean;
  last_at timestamp with time zone;
  last_id uuid;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return jsonb_build_object('data', '[]'::jsonb, 'page', jsonb_build_object('next_cursor', null, 'has_more', false));
  end if;

  if p_cursor is not null then
    begin
      decoded := convert_from(decode(p_cursor, 'base64'), 'UTF8');
      after_at := split_part(decoded, '|', 1)::timestamp with time zone;
      after_id := split_part(decoded, '|', 2)::uuid;
    exception when others then
      raise exception 'malformed cursor' using errcode = '22023';
    end;
  end if;

  with chosen as (
    select meal.id, meal.occurred_at
    from nutrition.meals as meal
    where meal.person_id = p_person_id
      and (p_from is null or meal.local_date >= p_from)
      and (p_to is null or meal.local_date <= p_to)
      and (after_id is null or (meal.occurred_at, meal.id) < (after_at, after_id))
    order by meal.occurred_at desc, meal.id desc
    limit size + 1
  ),
  page as (select * from chosen order by occurred_at desc, id desc limit size)
  select (select coalesce(jsonb_agg(nutrition.meal_json(page.id) order by page.occurred_at desc, page.id desc), '[]'::jsonb)
          from page),
         (select count(*) from chosen) > size,
         (select page.occurred_at from page order by page.occurred_at asc, page.id asc limit 1),
         (select page.id from page order by page.occurred_at asc, page.id asc limit 1)
  into rows, more, last_at, last_id;

  return jsonb_build_object('data', rows, 'page', jsonb_build_object(
    'next_cursor', case when more then nutrition.meal_cursor(last_at, last_id) end,
    'has_more', more));
end
$function$;

-- ———————————————————————————————————————— correct (OP-NUT-003)

create function nutrition.revise_meal(
  p_person_id uuid,
  p_meal_id uuid,
  p_expected_revision integer,
  p_patch jsonb,
  p_media jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  meal record;
  replaced text;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'nutrition person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-NUT-003', p_idempotency_key, p_command_id, p_request_hash
  );

  select * into meal from nutrition.meals where id = p_meal_id and person_id = p_person_id for update;
  if meal.id is null then
    raise exception 'meal is not this person''s' using errcode = '42501';
  end if;

  if not receipt.claimed then
    return nutrition.meal_json(meal.id) || jsonb_build_object('disposed_media_ref', null);
  end if;

  if meal.revision_number <> p_expected_revision then
    raise exception 'stale-meal' using errcode = '40001';
  end if;
  -- The hour and the day were frozen when it was recorded (OP-NUT-001).
  if (p_patch ? 'occurred_at' and (p_patch->>'occurred_at')::timestamp with time zone <> meal.occurred_at)
     or (p_patch ? 'timezone' and p_patch->>'timezone' <> meal.timezone) then
    raise exception 'a meal''s hour and day do not change on correcting' using errcode = '23514';
  end if;

  if p_patch ? 'items' then
    delete from nutrition.meal_items where meal_id = meal.id;
    perform nutrition.write_items(meal.id, p_person_id, p_patch->'items');
  end if;

  if p_media ? 'set' or coalesce((p_media->>'remove')::boolean, false) then
    replaced := meal.media_ref;
    if replaced is not null then
      insert into nutrition.media_disposals (person_id, media_ref) values (p_person_id, replaced);
    end if;
  end if;

  update nutrition.meals
  set meal_type = case when p_patch ? 'meal_type' then (p_patch->>'meal_type')::nutrition.meal_type else meal_type end,
      note = case when p_patch ? 'note' then nullif(btrim(p_patch->>'note'), '') else note end,
      media_ref = case when p_media ? 'set' then p_media->>'set'
                       when coalesce((p_media->>'remove')::boolean, false) then null
                       else media_ref end,
      has_media = case when p_media ? 'set' then true
                       when coalesce((p_media->>'remove')::boolean, false) then false
                       else has_media end,
      revision_number = revision_number + 1,
      updated_at = clock_timestamp()
  where id = meal.id;

  perform system.finish_idempotency(receipt.receipt_id, 200::smallint, 'meal-revised', 'nutrition_meal', meal.id);

  return nutrition.meal_json(meal.id) || jsonb_build_object('disposed_media_ref', replaced);
end
$function$;

-- ———————————————————————————————————————— delete (OP-NUT-004)

create function nutrition.delete_meal(
  p_person_id uuid,
  p_meal_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  meal record;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'nutrition person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-NUT-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return jsonb_build_object('deleted', true, 'disposed_media_ref', null);
  end if;

  select * into meal from nutrition.meals where id = p_meal_id and person_id = p_person_id for update;
  if meal.id is null then
    raise exception 'meal is not this person''s' using errcode = '42501';
  end if;

  if meal.media_ref is not null then
    insert into nutrition.media_disposals (person_id, media_ref) values (p_person_id, meal.media_ref);
  end if;
  -- Items and nutrients go with it: the cascade is the disposition of everything inside.
  delete from nutrition.meals where id = meal.id;

  perform system.finish_idempotency(receipt.receipt_id, 200::smallint, 'meal-deleted', 'nutrition_meal', meal.id);

  return jsonb_build_object('deleted', true, 'disposed_media_ref', meal.media_ref);
end
$function$;

create function nutrition.seal_media_disposal(p_person_id uuid, p_media_ref text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'nutrition person does not match the authenticated actor' using errcode = '42501';
  end if;
  update nutrition.media_disposals
  set sealed_at = clock_timestamp()
  where person_id = p_person_id and media_ref = p_media_ref and sealed_at is null;
end
$function$;

-- ———————————————————————————————————————— the day (OP-NUT-005)

create function nutrition.read_daily_summaries(
  p_person_id uuid,
  p_from date,
  p_to date,
  p_timezone text,
  p_today date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  today date;
  anchor date;
  streak integer;
  days jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then
    raise exception 'a summary covers between one and thirty-one days' using errcode = '22023';
  end if;
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return jsonb_build_object('data', '[]'::jsonb, 'streak_days', 0);
  end if;
  today := coalesce(p_today, (clock_timestamp() at time zone p_timezone)::date);

  select jsonb_agg(jsonb_build_object(
           'local_date', day.date,
           'meal_count', (select count(*)::integer from nutrition.meals as meal
                          where meal.person_id = p_person_id and meal.local_date = day.date),
           -- Only what was recorded: a nutrient nobody wrote has no total, not a zero.
           'nutrient_totals', coalesce((
             select jsonb_agg(jsonb_build_object('nutrient_code', total.code, 'value', total.value, 'unit', total.unit)
                              order by total.code)
             from (
               select definition.code, definition.canonical_unit_code as unit, sum(value.value_numeric) as value
               from nutrition.meal_nutrient_values as value
               join nutrition.meals as meal on meal.id = value.meal_id
               join nutrition.nutrient_definitions as definition on definition.id = value.nutrient_definition_id
               where meal.person_id = p_person_id and meal.local_date = day.date
               group by definition.code, definition.canonical_unit_code
             ) as total), '[]'::jsonb),
           'applied_scope', null)
         order by day.date)
  into days
  -- A series of dates is a series of timestamps; the day is the date.
  from (select moment::date as date from generate_series(p_from, p_to, interval '1 day') as moment) as day;

  -- Days in a row with something recorded, to today, or to yesterday while today is empty.
  anchor := case when exists (select 1 from nutrition.meals where person_id = p_person_id and local_date = today)
                 then today else today - 1 end;
  with logged as (
    select distinct meal.local_date from nutrition.meals as meal
    where meal.person_id = p_person_id and meal.local_date <= anchor
  ),
  ranked as (
    select logged.local_date, row_number() over (order by logged.local_date desc) as rn from logged
  )
  select count(*)::integer into streak from ranked where ranked.local_date = anchor - (ranked.rn - 1)::integer;

  return jsonb_build_object('data', coalesce(days, '[]'::jsonb), 'streak_days', streak);
end
$function$;

-- ———————————————————————————————————————— goals (OP-NUT-006..008)

create function nutrition.goal_version_json(p_goal_version_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', version.id,
    'version_number', version.version_number,
    'origin', version.origin,
    'status', version.status,
    'rationale', version.rationale,
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nutrient_code', definition.code, 'mode', target.mode, 'minimum', target.minimum_value,
        'maximum', target.maximum_value, 'exact', target.exact_value, 'unit', target.unit_code)
        order by definition.code)
      from nutrition.goal_targets as target
      join nutrition.nutrient_definitions as definition on definition.id = target.nutrient_definition_id
      where target.goal_version_id = version.id), '[]'::jsonb),
    -- Who proposed it and from where: the person knows their nutritionist by name.
    'author', case when version.origin = 'self'
      then jsonb_build_object('kind', 'self', 'person_id', version.author_person_id)
      else jsonb_build_object('kind', 'professional', 'person_id', version.author_person_id,
        'display_name', author.display_name, 'organization_name', organization.display_name) end,
    'created_at', version.created_at,
    'origin_relationship_id', version.origin_relationship_id,
    'decision', (
      select jsonb_build_object('id', decision.id, 'goal_version_id', decision.goal_version_id,
        'decision', decision.decision, 'decided_at', decision.decided_at,
        'active_goal_version_id', (
          select active.id from nutrition.goal_versions as active
          where active.goal_set_id = version.goal_set_id and active.status = 'active'))
      from nutrition.goal_decisions as decision where decision.goal_version_id = version.id),
    'applied_scope', null)
  from nutrition.goal_versions as version
  join identity.people as author on author.id = version.author_person_id
  left join organizations.organizations as organization on organization.id = version.origin_organization_id
  where version.id = p_goal_version_id
$function$;

alter function nutrition.goal_version_json(uuid) owner to allfit_owner;
revoke all on function nutrition.goal_version_json(uuid) from public;

create function nutrition.read_my_goals(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return jsonb_build_object('active', null, 'proposals', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'active', (select nutrition.goal_version_json(version.id) from nutrition.goal_versions as version
               where version.person_id = p_person_id and version.status = 'active'),
    -- What professionals proposed: pending first by being newest, decided ones after.
    'proposals', coalesce((
      select jsonb_agg(nutrition.goal_version_json(version.id) order by version.created_at desc, version.id desc)
      from (
        select version.id, version.created_at from nutrition.goal_versions as version
        where version.person_id = p_person_id and version.origin = 'professional'
          and (version.status = 'proposed'
               or exists (select 1 from nutrition.goal_decisions as decision where decision.goal_version_id = version.id))
        order by version.created_at desc, version.id desc
        limit 20
      ) as version), '[]'::jsonb));
end
$function$;

-- Targets of a version, checked against the catalogue and written once.
create function nutrition.write_targets(p_goal_version_id uuid, p_targets jsonb)
returns void
language plpgsql
set search_path = pg_catalog
as $function$
declare
  entry jsonb;
  definition record;
begin
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) not between 1 and 6 then
    raise exception 'a goal has between one and six targets' using errcode = '23514';
  end if;
  if (select count(distinct value->>'nutrient_code') from jsonb_array_elements(p_targets)) <> jsonb_array_length(p_targets) then
    raise exception 'a nutrient has one target in a goal' using errcode = '23514';
  end if;

  for entry in select value from jsonb_array_elements(p_targets) loop
    select * into definition from nutrition.nutrient_definitions
    where code = entry->>'nutrient_code' and status = 'published';
    if definition.id is null then
      raise exception 'a nutrient the catalogue does not publish' using errcode = '23514';
    end if;
    insert into nutrition.goal_targets (
      goal_version_id, nutrient_definition_id, mode, minimum_value, maximum_value, exact_value, unit_code
    ) values (
      p_goal_version_id, definition.id, (entry->>'mode')::nutrition.goal_target_mode,
      nullif(entry->>'minimum', '')::numeric, nullif(entry->>'maximum', '')::numeric,
      nullif(entry->>'exact', '')::numeric, entry->>'unit');
  end loop;
end
$function$;

alter function nutrition.write_targets(uuid, jsonb) owner to allfit_owner;
revoke all on function nutrition.write_targets(uuid, jsonb) from public;

create function nutrition.publish_self_goal_version(
  p_person_id uuid,
  p_rationale text,
  p_targets jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  goal_set record;
  next_number integer;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'nutrition person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-NUT-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return nutrition.goal_version_json(receipt.aggregate_id);
  end if;

  insert into nutrition.goal_sets (person_id) values (p_person_id) on conflict (person_id) do nothing;
  -- Locked, so two publishes at once end with one active goal, not two.
  select * into goal_set from nutrition.goal_sets where person_id = p_person_id for update;

  select coalesce(max(version_number), 0) + 1 into next_number
  from nutrition.goal_versions where goal_set_id = goal_set.id;

  update nutrition.goal_versions set status = 'superseded'
  where goal_set_id = goal_set.id and status = 'active';

  insert into nutrition.goal_versions (
    id, goal_set_id, person_id, version_number, origin, status, rationale, author_person_id, activated_at
  ) values (
    p_command_id, goal_set.id, p_person_id, next_number, 'self', 'active',
    nullif(btrim(p_rationale), ''), p_person_id, clock_timestamp());

  perform nutrition.write_targets(p_command_id, p_targets);

  update nutrition.goal_sets set updated_at = clock_timestamp() where id = goal_set.id;

  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'goal-published', 'nutrition_goal_version', p_command_id);

  return nutrition.goal_version_json(p_command_id);
end
$function$;

create function nutrition.decide_goal_version(
  p_person_id uuid,
  p_goal_version_id uuid,
  p_decision text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  version record;
  active uuid;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'nutrition person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-NUT-008', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return nutrition.goal_version_json(receipt.aggregate_id)->'decision';
  end if;

  -- The set first, then the version: a concurrent accept waits here and finds it decided.
  perform 1 from nutrition.goal_sets where person_id = p_person_id for update;
  select * into version from nutrition.goal_versions
  where id = p_goal_version_id and person_id = p_person_id for update;
  if version.id is null then
    raise exception 'goal version is not this person''s' using errcode = '42501';
  end if;
  if version.origin <> 'professional' or version.status <> 'proposed'
     or exists (select 1 from nutrition.goal_decisions where goal_version_id = version.id) then
    raise exception 'only a pending proposal is decided, and once' using errcode = '23514';
  end if;

  insert into nutrition.goal_decisions (id, goal_version_id, person_id, decision)
  values (p_command_id, version.id, p_person_id, p_decision::nutrition.goal_decision);

  if p_decision = 'accepted' then
    update nutrition.goal_versions set status = 'superseded'
    where goal_set_id = version.goal_set_id and status = 'active';
    update nutrition.goal_versions set status = 'active', activated_at = clock_timestamp()
    where id = version.id;
  else
    update nutrition.goal_versions set status = 'rejected' where id = version.id;
  end if;

  select id into active from nutrition.goal_versions where goal_set_id = version.goal_set_id and status = 'active';

  perform system.finish_idempotency(receipt.receipt_id, 200::smallint, 'goal-decided', 'nutrition_goal_version', version.id);

  return jsonb_build_object('id', p_command_id, 'goal_version_id', version.id, 'decision', p_decision,
    'decided_at', clock_timestamp(), 'active_goal_version_id', active);
end
$function$;

-- ———————————————————————————————————————— grants

alter function nutrition.record_meal(uuid, jsonb, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function nutrition.record_meal(uuid, jsonb, uuid, uuid, bytea) from public;
grant execute on function nutrition.record_meal(uuid, jsonb, uuid, uuid, bytea) to allfit_api;

alter function nutrition.read_meal(uuid, uuid) owner to allfit_owner;
revoke all on function nutrition.read_meal(uuid, uuid) from public;
grant execute on function nutrition.read_meal(uuid, uuid) to allfit_api;

alter function nutrition.list_my_meals(uuid, date, date, text, integer) owner to allfit_owner;
revoke all on function nutrition.list_my_meals(uuid, date, date, text, integer) from public;
grant execute on function nutrition.list_my_meals(uuid, date, date, text, integer) to allfit_api;

alter function nutrition.revise_meal(uuid, uuid, integer, jsonb, jsonb, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function nutrition.revise_meal(uuid, uuid, integer, jsonb, jsonb, uuid, uuid, bytea) from public;
grant execute on function nutrition.revise_meal(uuid, uuid, integer, jsonb, jsonb, uuid, uuid, bytea) to allfit_api;

alter function nutrition.delete_meal(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function nutrition.delete_meal(uuid, uuid, uuid, uuid, bytea) from public;
grant execute on function nutrition.delete_meal(uuid, uuid, uuid, uuid, bytea) to allfit_api;

alter function nutrition.seal_media_disposal(uuid, text) owner to allfit_owner;
revoke all on function nutrition.seal_media_disposal(uuid, text) from public;
grant execute on function nutrition.seal_media_disposal(uuid, text) to allfit_api;

alter function nutrition.read_daily_summaries(uuid, date, date, text, date) owner to allfit_owner;
revoke all on function nutrition.read_daily_summaries(uuid, date, date, text, date) from public;
grant execute on function nutrition.read_daily_summaries(uuid, date, date, text, date) to allfit_api;

alter function nutrition.read_my_goals(uuid) owner to allfit_owner;
revoke all on function nutrition.read_my_goals(uuid) from public;
grant execute on function nutrition.read_my_goals(uuid) to allfit_api;

alter function nutrition.publish_self_goal_version(uuid, text, jsonb, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function nutrition.publish_self_goal_version(uuid, text, jsonb, uuid, uuid, bytea) from public;
grant execute on function nutrition.publish_self_goal_version(uuid, text, jsonb, uuid, uuid, bytea) to allfit_api;

alter function nutrition.decide_goal_version(uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function nutrition.decide_goal_version(uuid, uuid, text, uuid, uuid, bytea) from public;
grant execute on function nutrition.decide_goal_version(uuid, uuid, text, uuid, uuid, bytea) to allfit_api;

commit;
