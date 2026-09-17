-- OP-EXE-004, OP-EXE-005, OP-EXE-006, OP-EXE-014, OP-EXE-015 and OP-SUP-003 over a person's
-- own free sessions (`HU-SP-052`, `HU-SP-055`, `HU-SP-056`, `HU-SP-057`, `HU-BO-008`).
--
-- **A free session is the person's.** It belongs to no relationship, no organization and no
-- plan: relationships do not exist yet, so the table refuses any other context for now. It
-- freezes the published default result contract of its activity type and that contract's
-- version when it starts, and a later contract never changes its history.
--
-- **Results are replaced, never edited.** The device sends the whole working set under the
-- revision it last saw; a stale revision is refused with AF409 (409 stale-draft). Strength
-- sets and endurance laps are the two families built here, and each only in a segment of its
-- own family. Loads are stored in kilograms and distances in metres, with what the person
-- typed kept beside them. A value that was not captured stays NULL, never zero.
--
-- **Finishing does not certify.** ADR-013, which defines how a contract's minimums are
-- written, is still under review, and the published contracts carry no rule anyone could
-- evaluate. So a finished session is `completed` with validation `pending` and no achieved
-- level; nothing pretends to have checked what no rule describes. Intervals, rounds, mobility,
-- samples, corrections, annulment, pauses and planned attempts are not built here.
--
-- **Support reads it only through a standard window for prior training history**, which
-- covers autonomous sessions. Training within a relationship stays unavailable.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists execution authorization allfit_owner;
grant usage on schema execution to allfit_api;

insert into catalog.units (code, dimension, is_canonical, to_canonical_factor)
values
  ('km', 'length', false, 1000),
  ('mi', 'length', false, 1609.344);

create type catalog.completeness_level as enum ('partial', 'summary', 'detailed', 'sensor_enriched');
create type execution.execution_status as enum ('in_progress', 'paused', 'completed', 'abandoned');
create type execution.validation_status as enum ('pending', 'valid', 'invalid', 'annulled');

-- The family of an activity type is the family of its current default published contract.
create or replace function execution.activity_family(p_activity_type_id uuid)
returns catalog.activity_family
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select contract.activity_family
  from catalog.activity_type_result_contracts as link
  join catalog.result_contracts as contract on contract.id = link.result_contract_id
  where link.activity_type_id = p_activity_type_id
    and link.is_default
    and link.valid_to is null
    and contract.status = 'published'
$function$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create table execution.executed_sessions (
  id uuid not null,
  person_id uuid not null,
  activity_type_id uuid not null,
  result_contract_id uuid not null,
  contract_version integer not null,
  context_relationship_id uuid,
  context_organization_id uuid,
  is_autonomous boolean not null default true,
  started_at timestamptz not null,
  ended_at timestamptz,
  timezone text not null,
  execution_status execution.execution_status not null default 'in_progress',
  validation_status execution.validation_status not null default 'pending',
  revision_number bigint not null default 0,
  requested_level catalog.completeness_level not null,
  achieved_level catalog.completeness_level,
  capture_source text not null,
  capture_provenance identity.provenance not null,
  annulled_at timestamptz,
  annulment_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_executed_sessions primary key (id),
  constraint uq_executed_sessions_person unique (id, person_id),
  constraint fk_executed_sessions_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_executed_sessions_activity_type foreign key (activity_type_id) references catalog.activity_types(id) on delete restrict,
  constraint fk_executed_sessions_result_contract foreign key (result_contract_id) references catalog.result_contracts(id) on delete restrict,
  constraint ck_executed_sessions_revision check (revision_number >= 0),
  constraint ck_executed_sessions_ended check (ended_at is null or ended_at >= started_at),
  -- IX-14 needs relationships; until they exist a session is the person's own and nothing else.
  constraint ck_executed_sessions_context check (
    is_autonomous and context_relationship_id is null and context_organization_id is null
  ),
  constraint ck_executed_sessions_capture check (capture_source in ('manual', 'device')),
  constraint ck_executed_sessions_timezone check (char_length(timezone) between 3 and 100),
  constraint ck_executed_sessions_completed check (
    (execution_status = 'completed') <= (ended_at is not null)
  ),
  constraint ck_executed_sessions_annulment check (
    (annulled_at is null) = (annulment_reason is null)
  )
);

create index idx_executed_sessions_person
  on execution.executed_sessions (person_id, started_at desc, id desc);
create index idx_executed_sessions_activity_type on execution.executed_sessions (activity_type_id);
create index idx_executed_sessions_result_contract
  on execution.executed_sessions (result_contract_id);

create or replace function execution.executed_session_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from catalog.result_contracts as contract
      where contract.id = new.result_contract_id
        and contract.version_number = new.contract_version
    ) then
      raise exception 'a session freezes the version its contract has' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.person_id is distinct from old.person_id
     or new.activity_type_id is distinct from old.activity_type_id
     or new.result_contract_id is distinct from old.result_contract_id
     or new.contract_version is distinct from old.contract_version
     or new.is_autonomous is distinct from old.is_autonomous
     or new.started_at is distinct from old.started_at
     or new.timezone is distinct from old.timezone
     or new.requested_level is distinct from old.requested_level
     or new.capture_source is distinct from old.capture_source
     or new.capture_provenance is distinct from old.capture_provenance
     or new.created_at is distinct from old.created_at then
    raise exception 'a session keeps what it is and when it started' using errcode = '55000';
  end if;
  if new.revision_number < old.revision_number then
    raise exception 'a session revision never goes back' using errcode = '55000';
  end if;
  if old.execution_status in ('completed', 'abandoned')
     and new.execution_status is distinct from old.execution_status then
    raise exception 'a finished session stays finished' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_executed_sessions_guard
