-- Allfit becomes the owner of a training catalogue, and a program version says who
-- it is for.
--
-- `planning.programs` and `planning.session_templates` required an owner: an
-- organization or a person, and exactly one. That made a catalogue belonging to the
-- platform impossible to express, even though `OP-PLN-011` has always admitted a
-- version "propia o global" and `catalog.content_scope` has always carried `global`.
-- The shape adopted here is not new: it is character for character the one
-- `catalog.movements` already uses in the same schema, so there is one rule about
-- what a scope implies about owners rather than two that can drift.
--
-- **Global content is readable, never writable, through the runtime.** The added
-- policies are `for select` only. Curation runs as `postgres`, which bypasses row
-- security, so nothing here has to loosen a write path to let the catalogue be
-- loaded — and the runtime role, which has no privileges on these tables at all,
-- gains none.
--
-- The segmentation lives on the **version**, not on the program. A published version
-- is fixed, and what it was published for is part of what it is: republishing content
-- and re-aiming it are the same act. Days per week and duration are deliberately
-- **not** stored — they are derived from `program_version_sessions`, because storing
-- them would be a second truth about the same number, and frequency is precisely the
-- axis people choose on.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- 1 · The scope, backfilled from the owner each row already has.

alter table planning.session_templates
  add column content_scope catalog.content_scope;
alter table planning.programs
  add column content_scope catalog.content_scope;

update planning.session_templates
set content_scope = case
  when owner_organization_id is not null then 'organization'::catalog.content_scope
  else 'person'::catalog.content_scope
end;
update planning.programs
set content_scope = case
  when owner_organization_id is not null then 'organization'::catalog.content_scope
  else 'person'::catalog.content_scope
end;

alter table planning.session_templates
  alter column content_scope set not null;
alter table planning.programs
  alter column content_scope set not null;

-- Global content is not signed by a person. Keeping `author_person_id` mandatory
-- would have forced a fake platform person into `identity.people`, which is a real
-- Fitness ID that nobody uses.
alter table planning.session_templates
  alter column author_person_id drop not null;
alter table planning.programs
  alter column author_person_id drop not null;

alter table planning.session_templates
  drop constraint ck_session_templates_owner_xor,
  add constraint ck_session_templates_scope_owner check (
    content_scope = 'global'
      and num_nonnulls(owner_organization_id, owner_person_id) = 0
    or content_scope = 'organization'
      and owner_organization_id is not null and owner_person_id is null
    or content_scope = 'person'
      and owner_person_id is not null and owner_organization_id is null
  ),
  add constraint ck_session_templates_author_scope check (
    (author_person_id is null) = (content_scope = 'global')
  );

alter table planning.programs
  drop constraint ck_programs_owner_xor,
  add constraint ck_programs_scope_owner check (
    content_scope = 'global'
      and num_nonnulls(owner_organization_id, owner_person_id) = 0
    or content_scope = 'organization'
      and owner_organization_id is not null and owner_person_id is null
    or content_scope = 'person'
      and owner_person_id is not null and owner_organization_id is null
  ),
  add constraint ck_programs_author_scope check (
    (author_person_id is null) = (content_scope = 'global')
  );

-- The catalogue is read by scope and status, never by owner: the global rows have
-- none, so the existing owner indexes cannot serve that query.
create index idx_session_templates_scope_status
  on planning.session_templates (content_scope, status, id);
create index idx_programs_scope_status
  on planning.programs (content_scope, status, id);

-- 2 · Reading the catalogue.

-- Separate policies rather than a wider `using` on the existing `for all` ones. A
-- `for all` policy applies `using` to DELETE as well, so widening it would have made
-- global content deletable by anything that could read it.
create policy session_templates_select_global on planning.session_templates
  for select to allfit_owner
  using (content_scope = 'global' and status = 'published' and access_control.person() is not null);

create policy programs_select_global on planning.programs
  for select to allfit_owner
  using (content_scope = 'global' and status = 'published' and access_control.person() is not null);

-- 3 · Who a version is for.

-- Nullable because most content has no lean, and a column rather than a table
-- because it is one value: the affinity **orders and never filters**, so everybody
-- sees the same catalogue and somebody who declined needs no rule of their own.
alter table planning.program_versions
  add column sex_affinity identity.biological_sex;

