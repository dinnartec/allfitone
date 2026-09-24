-- Training that actually happened.
--
-- The catalogue can be chosen and a calendar materialised, and until now nothing
-- could be recorded against either: `execution` had **no tables at all**. This builds
-- the half that `X-1` draws and that `HU-SP-051` onwards describe — a session that
-- starts from something planned, collects results while it runs, and closes.
--
-- **All four families, not just strength.** `X-1` draws sets of weight and reps, but
-- the curated catalogue publishes running and circuits too; recording only strength
-- would leave eight of the twenty-four programs choosable and impossible to log.
--
-- **Narrowed where a dependency does not exist**, the criterion used throughout this
-- work. `relationships.service_relationships` still does not exist, so every
-- execution is autonomous: the two context columns are created because §10.1's
-- composite foreign key is built around them, and they are checked null so nothing
-- can put a value there that no table vouches for. The professional half — the
-- observations, the correction proposals, the validation events and the derived
-- results — is not built: it has no reader, and six empty tables would be six
-- promises the product cannot keep.

begin;

create schema if not exists execution authorization allfit_owner;

-- The runtime role reaches these tables only through closed functions, but it still
-- needs to see the schema those functions live in. Without this every reader answers
-- `42501` at the surface while every pgTAP test passes, because the tests run as the
-- owner and never cross this grant.
grant usage on schema execution to allfit_api;

-- §9.16 asks for a carrier key on `planned_sessions` and the table shipped without
-- one, which nothing noticed until an execution tried to reference it: a composite
-- foreign key is what keeps a session and its execution belonging to one person, and
-- without the unique it cannot be declared at all.
alter table planning.planned_sessions
  add constraint uq_planned_sessions_person unique (id, person_id);

create type catalog.completeness_level as enum ('partial', 'summary', 'detailed', 'sensor_enriched');
create type execution.execution_status as enum ('in_progress', 'paused', 'completed', 'abandoned');
create type execution.validation_status as enum ('pending', 'valid', 'invalid', 'annulled');

create table execution.executed_sessions (
  -- The device's Command-Id **is** the identity, as `OP-EXE-001` fixes it: a retry
  -- of the same start cannot become a second session.
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
  capture_provenance identity.provenance not null default 'person_declared',
  annulled_at timestamptz,
  annulment_reason text,
  constraint pk_executed_sessions primary key (id),
  -- The carrier key of §10.1: every child row carries the person, so no join can
  -- silently cross people.
  constraint uq_executed_sessions_person unique (id, person_id),
  constraint fk_executed_sessions_person foreign key (person_id)
    references identity.people(id) on delete restrict,
  constraint fk_executed_sessions_activity_type foreign key (activity_type_id)
    references catalog.activity_types(id) on delete restrict,
  constraint fk_executed_sessions_result_contract foreign key (result_contract_id)
    references catalog.result_contracts(id) on delete restrict,
  constraint ck_executed_sessions_revision check (revision_number >= 0),
  constraint ck_executed_sessions_ended check (ended_at is null or ended_at >= started_at),
  -- Autonomous only, until there is a relationship to be non-autonomous within.
  constraint ck_executed_sessions_autonomous check (
    is_autonomous
    and context_relationship_id is null
    and context_organization_id is null
  ),
  constraint ck_executed_sessions_capture_source check (capture_source in ('manual', 'device')),
  constraint ck_executed_sessions_timezone check (btrim(timezone) <> ''),
  constraint ck_executed_sessions_annulment check (
    (annulled_at is null) = (annulment_reason is null)
  )
);

create table execution.planned_session_executions (
  id uuid not null default extensions.uuid_generate_v7(),
  planned_session_id uuid not null,
  executed_session_id uuid not null,
  person_id uuid not null,
  attempt_number integer not null,
  is_primary boolean not null default false,
  constraint pk_planned_session_executions primary key (id),
  constraint fk_planned_session_executions_planned foreign key (planned_session_id, person_id)
    references planning.planned_sessions(id, person_id) on delete restrict,
  constraint fk_planned_session_executions_executed foreign key (executed_session_id, person_id)
    references execution.executed_sessions(id, person_id) on delete cascade,
  constraint uq_planned_session_executions_attempt unique (planned_session_id, attempt_number),
  constraint ck_planned_session_executions_attempt check (attempt_number > 0)
);

