-- A strength step stops being two numbers, and a routine can be found again.
--
-- `ADR-030`. A strength prescription was `target_sets` and `target_reps` — four sets of
-- eight are literally the integer 4 and the integer 8 hanging off the step. Nobody does
-- four identical sets: the first warms up light, the middle ones are work, the last goes
-- to failure and its rep count is whatever comes out. `planning.planned_sets` is one row
-- per set, and `planning.set_kind` is the closed vocabulary behind it.
--
-- **The aggregate survives as a derived summary.** Everything that reads a published
-- version today — the agenda, today's session, the week, the whole execution side —
-- reads `strength_targets`, and none of it learns about sets. `materialize_target` now
-- computes the summary from the rows at publication, and `IX-47` refuses a summary that
-- disagrees with them, so there is one truth and one convenience rather than two truths.
--
-- **A superset is a column.** Chaining only works with the neighbouring exercise, so
-- `superset_group` plus the contiguity trigger (`IX-46`) says exactly what a group table
-- would say. A chain that skips an exercise describes an order nobody can execute.
--
-- Three functions move together or the hash and the rows separate: the draft validator
-- decides what content is legal, `canonical_target` decides what enters the publication
-- hash, and `materialize_target` writes the rows. A key accepted by one and ignored by
-- another is two routines that publish as the same version.
--
-- And two operations the screen has been missing. `OP-PLN-023` reads a draft back —
-- without it a saved draft is unreachable, which is why every routine anybody started
-- is still sitting in this database with no way to open it. `OP-PLN-028` discards one,
-- as a state and never as a deletion: `allfit_api` has no `DELETE` here and does not
-- need one.

set lock_timeout = '5s';
set statement_timeout = '60s';

begin;

-- Structure of the prescription, not content somebody browses, so it lives in
-- `planning` rather than in `catalog`.
create type planning.set_kind as enum ('normal', 'warmup', 'to_failure', 'drop');

alter table planning.planned_steps
  add column superset_group smallint,
  add constraint ck_planned_steps_superset_group check (superset_group is null or superset_group > 0);

create table planning.planned_sets (
  id uuid not null default extensions.uuid_generate_v7(),
  planned_step_id uuid not null,
  set_order integer not null,
  kind planning.set_kind not null default 'normal',
  target_reps integer,
  target_load_value numeric,
  target_load_unit_code text,
  target_rpe numeric,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_planned_sets primary key (id),
  constraint uq_planned_sets_order unique (planned_step_id, set_order),
  constraint fk_planned_sets_step foreign key (planned_step_id) references planning.planned_steps(id) on delete cascade,
  constraint fk_planned_sets_unit foreign key (target_load_unit_code) references catalog.units(code) on update cascade on delete restrict,
  constraint ck_planned_sets_order check (set_order > 0),
  constraint ck_planned_sets_reps check (target_reps is null or target_reps > 0),
  -- "Until you cannot" and "until eight" are different instructions; a number here
  -- would be a contradiction stored.
  constraint ck_planned_sets_failure_has_no_reps check (kind <> 'to_failure' or target_reps is null),
  constraint ck_planned_sets_load check (
    (target_load_value is null) = (target_load_unit_code is null)
    and (target_load_value is null or target_load_value >= 0)
  ),
  constraint ck_planned_sets_rpe check (target_rpe is null or target_rpe between 0 and 10)
);

create index idx_planned_sets_step on planning.planned_sets (planned_step_id, set_order);

-- The same owner as its sisters, or the policy below names a role with no privileges.
alter table planning.planned_sets owner to allfit_owner;

alter table planning.planned_sets enable row level security;
alter table planning.planned_sets force row level security;

-- The same shape as its sisters: visibility is the step's, which is the version's,
-- which is the template's.
create policy planned_sets_all_actor_access on planning.planned_sets for all to allfit_owner
  using (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ))
  with check (exists (
    select 1 from planning.planned_steps as step where step.id = planned_step_id
  ));

grant select, insert on planning.planned_sets to allfit_api;

-- Without these three it would be the one mutable child of an immutable version.
create trigger trg_planned_sets_before_mutation_immutable
before update or delete on planning.planned_sets
for each row execute function planning.prevent_immutable_child_mutation();

create trigger trg_planned_sets_before_insert_publication
before insert on planning.planned_sets
for each row execute function planning.allow_publication_insert();

commit;

begin;

