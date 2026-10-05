-- A meal can be seen and found: the food catalogue, recognition consent and where each
-- item came from (ADR-041, OP-NUT-014..017).
--
-- - **The catalogue is Allfit's own.** Foods taken from USDA FoodData Central (CC0) with
--   Spanish names, synonyms and Colombian portions, and dishes as Allfit's recipes made of
--   those foods. Every person reads it; nobody writes it at runtime: it changes only by
--   migration, and the seed comes in the next one.
-- - **Search folds case and accents by hand**, as the history search does: neither
--   `unaccent` nor `pg_trgm` is installed, and the catalogue is small enough not to need
--   them.
-- - **A recognised name meets its food here**, never in the model: the model only says what
--   it sees and how much; nutrients come from the catalogue.
-- - **Recognition needs consent**, kept with the version of the text accepted. Searching
--   does not: nothing leaves Allfit.
-- - **Packaged products from Open Food Facts live apart**, in their own tables: their data
--   is ODbL, share-alike, and kept separate it stays a collected work beside Allfit's own
--   catalogue rather than mixing into it. They are found by name and brand; a photo never
--   meets one, since telling a brand from a generic glass of milk is not the model's to say.
-- - **Each item says where it came from** — typed, picked from the catalogue, recognised in
--   a photo — and a meal says which model recognised it.
--
-- Additive.

set lock_timeout = '5s';
set statement_timeout = '120s';

begin;

create type nutrition.food_kind as enum ('ingredient', 'dish');
create type nutrition.food_source as enum ('usda', 'allfit_recipe');
create type nutrition.item_origin as enum ('typed', 'catalog', 'photo');

