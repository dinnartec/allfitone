-- Una sesión recuerda qué día del programa es — `OP-PLN-011`, `OP-PLN-019`.
--
-- La materialización adelanta las sesiones de la primera semana que caerían antes del
-- día de la asignación: tomar un programa un jueves no debe estrenarlo con la sesión del
-- lunes ya perdida. Eso está bien y se queda.
--
-- Lo que faltaba es que la sesión recordara **de qué ranura salió**. Sin ello la pantalla
-- sólo tiene `scheduled_at`, lee «jueves» de una sesión que el programa puso en lunes, y
-- contradice al programa que la persona armó con sus manos.
--
-- Va de 1 a 7 como `program_version_sessions.day`. El relleno de lo ya materializado sale
-- de la propia composición cuando la pareja semana/plantilla es inequívoca; cuando una
-- rutina se repite en la misma semana no lo es, y esas filas se quedan con el día que su
-- fecha ya dice, que es lo único cierto que se puede afirmar de ellas.

set statement_timeout = '60s';

begin;

set lock_timeout = '5s';

alter table planning.planned_sessions add column program_day smallint;

update planning.planned_sessions as session
set program_day = deduced.day
from (
  select session.id, min(composition.day) as day
  from planning.planned_sessions as session
  join planning.program_assignments as assignment on assignment.id = session.assignment_id
  join planning.program_version_sessions as composition
    on composition.program_version_id = assignment.program_version_id
   and composition.template_version_id = session.template_version_id
   and composition.week = ((session.week_starts_on
         - date_trunc('week', assignment.starts_on::timestamp)::date) / 7) + 1
  group by session.id
  having count(distinct composition.day) = 1
) as deduced
where session.id = deduced.id;

update planning.planned_sessions
set program_day = extract(isodow from (scheduled_at at time zone timezone))::smallint
where program_day is null;

alter table planning.planned_sessions
  alter column program_day set not null,
  add constraint ck_planned_sessions_program_day check (program_day between 1 and 7);

create or replace function planning.self_assign_program(p_person_id uuid, p_program_version_id uuid, p_timezone text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  new_assignment_id uuid;
  starts date;
  first_week date;
  reachable boolean;
  is_global boolean;
  assigned_version_id uuid;
  front integer;
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

  -- Taking Allfit's program is keeping it. The copy is what makes it editable
  -- later; immutability alone only makes it stable.
  assigned_version_id := case
    when is_global then planning.fork_program_version(p_person_id, p_program_version_id)
    else p_program_version_id
  end;

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
  where composition.program_version_id = assigned_version_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-assignment-created',
    'program_assignment', new_assignment_id
  );
  return new_assignment_id;
end
$function$;