-- `IX-46`. Contiguity is what makes a column enough: a chain is a run of neighbours,
-- and encadenar the first with the fifth would describe an order nobody can execute.
create or replace function planning.enforce_superset_contiguity_ct()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  offending record;
begin
  select grouped.template_version_id, grouped.superset_group into offending
  from (
    select
      step.template_version_id,
      step.superset_group,
      count(*) as members,
      max(step.position) - min(step.position) + 1 as span
    from planning.planned_steps as step
    where step.superset_group is not null
      and step.template_version_id = coalesce(new.template_version_id, old.template_version_id)
    group by step.template_version_id, step.superset_group
  ) as grouped
  where grouped.members <> grouped.span
  limit 1;

  if offending.superset_group is not null then
    raise exception 'superset group % is not contiguous', offending.superset_group
      using errcode = '23514';
  end if;
  return null;
end
$function$;

alter function planning.enforce_superset_contiguity_ct() owner to allfit_owner;
revoke all on function planning.enforce_superset_contiguity_ct() from public, allfit_api;

create constraint trigger trg_planned_steps_after_write_superset
after insert or update on planning.planned_steps
deferrable initially deferred
for each row execute function planning.enforce_superset_contiguity_ct();

-- `IX-47`. The summary is derived, so it is checked against the rows rather than
-- trusted. Deferred because publication writes the target and its sets in one
-- transaction and the order between them is nobody's business.
create or replace function planning.enforce_derived_strength_summary_ct()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  counted integer;
  agreed integer;
begin
  select count(*) into counted
  from planning.planned_sets as planned where planned.planned_step_id = new.planned_step_id;

  -- A target with no rows at all is a step from before this migration ran; the
  -- backfill below leaves none, and publication always writes both.
  if counted = 0 then return null; end if;

  if counted <> new.target_sets then
    raise exception 'target_sets is derived and disagrees with % planned sets', counted
      using errcode = '23514';
  end if;

  select case when count(distinct coalesce(planned.target_reps, -1)) = 1
              then max(planned.target_reps) end
  into agreed
  from planning.planned_sets as planned where planned.planned_step_id = new.planned_step_id;

  if new.target_reps is distinct from agreed then
    raise exception 'target_reps is derived and disagrees with the planned sets'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

alter function planning.enforce_derived_strength_summary_ct() owner to allfit_owner;
revoke all on function planning.enforce_derived_strength_summary_ct() from public, allfit_api;

create constraint trigger trg_strength_targets_after_write_derived
after insert or update on planning.strength_targets
deferrable initially deferred
for each row execute function planning.enforce_derived_strength_summary_ct();

commit;

begin;

-- Everything already published becomes N identical sets, which is what it always meant.
-- Done with the publication flag on, because the rows below belong to versions that are
-- immutable and the insert trigger is doing its job.
select set_config('app.planning_publication', 'true', true);

insert into planning.planned_sets (planned_step_id, set_order, kind, target_reps, target_load_value, target_load_unit_code, target_rpe)
select
  target.planned_step_id,
  ordinal,
  'normal'::planning.set_kind,
  target.target_reps,
  target.target_load_value,
  target.target_load_unit_code,
  target.target_rpe
from planning.strength_targets as target
cross join lateral generate_series(1, target.target_sets) as ordinal
where not exists (
  select 1 from planning.planned_sets as existing
  where existing.planned_step_id = target.planned_step_id
);

commit;

begin;

-- The version projection carries the sets and the chain, because deriving a draft from
-- a published version rebuilds the content from exactly this. Without them, deriving
-- would silently flatten a routine back to two numbers.
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
          'superset_group', step.superset_group,
          'target', case
            when strength.id is not null then
              jsonb_strip_nulls(to_jsonb(strength) - array['id', 'planned_step_id'])
              || jsonb_build_object('family', 'strength')
              || jsonb_build_object('sets', coalesce((
                   select jsonb_agg(jsonb_strip_nulls(to_jsonb(planned) - array['id', 'planned_step_id', 'created_at'])
                                    order by planned.set_order)
                   from planning.planned_sets as planned
                   where planned.planned_step_id = step.id
                 ), '[]'::jsonb))
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