-- One primary execution per planned session, and only one.
create unique index uidx_planned_session_executions_primary
  on execution.planned_session_executions (planned_session_id)
  where is_primary;

create table execution.session_segments (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  position integer not null,
  activity_type_id uuid,
  planned_step_id uuid,
  constraint pk_session_segments primary key (id),
  constraint uq_session_segments_position unique (executed_session_id, position),
  constraint uq_session_segments_carrier unique (id, executed_session_id),
  constraint fk_session_segments_session foreign key (executed_session_id)
    references execution.executed_sessions(id) on delete cascade,
  constraint fk_session_segments_activity_type foreign key (activity_type_id)
    references catalog.activity_types(id) on delete restrict,
  constraint fk_session_segments_planned_step foreign key (planned_step_id)
    references planning.planned_steps(id) on delete restrict,
  constraint ck_session_segments_position check (position > 0)
);

create table execution.strength_sets (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  session_segment_id uuid,
  movement_id uuid,
  planned_step_id uuid,
  set_order integer not null,
  achieved_reps integer,
  load_value numeric,
  load_unit_code text,
  original_load_value numeric,
  original_load_unit_code text,
  rpe numeric,
  constraint pk_strength_sets primary key (id),
  constraint uq_strength_sets_order unique (executed_session_id, set_order),
  constraint fk_strength_sets_session foreign key (executed_session_id)
    references execution.executed_sessions(id) on delete cascade,
  constraint fk_strength_sets_segment foreign key (session_segment_id, executed_session_id)
    references execution.session_segments(id, executed_session_id) on delete restrict,
  constraint fk_strength_sets_movement foreign key (movement_id)
    references catalog.movements(id) on delete restrict,
  constraint fk_strength_sets_planned_step foreign key (planned_step_id)
    references planning.planned_steps(id) on delete restrict,
  constraint fk_strength_sets_load_unit foreign key (load_unit_code)
    references catalog.units(code) on delete restrict,
  constraint fk_strength_sets_original_unit foreign key (original_load_unit_code)
    references catalog.units(code) on delete restrict,
  constraint ck_strength_sets_values check (
    set_order > 0
    and (achieved_reps is null or achieved_reps > 0)
    and (load_value is null) = (load_unit_code is null)
    and (load_value is null or load_value >= 0)
    and (original_load_value is null) = (original_load_unit_code is null)
    and (rpe is null or rpe between 0 and 10)
  )
);

create table execution.endurance_laps (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  session_segment_id uuid,
  lap_number integer not null,
  distance_value numeric not null,
  distance_unit_code text not null,
  duration_seconds numeric not null,
  elevation_gain_value numeric,
  elevation_gain_unit_code text,
  avg_heart_rate_bpm integer,
  constraint pk_endurance_laps primary key (id),
  constraint uq_endurance_laps_number unique (executed_session_id, lap_number),
  constraint fk_endurance_laps_session foreign key (executed_session_id)
    references execution.executed_sessions(id) on delete cascade,
  constraint fk_endurance_laps_segment foreign key (session_segment_id, executed_session_id)
    references execution.session_segments(id, executed_session_id) on delete restrict,
  constraint fk_endurance_laps_distance_unit foreign key (distance_unit_code)
    references catalog.units(code) on delete restrict,
  constraint fk_endurance_laps_elevation_unit foreign key (elevation_gain_unit_code)
    references catalog.units(code) on delete restrict,
  constraint ck_endurance_laps_values check (
    lap_number > 0
    and distance_value > 0
    and duration_seconds > 0
    and (elevation_gain_value is null) = (elevation_gain_unit_code is null)
    and (elevation_gain_value is null or elevation_gain_value >= 0)
    and (avg_heart_rate_bpm is null or avg_heart_rate_bpm > 0)
  )
);

