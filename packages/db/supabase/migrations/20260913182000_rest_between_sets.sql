-- The rest a step asks for between sets.
--
-- `S-3 · Tiempo de descanso` and the "Descanso 1:30" chip on `X-1` are both approved
-- and had nowhere to live: `strength_targets` carried sets, reps, load and RPE and
-- nothing about rest. Without the column those two would have to show an invented
-- number, which is the one thing a screen somebody trusts must never do.
--
-- **It is prescription, not measurement.** It is what the step asks for; what
-- somebody actually rested is not recorded in V1. Nullable, because a step may say
-- nothing about it — and a zero would mean "no rest", which is a different
-- instruction from "nobody said".
--
-- The three functions below are the live definitions with the new key added, taken
-- from `pg_get_functiondef` rather than retyped: `session_content_errors` is what
-- keeps content honest, and a transcription slip in it would be worse than the gap
-- it closes.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

alter table planning.strength_targets
  add column target_rest_seconds integer;

alter table planning.strength_targets
  drop constraint ck_strength_targets_values;

alter table planning.strength_targets
  add constraint ck_strength_targets_values check (
    target_sets > 0
    and (target_reps is null or target_reps > 0)
    and (target_load_value is null) = (target_load_unit_code is null)
    and (target_load_value is null or target_load_value >= 0)
    and (target_rpe is null or target_rpe between 0 and 10)
    and (target_rest_seconds is null or target_rest_seconds between 0 and 3600)
  );

create or replace function planning.session_content_errors(p_content jsonb, p_organization_id uuid, p_discipline_code text, p_require_complete boolean)
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
       or step - array['position', 'movement_id', 'activity_type_id', 'notes', 'target'] <> '{}'::jsonb
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

    if declared_family = 'strength'
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

create or replace function planning.canonical_target(p_target jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
  select case p_target->>'family'
    when 'strength' then jsonb_strip_nulls(jsonb_build_object(
      'family', 'strength',
      'target_sets', (p_target->>'target_sets')::integer,
      'target_reps', nullif(p_target->>'target_reps', '')::integer,
      'target_load_value', nullif(p_target->>'target_load_value', '')::numeric,
      'target_load_unit_code', nullif(p_target->>'target_load_unit_code', ''),
      'target_rpe', nullif(p_target->>'target_rpe', '')::numeric,
      'target_rest_seconds', nullif(p_target->>'target_rest_seconds', '')::integer
    ))
    when 'endurance' then jsonb_strip_nulls(jsonb_build_object(
      'family', 'endurance',
      'target_distance_value', nullif(p_target->>'target_distance_value', '')::numeric,
      'target_distance_unit_code', nullif(p_target->>'target_distance_unit_code', ''),
      'target_duration_seconds', nullif(p_target->>'target_duration_seconds', '')::numeric,
      'target_pace_seconds_per_unit', nullif(p_target->>'target_pace_seconds_per_unit', '')::numeric,
      'target_pace_unit_code', nullif(p_target->>'target_pace_unit_code', '')
    ))
    when 'interval' then jsonb_strip_nulls(jsonb_build_object(
      'family', 'interval',
      'rounds', (p_target->>'rounds')::integer,
      'work_duration_seconds', (p_target->>'work_duration_seconds')::numeric,
      'rest_duration_seconds', nullif(p_target->>'rest_duration_seconds', '')::numeric,
      'target_rpe', nullif(p_target->>'target_rpe', '')::numeric
    ))
    when 'mobility' then jsonb_strip_nulls(jsonb_build_object(
      'family', 'mobility',
      'sequence_position', (p_target->>'sequence_position')::integer,
      'hold_duration_seconds', nullif(p_target->>'hold_duration_seconds', '')::numeric,
      'target_repetitions', nullif(p_target->>'target_repetitions', '')::integer,
      'side', p_target->>'side'
    ))
  end
$function$;

create or replace function planning.materialize_target(p_step_id uuid, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  case p_target->>'family'
    when 'strength' then
      insert into planning.strength_targets (
        planned_step_id, target_sets, target_reps, target_load_value,
        target_load_unit_code, target_rpe, target_rest_seconds
      ) values (
        p_step_id, (p_target->>'target_sets')::integer,
        nullif(p_target->>'target_reps', '')::integer,
        nullif(p_target->>'target_load_value', '')::numeric,
        nullif(p_target->>'target_load_unit_code', ''),
        nullif(p_target->>'target_rpe', '')::numeric,
        nullif(p_target->>'target_rest_seconds', '')::integer
      );
    when 'endurance' then
      insert into planning.endurance_targets (
        planned_step_id, target_distance_value, target_distance_unit_code,
        target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      ) values (
        p_step_id, nullif(p_target->>'target_distance_value', '')::numeric,
        nullif(p_target->>'target_distance_unit_code', ''),
        nullif(p_target->>'target_duration_seconds', '')::numeric,
        nullif(p_target->>'target_pace_seconds_per_unit', '')::numeric,
        nullif(p_target->>'target_pace_unit_code', '')
      );
    when 'interval' then
      insert into planning.interval_targets (
        planned_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      ) values (
        p_step_id, (p_target->>'rounds')::integer,
        (p_target->>'work_duration_seconds')::numeric,
        nullif(p_target->>'rest_duration_seconds', '')::numeric,
        nullif(p_target->>'target_rpe', '')::numeric
      );
    when 'mobility' then
      insert into planning.mobility_targets (
        planned_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      ) values (
        p_step_id, (p_target->>'sequence_position')::integer,
        nullif(p_target->>'hold_duration_seconds', '')::numeric,
        nullif(p_target->>'target_repetitions', '')::integer,
        p_target->>'side'
      );
    else
      raise exception 'unknown target family' using errcode = '22023';
  end case;
end
$function$;

commit;