-- What enters the publication hash. The sets are in it: two routines that differ in one
-- set are two routines, and hashing only the summary would publish them as one version.
create or replace function planning.canonical_target(p_target jsonb)
returns jsonb
language sql
immutable strict
set search_path = pg_catalog
as $function$
  select case p_target->>'family'
    when 'strength' then jsonb_strip_nulls(jsonb_build_object(
      'family', 'strength',
      'target_sets', coalesce(
        nullif(jsonb_array_length(coalesce(p_target->'sets', '[]'::jsonb)), 0),
        nullif(p_target->>'target_sets', '')::integer
      ),
      'target_reps', case
        when jsonb_typeof(p_target->'sets') = 'array'
          then (select case when count(distinct coalesce((one->>'target_reps')::integer, -1)) = 1
                            then max((one->>'target_reps')::integer) end
                from jsonb_array_elements(p_target->'sets') as one)
        else nullif(p_target->>'target_reps', '')::integer
      end,
      'target_load_value', nullif(p_target->>'target_load_value', '')::numeric,
      'target_load_unit_code', nullif(p_target->>'target_load_unit_code', ''),
      'target_rpe', nullif(p_target->>'target_rpe', '')::numeric,
      'target_rest_seconds', nullif(p_target->>'target_rest_seconds', '')::integer,
      'sets', case when jsonb_typeof(p_target->'sets') = 'array' then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'set_order', (one->>'set_order')::integer,
          'kind', coalesce(one->>'kind', 'normal'),
          'target_reps', nullif(one->>'target_reps', '')::integer,
          'target_load_value', nullif(one->>'target_load_value', '')::numeric,
          'target_load_unit_code', nullif(one->>'target_load_unit_code', ''),
          'target_rpe', nullif(one->>'target_rpe', '')::numeric
        )) order by (one->>'set_order')::integer)
        from jsonb_array_elements(p_target->'sets') as one
      ) end
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

