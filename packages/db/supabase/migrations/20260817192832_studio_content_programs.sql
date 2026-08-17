-- Catalog foundations and organization-owned versioned planning content.
-- Product runtime uses closed functions; base-table privileges remain unavailable.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists planning authorization allfit_owner;

create type catalog.content_scope as enum ('global', 'organization', 'person');
create type catalog.activity_family as enum ('strength', 'endurance', 'interval', 'mobility');
alter type catalog.content_scope owner to allfit_owner;
alter type catalog.activity_family owner to allfit_owner;

insert into organizations.role_capabilities (role_code, capability_code)
values ('owner', 'manage_content'), ('admin', 'manage_content')
on conflict (role_code, capability_code) do nothing;

create table catalog.disciplines (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  status catalog.publication_status not null default 'draft',
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_disciplines primary key (id),
  constraint uq_disciplines_code unique (code),
  constraint ck_disciplines_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_disciplines_name check (btrim(name) <> '')
);

create index idx_disciplines_status on catalog.disciplines (status, code);

create table catalog.activity_types (
  id uuid not null default extensions.uuid_generate_v7(),
  discipline_code text not null,
  code text not null,
  name text not null,
  content_scope catalog.content_scope not null default 'global',
  owner_organization_id uuid,
  status catalog.publication_status not null default 'draft',
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_activity_types primary key (id),
  constraint fk_activity_types_discipline foreign key (discipline_code) references catalog.disciplines(code) on delete restrict,
  constraint fk_activity_types_owner_organization foreign key (owner_organization_id) references organizations.organizations(id) on delete restrict,
  constraint ck_activity_types_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_activity_types_name check (btrim(name) <> ''),
  constraint ck_activity_types_scope_owner check ((content_scope = 'global') = (owner_organization_id is null))
);

create unique index uidx_activity_types_global_code
  on catalog.activity_types (code) where content_scope = 'global';
create index idx_activity_types_scope_owner_status
  on catalog.activity_types (content_scope, owner_organization_id, status);
create index idx_activity_types_scope_discipline_status
  on catalog.activity_types (content_scope, discipline_code, status);

create table catalog.movements (
  id uuid not null default extensions.uuid_generate_v7(),
  discipline_code text not null,
  name text not null,
  normalized_name text not null,
  content_scope catalog.content_scope not null,
  owner_organization_id uuid,
  owner_person_id uuid,
  successor_movement_id uuid,
  status catalog.publication_status not null default 'draft',
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_movements primary key (id),
  constraint fk_movements_discipline foreign key (discipline_code) references catalog.disciplines(code) on delete restrict,
  constraint fk_movements_owner_organization foreign key (owner_organization_id) references organizations.organizations(id) on delete restrict,
  constraint fk_movements_owner_person foreign key (owner_person_id) references identity.people(id) on delete restrict,
  constraint fk_movements_successor foreign key (successor_movement_id) references catalog.movements(id) on delete restrict,
  constraint ck_movements_name check (btrim(name) <> '' and btrim(normalized_name) <> ''),
  constraint ck_movements_scope_owner check (
    (content_scope = 'global' and num_nonnulls(owner_organization_id, owner_person_id) = 0)
    or (content_scope = 'organization' and owner_organization_id is not null and owner_person_id is null)
    or (content_scope = 'person' and owner_person_id is not null and owner_organization_id is null)
  )
);

create unique index uidx_movements_organization_name
  on catalog.movements (owner_organization_id, normalized_name)
  where content_scope = 'organization';
create index idx_movements_scope_owner_status
  on catalog.movements (content_scope, owner_organization_id, status);
create index idx_movements_scope_discipline_status
  on catalog.movements (content_scope, discipline_code, status);
create index idx_movements_normalized_name on catalog.movements (normalized_name);