before insert or update on execution.executed_sessions
for each row execute function execution.executed_session_guard_tg();

create table execution.session_segments (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  position integer not null,
  activity_type_id uuid,
  planned_step_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_session_segments primary key (id),
  constraint uq_session_segments_carrier unique (id, executed_session_id),
  constraint uq_session_segments_position unique (executed_session_id, position),
  constraint fk_session_segments_session foreign key (executed_session_id) references execution.executed_sessions(id) on delete cascade,
  constraint fk_session_segments_activity_type foreign key (activity_type_id) references catalog.activity_types(id) on delete restrict,
  constraint fk_session_segments_planned_step foreign key (planned_step_id) references planning.planned_steps(id) on delete restrict,
  constraint ck_session_segments_position check (position between 1 and 100)
);

create index idx_session_segments_activity_type on execution.session_segments (activity_type_id);
create index idx_session_segments_planned_step on execution.session_segments (planned_step_id);

create table execution.strength_sets (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  session_segment_id uuid,
  movement_id uuid,
  planned_step_id uuid,
  set_order integer not null,
  achieved_reps integer,
  load_value numeric(12, 3),
  load_unit_code text,
  original_load_value numeric(12, 3),
  original_load_unit_code text,
  rpe numeric(4, 2),
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_strength_sets primary key (id),
  constraint uq_strength_sets_order unique (executed_session_id, set_order),
  constraint fk_strength_sets_session foreign key (executed_session_id) references execution.executed_sessions(id) on delete cascade,
  constraint fk_strength_sets_segment foreign key (session_segment_id, executed_session_id) references execution.session_segments(id, executed_session_id) on delete restrict,
  constraint fk_strength_sets_movement foreign key (movement_id) references catalog.movements(id) on delete restrict,
  constraint fk_strength_sets_planned_step foreign key (planned_step_id) references planning.planned_steps(id) on delete restrict,
  constraint fk_strength_sets_load_unit foreign key (load_unit_code) references catalog.units(code) on delete restrict,
  constraint fk_strength_sets_original_load_unit foreign key (original_load_unit_code) references catalog.units(code) on delete restrict,
  constraint ck_strength_sets_order check (set_order between 1 and 1000),
  constraint ck_strength_sets_reps check (achieved_reps is null or achieved_reps >= 1),
  constraint ck_strength_sets_load check (
    (load_value is null) = (load_unit_code is null) and (load_value is null or load_value >= 0)
  ),
  constraint ck_strength_sets_original check (
    (original_load_value is null) = (original_load_unit_code is null)
    and (original_load_value is null or load_value is not null)
  ),
  constraint ck_strength_sets_rpe check (rpe is null or rpe between 0 and 10)
);

create index idx_strength_sets_segment on execution.strength_sets (session_segment_id, executed_session_id);
create index idx_strength_sets_movement on execution.strength_sets (movement_id);
create index idx_strength_sets_planned_step on execution.strength_sets (planned_step_id);
create index idx_strength_sets_load_unit on execution.strength_sets (load_unit_code);
create index idx_strength_sets_original_load_unit on execution.strength_sets (original_load_unit_code);

create table execution.endurance_laps (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  session_segment_id uuid,
  lap_number integer not null,
  distance_value numeric(12, 3) not null,
  distance_unit_code text not null,
  original_distance_value numeric(12, 3),
  original_distance_unit_code text,
  duration_seconds numeric(12, 3) not null,
  elevation_gain_value numeric(12, 3),
  elevation_gain_unit_code text,
  avg_heart_rate_bpm integer,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_endurance_laps primary key (id),
  constraint uq_endurance_laps_number unique (executed_session_id, lap_number),
  constraint fk_endurance_laps_session foreign key (executed_session_id) references execution.executed_sessions(id) on delete cascade,
  constraint fk_endurance_laps_segment foreign key (session_segment_id, executed_session_id) references execution.session_segments(id, executed_session_id) on delete restrict,
  constraint fk_endurance_laps_distance_unit foreign key (distance_unit_code) references catalog.units(code) on delete restrict,
  constraint fk_endurance_laps_original_distance_unit foreign key (original_distance_unit_code) references catalog.units(code) on delete restrict,
  constraint fk_endurance_laps_elevation_unit foreign key (elevation_gain_unit_code) references catalog.units(code) on delete restrict,
  constraint ck_endurance_laps_number check (lap_number between 1 and 1000),
  constraint ck_endurance_laps_distance check (distance_value > 0),
  constraint ck_endurance_laps_original check (
    (original_distance_value is null) = (original_distance_unit_code is null)
    and (original_distance_value is null or original_distance_value > 0)
  ),
  constraint ck_endurance_laps_duration check (duration_seconds > 0),
  constraint ck_endurance_laps_elevation check (
    (elevation_gain_value is null) = (elevation_gain_unit_code is null)
    and (elevation_gain_value is null or elevation_gain_value >= 0)
  ),
  constraint ck_endurance_laps_heart_rate check (avg_heart_rate_bpm is null or avg_heart_rate_bpm > 0)
);

