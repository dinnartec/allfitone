-- Searching the exercise library from Space.
--
-- `S-1 · Añadir ejercicio` needs the library that `curation/001_global_training_catalogue.sql`
-- already loads: thirty-eight global movements, published, readable by any
-- authenticated person under `movements_all_actor_access`. The policy was there and the
-- reader was not, so the screen had nothing to call.
--
-- **People do not create exercises.** The library is curated content and grows through
-- that script, which only we run. So this is a reader and nothing else: no command,
-- no person-scoped rows, and the content validators stay as they are.
--
-- Matching is `like` over `normalized_name` and not full text. The library is small
-- enough that a prefix index would be theatre, and somebody typing "senta" wants
-- everything containing it, which is not what a tsquery answers.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- Deterministic and boring on purpose, and applied to both sides of the comparison so
-- what somebody types matches how the row was stored. `unaccent` is not installed, so
-- folding accents here would be a lie about matching.
create function catalog.normalize_movement_name(p_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'))
$function$;

-- `OP-CAT-009`. Ordered by name because the library has no popularity to rank by, and
-- inventing one would be a claim about what people choose.
create function catalog.read_movements(
  p_person_id uuid,
  p_discipline_code text,
  p_query text,
  p_limit integer
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
        'name', movement.name
      ) as item
    from catalog.movements as movement
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
    order by movement.name
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ) as found
$function$;

alter function catalog.normalize_movement_name(text) owner to allfit_owner;
alter function catalog.read_movements(uuid, text, text, integer) owner to allfit_owner;
revoke all on function catalog.normalize_movement_name(text) from public;
revoke all on function catalog.read_movements(uuid, text, text, integer) from public;
grant execute on function catalog.read_movements(uuid, text, text, integer) to allfit_api;

commit;
