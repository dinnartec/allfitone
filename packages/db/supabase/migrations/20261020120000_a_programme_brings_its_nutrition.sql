-- A programme of Allfit carries a nutrition goal, sized to the person (PN-1, HU-SP-100).
--
-- The reference is per training goal, not per programme: a curated row per goal and
-- nutrient says how much per kilo of body weight, so the 24 programmes of the catalogue
-- get one without publishing new versions, which are immutable. It lives in nutrition,
-- whose content it is, and only curation writes it.
--
-- The goal that applies is the one the person declared, when the programme serves it;
-- otherwise the programme's first, in a fixed order. The figures come from the latest
-- weight recorded; with none there is no goal, never a guess.
--
-- Taking the programme may adopt it. That is the person publishing their own goal —
-- origin `self`, with the programme named as the reason — through
-- `nutrition.publish_self_goal_version`, in the same transaction and under the same
-- command. The figures are frozen there: a later weight does not move them.

set lock_timeout = '5s';
set statement_timeout = '120s';

create table nutrition.goal_references (
  goal_code text not null,
  nutrient_code text not null,
  mode nutrition.goal_target_mode not null,
  minimum_per_kg numeric,
  maximum_per_kg numeric,
  exact_per_kg numeric,
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_goal_references primary key (goal_code, nutrient_code),
  -- The training goals a programme can serve: the same closed list as planning's.
  constraint ck_goal_references_goal check (
    goal_code in ('lose_weight', 'build_muscle', 'get_fit', 'run_a_race', 'maintain')
  ),
  constraint ck_goal_references_nutrient check (
    nutrient_code in ('energy', 'protein', 'carbohydrates', 'fat')
  ),
  constraint ck_goal_references_shape check (
    (mode = 'range' and minimum_per_kg > 0 and maximum_per_kg >= minimum_per_kg and exact_per_kg is null)
    or (mode = 'exact' and exact_per_kg > 0 and minimum_per_kg is null and maximum_per_kg is null)
  )
);

alter table nutrition.goal_references owner to allfit_owner;
alter table nutrition.goal_references enable row level security;
alter table nutrition.goal_references force row level security;

-- Read by the functions below; written only by curation, which runs as the superuser.
create policy goal_references_select_owner
  on nutrition.goal_references
  for select to allfit_owner using (true);

-- The reference for a goal at a weight, as the targets `publish_self_goal_version` takes.
-- Energy to 50 kcal and grams to 5: a goal reads as a goal, not as a calculation.
create function nutrition.reference_targets(p_goal_code text, p_weight_kg numeric)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_agg(
           jsonb_build_object(
             'nutrient_code', reference.nutrient_code,
             'mode', reference.mode,
             'minimum', round(reference.minimum_per_kg * p_weight_kg / step) * step,
             'maximum', round(reference.maximum_per_kg * p_weight_kg / step) * step,
             'exact', round(reference.exact_per_kg * p_weight_kg / step) * step,
             'unit', case reference.nutrient_code when 'energy' then 'kcal' else 'g' end)
           order by array_position(array['energy', 'protein', 'carbohydrates', 'fat'], reference.nutrient_code))
  from nutrition.goal_references as reference
  cross join lateral (select case reference.nutrient_code when 'energy' then 50 else 5 end as step) as rounding
  where reference.goal_code = p_goal_code and p_weight_kg > 0
$function$;