create table catalog.units (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  dimension text not null,
  is_canonical boolean not null default false,
  to_canonical_factor numeric not null,
  constraint pk_units primary key (id),
  constraint uq_units_code unique (code),
  constraint ck_units_code check (code ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint ck_units_dimension check (dimension ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_units_factor check (to_canonical_factor > 0)
);

create unique index uidx_units_canonical_dimension
  on catalog.units (dimension) where is_canonical;
create index idx_units_dimension on catalog.units (dimension, code);

create table catalog.result_contracts (
  id uuid not null default extensions.uuid_generate_v7(),
  contract_code text not null,
  version_number integer not null,
  activity_family catalog.activity_family not null,
  contract_schema_version smallint not null default 1,
  envelope jsonb not null,
  minimums jsonb not null,
  status catalog.publication_status not null default 'draft',
  published_at timestamptz,
  constraint pk_result_contracts primary key (id),
  constraint uq_result_contracts_code_version unique (contract_code, version_number),
  constraint ck_result_contracts_code check (contract_code ~ '^[a-z][a-z0-9_.]{1,63}$'),
  constraint ck_result_contracts_version check (version_number > 0),
  constraint ck_result_contracts_schema_version check (contract_schema_version = 1),
  constraint ck_result_contracts_documents check (jsonb_typeof(envelope) = 'object' and jsonb_typeof(minimums) = 'object'),
  constraint ck_result_contracts_publication check ((status in ('published', 'deprecated')) = (published_at is not null))
);

create table catalog.activity_type_result_contracts (
  id uuid not null default extensions.uuid_generate_v7(),
  activity_type_id uuid not null,
  result_contract_id uuid not null,
  is_default boolean not null default false,
  valid_from timestamptz not null,
  valid_to timestamptz,
  constraint pk_activity_type_result_contracts primary key (id),
  constraint fk_activity_type_result_contracts_activity_type foreign key (activity_type_id) references catalog.activity_types(id) on delete restrict,
  constraint fk_activity_type_result_contracts_result_contract foreign key (result_contract_id) references catalog.result_contracts(id) on delete restrict,
  constraint ck_activity_type_result_contracts_vigency check (valid_to is null or valid_to > valid_from)
);

create unique index uidx_activity_type_result_contracts_current_default
  on catalog.activity_type_result_contracts (activity_type_id)
  where is_default and valid_to is null;
create index idx_activity_type_result_contracts_activity_type
  on catalog.activity_type_result_contracts (activity_type_id, valid_from desc);

create table planning.session_templates (
  id uuid not null default extensions.uuid_generate_v7(),
  owner_organization_id uuid,
  owner_person_id uuid,
  discipline_code text not null,
  author_person_id uuid not null,
  status catalog.publication_status not null default 'draft',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_session_templates primary key (id),
  constraint fk_session_templates_owner_organization foreign key (owner_organization_id) references organizations.organizations(id) on delete restrict,
  constraint fk_session_templates_owner_person foreign key (owner_person_id) references identity.people(id) on delete restrict,
  constraint fk_session_templates_discipline foreign key (discipline_code) references catalog.disciplines(code) on delete restrict,
  constraint fk_session_templates_author foreign key (author_person_id) references identity.people(id) on delete restrict,
  constraint ck_session_templates_owner_xor check (num_nonnulls(owner_organization_id, owner_person_id) = 1)
);

create index idx_session_templates_organization_status
  on planning.session_templates (owner_organization_id, status, updated_at desc, id);
create index idx_session_templates_person_status
  on planning.session_templates (owner_person_id, status, updated_at desc, id);

create table planning.session_template_drafts (
  id uuid not null default extensions.uuid_generate_v7(),
  template_id uuid not null,
  content_schema_version smallint not null default 1,
  content jsonb not null,
  derived_from_version_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_session_template_drafts primary key (id),
  constraint uq_session_template_drafts_template unique (template_id),
  constraint fk_session_template_drafts_template foreign key (template_id) references planning.session_templates(id) on delete cascade,
  constraint ck_session_template_drafts_schema_version check (content_schema_version = 1),
  constraint ck_session_template_drafts_content check (jsonb_typeof(content) = 'object')
);

create table planning.session_template_versions (
  id uuid not null default extensions.uuid_generate_v7(),
  template_id uuid not null,
  version_number integer not null,
  discipline_code text not null,
  activity_type_id uuid not null,
  derived_from_version_id uuid,
  title text not null,
  content_hash bytea not null,
  status catalog.publication_status not null default 'published',
  published_at timestamptz not null default clock_timestamp(),
  constraint pk_session_template_versions primary key (id),
  constraint uq_session_template_versions_number unique (template_id, version_number),
  constraint uq_session_template_versions_content unique (template_id, content_hash),
  constraint fk_session_template_versions_template foreign key (template_id) references planning.session_templates(id) on delete restrict,
  constraint fk_session_template_versions_discipline foreign key (discipline_code) references catalog.disciplines(code) on delete restrict,
  constraint fk_session_template_versions_activity_type foreign key (activity_type_id) references catalog.activity_types(id) on delete restrict,
  constraint fk_session_template_versions_derivation foreign key (derived_from_version_id) references planning.session_template_versions(id) on delete restrict,
  constraint ck_session_template_versions_number check (version_number > 0),
  constraint ck_session_template_versions_title check (btrim(title) <> '' and char_length(title) <= 160),
  constraint ck_session_template_versions_content_hash check (octet_length(content_hash) = 32),
  constraint ck_session_template_versions_status check (status in ('published', 'deprecated'))
);

create index idx_session_template_versions_template
  on planning.session_template_versions (template_id, version_number);

alter table planning.session_template_drafts
  add constraint fk_session_template_drafts_derivation foreign key (derived_from_version_id) references planning.session_template_versions(id) on delete restrict;

create table planning.planned_steps (
  id uuid not null default extensions.uuid_generate_v7(),
  template_version_id uuid not null,
  position integer not null,
  movement_id uuid,
  activity_type_id uuid,
  notes text,
  constraint pk_planned_steps primary key (id),
  constraint uq_planned_steps_position unique (template_version_id, position),
  constraint fk_planned_steps_template_version foreign key (template_version_id) references planning.session_template_versions(id) on delete cascade,
  constraint fk_planned_steps_movement foreign key (movement_id) references catalog.movements(id) on delete restrict,
  constraint fk_planned_steps_activity_type foreign key (activity_type_id) references catalog.activity_types(id) on delete restrict,
  constraint ck_planned_steps_position check (position > 0),
  constraint ck_planned_steps_notes check (
    notes is null or (btrim(notes) <> '' and char_length(notes) <= 2000)
  )
);

create index idx_planned_steps_template_version on planning.planned_steps (template_version_id, position);

create table planning.strength_targets (
  id uuid not null default extensions.uuid_generate_v7(),
  planned_step_id uuid not null,
  target_sets integer not null,
  target_reps integer,
  target_load_value numeric,
  target_load_unit_code text,
  target_rpe numeric,
  constraint pk_strength_targets primary key (id),
  constraint uq_strength_targets_step unique (planned_step_id),
  constraint fk_strength_targets_step foreign key (planned_step_id) references planning.planned_steps(id) on delete cascade,
  constraint fk_strength_targets_load_unit foreign key (target_load_unit_code) references catalog.units(code) on delete restrict,
  constraint ck_strength_targets_values check (
    target_sets > 0 and (target_reps is null or target_reps > 0)
    and ((target_load_value is null) = (target_load_unit_code is null))
    and (target_load_value is null or target_load_value >= 0)
    and (target_rpe is null or target_rpe between 0 and 10)
  )
);

create table planning.endurance_targets (
  id uuid not null default extensions.uuid_generate_v7(),
  planned_step_id uuid not null,
  target_distance_value numeric,
  target_distance_unit_code text,
  target_duration_seconds numeric,
  target_pace_seconds_per_unit numeric,
  target_pace_unit_code text,
  constraint pk_endurance_targets primary key (id),
  constraint uq_endurance_targets_step unique (planned_step_id),
  constraint fk_endurance_targets_step foreign key (planned_step_id) references planning.planned_steps(id) on delete cascade,
  constraint fk_endurance_targets_distance_unit foreign key (target_distance_unit_code) references catalog.units(code) on delete restrict,
  constraint fk_endurance_targets_pace_unit foreign key (target_pace_unit_code) references catalog.units(code) on delete restrict,
  constraint ck_endurance_targets_values check (
    (target_distance_value is not null or target_duration_seconds is not null)
    and ((target_distance_value is null) = (target_distance_unit_code is null))
    and ((target_pace_seconds_per_unit is null) = (target_pace_unit_code is null))
    and (target_distance_value is null or target_distance_value > 0)
    and (target_duration_seconds is null or target_duration_seconds > 0)
    and (target_pace_seconds_per_unit is null or target_pace_seconds_per_unit > 0)
  )
);

create table planning.interval_targets (
  id uuid not null default extensions.uuid_generate_v7(),
  planned_step_id uuid not null,
  rounds integer not null,
  work_duration_seconds numeric not null,
  rest_duration_seconds numeric,
  target_rpe numeric,
  constraint pk_interval_targets primary key (id),
  constraint uq_interval_targets_step unique (planned_step_id),
  constraint fk_interval_targets_step foreign key (planned_step_id) references planning.planned_steps(id) on delete cascade,
  constraint ck_interval_targets_values check (
    rounds > 0 and work_duration_seconds > 0
    and (rest_duration_seconds is null or rest_duration_seconds >= 0)
    and (target_rpe is null or target_rpe between 0 and 10)
  )
);

create table planning.mobility_targets (
  id uuid not null default extensions.uuid_generate_v7(),
  planned_step_id uuid not null,
  sequence_position integer not null,
  hold_duration_seconds numeric,
  target_repetitions integer,
  side text not null,
  constraint pk_mobility_targets primary key (id),
  constraint uq_mobility_targets_step unique (planned_step_id),
  constraint fk_mobility_targets_step foreign key (planned_step_id) references planning.planned_steps(id) on delete cascade,
  constraint ck_mobility_targets_values check (
    sequence_position > 0
    and (hold_duration_seconds is not null or target_repetitions is not null)
    and (hold_duration_seconds is null or hold_duration_seconds > 0)
    and (target_repetitions is null or target_repetitions > 0)
    and side in ('left', 'right', 'bilateral', 'not_applicable')
  )
);

create table planning.programs (
  id uuid not null default extensions.uuid_generate_v7(),
  owner_organization_id uuid,
  owner_person_id uuid,
  author_person_id uuid not null,
  status catalog.publication_status not null default 'draft',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_programs primary key (id),
  constraint fk_programs_owner_organization foreign key (owner_organization_id) references organizations.organizations(id) on delete restrict,
  constraint fk_programs_owner_person foreign key (owner_person_id) references identity.people(id) on delete restrict,
  constraint fk_programs_author foreign key (author_person_id) references identity.people(id) on delete restrict,
  constraint ck_programs_owner_xor check (num_nonnulls(owner_organization_id, owner_person_id) = 1)
);

create index idx_programs_organization_status
  on planning.programs (owner_organization_id, status, updated_at desc, id);
create index idx_programs_person_status
  on planning.programs (owner_person_id, status, updated_at desc, id);

create table planning.program_drafts (
  id uuid not null default extensions.uuid_generate_v7(),
  program_id uuid not null,
  content_schema_version smallint not null default 1,
  content jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_program_drafts primary key (id),
  constraint uq_program_drafts_program unique (program_id),
  constraint fk_program_drafts_program foreign key (program_id) references planning.programs(id) on delete cascade,
  constraint ck_program_drafts_schema_version check (content_schema_version = 1),
  constraint ck_program_drafts_content check (jsonb_typeof(content) = 'object')
);

create table planning.program_versions (
  id uuid not null default extensions.uuid_generate_v7(),
  program_id uuid not null,
  version_number integer not null,
  title text not null,
  notes text,
  content_hash bytea not null,
  status catalog.publication_status not null default 'published',
  published_at timestamptz not null default clock_timestamp(),
  constraint pk_program_versions primary key (id),
  constraint uq_program_versions_number unique (program_id, version_number),
  constraint uq_program_versions_content unique (program_id, content_hash),
  constraint fk_program_versions_program foreign key (program_id) references planning.programs(id) on delete restrict,
  constraint ck_program_versions_number check (version_number > 0),
  constraint ck_program_versions_title check (btrim(title) <> '' and char_length(title) <= 160),
  constraint ck_program_versions_notes check (notes is null or char_length(notes) <= 2000),
  constraint ck_program_versions_content_hash check (octet_length(content_hash) = 32),
  constraint ck_program_versions_status check (status in ('published', 'deprecated'))
);

create index idx_program_versions_program on planning.program_versions (program_id, version_number);

create table planning.program_version_sessions (
  id uuid not null default extensions.uuid_generate_v7(),
  program_version_id uuid not null,
  template_version_id uuid not null,
  position integer not null,
  week integer not null,
  day integer not null,
  constraint pk_program_version_sessions primary key (id),
  constraint uq_program_version_sessions_position unique (program_version_id, position),
  constraint fk_program_version_sessions_program_version foreign key (program_version_id) references planning.program_versions(id) on delete cascade,
  constraint fk_program_version_sessions_template_version foreign key (template_version_id) references planning.session_template_versions(id) on delete restrict,
  constraint ck_program_version_sessions_position check (position > 0),
  constraint ck_program_version_sessions_week check (week between 1 and 104),
  constraint ck_program_version_sessions_day check (day between 1 and 7)
);

create index idx_program_version_sessions_program_version
  on planning.program_version_sessions (program_version_id, position);
create index idx_program_version_sessions_template_version
  on planning.program_version_sessions (template_version_id);

alter table catalog.disciplines owner to allfit_owner;
alter table catalog.activity_types owner to allfit_owner;
alter table catalog.movements owner to allfit_owner;
alter table catalog.units owner to allfit_owner;
alter table catalog.result_contracts owner to allfit_owner;
alter table catalog.activity_type_result_contracts owner to allfit_owner;
alter table planning.session_templates owner to allfit_owner;
alter table planning.session_template_drafts owner to allfit_owner;
alter table planning.session_template_versions owner to allfit_owner;
alter table planning.planned_steps owner to allfit_owner;
alter table planning.strength_targets owner to allfit_owner;
alter table planning.endurance_targets owner to allfit_owner;
alter table planning.interval_targets owner to allfit_owner;
alter table planning.mobility_targets owner to allfit_owner;
alter table planning.programs owner to allfit_owner;
alter table planning.program_drafts owner to allfit_owner;
alter table planning.program_versions owner to allfit_owner;
alter table planning.program_version_sessions owner to allfit_owner;

alter table catalog.disciplines enable row level security;
alter table catalog.disciplines force row level security;
alter table catalog.activity_types enable row level security;
alter table catalog.activity_types force row level security;
alter table catalog.movements enable row level security;
alter table catalog.movements force row level security;
alter table catalog.units enable row level security;
alter table catalog.units force row level security;
alter table catalog.result_contracts enable row level security;
alter table catalog.result_contracts force row level security;
alter table catalog.activity_type_result_contracts enable row level security;
alter table catalog.activity_type_result_contracts force row level security;
alter table planning.session_templates enable row level security;
alter table planning.session_templates force row level security;
alter table planning.session_template_drafts enable row level security;
alter table planning.session_template_drafts force row level security;
alter table planning.session_template_versions enable row level security;
alter table planning.session_template_versions force row level security;
alter table planning.planned_steps enable row level security;
alter table planning.planned_steps force row level security;
alter table planning.strength_targets enable row level security;
alter table planning.strength_targets force row level security;
alter table planning.endurance_targets enable row level security;
alter table planning.endurance_targets force row level security;
alter table planning.interval_targets enable row level security;
alter table planning.interval_targets force row level security;
alter table planning.mobility_targets enable row level security;
alter table planning.mobility_targets force row level security;
alter table planning.programs enable row level security;
alter table planning.programs force row level security;
alter table planning.program_drafts enable row level security;
alter table planning.program_drafts force row level security;
alter table planning.program_versions enable row level security;
alter table planning.program_versions force row level security;
alter table planning.program_version_sessions enable row level security;
alter table planning.program_version_sessions force row level security;

create or replace function access_control.org()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select case
    when nullif(current_setting('app.actor_org_id', true), '') is not null
      and access_control.has_membership(
        nullif(current_setting('app.actor_org_id', true), '')::uuid
      )
    then nullif(current_setting('app.actor_org_id', true), '')::uuid
  end
$function$;

alter function access_control.org() owner to allfit_owner;
revoke all on function access_control.org() from public, allfit_api;

create policy disciplines_select_actor on catalog.disciplines for select to allfit_owner
  using (status = 'published' and access_control.person() is not null);
create policy activity_types_all_actor_access on catalog.activity_types for all to allfit_owner
  using (
    (content_scope = 'global' and status = 'published' and access_control.person() is not null)
    or (content_scope = 'organization' and owner_organization_id = access_control.org())
  )
  with check (
    (content_scope = 'global' and status = 'published' and access_control.person() is not null)
    or (content_scope = 'organization' and owner_organization_id = access_control.org())
  );
create policy movements_all_actor_access on catalog.movements for all to allfit_owner
  using (
    (content_scope = 'global' and status = 'published' and access_control.person() is not null)
    or (content_scope = 'organization' and owner_organization_id = access_control.org())
    or (content_scope = 'person' and owner_person_id = access_control.person())
  )
  with check (
    (content_scope = 'global' and status = 'published' and access_control.person() is not null)
    or (content_scope = 'organization' and owner_organization_id = access_control.org())
    or (content_scope = 'person' and owner_person_id = access_control.person())
  );
create policy units_select_actor on catalog.units for select to allfit_owner
  using (access_control.person() is not null);
create policy result_contracts_select_actor on catalog.result_contracts for select to allfit_owner
  using (status in ('published', 'deprecated') and access_control.person() is not null);
create policy activity_type_result_contracts_select_actor
  on catalog.activity_type_result_contracts for select to allfit_owner
  using (
    valid_from <= clock_timestamp()
    and (valid_to is null or valid_to > clock_timestamp())
    and exists (
      select 1 from catalog.activity_types as activity
      where activity.id = activity_type_id
    )
    and exists (
      select 1 from catalog.result_contracts as contract
      where contract.id = result_contract_id
    )
  );

create policy session_templates_all_actor_access on planning.session_templates for all to allfit_owner
  using (
    (owner_organization_id = access_control.org()
      and access_control.has_capability(owner_organization_id, 'manage_content'))
    or owner_person_id = access_control.person()
  )
  with check (
    (owner_organization_id = access_control.org()
      and access_control.has_capability(owner_organization_id, 'manage_content'))
    or owner_person_id = access_control.person()
  );
create policy session_template_drafts_all_actor_access on planning.session_template_drafts for all to allfit_owner
  using (exists (
    select 1 from planning.session_templates as template where template.id = template_id
  ))
  with check (exists (
    select 1 from planning.session_templates as template where template.id = template_id
  ));
create policy session_template_versions_all_actor_access on planning.session_template_versions for all to allfit_owner
  using (exists (
    select 1 from planning.session_templates as template where template.id = template_id
  ))
  with check (exists (
    select 1 from planning.session_templates as template where template.id = template_id
  ));
create policy planned_steps_all_actor_access on planning.planned_steps for all to allfit_owner
  using (exists (
    select 1 from planning.session_template_versions as version
    where version.id = template_version_id
  ))
  with check (exists (
    select 1 from planning.session_template_versions as version
    where version.id = template_version_id
  ));
create policy strength_targets_all_actor_access on planning.strength_targets for all to allfit_owner
  using (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ))
  with check (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ));
