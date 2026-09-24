-- Una rutina dice todas sus versiones — `OP-PLN-025`.
--
-- El editor de programa resolvía cada día buscando la rutina cuya **última** versión
-- publicada coincidiera con la que la semana guarda. Republicar la rutina acuña otra, así
-- que desde ese momento el día no encontraba nada: la rutina desaparecía de la semana y
-- del panel de un programa en el que está puesta, y la asignación de los días se veía
-- vacía.
--
-- El parche anterior corregía la semana en memoria al volver del editor de la rutina, que
-- sólo cubre ese camino. Esto es la raíz: el día se resuelve **por plantilla**, mirando si
-- la versión que guarda es alguna de las suyas. Nada se reescribe — la semana sigue
-- componiendo la versión exacta que eligió, como `ADR-009` manda — y además se puede
-- saber cuándo está mirando una vieja.

set statement_timeout = '60s';

begin;

set lock_timeout = '5s';

create or replace function planning.read_my_content(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
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
        'cover', case
          when draft.id is not null then
            case when jsonb_typeof(draft.content->'cover') = 'object'
              then draft.content->'cover'
            end
          else published.cover
        end,
        'muscles', worked.codes,
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
        case when version.cover_kind is null then null else jsonb_strip_nulls(
          jsonb_build_object('kind', version.cover_kind, 'icon', version.cover_icon,
                             'photo_id', version.cover_photo_id)
        ) end as cover,
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
      select coalesce(jsonb_agg(grouped.code order by grouped.trains_it desc, grouped.ord), '[]'::jsonb) as codes
      from (
        select muscle.code,
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
    where template.owner_person_id = p_person_id
      and template.status <> 'archived'
  ) as mine
$function$;

commit;