-- Writes the rows, and derives the summary from them rather than trusting what arrived.
create or replace function planning.materialize_target(p_step_id uuid, p_target jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  sets jsonb;
  one jsonb;
  counted integer;
  agreed integer;
begin
  case p_target->>'family'
    when 'strength' then
      sets := case when jsonb_typeof(p_target->'sets') = 'array' and jsonb_array_length(p_target->'sets') > 0
                   then p_target->'sets' end;

      if sets is null then
        -- An older draft says how many and how hard, and means that many identical sets.
        counted := (p_target->>'target_sets')::integer;
        agreed := nullif(p_target->>'target_reps', '')::integer;
        sets := (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'set_order', ordinal,
            'kind', 'normal',
            'target_reps', agreed,
            'target_load_value', nullif(p_target->>'target_load_value', '')::numeric,
            'target_load_unit_code', nullif(p_target->>'target_load_unit_code', ''),
            'target_rpe', nullif(p_target->>'target_rpe', '')::numeric
          )) order by ordinal)
          from generate_series(1, counted) as ordinal
        );
      end if;

      for one in select value from jsonb_array_elements(sets) loop
        insert into planning.planned_sets (
          planned_step_id, set_order, kind, target_reps,
          target_load_value, target_load_unit_code, target_rpe
        ) values (
          p_step_id,
          (one->>'set_order')::integer,
          coalesce(one->>'kind', 'normal')::planning.set_kind,
          nullif(one->>'target_reps', '')::integer,
          nullif(one->>'target_load_value', '')::numeric,
          nullif(one->>'target_load_unit_code', ''),
          nullif(one->>'target_rpe', '')::numeric
        );
      end loop;

      counted := jsonb_array_length(sets);
      select case when count(distinct coalesce((each_set->>'target_reps')::integer, -1)) = 1
                  then max((each_set->>'target_reps')::integer) end
      into agreed
      from jsonb_array_elements(sets) as each_set;

      insert into planning.strength_targets (
        planned_step_id, target_sets, target_reps, target_load_value,
        target_load_unit_code, target_rpe, target_rest_seconds
      ) values (
        p_step_id, counted, agreed,
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

begin;

-- The four writers of a planned step, re-emitted so the chain travels with it. Past
-- migrations are immutable, so a column added today reaches them only this way.
--
-- The fork is the one that was losing more than the chain: it copied the strength
-- target row by row and had never learned about `target_rest_seconds`, so taking
-- Allfit's programme quietly dropped the rest between sets.

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
  canonical_content jsonb;
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

  canonical_content := planning.canonical_session_content(draft.content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
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
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title', version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for step in select value from jsonb_array_elements(canonical_content->'steps') order by (value->>'position')::integer loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        version_id, (step->>'position')::integer,
        nullif(step->>'movement_id', '')::uuid,
        nullif(step->>'activity_type_id', '')::uuid,
        nullif(step->>'notes', ''),
        nullif(step->>'superset_group', '')::smallint
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

create or replace function planning.publish_global_session_template(
  p_template_id uuid,
  p_discipline_code text,
  p_content jsonb
)
returns uuid
language plpgsql
set search_path = pg_catalog
as $function$
declare
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  step jsonb;
  step_id uuid;
begin
  -- A null organization is what makes the validator accept global movements and
  -- activity types and reject anything privately owned, which is exactly right here.
  errors := planning.session_content_errors(p_content, null, p_discipline_code, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete global session template' using errcode = '22023', detail = to_json(errors)::text;
  end if;

  insert into planning.session_templates (id, content_scope, discipline_code, status)
  values (p_template_id, 'global', p_discipline_code, 'published')
  on conflict (id) do nothing;

  canonical_content := planning.canonical_session_content(p_content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');

  -- Publishing the same content twice is not a new version. It is the property that
  -- lets the curation script be run again without forking the catalogue.
  select version.id into version_id
  from planning.session_template_versions as version
  where version.template_id = p_template_id and version.content_hash = version_content_hash;
  if version_id is not null then
    return version_id;
  end if;

  insert into planning.session_template_versions (
    template_id, version_number, discipline_code, activity_type_id, title, content_hash
  )
  select p_template_id,
         coalesce(max(existing.version_number), 0) + 1,
         p_discipline_code,
         (canonical_content->>'activity_type_id')::uuid,
         canonical_content->>'title',
         version_content_hash
  from planning.session_template_versions as existing
  where existing.template_id = p_template_id
  returning id into version_id;

  perform set_config('app.planning_publication', 'true', true);
  for step in
    select value from jsonb_array_elements(canonical_content->'steps')
    order by (value->>'position')::integer
  loop
    insert into planning.planned_steps (
      template_version_id, position, movement_id, activity_type_id, notes, superset_group
    ) values (
      version_id, (step->>'position')::integer,
      nullif(step->>'movement_id', '')::uuid,
      nullif(step->>'activity_type_id', '')::uuid,
      nullif(step->>'notes', ''),
      nullif(step->>'superset_group', '')::smallint
    ) returning id into step_id;
    perform planning.materialize_target(step_id, step->'target');
  end loop;

  return version_id;
end
$function$;

create or replace function planning.fork_program_version(p_person_id uuid, p_program_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  source record;
  new_program_id uuid;
  new_version_id uuid;
  mapping jsonb := '{}'::jsonb;
  template record;
  new_template_id uuid;
  new_template_version_id uuid;
  step record;
  new_step_id uuid;
begin
  select version.id, version.title, version.notes, version.content_hash, version.sex_affinity
  into source
  from planning.program_versions as version
  join planning.programs as program on program.id = version.program_id
  where version.id = p_program_version_id
    and version.status = 'published'
    and program.content_scope = 'global'
    and program.status = 'published';
  if source.id is null then
    raise exception 'program version is not forkable' using errcode = '42501';
  end if;

  perform set_config('app.planning_publication', 'true', true);

  -- One copy per distinct template the program composes, remembered so the new
  -- composition points at the person's own versions and never at Allfit's.
  for template in
    select distinct source_version.id as version_id,
           source_version.template_id,
           source_version.discipline_code,
           source_version.activity_type_id,
           source_version.title,
           source_version.content_hash,
           source_template.discipline_code as template_discipline
    from planning.program_version_sessions as composition
    join planning.session_template_versions as source_version
      on source_version.id = composition.template_version_id
    join planning.session_templates as source_template
      on source_template.id = source_version.template_id
    where composition.program_version_id = p_program_version_id
  loop
    insert into planning.session_templates (
      content_scope, owner_person_id, author_person_id, discipline_code, status
    ) values ('person', p_person_id, p_person_id, template.template_discipline, 'published')
    returning id into new_template_id;

    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id, title,
      content_hash, status, published_at
    ) values (
      new_template_id, 1, template.discipline_code, template.activity_type_id,
      template.title, template.content_hash, 'published', clock_timestamp()
    ) returning id into new_template_version_id;

    for step in
      select id, position, movement_id, activity_type_id, notes, superset_group
      from planning.planned_steps
      where template_version_id = template.version_id
      order by position
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        new_template_version_id, step.position, step.movement_id, step.activity_type_id,
        step.notes, step.superset_group
      ) returning id into new_step_id;

      -- The sets come first: `IX-47` compares the summary against them, and the
      -- constraint is deferred so the order inside the transaction does not matter,
      -- but a fork that copied only the summary would flatten the routine.
      insert into planning.planned_sets (
        planned_step_id, set_order, kind, target_reps,
        target_load_value, target_load_unit_code, target_rpe
      )
      select new_step_id, set_order, kind, target_reps,
             target_load_value, target_load_unit_code, target_rpe
      from planning.planned_sets where planned_step_id = step.id;

      insert into planning.strength_targets (
        planned_step_id, target_sets, target_reps, target_load_value,
        target_load_unit_code, target_rpe, target_rest_seconds
      )
      select new_step_id, target_sets, target_reps, target_load_value,
             target_load_unit_code, target_rpe, target_rest_seconds
      from planning.strength_targets where planned_step_id = step.id;

      insert into planning.endurance_targets (
        planned_step_id, target_distance_value, target_distance_unit_code,
        target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      )
      select new_step_id, target_distance_value, target_distance_unit_code,
             target_duration_seconds, target_pace_seconds_per_unit, target_pace_unit_code
      from planning.endurance_targets where planned_step_id = step.id;

      insert into planning.interval_targets (
        planned_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      )
      select new_step_id, rounds, work_duration_seconds, rest_duration_seconds, target_rpe
      from planning.interval_targets where planned_step_id = step.id;

      insert into planning.mobility_targets (
        planned_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      )
      select new_step_id, sequence_position, hold_duration_seconds, target_repetitions, side
      from planning.mobility_targets where planned_step_id = step.id;
    end loop;

    mapping := mapping || jsonb_build_object(template.version_id::text, new_template_version_id);
  end loop;

  insert into planning.programs (content_scope, owner_person_id, author_person_id, status)
  values ('person', p_person_id, p_person_id, 'published')
  returning id into new_program_id;

  insert into planning.program_versions (
    program_id, version_number, title, notes, content_hash, status, published_at, sex_affinity
  ) values (
    new_program_id, 1, source.title, source.notes, source.content_hash,
    'published', clock_timestamp(), source.sex_affinity
  ) returning id into new_version_id;

  insert into planning.program_version_sessions (
    program_version_id, template_version_id, position, week, day
  )
  select new_version_id,
         (mapping->>composition.template_version_id::text)::uuid,
         composition.position, composition.week, composition.day
  from planning.program_version_sessions as composition
  where composition.program_version_id = p_program_version_id;

  -- The segmentation travels with the copy: it is what the catalogue matched on,
  -- and a copy that forgot it would stop being findable as the thing it is.
  insert into planning.program_version_goals (program_version_id, goal_code)
  select new_version_id, goal_code from planning.program_version_goals
  where program_version_id = p_program_version_id;
  insert into planning.program_version_levels (program_version_id, experience_code)
  select new_version_id, experience_code from planning.program_version_levels
  where program_version_id = p_program_version_id;
  insert into planning.program_version_emphases (program_version_id, focus_area_code)
  select new_version_id, focus_area_code from planning.program_version_emphases
  where program_version_id = p_program_version_id;

  return new_version_id;
end
$function$;

create or replace function planning.publish_my_session_template(
  p_person_id uuid,
  p_template_id uuid,
  p_expected_etag text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (version jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  draft planning.session_template_drafts%rowtype;
  template planning.session_templates%rowtype;
  errors text[];
  canonical_content jsonb;
  version_content_hash bytea;
  version_id uuid;
  next_version integer;
  step jsonb;
  step_id uuid;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-003', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_version_projection(receipt.aggregate_id), true;
    return;
  end if;

  select parent.* into template
  from planning.session_templates as parent
  where parent.id = p_template_id and parent.owner_person_id = p_person_id
  for update of parent;
  if template.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;
  select current_draft.* into draft
  from planning.session_template_drafts as current_draft
  where current_draft.template_id = p_template_id
  for update of current_draft;

  if planning.content_etag(draft.content) <> p_expected_etag then
    raise exception 'stale-draft' using errcode = '40001',
      detail = planning.session_draft_projection(draft.id)::text;
  end if;
  -- `require_complete`, so an empty routine is refused here and still saveable as a
  -- draft. `V-G` is the screen that says exactly what is missing.
  errors := planning.session_content_errors(draft.content, null, template.discipline_code, true);
  if cardinality(errors) > 0 then
    raise exception 'incomplete session template draft' using errcode = '22023',
      detail = to_json(errors)::text;
  end if;

  canonical_content := planning.canonical_session_content(draft.content);
  version_content_hash := extensions.digest(convert_to(canonical_content::text, 'UTF8'), 'sha256');
  select existing.id into version_id from planning.session_template_versions as existing
  where existing.template_id = p_template_id and existing.content_hash = version_content_hash;
  if version_id is null then
    select coalesce(max(existing.version_number), 0) + 1 into next_version
    from planning.session_template_versions as existing where existing.template_id = p_template_id;
    insert into planning.session_template_versions (
      template_id, version_number, discipline_code, activity_type_id,
      derived_from_version_id, title, content_hash
    ) values (
      p_template_id, next_version, template.discipline_code,
      (canonical_content->>'activity_type_id')::uuid, draft.derived_from_version_id,
      canonical_content->>'title', version_content_hash
    ) returning id into version_id;

    perform set_config('app.planning_publication', 'true', true);
    for step in
      select value from jsonb_array_elements(canonical_content->'steps')
      order by (value->>'position')::integer
    loop
      insert into planning.planned_steps (
        template_version_id, position, movement_id, activity_type_id, notes, superset_group
      ) values (
        version_id, (step->>'position')::integer,
        nullif(step->>'movement_id', '')::uuid,
        nullif(step->>'activity_type_id', '')::uuid,
        nullif(step->>'notes', ''),
        nullif(step->>'superset_group', '')::smallint
      ) returning id into step_id;
      perform planning.materialize_target(step_id, step->'target');
    end loop;
    update planning.session_templates
    set status = 'published', updated_at = clock_timestamp() where id = p_template_id;
    perform system.enqueue_outbox_event(
      'session_template_version', version_id, 'planning.session_template_version_published.v1',
      jsonb_build_object('template_id', p_template_id, 'version_id', version_id,
                         'version_number', next_version)
    );
  end if;
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'session-template-version-published',
    'session_template_version', version_id
  );
  return query select planning.session_version_projection(version_id), false;
end
$function$;

commit;

begin;

-- The per-set rules, kept apart so the validator above stays readable. A set to
-- failure declares no reps, and the orders are 1..n without gaps: a set 4 with no set 3
-- is a prescription nobody can follow.
create or replace function planning.planned_set_errors(p_sets jsonb)
returns text[]
language plpgsql
stable
set search_path = pg_catalog
as $function$
declare
  errors text[] := array[]::text[];
  one jsonb;
  seen integer := 0;
begin
  for one in select value from jsonb_array_elements(p_sets) order by (value->>'set_order')::text loop
    seen := seen + 1;
    if jsonb_typeof(one) <> 'object'
       or not one ?& array['set_order', 'kind']
       or one - array['set_order', 'kind', 'target_reps', 'target_load_value', 'target_load_unit_code', 'target_rpe'] <> '{}'::jsonb
       or jsonb_typeof(one->'set_order') <> 'number'
       or one->>'set_order' !~ '^[1-9][0-9]*$'
       or jsonb_typeof(one->'kind') <> 'string'
       or one->>'kind' not in ('normal', 'warmup', 'to_failure', 'drop')
       or (one ? 'target_reps' and jsonb_typeof(one->'target_reps') not in ('number', 'null'))
       or (jsonb_typeof(one->'target_reps') = 'number' and one->>'target_reps' !~ '^[1-9][0-9]*$')
       or (jsonb_typeof(one->'target_reps') = 'number' and (one->>'target_reps')::numeric > 2147483647)
       or (one->>'kind' = 'to_failure' and jsonb_typeof(one->'target_reps') = 'number')
       or (one ? 'target_load_value' and jsonb_typeof(one->'target_load_value') not in ('number', 'null'))
       or (jsonb_typeof(one->'target_load_value') = 'number' and (one->>'target_load_value')::numeric < 0)
       or (one ? 'target_load_unit_code' and jsonb_typeof(one->'target_load_unit_code') not in ('string', 'null'))
       or ((coalesce(jsonb_typeof(one->'target_load_value'), 'null') = 'null') <>
           (coalesce(jsonb_typeof(one->'target_load_unit_code'), 'null') = 'null'))
       or (jsonb_typeof(one->'target_load_unit_code') = 'string' and not exists (
         select 1 from catalog.units where code = one->>'target_load_unit_code'
       ))
       or (one ? 'target_rpe' and jsonb_typeof(one->'target_rpe') not in ('number', 'null'))
       or (jsonb_typeof(one->'target_rpe') = 'number' and (one->>'target_rpe')::numeric not between 0 and 10) then
      return array['planned-set'];
    end if;
  end loop;

  if (select count(distinct (value->>'set_order')::integer) from jsonb_array_elements(p_sets)) <> seen
     or (select max((value->>'set_order')::integer) from jsonb_array_elements(p_sets)) <> seen then
    errors := array_append(errors, 'planned-set-order');
  end if;
  return errors;
end
$function$;

alter function planning.planned_set_errors(jsonb) owner to allfit_owner;
revoke all on function planning.planned_set_errors(jsonb) from public;
grant execute on function planning.planned_set_errors(jsonb) to allfit_api;

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
       or step - array['position', 'movement_id', 'activity_type_id', 'notes', 'superset_group', 'target'] <> '{}'::jsonb
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

    -- A chain is a run of neighbours. The contiguity itself is `IX-46`'s job at
    -- publication, because a draft is legitimately half-written; what is refused here
    -- is a value that could never be a group.
    if step ? 'superset_group'
       and jsonb_typeof(step->'superset_group') not in ('number', 'null') then
      errors := array_append(errors, 'superset-group');
    elsif jsonb_typeof(step->'superset_group') = 'number'
          and (step->>'superset_group' !~ '^[1-9][0-9]*$'
               or (step->>'superset_group')::numeric > 200) then
      errors := array_append(errors, 'superset-group');
    end if;

    if declared_family = 'strength' and jsonb_typeof(target->'sets') = 'array' then
      -- The shape this editor writes: the sets are the prescription, and the aggregate
      -- is the summary derived from them. Sending a summary that disagrees is refused
      -- rather than silently recomputed, so nobody has to guess which one was meant.
      if target - array['family', 'sets', 'target_sets', 'target_reps', 'target_load_value', 'target_load_unit_code', 'target_rpe', 'target_rest_seconds'] <> '{}'::jsonb
         or jsonb_array_length(target->'sets') = 0
         or jsonb_array_length(target->'sets') > 200
         or (target ? 'target_sets'
             and (jsonb_typeof(target->'target_sets') <> 'number'
                  or (target->>'target_sets')::numeric <> jsonb_array_length(target->'sets')))
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
         or (jsonb_typeof(target->'target_rest_seconds') = 'number' and (target->>'target_rest_seconds')::numeric > 3600) then
        errors := array_append(errors, 'strength-target');
      else
        errors := errors || planning.planned_set_errors(target->'sets');
      end if;
    elsif declared_family = 'strength'
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

commit;

begin;

-- `OP-PLN-023` on `/space/v1`. The counterpart of the `PUT` that has always been there.
-- Without it a saved draft is unreachable: every routine anybody started is sitting in
-- this table with nothing able to open it.
create or replace function planning.read_my_session_template_draft(p_person_id uuid, p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  draft_id uuid;
begin
  perform planning.assert_own_content(p_person_id);

  select existing.id into draft_id
  from planning.session_template_drafts as existing
  join planning.session_templates as template on template.id = existing.template_id
  where template.id = p_template_id
    and template.owner_person_id = p_person_id
    and template.status <> 'archived';

  -- Absent, discarded and somebody else's answer the same. Telling them apart would
  -- let identifiers be walked to learn which routines exist.
  if draft_id is null then return null; end if;

  return planning.session_draft_projection(draft_id);
end
$function$;

alter function planning.read_my_session_template_draft(uuid, uuid) owner to allfit_owner;
revoke all on function planning.read_my_session_template_draft(uuid, uuid) from public;
grant execute on function planning.read_my_session_template_draft(uuid, uuid) to allfit_api;

-- The Studio mirror. Same projection, organization instead of person.
create or replace function planning.read_session_template_draft(
  p_person_id uuid, p_organization_id uuid, p_template_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  draft_id uuid;
begin
  perform planning.assert_manage_content(p_person_id, p_organization_id);

  select existing.id into draft_id
  from planning.session_template_drafts as existing
  join planning.session_templates as template on template.id = existing.template_id
  where template.id = p_template_id
    and template.owner_organization_id = p_organization_id
    and template.status <> 'archived';

  if draft_id is null then return null; end if;

  return planning.session_draft_projection(draft_id);
end
$function$;

alter function planning.read_session_template_draft(uuid, uuid, uuid) owner to allfit_owner;
revoke all on function planning.read_session_template_draft(uuid, uuid, uuid) from public;
grant execute on function planning.read_session_template_draft(uuid, uuid, uuid) to allfit_api;

-- `OP-PLN-028`. A state and never a deletion: `allfit_api` has no `DELETE` here, and a
-- discard has to be explicable afterwards. The draft row stays where it is and becomes
-- unreachable, which is what every reader above already enforces by excluding
-- `archived`.
create or replace function planning.discard_my_session_template(
  p_person_id uuid,
  p_template_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (template jsonb, replayed boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  current planning.session_templates%rowtype;
begin
  perform planning.assert_own_content(p_person_id);
  select * into receipt from system.begin_idempotency(
    p_person_id, 'OP-PLN-028', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select planning.session_template_projection(receipt.aggregate_id), true;
    return;
  end if;

  select * into current
  from planning.session_templates as template
  where template.id = p_template_id and template.owner_person_id = p_person_id
  for update;
  if current.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  -- A routine with a published version is referenced by programmes and assignments.
  -- Retiring it from new uses is `OP-PLN-005`, which leaves the history alone.
  if exists (
    select 1 from planning.session_template_versions as version
    where version.template_id = p_template_id
  ) then
    raise exception 'template has published versions' using errcode = '23514';
  end if;

  if current.status <> 'archived' then
    update planning.session_templates
    set status = 'archived', updated_at = clock_timestamp()
    where id = p_template_id;
    perform system.enqueue_outbox_event(
      'session_template', p_template_id, 'planning.session_template_discarded.v1',
      jsonb_build_object('template_id', p_template_id)
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'session-template-discarded',
    'session_template', p_template_id
  );
  return query select planning.session_template_projection(p_template_id), false;
end
$function$;

alter function planning.discard_my_session_template(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function planning.discard_my_session_template(uuid, uuid, uuid, uuid, bytea) from public;
grant execute on function planning.discard_my_session_template(uuid, uuid, uuid, uuid, bytea) to allfit_api;

commit;

begin;

-- A discarded routine is gone from the list as well, or discarding would look like it
-- did nothing.
create or replace function planning.read_my_content(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select coalesce(jsonb_agg(item order by sort_key desc), '[]'::jsonb)
  from (
    select
      coalesce(published.published_at, draft.updated_at, template.created_at) as sort_key,
      jsonb_build_object(
        'template_id', template.id,
        'title', coalesce(draft.content->>'title', published.title, 'Sin nombre'),
        'discipline_code', template.discipline_code,
        'status', template.status,
        'template_version_id', published.id,
        'exercise_count', coalesce(published.exercise_count, 0),
        'set_count', coalesce(published.set_count, 0),
        'has_unpublished_changes',
          draft.id is not null
          and (
            published.content_hash is null
            or extensions.digest(
                 convert_to(planning.canonical_session_content(draft.content)::text, 'UTF8'),
                 'sha256'
               ) is distinct from published.content_hash
          )
      ) as item
    from planning.session_templates as template
    left join planning.session_template_drafts as draft on draft.template_id = template.id
    left join lateral (
      select
        version.id,
        version.published_at,
        version.title,
        version.content_hash,
        (select count(*) from planning.planned_steps as step
          where step.template_version_id = version.id) as exercise_count,
        (select coalesce(sum(target.target_sets), 0)
          from planning.planned_steps as step
          join planning.strength_targets as target on target.planned_step_id = step.id
          where step.template_version_id = version.id) as set_count
      from planning.session_template_versions as version
      where version.template_id = template.id
        and version.status = 'published'
      order by version.version_number desc
      limit 1
    ) as published on true
    where template.owner_person_id = p_person_id
      and template.status <> 'archived'
  ) as mine
$function$;

commit;

begin;

-- The canonical content is what publication iterates over and what the hash is taken
-- of, and it rebuilds each step from a fixed list of keys. A key missing here is a key
-- that never reaches the version, however correctly the writer inserts it.
create or replace function planning.canonical_session_content(p_content jsonb)
returns jsonb
language sql
immutable
strict
security invoker
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'title', btrim(p_content->>'title'),
    'activity_type_id', (p_content->>'activity_type_id')::uuid,
    'steps', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'position', (step.value->>'position')::integer,
        'movement_id', nullif(step.value->>'movement_id', '')::uuid,
        'activity_type_id', nullif(step.value->>'activity_type_id', '')::uuid,
        'notes', nullif(step.value->>'notes', ''),
        'superset_group', nullif(step.value->>'superset_group', '')::smallint,
        'target', planning.canonical_target(step.value->'target')
      )) order by (step.value->>'position')::integer)
      from jsonb_array_elements(p_content->'steps') as step(value)
    ), '[]'::jsonb)
  )
$function$;

commit;