create index idx_endurance_laps_segment on execution.endurance_laps (session_segment_id, executed_session_id);
create index idx_endurance_laps_distance_unit on execution.endurance_laps (distance_unit_code);
create index idx_endurance_laps_original_distance_unit
  on execution.endurance_laps (original_distance_unit_code);
create index idx_endurance_laps_elevation_unit on execution.endurance_laps (elevation_gain_unit_code);

-- IX-18 and HU-SP-055: canonical units, and each result only in a segment of its family.
create or replace function execution.result_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  family catalog.activity_family;
  expected catalog.activity_family;
begin
  if tg_op = 'UPDATE' then
    raise exception 'a recorded result is replaced, never edited in place' using errcode = '55000';
  end if;

  select execution.activity_family(segment.activity_type_id) into family
  from execution.session_segments as segment
  where segment.id = new.session_segment_id;

  if tg_table_name = 'strength_sets' then
    expected := 'strength';
    if new.load_unit_code is not null and new.load_unit_code <> 'kg' then
      raise exception 'a load is stored in kilograms' using errcode = '23514';
    end if;
    if new.original_load_unit_code is not null and new.original_load_unit_code not in ('kg', 'lb') then
      raise exception 'a load is a mass' using errcode = '23514';
    end if;
  else
    expected := 'endurance';
    if new.distance_unit_code <> 'm' then
      raise exception 'a distance is stored in metres' using errcode = '23514';
    end if;
    if new.original_distance_unit_code is not null
       and new.original_distance_unit_code not in ('m', 'km', 'mi') then
      raise exception 'a distance is a length' using errcode = '23514';
    end if;
  end if;

  if new.session_segment_id is not null and family is distinct from expected then
    raise exception 'a result belongs to a segment of its own family' using errcode = '23514';
  end if;
  return new;
end
$function$;

create trigger trg_strength_sets_guard
before insert or update on execution.strength_sets
for each row execute function execution.result_guard_tg();

create trigger trg_endurance_laps_guard
before insert or update on execution.endurance_laps
for each row execute function execution.result_guard_tg();

-- ---------------------------------------------------------------------------
-- What a session looks like outside its tables
-- ---------------------------------------------------------------------------

create or replace function execution.session_projection(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', session.id,
    'activity_type_code', activity.code,
    'activity_type_name', activity.name,
    'discipline_code', activity.discipline_code,
    'started_at', session.started_at,
    'ended_at', session.ended_at,
    'timezone', session.timezone,
    'status', session.execution_status,
    'validation_status', session.validation_status,
    'requested_level', session.requested_level,
    'achieved_level', session.achieved_level,
    'revision_number', session.revision_number,
    'capture_source', session.capture_source,
    'contract', jsonb_build_object(
      'id', session.result_contract_id, 'version', session.contract_version
    ),
    'segments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('position', segment.position, 'activity_type_code', kind.code)
          order by segment.position
        )
        from execution.session_segments as segment
        left join catalog.activity_types as kind on kind.id = segment.activity_type_id
        where segment.executed_session_id = session.id
      ),
      '[]'::jsonb
    ),
    'strength_sets', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'segment_position', segment.position,
            'order', result.set_order,
            'movement_id', result.movement_id,
            'movement_name', movement.name,
            'achieved_reps', result.achieved_reps,
            'load', case
              when result.original_load_value is not null then jsonb_build_object(
                'value', result.original_load_value, 'unit', result.original_load_unit_code
              )
              when result.load_value is not null then jsonb_build_object(
                'value', result.load_value, 'unit', result.load_unit_code
              )
            end,
            'rpe', result.rpe
          )
          order by result.set_order
        )
        from execution.strength_sets as result
        left join execution.session_segments as segment on segment.id = result.session_segment_id
        left join catalog.movements as movement on movement.id = result.movement_id
        where result.executed_session_id = session.id
      ),
      '[]'::jsonb
    ),
    'endurance_laps', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'segment_position', segment.position,
            'lap_number', lap.lap_number,
            'distance', jsonb_build_object(
              'value', coalesce(lap.original_distance_value, lap.distance_value),
              'unit', coalesce(lap.original_distance_unit_code, lap.distance_unit_code)
            ),
            'duration_seconds', lap.duration_seconds
          )
          order by lap.lap_number
        )
        from execution.endurance_laps as lap
        left join execution.session_segments as segment on segment.id = lap.session_segment_id
        where lap.executed_session_id = session.id
      ),
      '[]'::jsonb
    )
  )
  from execution.executed_sessions as session
  join catalog.activity_types as activity on activity.id = session.activity_type_id
  where session.id = p_session_id
$function$;

create or replace function execution.session_summary(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', session.id,
    'activity_type_code', activity.code,
    'activity_type_name', activity.name,
    'started_at', session.started_at,
    'ended_at', session.ended_at,
    'timezone', session.timezone,
    'status', session.execution_status,
    'validation_status', session.validation_status,
    'achieved_level', session.achieved_level,
    'revision_number', session.revision_number,
    'result_count',
      (select count(*) from execution.strength_sets as result
       where result.executed_session_id = session.id)
      + (select count(*) from execution.endurance_laps as lap
         where lap.executed_session_id = session.id)
  )
  from execution.executed_sessions as session
  join catalog.activity_types as activity on activity.id = session.activity_type_id
  where session.id = p_session_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-EXE-004 — start a free session
-- ---------------------------------------------------------------------------