create table planning.program_version_goals (
  program_version_id uuid not null,
  goal_code text not null,
  constraint pk_program_version_goals primary key (program_version_id, goal_code),
  constraint fk_program_version_goals_version foreign key (program_version_id) references planning.program_versions(id) on delete cascade,
  -- Closed rather than a foreign key: `identity.profile_attributes` holds the
  -- vocabulary in a `text[]`, which nothing can reference. The same narrowing
  -- `body_progress_records.metric_code` used, and for the same reason — a typo would
  -- otherwise invent a goal in silence.
  constraint ck_program_version_goals_code check (
    goal_code in ('lose_weight', 'build_muscle', 'get_fit', 'run_a_race', 'maintain')
  )
);

create table planning.program_version_levels (
  program_version_id uuid not null,
  experience_code text not null,
  constraint pk_program_version_levels primary key (program_version_id, experience_code),
  constraint fk_program_version_levels_version foreign key (program_version_id) references planning.program_versions(id) on delete cascade,
  constraint ck_program_version_levels_code check (
    experience_code in ('starting', 'some_practice', 'experienced')
  )
);

create table planning.program_version_emphases (
  program_version_id uuid not null,
  focus_area_code text not null,
  constraint pk_program_version_emphases primary key (program_version_id, focus_area_code),
  constraint fk_program_version_emphases_version foreign key (program_version_id) references planning.program_versions(id) on delete cascade,
  constraint ck_program_version_emphases_code check (
    focus_area_code in ('chest', 'back', 'shoulders', 'arms', 'abs', 'glutes', 'legs', 'whole_body')
  )
);

-- The catalogue is resolved from the declared answer inwards: goal first, then level.
create index idx_program_version_goals_code
  on planning.program_version_goals (goal_code, program_version_id);
create index idx_program_version_levels_code
  on planning.program_version_levels (experience_code, program_version_id);
create index idx_program_version_emphases_code
  on planning.program_version_emphases (focus_area_code, program_version_id);

alter table planning.program_version_goals enable row level security;
alter table planning.program_version_goals force row level security;
alter table planning.program_version_levels enable row level security;
alter table planning.program_version_levels force row level security;
alter table planning.program_version_emphases enable row level security;
alter table planning.program_version_emphases force row level security;

-- Segmentation inherits from its version, exactly as steps and targets do. It is
-- immutable with it: re-aiming a published version means publishing another one.
create policy program_version_goals_all_actor_access on planning.program_version_goals
  for all to allfit_owner
  using (exists (
    select 1 from planning.program_versions as version
    where version.id = program_version_goals.program_version_id))
  with check (exists (
    select 1 from planning.program_versions as version
    where version.id = program_version_goals.program_version_id));

create policy program_version_levels_all_actor_access on planning.program_version_levels
  for all to allfit_owner
  using (exists (
    select 1 from planning.program_versions as version
    where version.id = program_version_levels.program_version_id))
  with check (exists (
    select 1 from planning.program_versions as version
    where version.id = program_version_levels.program_version_id));

create policy program_version_emphases_all_actor_access on planning.program_version_emphases
  for all to allfit_owner
  using (exists (
    select 1 from planning.program_versions as version
    where version.id = program_version_emphases.program_version_id))
  with check (exists (
    select 1 from planning.program_versions as version
    where version.id = program_version_emphases.program_version_id));

alter table planning.program_version_goals owner to allfit_owner;
alter table planning.program_version_levels owner to allfit_owner;
alter table planning.program_version_emphases owner to allfit_owner;

revoke all on planning.program_version_goals from public;
revoke all on planning.program_version_levels from public;
revoke all on planning.program_version_emphases from public;

-- 4 · The two Studio commands now say which scope they create.
--
-- They only ever made organization content, so the value is not a choice; it is
-- stated rather than defaulted because a default on `content_scope` would let a
-- future insert that forgets it land in the wrong scope in silence.

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
    content_scope, owner_organization_id, discipline_code, author_person_id
  ) values ('organization', p_organization_id, p_discipline_code, p_person_id)
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
  insert into planning.programs (content_scope, owner_organization_id, author_person_id)
  values ('organization', p_organization_id, p_person_id) returning id into program_id;
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

commit;