-- Lower case, Spanish accents folded and spaces collapsed: «Fríjol  Rojo» is «frijol rojo».
create function nutrition.normalize_food_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $function$
  select regexp_replace(
    translate(lower(btrim(p_name)), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'),
    '\s+', ' ', 'g')
$function$;

alter function nutrition.normalize_food_name(text) owner to allfit_owner;
revoke all on function nutrition.normalize_food_name(text) from public;

-- ———————————————————————————————————————— the catalogue

create table nutrition.foods (
  id uuid not null default extensions.uuid_generate_v7(),
  name text not null,
  name_normalized text generated always as (nutrition.normalize_food_name(name)) stored,
  kind nutrition.food_kind not null,
  source nutrition.food_source not null,
  source_ref text,
  icon text not null default 'nutrition',
  -- What a millilitre weighs; null for what is not poured, which then offers no ml.
  grams_per_ml numeric,
  status catalog.publication_status not null default 'published',
  published_at timestamp with time zone,
  created_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_foods primary key (id),
  constraint ck_foods_grams_per_ml check (grams_per_ml is null or grams_per_ml between 0.1 and 3),
  constraint uq_foods_name unique (name_normalized),
  constraint ck_foods_name check (char_length(btrim(name)) between 1 and 120),
  -- A DS icon name, to tell a food apart at a glance in a list.
  constraint ck_foods_icon check (icon ~ '^[a-z][a-zA-Z]*$'),
  constraint ck_foods_source check (
    (source = 'usda' and source_ref ~ '^[0-9]+$' and kind = 'ingredient')
    or (source = 'allfit_recipe' and source_ref is null))
);

create index idx_foods_status_name on nutrition.foods (status, name_normalized text_pattern_ops);

create table nutrition.food_aliases (
  id uuid not null default extensions.uuid_generate_v7(),
  food_id uuid not null,
  alias text not null,
  alias_normalized text generated always as (nutrition.normalize_food_name(alias)) stored,
  constraint pk_food_aliases primary key (id),
  constraint uq_food_aliases_alias unique (alias_normalized),
  constraint fk_food_aliases_food foreign key (food_id) references nutrition.foods (id) on delete cascade,
  constraint ck_food_aliases_alias check (char_length(btrim(alias)) between 1 and 120)
);

create index idx_food_aliases_food on nutrition.food_aliases (food_id);
create index idx_food_aliases_prefix on nutrition.food_aliases (alias_normalized text_pattern_ops);

create table nutrition.food_nutrients (
  food_id uuid not null,
  nutrient_definition_id uuid not null,
  value_per_100g numeric not null,
  unit_code text not null,
  constraint pk_food_nutrients primary key (food_id, nutrient_definition_id),
  constraint fk_food_nutrients_food foreign key (food_id) references nutrition.foods (id) on delete cascade,
  constraint fk_food_nutrients_definition foreign key (nutrient_definition_id) references nutrition.nutrient_definitions (id) on delete restrict,
  constraint fk_food_nutrients_unit foreign key (unit_code) references catalog.units (code) on delete restrict,
  constraint ck_food_nutrients_value check (value_per_100g >= 0)
);

create trigger trg_food_nutrients_unit
  before insert or update on nutrition.food_nutrients
  for each row execute function nutrition.enforce_canonical_unit();

create table nutrition.food_portions (
  id uuid not null default extensions.uuid_generate_v7(),
  food_id uuid not null,
  label text not null,
  grams numeric not null,
  position integer not null,
  is_default boolean not null default false,
  constraint pk_food_portions primary key (id),
  constraint uq_food_portions_label unique (food_id, label),
  constraint uq_food_portions_position unique (food_id, position),
  constraint fk_food_portions_food foreign key (food_id) references nutrition.foods (id) on delete cascade,
  constraint ck_food_portions_grams check (grams > 0),
  constraint ck_food_portions_label check (char_length(btrim(label)) between 1 and 60),
  constraint ck_food_portions_position check (position between 1 and 20)
);

create unique index uidx_food_portions_default on nutrition.food_portions (food_id) where is_default;

-- A dish is a recipe of foods; its nutrients per 100 g are seeded already summed.
create table nutrition.food_recipe_parts (
  dish_id uuid not null,
  part_food_id uuid not null,
  grams numeric not null,
  position integer not null,
  constraint pk_food_recipe_parts primary key (dish_id, part_food_id),
  constraint uq_food_recipe_parts_position unique (dish_id, position),
  constraint fk_food_recipe_parts_dish foreign key (dish_id) references nutrition.foods (id) on delete cascade,
  constraint fk_food_recipe_parts_part foreign key (part_food_id) references nutrition.foods (id) on delete restrict,
  constraint ck_food_recipe_parts_grams check (grams > 0),
  constraint ck_food_recipe_parts_self check (dish_id <> part_food_id)
);

create index idx_food_recipe_parts_part on nutrition.food_recipe_parts (part_food_id);

-- ———————————————————————————————————————— packaged products (Open Food Facts, ODbL)

create table nutrition.products (
  id uuid not null default extensions.uuid_generate_v7(),
  barcode text not null,
  name text not null,
  name_normalized text generated always as (nutrition.normalize_food_name(name)) stored,
  brand text,
  brand_normalized text generated always as (nutrition.normalize_food_name(coalesce(brand, ''))) stored,
  quantity_label text,
  icon text not null default 'nutrition',
  grams_per_ml numeric,
  status catalog.publication_status not null default 'published',
  published_at timestamp with time zone,
  created_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_products primary key (id),
  constraint ck_products_grams_per_ml check (grams_per_ml is null or grams_per_ml between 0.1 and 3),
  constraint uq_products_barcode unique (barcode),
  constraint ck_products_barcode check (barcode ~ '^[0-9]{8,14}$'),
  constraint ck_products_name check (char_length(btrim(name)) between 1 and 120),
  constraint ck_products_brand check (brand is null or char_length(btrim(brand)) between 1 and 80),
  constraint ck_products_quantity_label check (quantity_label is null or char_length(btrim(quantity_label)) between 1 and 40),
  constraint ck_products_icon check (icon ~ '^[a-z][a-zA-Z]*$')
);

create index idx_products_status_name on nutrition.products (status, name_normalized text_pattern_ops);
create index idx_products_status_brand on nutrition.products (status, brand_normalized text_pattern_ops);

create table nutrition.product_nutrients (
  product_id uuid not null,
  nutrient_definition_id uuid not null,
  value_per_100g numeric not null,
  unit_code text not null,
  constraint pk_product_nutrients primary key (product_id, nutrient_definition_id),
  constraint fk_product_nutrients_product foreign key (product_id) references nutrition.products (id) on delete cascade,
  constraint fk_product_nutrients_definition foreign key (nutrient_definition_id) references nutrition.nutrient_definitions (id) on delete restrict,
  constraint fk_product_nutrients_unit foreign key (unit_code) references catalog.units (code) on delete restrict,
  constraint ck_product_nutrients_value check (value_per_100g >= 0)
);

create trigger trg_product_nutrients_unit
  before insert or update on nutrition.product_nutrients
  for each row execute function nutrition.enforce_canonical_unit();

create table nutrition.product_portions (
  id uuid not null default extensions.uuid_generate_v7(),
  product_id uuid not null,
  label text not null,
  grams numeric not null,
  position integer not null,
  is_default boolean not null default false,
  constraint pk_product_portions primary key (id),
  constraint uq_product_portions_label unique (product_id, label),
  constraint uq_product_portions_position unique (product_id, position),
  constraint fk_product_portions_product foreign key (product_id) references nutrition.products (id) on delete cascade,
  constraint ck_product_portions_grams check (grams > 0),
  constraint ck_product_portions_label check (char_length(btrim(label)) between 1 and 60),
  constraint ck_product_portions_position check (position between 1 and 20)
);

create unique index uidx_product_portions_default on nutrition.product_portions (product_id) where is_default;

-- ———————————————————————————————————————— recognition consent (OP-NUT-017)

create table nutrition.recognition_consent_versions (
  version text not null,
  published_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_recognition_consent_versions primary key (version),
  constraint ck_recognition_consent_versions_version check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

insert into nutrition.recognition_consent_versions (version) values ('2026-10-04');

create table nutrition.recognition_consents (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  text_version text not null,
  accepted_at timestamp with time zone not null default clock_timestamp(),
  constraint pk_recognition_consents primary key (id),
  constraint uq_recognition_consents_version unique (person_id, text_version),
  constraint fk_recognition_consents_person foreign key (person_id) references identity.people (id) on delete restrict,
  constraint fk_recognition_consents_version foreign key (text_version) references nutrition.recognition_consent_versions (version) on delete restrict
);

create index idx_recognition_consents_person on nutrition.recognition_consents (person_id, accepted_at desc);

-- ———————————————————————————————————————— where each item came from (ADR-041 §6)

alter table nutrition.meal_items add column food_id uuid constraint fk_meal_items_food references nutrition.foods (id) on delete restrict;
alter table nutrition.meal_items add column product_id uuid constraint fk_meal_items_product references nutrition.products (id) on delete restrict;
alter table nutrition.meal_items add column origin nutrition.item_origin not null default 'typed';
-- How the person said the amount («1½ taza», «210 ml»); the nutrients still follow the grams.
alter table nutrition.meal_items add column serving text;
alter table nutrition.meal_items add constraint ck_meal_items_serving check (
  serving is null or char_length(btrim(serving)) between 1 and 40);
-- Picked from the catalogue names exactly one food or product; a photo only ever a food.
alter table nutrition.meal_items add constraint ck_meal_items_origin check (
  (origin = 'catalog' and num_nonnulls(food_id, product_id) = 1)
  or (origin = 'typed' and food_id is null and product_id is null)
  or (origin = 'photo' and product_id is null));

create index idx_meal_items_person_food on nutrition.meal_items (person_id, food_id) where food_id is not null;
create index idx_meal_items_person_product on nutrition.meal_items (person_id, product_id) where product_id is not null;

alter table nutrition.meals add column recognized_by text;
alter table nutrition.meals add constraint ck_meals_recognized_by check (
  recognized_by is null or recognized_by ~ '^[a-z0-9-]+/[a-z0-9.-]+$');

-- ———————————————————————————————————————— ownership and RLS

alter table nutrition.foods owner to allfit_owner;
alter table nutrition.food_aliases owner to allfit_owner;
alter table nutrition.food_nutrients owner to allfit_owner;
alter table nutrition.food_portions owner to allfit_owner;
alter table nutrition.food_recipe_parts owner to allfit_owner;
alter table nutrition.products owner to allfit_owner;
alter table nutrition.product_nutrients owner to allfit_owner;
alter table nutrition.product_portions owner to allfit_owner;
alter table nutrition.recognition_consent_versions owner to allfit_owner;
alter table nutrition.recognition_consents owner to allfit_owner;

alter table nutrition.foods enable row level security;
alter table nutrition.foods force row level security;
alter table nutrition.food_aliases enable row level security;
alter table nutrition.food_aliases force row level security;
alter table nutrition.food_nutrients enable row level security;
alter table nutrition.food_nutrients force row level security;
alter table nutrition.food_portions enable row level security;
alter table nutrition.food_portions force row level security;
alter table nutrition.food_recipe_parts enable row level security;
alter table nutrition.food_recipe_parts force row level security;
alter table nutrition.products enable row level security;
alter table nutrition.products force row level security;
alter table nutrition.product_nutrients enable row level security;
alter table nutrition.product_nutrients force row level security;
alter table nutrition.product_portions enable row level security;
alter table nutrition.product_portions force row level security;
alter table nutrition.recognition_consent_versions enable row level security;
alter table nutrition.recognition_consent_versions force row level security;
alter table nutrition.recognition_consents enable row level security;
alter table nutrition.recognition_consents force row level security;

-- The catalogue is read, published only; nothing at runtime writes it.
create policy foods_select_published on nutrition.foods
  for select to allfit_owner using (status = 'published');
create policy food_aliases_select_published on nutrition.food_aliases
  for select to allfit_owner using (exists (
    select 1 from nutrition.foods as food where food.id = food_id and food.status = 'published'));
create policy food_nutrients_select_published on nutrition.food_nutrients
  for select to allfit_owner using (exists (
    select 1 from nutrition.foods as food where food.id = food_id and food.status = 'published'));
create policy food_portions_select_published on nutrition.food_portions
  for select to allfit_owner using (exists (
    select 1 from nutrition.foods as food where food.id = food_id and food.status = 'published'));
create policy food_recipe_parts_select_published on nutrition.food_recipe_parts
  for select to allfit_owner using (exists (
    select 1 from nutrition.foods as food where food.id = dish_id and food.status = 'published'));
create policy products_select_published on nutrition.products
  for select to allfit_owner using (status = 'published');
create policy product_nutrients_select_published on nutrition.product_nutrients
  for select to allfit_owner using (exists (
    select 1 from nutrition.products as product where product.id = product_id and product.status = 'published'));
create policy product_portions_select_published on nutrition.product_portions
  for select to allfit_owner using (exists (
    select 1 from nutrition.products as product where product.id = product_id and product.status = 'published'));
create policy recognition_consent_versions_select_all on nutrition.recognition_consent_versions
  for select to allfit_owner using (true);
create policy recognition_consents_all_self on nutrition.recognition_consents
  for all to allfit_owner
  using (access_control.is_self(person_id))
  with check (access_control.is_self(person_id));

-- ———————————————————————————————————————— a food as the API answers it

create function nutrition.food_json(p_food_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', food.id,
    'name', food.name,
    'kind', food.kind,
    'brand', null,
    'icon', food.icon,
    'grams_per_ml', food.grams_per_ml,
    'nutrients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nutrient_code', definition.code, 'value_per_100g', value.value_per_100g, 'unit', value.unit_code)
        order by definition.code)
      from nutrition.food_nutrients as value
      join nutrition.nutrient_definitions as definition on definition.id = value.nutrient_definition_id
      where value.food_id = food.id), '[]'::jsonb),
    'portions', coalesce((
      select jsonb_agg(jsonb_build_object('label', portion.label, 'grams', portion.grams, 'is_default', portion.is_default)
        order by portion.position)
      from nutrition.food_portions as portion
      where portion.food_id = food.id), '[]'::jsonb))
  from nutrition.foods as food
  where food.id = p_food_id