-- A programme's goal for this person: which training goal applies, and its targets at
-- the latest weight. Null with no weight or no reference.
create function planning.program_nutrition(p_person_id uuid, p_program_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  declared text;
  chosen text;
  weight numeric;
  targets jsonb;
begin
  select claim.value_text into declared
  from identity.fitness_profile_claims as claim
  where claim.person_id = p_person_id
    and claim.attribute_code = 'primary_training_goal'
    and claim.valid_to is null
    and claim.provenance = 'person_declared'
  order by claim.valid_from desc, claim.id desc
  limit 1;

  select goal.goal_code into chosen
  from planning.program_version_goals as goal
  where goal.program_version_id = p_program_version_id
  order by goal.goal_code is distinct from declared,
           array_position(array['build_muscle', 'lose_weight', 'get_fit', 'maintain', 'run_a_race'], goal.goal_code)
  limit 1;
  if chosen is null then
    return null;
  end if;

  select record.value_numeric into weight
  from identity.body_progress_records as record
  where record.person_id = p_person_id and record.metric_code = 'body_weight' and record.unit_code = 'kg'
  order by record.measured_on desc, record.id desc
  limit 1;
  if weight is null then
    return null;
  end if;

  targets := nutrition.reference_targets(chosen, weight);
  if targets is null then
    return null;
  end if;
  return jsonb_build_object('goal_code', chosen, 'targets', targets);
end
$function$;

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
  cover_object_key text,
  nutrition jsonb
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
         planning.cover_for(program.id, p_person_id),
         -- Allfit's programmes only: a copy the person keeps has no reference behind it.
         case when program.content_scope = 'global'
              then planning.program_nutrition(p_person_id, version.id) end
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
  'day''s routine cover, as keys, and for Allfit''s programmes the nutrition goal sized '
  'to the person. Composing the addresses is the surface''s job.';

alter function planning.read_program_version(uuid, uuid) owner to allfit_owner;
revoke all on function planning.read_program_version(uuid, uuid) from public;
grant execute on function planning.read_program_version(uuid, uuid) to allfit_api;

drop function planning.self_assign_program(uuid, uuid, text, uuid, uuid, bytea);

create function planning.self_assign_program(p_person_id uuid, p_program_version_id uuid, p_timezone text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea, p_adopt_nutrition boolean default false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  new_assignment_id uuid;
  starts date;
  first_week date;
  reachable boolean;
  is_global boolean;
  assigned_version_id uuid;
  open_ended boolean;
  front integer;
  goal jsonb;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'assignment person does not match the authenticated actor' using errcode = '42501';
  end if;

  begin
    starts := (clock_timestamp() at time zone p_timezone)::date;
  exception when others then
    raise exception 'invalid timezone' using errcode = '22023';
  end;
  first_week := date_trunc('week', starts::timestamp)::date;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-011', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return receipt.aggregate_id;
  end if;

  select exists (
    select 1
    from planning.program_versions as version
    join planning.programs as program on program.id = version.program_id
    where version.id = p_program_version_id
      and version.status = 'published'
      and (
        program.content_scope = 'global' and program.status = 'published'
        or program.owner_person_id = p_person_id
      )
  ),
  exists (
    select 1
    from planning.program_versions as version
    join planning.programs as program on program.id = version.program_id
    where version.id = p_program_version_id and program.content_scope = 'global'
  )
  into reachable, is_global;
  if not reachable then
    raise exception 'program version is not available to this person' using errcode = '42501';
  end if;

  -- Sized and read before the copy, while the version is still Allfit's: the copy is
  -- the person's own and carries no reference.
  if p_adopt_nutrition and is_global then
    goal := planning.program_nutrition(p_person_id, p_program_version_id);
  end if;

  -- Taking Allfit's program is keeping it. The copy is what makes it editable
  -- later; immutability alone only makes it stable.
  assigned_version_id := case
    when is_global then planning.fork_program_version(p_person_id, p_program_version_id)
    else p_program_version_id
  end;

  select version.repeats_forever into open_ended
  from planning.program_versions as version where version.id = assigned_version_id;

  -- In front of everything, so the tab opens on what was just taken.
  select coalesce(min(assignment.display_order), 1) - 1 into front
  from planning.program_assignments as assignment
  where assignment.person_id = p_person_id;

  insert into planning.program_assignments (
    person_id, program_version_id, lifecycle, starts_on, timezone, display_order
  ) values (p_person_id, assigned_version_id, 'personal', starts, p_timezone, front)
  returning id into new_assignment_id;

  -- Week N of the program is calendar week N, counted from the one that contains
  -- today. The day inside the week is a suggestion, so it is only ever used to
  -- order the list — never to decide what can be trained.
  --
  -- Sin fin, sólo la semana de composición que le toca a esta semana de calendario, que
  -- al asignar es siempre la primera. Lo demás lo siembra la lectura cuando llegue.
  insert into planning.planned_sessions (
    assignment_id, person_id, template_version_id, program_day, week_starts_on, scheduled_at, timezone
  )
  select new_assignment_id, p_person_id, composition.template_version_id,
         composition.day,
         first_week + ((composition.week - 1) * 7),
         greatest(
           (first_week + ((composition.week - 1) * 7) + composition.day - 1)::timestamp,
           starts::timestamp
         ) at time zone p_timezone,
         p_timezone
  from planning.program_version_sessions as composition
  where composition.program_version_id = assigned_version_id
    and (not coalesce(open_ended, false) or composition.week = 1);

  -- Adopting is the person publishing their own goal (OP-NUT-007), through nutrition's
  -- public function: planning writes none of its tables. Same command, same receipt.
  if goal is not null then
    perform nutrition.publish_self_goal_version(
      p_person_id,
      'Meta del programa ' || (select version.title from planning.program_versions as version
                               where version.id = p_program_version_id),
      goal->'targets', p_idempotency_key, p_command_id, p_request_hash);
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-assignment-created',
    'program_assignment', new_assignment_id
  );
  return new_assignment_id;
end
$function$;

alter function planning.self_assign_program(uuid, uuid, text, uuid, uuid, bytea, boolean) owner to allfit_owner;
revoke all on function planning.self_assign_program(uuid, uuid, text, uuid, uuid, bytea, boolean) from public;
grant execute on function planning.self_assign_program(uuid, uuid, text, uuid, uuid, bytea, boolean) to allfit_api;

alter function nutrition.reference_targets(text, numeric) owner to allfit_owner;
revoke all on function nutrition.reference_targets(text, numeric) from public;
alter function planning.program_nutrition(uuid, uuid) owner to allfit_owner;
revoke all on function planning.program_nutrition(uuid, uuid) from public;