create policy endurance_targets_all_actor_access on planning.endurance_targets for all to allfit_owner
  using (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ))
  with check (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ));
create policy interval_targets_all_actor_access on planning.interval_targets for all to allfit_owner
  using (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ))
  with check (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ));
create policy mobility_targets_all_actor_access on planning.mobility_targets for all to allfit_owner
  using (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ))
  with check (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ));
create policy programs_all_actor_access on planning.programs for all to allfit_owner
  using (
    (owner_organization_id = access_control.org()
      and access_control.has_capability(owner_organization_id, 'manage_content'))
    or owner_person_id = access_control.person()
  )
  with check (
    (owner_organization_id = access_control.org()
      and access_control.has_capability(owner_organization_id, 'manage_content'))
    or owner_person_id = access_control.person()
  );
create policy program_drafts_all_actor_access on planning.program_drafts for all to allfit_owner
  using (exists (
    select 1 from planning.programs as program where program.id = program_id
  ))
  with check (exists (
    select 1 from planning.programs as program where program.id = program_id
  ));
create policy program_versions_all_actor_access on planning.program_versions for all to allfit_owner
  using (exists (
    select 1 from planning.programs as program where program.id = program_id
  ))
  with check (exists (
    select 1 from planning.programs as program where program.id = program_id
  ));
create policy program_version_sessions_all_actor_access on planning.program_version_sessions for all to allfit_owner
  using (exists (
    select 1 from planning.program_versions as version
    where version.id = program_version_id
  ))
  with check (exists (
    select 1 from planning.program_versions as version
    where version.id = program_version_id
  ));

