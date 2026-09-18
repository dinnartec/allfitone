-- La portada de una rutina — `HU-SP-108`, `IX-48`.
--
-- Una rutina se reconocía sólo por su nombre. Ahora puede decir cómo quiere verse: con
-- la figura de los músculos que entrena, o con uno de doce iconos. Las dos son
-- opcionales y quitarla devuelve a la letra del nombre, que nunca dejó de servir.
--
-- **Es contenido, no decoración.** Vive dentro del JSON del borrador, entra al hash de
-- publicación y viaja a la versión inmutable, porque dos rutinas que sólo difieren en
-- la portada se ven distintas en la lista y la lista es lo único que la portada hace.
-- Dejarla fuera del hash publicaría la segunda como si fuera la primera.
--
-- **La figura de músculos no guarda nada.** Se dibuja con los movimientos que la rutina
-- ya referencia; copiarlos aquí sería una segunda verdad que envejece al editar.
--
-- **Los iconos son un vocabulario cerrado y no el catálogo de equipamiento.** Un icono
-- dice de qué va la rutina —fuerza, correr, intervalos— y no con qué se hace: nadie
-- filtra por él ni lo explora, lo declara. Por eso vive en `planning` y no en `catalog`,
-- igual que `set_kind`.
--
-- Las tres funciones del JSON se mueven juntas —validación, canónica y publicación— o
-- el hash y la materialización describen cosas distintas. Los cuatro publicadores de
-- `session_template_versions` llevan la portada, incluida `fork_program_version`, que
-- copia versiones: una bifurcación que la perdiera sería una pérdida silenciosa.

begin;

-- Sin `local`, que es lo que la política sabe reconocer: una migración que espera un
-- lock indefinidamente bloquea la tabla para todo el mundo mientras tanto.
set lock_timeout = '5s';
set statement_timeout = '60s';

-- `photo` se declara aquí aunque su almacén llegue en la migración siguiente: el
-- vocabulario es uno y un enumerado no admite añadir un valor y usarlo en la misma
-- transacción, así que separarlo sólo movería el problema.
create type planning.routine_cover as enum ('muscles', 'icon', 'photo');

-- Doce, y el orden es el de la rejilla que los dibuja. El identificador nunca se
-- reordena ni se reutiliza, como en todo vocabulario cerrado de la plataforma.
create type planning.routine_cover_icon as enum (
  'strength', 'run', 'cycling', 'interval',
  'cardio', 'burn', 'power', 'challenge',
  'mountain', 'time', 'mobility', 'swim'
);

alter table planning.session_template_versions
  add column cover_kind planning.routine_cover,
  add column cover_icon planning.routine_cover_icon;

alter table planning.session_template_versions
  -- `is not distinct from` y no `=`: con `cover_kind` nulo la igualdad da nulo, el check
  -- pasa por desconocido, y una versión sin portada podría llevar un icono colgando.
  add constraint ck_session_template_versions_cover check ((cover_icon is not null) = (cover_kind is not distinct from 'icon'));


create or replace function planning.session_content_errors(p_content jsonb, p_organization_id uuid, p_discipline_code text, p_require_complete boolean)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  errors text[] := array[]::text[];
  cover jsonb;
  step jsonb;
  target jsonb;
  effective_activity_type_id uuid;
  declared_family catalog.activity_family;
  expected_family catalog.activity_family;
