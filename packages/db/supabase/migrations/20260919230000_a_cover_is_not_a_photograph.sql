-- La portada deja de ser una fotografía tuya — segunda revisión de `ADR-031`.
--
-- La fotografía de portada se construyó entera —selector, saneado, subida, proxy
-- autenticado, bucket privado y cola de borrado— y la lectura del producto es que nadie
-- la va a usar. Una portada sirve para reconocer una rutina entre seis; para eso la
-- figura de los músculos y el icono ya responden, y hacen algo que una fotografía propia
-- no hace: **se dibujan solas**.
--
-- **La clase `foto` sobrevive, pero ya no es tuya.** La persona pide «foto» y no *cuál*:
-- la región dominante de los músculos que la rutina trabaja elige una de las portadas del
-- catálogo, que son públicas, inmutables y ya están desplegadas. Es el mismo mecanismo de
-- `pick_program_cover`, y por la misma razón: lo que se ve en la imagen y lo que se
-- entrena hablan de lo mismo.
--
-- **Se decide al publicar y se guarda.** Recalcular al leer haría que la cara cambiase al
-- añadir un ejercicio. El borrador proyecta la que le tocaría, que es lo que la pantalla
-- de portada enseña como previa.
--
-- Y con la fotografía personal se va todo lo que existía **sólo** para sostenerla: la
-- tabla de fotos, el bucket, las dos operaciones, y `privacy.binary_disposals`, que se
-- queda sin un solo escritor y que `ADR-021` no deja puesta por si acaso.

begin;

set lock_timeout = '5s';

-- La región que más pesa en un contenido de sesión, leída del JSON y no de las filas:
-- sirve igual para un borrador que todavía no existe como versión y para el contenido
-- canónico que se está a punto de publicar. Nula cuando no hay ejercicios.
create or replace function planning.region_of_content(p_content jsonb)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select muscle.region
  from jsonb_array_elements(
         case when jsonb_typeof(p_content->'steps') = 'array' then p_content->'steps' else '[]'::jsonb end
       ) as step(value)
  join catalog.movement_muscles as link
    on link.movement_id = nullif(step.value->>'movement_id', '')::uuid
  join catalog.muscles as muscle on muscle.id = link.muscle_id
  where muscle.status = 'published'
  group by muscle.region
  -- Los primarios mandan; el recuento total desempata. Igual que `program_region`.
  order by count(*) filter (where link.is_primary) desc, count(*) desc, muscle.region
  limit 1
$function$;

alter function planning.region_of_content(jsonb) owner to allfit_owner;
revoke all on function planning.region_of_content(jsonb) from public;
grant execute on function planning.region_of_content(jsonb) to allfit_api;

-- Qué portada del catálogo le toca a una rutina. Determinista: la misma rutina recibe
-- siempre la misma, así que publicar otra vez no le cambia la cara. Sin región no hay
-- portada, y eso no es un error: es una rutina que todavía no dice qué trabaja.
create or replace function planning.pick_routine_cover(p_template_id uuid, p_region text)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select candidate.cover_object_key
  from (
    select source.cover_object_key,
           planning.program_region(source.id) = p_region as misma_region
    from planning.programs as source
    where source.content_scope = 'global'
      and source.status = 'published'
      and source.cover_object_key is not null
  ) as candidate
  where p_region is not null
  -- Las de la misma región primero; dentro de ellas, un orden estable derivado del
  -- identificador de la plantilla, para que dos rutinas parecidas no salgan clonadas.
  order by candidate.misma_region desc nulls last,
           extensions.digest(p_template_id::text || candidate.cover_object_key, 'sha256')
  limit 1
$function$;

alter function planning.pick_routine_cover(uuid, text) owner to allfit_owner;
revoke all on function planning.pick_routine_cover(uuid, text) from public;
grant execute on function planning.pick_routine_cover(uuid, text) to allfit_api;

-- La versión guarda la clave de una imagen pública, no el identificador de una privada.
alter table planning.session_template_versions
  drop constraint ck_session_template_versions_cover,
  drop constraint fk_session_template_versions_cover_photo;

alter table planning.session_template_versions add column cover_object_key text;

-- Una versión publicada no se toca en runtime y el disparador lo impide; esto es una
-- migración de datos y no runtime, así que se aparta y se vuelve a poner. Es la única
-- manera de que lo ya publicado con foto no se quede sin cara.
alter table planning.session_template_versions
  disable trigger trg_session_template_versions_before_mutation_immutable;