revoke all on all tables in schema planning from public, allfit_api;
revoke all on catalog.disciplines, catalog.activity_types, catalog.movements, catalog.units,
  catalog.result_contracts, catalog.activity_type_result_contracts from public, allfit_api;

create or replace function catalog.activity_type_target_family(p_activity_type_id uuid)
returns catalog.activity_family
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select contract.activity_family
  from catalog.activity_types as activity
  join catalog.activity_type_result_contracts as association
    on association.activity_type_id = activity.id
   and association.is_default
   and association.valid_from <= clock_timestamp()
   and (association.valid_to is null or association.valid_to > clock_timestamp())
  join catalog.result_contracts as contract
    on contract.id = association.result_contract_id
   and contract.status = 'published'
  where activity.id = p_activity_type_id
    and activity.status = 'published'
$function$;

alter function catalog.activity_type_target_family(uuid) owner to allfit_owner;
revoke all on function catalog.activity_type_target_family(uuid) from public, allfit_api;

create or replace function planning.content_etag(p_content jsonb)
returns text
language sql
immutable
strict
security invoker
set search_path = pg_catalog
as $function$
  select '"sha256:' || rtrim(translate(encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'base64'), '+/', '-_'), '=') || '"'
$function$;

create or replace function planning.enforce_target_family_ct()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  expected_family catalog.activity_family;
  actual_family catalog.activity_family := tg_argv[0]::catalog.activity_family;
begin
  select catalog.activity_type_target_family(coalesce(step.activity_type_id, version.activity_type_id))
  into expected_family
  from planning.planned_steps as step
  join planning.session_template_versions as version on version.id = step.template_version_id
  where step.id = new.planned_step_id;

  if expected_family is null or expected_family <> actual_family then
    raise exception 'IX-22 target family is incompatible with activity type' using errcode = '23514';
  end if;
  return new;
end
$function$;

alter function planning.enforce_target_family_ct() owner to allfit_owner;
revoke all on function planning.enforce_target_family_ct() from public, allfit_api;

create constraint trigger trg_strength_targets_after_write_family
after insert or update on planning.strength_targets
deferrable initially immediate for each row execute function planning.enforce_target_family_ct('strength');
create constraint trigger trg_endurance_targets_after_write_family
after insert or update on planning.endurance_targets
deferrable initially immediate for each row execute function planning.enforce_target_family_ct('endurance');
create constraint trigger trg_interval_targets_after_write_family
after insert or update on planning.interval_targets
deferrable initially immediate for each row execute function planning.enforce_target_family_ct('interval');
create constraint trigger trg_mobility_targets_after_write_family
after insert or update on planning.mobility_targets
deferrable initially immediate for each row execute function planning.enforce_target_family_ct('mobility');

create or replace function catalog.prevent_published_result_contract_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE'
     and old.status = 'published'
     and new.status = 'deprecated'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  raise exception 'published result contract is immutable' using errcode = '55000';
end
$function$;

alter function catalog.prevent_published_result_contract_mutation() owner to allfit_owner;
revoke all on function catalog.prevent_published_result_contract_mutation() from public, allfit_api;

create trigger trg_result_contracts_before_mutation_immutable
before update or delete on catalog.result_contracts
for each row
when (old.status in ('published', 'deprecated'))
execute function catalog.prevent_published_result_contract_mutation();

create or replace function planning.prevent_published_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE'
     and old.status = 'published'
     and new.status = 'deprecated'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  raise exception 'published content is immutable' using errcode = '55000';
end
$function$;

create or replace function planning.prevent_immutable_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception 'published content is immutable' using errcode = '55000';
end
$function$;

create or replace function planning.allow_publication_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if current_setting('app.planning_publication', true) <> 'true' then
    raise exception 'published content is immutable' using errcode = '55000';
  end if;
  return new;
end
$function$;

alter function planning.prevent_published_mutation() owner to allfit_owner;
alter function planning.prevent_immutable_child_mutation() owner to allfit_owner;
alter function planning.allow_publication_insert() owner to allfit_owner;
revoke all on function planning.prevent_published_mutation() from public, allfit_api;
revoke all on function planning.prevent_immutable_child_mutation() from public, allfit_api;
revoke all on function planning.allow_publication_insert() from public, allfit_api;

create trigger trg_session_template_versions_before_mutation_immutable
before update or delete on planning.session_template_versions
for each row execute function planning.prevent_published_mutation();
create trigger trg_program_versions_before_mutation_immutable
before update or delete on planning.program_versions
for each row execute function planning.prevent_published_mutation();
create trigger trg_planned_steps_before_mutation_immutable
before update or delete on planning.planned_steps
for each row execute function planning.prevent_immutable_child_mutation();
create trigger trg_strength_targets_before_mutation_immutable
before update or delete on planning.strength_targets
for each row execute function planning.prevent_immutable_child_mutation();
create trigger trg_endurance_targets_before_mutation_immutable
before update or delete on planning.endurance_targets
for each row execute function planning.prevent_immutable_child_mutation();
create trigger trg_interval_targets_before_mutation_immutable
before update or delete on planning.interval_targets
for each row execute function planning.prevent_immutable_child_mutation();
create trigger trg_mobility_targets_before_mutation_immutable
before update or delete on planning.mobility_targets
for each row execute function planning.prevent_immutable_child_mutation();
create trigger trg_program_version_sessions_before_mutation_immutable
before update or delete on planning.program_version_sessions
for each row execute function planning.prevent_immutable_child_mutation();
create trigger trg_planned_steps_before_insert_publication
before insert on planning.planned_steps
for each row execute function planning.allow_publication_insert();
create trigger trg_strength_targets_before_insert_publication
before insert on planning.strength_targets
for each row execute function planning.allow_publication_insert();
create trigger trg_endurance_targets_before_insert_publication
before insert on planning.endurance_targets
for each row execute function planning.allow_publication_insert();
create trigger trg_interval_targets_before_insert_publication
before insert on planning.interval_targets
for each row execute function planning.allow_publication_insert();
create trigger trg_mobility_targets_before_insert_publication
before insert on planning.mobility_targets
for each row execute function planning.allow_publication_insert();
create trigger trg_program_version_sessions_before_insert_publication
before insert on planning.program_version_sessions
for each row execute function planning.allow_publication_insert();

