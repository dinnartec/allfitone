-- El catálogo enseña la cara, que es lo que la ficha ya pedía.
--
-- `OP-PLN-020` dice desde el 20 de septiembre que «la portada de cada programa es la del
-- juego de quien pregunta» y que se responde la dirección compuesta. La lectura del
-- catálogo no devolvía ninguna: la fotografía aparecía **después** de tomar el programa,
-- así que el primer día se elegía entre fichas de texto y la imagen llegaba cuando ya no
-- había nada que decidir. Elegir sobre un marcador de posición es no elegir.
--
-- **Es la misma dirección que responde `read_my_programs`**, resuelta por la misma
-- función: quien mira el catálogo y quien ya lo tomó ven la misma fotografía, que es lo
-- que hace que tomarlo no sea una sorpresa.
--
-- **Un programa sin fotografía responde nulo y no desaparece.** El filtro del catálogo
-- mira las sesiones, no la portada: quedarse fuera por no tener arte sería esconder
-- contenido publicado por una decisión de presentación.
--
-- Se suelta antes de crearla: `create or replace` no puede añadir una columna a lo que
-- una función devuelve.

set lock_timeout = '5s';
set statement_timeout = '60s';

drop function if exists planning.read_program_catalogue(uuid);

create function planning.read_program_catalogue(p_person_id uuid)
returns table (
  program_version_id uuid,
  program_id uuid,
  title text,
  weeks integer,
  days_per_week integer,
  sex_affinity text,
  goals text[],
  levels text[],
  emphases text[],
  cover_object_key text
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select version.id,
         program.id,
         version.title,
         case when version.repeats_forever then null else composition.weeks end,
         composition.days_per_week,
         version.sex_affinity::text,
         coalesce(goals.codes, array[]::text[]),
         coalesce(levels.codes, array[]::text[]),
         coalesce(emphases.codes, array[]::text[]),
         -- La del juego de quien pregunta, y nunca la clave de otra persona: `cover_for`
         -- sólo contesta cuando el actor de la sesión es quien se nombra aquí.
         planning.cover_for(program.id, p_person_id)
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day)::integer as days_per_week,
           count(*)::integer as sessions
    from planning.program_version_sessions as session
    where session.program_version_id = version.id
  ) as composition on true
  left join lateral (
    select array_agg(goal.goal_code order by goal.goal_code) as codes
    from planning.program_version_goals as goal
    where goal.program_version_id = version.id
  ) as goals on true
  left join lateral (
    select array_agg(level.experience_code order by level.experience_code) as codes
    from planning.program_version_levels as level
    where level.program_version_id = version.id
  ) as levels on true
  left join lateral (
    select array_agg(emphasis.focus_area_code order by emphasis.focus_area_code) as codes
    from planning.program_version_emphases as emphasis
    where emphasis.program_version_id = version.id
  ) as emphases on true
  where program.content_scope = 'global'
    and program.status = 'published'
    and version.status = 'published'
    and composition.sessions > 0
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by version.title, version.id
$function$;

comment on function planning.read_program_catalogue(uuid) is
  'The published global catalogue, with each programme''s cover for the set of whoever '
  'is asking. The key is answered, never the address: composing it is the surface''s job.';

alter function planning.read_program_catalogue(uuid) owner to allfit_owner;
revoke all on function planning.read_program_catalogue(uuid) from public;
grant execute on function planning.read_program_catalogue(uuid) to allfit_api;
