-- DT-018 and HU-SP-084..088 — what the free plan keeps of one's own programmes and
-- routines, and duplicating a routine.
--
-- `active_personal_programs` counts the programmes a person took for themself; a gym's
-- never count. `own_routines` counts the routines the person made, not the copies a
-- programme brings when it is taken: those are Allfit's work, held so the person can
-- edit them. `full_program_catalogue` and any other function a programme names gate
-- taking it, and the catalogue says which programmes are locked. Reaching a limit never
-- removes anything: whoever drops to the free plan keeps every routine and programme.
--
-- Duplicating a routine (OP-PLN-036) copies one's own routine into a new draft, as
-- `duplicate_my_program` does for programmes, and needs `routine_duplication`.
--
-- Bodies are the ones in force (20261020120000, 20260913182100 and 20260921160000) with
-- the limits added.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Routines the person made: not archived, and not copied from someone else's version.
create or replace function planning.count_own_routines(p_person_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select count(*)::integer
  from planning.session_templates as template
  where template.owner_person_id = p_person_id
    and template.content_scope = 'person'
    and template.status <> 'archived'
    and not exists (
      select 1
      from planning.session_template_versions as version
      join planning.session_template_versions as source on source.id = version.derived_from_version_id
      join planning.session_templates as origin on origin.id = source.template_id
      where version.template_id = template.id
        and origin.owner_person_id is distinct from p_person_id
    )
$function$;

alter function planning.count_own_routines(uuid) owner to allfit_owner;
revoke all on function planning.count_own_routines(uuid) from public, allfit_api;

CREATE OR REPLACE FUNCTION planning.self_assign_program(p_person_id uuid, p_program_version_id uuid, p_timezone text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea, p_adopt_nutrition boolean DEFAULT false)
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
  unlock text;
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

  -- Allfit's programme names the function that opens it; the free selection names none.
  select program.unlock_feature_code into unlock
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id;
  if unlock is not null then
    perform payments.require_feature(p_person_id, unlock);
  end if;
  -- A gym's programmes never count: only what the person took for themself.
  perform payments.require_below_limit(p_person_id, 'active_personal_programs', (
    select count(*)::integer from planning.program_assignments as assignment
    where assignment.person_id = p_person_id
      and assignment.lifecycle = 'personal'
      and assignment.origin_relationship_id is null));

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

CREATE OR REPLACE FUNCTION planning.create_my_session_template(p_person_id uuid, p_discipline_code text, p_title text, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(template jsonb, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  new_template_id uuid;
  activity_type_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-001', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_template_projection(receipt.aggregate_id), true;
    return;
  end if;

  perform payments.require_below_limit(p_person_id, 'own_routines',
    planning.count_own_routines(p_person_id));

  if btrim(p_title) = '' or char_length(p_title) > 160 then
    raise exception 'invalid session template title' using errcode = '22023';
  end if;
  if not exists (
    select 1 from catalog.disciplines
    where code = p_discipline_code and status = 'published'
  ) then
    raise exception 'unknown discipline' using errcode = '22023';
  end if;

  insert into planning.session_templates (
    content_scope, owner_person_id, author_person_id, discipline_code
  ) values ('person', p_person_id, p_person_id, p_discipline_code)
  returning id into new_template_id;

  -- A discipline with one published activity type poses no question, and `V-H` asks
  -- none. Left null the routine would be unpublishable for a reason no screen shows.
  select activity.id into activity_type_id
  from catalog.activity_types as activity
  where activity.discipline_code = p_discipline_code
    and activity.content_scope = 'global'
    and activity.status = 'published';

  insert into planning.session_template_drafts (template_id, content)
  values (new_template_id, jsonb_build_object(
    'title', btrim(p_title),
    'activity_type_id', activity_type_id,
    'steps', jsonb_build_array()
  ));

  perform system.enqueue_outbox_event(
    'session_template', new_template_id, 'planning.session_template_created.v1',
    jsonb_build_object('template_id', new_template_id, 'person_id', p_person_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'session-template-created', 'session_template', new_template_id
  );
  return query select planning.session_template_projection(new_template_id), false;
end
$function$;

-- The catalogue gains two columns, so it is dropped and created again.
drop function planning.read_program_catalogue(uuid);

CREATE FUNCTION planning.read_program_catalogue(p_person_id uuid)
 RETURNS TABLE(program_version_id uuid, program_id uuid, title text, weeks integer, days_per_week integer, sex_affinity text, goals text[], levels text[], emphases text[], cover_object_key text, locked boolean, unlock_feature text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select version.id,
         program.id,
         version.title,
         case when version.repeats_forever then null else composition.weeks end,
         composition.days_per_week,
         version.sex_affinity::text,
         coalesce(goals.codes, array[]::text[]),
         coalesce(levels.codes, array[]::text[]),
         coalesce(emphases.codes, array[]::text[]),
         -- La del juego de quien pregunta, y nunca la clave de otra persona: `cover_for`
         -- sólo contesta cuando el actor de la sesión es quien se nombra aquí.
         planning.cover_for(program.id, p_person_id),
         -- Locked is what this person's plan does not open; the function says which.
         coalesce(not feature.enabled, false),
         program.unlock_feature_code
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day)::integer as days_per_week,
           count(*)::integer as sessions
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
  left join lateral payments.feature_for(p_person_id, program.unlock_feature_code) as feature
    on program.unlock_feature_code is not null
  where program.content_scope = 'global'
    and program.status = 'published'
    and version.status = 'published'
    and composition.sessions > 0
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by version.title, version.id
$function$;

CREATE OR REPLACE FUNCTION planning.duplicate_my_session_template(p_person_id uuid, p_template_id uuid, p_idempotency_key uuid, p_command_id uuid, p_request_hash bytea)
 RETURNS TABLE(template jsonb, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  receipt record;
  origin planning.session_templates%rowtype;
  source jsonb;
  copy_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-036', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_template_projection(receipt.aggregate_id), true;
    return;
  end if;

  select * into origin
  from planning.session_templates as owned
  where owned.id = p_template_id and owned.owner_person_id = p_person_id
    and owned.status <> 'archived';
  if origin.id is null then raise exception 'routine not found' using errcode = 'P0002'; end if;

  perform payments.require_feature(p_person_id, 'routine_duplication');
  perform payments.require_below_limit(p_person_id, 'own_routines',
    planning.count_own_routines(p_person_id));

  -- What is being edited is what the person sees, so the draft goes first.
  select draft.content into source
  from planning.session_template_drafts as draft
  where draft.template_id = p_template_id;
  if source is null then
    select planning.canonical_session_content(planning.session_version_projection(latest.id))
    into source
    from planning.session_template_versions as latest
    where latest.template_id = p_template_id
    order by latest.version_number desc
    limit 1;
  end if;
  if source is null then
    raise exception 'routine has nothing to copy' using errcode = '23514';
  end if;

  insert into planning.session_templates (
    content_scope, owner_person_id, author_person_id, discipline_code
  ) values ('person', p_person_id, p_person_id, origin.discipline_code)
  returning id into copy_id;

  -- The suffix fits inside the 160 characters a title allows.
  insert into planning.session_template_drafts (template_id, content)
  values (copy_id, source || jsonb_build_object(
    'title', left(btrim(source->>'title'), 152) || ' - Copia'));

  perform system.enqueue_outbox_event(
    'session_template', copy_id, 'planning.session_template_created.v1',
    jsonb_build_object('template_id', copy_id, 'person_id', p_person_id,
                       'duplicated_from_template_id', p_template_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'session-template-duplicated', 'session_template', copy_id
  );
  return query select planning.session_template_projection(copy_id), false;
end
$function$;

alter function planning.duplicate_my_session_template(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.duplicate_my_session_template(uuid, uuid, uuid, uuid, bytea) from public;
grant execute on function planning.duplicate_my_session_template(uuid, uuid, uuid, uuid, bytea) to allfit_api;

alter function planning.read_program_catalogue(uuid) owner to allfit_owner;
revoke all on function planning.read_program_catalogue(uuid) from public;
grant execute on function planning.read_program_catalogue(uuid) to allfit_api;