-- Lo que ya estaba publicado con foto se queda con una del catálogo, elegida por lo que
-- esa versión trabaja. Si su plantilla no tiene región —una versión sin ejercicios— se
-- queda sin portada, que es un estado legítimo y no una versión rota.
--
-- **Una por dueño y no todas de una vez.** `pick_routine_cover` es `security definer` y
-- corre como `allfit_owner` con FORCE RLS; la política que abre el catálogo de programas
-- globales exige que haya actor. Sin él la lectura sale vacía, el relleno escribe nulos
-- **en silencio** y el resultado parece que funcionó.
do $$
declare
  afectada record;
begin
  for afectada in
    select version.id, version.template_id, template.owner_person_id
    from planning.session_template_versions as version
    join planning.session_templates as template on template.id = version.template_id
    where version.cover_kind = 'photo'
      -- El contenido curado global no tiene dueño a quien suplantar, y tampoco usa
      -- portadas de foto: la curación las escribe como icono o como músculos.
      and template.owner_person_id is not null
  loop
    perform set_config('app.actor_person_id', afectada.owner_person_id::text, true);
    update planning.session_template_versions as version
    set cover_object_key = planning.pick_routine_cover(
          afectada.template_id,
          (select muscle.region
           from planning.planned_steps as step
           join catalog.movement_muscles as link on link.movement_id = step.movement_id
           join catalog.muscles as muscle on muscle.id = link.muscle_id
           where step.template_version_id = afectada.id
           group by muscle.region
           order by count(*) filter (where link.is_primary) desc, count(*) desc, muscle.region
           limit 1)
        )
    where version.id = afectada.id;
  end loop;
  perform set_config('app.actor_person_id', '', true);
end
$$;

update planning.session_template_versions
set cover_kind = null
where cover_kind = 'photo' and cover_object_key is null;

alter table planning.session_template_versions
  enable trigger trg_session_template_versions_before_mutation_immutable;

alter table planning.session_template_versions drop column cover_photo_id;

alter table planning.session_template_versions
  -- Cada clase lleva exactamente su carga y ninguna otra. `is not distinct from` porque
  -- con `cover_kind` nulo la igualdad daría nulo y el check pasaría por desconocido.
  add constraint ck_session_template_versions_cover check (
    (cover_icon is not null) = (cover_kind is not distinct from 'icon')
    -- La clave implica la clase, pero **no al revés**: una rutina cuyos ejercicios no
    -- dicen qué región trabajan pide foto y no recibe ninguna, y eso no es una versión
    -- rota. Exigir la clave aquí convertiría ese caso en una publicación que falla con
    -- un error de integridad que nadie sabría leer.
    and (cover_object_key is null or cover_kind is not distinct from 'photo')
  ),
  -- La clave, nunca una URL: la base del endpoint vive en configuración, y una URL
  -- guardada ataría la fila al proveedor (`ADR-031`).
  add constraint ck_session_template_versions_cover_key check (
    cover_object_key is null or cover_object_key !~ '^[a-z][a-z0-9+.-]*://'
  );

-- Los borradores pierden el identificador de una foto que ya no existe. Cambia su hash
-- canónico, así que una rutina que llevara foto dirá «cambios sin publicar» hasta que se
-- publique una vez: es cierto, su contenido cambió.
update planning.session_template_drafts
set content = jsonb_set(content, '{cover}', (content->'cover') - 'photo_id')
where content->'cover'->>'kind' = 'photo';

CREATE OR REPLACE FUNCTION planning.session_content_errors(p_content jsonb, p_organization_id uuid, p_discipline_code text, p_require_complete boolean)
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
       or cover->>'kind' not in ('muscles', 'icon', 'photo') then
      errors := array_append(errors, 'cover');
    elsif cover->>'kind' in ('muscles', 'photo') then
      -- Las dos se dibujan solas: la figura sale de los ejercicios y la fotografía sale
      -- del catálogo, elegida por lo que la rutina trabaja. Ninguna lleva carga, así que
      -- un icono colgando de ellas sería una segunda respuesta a una pregunta que tiene
      -- una. Y `photo_id` ya no existe: quien lo mande está hablando de la portada
      -- personal que `ADR-031` retiró.
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