$function$;

alter function nutrition.food_json(uuid) owner to allfit_owner;
revoke all on function nutrition.food_json(uuid) from public;

-- A product answers in a food's shape, of kind `product` and with its brand.
create function nutrition.product_json(p_product_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', product.id,
    'name', product.name,
    'kind', 'product',
    'brand', product.brand,
    'icon', product.icon,
    'grams_per_ml', product.grams_per_ml,
    'nutrients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nutrient_code', definition.code, 'value_per_100g', value.value_per_100g, 'unit', value.unit_code)
        order by definition.code)
      from nutrition.product_nutrients as value
      join nutrition.nutrient_definitions as definition on definition.id = value.nutrient_definition_id
      where value.product_id = product.id), '[]'::jsonb),
    'portions', coalesce((
      select jsonb_agg(jsonb_build_object('label', portion.label, 'grams', portion.grams, 'is_default', portion.is_default)
        order by portion.position)
      from nutrition.product_portions as portion
      where portion.product_id = product.id), '[]'::jsonb))
  from nutrition.products as product
  where product.id = p_product_id
$function$;

alter function nutrition.product_json(uuid) owner to allfit_owner;
revoke all on function nutrition.product_json(uuid) from public;

-- ———————————————————————————————————————— search (OP-NUT-014)