create table execution.interval_results (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  session_segment_id uuid,
  interval_number integer not null,
  work_duration_seconds numeric not null,
  rest_duration_seconds numeric,
  achieved_repetitions integer,
  distance_value numeric,
  distance_unit_code text,
  completed boolean not null default true,
  constraint pk_interval_results primary key (id),
  constraint uq_interval_results_number unique (executed_session_id, interval_number),
  constraint fk_interval_results_session foreign key (executed_session_id)
    references execution.executed_sessions(id) on delete cascade,
  constraint fk_interval_results_segment foreign key (session_segment_id, executed_session_id)
    references execution.session_segments(id, executed_session_id) on delete restrict,
  constraint fk_interval_results_distance_unit foreign key (distance_unit_code)
    references catalog.units(code) on delete restrict,
  constraint ck_interval_results_values check (
    interval_number > 0
    and work_duration_seconds > 0
    and (rest_duration_seconds is null or rest_duration_seconds >= 0)
    and (achieved_repetitions is null or achieved_repetitions > 0)
    and (distance_value is null) = (distance_unit_code is null)
    and (distance_value is null or distance_value > 0)
  )
);

create table execution.round_results (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  session_segment_id uuid,
  round_number integer not null,
  activity_family text not null,
  completed_repetitions integer,
  duration_seconds numeric,
  distance_value numeric,
  distance_unit_code text,
  load_value numeric,
  load_unit_code text,
  constraint pk_round_results primary key (id),
  constraint uq_round_results_number unique (executed_session_id, round_number),
  constraint fk_round_results_session foreign key (executed_session_id)
    references execution.executed_sessions(id) on delete cascade,
  constraint fk_round_results_segment foreign key (session_segment_id, executed_session_id)
    references execution.session_segments(id, executed_session_id) on delete restrict,
  constraint fk_round_results_distance_unit foreign key (distance_unit_code)
    references catalog.units(code) on delete restrict,
  constraint fk_round_results_load_unit foreign key (load_unit_code)
    references catalog.units(code) on delete restrict,
  constraint ck_round_results_values check (
    round_number > 0
    and activity_family in ('strength', 'endurance', 'interval', 'mobility')
    -- A round with nothing measured is not a round somebody did.
    and num_nonnulls(completed_repetitions, duration_seconds, distance_value, load_value) > 0
    and (completed_repetitions is null or completed_repetitions > 0)
    and (duration_seconds is null or duration_seconds > 0)
    and (distance_value is null) = (distance_unit_code is null)
    and (distance_value is null or distance_value > 0)
    and (load_value is null) = (load_unit_code is null)
    and (load_value is null or load_value >= 0)
  )
);

create table execution.mobility_results (
  id uuid not null default extensions.uuid_generate_v7(),
  executed_session_id uuid not null,
  session_segment_id uuid,
  sequence_position integer not null,
  movement_id uuid,
  side text not null default 'not_applicable',
  hold_duration_seconds numeric,
  completed_repetitions integer,
  constraint pk_mobility_results primary key (id),
  constraint uq_mobility_results_position unique (executed_session_id, sequence_position),
  constraint fk_mobility_results_session foreign key (executed_session_id)
    references execution.executed_sessions(id) on delete cascade,
  constraint fk_mobility_results_segment foreign key (session_segment_id, executed_session_id)
    references execution.session_segments(id, executed_session_id) on delete restrict,
  constraint fk_mobility_results_movement foreign key (movement_id)
    references catalog.movements(id) on delete restrict,
  constraint ck_mobility_results_values check (
    sequence_position > 0
    and side in ('left', 'right', 'bilateral', 'not_applicable')
    and num_nonnulls(hold_duration_seconds, completed_repetitions) > 0
    and (hold_duration_seconds is null or hold_duration_seconds > 0)
    and (completed_repetitions is null or completed_repetitions > 0)
  )
);

