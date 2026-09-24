-- Choosing a program has to leave sessions on a calendar, or it is an intention and
-- not a plan.
--
-- `planning.program_assignments` and `planning.planned_sessions` were specified in
-- §9.13 and §9.16 of the data dictionary and had never been built, so `OP-PLN-011`
-- had a surface in the operations matrix, no table under it and no route above it.
--
-- **Narrowed, never loosened**, the same criterion `body_progress` used. Only the
-- personal assignment exists: `relationships.service_relationships` does not, so
-- there is no relationship to originate from, nothing to manage, and
-- `assignment_management_periods` does not enter. `origin_relationship_id` is created
-- because the carrier key and the composite foreign key of §9.13 are built around it,
-- and it is checked null so nothing can quietly put a value there that no table
-- vouches for. RLS is `is_self` only; the coach's half depends on a grant that does
-- not exist yet.
--
-- The calendar is materialised at assignment time rather than derived on read. That
-- is what §9.16 asks for and it is what lets a session be rescheduled later without
-- rewriting the program: the plan is a fact, not a projection.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

create type planning.assignment_lifecycle as enum (
  'active', 'detached_pending_choice', 'personal', 'ended'
);

create table planning.program_assignments (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  program_version_id uuid not null,
  -- No foreign key: `relationships.service_relationships` does not exist yet, and a
  -- column pointing at nothing is worse than a column checked empty.
  origin_relationship_id uuid,
  lifecycle planning.assignment_lifecycle not null,
  starts_on date not null,
  timezone text not null,
  assigned_at timestamptz not null default clock_timestamp(),
  constraint pk_program_assignments primary key (id),
  -- The carrier key of §9.13: every child row carries the person, so no join can
  -- silently cross people.
  constraint uq_program_assignments_person unique (id, person_id),
  constraint fk_program_assignments_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_program_assignments_version foreign key (program_version_id) references planning.program_versions(id) on delete restrict,
  constraint ck_program_assignments_personal_only check (lifecycle = 'personal'),
  constraint ck_program_assignments_no_origin check (origin_relationship_id is null),
  constraint ck_program_assignments_timezone check (btrim(timezone) <> '')
);

create table planning.planned_sessions (
  id uuid not null default extensions.uuid_generate_v7(),
  assignment_id uuid not null,
  person_id uuid not null,
  template_version_id uuid not null,
  scheduled_at timestamptz not null,
  timezone text not null,
  status text not null default 'scheduled',
  constraint pk_planned_sessions primary key (id),
  constraint fk_planned_sessions_assignment foreign key (assignment_id, person_id) references planning.program_assignments(id, person_id) on delete cascade,
  constraint fk_planned_sessions_template_version foreign key (template_version_id) references planning.session_template_versions(id) on delete restrict,
  constraint ck_planned_sessions_status check (
    status in ('scheduled', 'paused', 'cancelled', 'completed')
  ),
  constraint ck_planned_sessions_timezone check (btrim(timezone) <> '')
);

create index idx_program_assignments_person_lifecycle
  on planning.program_assignments (person_id, lifecycle);
create index idx_planned_sessions_assignment_schedule
  on planning.planned_sessions (assignment_id, scheduled_at);
create index idx_planned_sessions_person_schedule
  on planning.planned_sessions (person_id, scheduled_at);

alter table planning.program_assignments enable row level security;
alter table planning.program_assignments force row level security;
alter table planning.planned_sessions enable row level security;
alter table planning.planned_sessions force row level security;

create policy program_assignments_all_self on planning.program_assignments
  for all to allfit_owner
  using (person_id = access_control.person())
  with check (person_id = access_control.person());

create policy planned_sessions_all_self on planning.planned_sessions
  for all to allfit_owner
  using (person_id = access_control.person())
  with check (person_id = access_control.person());

alter table planning.program_assignments owner to allfit_owner;
alter table planning.planned_sessions owner to allfit_owner;
revoke all on planning.program_assignments from public;
revoke all on planning.planned_sessions from public;

commit;

-- `OP-PLN-011`. The one command behind the screen.
--
-- `starts_on` is computed here and not sent: it is always today in the person's own
-- zone, and taking it from the client would let a plan be backdated into a history
-- that never happened.
--
-- No domain event is emitted. `planning.assignment_created.v1` is named in §9.13 and
-- has no consumer, exactly as in every Space slice built so far.
begin;