create or replace function execution.start_session(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_session_id uuid,
  p_activity_type_code text,
  p_started_at timestamptz,
  p_timezone text,
  p_requested_level text,
  p_capture_source text,
  p_idempotency_key uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  receipt record;
  activity_id uuid;
  contract_id uuid;
  version integer;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  if p_session_id is null then
    raise exception 'a session is identified by its command' using errcode = '22023';
  end if;
  select activity.id into activity_id
  from catalog.activity_types as activity
  where activity.code = p_activity_type_code
    and activity.content_scope = 'global'
    and activity.status = 'published';
  if activity_id is null then
    raise exception 'that activity type is not in the published catalogue' using errcode = '22023';
  end if;
  select contract.id, contract.version_number into contract_id, version
  from catalog.activity_type_result_contracts as link
  join catalog.result_contracts as contract on contract.id = link.result_contract_id
  where link.activity_type_id = activity_id
    and link.is_default
    and link.valid_to is null
    and link.valid_from <= clock_timestamp()
    and contract.status = 'published';
  if contract_id is null then
    raise exception 'that activity type has no published contract to freeze' using errcode = '22023';
  end if;
  if p_started_at is null
     or p_started_at > clock_timestamp() + interval '1 day'
     or p_started_at < timestamptz '1900-01-01 00:00:00+00' then
    raise exception 'a session starts on a real day, not a future one' using errcode = '22023';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_timezone_names as zone where zone.name = p_timezone) then
    raise exception 'a session happens in a real time zone' using errcode = '22023';
  end if;
  if p_requested_level is null
     or not (p_requested_level = any (enum_range(null::catalog.completeness_level)::text[])) then
    raise exception 'the requested level is one of the four' using errcode = '22023';
  end if;
  if p_capture_source is null or p_capture_source not in ('manual', 'device') then
    raise exception 'a session is captured by hand or by a device' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-EXE-004', p_idempotency_key, p_session_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent session not found' using errcode = '40001';
    end if;
    return query select execution.session_start_outcome(receipt.aggregate_id), true;
    return;
  end if;

  insert into execution.executed_sessions (
    id, person_id, activity_type_id, result_contract_id, contract_version, started_at,
    timezone, requested_level, capture_source, capture_provenance
  ) values (
    p_session_id, person, activity_id, contract_id, version, p_started_at, p_timezone,
    p_requested_level::catalog.completeness_level, p_capture_source,
    case when p_capture_source = 'device' then 'device_observed' else 'person_declared' end
      ::identity.provenance
  );

  -- That a session started, never what it holds.
  perform system.enqueue_outbox_event(
    'executed_session', p_session_id, 'execution.session_started.v1',
    jsonb_build_object('executed_session_id', p_session_id)
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'session-started', 'executed_session', p_session_id
  );
  return query select execution.session_start_outcome(p_session_id), false;
end
$function$;

create or replace function execution.session_start_outcome(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', session.id,
    'status', session.execution_status,
    'revision_number', session.revision_number,
    'activity_type_code', activity.code,
    'result_contract', jsonb_build_object(
      'id', session.result_contract_id,
      'version', session.contract_version,
      'requested_level', session.requested_level
    )
  )
  from execution.executed_sessions as session
  join catalog.activity_types as activity on activity.id = session.activity_type_id
  where session.id = p_session_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-EXE-005 — replace the working results
-- ---------------------------------------------------------------------------

create or replace function execution.session_results_state(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', session.id,
    'status', session.execution_status,
    'revision_number', session.revision_number,
    'segment_count',
      (select count(*) from execution.session_segments as segment
       where segment.executed_session_id = session.id),
    'result_count',
      (select count(*) from execution.strength_sets as result
       where result.executed_session_id = session.id)
      + (select count(*) from execution.endurance_laps as lap
         where lap.executed_session_id = session.id)
  )
  from execution.executed_sessions as session
  where session.id = p_session_id
$function$;