create index idx_executed_sessions_person_started
  on execution.executed_sessions (person_id, started_at desc);
create index idx_planned_session_executions_attempt
  on execution.planned_session_executions (planned_session_id, attempt_number);
create index idx_session_segments_session on execution.session_segments (executed_session_id, position);
create index idx_strength_sets_session on execution.strength_sets (executed_session_id, set_order);
create index idx_endurance_laps_session on execution.endurance_laps (executed_session_id, lap_number);
create index idx_interval_results_session on execution.interval_results (executed_session_id, interval_number);
create index idx_round_results_session on execution.round_results (executed_session_id, round_number);
create index idx_mobility_results_session on execution.mobility_results (executed_session_id, sequence_position);

alter type catalog.completeness_level owner to allfit_owner;
alter type execution.execution_status owner to allfit_owner;
alter type execution.validation_status owner to allfit_owner;

-- Every table forces row security, and every policy is `is_self`: an execution
-- belongs to the person, always. The professional half of §10.1's condition needs a
-- grant that does not exist, so it is not written — stricter than the target, never
-- looser.
do $$
declare
  relation text;
begin
  foreach relation in array array[
    'executed_sessions', 'planned_session_executions', 'session_segments',
    'strength_sets', 'endurance_laps', 'interval_results', 'round_results',
    'mobility_results'
  ] loop
    execute format('alter table execution.%I owner to allfit_owner', relation);
    execute format('alter table execution.%I enable row level security', relation);
    execute format('alter table execution.%I force row level security', relation);
    execute format('revoke all on execution.%I from public', relation);
  end loop;
end
$$;

create policy executed_sessions_all_self on execution.executed_sessions
  for all to allfit_owner
  using (person_id = access_control.person())
  with check (person_id = access_control.person());

create policy planned_session_executions_all_self on execution.planned_session_executions
  for all to allfit_owner
  using (person_id = access_control.person())
  with check (person_id = access_control.person());

-- The children inherit from the session, exactly as the planning children do.
create policy session_segments_all_self on execution.session_segments
  for all to allfit_owner
  using (exists (
    select 1 from execution.executed_sessions as session
    where session.id = session_segments.executed_session_id))
  with check (exists (
    select 1 from execution.executed_sessions as session
    where session.id = session_segments.executed_session_id));

create policy strength_sets_all_self on execution.strength_sets
  for all to allfit_owner
  using (exists (
    select 1 from execution.executed_sessions as session
    where session.id = strength_sets.executed_session_id))
  with check (exists (
    select 1 from execution.executed_sessions as session
    where session.id = strength_sets.executed_session_id));

create policy endurance_laps_all_self on execution.endurance_laps
  for all to allfit_owner
  using (exists (
    select 1 from execution.executed_sessions as session
    where session.id = endurance_laps.executed_session_id))
  with check (exists (
    select 1 from execution.executed_sessions as session
    where session.id = endurance_laps.executed_session_id));

create policy interval_results_all_self on execution.interval_results
  for all to allfit_owner
  using (exists (
    select 1 from execution.executed_sessions as session
    where session.id = interval_results.executed_session_id))
  with check (exists (
    select 1 from execution.executed_sessions as session
    where session.id = interval_results.executed_session_id));

create policy round_results_all_self on execution.round_results
  for all to allfit_owner
  using (exists (
    select 1 from execution.executed_sessions as session
    where session.id = round_results.executed_session_id))
  with check (exists (
    select 1 from execution.executed_sessions as session
    where session.id = round_results.executed_session_id));

create policy mobility_results_all_self on execution.mobility_results
  for all to allfit_owner
  using (exists (
    select 1 from execution.executed_sessions as session
    where session.id = mobility_results.executed_session_id))
  with check (exists (
    select 1 from execution.executed_sessions as session
    where session.id = mobility_results.executed_session_id));

commit;