create or replace function planning.assert_manage_content(
  p_person_id uuid,
  p_organization_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  membership_id uuid;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  select membership.id into membership_id
  from organizations.organization_memberships as membership
  join organizations.organizations as organization on organization.id = membership.organization_id
  where membership.organization_id = p_organization_id
    and membership.person_id = p_person_id
    and membership.status = 'active'
    and organization.status = 'active';

  if membership_id is null or not access_control.has_capability(p_organization_id, 'manage_content') then
    raise exception 'organization content not found' using errcode = 'P0002';
  end if;
  perform set_config('app.actor_org_id', p_organization_id::text, true);
  perform set_config('app.actor_membership_id', membership_id::text, true);
  return membership_id;
end
$function$;

create or replace function planning.assert_deprecate_content(
  p_person_id uuid,
  p_organization_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  actor_membership_id uuid := planning.assert_manage_content(p_person_id, p_organization_id);
begin
  if not exists (
    select 1
    from organizations.membership_roles as role
    where role.membership_id = actor_membership_id
      and role.role_code in ('owner', 'admin')
      and role.valid_to is null
  ) then
    raise exception 'content deprecation capability required' using errcode = '42501';
  end if;
  return actor_membership_id;
end
$function$;

create or replace function planning.audit_organization_read(
  p_person_id uuid,
  p_organization_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  membership_id uuid := planning.assert_manage_content(p_person_id, p_organization_id);
begin
  if nullif(current_setting('app.request_id', true), '') is null then
    raise exception 'request id required for audited read' using errcode = '22023';
  end if;
  perform set_config('app.actor_membership_id', membership_id::text, true);
  perform set_config('app.purpose', 'studio_planning_content', true);
  perform privacy.log_access_event(
    null, p_organization_id, null, null, null, null, null,
    'organization_operational', 'organizations.organization_context', 'allowed'
  );
end
$function$;

create or replace function planning.session_draft_projection(p_draft_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', draft.id,
    'template_id', draft.template_id,
    'content_schema_version', draft.content_schema_version,
    'content', draft.content,
    'derived_from_version_id', draft.derived_from_version_id,
    'etag', planning.content_etag(draft.content),
    'updated_at', draft.updated_at
  )
  from planning.session_template_drafts as draft
  where draft.id = p_draft_id
$function$;

create or replace function planning.session_version_projection(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
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
          'target', case
            when strength.id is not null then jsonb_strip_nulls(to_jsonb(strength) - array['id', 'planned_step_id']) || jsonb_build_object('family', 'strength')
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

create or replace function planning.session_template_projection(p_template_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', template.id,
    'organization_id', template.owner_organization_id,
    'discipline_code', template.discipline_code,
    'status', template.status,
    'author_person_id', template.author_person_id,
    'draft', planning.session_draft_projection(draft.id),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', version.id,
        'template_id', version.template_id,
        'version_number', version.version_number,
        'status', version.status,
        'published_at', version.published_at
      ) order by version.version_number desc)
      from planning.session_template_versions as version
      where version.template_id = template.id
    ), '[]'::jsonb)
  )
  from planning.session_templates as template
  join planning.session_template_drafts as draft on draft.template_id = template.id
  where template.id = p_template_id
$function$;

create or replace function planning.program_draft_projection(p_draft_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', draft.id,
    'program_id', draft.program_id,
    'content_schema_version', draft.content_schema_version,
    'content', draft.content,
    'etag', planning.content_etag(draft.content),
    'updated_at', draft.updated_at,
    'deprecated_template_version_ids', coalesce((
      select jsonb_agg((session->>'template_version_id')::uuid)
      from jsonb_array_elements(draft.content->'sessions') as session
      join planning.session_template_versions as version
        on version.id = (session->>'template_version_id')::uuid
       and version.status = 'deprecated'
    ), '[]'::jsonb)
  )
  from planning.program_drafts as draft
  where draft.id = p_draft_id
$function$;

create or replace function planning.program_version_projection(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', version.id,
    'program_id', version.program_id,
    'version_number', version.version_number,
    'status', version.status,
    'title', version.title,
    'notes', version.notes,
    'published_at', version.published_at,
    'session_count', count(session.id),
    'deprecated_template_version_ids', coalesce(jsonb_agg(distinct session.template_version_id order by session.template_version_id)
      filter (where template_version.status = 'deprecated'), '[]'::jsonb),
    'sessions', coalesce(jsonb_agg(jsonb_build_object(
      'position', session.position,
      'week', session.week,
      'day', session.day,
      'template_version_id', session.template_version_id
    ) order by session.position) filter (where session.id is not null), '[]'::jsonb)
  )
  from planning.program_versions as version
  left join planning.program_version_sessions as session on session.program_version_id = version.id
  left join planning.session_template_versions as template_version on template_version.id = session.template_version_id
  where version.id = p_version_id
  group by version.id
$function$;

create or replace function planning.program_projection(p_program_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', program.id,
    'organization_id', program.owner_organization_id,
    'status', program.status,
    'author_person_id', program.author_person_id,
    'draft', planning.program_draft_projection(draft.id),
    'versions', coalesce((
      select jsonb_agg(planning.program_version_projection(version.id) order by version.version_number desc)
      from planning.program_versions as version
      where version.program_id = program.id
    ), '[]'::jsonb)
  )
  from planning.programs as program
  join planning.program_drafts as draft on draft.program_id = program.id
  where program.id = p_program_id
$function$;

alter function planning.assert_manage_content(uuid, uuid) owner to allfit_owner;
alter function planning.assert_deprecate_content(uuid, uuid) owner to allfit_owner;
alter function planning.audit_organization_read(uuid, uuid) owner to allfit_owner;
alter function planning.content_etag(jsonb) owner to allfit_owner;
alter function planning.session_draft_projection(uuid) owner to allfit_owner;
alter function planning.session_version_projection(uuid) owner to allfit_owner;
alter function planning.session_template_projection(uuid) owner to allfit_owner;
alter function planning.program_draft_projection(uuid) owner to allfit_owner;
alter function planning.program_version_projection(uuid) owner to allfit_owner;
alter function planning.program_projection(uuid) owner to allfit_owner;
revoke all on function planning.assert_manage_content(uuid, uuid) from public, allfit_api;
revoke all on function planning.assert_deprecate_content(uuid, uuid) from public, allfit_api;
revoke all on function planning.audit_organization_read(uuid, uuid) from public, allfit_api;
revoke all on function planning.content_etag(jsonb) from public, allfit_api;
revoke all on function planning.session_draft_projection(uuid) from public, allfit_api;
revoke all on function planning.session_version_projection(uuid) from public, allfit_api;
revoke all on function planning.session_template_projection(uuid) from public, allfit_api;
revoke all on function planning.program_draft_projection(uuid) from public, allfit_api;
revoke all on function planning.program_version_projection(uuid) from public, allfit_api;
revoke all on function planning.program_projection(uuid) from public, allfit_api;

create or replace function planning.session_content_errors(
  p_content jsonb,
  p_organization_id uuid,
  p_discipline_code text,
  p_require_complete boolean
)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
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
       and (target - array['family', 'target_sets', 'target_reps', 'target_load_value', 'target_load_unit_code', 'target_rpe'] <> '{}'::jsonb
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
         or (jsonb_typeof(target->'target_rpe') = 'number' and (target->>'target_rpe')::numeric not between 0 and 10)) then
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

create or replace function planning.program_content_errors(
  p_content jsonb,
  p_organization_id uuid,
  p_require_publishable boolean
)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  errors text[] := array[]::text[];
  session jsonb;
  template_status catalog.publication_status;