create function planning.self_assign_program(
  p_person_id uuid,
  p_program_version_id uuid,
  p_timezone text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  new_assignment_id uuid;
  starts date;
  reachable boolean;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'assignment person does not match the authenticated actor' using errcode = '42501';
  end if;

  -- The only validation the zone needs, and it has to happen before anything is
  -- written: the whole calendar is expressed in it.
  begin
    starts := (clock_timestamp() at time zone p_timezone)::date;
  exception when others then
    raise exception 'invalid timezone' using errcode = '22023';
  end;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-011', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return receipt.aggregate_id;
  end if;

  -- What `OP-PLN-011` calls "propia o global". Read under the caller's own row
  -- security, so a version they cannot see is a version they cannot assign.
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
  ) into reachable;
  if not reachable then
    raise exception 'program version is not available to this person' using errcode = '42501';
  end if;

  insert into planning.program_assignments (
    person_id, program_version_id, lifecycle, starts_on, timezone
  ) values (p_person_id, p_program_version_id, 'personal', starts, p_timezone)
  returning id into new_assignment_id;

  -- Week one day one is the day they chose, so the first session is today rather
  -- than on some next Monday they did not ask for.
  insert into planning.planned_sessions (
    assignment_id, person_id, template_version_id, scheduled_at, timezone
  )
  select new_assignment_id, p_person_id, composition.template_version_id,
         (starts + ((composition.week - 1) * 7 + composition.day - 1))::timestamp
           at time zone p_timezone,
         p_timezone
  from planning.program_version_sessions as composition
  where composition.program_version_id = p_program_version_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'program-assignment-created',
    'program_assignment', new_assignment_id
  );
  return new_assignment_id;
end
$function$;

alter function planning.self_assign_program(uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.self_assign_program(uuid, uuid, text, uuid, uuid, bytea) from public;
grant execute on function planning.self_assign_program(uuid, uuid, text, uuid, uuid, bytea) to allfit_api;

-- The catalogue as the screen needs it.
--
-- Days per week and duration are **derived** here rather than stored: they are facts
-- about the composition, and a stored copy would be a second truth about the number
-- the whole screen is chosen on.
create function planning.read_program_catalogue(p_person_id uuid)
returns table (
  program_version_id uuid,
  program_id uuid,
  title text,
  weeks integer,
  days_per_week integer,
  sex_affinity text,
  goals text[],
  levels text[],
  emphases text[]
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select version.id,
         program.id,
         version.title,
         composition.weeks,
         composition.days_per_week,
         version.sex_affinity::text,
         coalesce(goals.codes, array[]::text[]),
         coalesce(levels.codes, array[]::text[]),
         coalesce(emphases.codes, array[]::text[])
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  join lateral (
    select max(session.week) as weeks,
           count(distinct session.day)::integer as days_per_week
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
  where program.content_scope = 'global'
    and program.status = 'published'
    and version.status = 'published'
    and composition.weeks is not null
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by version.title, version.id
$function$;

alter function planning.read_program_catalogue(uuid) owner to allfit_owner;
revoke all on function planning.read_program_catalogue(uuid) from public;
grant execute on function planning.read_program_catalogue(uuid) to allfit_api;

-- What the person already chose, which is what decides whether the screen appears.
create function planning.read_current_assignment(p_person_id uuid)
returns table (
  assignment_id uuid,
  program_version_id uuid,
  title text,
  starts_on date,
  timezone text,
  sessions_planned integer
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select assignment.id,
         assignment.program_version_id,
         version.title,
         assignment.starts_on,
         assignment.timezone,
         (select count(*)::integer
            from planning.planned_sessions as session
           where session.assignment_id = assignment.id)
  from planning.program_assignments as assignment
  join planning.program_versions as version on version.id = assignment.program_version_id
  where assignment.person_id = p_person_id
    and assignment.lifecycle <> 'ended'
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
  order by assignment.assigned_at desc, assignment.id desc
  limit 1
$function$;

alter function planning.read_current_assignment(uuid) owner to allfit_owner;
revoke all on function planning.read_current_assignment(uuid) from public;
grant execute on function planning.read_current_assignment(uuid) to allfit_api;

commit;
