-- La portada es del programa y no de la rutina — tercera revisión de `ADR-031`.
--
-- **Seis rutinas eligiendo cada una su estilo son seis lenguajes en el mismo carrusel.**
-- Hoy abre con las rutinas de la semana una al lado de otra; si una lleva figura de
-- músculos, otra un icono y la tercera una fotografía, lo que se lee no es una semana
-- sino un muestrario. La decisión no era de quien escribe una rutina: era de quien arma
-- el programa, que es quien ve las seis juntas.
--
-- **El estilo es del programa y la imagen es de la rutina.** «Músculos» dibuja lo que
-- cada rutina trabaja; «foto» toma del catálogo la que corresponde a lo que cada una
-- trabaja; «icono» sí es el mismo para todas, porque un icono se elige y no se calcula.
-- Así el carrusel habla un solo idioma y aun así se distingue una tarjeta de otra sin
-- leer el rótulo.
--
-- **Vive en `planning.programs` y no en la versión**, por la misma razón que la
-- fotografía del programa: una versión publicada es inmutable porque es lo que alguien
-- entrenó, y cambiar cómo se ve una tarjeta no cambia lo que se entrena. Cambiarlo es su
-- propia operación y surte efecto al momento, sin acuñar una versión de nada.
--
-- **Una rutina suelta se queda sin portada, y eso no es una pérdida.** Se reconoce por su
-- letra, que es como se reconocía antes de que la portada existiera. La que está en un
-- programa se viste del primero que la usa, por el orden que la persona ya eligió.
--
-- Lo que se va de `session_template_versions` cambia el hash canónico de toda rutina que
-- llevara portada: su borrador dirá «cambios sin publicar» hasta que se publique una vez.
-- Es cierto, su contenido cambió.

set statement_timeout = '60s';

begin;

set lock_timeout = '5s';

-- El estilo que llevan las rutinas de un programa. `routine_` delante a propósito:
-- `cover_object_key` ya vive aquí y es otra cosa —la cara del programa en su propia
-- tarjeta—, y dos columnas parecidas con sentidos distintos se confunden a la primera.
alter table planning.programs
  add column routine_cover_kind planning.routine_cover,
  add column routine_cover_icon planning.routine_cover_icon;

alter table planning.programs
  add constraint ck_programs_routine_cover check (
    (routine_cover_icon is not null) = (routine_cover_kind is not distinct from 'icon')
  );

-- Lo que cada programa ya vestía, si sus rutinas se pusieron de acuerdo. Se toma el
-- estilo más repetido entre sus rutinas; un empate lo resuelve el orden del enumerado,
-- que es estable y no depende de cuál se leyó primero.
update planning.programs as program
set routine_cover_kind = elegido.kind,
    routine_cover_icon = case when elegido.kind = 'icon' then elegido.icon end
from (
  select distinct on (version.program_id)
         version.program_id,
         used.cover_kind as kind,
         used.cover_icon as icon
  from planning.program_versions as version
  join planning.program_version_sessions as composition
    on composition.program_version_id = version.id
  join planning.session_template_versions as used
    on used.id = composition.template_version_id
  where used.cover_kind is not null
  group by version.program_id, used.cover_kind, used.cover_icon
  order by version.program_id, count(*) desc, used.cover_kind, used.cover_icon
) as elegido
where program.id = elegido.program_id;

-- Y sale de la rutina, que es de donde nunca debió decidirse.
alter table planning.session_template_versions
  drop constraint ck_session_template_versions_cover,
  drop constraint ck_session_template_versions_cover_key,
  drop column cover_kind,
  drop column cover_icon,
  drop column cover_object_key;

-- Los borradores pierden la clave. Cambia su hash canónico, y por eso está dicho arriba.
update planning.session_template_drafts
set content = content - 'cover'
where content ? 'cover';

-- La previa del borrador se va con ella: ahora la dibuja el editor de programa.
drop function if exists planning.draft_cover_address(uuid);

CREATE OR REPLACE FUNCTION planning.session_content_errors(p_content jsonb, p_organization_id uuid, p_discipline_code text, p_require_complete boolean)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  errors text[] := array[]::text[];
  step jsonb;
  target jsonb;
  effective_activity_type_id uuid;
  declared_family catalog.activity_family;
  expected_family catalog.activity_family;
begin
  if jsonb_typeof(p_content) <> 'object'
     or not p_content ?& array['title', 'activity_type_id', 'steps']
     or p_content - array['title', 'activity_type_id', 'steps'] <> '{}'::jsonb then
    return array['invalid-content-shape'];
  end if;
  if jsonb_typeof(p_content->'title') <> 'string'
     or btrim(p_content->>'title') = ''
     or char_length(p_content->>'title') > 160 then
    errors := array_append(errors, 'title');
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
  -- La portada salió de aquí el 19 de septiembre de 2026: es del programa y no de la
  -- rutina, así que ya no describe el contenido que se publica.
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
      derived_from_version_id, title, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title',
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
    content_hash
  )
  select p_template_id,
         coalesce(max(existing.version_number), 0) + 1,
         p_discipline_code,
         (canonical_content->>'activity_type_id')::uuid,
         canonical_content->>'title',
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
      derived_from_version_id, title, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title',
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
      derived_from_version_id, content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title,
      -- De dónde salió. La copia es una plantilla nueva con identidad propia, así que
      -- sin esto no hay forma de contar cuánta gente entrena algo derivado de un
      -- programa de Allfit: son plantillas sueltas que se parecen.
      template.version_id,
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

  -- La copia se lleva la cara del original **y el estilo de sus rutinas**: tomar un
  -- programa de Allfit y que sus seis tarjetas cambiaran de aspecto sería tomar otro.
  insert into planning.programs (
    content_scope, owner_person_id, author_person_id, status, cover_object_key,
    routine_cover_kind, routine_cover_icon
  )
  select 'person', p_person_id, p_person_id, 'published', origin.cover_object_key,
         origin.routine_cover_kind, origin.routine_cover_icon
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

  return planning.session_draft_projection(draft_id);