CREATE OR REPLACE FUNCTION planning.canonical_session_content(p_content jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
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

CREATE OR REPLACE FUNCTION planning.session_version_projection(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

CREATE OR REPLACE FUNCTION planning.publish_session_template_version(p_person_id uuid, p_organization_id uuid, p_template_id uuid, p_expected_etag text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(result jsonb, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  -- Sólo la última. Volver a publicar lo que ya está publicado la devuelve, que es lo
  -- que evita una versión por pulsación; deshacer un cambio es una versión hacia
  -- adelante. Devolver un identificador ya superado dejaría a las semanas de programa
  -- que lo llevan apuntando a una versión que ninguna consulta de biblioteca nombra.
  select latest.id into version_id
  from (
    select version.id, version.content_hash, version.status
    from planning.session_template_versions as version
    where version.template_id = p_template_id
    order by version.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is null then
    select coalesce(max(version.version_number), 0) + 1 into next_version
    from planning.session_template_versions as version where version.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, cover_kind, cover_icon, cover_object_key, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title',
      (canonical_content->'cover'->>'kind')::planning.routine_cover,
      (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
      -- Aquí se decide la cara y aquí se congela. Recalcularla al leer haría que
      -- cambiase al añadir un ejercicio, y una tarjeta distinta en cada edición no es
      -- una portada.
      case when canonical_content->'cover'->>'kind' = 'photo'
        then planning.pick_routine_cover(p_template_id, planning.region_of_content(canonical_content))
      end,
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

CREATE OR REPLACE FUNCTION planning.publish_global_session_template(p_template_id uuid, p_discipline_code text, p_content jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
  --
  -- Against the newest only, so a curated routine that was changed and changed back
  -- moves forward instead of resurrecting the version the catalogue already moved on
  -- from.
  select latest.id into version_id
  from (
    select version.id, version.content_hash, version.status
    from planning.session_template_versions as version
    where version.template_id = p_template_id
    order by version.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is not null then
    return version_id;
  end if;

  insert into planning.session_template_versions (
    template_id, version_number, discipline_code, activity_type_id, title,
    cover_kind, cover_icon, cover_object_key, content_hash
  )
  select p_template_id,
         coalesce(max(existing.version_number), 0) + 1,
         p_discipline_code,
         (canonical_content->>'activity_type_id')::uuid,
         canonical_content->>'title',
         (canonical_content->'cover'->>'kind')::planning.routine_cover,
         (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
         case when canonical_content->'cover'->>'kind' = 'photo'
           then planning.pick_routine_cover(p_template_id, planning.region_of_content(canonical_content))
         end,
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

CREATE OR REPLACE FUNCTION planning.publish_my_session_template(p_person_id uuid, p_template_id uuid, p_expected_etag text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(version jsonb, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  -- Sólo la última. Volver a publicar lo que ya está publicado la devuelve, que es lo
  -- que evita una versión por pulsación; deshacer un cambio es una versión hacia
  -- adelante. Devolver un identificador ya superado dejaría a las semanas de programa
  -- que lo llevan apuntando a una versión que ninguna consulta de biblioteca nombra.
  select latest.id into version_id
  from (
    select existing.id, existing.content_hash, existing.status
    from planning.session_template_versions as existing
    where existing.template_id = p_template_id
    order by existing.version_number desc
    limit 1
  ) as latest
  where latest.content_hash = version_content_hash and latest.status = 'published';
  if version_id is null then
    select coalesce(max(existing.version_number), 0) + 1 into next_version
    from planning.session_template_versions as existing where existing.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, cover_kind, cover_icon, cover_object_key, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title',
      (canonical_content->'cover'->>'kind')::planning.routine_cover,
      (canonical_content->'cover'->>'icon')::planning.routine_cover_icon,
      -- Aquí se decide la cara y aquí se congela. Recalcularla al leer haría que
      -- cambiase al añadir un ejercicio, y una tarjeta distinta en cada edición no es
      -- una portada.
      case when canonical_content->'cover'->>'kind' = 'photo'
        then planning.pick_routine_cover(p_template_id, planning.region_of_content(canonical_content))
      end,
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

CREATE OR REPLACE FUNCTION planning.fork_program_version(p_person_id uuid, p_program_version_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
           -- El contenido que la copia va a tener, calculado una vez: fija su hash y es
           -- su borrador. La portada viaja entera, incluida la fotografía: desde que sale
           -- del catálogo y no de la galería de nadie, copiarla no es quedarse con algo
           -- ajeno.
           planning.canonical_session_content(
             planning.session_version_projection(source_version.id)) as content,
           source_version.template_id,
           source_version.discipline_code,
           source_version.activity_type_id,
           source_version.title,
           source_version.cover_kind,
           source_version.cover_icon,
           source_version.cover_object_key,
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
      derived_from_version_id, cover_kind, cover_icon, cover_object_key, content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title,
      -- De dónde salió. La copia es una plantilla nueva con identidad propia, así que
      -- sin esto no hay forma de contar cuánta gente entrena algo derivado de un
      -- programa de Allfit: son plantillas sueltas que se parecen.
      template.version_id,
      template.cover_kind,
      template.cover_icon,
      -- La misma imagen que el original y no la que le tocaría a la copia: es una copia
      -- de esa rutina, y tiene que reconocerse como ella.
      template.cover_object_key,
      -- **El hash de su propio contenido, no el del original.** Copiar el del origen
      -- era copiar la descripción de otra cosa: publicar expande `target_sets` en series
      -- explícitas, así que el contenido re-renderizado canonicaliza distinto del
      -- compacto que escribió la curación, y la copia nacía diciendo que tenía cambios
      -- sin publicar sin que nadie la hubiera tocado.
      -- Con la **misma expresión** con la que se compara después. `read_my_content`
      -- pregunta si `digest(canonical(borrador))` coincide con este hash, y resulta que
      -- `canonical_session_content` no es idempotente: aplicarla dos veces da otros
      -- bytes. Guardar el contenido ya canonicalizado sin volver a pasarlo dejaba la
      -- copia anunciando cambios que nadie hizo, que es justo lo que esto viene a quitar.
      extensions.digest(
        convert_to(planning.canonical_session_content(template.content)::text, 'UTF8'),
        'sha256'
      ),
      'published', clock_timestamp()
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

    -- **Y su borrador.** Tomar es quedárselo, y una rutina que no se puede abrir para
    -- editar no es del todo tuya: sin esta fila, abrirla respondía que no existe y la
    -- pantalla decía «no pudimos cargar», que además de inútil era falso.
    --
    -- Se arma de la copia recién hecha y no del original, porque las dos no son iguales:
    -- una portada de foto no se copia. Y pasa por el canonicalizador, así que su hash es
    -- el de la versión — la rutina nace sin cambios pendientes, que es la verdad.
    insert into planning.session_template_drafts (template_id, content, derived_from_version_id)
    values (new_template_id, template.content, new_template_version_id);

    mapping := mapping || jsonb_build_object(template.version_id::text, new_template_version_id);
  end loop;

  insert into planning.programs (
    content_scope, owner_person_id, author_person_id, status, cover_object_key
  )
  select 'person', p_person_id, p_person_id, 'published', origin.cover_object_key
  from planning.programs as origin
  join planning.program_versions as taken on taken.program_id = origin.id
  where taken.id = p_program_version_id
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

  -- **Y su borrador.** Sin él, un programa tomado de Allfit no se puede abrir para
  -- editar: `read_my_programs` marca `editable` cuando hay borrador, y la tarjeta se
  -- quedaba sin el botón. Tomar es quedárselo, y un programa que no se puede tocar no es
  -- del todo tuyo.
  --
  -- La composición se reconstruye de la copia recién hecha, que es donde las sesiones ya
  -- apuntan a las plantillas de la persona. Del original apuntarían a las de Allfit, y
  -- editar el programa lo devolvería al contenido que la bifurcación acababa de sacar.
  insert into planning.program_drafts (program_id, content)
  select new_program_id, planning.canonical_program_content(jsonb_build_object(
    'title', source.title,
    'notes', source.notes,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', composition.position,
        'week', composition.week,
        'day', composition.day,
        'template_version_id', composition.template_version_id
      ) order by composition.position)
      from planning.program_version_sessions as composition
      where composition.program_version_id = new_version_id
    ), '[]'::jsonb)
  ));

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

CREATE OR REPLACE FUNCTION planning.discard_my_session_template(p_person_id uuid, p_template_id uuid, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(template jsonb, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  current planning.session_templates%rowtype;
  affected record;
  remaining jsonb;
  new_content jsonb;
  new_version_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-028', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_template_projection(receipt.aggregate_id), true;
    return;
  end if;

  select * into current
  from planning.session_templates as template
  where template.id = p_template_id and template.owner_person_id = p_person_id
  for update;
  if current.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  -- **Los programas de la persona la sueltan.** Antes esto se rechazaba en seco porque
  -- hay programas y asignaciones que la referencian; ahora se republica cada programa
  -- propio sin ella y la asignación se muda sola a la versión nueva. Lo de Allfit no se
  -- toca: no es suyo, y la bifurcación ya le dio una copia que sí lo es.
  --
  -- Se trabaja sobre la composición de la **última versión publicada** y no sobre el
  -- borrador: descartar una rutina no debe publicar de paso los cambios a medias que
  -- alguien tuviera sin guardar en otro programa.
  for affected in
    select program.id as program_id, latest.id as version_id, latest.title, latest.notes
    from planning.programs as program
    join lateral (
      select version.* from planning.program_versions as version
      where version.program_id = program.id
      order by version.version_number desc
      limit 1
    ) as latest on true
    where program.owner_person_id = p_person_id
      and program.status <> 'archived'
      and exists (
        select 1
        from planning.program_version_sessions as composition
        join planning.session_template_versions as used
          on used.id = composition.template_version_id
        where composition.program_version_id = latest.id and used.template_id = p_template_id
      )
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'position', composition.position,
             'week', composition.week,
             'day', composition.day,
             'template_version_id', composition.template_version_id
           ) order by composition.position), '[]'::jsonb)
    into remaining
    from planning.program_version_sessions as composition
    join planning.session_template_versions as used on used.id = composition.template_version_id
    where composition.program_version_id = affected.version_id
      and used.template_id <> p_template_id;

    -- Un programa sin una sola sesión no se puede publicar, y dejar a alguien con un
    -- programa que ya no se puede tocar sería peor que no borrar la rutina. Se dice cuál
    -- es y no se hace nada.
    if jsonb_array_length(remaining) = 0 then
      raise exception 'program would be left empty' using errcode = '23514',
        detail = affected.title;
    end if;

    new_content := jsonb_build_object(
      'title', affected.title, 'notes', affected.notes, 'sessions', remaining
    );
    update planning.program_drafts
    set content = planning.canonical_program_content(new_content),
        updated_at = clock_timestamp()
    where program_id = affected.program_id;

    new_version_id := planning.publish_program_content(affected.program_id, new_content);
    perform planning.restate_assignment_onto(p_person_id, new_version_id);
  end loop;

  if current.status <> 'archived' then
    update planning.session_templates
    set status = 'archived', updated_at = clock_timestamp()
    where id = p_template_id;

    perform system.enqueue_outbox_event(
      'session_template', p_template_id, 'planning.session_template_discarded.v1',
      jsonb_build_object('template_id', p_template_id)
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'session-template-discarded',
    'session_template', p_template_id
  );
  return query select planning.session_template_projection(p_template_id), false;
end
$function$;

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
        'cover', case
          when draft.id is not null then
            case when jsonb_typeof(draft.content->'cover') = 'object'
              then draft.content->'cover'
            end
          else published.cover
        end,
        -- Dónde está la imagen de una portada de clase `foto`. La del borrador se
        -- proyecta y la de la versión ya está guardada, porque es lo que se congeló al
        -- publicar: son la misma pregunta contestada en dos momentos.
        'cover_object_key', case
          when draft.id is not null then
            case when draft.content->'cover'->>'kind' = 'photo'
              then planning.pick_routine_cover(template.id, planning.region_of_content(draft.content))
            end
          else published.cover_object_key
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
        version.cover_object_key,
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

-- Dónde está la portada que un borrador tendría si se publicara ahora. Sólo la usan los
-- lectores de Space: Studio lee el mismo borrador y no dibuja ninguna previa, así que la
-- proyección compartida se queda como estaba.
create or replace function planning.draft_cover_address(p_draft_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  -- **Sin mirar qué portada tiene puesta ahora.** La pantalla de portada enseña la previa
  -- de las tres clases antes de elegir ninguna, así que preguntar sólo cuando ya pidió
  -- foto dejaría esa pestaña vacía justo en el momento de decidir.
  select jsonb_build_object(
    'cover_object_key',
    planning.pick_routine_cover(draft.template_id, planning.region_of_content(draft.content))
  )
  from planning.session_template_drafts as draft
  where draft.id = p_draft_id
$function$;

alter function planning.draft_cover_address(uuid) owner to allfit_owner;
revoke all on function planning.draft_cover_address(uuid) from public;
grant execute on function planning.draft_cover_address(uuid) to allfit_api;

-- Y el lector de Space la añade a lo que devuelve.
CREATE OR REPLACE FUNCTION planning.read_my_session_template_draft(p_person_id uuid, p_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  draft_id uuid;
begin
  perform planning.assert_own_content(p_person_id);

  select existing.id into draft_id
  from planning.session_template_drafts as existing
  join planning.session_templates as template on template.id = existing.template_id
  where template.id = p_template_id
    and template.owner_person_id = p_person_id
    and template.status <> 'archived';

  -- Absent, discarded and somebody else's answer the same. Telling them apart would
  -- let identifiers be walked to learn which routines exist.
  if draft_id is null then return null; end if;

  return planning.session_draft_projection(draft_id) || planning.draft_cover_address(draft_id);
end
$function$;

-- Guardar un borrador ya no comprueba de quién es la foto ni recoge la que sustituye:
-- no hay foto de nadie.
CREATE OR REPLACE FUNCTION planning.replace_my_session_template_draft(p_person_id uuid, p_template_id uuid, p_expected_etag text, p_content jsonb, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(draft jsonb, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  current planning.session_template_drafts%rowtype;
  discipline text;
  errors text[];
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-002', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_draft_projection(receipt.aggregate_id)
      || planning.draft_cover_address(receipt.aggregate_id), true;
    return;
  end if;

  select existing_draft.*
  into current
  from planning.session_template_drafts as existing_draft
  join planning.session_templates as template on template.id = existing_draft.template_id
  where template.id = p_template_id and template.owner_person_id = p_person_id
  for update of existing_draft;
  if current.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  select template.discipline_code into discipline
  from planning.session_templates as template where template.id = p_template_id;

  if planning.content_etag(current.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001',
      detail = planning.session_draft_projection(current.id)::text;
  end if;
  -- No organization, so only global activity types and movements qualify, which is
  -- exactly what a person should be able to reach.
  errors := planning.session_content_errors(p_content, null, discipline, false);
  if cardinality(errors) > 0 then
    raise exception 'invalid session template draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  if current.content is distinct from p_content then
    update planning.session_template_drafts
    set content = p_content, derived_from_version_id = null, updated_at = clock_timestamp()
    where id = current.id;
    update planning.session_templates set updated_at = clock_timestamp() where id = p_template_id;
  end if;
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'session-template-draft-updated',
    'session_template_draft', current.id
  );
  return query select planning.session_draft_projection(current.id)
    || planning.draft_cover_address(current.id), false;
end
$function$;

-- Lo que existía sólo para la fotografía personal.
-- Por nombre y no por firma: `upload_my_cover_photo` cambió de argumentos cuando los
-- bytes salieron a un cubo, así que un `drop` con una firma escrita a mano se salta la
-- otra **sin fallar** y deja una función viva apuntando a una tabla que ya no existe.
do $$
declare
  huerfana record;
begin
  for huerfana in
    select oid::regprocedure as firma
    from pg_proc
    where pronamespace = 'planning'::regnamespace
      and proname in ('upload_my_cover_photo', 'read_my_cover_photo', 'collect_cover_photos')
  loop
    execute format('drop function %s', huerfana.firma);
  end loop;
end
$$;
drop function if exists privacy.claim_binary_disposals(integer);
drop function if exists privacy.seal_binary_disposal(uuid);

drop trigger if exists trg_record_cover_photo_disposition on planning.session_template_cover_photos;
drop function if exists planning.record_cover_photo_disposition_tg();

drop table if exists planning.session_template_cover_photos;
drop table if exists privacy.binary_disposals;

-- **El cubo no se borra desde aquí.** Storage rechaza el `delete` directo sobre sus
-- tablas, y con razón: dejaría objetos huérfanos sin nadie que los recogiese. La
-- migración que lo creaba se retira del repositorio, así que una base nueva nunca lo
-- tiene; donde ya exista se quita por la API de Storage, y mientras tanto está vacío y
-- es privado.

commit;
