-- What a movement is, for somebody who does not already know.
--
-- The picker offers a name and a line of metadata. Somebody who has never done a hip
-- thrust cannot find out what it is before putting it in their routine, because there
-- is nowhere to look. This is that somewhere: other names it goes by, what it works
-- and what it merely uses, how it is done, and what to do instead.
--
-- **Two of the three were specified and never built.** `V1_DATA_DICTIONARY.md` §8.5
-- and §8.6 define `movement_aliases` and `movement_variants` down to their columns and
-- uniques. `movement_instructions` is new to the model, so it entered the dictionary,
-- both ERDs, the object catalogue, the RLS matrix and `PR-14` before this file existed.
--
-- **`relation` and `note` are two columns because they are two things.** `relation`
-- says what kind of relation it is and is for querying; `note` says why it matters to
-- the person reading, in one phrase — «más pectoral superior». A code is not shown and
-- a phrase is not queried.
--
-- **The instructions are exercise instruction, and that has consequences.** A badly
-- written step is not a typo; it is somebody loading their spine wrong. The text is
-- curated like the rest of the global catalogue — only Allfit publishes it — and it is
-- not published without review by somebody with technical judgement. The control is
-- the review of the change, not a column: a `status` here would only move the question
-- somewhere else. `allfit_api` gets `select` and nothing more.
--
-- Every child inherits the parent's visibility rather than restating it, which is what
-- the dictionary says and what keeps a private movement from leaking through its own
-- alias. A variant needs **both** ends visible and widens neither.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- Another name the same movement goes by, including the English one, which is how a
-- lot of people search.
create table catalog.movement_aliases (
  id uuid not null default extensions.uuid_generate_v7(),
  movement_id uuid not null,
  locale text not null default 'es',
  name text not null,
  constraint pk_movement_aliases primary key (id),
  constraint fk_movement_aliases_movement foreign key (movement_id) references catalog.movements(id) on delete cascade,
  constraint uq_movement_aliases unique (movement_id, locale, name),
  constraint ck_movement_aliases_locale check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint ck_movement_aliases_name check (btrim(name) <> '')
);

create index idx_movement_aliases_movement on catalog.movement_aliases (movement_id);

alter table catalog.movement_aliases enable row level security;
alter table catalog.movement_aliases force row level security;

create policy movement_aliases_select_actor on catalog.movement_aliases
  for select
  using (exists (select 1 from catalog.movements as movement where movement.id = movement_id));

-- How it is done, in order. Curated and reviewed; see the header.
create table catalog.movement_instructions (
  id uuid not null default extensions.uuid_generate_v7(),
  movement_id uuid not null,
  locale text not null default 'es',
  position integer not null,
  text text not null,
  constraint pk_movement_instructions primary key (id),
  constraint fk_movement_instructions_movement foreign key (movement_id) references catalog.movements(id) on delete cascade,
  constraint uq_movement_instructions unique (movement_id, locale, position),
  constraint ck_movement_instructions_locale check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint ck_movement_instructions_position check (position > 0),
  constraint ck_movement_instructions_text check (btrim(text) <> '')
);

-- The index is also the reading order, so the projection never sorts separately.
create index idx_movement_instructions_reading
  on catalog.movement_instructions (movement_id, locale, position);

alter table catalog.movement_instructions enable row level security;
alter table catalog.movement_instructions force row level security;

create policy movement_instructions_select_actor on catalog.movement_instructions
  for select
  using (exists (select 1 from catalog.movements as movement where movement.id = movement_id));

-- What to do instead, and why it is worth doing instead.
create table catalog.movement_variants (
  id uuid not null default extensions.uuid_generate_v7(),
  base_movement_id uuid not null,
  variant_movement_id uuid not null,
  relation text not null default 'variant',
  note text,
  constraint pk_movement_variants primary key (id),
  constraint fk_movement_variants_base foreign key (base_movement_id) references catalog.movements(id) on delete restrict,
  constraint fk_movement_variants_variant foreign key (variant_movement_id) references catalog.movements(id) on delete restrict,
  constraint uq_movement_variants unique (base_movement_id, variant_movement_id),
  constraint ck_movement_variants_distinct check (base_movement_id <> variant_movement_id),
  constraint ck_movement_variants_relation check (relation in ('variant', 'regression', 'progression')),
  constraint ck_movement_variants_note check (note is null or btrim(note) <> '')
);

create index idx_movement_variants_base on catalog.movement_variants (base_movement_id);

alter table catalog.movement_variants enable row level security;
alter table catalog.movement_variants force row level security;

-- Both ends, and it widens neither: a variant is not a way to see a movement you
-- could not otherwise see.
create policy movement_variants_select_actor on catalog.movement_variants
  for select
  using (
    exists (select 1 from catalog.movements as base where base.id = base_movement_id)
    and exists (select 1 from catalog.movements as other where other.id = variant_movement_id)
  );

alter table catalog.movement_aliases owner to allfit_owner;
alter table catalog.movement_instructions owner to allfit_owner;
alter table catalog.movement_variants owner to allfit_owner;

grant select on catalog.movement_aliases to allfit_api;
grant select on catalog.movement_instructions to allfit_api;
grant select on catalog.movement_variants to allfit_api;

commit;

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- `OP-CAT-010`. The whole movement in one call, because a detail screen that arrived
-- in five pieces would draw itself five times.
--
-- Null for a movement nobody can see, which is the same answer as one that does not
-- exist: distinguishing them would let identifiers be walked to learn what exists.
create function catalog.read_movement(p_person_id uuid, p_movement_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', movement.id,
    'discipline_code', movement.discipline_code,
    'name', movement.name,
    'aliases', coalesce(named.names, array[]::text[]),
    'muscles', coalesce(worked.entries, '[]'::jsonb),
    'equipment', coalesce(needed.codes, array[]::text[]),
    'instructions', coalesce(steps.entries, '[]'::jsonb),
    'variants', coalesce(alike.entries, '[]'::jsonb)
  )
  from catalog.movements as movement
  left join lateral (
    select array_agg(alias.name order by alias.name) as names
    from catalog.movement_aliases as alias
    where alias.movement_id = movement.id and alias.locale = 'es'
  ) as named on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('code', muscle.code, 'name', muscle.name, 'primary', link.is_primary)
      order by link.is_primary desc, muscle.display_order
    ) as entries
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
  left join lateral (
    -- Ordered here, which the index already provides, so the screen never has to.
    select jsonb_agg(
      jsonb_build_object('position', step.position, 'text', step.text)
      order by step.position
    ) as entries
    from catalog.movement_instructions as step
    where step.movement_id = movement.id and step.locale = 'es'
  ) as steps on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', other.id,
        'name', other.name,
        'relation', link.relation,
        'note', link.note
      ) order by other.name
    ) as entries
    from catalog.movement_variants as link
    join catalog.movements as other on other.id = link.variant_movement_id
    where link.base_movement_id = movement.id
      and other.content_scope = 'global' and other.status = 'published'
  ) as alike on true
  where movement.id = p_movement_id
    and movement.content_scope = 'global'
    and movement.status = 'published'
    and p_person_id is not null
$function$;

alter function catalog.read_movement(uuid, uuid) owner to allfit_owner;
revoke all on function catalog.read_movement(uuid, uuid) from public;
grant execute on function catalog.read_movement(uuid, uuid) to allfit_api;

commit;