create function nutrition.search_foods(p_query text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  needle text := nutrition.normalize_food_name(coalesce(p_query, ''));
  size integer := least(greatest(coalesce(p_limit, 20), 1), 30);
  pattern text;
  words text[];
  rows jsonb;
begin
  if char_length(needle) not between 1 and 80 then
    raise exception 'a search has between one and eighty characters' using errcode = '22023';
  end if;
  if access_control.actor_kind() <> 'person' then
    return jsonb_build_object('data', '[]'::jsonb);
  end if;
  -- The needle is matched literally: % and _ are not wildcards here.
  pattern := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');
  words := regexp_split_to_array(pattern, ' ');

  -- The phrase ranks first (exact, prefix, word start, inside); then every word anywhere in
  -- the name, brand or synonyms («leche alqueria»). On a tie Allfit's own food comes first.
  with terms as (
    select food.id, false as is_product, food.name_normalized, food.name_normalized as term
    from nutrition.foods as food where food.status = 'published'
    union all
    select alias.food_id, false, food.name_normalized, alias.alias_normalized
    from nutrition.food_aliases as alias
    join nutrition.foods as food on food.id = alias.food_id and food.status = 'published'
    union all
    select product.id, true, product.name_normalized, term
    from nutrition.products as product
    cross join lateral (values (product.name_normalized), (nullif(product.brand_normalized, '')),
                               (nullif(product.brand_normalized, '') || ' ' || product.name_normalized),
                               (product.name_normalized || ' ' || nullif(product.brand_normalized, ''))) as one (term)
    where product.status = 'published' and term is not null
  ),
  scored as (
    select id, is_product, name_normalized,
           min(case
                 when term = needle then 0
                 when term like pattern || '%' then 1
                 when term like '% ' || pattern || '%' then 2
                 when term like '%' || pattern || '%' then 3
                 else 4 end) as rank,
           string_agg(term, ' ') as haystack
    from terms
    group by id, is_product, name_normalized
  ),
  candidates as (
    select id, is_product, name_normalized, rank
    from scored
    where rank < 4
       or not exists (select 1 from unnest(words) as word where scored.haystack not like '%' || word || '%')
  )
  select coalesce(jsonb_agg(
           case when chosen.is_product then nutrition.product_json(chosen.id) else nutrition.food_json(chosen.id) end
           order by chosen.rank, chosen.is_product, chosen.name_normalized), '[]'::jsonb)
  into rows
  from (select * from candidates order by rank, is_product, name_normalized limit size) as chosen;

  return jsonb_build_object('data', rows);
end
$function$;

-- ———————————————————————————————————————— recognised names meet their food

-- Exact name or synonym, then singular, then the longest catalogue name the recognised one
-- starts with («yuca frita» → «yuca»). Nothing looser — not even «sopa» for «sopa de
-- mondongo»: a wrong food is worse than none, which the person picks.
create function nutrition.match_foods(p_names text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  name text;
  needle text;
  found uuid;
  answer jsonb := '[]'::jsonb;
begin
  if access_control.actor_kind() <> 'person' then
    return '[]'::jsonb;
  end if;
  foreach name in array coalesce(p_names, array[]::text[]) loop
    needle := nutrition.normalize_food_name(coalesce(name, ''));
    found := null;
    if needle <> '' then
      select food.id into found
      from nutrition.foods as food
      left join nutrition.food_aliases as alias on alias.food_id = food.id
      where food.status = 'published'
        and (food.name_normalized = needle or alias.alias_normalized = needle
             or food.name_normalized = regexp_replace(needle, '(es|s)$', '')
             or alias.alias_normalized = regexp_replace(needle, '(es|s)$', ''))
      limit 1;
      if found is null then
        select food.id into found
        from nutrition.foods as food
        where food.status = 'published' and needle like food.name_normalized || ' %'
        order by char_length(food.name_normalized) desc
        limit 1;
      end if;
    end if;
    answer := answer || jsonb_build_array(case when found is null then null else nutrition.food_json(found) end);
  end loop;
  return answer;
end
$function$;

-- ———————————————————————————————————————— what a person logs most (OP-NUT-015)

create function nutrition.my_frequent_foods(p_person_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  size integer := least(greatest(coalesce(p_limit, 10), 1), 10);
  rows jsonb;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return jsonb_build_object('data', '[]'::jsonb);
  end if;

  with logged as (
    select item.food_id, item.product_id, count(*) as times, max(meal.occurred_at) as last_at
    from nutrition.meal_items as item
    join nutrition.meals as meal on meal.id = item.meal_id
    left join nutrition.foods as food on food.id = item.food_id and food.status = 'published'
    left join nutrition.products as product on product.id = item.product_id and product.status = 'published'
    where item.person_id = p_person_id and (food.id is not null or product.id is not null)
    group by item.food_id, item.product_id
    order by count(*) desc, max(meal.occurred_at) desc
    limit size
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'food', case when logged.food_id is not null then nutrition.food_json(logged.food_id)
                   else nutrition.product_json(logged.product_id) end,
      'times', logged.times,
      'last_portion', (
        select jsonb_build_object(
          'quantity', item.quantity_numeric,
          'quantity_unit', item.quantity_unit_code,
          'grams', case when item.quantity_unit_code = 'g' then item.quantity_numeric end)
        from nutrition.meal_items as item
        join nutrition.meals as meal on meal.id = item.meal_id
        where item.person_id = p_person_id
          and item.food_id is not distinct from logged.food_id
          and item.product_id is not distinct from logged.product_id
        order by meal.occurred_at desc, item.position
        limit 1))
    order by logged.times desc, logged.last_at desc), '[]'::jsonb)
  into rows
  from logged;

  return jsonb_build_object('data', rows);
end
$function$;

-- ———————————————————————————————————————— consent (OP-NUT-017)

create function nutrition.read_recognition_consent(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  latest record;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    return null;
  end if;
  select text_version, accepted_at into latest
  from nutrition.recognition_consents
  where person_id = p_person_id
  order by accepted_at desc
  limit 1;
  return jsonb_build_object('accepted_version', latest.text_version, 'accepted_at', latest.accepted_at);
end
$function$;

create function nutrition.accept_recognition_consent(
  p_person_id uuid,
  p_version text,
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
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'nutrition person does not match the authenticated actor' using errcode = '42501';
  end if;
  if not exists (select 1 from nutrition.recognition_consent_versions where version = p_version) then
    raise exception 'unknown consent text version' using errcode = '22023';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-NUT-017', p_idempotency_key, p_command_id, p_request_hash
  );
  if receipt.claimed then
    insert into nutrition.recognition_consents (id, person_id, text_version)
    values (p_command_id, p_person_id, p_version)
    on conflict on constraint uq_recognition_consents_version do nothing;
    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'consent-accepted', 'nutrition_recognition_consent', p_command_id);
  end if;

  return nutrition.read_recognition_consent(p_person_id);
end
$function$;

-- ———————————————————————————————————————— meals carry where each item came from

create or replace function nutrition.meal_json(p_meal_id uuid)
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
    'recognized_by', meal.recognized_by,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', item.position,
        'name', item.name,
        'quantity', item.quantity_numeric,
        'quantity_unit', item.quantity_unit_code,
        'serving', item.serving,
        'food_id', item.food_id,
        'product_id', item.product_id,
        'origin', item.origin,
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

create or replace function nutrition.write_items(p_meal_id uuid, p_person_id uuid, p_items jsonb)
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

    -- ADR-041 §6: a food is named only when the catalogue publishes it.
    if nullif(entry->>'food_id', '') is not null and not exists (
      select 1 from nutrition.foods where id = (entry->>'food_id')::uuid and status = 'published'
    ) then
      raise exception 'an item names a food the catalogue does not publish' using errcode = '23514';
    end if;
    if nullif(entry->>'product_id', '') is not null and not exists (
      select 1 from nutrition.products where id = (entry->>'product_id')::uuid and status = 'published'
    ) then
      raise exception 'an item names a product the catalogue does not publish' using errcode = '23514';
    end if;

    insert into nutrition.meal_items (
      meal_id, person_id, position, name, quantity_numeric, quantity_unit_code, serving, food_id, product_id, origin
    )
    values (p_meal_id, p_person_id, (entry->>'position')::integer, entry->>'name',
            nullif(entry->>'quantity', '')::numeric, nullif(entry->>'quantity_unit', ''),
            nullif(btrim(entry->>'serving'), ''),
            nullif(entry->>'food_id', '')::uuid, nullif(entry->>'product_id', '')::uuid,
            coalesce(nullif(entry->>'origin', ''), 'typed')::nutrition.item_origin)
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

create or replace function nutrition.record_meal(
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

  insert into nutrition.meals (id, person_id, occurred_at, timezone, local_date, meal_type, note, recognized_by)
  values (p_command_id, p_person_id, occurred, zone, (occurred at time zone zone)::date,
          (p_meal->>'meal_type')::nutrition.meal_type, nullif(btrim(p_meal->>'note'), ''),
          nullif(btrim(p_meal->>'recognized_by'), ''));

  perform nutrition.write_items(p_command_id, p_person_id, coalesce(p_meal->'items', '[]'::jsonb));

  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'meal-recorded', 'nutrition_meal', p_command_id);

  return nutrition.meal_json(p_command_id);
end
$function$;

create or replace function nutrition.revise_meal(
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
      recognized_by = case when p_patch ? 'recognized_by' then nullif(btrim(p_patch->>'recognized_by'), '') else recognized_by end,
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

-- ———————————————————————————————————————— grants

alter function nutrition.search_foods(text, integer) owner to allfit_owner;
revoke all on function nutrition.search_foods(text, integer) from public;
grant execute on function nutrition.search_foods(text, integer) to allfit_api;
alter function nutrition.match_foods(text[]) owner to allfit_owner;
revoke all on function nutrition.match_foods(text[]) from public;
grant execute on function nutrition.match_foods(text[]) to allfit_api;
alter function nutrition.my_frequent_foods(uuid, integer) owner to allfit_owner;
revoke all on function nutrition.my_frequent_foods(uuid, integer) from public;
grant execute on function nutrition.my_frequent_foods(uuid, integer) to allfit_api;
alter function nutrition.read_recognition_consent(uuid) owner to allfit_owner;
revoke all on function nutrition.read_recognition_consent(uuid) from public;
grant execute on function nutrition.read_recognition_consent(uuid) to allfit_api;
alter function nutrition.accept_recognition_consent(uuid, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function nutrition.accept_recognition_consent(uuid, text, uuid, uuid, bytea) from public;
grant execute on function nutrition.accept_recognition_consent(uuid, text, uuid, uuid, bytea) to allfit_api;

commit;