begin
  if jsonb_typeof(p_content) <> 'object'
     or not p_content ?& array['title', 'activity_type_id', 'steps']
     or p_content - array['title', 'activity_type_id', 'cover', 'steps'] <> '{}'::jsonb then
    return array['invalid-content-shape'];
  end if;
  if jsonb_typeof(p_content->'title') <> 'string'
     or btrim(p_content->>'title') = ''
     or char_length(p_content->>'title') > 160 then
    errors := array_append(errors, 'title');
  end if;
  -- La portada es opcional y ausente es lo mismo que nula: una rutina sin portada no
  -- es una rutina incompleta. Lo que se rechaza es una portada que nunca podría serlo.
  if p_content ? 'cover' and jsonb_typeof(p_content->'cover') not in ('object', 'null') then
    errors := array_append(errors, 'cover');
  elsif jsonb_typeof(p_content->'cover') = 'object' then
    cover := p_content->'cover';
    if not cover ? 'kind'
       or cover - array['kind', 'icon'] <> '{}'::jsonb
       or jsonb_typeof(cover->'kind') <> 'string'
       or cover->>'kind' not in ('muscles', 'icon') then
      errors := array_append(errors, 'cover');
    elsif cover->>'kind' = 'muscles' then
      -- La figura sale de los ejercicios. Llevar además un icono sería una segunda
      -- respuesta a una pregunta que tiene una.
      if cover ? 'icon' and jsonb_typeof(cover->'icon') <> 'null' then
        errors := array_append(errors, 'cover');
      end if;
    elsif jsonb_typeof(cover->'icon') <> 'string'
       or not exists (
            select 1 from pg_enum as value
            join pg_type as kind on kind.oid = value.enumtypid
            join pg_namespace as space on space.oid = kind.typnamespace
            where space.nspname = 'planning'
              and kind.typname = 'routine_cover_icon'
              and value.enumlabel = cover->>'icon'
          ) then
      errors := array_append(errors, 'cover');
    end if;
  end if;

  if jsonb_typeof(p_content->'steps') <> 'array' then
    return array_append(errors, 'steps');
  end if;
  if jsonb_array_length(p_content->'steps') > 200 then
    return array_append(errors, 'steps');
  end if;
  if p_require_complete and jsonb_array_length(p_content->'steps') = 0 then
    errors := array_append(errors, 'steps');
  end if;
  if jsonb_typeof(p_content->'activity_type_id') not in ('string', 'null') then
    errors := array_append(errors, 'activity-type');
  elsif jsonb_typeof(p_content->'activity_type_id') = 'string'
        and p_content->>'activity_type_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    errors := array_append(errors, 'activity-type');
  elsif jsonb_typeof(p_content->'activity_type_id') = 'string'
        and not exists (
          select 1 from catalog.activity_types as activity
          where activity.id = (p_content->>'activity_type_id')::uuid
            and activity.discipline_code = p_discipline_code
            and activity.status = 'published'
            and (activity.content_scope = 'global' or activity.owner_organization_id = p_organization_id)
        ) then
    errors := array_append(errors, 'activity-type');
  elsif p_require_complete and jsonb_typeof(p_content->'activity_type_id') = 'null' then
    errors := array_append(errors, 'activity-type');
  end if;

  for step in select value from jsonb_array_elements(p_content->'steps') loop
    if jsonb_typeof(step) <> 'object'
       or not step ?& array['position', 'target']
       or step - array['position', 'movement_id', 'activity_type_id', 'notes', 'superset_group', 'target'] <> '{}'::jsonb
       or jsonb_typeof(step->'position') <> 'number'
       or step->>'position' !~ '^[1-9][0-9]*$'
       or (step->>'position')::numeric > 200
       or jsonb_typeof(step->'target') <> 'object' then
      errors := array_append(errors, 'step-shape');
      continue;
    end if;
    target := step->'target';
    if not target ? 'family'
       or jsonb_typeof(target->'family') <> 'string'
       or target->>'family' not in ('strength', 'endurance', 'interval', 'mobility') then
      errors := array_append(errors, 'target-family');
      continue;
    end if;
    declared_family := (target->>'family')::catalog.activity_family;

    if step ? 'activity_type_id'
       and jsonb_typeof(step->'activity_type_id') not in ('string', 'null') then
      errors := array_append(errors, 'activity-type');
      effective_activity_type_id := null;
    elsif jsonb_typeof(step->'activity_type_id') = 'string' then
      if step->>'activity_type_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        errors := array_append(errors, 'activity-type');
        effective_activity_type_id := null;
      elsif not exists (
        select 1 from catalog.activity_types as activity
        where activity.id = (step->>'activity_type_id')::uuid
          and activity.discipline_code = p_discipline_code
          and activity.status = 'published'
          and (activity.content_scope = 'global' or activity.owner_organization_id = p_organization_id)
      ) then
        errors := array_append(errors, 'activity-type');
        effective_activity_type_id := null;
      else
        effective_activity_type_id := (step->>'activity_type_id')::uuid;
      end if;
    elsif jsonb_typeof(p_content->'activity_type_id') = 'string' then
      effective_activity_type_id := (p_content->>'activity_type_id')::uuid;
    else
      effective_activity_type_id := null;
    end if;
    expected_family := catalog.activity_type_target_family(effective_activity_type_id);
    if expected_family is null or expected_family <> declared_family then
      errors := array_append(errors, 'target-family');
    end if;

    if step ? 'movement_id' and jsonb_typeof(step->'movement_id') not in ('string', 'null') then
      errors := array_append(errors, 'movement');
    elsif jsonb_typeof(step->'movement_id') = 'string' then
      if step->>'movement_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        errors := array_append(errors, 'movement');
      elsif not exists (
            select 1 from catalog.movements as movement
            where movement.id = (step->>'movement_id')::uuid
              and movement.discipline_code = p_discipline_code
              and movement.status in ('published', 'deprecated')
              and (movement.content_scope = 'global' or movement.owner_organization_id = p_organization_id)
          ) then
        errors := array_append(errors, 'movement');
      end if;
    end if;

    if step ? 'notes'
       and jsonb_typeof(step->'notes') not in ('string', 'null') then
      errors := array_append(errors, 'step-notes');
    elsif jsonb_typeof(step->'notes') = 'string'
          and char_length(step->>'notes') > 2000 then
      errors := array_append(errors, 'step-notes');
    end if;

    -- A chain is a run of neighbours. The contiguity itself is `IX-46`'s job at
    -- publication, because a draft is legitimately half-written; what is refused here
    -- is a value that could never be a group.
    if step ? 'superset_group'
       and jsonb_typeof(step->'superset_group') not in ('number', 'null') then
      errors := array_append(errors, 'superset-group');
    elsif jsonb_typeof(step->'superset_group') = 'number'
          and (step->>'superset_group' !~ '^[1-9][0-9]*$'
               or (step->>'superset_group')::numeric > 200) then
      errors := array_append(errors, 'superset-group');
    end if;

    if declared_family = 'strength' and jsonb_typeof(target->'sets') = 'array' then
      -- The shape this editor writes: the sets are the prescription, and the aggregate
      -- is the summary derived from them. Sending a summary that disagrees is refused
      -- rather than silently recomputed, so nobody has to guess which one was meant.
      if target - array['family', 'sets', 'target_sets', 'target_reps', 'target_load_value', 'target_load_unit_code', 'target_rpe', 'target_rest_seconds'] <> '{}'::jsonb
         or jsonb_array_length(target->'sets') = 0
         or jsonb_array_length(target->'sets') > 200
         or (target ? 'target_sets'
             and (jsonb_typeof(target->'target_sets') <> 'number'
                  or (target->>'target_sets')::numeric <> jsonb_array_length(target->'sets')))
         or (target ? 'target_load_value' and jsonb_typeof(target->'target_load_value') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_load_value') = 'number' and (target->>'target_load_value')::numeric < 0)
         or (target ? 'target_load_unit_code' and jsonb_typeof(target->'target_load_unit_code') not in ('string', 'null'))
         or ((coalesce(jsonb_typeof(target->'target_load_value'), 'null') = 'null') <>
             (coalesce(jsonb_typeof(target->'target_load_unit_code'), 'null') = 'null'))
         or (jsonb_typeof(target->'target_load_unit_code') = 'string' and not exists (
           select 1 from catalog.units where code = target->>'target_load_unit_code'
         ))
         or (target ? 'target_rpe' and jsonb_typeof(target->'target_rpe') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_rpe') = 'number' and (target->>'target_rpe')::numeric not between 0 and 10)
         or (target ? 'target_rest_seconds' and jsonb_typeof(target->'target_rest_seconds') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_rest_seconds') = 'number' and target->>'target_rest_seconds' !~ '^[0-9]+$')
         or (jsonb_typeof(target->'target_rest_seconds') = 'number' and (target->>'target_rest_seconds')::numeric > 3600) then
        errors := array_append(errors, 'strength-target');
      else
        errors := errors || planning.planned_set_errors(target->'sets');
      end if;
    elsif declared_family = 'strength'
       and (target - array['family', 'target_sets', 'target_reps', 'target_load_value', 'target_load_unit_code', 'target_rpe', 'target_rest_seconds'] <> '{}'::jsonb
         or not target ?& array['family', 'target_sets']
         or jsonb_typeof(target->'target_sets') <> 'number'
         or target->>'target_sets' !~ '^[1-9][0-9]*$'
         or (target->>'target_sets')::numeric > 2147483647
         or (target ? 'target_reps' and jsonb_typeof(target->'target_reps') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_reps') = 'number' and target->>'target_reps' !~ '^[1-9][0-9]*$')
         or (jsonb_typeof(target->'target_reps') = 'number' and (target->>'target_reps')::numeric > 2147483647)
         or (target ? 'target_load_value' and jsonb_typeof(target->'target_load_value') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_load_value') = 'number' and (target->>'target_load_value')::numeric < 0)
         or (target ? 'target_load_unit_code' and jsonb_typeof(target->'target_load_unit_code') not in ('string', 'null'))
         or ((coalesce(jsonb_typeof(target->'target_load_value'), 'null') = 'null') <>
             (coalesce(jsonb_typeof(target->'target_load_unit_code'), 'null') = 'null'))
         or (jsonb_typeof(target->'target_load_unit_code') = 'string' and not exists (
           select 1 from catalog.units where code = target->>'target_load_unit_code'
         ))
         or (target ? 'target_rpe' and jsonb_typeof(target->'target_rpe') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_rpe') = 'number' and (target->>'target_rpe')::numeric not between 0 and 10)
         or (target ? 'target_rest_seconds' and jsonb_typeof(target->'target_rest_seconds') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_rest_seconds') = 'number' and target->>'target_rest_seconds' !~ '^[0-9]+$')
         or (jsonb_typeof(target->'target_rest_seconds') = 'number' and (target->>'target_rest_seconds')::numeric > 3600)) then
      errors := array_append(errors, 'strength-target');
    elsif declared_family = 'endurance'
       and (target - array['family', 'target_distance_value', 'target_distance_unit_code', 'target_duration_seconds', 'target_pace_seconds_per_unit', 'target_pace_unit_code'] <> '{}'::jsonb
         or (target ? 'target_distance_value' and jsonb_typeof(target->'target_distance_value') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_distance_value') = 'number' and (target->>'target_distance_value')::numeric <= 0)
         or (target ? 'target_distance_unit_code' and jsonb_typeof(target->'target_distance_unit_code') not in ('string', 'null'))
         or ((coalesce(jsonb_typeof(target->'target_distance_value'), 'null') = 'null') <>
             (coalesce(jsonb_typeof(target->'target_distance_unit_code'), 'null') = 'null'))
         or (jsonb_typeof(target->'target_distance_unit_code') = 'string' and not exists (
           select 1 from catalog.units where code = target->>'target_distance_unit_code'
         ))
         or (target ? 'target_duration_seconds' and jsonb_typeof(target->'target_duration_seconds') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_duration_seconds') = 'number' and (target->>'target_duration_seconds')::numeric <= 0)
         or (target ? 'target_pace_seconds_per_unit' and jsonb_typeof(target->'target_pace_seconds_per_unit') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_pace_seconds_per_unit') = 'number' and (target->>'target_pace_seconds_per_unit')::numeric <= 0)
         or (target ? 'target_pace_unit_code' and jsonb_typeof(target->'target_pace_unit_code') not in ('string', 'null'))
         or ((coalesce(jsonb_typeof(target->'target_pace_seconds_per_unit'), 'null') = 'null') <>
             (coalesce(jsonb_typeof(target->'target_pace_unit_code'), 'null') = 'null'))
         or (jsonb_typeof(target->'target_pace_unit_code') = 'string' and not exists (
           select 1 from catalog.units where code = target->>'target_pace_unit_code'
         ))
         or (coalesce(jsonb_typeof(target->'target_distance_value'), 'null') = 'null'
             and coalesce(jsonb_typeof(target->'target_duration_seconds'), 'null') = 'null')) then
      errors := array_append(errors, 'endurance-target');
    elsif declared_family = 'interval'
       and (target - array['family', 'rounds', 'work_duration_seconds', 'rest_duration_seconds', 'target_rpe'] <> '{}'::jsonb
         or not target ?& array['family', 'rounds', 'work_duration_seconds']
         or jsonb_typeof(target->'rounds') <> 'number'
         or target->>'rounds' !~ '^[1-9][0-9]*$'
         or (target->>'rounds')::numeric > 2147483647
         or jsonb_typeof(target->'work_duration_seconds') <> 'number'
         or (target->>'work_duration_seconds')::numeric <= 0
         or (target ? 'rest_duration_seconds' and jsonb_typeof(target->'rest_duration_seconds') not in ('number', 'null'))
         or (jsonb_typeof(target->'rest_duration_seconds') = 'number' and (target->>'rest_duration_seconds')::numeric < 0)
         or (target ? 'target_rpe' and jsonb_typeof(target->'target_rpe') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_rpe') = 'number' and (target->>'target_rpe')::numeric not between 0 and 10)) then
      errors := array_append(errors, 'interval-target');
    elsif declared_family = 'mobility'
       and (target - array['family', 'sequence_position', 'hold_duration_seconds', 'target_repetitions', 'side'] <> '{}'::jsonb
         or not target ?& array['family', 'sequence_position', 'side']
         or jsonb_typeof(target->'sequence_position') <> 'number'
         or target->>'sequence_position' !~ '^[1-9][0-9]*$'
         or (target->>'sequence_position')::numeric > 2147483647
         or jsonb_typeof(target->'side') <> 'string'
         or target->>'side' not in ('left', 'right', 'bilateral', 'not_applicable')
         or (target ? 'hold_duration_seconds' and jsonb_typeof(target->'hold_duration_seconds') not in ('number', 'null'))
         or (jsonb_typeof(target->'hold_duration_seconds') = 'number' and (target->>'hold_duration_seconds')::numeric <= 0)
         or (target ? 'target_repetitions' and jsonb_typeof(target->'target_repetitions') not in ('number', 'null'))
         or (jsonb_typeof(target->'target_repetitions') = 'number' and target->>'target_repetitions' !~ '^[1-9][0-9]*$')
         or (jsonb_typeof(target->'target_repetitions') = 'number' and (target->>'target_repetitions')::numeric > 2147483647)
         or (coalesce(jsonb_typeof(target->'hold_duration_seconds'), 'null') = 'null'
             and coalesce(jsonb_typeof(target->'target_repetitions'), 'null') = 'null')) then
      errors := array_append(errors, 'mobility-target');
    end if;
  end loop;

  if exists (
    select item.value->>'position'
    from jsonb_array_elements(p_content->'steps') as item(value)
    group by item.value->>'position'
    having count(*) > 1
  ) then
    errors := array_append(errors, 'duplicate-step-position');
  end if;
  return errors;
exception when others then
  return array_append(errors, 'invalid-content-value');
end
$function$;

create or replace function planning.canonical_session_content(p_content jsonb)
returns jsonb
language sql
immutable
strict
security invoker
set search_path = pg_catalog
as $function$
  -- Concatenada y no construida dentro, para que una rutina sin portada siga
  -- resumiéndose igual que antes de existir esta clave. Un `cover: null` en cada objeto
  -- habría cambiado el hash de todas las rutinas publicadas y la siguiente publicación
  -- habría sido una versión nueva de algo que nadie tocó.
  select jsonb_build_object(
    'title', btrim(p_content->>'title'),
    'activity_type_id', (p_content->>'activity_type_id')::uuid,
    'steps', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'position', (step.value->>'position')::integer,
        'movement_id', nullif(step.value->>'movement_id', '')::uuid,
        'activity_type_id', nullif(step.value->>'activity_type_id', '')::uuid,
        'notes', nullif(step.value->>'notes', ''),
        'superset_group', nullif(step.value->>'superset_group', '')::smallint,
        'target', planning.canonical_target(step.value->'target')
      )) order by (step.value->>'position')::integer)
      from jsonb_array_elements(p_content->'steps') as step(value)
    ), '[]'::jsonb)
  )
  || case
       when jsonb_typeof(p_content->'cover') <> 'object' then '{}'::jsonb
       else jsonb_build_object('cover', jsonb_strip_nulls(jsonb_build_object(
              'kind', p_content->'cover'->>'kind',
              'icon', nullif(p_content->'cover'->>'icon', '')
            )))
     end
$function$;

create or replace function planning.session_version_projection(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', version.id,
    'template_id', version.template_id,
    'version_number', version.version_number,
    'discipline_code', version.discipline_code,
    'activity_type_id', version.activity_type_id,
    'derived_from_version_id', version.derived_from_version_id,
    'title', version.title,
    'cover', case when version.cover_kind is null then null else jsonb_strip_nulls(
      jsonb_build_object('kind', version.cover_kind, 'icon', version.cover_icon)
    ) end,
    'status', version.status,
    'published_at', version.published_at,
    'steps', coalesce((
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'position', step.position,
          'movement_id', step.movement_id,
          'activity_type_id', step.activity_type_id,
          'notes', step.notes,
          'superset_group', step.superset_group,
          'target', case
            when strength.id is not null then
              jsonb_strip_nulls(to_jsonb(strength) - array['id', 'planned_step_id'])
              || jsonb_build_object('family', 'strength')
              || jsonb_build_object('sets', coalesce((
                   select jsonb_agg(jsonb_strip_nulls(to_jsonb(planned) - array['id', 'planned_step_id', 'created_at'])
                                    order by planned.set_order)
                   from planning.planned_sets as planned
                   where planned.planned_step_id = step.id
                 ), '[]'::jsonb))
            when endurance.id is not null then jsonb_strip_nulls(to_jsonb(endurance) - array['id', 'planned_step_id']) || jsonb_build_object('family', 'endurance')
            when interval_target.id is not null then jsonb_strip_nulls(to_jsonb(interval_target) - array['id', 'planned_step_id']) || jsonb_build_object('family', 'interval')
            when mobility.id is not null then jsonb_strip_nulls(to_jsonb(mobility) - array['id', 'planned_step_id']) || jsonb_build_object('family', 'mobility')
          end
        )) order by step.position
      )
      from planning.planned_steps as step
      left join planning.strength_targets as strength on strength.planned_step_id = step.id
      left join planning.endurance_targets as endurance on endurance.planned_step_id = step.id
      left join planning.interval_targets as interval_target on interval_target.planned_step_id = step.id
      left join planning.mobility_targets as mobility on mobility.planned_step_id = step.id
      where step.template_version_id = version.id
    ), '[]'::jsonb)
  )
  from planning.session_template_versions as version
  where version.id = p_version_id
$function$;

create or replace function planning.publish_session_template_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_expected_etag text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  draft planning.session_template_drafts%rowtype;
  template planning.session_templates%rowtype;
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  step jsonb;
  step_id uuid;
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-003', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_version_projection(receipt.aggregate_id), true;
    return;
  end if;
  select parent.* into template
  from planning.session_templates as parent
  where parent.id = p_template_id and parent.owner_organization_id = p_organization_id
  for update of parent;
  select current_draft.* into draft
  from planning.session_template_drafts as current_draft
  where current_draft.template_id = p_template_id
  for update of current_draft;
  if template.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001', detail = planning.session_draft_projection(draft.id)::text;
  end if;
  errors := planning.session_content_errors(draft.content, p_organization_id, template.discipline_code, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete session template draft' using errcode = '22023', detail = to_json(errors)::text;
  end if;

  canonical_content := planning.canonical_session_content(draft.content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
  select version.id into version_id from planning.session_template_versions as version
  where version.template_id = p_template_id and version.content_hash = version_content_hash;
  if version_id is null then
    select coalesce(max(version.version_number), 0) + 1 into next_version
    from planning.session_template_versions as version where version.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, cover_kind, cover_icon, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title',
      (canonical_content->'cover'->>'kind')::planning.routine_cover,
      (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
      version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for step in select value from jsonb_array_elements(canonical_content->'steps') order by (value->>'position')::integer loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        version_id, (step->>'position')::integer,
        nullif(step->>'movement_id', '')::uuid,
        nullif(step->>'activity_type_id', '')::uuid,
        nullif(step->>'notes', ''),
        nullif(step->>'superset_group', '')::smallint
      ) returning id into step_id;
      perform planning.materialize_target(step_id, step->'target');
    end loop;
    update planning.session_templates set status = 'published', updated_at = clock_timestamp() where id = p_template_id;
    perform system.enqueue_outbox_event(
      'session_template_version', version_id, 'planning.session_template_version_published.v1',
      jsonb_build_object('template_id', p_template_id, 'version_id', version_id, 'version_number', next_version)
    );
  end if;
  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'session-template-version-published', 'session_template_version', version_id);
  return query select planning.session_version_projection(version_id), false;
end
$function$;

create or replace function planning.publish_global_session_template(
  p_template_id uuid,
  p_discipline_code text,
  p_content jsonb
)
returns uuid
language plpgsql
set search_path = pg_catalog
as $function$
declare
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  step jsonb;
  step_id uuid;
begin
  -- A null organization is what makes the validator accept global movements and
  -- activity types and reject anything privately owned, which is exactly right here.
  errors := planning.session_content_errors(p_content, null, p_discipline_code, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete global session template' using errcode = '22023', detail = to_json(errors)::text;
  end if;

  insert into planning.session_templates (id, content_scope, discipline_code, status)
  values (p_template_id, 'global', p_discipline_code, 'published')
  on conflict (id) do nothing;

  canonical_content := planning.canonical_session_content(p_content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');

  -- Publishing the same content twice is not a new version. It is the property that
  -- lets the curation script be run again without forking the catalogue.
  select version.id into version_id
  from planning.session_template_versions as version
  where version.template_id = p_template_id and version.content_hash = version_content_hash;
  if version_id is not null then
    return version_id;
  end if;

  insert into planning.session_template_versions (
    template_id, version_number, discipline_code, activity_type_id, title,
    cover_kind, cover_icon, content_hash
  )
  select p_template_id,
         coalesce(max(existing.version_number), 0) + 1,
         p_discipline_code,
         (canonical_content->>'activity_type_id')::uuid,
         canonical_content->>'title',
         (canonical_content->'cover'->>'kind')::planning.routine_cover,
         (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
         version_content_hash
  from planning.session_template_versions as existing
  where existing.template_id = p_template_id
  returning id into version_id;

  perform set_config('app.planning_publication', 'true', true);
  for step in
    select value from jsonb_array_elements(canonical_content->'steps')
    order by (value->>'position')::integer
  loop
    insert into planning.planned_steps (
      template_version_id, position, movement_id, activity_type_id, notes, superset_group
    ) values (
      version_id, (step->>'position')::integer,
      nullif(step->>'movement_id', '')::uuid,
      nullif(step->>'activity_type_id', '')::uuid,
      nullif(step->>'notes', ''),
      nullif(step->>'superset_group', '')::smallint
    ) returning id into step_id;
    perform planning.materialize_target(step_id, step->'target');
  end loop;

  return version_id;
end
$function$;

create or replace function planning.fork_program_version(p_person_id uuid, p_program_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  source record;
  new_program_id uuid;
  new_version_id uuid;
  mapping jsonb := '{}'::jsonb;
  template record;
  new_template_id uuid;
  new_template_version_id uuid;
  step record;
  new_step_id uuid;
begin
  select version.id, version.title, version.notes, version.content_hash, version.sex_affinity
  into source
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id
    and version.status = 'published'
    and program.content_scope = 'global'
    and program.status = 'published';
  if source.id is null then
    raise exception 'program version is not forkable' using errcode = '42501';
  end if;

  perform set_config('app.planning_publication', 'true', true);

  -- One copy per distinct template the program composes, remembered so the new
  -- composition points at the person's own versions and never at Allfit's.
  for template in
    select distinct source_version.id as version_id,
           source_version.template_id,
           source_version.discipline_code,
           source_version.activity_type_id,
           source_version.title,
           source_version.cover_kind,
           source_version.cover_icon,
           source_version.content_hash,
           source_template.discipline_code as template_discipline
    from planning.program_version_sessions as composition
    join planning.session_template_versions as source_version
      on source_version.id = composition.template_version_id
    join planning.session_templates as source_template
      on source_template.id = source_version.template_id
    where composition.program_version_id = p_program_version_id
  loop
    insert into planning.session_templates (
      content_scope, owner_person_id, author_person_id, discipline_code, status
    ) values ('person', p_person_id, p_person_id, template.template_discipline, 'published')
    returning id into new_template_id;

    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id, title,
      cover_kind, cover_icon, content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title, template.cover_kind, template.cover_icon,
      template.content_hash, 'published', clock_timestamp()
    ) returning id into new_template_version_id;

    for step in
      select id, position, movement_id, activity_type_id, notes, superset_group
      from planning.planned_steps
      where template_version_id = template.version_id
      order by position
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        new_template_version_id, step.position, step.movement_id, step.activity_type_id,
        step.notes, step.superset_group
      ) returning id into new_step_id;

      -- The sets come first: `IX-47` compares the summary against them, and the
      -- constraint is deferred so the order inside the transaction does not matter,
      -- but a fork that copied only the summary would flatten the routine.
      insert into planning.planned_sets (
        planned_step_id, set_order, kind, target_reps,
        target_load_value, target_load_unit_code, target_rpe
      )
      select new_step_id, set_order, kind, target_reps,
             target_load_value, target_load_unit_code, target_rpe
      from planning.planned_sets where planned_step_id = step.id;

      insert into planning.strength_targets (
        planned_step_id, target_sets, target_reps, target_load_value,
        target_load_unit_code, target_rpe, target_rest_seconds
      )
      select new_step_id, target_sets, target_reps, target_load_value,
             target_load_unit_code, target_rpe, target_rest_seconds
      from planning.strength_targets where planned_step_id = step.id;

      insert into planning.endurance_targets (
        planned_step_id, target_distance_value, target_distance_unit_code,
        target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      )
      select new_step_id, target_distance_value, target_distance_unit_code,
             target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      from planning.endurance_targets where planned_step_id = step.id;

      insert into planning.interval_targets (
        planned_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      )
      select new_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      from planning.interval_targets where planned_step_id = step.id;

      insert into planning.mobility_targets (
        planned_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      )
      select new_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      from planning.mobility_targets where planned_step_id = step.id;
    end loop;

    mapping := mapping || jsonb_build_object(template.version_id::text, new_template_version_id);
  end loop;

  insert into planning.programs (content_scope, owner_person_id, author_person_id, status)
  values ('person', p_person_id, p_person_id, 'published')
  returning id into new_program_id;

  insert into planning.program_versions (
    program_id, version_number, title, notes, content_hash, status, published_at, sex_affinity
  ) values (
    new_program_id, 1, source.title, source.notes, source.content_hash,
    'published', clock_timestamp(), source.sex_affinity
  ) returning id into new_version_id;

  insert into planning.program_version_sessions (
    program_version_id, template_version_id, position, week, day
  )
  select new_version_id,
         (mapping->>composition.template_version_id::text)::uuid,
         composition.position, composition.week, composition.day
  from planning.program_version_sessions as composition
  where composition.program_version_id = p_program_version_id;

  -- The segmentation travels with the copy: it is what the catalogue matched on,
  -- and a copy that forgot it would stop being findable as the thing it is.
  insert into planning.program_version_goals (program_version_id, goal_code)
  select new_version_id, goal_code from planning.program_version_goals
  where program_version_id = p_program_version_id;
  insert into planning.program_version_levels (program_version_id, experience_code)
  select new_version_id, experience_code from planning.program_version_levels
  where program_version_id = p_program_version_id;
  insert into planning.program_version_emphases (program_version_id, focus_area_code)
  select new_version_id, focus_area_code from planning.program_version_emphases
  where program_version_id = p_program_version_id;

  return new_version_id;
end
$function$;

create or replace function planning.publish_my_session_template(
  p_person_id uuid,
  p_template_id uuid,
  p_expected_etag text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (version jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  draft planning.session_template_drafts%rowtype;
  template planning.session_templates%rowtype;
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  step jsonb;
  step_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-003', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_version_projection(receipt.aggregate_id), true;
    return;
  end if;

  select parent.* into template
  from planning.session_templates as parent
  where parent.id = p_template_id and parent.owner_person_id = p_person_id
  for update of parent;
  if template.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;
  select current_draft.* into draft
  from planning.session_template_drafts as current_draft
  where current_draft.template_id = p_template_id
  for update of current_draft;

  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001',
      detail = planning.session_draft_projection(draft.id)::text;
  end if;
  -- `require_complete`, so an empty routine is refused here and still saveable as a
  -- draft. `V-G` is the screen that says exactly what is missing.
  errors := planning.session_content_errors(draft.content, null, template.discipline_code, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete session template draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  canonical_content := planning.canonical_session_content(draft.content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
  select existing.id into version_id from planning.session_template_versions as existing
  where existing.template_id = p_template_id and existing.content_hash = version_content_hash;
  if version_id is null then
    select coalesce(max(existing.version_number), 0) + 1 into next_version
    from planning.session_template_versions as existing where existing.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, cover_kind, cover_icon, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title',
      (canonical_content->'cover'->>'kind')::planning.routine_cover,
      (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
      version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for step in
      select value from jsonb_array_elements(canonical_content->'steps')
      order by (value->>'position')::integer
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        version_id, (step->>'position')::integer,
        nullif(step->>'movement_id', '')::uuid,
        nullif(step->>'activity_type_id', '')::uuid,
        nullif(step->>'notes', ''),
        nullif(step->>'superset_group', '')::smallint
      ) returning id into step_id;
      perform planning.materialize_target(step_id, step->'target');
    end loop;
    update planning.session_templates
    set status = 'published', updated_at = clock_timestamp() where id = p_template_id;
    perform system.enqueue_outbox_event(
      'session_template_version', version_id, 'planning.session_template_version_published.v1',
      jsonb_build_object('template_id', p_template_id, 'version_id', version_id,
                         'version_number', next_version)
    );
  end if;
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'session-template-version-published',
    'session_template_version', version_id
  );
  return query select planning.session_version_projection(version_id), false;
end
$function$;

-- What the list needs to draw a routine: its name, its numbers, and now how it wants to
-- be seen.
--
-- **The cover does not fall back the way the title does.** A draft with no cover means
-- somebody removed it, and coalescing to the published one would make removing it
-- impossible — the list would keep showing what they just took off.
--
-- **The muscles come from the routine as it stands now**, which is the draft when there
-- is one and the published version when there is not, for the same reason. They are
-- codes and not slugs: the app already owns that translation and owns it in one place.
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
          jsonb_build_object('kind', version.cover_kind, 'icon', version.cover_icon)
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
    where template.owner_person_id = p_person_id
      and template.status <> 'archived'
  ) as mine
$function$;

commit;