begin
  if jsonb_typeof(p_content) <> 'object'
     or not p_content ?& array['title', 'sessions']
     or p_content - array['title', 'notes', 'sessions'] <> '{}'::jsonb
     or jsonb_typeof(p_content->'title') <> 'string'
     or btrim(p_content->>'title') = ''
     or char_length(p_content->>'title') > 160
     or jsonb_typeof(p_content->'sessions') <> 'array' then
    return array['invalid-content-shape'];
  end if;
  if p_content ? 'notes'
     and jsonb_typeof(p_content->'notes') not in ('string', 'null') then
    errors := array_append(errors, 'notes');
  elsif jsonb_typeof(p_content->'notes') = 'string'
        and char_length(p_content->>'notes') > 2000 then
    errors := array_append(errors, 'notes');
  end if;
  if jsonb_array_length(p_content->'sessions') > 730 then
    return array_append(errors, 'sessions');
  end if;
  if p_require_publishable and jsonb_array_length(p_content->'sessions') = 0 then
    errors := array_append(errors, 'sessions');
  end if;
  for session in select value from jsonb_array_elements(p_content->'sessions') loop
    if jsonb_typeof(session) <> 'object'
       or not session ?& array['position', 'week', 'day', 'template_version_id']
       or session - array['position', 'week', 'day', 'template_version_id'] <> '{}'::jsonb
       or jsonb_typeof(session->'position') <> 'number'
       or jsonb_typeof(session->'week') <> 'number'
       or jsonb_typeof(session->'day') <> 'number'
       or jsonb_typeof(session->'template_version_id') <> 'string'
       or session->>'position' !~ '^[1-9][0-9]*$'
       or (session->>'position')::numeric > 730
       or session->>'week' !~ '^[1-9][0-9]*$'
       or (session->>'week')::numeric > 104
       or session->>'day' !~ '^[1-7]$'
       or session->>'template_version_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      errors := array_append(errors, 'session-shape');
      continue;
    end if;
    select version.status into template_status
    from planning.session_template_versions as version
    join planning.session_templates as template on template.id = version.template_id
    where version.id = (session->>'template_version_id')::uuid
      and template.owner_organization_id = p_organization_id;
    if template_status is null then
      errors := array_append(errors, 'template-version');
    end if;
  end loop;
  if exists (
    select item.value->>'position'
    from jsonb_array_elements(p_content->'sessions') as item(value)
    group by item.value->>'position'
    having count(*) > 1
  ) then
    errors := array_append(errors, 'duplicate-session-position');
  end if;
  return errors;
exception when others then
  return array_append(errors, 'invalid-content-value');
end
$function$;

