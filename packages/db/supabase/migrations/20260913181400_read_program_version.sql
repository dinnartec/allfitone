-- The whole content of a published program, before anybody commits to it.
--
-- `OP-PLN-021` already gives Space a way to read a version **it was assigned**. What
-- was missing is reading one to decide: somebody about to hand eight weeks of their
-- life to a program deserves to see every session in it first, and "8 semanas · 3
-- días" is a summary, not the content.
--
-- Same access rule as `OP-PLN-011`, and for the same reason: a version reachable to
-- assign is a version reachable to read. Global published content, or the person's
-- own. Nothing else.
--
-- **One entry per distinct day of the first week, not per session.** A twelve-week
-- program composes sixty rows out of five templates, and showing sixty would be
-- showing the calendar rather than the split. The split is what the person is
-- choosing.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

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
  days jsonb
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select version.id,
         version.title,
         version.notes,
         composition.weeks,
         composition.days_per_week,
         version.sex_affinity::text,
         coalesce(goals.codes, array[]::text[]),
         coalesce(levels.codes, array[]::text[]),
         coalesce(emphases.codes, array[]::text[]),
         coalesce(split.days, '[]'::jsonb)
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

alter function planning.read_program_version(uuid, uuid) owner to allfit_owner;
revoke all on function planning.read_program_version(uuid, uuid) from public;
grant execute on function planning.read_program_version(uuid, uuid) to allfit_api;

commit;
