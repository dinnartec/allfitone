-- Cuánto le toca a cada músculo — `FIN-2d`.
--
-- La tarjeta de Hoy dibuja «SERIES POR MÚSCULO» debajo de la figura, y el cliente no
-- puede calcularlo: `read_my_content` le dice cuántas series tiene la rutina en total,
-- no cómo se reparten. Sin esto, la previa de la portada enseñaba las cifras de la
-- última vez incluso con la figura al lado, que es la tarjeta equivocada.
--
-- **Una serie se le cuenta a un solo músculo**, el primario del ejercicio. Repartirla
-- entre todos los que el movimiento toca convierte trece series en treinta y una, y el
-- número deja de ser el trabajo hecho para pasar a ser un recuento de menciones.

begin;

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION planning.read_my_content(p_person_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(item order by sort_key desc), '[]'::jsonb)
  from (
    select
      coalesce(published.published_at, draft.updated_at, template.created_at) as sort_key,
      jsonb_build_object(
        'template_id', template.id,
        'title', coalesce(draft.content->>'title', published.title, 'Sin nombre'),
        'discipline_code', template.discipline_code,
        'status', template.status,
        'template_version_id', published.id,
        -- **La portada la pone el programa, no la rutina.** Si cada rutina eligiera la
        -- suya, el carrusel de Hoy mezclaría figuras, iconos y fotografías en la misma
        -- fila. Una rutina suelta no lleva ninguna y se reconoce por su letra, que es
        -- como se reconocía antes de que esto existiera.
        'cover', dressed.cover,
        -- El estilo es del programa y la imagen es de la rutina: dentro de «foto», cada
        -- una recibe la del catálogo que corresponde a lo que ella trabaja, o seis
        -- tarjetas saldrían clonadas y sólo el rótulo las distinguiría.
        --
        -- **Se responde mire lo que mire el programa.** La hoja de portada enseña la
        -- previa de las tres clases antes de elegir ninguna; contestar sólo cuando ya
        -- está elegida dejaba esa pestaña con un azulejo vacío justo en el momento de
        -- decidir, que es lo que hacía pensar que el selector no hacía nada.
        'cover_object_key', planning.pick_routine_cover(template.id, worked.region),
        'muscles', worked.codes,
        -- Cuánto le toca a cada músculo. La tarjeta de Hoy lo dibuja bajo la figura, y
        -- el cliente no puede calcularlo: sabe cuántas series tiene la rutina en total,
        -- no cómo se reparten.
        'muscle_sets', effort.list,
        'versions', published_ones.list,
        'programs', belongs.list,
        'exercise_count', coalesce(published.exercise_count, 0),
        'set_count', coalesce(published.set_count, 0),
        'has_unpublished_changes',
          draft.id is not null
          and (
            published.content_hash is null
            or extensions.digest(
                 convert_to(planning.canonical_session_content(draft.content)::text, 'UTF8'),
                 'sha256'
               ) is distinct from published.content_hash
          )
      ) as item
    from planning.session_templates as template
    left join planning.session_template_drafts as draft on draft.template_id = template.id
    left join lateral (
      select
        version.id,
        version.published_at,
        version.title,
        version.content_hash,
        (select count(*) from planning.planned_steps as step
          where step.template_version_id = version.id) as exercise_count,
        (select coalesce(sum(target.target_sets), 0)
          from planning.planned_steps as step
          join planning.strength_targets as target on target.planned_step_id = step.id
          where step.template_version_id = version.id) as set_count
      from planning.session_template_versions as version
      where version.template_id = template.id
        and version.status = 'published'
      order by version.version_number desc
      limit 1
    ) as published on true
    left join lateral (
      select coalesce(jsonb_agg(grouped.code order by grouped.trains_it desc, grouped.ord), '[]'::jsonb) as codes,
             -- La región que más pesa, para la fotografía. Del mismo recorrido que los
             -- códigos: recorrerlo dos veces sería contar lo mismo dos veces.
             (array_agg(grouped.region order by grouped.weight desc, grouped.ord))[1] as region
      from (
        select muscle.code,
               min(muscle.region) as region,
               count(*) filter (where link.is_primary) as weight,
               bool_or(link.is_primary) as trains_it,
               min(muscle.display_order) as ord
        from (
          select distinct nullif(step.value->>'movement_id', '')::uuid as movement_id
          from jsonb_array_elements(
                 case when draft.id is not null and jsonb_typeof(draft.content->'steps') = 'array'
                   then draft.content->'steps' else '[]'::jsonb end
               ) as step(value)
          union
          select distinct step.movement_id
          from planning.planned_steps as step
          where draft.id is null and step.template_version_id = published.id
        ) as held
        join catalog.movement_muscles as link on link.movement_id = held.movement_id
        join catalog.muscles as muscle on muscle.id = link.muscle_id
        where held.movement_id is not null and muscle.status = 'published'
        group by muscle.code
      ) as grouped
    ) as worked on true
    -- Las series que carga cada músculo.
    --
    -- **Una serie se le cuenta a un solo músculo**, el primario del ejercicio. Repartir
    -- cada serie entre todos los que el movimiento toca convierte trece series en
    -- treinta y una, y el número deja de ser el trabajo hecho para pasar a ser un
    -- recuento de menciones.
    left join lateral (
      select coalesce(jsonb_agg(
               jsonb_build_object('code', per.code, 'name', per.name, 'sets', per.sets)
               order by per.sets desc, per.name
             ), '[]'::jsonb) as list
      from (
        select loading.code, loading.name, sum(held.sets)::integer as sets
        from (
          select nullif(step.value->>'movement_id', '')::uuid as movement_id,
                 coalesce(
                   (step.value->'target'->>'target_sets')::integer,
                   jsonb_array_length(coalesce(step.value->'target'->'sets', '[]'::jsonb)),
                   0
                 ) as sets
          from jsonb_array_elements(
                 case when draft.id is not null and jsonb_typeof(draft.content->'steps') = 'array'
                   then draft.content->'steps' else '[]'::jsonb end
               ) as step(value)
          union all
          select step.movement_id, coalesce(target.target_sets, 0)
          from planning.planned_steps as step
          left join planning.strength_targets as target on target.planned_step_id = step.id
          where draft.id is null and step.template_version_id = published.id
        ) as held
        -- Uno y sólo uno por ejercicio: el primario, y el de menor orden cuando hay más
        -- de uno. Es la misma regla que el cliente usaba, movida a donde están los datos.
        join lateral (
          select muscle.code, muscle.name
          from catalog.movement_muscles as link
          join catalog.muscles as muscle on muscle.id = link.muscle_id
          where link.movement_id = held.movement_id and muscle.status = 'published'
          order by link.is_primary desc, muscle.display_order
          limit 1
        ) as loading on true
        where held.movement_id is not null and held.sets > 0
        group by loading.code, loading.name
      ) as per
    ) as effort on true
    -- En qué programas de la persona está esta rutina.
    --
    -- Contra **cualquier** versión de la plantilla y no sólo la última: un programa
    -- congela la versión que eligió, así que publicar una rutina otra vez no la saca
    -- del programa que la usa, y mirar sólo la última diría que no está en ninguno.
    -- Todas sus versiones publicadas, de la más nueva a la más vieja.
    --
    -- La semana de un programa guarda la versión exacta que compuso, y republicar la
    -- rutina acuña otra. Una pantalla que sólo mire la última pierde la rutina de una
    -- semana en la que está: eso es lo que hacía desaparecer del editor una rutina
    -- recién editada. Con la lista, el día puede decir qué tiene sin resolver «la
    -- última», que es lo que `ADR-009` prohíbe para cualquier cosa histórica.
    left join lateral (
      select coalesce(jsonb_agg(version.id order by version.version_number desc), '[]'::jsonb) as list
      from planning.session_template_versions as version
      where version.template_id = template.id and version.status = 'published'
    ) as published_ones on true
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('program_id', used.program_id, 'title', used.title)), '[]'::jsonb) as list
      from (
        select distinct program.id as program_id, version.title
        from planning.program_assignments as assignment
        join planning.program_versions as version on version.id = assignment.program_version_id
        join planning.programs as program on program.id = version.program_id
        join planning.program_version_sessions as composition
          on composition.program_version_id = version.id
        join planning.session_template_versions as used_version
          on used_version.id = composition.template_version_id
         and used_version.template_id = template.id
        where assignment.person_id = p_person_id
          and assignment.lifecycle = 'personal'
      ) as used
    ) as belongs on true
    -- De cuál de sus programas se viste. El primero por el orden que la persona ya
    -- eligió, que es el mismo con el que abre la pestaña: una rutina en dos programas
    -- tiene que salir de una manera y no de dos según quién pregunte.
    left join lateral (
      select case when program.routine_cover_kind is null then null else jsonb_strip_nulls(
               jsonb_build_object('kind', program.routine_cover_kind,
                                  'icon', program.routine_cover_icon)
             ) end as cover
      from planning.program_assignments as assignment
      join planning.program_versions as version on version.id = assignment.program_version_id
      join planning.programs as program on program.id = version.program_id
      join planning.program_version_sessions as composition
        on composition.program_version_id = version.id
      join planning.session_template_versions as used_version
        on used_version.id = composition.template_version_id
       and used_version.template_id = template.id
      where assignment.person_id = p_person_id
        and assignment.lifecycle = 'personal'
        and program.routine_cover_kind is not null
      order by assignment.display_order, assignment.assigned_at desc
      limit 1
    ) as dressed on true
    where template.owner_person_id = p_person_id
      and template.status <> 'archived'
  ) as mine
$function$;

commit;