create or replace function planning.materialize_target(p_step_id uuid, p_target jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  case p_target->>'family'
    when 'strength' then
      insert into planning.strength_targets (
        planned_step_id, target_sets, target_reps, target_load_value,
        target_load_unit_code, target_rpe
      ) values (
        p_step_id, (p_target->>'target_sets')::integer,
        nullif(p_target->>'target_reps', '')::integer,
        nullif(p_target->>'target_load_value', '')::numeric,
        nullif(p_target->>'target_load_unit_code', ''),
        nullif(p_target->>'target_rpe', '')::numeric
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

create or replace function planning.lock_program_template_versions(
  p_content jsonb,
  p_organization_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
begin
  if jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(p_content->'sessions') <> 'array' then
    return;
  end if;

  perform 1
  from planning.session_template_versions as version
  join planning.session_templates as template on template.id = version.template_id
  where template.owner_organization_id = p_organization_id
    and version.id in (
      select distinct (session.value->>'template_version_id')::uuid
      from jsonb_array_elements(p_content->'sessions') as session(value)
      where jsonb_typeof(session.value) = 'object'
        and jsonb_typeof(session.value->'template_version_id') = 'string'
        and session.value->>'template_version_id'
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  order by version.id
  for no key update of version;
end
$function$;

alter function planning.session_content_errors(jsonb, uuid, text, boolean) owner to allfit_owner;
alter function planning.program_content_errors(jsonb, uuid, boolean) owner to allfit_owner;
alter function planning.materialize_target(uuid, jsonb) owner to allfit_owner;
alter function planning.lock_program_template_versions(jsonb, uuid) owner to allfit_owner;
revoke all on function planning.session_content_errors(jsonb, uuid, text, boolean) from public, allfit_api;
revoke all on function planning.program_content_errors(jsonb, uuid, boolean) from public, allfit_api;
revoke all on function planning.materialize_target(uuid, jsonb) from public, allfit_api;
revoke all on function planning.lock_program_template_versions(jsonb, uuid) from public, allfit_api;

create or replace function planning.create_session_template(
  p_person_id uuid,
  p_organization_id uuid,
  p_discipline_code text,
  p_title text,
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
  receipt record;
  template_id uuid;
  response jsonb;
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-001', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := planning.session_template_projection(receipt.aggregate_id);
    if response is null then raise exception 'idempotent template not found' using errcode = '40001'; end if;
    return query select response, true;
    return;
  end if;
  if btrim(p_title) = '' or char_length(p_title) > 160
     or not exists (select 1 from catalog.disciplines where code = p_discipline_code and status = 'published') then
    raise exception 'invalid template identity' using errcode = '22023';
  end if;
  insert into planning.session_templates (
    owner_organization_id, discipline_code, author_person_id
  ) values (p_organization_id, p_discipline_code, p_person_id)
  returning id into template_id;
  insert into planning.session_template_drafts (template_id, content)
  values (template_id, jsonb_build_object('title', btrim(p_title), 'activity_type_id', null, 'steps', jsonb_build_array()));

  perform system.enqueue_outbox_event(
    'session_template', template_id, 'planning.session_template_created.v1',
    jsonb_build_object('template_id', template_id, 'organization_id', p_organization_id)
  );
  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'session-template-created', 'session_template', template_id);
  return query select planning.session_template_projection(template_id), false;
end
$function$;

create or replace function planning.replace_session_template_draft(
  p_person_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_expected_etag text,
  p_content jsonb,
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
  receipt record;
  draft planning.session_template_drafts%rowtype;
  discipline_code text;
  errors text[];
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-002', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_draft_projection(receipt.aggregate_id), true;
    return;
  end if;
  select existing_draft.*
  into draft
  from planning.session_template_drafts as existing_draft
  join planning.session_templates as template on template.id = existing_draft.template_id
  where template.id = p_template_id
    and template.owner_organization_id = p_organization_id
  for update of existing_draft;
  if draft.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;
  select template.discipline_code into discipline_code
  from planning.session_templates as template where template.id = p_template_id;

  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001', detail = planning.session_draft_projection(draft.id)::text;
  end if;
  errors := planning.session_content_errors(p_content, p_organization_id, discipline_code, false);
  if cardinality(errors) > 0 then
    raise exception 'invalid session template draft' using errcode = '22023', detail = to_json(errors)::text;
  end if;

  if draft.content is distinct from p_content then
    update planning.session_template_drafts
    set content = p_content, derived_from_version_id = null, updated_at = clock_timestamp()
    where id = draft.id;
    update planning.session_templates set updated_at = clock_timestamp() where id = p_template_id;
    perform system.enqueue_outbox_event(
      'session_template', p_template_id, 'planning.session_template_draft_updated.v1',
      jsonb_build_object('template_id', p_template_id, 'draft_id', draft.id)
    );
  end if;
  perform system.finish_idempotency(receipt.receipt_id, 200::smallint, 'session-template-draft-updated', 'session_template_draft', draft.id);
  return query select planning.session_draft_projection(draft.id), false;
end
$function$;

create or replace function planning.publish_session_template_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_expected_etag text,
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
  receipt record;
  draft planning.session_template_drafts%rowtype;
  template planning.session_templates%rowtype;
  errors text[];
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

  version_content_hash := extensions.digest(convert_to(draft.content::text, 'UTF8'), 'sha256');
  select version.id into version_id from planning.session_template_versions as version
  where version.template_id = p_template_id and version.content_hash = version_content_hash;
  if version_id is null then
    select coalesce(max(version.version_number), 0) + 1 into next_version
    from planning.session_template_versions as version where version.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (draft.content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      btrim(draft.content->>'title'), version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for step in select value from jsonb_array_elements(draft.content->'steps') order by (value->>'position')::integer loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes
      ) values (
        version_id, (step->>'position')::integer,
        nullif(step->>'movement_id', '')::uuid,
        nullif(step->>'activity_type_id', '')::uuid,
        nullif(step->>'notes', '')
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

create or replace function planning.derive_session_template_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_version_number integer,
  p_expected_etag text,
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
  receipt record;
  draft planning.session_template_drafts%rowtype;
  version_id uuid;
  derived_content jsonb;
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_draft_projection(receipt.aggregate_id), true;
    return;
  end if;
  select current_draft.* into draft
  from planning.session_template_drafts as current_draft
  join planning.session_templates as template on template.id = current_draft.template_id
  where template.id = p_template_id and template.owner_organization_id = p_organization_id
  for update of current_draft;
  select version.id, planning.session_version_projection(version.id) - array[
    'id', 'template_id', 'version_number', 'status', 'published_at', 'discipline_code', 'derived_from_version_id'
  ] into version_id, derived_content
  from planning.session_template_versions as version
  join planning.session_templates as template on template.id = version.template_id
  where template.id = p_template_id
    and template.owner_organization_id = p_organization_id
    and version.version_number = p_version_number
    and version.status = 'published'
  for no key update of version;
  if draft.id is null or version_id is null then raise exception 'template version not found' using errcode = 'P0002'; end if;

  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001', detail = planning.session_draft_projection(draft.id)::text;
  end if;
  update planning.session_template_drafts
  set content = derived_content, derived_from_version_id = version_id, updated_at = clock_timestamp()
  where id = draft.id;
  update planning.session_templates set updated_at = clock_timestamp() where id = p_template_id;
  perform system.enqueue_outbox_event(
    'session_template', p_template_id, 'planning.session_template_version_derived.v1',
    jsonb_build_object('template_id', p_template_id, 'source_version_id', version_id)
  );
  perform system.finish_idempotency(receipt.receipt_id, 200::smallint, 'session-template-version-derived', 'session_template_draft', draft.id);
  return query select planning.session_draft_projection(draft.id), false;
end
$function$;

create or replace function planning.deprecate_session_template_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_version_number integer,
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
  receipt record;
  version_id uuid;
begin
  perform planning.assert_deprecate_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-005', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_version_projection(receipt.aggregate_id), true;
    return;
  end if;
  select version.id into version_id
  from planning.session_template_versions as version
  join planning.session_templates as template on template.id = version.template_id
  where template.id = p_template_id
    and template.owner_organization_id = p_organization_id
    and version.version_number = p_version_number
  for update of version;
  if version_id is null then raise exception 'template version not found' using errcode = 'P0002'; end if;
  update planning.session_template_versions set status = 'deprecated'
  where id = version_id and status = 'published';
  if found then
    perform system.enqueue_outbox_event(
      'session_template_version', version_id, 'planning.session_template_version_deprecated.v1',
      jsonb_build_object('template_id', p_template_id, 'version_id', version_id)
    );
  end if;
  perform system.finish_idempotency(receipt.receipt_id, 200::smallint, 'session-template-version-deprecated', 'session_template_version', version_id);
  return query select planning.session_version_projection(version_id), false;
end
$function$;

create or replace function planning.create_program(
  p_person_id uuid,
  p_organization_id uuid,
  p_title text,
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
  receipt record;
  program_id uuid;
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-006', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_projection(receipt.aggregate_id), true;
    return;
  end if;
  if btrim(p_title) = '' or char_length(p_title) > 160 then
    raise exception 'invalid program title' using errcode = '22023';
  end if;
  insert into planning.programs (owner_organization_id, author_person_id)
  values (p_organization_id, p_person_id) returning id into program_id;
  insert into planning.program_drafts (program_id, content)
  values (program_id, jsonb_build_object('title', btrim(p_title), 'notes', null, 'sessions', jsonb_build_array()));
  perform system.enqueue_outbox_event(
    'program', program_id, 'planning.program_created.v1',
    jsonb_build_object('program_id', program_id, 'organization_id', p_organization_id)
  );
  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'program-created', 'program', program_id);
  return query select planning.program_projection(program_id), false;
end
$function$;

create or replace function planning.replace_program_draft(
  p_person_id uuid,
  p_organization_id uuid,
  p_program_id uuid,
  p_expected_etag text,
  p_content jsonb,
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
  receipt record;
  draft planning.program_drafts%rowtype;
  errors text[];
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_draft_projection(receipt.aggregate_id), true;
    return;
  end if;
  select current_draft.* into draft
  from planning.program_drafts as current_draft
  join planning.programs as program on program.id = current_draft.program_id
  where program.id = p_program_id and program.owner_organization_id = p_organization_id
  for update of current_draft;
  if draft.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;
  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001', detail = planning.program_draft_projection(draft.id)::text;
  end if;
  perform planning.lock_program_template_versions(p_content, p_organization_id);
  errors := planning.program_content_errors(p_content, p_organization_id, false);
  if cardinality(errors) = 0 then
    if exists (
      with requested as (
        select session->>'template_version_id' as version_id, count(*) as reference_count
        from jsonb_array_elements(p_content->'sessions') as item(session)
        group by session->>'template_version_id'
      ), existing as (
        select session->>'template_version_id' as version_id, count(*) as reference_count
        from jsonb_array_elements(draft.content->'sessions') as item(session)
        group by session->>'template_version_id'
      )
      select 1 from requested
      join planning.session_template_versions as version
        on version.id = requested.version_id::uuid
       and version.status = 'deprecated'
      left join existing on existing.version_id = requested.version_id
      where requested.reference_count > coalesce(existing.reference_count, 0)
    ) then
      errors := array_append(errors, 'template-version-deprecated');
    end if;
  end if;
  if cardinality(errors) > 0 then
    raise exception 'invalid program draft' using errcode = '22023', detail = to_json(errors)::text;
  end if;
  if draft.content is distinct from p_content then
    update planning.program_drafts set content = p_content, updated_at = clock_timestamp() where id = draft.id;
    update planning.programs set updated_at = clock_timestamp() where id = p_program_id;
    perform system.enqueue_outbox_event(
      'program', p_program_id, 'planning.program_draft_updated.v1',
      jsonb_build_object('program_id', p_program_id, 'draft_id', draft.id)
    );
  end if;
  perform system.finish_idempotency(receipt.receipt_id, 200::smallint, 'program-draft-updated', 'program_draft', draft.id);
  return query select planning.program_draft_projection(draft.id), false;
end
$function$;

create or replace function planning.publish_program_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_program_id uuid,
  p_expected_etag text,
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
  receipt record;
  draft planning.program_drafts%rowtype;
  errors text[];
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  session jsonb;
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-008', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_version_projection(receipt.aggregate_id), true;
    return;
  end if;
  select current_draft.* into draft
  from planning.program_drafts as current_draft
  join planning.programs as program on program.id = current_draft.program_id
  where program.id = p_program_id and program.owner_organization_id = p_organization_id
  for update of program, current_draft;
  if draft.id is null then raise exception 'program not found' using errcode = 'P0002'; end if;
  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001', detail = planning.program_draft_projection(draft.id)::text;
  end if;
  perform planning.lock_program_template_versions(draft.content, p_organization_id);
  errors := planning.program_content_errors(draft.content, p_organization_id, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete program draft' using errcode = '22023', detail = to_json(errors)::text;
  end if;
  version_content_hash := extensions.digest(convert_to(draft.content::text, 'UTF8'), 'sha256');
  select version.id into version_id from planning.program_versions as version
  where version.program_id = p_program_id and version.content_hash = version_content_hash;
  if version_id is null then
    select coalesce(max(version.version_number), 0) + 1 into next_version
    from planning.program_versions as version where version.program_id = p_program_id;
    insert into planning.program_versions (
      program_id, version_number, title, notes, content_hash
    ) values (
      p_program_id, next_version, btrim(draft.content->>'title'),
      nullif(draft.content->>'notes', ''), version_content_hash
    ) returning id into version_id;
    perform set_config('app.planning_publication', 'true', true);
    for session in select value from jsonb_array_elements(draft.content->'sessions') order by (value->>'position')::integer loop
      insert into planning.program_version_sessions (
        program_version_id, template_version_id, position, week, day
      ) values (
        version_id, (session->>'template_version_id')::uuid,
        (session->>'position')::integer, (session->>'week')::integer, (session->>'day')::integer
      );
    end loop;
    update planning.programs set status = 'published', updated_at = clock_timestamp() where id = p_program_id;
    perform system.enqueue_outbox_event(
      'program_version', version_id, 'planning.program_version_published.v1',
      jsonb_build_object('program_id', p_program_id, 'version_id', version_id, 'version_number', next_version)
    );
  end if;
  perform system.finish_idempotency(receipt.receipt_id, 201::smallint, 'program-version-published', 'program_version', version_id);
  return query select planning.program_version_projection(version_id), false;
end
$function$;

create or replace function planning.deprecate_program_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_program_id uuid,
  p_version_number integer,
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
  receipt record;
  version_id uuid;
begin
  perform planning.assert_deprecate_content(p_person_id, p_organization_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-009', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.program_version_projection(receipt.aggregate_id), true;
    return;
  end if;
  select version.id into version_id
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where program.id = p_program_id
    and program.owner_organization_id = p_organization_id
    and version.version_number = p_version_number
  for update of version;
  if version_id is null then raise exception 'program version not found' using errcode = 'P0002'; end if;
  update planning.program_versions set status = 'deprecated'
  where id = version_id and status = 'published';
  if found then
    perform system.enqueue_outbox_event(
      'program_version', version_id, 'planning.program_version_deprecated.v1',
      jsonb_build_object('program_id', p_program_id, 'version_id', version_id)
    );
  end if;
  perform system.finish_idempotency(receipt.receipt_id, 200::smallint, 'program-version-deprecated', 'program_version', version_id);
  return query select planning.program_version_projection(version_id), false;
end
$function$;

create or replace function planning.list_session_templates(
  p_person_id uuid,
  p_organization_id uuid,
  p_limit integer,
  p_cursor_updated_at timestamptz,
  p_cursor_id uuid
)
returns table (result jsonb, updated_at timestamptz, template_id uuid)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
begin
  if p_limit not between 1 and 101 then raise exception 'invalid limit' using errcode = '22023'; end if;
  perform planning.audit_organization_read(p_person_id, p_organization_id);
  return query
  select planning.session_template_projection(template.id), template.updated_at, template.id
  from planning.session_templates as template
  where template.owner_organization_id = p_organization_id
    and (p_cursor_updated_at is null or (template.updated_at, template.id) < (p_cursor_updated_at, p_cursor_id))
  order by template.updated_at desc, template.id desc
  limit p_limit;
end
$function$;

create or replace function planning.list_programs(
  p_person_id uuid,
  p_organization_id uuid,
  p_limit integer,
  p_cursor_updated_at timestamptz,
  p_cursor_id uuid
)
returns table (result jsonb, updated_at timestamptz, program_id uuid)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
begin
  if p_limit not between 1 and 101 then raise exception 'invalid limit' using errcode = '22023'; end if;
  perform planning.audit_organization_read(p_person_id, p_organization_id);
  return query
  select planning.program_projection(program.id), program.updated_at, program.id
  from planning.programs as program
  where program.owner_organization_id = p_organization_id
    and (p_cursor_updated_at is null or (program.updated_at, program.id) < (p_cursor_updated_at, p_cursor_id))
  order by program.updated_at desc, program.id desc
  limit p_limit;
end
$function$;

create or replace function planning.read_session_template_version(
  p_person_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_version_number integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  version_id uuid;
begin
  perform planning.audit_organization_read(p_person_id, p_organization_id);
  select version.id into version_id
  from planning.session_template_versions as version
  join planning.session_templates as template on template.id = version.template_id
  where template.id = p_template_id
    and template.owner_organization_id = p_organization_id
    and version.version_number = p_version_number;
  if version_id is null then raise exception 'template version not found' using errcode = 'P0002'; end if;
  return planning.session_version_projection(version_id);
end
$function$;

alter function planning.create_session_template(uuid, uuid, text, text, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.replace_session_template_draft(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.publish_session_template_version(uuid, uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.derive_session_template_version(uuid, uuid, uuid, integer, text, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.deprecate_session_template_version(uuid, uuid, uuid, integer, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.create_program(uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.replace_program_draft(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.publish_program_version(uuid, uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.deprecate_program_version(uuid, uuid, uuid, integer, uuid, uuid, bytea) owner to allfit_owner;
alter function planning.list_session_templates(uuid, uuid, integer, timestamptz, uuid) owner to allfit_owner;
alter function planning.list_programs(uuid, uuid, integer, timestamptz, uuid) owner to allfit_owner;
alter function planning.read_session_template_version(uuid, uuid, uuid, integer) owner to allfit_owner;

revoke all on function planning.create_session_template(uuid, uuid, text, text, uuid, uuid, bytea) from public;
revoke all on function planning.replace_session_template_draft(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) from public;
revoke all on function planning.publish_session_template_version(uuid, uuid, uuid, text, uuid, uuid, bytea) from public;
revoke all on function planning.derive_session_template_version(uuid, uuid, uuid, integer, text, uuid, uuid, bytea) from public;
revoke all on function planning.deprecate_session_template_version(uuid, uuid, uuid, integer, uuid, uuid, bytea) from public;
revoke all on function planning.create_program(uuid, uuid, text, uuid, uuid, bytea) from public;
revoke all on function planning.replace_program_draft(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) from public;
revoke all on function planning.publish_program_version(uuid, uuid, uuid, text, uuid, uuid, bytea) from public;
revoke all on function planning.deprecate_program_version(uuid, uuid, uuid, integer, uuid, uuid, bytea) from public;
revoke all on function planning.list_session_templates(uuid, uuid, integer, timestamptz, uuid) from public;
revoke all on function planning.list_programs(uuid, uuid, integer, timestamptz, uuid) from public;
revoke all on function planning.read_session_template_version(uuid, uuid, uuid, integer) from public;

grant usage on schema planning to allfit_api;
grant execute on function planning.create_session_template(uuid, uuid, text, text, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.replace_session_template_draft(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.publish_session_template_version(uuid, uuid, uuid, text, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.derive_session_template_version(uuid, uuid, uuid, integer, text, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.deprecate_session_template_version(uuid, uuid, uuid, integer, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.create_program(uuid, uuid, text, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.replace_program_draft(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.publish_program_version(uuid, uuid, uuid, text, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.deprecate_program_version(uuid, uuid, uuid, integer, uuid, uuid, bytea) to allfit_api;
grant execute on function planning.list_session_templates(uuid, uuid, integer, timestamptz, uuid) to allfit_api;
grant execute on function planning.list_programs(uuid, uuid, integer, timestamptz, uuid) to allfit_api;
grant execute on function planning.read_session_template_version(uuid, uuid, uuid, integer) to allfit_api;
