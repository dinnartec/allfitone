-- What a movement trains, and what it needs — so somebody can find it by either.
--
-- The exercise picker offers 38 movements and one way to narrow them: typing the
-- name. That only helps somebody who already knows what the exercise is called.
-- Filtering by muscle and by equipment is how a person who does not asks the
-- question they actually have — «what can I do for my back, with dumbbells».
--
-- **Equipment was specified and never built.** `V1_DATA_DICTIONARY.md` §8.7 and §8.8
-- define `catalog.equipment` and `catalog.movement_equipment` down to their columns,
-- uniques and indexes; `OP-CAT-011` defines `GET /catalog/v1/equipment`; the RLS
-- matrix names the predicate and the index. This builds them to that spec and
-- decides nothing.
--
-- **Muscles were not specified at all.** They are new to the model, so they were
-- added to `allfitone-docs` first — conceptual ERD, logical ERD, object catalogue,
-- dictionary §8.15 and §8.16, RLS matrix §7.5, `PR-14` and `OP-CAT-015`. Nothing here
-- precedes that.
--
-- **`body_slug` is the bridge to the body figure.** Space already draws a human body
-- in its onboarding so somebody can say what they want to work, and its parts are the
-- slugs of `react-native-body-highlighter`. Fifteen of the nineteen muscles here are
-- those exact slugs, so the filter and the figure speak one vocabulary and a later
-- screen can light one from the other. It is nullable because not everything that is
-- filtered is a drawable part: `cardio` and `whole_body` label the seven movements
-- that are not strength, which would otherwise carry no label at all.
--
-- **Nothing here is writable by the product.** The global catalogue is published by
-- Allfit alone (`HU-BO-022`, criterion 1), so `allfit_api` gets `select` and nothing
-- else. A muscle label written from Space would be curatorial content with no
-- curation behind it.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- The physical resource a movement is compatible with. Compatibility, never
-- inventory, availability or booking — `HU-SP-066`, criterion 1.
create table catalog.equipment (
  id uuid not null default extensions.uuid_generate_v7(),
  code text,
  name text not null,
  content_scope catalog.content_scope not null,
  owner_organization_id uuid,
  status catalog.publication_status not null default 'draft',
  display_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_equipment primary key (id),
  constraint fk_equipment_owner_organization foreign key (owner_organization_id) references organizations.organizations(id) on delete restrict,
  constraint ck_equipment_code check (code is null or code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_equipment_name check (btrim(name) <> ''),
  constraint ck_equipment_order check (display_order >= 0),
  -- The dictionary makes `code` nullable for private equipment and unique for global.
  -- Scope and owner have to agree, the same way `movements` makes them agree.
  constraint ck_equipment_scope_owner check (
    content_scope = 'global' and owner_organization_id is null and code is not null
    or content_scope = 'organization' and owner_organization_id is not null
  )
);

create unique index uidx_equipment_global_code
  on catalog.equipment (code) where content_scope = 'global';
create index idx_equipment_scope_owner
  on catalog.equipment (content_scope, owner_organization_id);

alter table catalog.equipment enable row level security;
alter table catalog.equipment force row level security;

create policy equipment_select_actor on catalog.equipment
  for select
  using (
    access_control.person() is not null
    and (
      content_scope = 'global' and status = 'published'
      or content_scope = 'organization' and owner_organization_id = access_control.org()
    )
  );

create table catalog.movement_equipment (
  id uuid not null default extensions.uuid_generate_v7(),
  movement_id uuid not null,
  equipment_id uuid not null,
  requirement text not null default 'required',
  constraint pk_movement_equipment primary key (id),
  constraint fk_movement_equipment_movement foreign key (movement_id) references catalog.movements(id) on delete cascade,
  constraint fk_movement_equipment_equipment foreign key (equipment_id) references catalog.equipment(id) on delete restrict,
  constraint uq_movement_equipment unique (movement_id, equipment_id),
  constraint ck_movement_equipment_requirement check (requirement in ('required', 'optional'))
);

create index idx_movement_equipment_equipment on catalog.movement_equipment (equipment_id);

alter table catalog.movement_equipment enable row level security;
alter table catalog.movement_equipment force row level security;

-- Inherited rather than restated: the link is visible exactly when both ends are,
-- which is what the dictionary says and what keeps a private movement from leaking
-- through its equipment.
create policy movement_equipment_select_actor on catalog.movement_equipment
  for select
  using (
    exists (select 1 from catalog.movements as movement where movement.id = movement_id)
    and exists (select 1 from catalog.equipment as item where item.id = equipment_id)
  );

-- The muscle vocabulary. Global and single: two gyms cannot disagree about what a
-- quadriceps is, so unlike equipment this has no organization scope.
create table catalog.muscles (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  region text not null,
  body_slug text,
  status catalog.publication_status not null default 'draft',
  display_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_muscles primary key (id),
  constraint uq_muscles_code unique (code),
  constraint ck_muscles_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_muscles_name check (btrim(name) <> ''),
  constraint ck_muscles_region check (region in ('upper', 'lower', 'general')),
  constraint ck_muscles_order check (display_order >= 0)
);

create index idx_muscles_status_order on catalog.muscles (status, display_order, code);

alter table catalog.muscles enable row level security;
alter table catalog.muscles force row level security;

create policy muscles_select_actor on catalog.muscles
  for select
  using (status = 'published' and access_control.person() is not null);

create table catalog.movement_muscles (
  id uuid not null default extensions.uuid_generate_v7(),
  movement_id uuid not null,
  muscle_id uuid not null,
  is_primary boolean not null default false,
  constraint pk_movement_muscles primary key (id),
  constraint fk_movement_muscles_movement foreign key (movement_id) references catalog.movements(id) on delete cascade,
  constraint fk_movement_muscles_muscle foreign key (muscle_id) references catalog.muscles(id) on delete restrict,
  constraint uq_movement_muscles unique (movement_id, muscle_id)
);

-- The inverse index is the one the filter uses: «which movements work this muscle».
create index idx_movement_muscles_muscle on catalog.movement_muscles (muscle_id);

alter table catalog.movement_muscles enable row level security;
alter table catalog.movement_muscles force row level security;

create policy movement_muscles_select_actor on catalog.movement_muscles
  for select
  using (
    exists (select 1 from catalog.movements as movement where movement.id = movement_id)
    and exists (select 1 from catalog.muscles as muscle where muscle.id = muscle_id)
  );

-- Owned like every other catalogue table. `force row level security` only bites the
-- owner, so a table left on `postgres` would be forced against the wrong role.
alter table catalog.equipment owner to allfit_owner;
alter table catalog.movement_equipment owner to allfit_owner;
alter table catalog.muscles owner to allfit_owner;
alter table catalog.movement_muscles owner to allfit_owner;

grant select on catalog.equipment to allfit_api;
grant select on catalog.movement_equipment to allfit_api;
grant select on catalog.muscles to allfit_api;
grant select on catalog.movement_muscles to allfit_api;

commit;

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- `OP-CAT-009` grows two filters, and every movement now says what it trains and
-- what it needs, because the row that offers an exercise is the row that has to
-- explain it.
--
-- **Several values of one filter are `or`; two different filters are `and`.** That is
-- how a filter reads: picking chest and back widens, adding dumbbells narrows.
-- Expressed with `&&` over the collected codes so the whole thing stays one pass.
--
-- Dropped rather than replaced: the signature gains parameters, and PostgreSQL will
-- not add them to a function already in use.
drop function if exists catalog.read_movements(uuid, text, text, integer);

create function catalog.read_movements(
  p_person_id uuid,
  p_discipline_code text,
  p_query text,
  p_limit integer,
  p_muscles text[] default null,
  p_equipment text[] default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select coalesce(jsonb_agg(item order by name), '[]'::jsonb)
  from (
    select
      movement.name,
      jsonb_build_object(
        'id', movement.id,
        'discipline_code', movement.discipline_code,
        'name', movement.name,
        'muscles', coalesce(worked.codes, array[]::text[]),
        'equipment', coalesce(needed.codes, array[]::text[])
      ) as item
    from catalog.movements as movement
    left join lateral (
      select array_agg(muscle.code order by link.is_primary desc, muscle.display_order) as codes
      from catalog.movement_muscles as link
      join catalog.muscles as muscle on muscle.id = link.muscle_id
      where link.movement_id = movement.id and muscle.status = 'published'
    ) as worked on true
    left join lateral (
      select array_agg(item.code order by item.display_order) as codes
      from catalog.movement_equipment as link
      join catalog.equipment as item on item.id = link.equipment_id
      where link.movement_id = movement.id
        and item.content_scope = 'global' and item.status = 'published'
    ) as needed on true
    where movement.content_scope = 'global'
      and movement.status = 'published'
      and p_person_id is not null
      and (p_discipline_code is null or movement.discipline_code = p_discipline_code)
      and (
        btrim(coalesce(p_query, '')) = ''
        or catalog.normalize_movement_name(movement.name)
             like '%' || replace(replace(replace(
                   catalog.normalize_movement_name(p_query),
                   '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
      and (
        p_muscles is null or cardinality(p_muscles) = 0
        or coalesce(worked.codes, array[]::text[]) && p_muscles
      )
      and (
        p_equipment is null or cardinality(p_equipment) = 0
        or coalesce(needed.codes, array[]::text[]) && p_equipment
      )
    order by movement.name
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ) as found
$function$;

alter function catalog.read_movements(uuid, text, text, integer, text[], text[])
  owner to allfit_owner;
revoke all on function catalog.read_movements(uuid, text, text, integer, text[], text[])
  from public;
grant execute on function catalog.read_movements(uuid, text, text, integer, text[], text[])
  to allfit_api;

-- `OP-CAT-011`. The vocabulary the filter draws its chips from, which is asked once
-- and does not change as somebody types: a filter whose chips come and go cannot be
-- used.
create function catalog.read_equipment(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select coalesce(jsonb_agg(
    jsonb_build_object('code', item.code, 'name', item.name)
    order by item.display_order, item.code
  ), '[]'::jsonb)
  from catalog.equipment as item
  where item.content_scope = 'global'
    and item.status = 'published'
    and p_person_id is not null
$function$;

alter function catalog.read_equipment(uuid) owner to allfit_owner;
revoke all on function catalog.read_equipment(uuid) from public;
grant execute on function catalog.read_equipment(uuid) to allfit_api;

-- `OP-CAT-015`. `region` travels because nineteen chips in one row is a wall; the
-- screen groups them, and grouping is not the screen's decision to invent.
create function catalog.read_muscles(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code', muscle.code,
      'name', muscle.name,
      'region', muscle.region,
      'body_slug', muscle.body_slug
    )
    order by muscle.display_order, muscle.code
  ), '[]'::jsonb)
  from catalog.muscles as muscle
  where muscle.status = 'published'
    and p_person_id is not null
$function$;

alter function catalog.read_muscles(uuid) owner to allfit_owner;
revoke all on function catalog.read_muscles(uuid) from public;
grant execute on function catalog.read_muscles(uuid) to allfit_api;

commit;
