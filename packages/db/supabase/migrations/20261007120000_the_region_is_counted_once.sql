-- A programme's region is counted once per question, not once per candidate.
--
-- Picking a routine's cover compares its region with that of every programme in the
-- catalogue, and `program_region` answered one programme at a time: twenty-four calls
-- per routine, each crossing the steps under RLS with a plan that restarted the whole
-- chain per muscle. `read_my_content` spent half a second of its 0.65 s there, and the
-- programme detail and the history paid the same through the same pickers.
--
-- `program_regions` answers a set of programmes in one pass. It counts each movement
-- per programme first and only then crosses it with its muscles, so the RLS chain runs
-- over a handful of rows instead of thousands. The rule does not change, and
-- `program_region` now asks it for one programme so the rule is written once.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

create function planning.program_regions(p_program_ids uuid[])
 RETURNS TABLE(program_id uuid, region text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  with
  -- A step repeated across weeks or versions counts each time, as it always did.
  moved as materialized (
    select version.program_id, step.movement_id, count(*) as times
    from planning.program_versions as version
    join planning.program_version_sessions as composition
      on composition.program_version_id = version.id
    join planning.planned_steps as step
      on step.template_version_id = composition.template_version_id
    where version.program_id = any(p_program_ids)
      and step.movement_id is not null
    group by version.program_id, step.movement_id
  ),
  worked as materialized (
    select link.movement_id, link.is_primary, muscle.region
    from catalog.movement_muscles as link
    join catalog.muscles as muscle on muscle.id = link.muscle_id
    where link.movement_id in (select moved.movement_id from moved)
  )
  select distinct on (moved.program_id) moved.program_id, worked.region
  from moved
  join worked on worked.movement_id = moved.movement_id
  group by moved.program_id, worked.region
  -- The primaries decide; the total breaks the tie, then the name.
  order by moved.program_id,
           sum(moved.times) filter (where worked.is_primary) desc nulls last,
           sum(moved.times) desc,
           worked.region
$function$;

CREATE OR REPLACE FUNCTION planning.program_region(p_program_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select found.region from planning.program_regions(array[p_program_id]) as found
$function$;

CREATE OR REPLACE FUNCTION planning.pick_routine_cover(p_template_id uuid, p_region text, p_person_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  with
  catalogue as materialized (
    select source.id
    from planning.programs as source
    where source.content_scope = 'global'
      and source.status = 'published'
      and p_region is not null
  ),
  regions as materialized (
    select found.program_id, found.region
    from planning.program_regions(array(select catalogue.id from catalogue)) as found
  )
  select candidate.cover
  from (
    select catalogue.id,
           planning.cover_for(catalogue.id, p_person_id) as cover,
           regions.region = p_region as misma_region
    from catalogue
    left join regions on regions.program_id = catalogue.id
  ) as candidate
  -- Candidata es la que tiene fotografía **para quien pregunta**: prestar una que su
  -- juego no tiene sería dejar a la rutina sin cara teniendo el catálogo entero.
  where candidate.cover is not null
  -- Las de la misma región primero; dentro de ellas, un orden estable derivado del
  -- identificador de la plantilla, para que dos rutinas parecidas no salgan clonadas.
  order by candidate.misma_region desc nulls last,
           extensions.digest(p_template_id::text || candidate.id::text, 'sha256')
  limit 1
$function$;

CREATE OR REPLACE FUNCTION planning.pick_program_cover(p_program_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  with
  catalogue as materialized (
    select source.id
    from planning.programs as source
    where source.content_scope = 'global'
      and source.status = 'published'
      and exists (select 1 from planning.program_cover_photos as photo
                  where photo.program_id = source.id)
  ),
  regions as materialized (
    select found.program_id, found.region
    from planning.program_regions(
      array(select catalogue.id from catalogue) || p_program_id) as found
  )
  select catalogue.id
  from catalogue
  left join regions as theirs on theirs.program_id = catalogue.id
  -- Las de la misma región primero; dentro de ellas, un orden estable derivado del
  -- identificador del programa, para que dos programas parecidos no salgan clonados.
  order by theirs.region = (select mine.region from regions as mine
                            where mine.program_id = p_program_id) desc nulls last,
           extensions.digest(p_program_id::text || catalogue.id::text, 'sha256')
  limit 1
$function$;

alter function planning.program_regions(uuid[]) owner to allfit_owner;
revoke all on function planning.program_regions(uuid[]) from public;
grant execute on function planning.program_regions(uuid[]) to allfit_api;

commit;
