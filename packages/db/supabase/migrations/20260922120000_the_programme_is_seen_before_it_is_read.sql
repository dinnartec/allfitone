-- El detalle del programa se ve antes de leerse.
--
-- `OP-PLN-021` pedía la portada desde el 20 de septiembre —«la del detalle es la misma
-- que la de la lista»— y la lectura no devolvía ninguna. La ficha se amplía hoy con las
-- otras dos que la pantalla necesita para que alguien decida mirando en vez de leyendo:
-- la de cada día del reparto.
--
-- **Dos imágenes con dos dueños distintos.** La del programa cuelga del programa y es
-- del juego de quien pregunta. La del día es la de su rutina, prestada del catálogo por
-- la región que esa rutina trabaja, así que es la misma que enseñará en Hoy cuando el
-- programa se tome — abrirlo y vivirlo no pueden ser dos productos.
--
-- **La demostración de cada ejercicio no entra aquí**, aunque la pantalla la dibuje: ya
-- tiene dueño en el catálogo de movimientos, y la biblioteca que lo sirve es una caché
-- de por vida del proceso. Colgarla también del paso habría puesto la misma imagen en
-- dos respuestas —y `SpaceProgramStep` lo comparten el reparto y la sesión, así que
-- obligaba a contestarla también donde nadie la pide.
--
-- **Nulo donde la curaduría no llegó**, en las dos. Un catálogo que crece tiene siempre
-- filas sin arte, y esa fila se dibuja sin imagen en vez de tumbar la lectura.
--
-- Se suelta antes de crearla: `create or replace` no puede añadir una columna al retorno.

-- La región que una versión publicada trabaja, que es lo que decide qué portada se le
-- presta. `region_of_content` hace lo mismo sobre el borrador, que es jsonb; una versión
-- ya tiene sus pasos en tabla, y pasarla por jsonb sólo para reusar aquélla sería
-- reconstruir lo que ya está.
create or replace function planning.region_of_version(p_template_version_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select muscle.region
  from planning.planned_steps as step
  join catalog.movement_muscles as link on link.movement_id = step.movement_id
  join catalog.muscles as muscle on muscle.id = link.muscle_id
  where step.template_version_id = p_template_version_id and muscle.status = 'published'
  group by muscle.region
  -- Los primarios mandan; el recuento total desempata. Igual que `region_of_content`.
  order by count(*) filter (where link.is_primary) desc, count(*) desc, muscle.region
  limit 1
$function$;

alter function planning.region_of_version(uuid) owner to allfit_owner;
revoke all on function planning.region_of_version(uuid) from public;
grant execute on function planning.region_of_version(uuid) to allfit_api;

drop function if exists planning.read_program_version(uuid, uuid);

create function planning.read_program_version(p_person_id uuid, p_program_version_id uuid)
returns table (
  program_version_id uuid,
  title text,
  notes text,
  weeks integer,
  days_per_week integer,
  sex_affinity text,
  goals text[],
  levels text[],
  emphases text[],
  days jsonb,
  cover_object_key text
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select version.id,
         version.title,
         version.notes,
         case when version.repeats_forever then null else composition.weeks end,
         composition.days_per_week,
         version.sex_affinity::text,
         coalesce(goals.codes, array[]::text[]),
         coalesce(levels.codes, array[]::text[]),
         coalesce(emphases.codes, array[]::text[]),
         coalesce(split.days, '[]'::jsonb),
         -- La misma que la lista, resuelta por la misma función: abrir un programa no
         -- puede ser encontrarse con otro programa.
         planning.cover_for(program.id, p_person_id)
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day) filter (where session.week = 1)::integer as days_per_week
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
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.day) as days
    from (
      select composed.day as day,
             template_version.title as title,
             template_version.discipline_code,
             -- La que la rutina lleva puesta, por la región que trabaja: la misma que
             -- enseñará en Hoy cuando el programa se tome.
             planning.pick_routine_cover(
               template_version.template_id,
               planning.region_of_version(template_version.id),
               p_person_id) as cover_object_key,
             (
               select jsonb_agg(
                 jsonb_build_object(
                   'position', step.position,
                   'movement_id', movement.id,
                   'movement', movement.name,
                   'target', coalesce(strength.target, endurance.target, interval_step.target, mobility.target)
                 ) order by step.position)
               from planning.planned_steps as step
               left join catalog.movements as movement on movement.id = step.movement_id
               left join lateral (
                 select jsonb_build_object(
                   'family', 'strength', 'target_sets', target.target_sets,
                   'target_reps', target.target_reps, 'target_rpe', target.target_rpe) as target
                 from planning.strength_targets as target where target.planned_step_id = step.id
               ) as strength on true
               left join lateral (
                 select jsonb_build_object(
                   'family', 'endurance', 'target_distance_value', target.target_distance_value,
                   'target_distance_unit_code', target.target_distance_unit_code,
                   'target_duration_seconds', target.target_duration_seconds) as target
                 from planning.endurance_targets as target where target.planned_step_id = step.id
               ) as endurance on true
               left join lateral (
                 select jsonb_build_object(
                   'family', 'interval', 'rounds', target.rounds,
                   'work_duration_seconds', target.work_duration_seconds,
                   'rest_duration_seconds', target.rest_duration_seconds) as target
                 from planning.interval_targets as target where target.planned_step_id = step.id
               ) as interval_step on true
               left join lateral (
                 select jsonb_build_object(
                   'family', 'mobility', 'hold_duration_seconds', target.hold_duration_seconds,
                   'target_repetitions', target.target_repetitions) as target
                 from planning.mobility_targets as target where target.planned_step_id = step.id
               ) as mobility on true
               where step.template_version_id = template_version.id
             ) as steps
      from planning.program_version_sessions as composed
      join planning.session_template_versions as template_version
        on template_version.id = composed.template_version_id
      where composed.program_version_id = version.id and composed.week = 1
      order by composed.day
    ) as entry
  ) as split on true
  where version.id = p_program_version_id
    and version.status = 'published'
    and (
      program.content_scope = 'global' and program.status = 'published'
      or program.owner_person_id = p_person_id
    )
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

comment on function planning.read_program_version(uuid, uuid) is
  'A published programme version with its whole split, the programme''s cover and each '
  'day''s routine cover, as keys. Composing the addresses is the surface''s job.';

alter function planning.read_program_version(uuid, uuid) owner to allfit_owner;
revoke all on function planning.read_program_version(uuid, uuid) from public;
grant execute on function planning.read_program_version(uuid, uuid) to allfit_api;