create or replace function execution.replace_session_results(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_session_id uuid,
  p_expected_revision bigint,
  p_segments jsonb,
  p_strength_sets jsonb,
  p_endurance_laps jsonb,
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
  person uuid;
  receipt record;
  target execution.executed_sessions%rowtype;
  entry jsonb;
  slot integer;
  numbers integer[] := array[]::integer[];
  kind_id uuid;
  segment_ids jsonb := '{}'::jsonb;
  segment_id uuid;
  amount numeric;
  unit_row catalog.units%rowtype;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-EXE-005', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent results not found' using errcode = '40001';
    end if;
    return query select execution.session_results_state(receipt.aggregate_id), true;
    return;
  end if;

  -- Someone else's session and a session that does not exist answer the same.
  select * into target
  from execution.executed_sessions as session
  where session.id = p_session_id and session.person_id = person
  for update;
  if target.id is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if target.execution_status not in ('in_progress', 'paused') then
    raise exception 'a finished session no longer takes results' using errcode = '55000';
  end if;
  -- Allfit-defined: the device worked on a revision the session has left.
  if p_expected_revision is distinct from target.revision_number then
    raise exception 'stale-draft' using errcode = 'AF409';
  end if;

  if p_segments is null or jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) = 0 or jsonb_array_length(p_segments) > 100
     or coalesce(jsonb_typeof(p_strength_sets), 'null') <> 'array'
     or coalesce(jsonb_typeof(p_endurance_laps), 'null') <> 'array'
     or jsonb_array_length(p_strength_sets) > 1000
     or jsonb_array_length(p_endurance_laps) > 1000 then
    raise exception 'results are one to a hundred segments and their sets and laps' using errcode = '22023';
  end if;
  if jsonb_array_length(p_strength_sets) + jsonb_array_length(p_endurance_laps) = 0 then
    raise exception 'a replacement records at least one result' using errcode = '22023';
  end if;

  delete from execution.strength_sets as result where result.executed_session_id = target.id;
  delete from execution.endurance_laps as lap where lap.executed_session_id = target.id;
  delete from execution.session_segments as segment where segment.executed_session_id = target.id;

  for entry in select value from jsonb_array_elements(p_segments) loop
    if jsonb_typeof(entry) <> 'object'
       or jsonb_typeof(entry->'position') is distinct from 'number'
       or (entry->>'position')::numeric not between 1 and 100
       or (entry->>'position')::numeric <> trunc((entry->>'position')::numeric) then
      raise exception 'a segment has a whole position from 1 to 100' using errcode = '22023';
    end if;
    slot := (entry->>'position')::integer;
    if slot = any (numbers) then
      raise exception 'two segments cannot share a position' using errcode = '22023';
    end if;
    numbers := numbers || slot;
    select activity.id into kind_id
    from catalog.activity_types as activity
    where activity.code = entry->>'activity_type_code'
      and activity.content_scope = 'global'
      and activity.status = 'published';
    if kind_id is null or execution.activity_family(kind_id) is null then
      raise exception 'a segment names a published activity type' using errcode = '22023';
    end if;
    insert into execution.session_segments (executed_session_id, position, activity_type_id)
    values (target.id, slot, kind_id)
    returning id into segment_id;
    segment_ids := segment_ids || jsonb_build_object(slot::text, segment_id);
  end loop;

  numbers := array[]::integer[];
  for entry in select value from jsonb_array_elements(p_strength_sets) loop
    if jsonb_typeof(entry) <> 'object'
       or jsonb_typeof(entry->'segment_position') is distinct from 'number'
       or jsonb_typeof(entry->'order') is distinct from 'number'
       or not segment_ids ? (entry->>'segment_position')
       or (entry->>'order')::numeric not between 1 and 1000
       or (entry->>'order')::numeric <> trunc((entry->>'order')::numeric) then
      raise exception 'a set has a segment of this session and a whole order' using errcode = '22023';
    end if;
    slot := (entry->>'order')::integer;
    if slot = any (numbers) then
      raise exception 'two sets cannot share an order' using errcode = '22023';
    end if;
    numbers := numbers || slot;
    if execution.activity_family(
         (select segment.activity_type_id from execution.session_segments as segment
          where segment.id = (segment_ids->>(entry->>'segment_position'))::uuid)
       ) is distinct from 'strength' then
      raise exception 'a set belongs to a strength segment' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(entry->'planned_step_id'), 'null') <> 'null' then
      raise exception 'a free session follows no planned step' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(entry->'movement_id'), 'null') <> 'null' and not exists (
      select 1 from catalog.movements as movement
      where movement.id::text = entry->>'movement_id'
        and movement.status = 'published'
        and (movement.content_scope = 'global' or movement.owner_person_id = person)
    ) then
      raise exception 'a movement comes from the catalogue' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(entry->'achieved_reps'), 'null') not in ('null', 'number')
       or (entry ? 'achieved_reps' and jsonb_typeof(entry->'achieved_reps') = 'number' and (
         (entry->>'achieved_reps')::numeric < 1
         or (entry->>'achieved_reps')::numeric > 10000
         or (entry->>'achieved_reps')::numeric <> trunc((entry->>'achieved_reps')::numeric)
       )) then
      raise exception 'a set that was done has a whole number of repetitions' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(entry->'rpe'), 'null') not in ('null', 'number')
       or (jsonb_typeof(entry->'rpe') = 'number'
           and (entry->>'rpe')::numeric not between 0 and 10) then
      raise exception 'effort is rated from zero to ten' using errcode = '22023';
    end if;

    amount := null;
    unit_row := null;
    if coalesce(jsonb_typeof(entry->'load'), 'null') <> 'null' then
      if jsonb_typeof(entry->'load') <> 'object'
         or jsonb_typeof(entry->'load'->'value') is distinct from 'number'
         or (entry->'load'->>'unit') not in ('kg', 'lb') then
        raise exception 'a load is a mass in kilograms or pounds' using errcode = '22023';
      end if;
      select * into unit_row from catalog.units as unit where unit.code = entry->'load'->>'unit';
      amount := (entry->'load'->>'value')::numeric;
      if amount < 0 or amount * unit_row.to_canonical_factor > 2000 then
        raise exception 'a load is not negative and within reason' using errcode = '22023';
      end if;
    end if;

    insert into execution.strength_sets (
      executed_session_id, session_segment_id, movement_id, set_order, achieved_reps,
      load_value, load_unit_code, original_load_value, original_load_unit_code, rpe
    ) values (
      target.id, (segment_ids->>(entry->>'segment_position'))::uuid,
      nullif(entry->>'movement_id', '')::uuid, slot,
      (entry->>'achieved_reps')::integer,
      round(amount * unit_row.to_canonical_factor, 3),
      case when amount is not null then 'kg' end,
      case when amount is not null and unit_row.code <> 'kg' then amount end,
      case when amount is not null and unit_row.code <> 'kg' then unit_row.code end,
      (entry->>'rpe')::numeric
    );
  end loop;

  numbers := array[]::integer[];
  for entry in select value from jsonb_array_elements(p_endurance_laps) loop
    if jsonb_typeof(entry) <> 'object'
       or jsonb_typeof(entry->'segment_position') is distinct from 'number'
       or jsonb_typeof(entry->'lap_number') is distinct from 'number'
       or not segment_ids ? (entry->>'segment_position')
       or (entry->>'lap_number')::numeric not between 1 and 1000
       or (entry->>'lap_number')::numeric <> trunc((entry->>'lap_number')::numeric) then
      raise exception 'a lap has a segment of this session and a whole number' using errcode = '22023';
    end if;
    slot := (entry->>'lap_number')::integer;
    if slot = any (numbers) then
      raise exception 'two laps cannot share a number' using errcode = '22023';
    end if;
    numbers := numbers || slot;
    if execution.activity_family(
         (select segment.activity_type_id from execution.session_segments as segment
          where segment.id = (segment_ids->>(entry->>'segment_position'))::uuid)
       ) is distinct from 'endurance' then
      raise exception 'a lap belongs to an endurance segment' using errcode = '22023';
    end if;
    if jsonb_typeof(entry->'distance') is distinct from 'object'
       or jsonb_typeof(entry->'distance'->'value') is distinct from 'number'
       or (entry->'distance'->>'unit') not in ('m', 'km', 'mi')
       or (entry->'distance'->>'value')::numeric <= 0 then
      raise exception 'a lap covers a positive distance in m, km or mi' using errcode = '22023';
    end if;
    if jsonb_typeof(entry->'duration_seconds') is distinct from 'number'
       or (entry->>'duration_seconds')::numeric <= 0
       or (entry->>'duration_seconds')::numeric > 604800 then
      raise exception 'a lap takes some time, within a week' using errcode = '22023';
    end if;
    select * into unit_row from catalog.units as unit where unit.code = entry->'distance'->>'unit';
    amount := (entry->'distance'->>'value')::numeric;
    if amount * unit_row.to_canonical_factor > 1000000 then
      raise exception 'a lap is within a thousand kilometres' using errcode = '22023';
    end if;

    insert into execution.endurance_laps (
      executed_session_id, session_segment_id, lap_number, distance_value, distance_unit_code,
      original_distance_value, original_distance_unit_code, duration_seconds
    ) values (
      target.id, (segment_ids->>(entry->>'segment_position'))::uuid, slot,
      round(amount * unit_row.to_canonical_factor, 3), 'm',
      case when unit_row.code <> 'm' then amount end,
      case when unit_row.code <> 'm' then unit_row.code end,
      (entry->>'duration_seconds')::numeric
    );
  end loop;

  update execution.executed_sessions as session
  set revision_number = session.revision_number + 1, updated_at = clock_timestamp()
  where session.id = target.id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'results-replaced', 'executed_session', target.id
  );
  return query select execution.session_results_state(target.id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-EXE-006 — finish the session
-- ---------------------------------------------------------------------------

create or replace function execution.session_finish_outcome(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', session.id,
    'status', session.execution_status,
    'validation_status', session.validation_status,
    'revision_number', session.revision_number,
    'achieved_level', session.achieved_level,
    -- Primacy is a planned session's; a free session has none to count toward.
    'is_primary', false,
    'contract', jsonb_build_object(
      'id', session.result_contract_id, 'version', session.contract_version
    )
  )
  from execution.executed_sessions as session
  where session.id = p_session_id
$function$;

create or replace function execution.finalize_session(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_session_id uuid,
  p_expected_revision bigint,
  p_ended_at timestamptz,
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
  person uuid;
  receipt record;
  target execution.executed_sessions%rowtype;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);

  select * into receipt
  from system.begin_idempotency(
    person, 'space'::system.command_surface, 'space',
    'OP-EXE-006', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent finish not found' using errcode = '40001';
    end if;
    return query select execution.session_finish_outcome(receipt.aggregate_id), true;
    return;
  end if;

  select * into target
  from execution.executed_sessions as session
  where session.id = p_session_id and session.person_id = person
  for update;
  if target.id is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if target.execution_status not in ('in_progress', 'paused') then
    raise exception 'a finished session is not finished again' using errcode = '55000';
  end if;
  if p_expected_revision is distinct from target.revision_number then
    raise exception 'stale-draft' using errcode = 'AF409';
  end if;
  if p_ended_at is null
     or p_ended_at < target.started_at
     or p_ended_at > clock_timestamp() + interval '1 day' then
    raise exception 'a session ends after it starts, and not in the future' using errcode = '22023';
  end if;
  if not exists (
    select 1 from execution.strength_sets as result where result.executed_session_id = target.id
    union all
    select 1 from execution.endurance_laps as lap where lap.executed_session_id = target.id
  ) then
    raise exception 'a session with nothing recorded is not finished' using errcode = '22023';
  end if;

  -- ADR-013 has no rule format yet: the session completes, and its level is not certified.
  update execution.executed_sessions as session
  set execution_status = 'completed',
      ended_at = p_ended_at,
      revision_number = session.revision_number + 1,
      updated_at = clock_timestamp()
  where session.id = target.id;

  perform system.enqueue_outbox_event(
    'executed_session', target.id, 'execution.finalized.v1',
    jsonb_build_object('executed_session_id', target.id)
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'session-finalized', 'executed_session', target.id
  );
  return query select execution.session_finish_outcome(target.id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-EXE-014 and OP-EXE-015 — my sessions
-- ---------------------------------------------------------------------------

create or replace function execution.list_sessions(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_limit integer,
  p_before_started_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
  page jsonb;
  more boolean;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_before_started_at is null) <> (p_before_id is null) then
    raise exception 'a page has a size and, after the first, a complete cursor' using errcode = '22023';
  end if;

  with ordered as (
    select session.id,
           row_number() over (order by session.started_at desc, session.id desc) as position
    from execution.executed_sessions as session
    where session.person_id = person
      and (
        p_before_started_at is null
        or (session.started_at, session.id) < (p_before_started_at, p_before_id)
      )
    order by session.started_at desc, session.id desc
    limit p_limit + 1
  )
  select
    coalesce(
      jsonb_agg(execution.session_summary(ordered.id) order by ordered.position)
        filter (where ordered.position <= p_limit),
      '[]'::jsonb
    ),
    count(*) > p_limit
  into page, more
  from ordered;

  return jsonb_build_object('items', page, 'has_more', more);
end
$function$;

create or replace function execution.session_detail(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  person uuid;
begin
  person := identity.require_space_person(p_provider, p_issuer, p_subject);
  if not exists (
    select 1 from execution.executed_sessions as session
    where session.id = p_session_id and session.person_id = person
  ) then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  return execution.session_projection(p_session_id);
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-003 — a standard window now reads prior training history
-- ---------------------------------------------------------------------------

create or replace function support.exercise_break_glass(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_request_id uuid,
  p_category text,
  p_resource_type text,
  p_resource_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  duty_id uuid;
  file support.break_glass_requests%rowtype;
  approvals integer;
  denial text;
  event_id uuid;
  occurred timestamptz := clock_timestamp();
  readable_resource text := case p_category
    when 'body_progress' then 'identity.body_progress_records'
    when 'health_context' then 'identity.health_context_claims'
    when 'nutrition_intake' then 'nutrition.meals'
    when 'prior_training_history' then 'execution.executed_sessions'
  end;
begin
  -- The only raise before the evidence is written: without a file there is
  -- nothing to attach an event to, so there is no evidence to lose.
  select * into file from support.break_glass_requests where id = p_request_id;
  if file.id is null then
    raise exception 'break-glass request not found' using errcode = 'P0002';
  end if;

  duty_id := file.requester_duty_assignment_id;

  select count(*) into approvals
  from support.break_glass_approvals as approval
  where approval.request_id = p_request_id and approval.decision = 'approved';

  -- Each refusal carries its own reason. A category that returns content reads only its
  -- own kind of data, so a training window cannot be pointed at meals.
  denial := case
    when file.requester_person_id <> p_actor_person_id then 'not_the_requester'
    when not access_control.has_platform_role(
      p_actor_person_id, p_actor_session_id, 'allfit_admin'
    ) or not access_control.has_platform_duty(
      p_actor_person_id, p_actor_session_id, 'request_break_glass'
    ) then 'duty_not_effective'
    when support.effective_break_glass_status(
      file.status, file.request_expires_at, file.window_ends_at
    ) <> 'approved' then 'window_not_open'
    when approvals < file.required_approvals then 'quorum_incomplete'
    when not (p_category = any (file.categories)) then 'category_out_of_scope'
    when readable_resource is not null
      and p_resource_type is distinct from readable_resource then 'resource_out_of_scope'
    else null
  end;

  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, resource_id, purpose, result,
    request_id, access_mode, occurred_at
  ) values (
    p_actor_person_id, file.subject_person_id, p_resource_type, p_resource_id,
    file.purpose::text, case when denial is null then 'allowed' else 'denied' end,
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    'break_glass'::privacy.access_mode, occurred
  )
  returning id into event_id;

  insert into support.break_glass_events (
    request_id, requester_person_id, requester_duty_assignment_id, subject_person_id,
    category, result, resource_type, resource_id, operation_code, reason_code,
    occurred_at, access_event_id, access_event_occurred_at
  ) values (
    p_request_id, file.requester_person_id, file.requester_duty_assignment_id,
    file.subject_person_id, p_category,
    case when denial is null then 'allowed' else 'denied' end,
    p_resource_type, p_resource_id, 'OP-SUP-003',
    coalesce(denial, 'authorized_exercise'), occurred, event_id, occurred
  );

  -- Returned, never raised: the evidence above has to survive the refusal.
  if denial is not null then
    return jsonb_build_object(
      'outcome', 'denied',
      'reason_code', denial,
      'break_glass_event_id', event_id,
      'occurred_at', occurred
    );
  end if;

  if p_category = 'body_progress' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'body_progress', coalesce(
          (
            select jsonb_agg(
              identity.body_progress_projection(latest.id)
              order by latest.measured_on desc, latest.id desc
            )
            from (
              select record.id, record.measured_on
              from identity.body_progress_records as record
              where record.person_id = file.subject_person_id
              order by record.measured_on desc, record.id desc
              limit 500
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  if p_category = 'health_context' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'health_context', coalesce(
          (
            select jsonb_agg(
              identity.health_context_projection(latest.id)
              order by latest.valid_from desc, latest.id desc
            )
            from (
              select claim.id, claim.valid_from
              from identity.health_context_claims as claim
              where claim.person_id = file.subject_person_id
              order by claim.valid_from desc, claim.id desc
              limit 500
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  if p_category = 'nutrition_intake' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'nutrition_intake', coalesce(
          (
            select jsonb_agg(
              nutrition.meal_projection(latest.id)
              order by latest.occurred_at desc, latest.id desc
            )
            from (
              select meal.id, meal.occurred_at
              from nutrition.meals as meal
              where meal.person_id = file.subject_person_id
              order by meal.occurred_at desc, meal.id desc
              limit 500
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  -- Autonomous sessions are the person's prior training history.
  if p_category = 'prior_training_history' then
    return jsonb_build_object(
      'outcome', 'allowed',
      'reason_code', 'authorized_exercise',
      'break_glass_event_id', event_id,
      'occurred_at', occurred,
      'category', p_category,
      'content', jsonb_build_object(
        'prior_training_history', coalesce(
          (
            select jsonb_agg(
              execution.session_projection(latest.id)
              order by latest.started_at desc, latest.id desc
            )
            from (
              select session.id, session.started_at
              from execution.executed_sessions as session
              where session.person_id = file.subject_person_id and session.is_autonomous
              order by session.started_at desc, session.id desc
              limit 100
            ) as latest
          ),
          '[]'::jsonb
        )
      )
    );
  end if;

  -- Relationship training and nutrition guidance have no data in the platform yet.
  return jsonb_build_object(
    'outcome', 'content_unavailable',
    'reason_code', 'category_content_absent',
    'break_glass_event_id', event_id,
    'occurred_at', occurred,
    'category', p_category
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- Access, ownership and grants
-- ---------------------------------------------------------------------------

alter table execution.executed_sessions enable row level security;
alter table execution.executed_sessions force row level security;
alter table execution.session_segments enable row level security;
alter table execution.session_segments force row level security;
alter table execution.strength_sets enable row level security;
alter table execution.strength_sets force row level security;
alter table execution.endurance_laps enable row level security;
alter table execution.endurance_laps force row level security;

create policy executed_sessions_all_owner
  on execution.executed_sessions
  for all to allfit_owner using (true) with check (true);
create policy session_segments_all_owner
  on execution.session_segments
  for all to allfit_owner using (true) with check (true);
create policy strength_sets_all_owner
  on execution.strength_sets
  for all to allfit_owner using (true) with check (true);
create policy endurance_laps_all_owner
  on execution.endurance_laps
  for all to allfit_owner using (true) with check (true);

alter table execution.executed_sessions owner to allfit_owner;
alter table execution.session_segments owner to allfit_owner;
alter table execution.strength_sets owner to allfit_owner;
alter table execution.endurance_laps owner to allfit_owner;
alter type catalog.completeness_level owner to allfit_owner;
alter type execution.execution_status owner to allfit_owner;
alter type execution.validation_status owner to allfit_owner;

alter function execution.activity_family(uuid) owner to allfit_owner;
alter function execution.executed_session_guard_tg() owner to allfit_owner;
alter function execution.result_guard_tg() owner to allfit_owner;
alter function execution.session_projection(uuid) owner to allfit_owner;
alter function execution.session_summary(uuid) owner to allfit_owner;
alter function execution.session_start_outcome(uuid) owner to allfit_owner;
alter function execution.session_results_state(uuid) owner to allfit_owner;
alter function execution.session_finish_outcome(uuid) owner to allfit_owner;
alter function execution.start_session(
  text, text, text, uuid, text, timestamptz, text, text, text, uuid, bytea
) owner to allfit_owner;
alter function execution.replace_session_results(
  text, text, text, uuid, bigint, jsonb, jsonb, jsonb, uuid, uuid, bytea
) owner to allfit_owner;
alter function execution.finalize_session(
  text, text, text, uuid, bigint, timestamptz, uuid, uuid, bytea
) owner to allfit_owner;
alter function execution.list_sessions(text, text, text, integer, timestamptz, uuid)
  owner to allfit_owner;
alter function execution.session_detail(text, text, text, uuid) owner to allfit_owner;
alter function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  owner to allfit_owner;

revoke all on function execution.activity_family(uuid) from public;
revoke all on function execution.executed_session_guard_tg() from public;
revoke all on function execution.result_guard_tg() from public;
revoke all on function execution.session_projection(uuid) from public;
revoke all on function execution.session_summary(uuid) from public;
revoke all on function execution.session_start_outcome(uuid) from public;
revoke all on function execution.session_results_state(uuid) from public;
revoke all on function execution.session_finish_outcome(uuid) from public;
revoke all on function execution.start_session(
  text, text, text, uuid, text, timestamptz, text, text, text, uuid, bytea
) from public;
revoke all on function execution.replace_session_results(
  text, text, text, uuid, bigint, jsonb, jsonb, jsonb, uuid, uuid, bytea
) from public;
revoke all on function execution.finalize_session(
  text, text, text, uuid, bigint, timestamptz, uuid, uuid, bytea
) from public;
revoke all on function execution.list_sessions(text, text, text, integer, timestamptz, uuid)
  from public;
revoke all on function execution.session_detail(text, text, text, uuid) from public;
revoke all on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  from public;

grant execute on function execution.start_session(
  text, text, text, uuid, text, timestamptz, text, text, text, uuid, bytea
) to allfit_api;
grant execute on function execution.replace_session_results(
  text, text, text, uuid, bigint, jsonb, jsonb, jsonb, uuid, uuid, bytea
) to allfit_api;
grant execute on function execution.finalize_session(
  text, text, text, uuid, bigint, timestamptz, uuid, uuid, bytea
) to allfit_api;
grant execute on function execution.list_sessions(text, text, text, integer, timestamptz, uuid)
  to allfit_api;
grant execute on function execution.session_detail(text, text, text, uuid) to allfit_api;
grant execute on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid)
  to allfit_api;