end
$function$;

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
    return query select planning.session_draft_projection(receipt.aggregate_id), true;
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
  return query select planning.session_draft_projection(current.id), false;
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

-- Cambia lo que devuelve, así que hay que tirarla antes: PostgreSQL no deja reemplazar
-- una función cuyos parámetros de salida cambian.
drop function planning.read_my_programs(uuid);

CREATE OR REPLACE FUNCTION planning.read_my_programs(p_person_id uuid)
 RETURNS TABLE(assignment_id uuid, program_version_id uuid, program_id uuid, title text, weeks integer, days_per_week integer, starts_on date, sessions_done integer, sessions_planned integer, editable boolean, cover_object_key text, routine_cover jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select assignment.id,
         version.id,
         version.program_id,
         version.title,
         composition.weeks,
         composition.days_per_week,
         assignment.starts_on,
         counted.done,
         counted.planned,
         -- A draft exists only for a programme somebody wrote here. A fork has none,
         -- and a programme whose weeks differ cannot be said as one repeated week.
         draft.id is not null
           and composition.weeks * composition.days_per_week = composition.sessions,
         program.cover_object_key,
         -- El estilo que llevan sus rutinas, que es una decisión del programa y no de
         -- cada una: seis tarjetas con seis lenguajes distintos en el mismo carrusel.
         case when program.routine_cover_kind is null then null else jsonb_strip_nulls(
           jsonb_build_object('kind', program.routine_cover_kind, 'icon', program.routine_cover_icon)
         ) end
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  join planning.programs as program on program.id = version.program_id
  left join planning.program_drafts as draft on draft.program_id = version.program_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day) filter (where session.week = 1)::integer as days_per_week,
           count(*)::integer as sessions
    from planning.program_version_sessions as session
    where session.program_version_id = version.id
  ) as composition on true
  join lateral (
    select count(*) filter (where session.status = 'completed')::integer as done,
           count(*)::integer as planned
    from planning.planned_sessions as session
    where session.assignment_id = assignment.id
  ) as counted on true
  where assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.display_order, assignment.assigned_at desc
$function$;

alter function planning.read_my_programs(uuid) owner to allfit_owner;
revoke all on function planning.read_my_programs(uuid) from public;
grant execute on function planning.read_my_programs(uuid) to allfit_api;

-- `OP-PLN-033` — vestir mi programa.
--
-- Surte efecto al momento y no acuña versión: el estilo no describe lo que se entrena,
-- así que una versión nueva por cambiar de icono sería una versión que miente. Es la
-- misma forma que `OP-PLN-024`, que tampoco publica nada por reordenar.
create or replace function planning.set_my_program_cover(
  p_person_id uuid,
  p_program_id uuid,
  p_kind text,
  p_icon text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  owned planning.programs%rowtype;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'program person does not match the authenticated actor' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-033', p_idempotency_key, p_command_id, p_request_hash
  );

  -- Sólo el dueño, y sólo un programa suyo: uno tomado de Allfit se ve como Allfit lo
  -- armó, y cambiarle la cara sería editar contenido de otro.
  select * into owned
  from planning.programs as program
  where program.id = p_program_id
    and program.owner_person_id = p_person_id
    and program.content_scope = 'person';
  if not found then
    raise exception 'program not found' using errcode = 'P0002';
  end if;

  -- El reintento responde lo que el programa lleva, que es lo que el primero dejó. No
  -- hay resultado guardado que devolver, y leer la fila dice la verdad aunque entre
  -- medias haya pasado otra cosa.
  if not receipt.claimed then
    return jsonb_build_object('program_id', p_program_id, 'cover',
      case when owned.routine_cover_kind is null then null else jsonb_strip_nulls(
        jsonb_build_object('kind', owned.routine_cover_kind, 'icon', owned.routine_cover_icon)
      ) end);
  end if;

  if p_kind is not null and p_kind not in ('muscles', 'icon', 'photo') then
    raise exception 'that is not a cover' using errcode = '22023';
  end if;
  -- Cada clase lleva su carga y ninguna otra, igual que lo exigía la rutina.
  if (p_icon is not null) <> (p_kind is not distinct from 'icon') then
    raise exception 'that is not a cover' using errcode = '22023';
  end if;

  update planning.programs
  set routine_cover_kind = p_kind::planning.routine_cover,
      routine_cover_icon = p_icon::planning.routine_cover_icon,
      updated_at = clock_timestamp()
  where id = p_program_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'program-cover-set', 'program', p_program_id
  );

  return jsonb_build_object('program_id', p_program_id, 'cover',
    case when p_kind is null then null
      else jsonb_strip_nulls(jsonb_build_object('kind', p_kind, 'icon', p_icon)) end);
end
$function$;

alter function planning.set_my_program_cover(uuid, uuid, text, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.set_my_program_cover(uuid, uuid, text, text, uuid, uuid, bytea) from public;
grant execute on function planning.set_my_program_cover(uuid, uuid, text, text, uuid, uuid, bytea) to allfit_api;

commit;