create or replace function planning.restate_my_program_assignment(p_person_id uuid, p_program_version_id uuid, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  target_program_id uuid;
  assignment record;
  first_week date;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-027', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then return receipt.aggregate_id; end if;

  select version.program_id into target_program_id
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id and program.owner_person_id = p_person_id;
  if target_program_id is null then
    raise exception 'program version is not available to this person' using errcode = '42501';
  end if;

  -- The assignment for any version of this programme, newest first. Publishing is not
  -- starting: somebody who wrote a programme and never took it has nothing to restate.
  select existing.* into assignment
  from planning.program_assignments as existing
  join planning.program_versions as version on version.id = existing.program_version_id
  where existing.person_id = p_person_id and version.program_id = target_program_id
  order by existing.display_order, existing.assigned_at desc
  limit 1
  for update of existing;

  -- Null says "nothing was following this", which is how publishing knows to take the
  -- programme instead. The receipt names no aggregate: there is none, and
  -- `ck_idempotency_keys_aggregate_pair` requires the type and the id to agree.
  if assignment.id is null then
    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'program-assignment-unchanged', null, null
    );
    return null;
  end if;

  update planning.program_assignments
  set program_version_id = p_program_version_id
  where id = assignment.id;

  -- Only what has not been trained. A completed session is somebody's record of a
  -- morning, and the foreign key from its execution refuses the delete anyway.
  delete from planning.planned_sessions as stale
  where stale.assignment_id = assignment.id
    and stale.status <> 'completed'
    and not exists (
      select 1 from execution.planned_session_executions as attempt
      where attempt.planned_session_id = stale.id
    );

  -- Week N of the programme is calendar week N counted from where the assignment
  -- started, which is what keeps the week number from moving under somebody mid-week.
  first_week := date_trunc('week', assignment.starts_on::timestamp)::date;

  insert into planning.planned_sessions (
    assignment_id, person_id, template_version_id, program_day, week_starts_on, scheduled_at, timezone
  )
  select assignment.id, p_person_id, composition.template_version_id,
         composition.day,
         first_week + ((composition.week - 1) * 7),
         greatest(
           (first_week + ((composition.week - 1) * 7) + composition.day - 1)::timestamp,
           assignment.starts_on::timestamp
         ) at time zone assignment.timezone,
         assignment.timezone
  from (
    select composed.*,
           row_number() over (partition by composed.week order by composed.day) as slot
    from planning.program_version_sessions as composed
    where composed.program_version_id = p_program_version_id
  ) as composition
  -- How many the week still needs, counted rather than matched by day.
  --
  -- Which day of the base week a planned session came from cannot be recovered: the
  -- table does not store it, and `greatest(..., starts_on)` collapses every day before
  -- the start onto the same date, so three days of week one can share one. What the
  -- domain says is that the day is a suggestion and the week is the unit, so a week
  -- keeps as many sessions as the new version asks for and the trained ones count
  -- towards that. Protecting the whole week instead froze somebody at one of one when
  -- they added a second day.
  where composition.slot > coalesce((
    select count(*) from planning.planned_sessions as kept
    where kept.assignment_id = assignment.id
      and kept.week_starts_on = first_week + ((composition.week - 1) * 7)
      and kept.status = 'completed'
  ), 0);

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'program-assignment-restated',
    'program_assignment', assignment.id
  );
  return assignment.id;
end
$function$;

create or replace function planning.read_week_plan(p_person_id uuid, p_timezone text)
returns TABLE(assignment_id uuid, program_version_id uuid, program_title text, program_week integer, week_starts_on date, sessions jsonb)
language sql
security definer
set search_path = pg_catalog
as $function$
  select assignment.id,
         version.id,
         version.title,
         (((clock_timestamp() at time zone p_timezone)::date
           - date_trunc('week', assignment.starts_on::timestamp)::date) / 7 + 1)::integer,
         date_trunc('week', (clock_timestamp() at time zone p_timezone))::date,
         coalesce(week.entries, '[]'::jsonb)
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  left join lateral (
    select jsonb_agg(to_jsonb(entry) order by entry.scheduled_at) as entries
    from (
      select session.id as planned_session_id,
             template_version.title as title,
             template_version.discipline_code,
             session.status,
             session.program_day,
             session.scheduled_at,
             (select count(*)::integer from planning.planned_steps as step
               where step.template_version_id = session.template_version_id) as exercise_count,
             (select coalesce(sum(target.target_sets), 0)::integer
               from planning.planned_steps as step
               join planning.strength_targets as target on target.planned_step_id = step.id
               where step.template_version_id = session.template_version_id) as set_count,
             exists (
               select 1 from execution.planned_session_executions as attempt
               join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
               where attempt.planned_session_id = session.id
                 and executed.execution_status = 'completed'
             ) as done,
             (
               select attempt.executed_session_id
               from execution.planned_session_executions as attempt
               join execution.executed_sessions as executed on executed.id = attempt.executed_session_id
               where attempt.planned_session_id = session.id
                 and executed.execution_status = 'in_progress'
               order by attempt.attempt_number desc
               limit 1
             ) as open_execution_id
      from planning.planned_sessions as session
      join planning.session_template_versions as template_version
        on template_version.id = session.template_version_id
      where session.assignment_id = assignment.id
        and session.week_starts_on
            = date_trunc('week', (clock_timestamp() at time zone p_timezone))::date
    ) as entry
  ) as week on true
  where assignment.person_id = p_person_id
    and assignment.lifecycle = 'personal'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.display_order, assignment.assigned_at desc
  limit 1
$function$;

commit;
