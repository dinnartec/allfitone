-- The cursor `OP-CAT-009` always declared, and the demonstration in both projections.
--
-- **The cap alone was a trap.** The search answered a bare array with `limit` clamped
-- to a hundred, so a client that asked for everything got a full page and no way to
-- learn there was more. That was harmless while the library was a few dozen movements
-- and stops being harmless the moment it grows: a full page looks exactly like the
-- whole catalogue. The operations matrix has said «cursor» all along; this builds it.
--
-- **Keyset, not offset.** The order is the normalized name with the identifier as the
-- tie-break, and the cursor carries that exact pair, so a page never skips or repeats a
-- row when the catalogue changes underneath a walk. An offset would do both.
--
-- The cursor is opaque on purpose — a client that parsed it would depend on the order
-- being what it is today. A malformed one raises rather than answering an arbitrary
-- page, because a wrong page looks like a right one.
--
-- **Both projections gain the demonstration, as a key.** The URL is composed from
-- configuration by the application; storing it would tie the row to today's origin.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- The pair the ordering is defined on, in one place so the reader and the cursor
-- cannot drift apart.
create function catalog.movement_cursor(p_name text, p_id uuid)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select encode(
    convert_to(catalog.normalize_movement_name(p_name) || chr(31) || p_id::text, 'UTF8'),
    'base64'
  )
$function$;

alter function catalog.movement_cursor(text, uuid) owner to allfit_owner;

create function catalog.movement_cursor_parts(p_cursor text)
returns table (sort_name text, sort_id uuid)
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  decoded text;
  parts text[];
begin
  if p_cursor is null or btrim(p_cursor) = '' then
    return;
  end if;

  begin
    decoded := convert_from(decode(p_cursor, 'base64'), 'UTF8');
  exception when others then
    raise exception 'invalid cursor' using errcode = '22023';
  end;

  parts := string_to_array(decoded, chr(31));
  if array_length(parts, 1) <> 2 then
    raise exception 'invalid cursor' using errcode = '22023';
  end if;

  begin
    sort_name := parts[1];
    sort_id := parts[2]::uuid;
  exception when others then
    raise exception 'invalid cursor' using errcode = '22023';
  end;

  return next;
end;
$function$;

alter function catalog.movement_cursor_parts(text) owner to allfit_owner;

commit;

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

drop function if exists catalog.read_movements(uuid, text, text, integer, text[], text[]);

create function catalog.read_movements(
  p_person_id uuid,
  p_discipline_code text,
  p_query text,
  p_limit integer,
  p_muscles text[] default null,
  p_equipment text[] default null,
  p_cursor text default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  with bound as (
    select least(greatest(coalesce(p_limit, 40), 1), 100) as size
  ),
  start as (
    select sort_name, sort_id from catalog.movement_cursor_parts(p_cursor)
  ),
  matched as (
    select
      catalog.normalize_movement_name(movement.name) as sort_name,
      movement.id as sort_id,
      jsonb_build_object(
        'id', movement.id,
        'discipline_code', movement.discipline_code,
        'name', movement.name,
        'muscles', coalesce(worked.codes, array[]::text[]),
        'equipment', coalesce(needed.codes, array[]::text[]),
        'demo_object_key', shown.object_key
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
    left join lateral (
      select media.object_key
      from catalog.movement_media as media
      where media.movement_id = movement.id and media.kind = 'demo'
    ) as shown on true
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
      -- Keyset: strictly after the pair the cursor carries, never an offset.
      and (
        not exists (select 1 from start)
        or (catalog.normalize_movement_name(movement.name), movement.id)
             > (select sort_name, sort_id from start)
      )
    order by sort_name, sort_id
    -- One more than asked, which is how `has_more` is known without a second count.
    limit (select size from bound) + 1
  ),
  page as (
    select * from matched order by sort_name, sort_id limit (select size from bound)
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(item order by sort_name, sort_id) from page), '[]'::jsonb),
    'page', jsonb_build_object(
      'next_cursor', (
        select catalog.movement_cursor(last.item->>'name', (last.item->>'id')::uuid)
        from (select item, sort_name, sort_id from page order by sort_name desc, sort_id desc limit 1) as last
        where (select count(*) from matched) > (select size from bound)
      ),
      'has_more', (select count(*) from matched) > (select size from bound)
    )
  )
$function$;

alter function catalog.read_movements(uuid, text, text, integer, text[], text[], text)
  owner to allfit_owner;
revoke all on function catalog.read_movements(uuid, text, text, integer, text[], text[], text)
  from public;
grant execute on function catalog.read_movements(uuid, text, text, integer, text[], text[], text)
  to allfit_api;

commit;

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

create or replace function catalog.read_movement(p_person_id uuid, p_movement_id uuid)
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
    'variants', coalesce(alike.entries, '[]'::jsonb),
    'demo_object_key', shown.object_key
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
  left join lateral (
    select media.object_key
    from catalog.movement_media as media
    where media.movement_id = movement.id and media.kind = 'demo'
  ) as shown on true
  where movement.id = p_movement_id
    and movement.content_scope = 'global'
    and movement.status = 'published'
    and p_person_id is not null
$function$;

commit;
