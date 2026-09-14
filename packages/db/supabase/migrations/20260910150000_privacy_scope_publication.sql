-- Published permission definitions: `HU-BO-024`, `OP-PRV-011`.
--
-- What a person is agreeing to when they grant a permission, written down as a
-- versioned, immutable list of resources and fields — included and excluded.
--
-- Criterion 3 is the one that shapes the schema: *publishing a wider version
-- does not widen what was already granted*. That is not enforced by a check at
-- publish time; it is enforced by making a grant point at a specific version and
-- making that version unable to change. A grant that referenced "the scope" by
-- code alone would silently follow every future publication, which is exactly
-- the failure this story exists to prevent. Hence the carrier key
-- `UNIQUE (id, scope_code)` from the data dictionary: a grant references the pair,
-- so it cannot drift onto another version.
--
-- `privacy.data_grants` does not exist yet, so the half of criterion 3 that
-- involves an actual grant cannot be proven here. What is proven is the half that
-- makes it possible: versions are independently addressable and a published one
-- can never be rewritten.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type privacy.access_level as enum ('read', 'contribute');

-- ---------------------------------------------------------------------------
-- Sensitivity catalogue
-- ---------------------------------------------------------------------------

create table privacy.data_classifications (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  -- Higher means more sensitive. A rule that spans classifications inherits the
  -- most restrictive one, so the ranking has to be a number rather than an order
  -- of insertion.
  sensitivity_rank integer not null,
  constraint pk_data_classifications primary key (id),
  constraint uq_data_classifications_code unique (code),
  constraint ck_data_classifications_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_data_classifications_name check (btrim(name) <> ''),
  constraint ck_data_classifications_rank check (sensitivity_rank between 0 and 100)
);

alter table privacy.data_classifications enable row level security;
alter table privacy.data_classifications force row level security;

create policy data_classifications_select_authenticated on privacy.data_classifications
for select
using (access_control.person() is not null);

comment on table privacy.data_classifications is
  'Sensitivity levels used by scope rules, attributes and disposition.';

insert into privacy.data_classifications (code, name, sensitivity_rank)
values
  ('operational', 'Operativo', 10),
  ('audit', 'Auditoría', 20),
  ('identity_pii', 'Identidad', 40),
  ('training', 'Entrenamiento', 50),
  ('body', 'Cuerpo', 70),
  ('nutrition', 'Nutrición', 80),
  ('health', 'Salud', 90);

-- ---------------------------------------------------------------------------
-- The published version of a scope
-- ---------------------------------------------------------------------------

create table privacy.scope_definitions (
  id uuid not null default extensions.uuid_generate_v7(),
  scope_code text not null,
  version_number integer not null,
  status catalog.publication_status not null default 'draft',
  published_at timestamptz,
  constraint pk_scope_definitions primary key (id),
  constraint uq_scope_definitions_version unique (scope_code, version_number),
  -- The carrier key criterion 3 depends on: a grant references the pair, so it
  -- can never drift onto a later version of the same scope.
  constraint uq_scope_definitions_carrier unique (id, scope_code),
  constraint ck_scope_definitions_code check (scope_code in ('relationship_training', 'prior_training_history', 'body_progress', 'health_context', 'nutrition_intake', 'nutrition_guidance', 'nutrition_media')),
  constraint ck_scope_definitions_version check (version_number >= 1),
  constraint ck_scope_definitions_published check ((status = 'published') = (published_at is not null))
);

create index idx_scope_definitions_effective on privacy.scope_definitions (scope_code, version_number desc) where status = 'published';

alter table privacy.scope_definitions enable row level security;
alter table privacy.scope_definitions force row level security;

create policy scope_definitions_select_published on privacy.scope_definitions
for select
using (status = 'published' and access_control.person() is not null);

-- Curation reads its own drafts: publishing the next version means reading what
-- the previous one said, and the read policy above hides everything unpublished.
create policy scope_definitions_select_platform on privacy.scope_definitions
for select
using (access_control.actor_kind() = 'support');

create policy scope_definitions_insert_platform on privacy.scope_definitions
for insert
with check (access_control.actor_kind() = 'support');

create policy scope_definitions_update_platform on privacy.scope_definitions
for update
using (access_control.actor_kind() = 'support');

comment on table privacy.scope_definitions is
  'Immutable published version of a V1 scope. A grant references (id, scope_code).';

-- ---------------------------------------------------------------------------
-- What the version covers, field by field
-- ---------------------------------------------------------------------------

create table privacy.scope_resource_rules (
  id uuid not null default extensions.uuid_generate_v7(),
  scope_definition_id uuid not null,
  resource text not null,
  field text not null,
  data_classification_code text not null,
  max_action privacy.access_level not null,
  is_excluded boolean not null default false,
  -- Whether the field may be read for periods before the grant existed. It is
  -- opt-in and never applies to something the scope excludes.
  historical_readable boolean not null default false,
  constraint pk_scope_resource_rules primary key (id),
  constraint fk_scope_resource_rules_definition foreign key (scope_definition_id) references privacy.scope_definitions (id) on delete cascade,
  constraint fk_scope_resource_rules_classification foreign key (data_classification_code) references privacy.data_classifications (code) on delete restrict,
  constraint uq_scope_resource_rules_field unique (scope_definition_id, resource, field),
  constraint ck_scope_resource_rules_resource check (resource ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  constraint ck_scope_resource_rules_field check (field ~ '^[a-z][a-z0-9_]{0,63}$' or field = '*'),
  constraint ck_scope_resource_rules_historical check (not historical_readable or (not is_excluded and max_action = 'read'))
);

alter table privacy.scope_resource_rules enable row level security;
alter table privacy.scope_resource_rules force row level security;

create policy scope_resource_rules_select_published on privacy.scope_resource_rules
for select
using (
  access_control.person() is not null
  and exists (
    select 1 from privacy.scope_definitions as definition
    where definition.id = scope_resource_rules.scope_definition_id
      and definition.status = 'published'
  )
);

create policy scope_resource_rules_select_platform on privacy.scope_resource_rules
for select
using (access_control.actor_kind() = 'support');

create policy scope_resource_rules_insert_platform on privacy.scope_resource_rules
for insert
with check (access_control.actor_kind() = 'support');

comment on table privacy.scope_resource_rules is
  'Resources, fields, exclusions and maximum action of one scope version.';

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

-- Criterion 2, enforced by the table rather than by the function that writes it.
-- The only legal transition is draft to published; after that the row and its
-- rules are frozen, because grants and historical reads depend on what it said.
create or replace function privacy.prevent_published_scope_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a scope definition is never deleted' using errcode = '55000';
  end if;
  if old.status = 'published' then
    raise exception 'a published scope version is immutable: publish the next one'
      using errcode = '55000';
  end if;
  if new.scope_code is distinct from old.scope_code
    or new.version_number is distinct from old.version_number then
    raise exception 'a scope version keeps its code and number' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_scope_definitions_immutable
before update or delete on privacy.scope_definitions
for each row execute function privacy.prevent_published_scope_mutation();

create or replace function privacy.prevent_published_scope_rule_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  owner_status catalog.publication_status;
begin
  select definition.status into owner_status
  from privacy.scope_definitions as definition
  where definition.id = coalesce(new.scope_definition_id, old.scope_definition_id);

  if owner_status = 'published' then
    raise exception 'the rules of a published scope version are immutable'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end
$function$;

create trigger trg_scope_resource_rules_immutable
before insert or update or delete on privacy.scope_resource_rules
for each row execute function privacy.prevent_published_scope_rule_mutation();

-- ---------------------------------------------------------------------------
-- OP-PRV-011 — publish a scope version
-- ---------------------------------------------------------------------------

create or replace function privacy.scope_definition_projection(p_definition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', definition.id,
    'scope_code', definition.scope_code,
    'version_number', definition.version_number,
    'status', definition.status,
    'published_at', definition.published_at,
    'rules', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'resource', rule.resource,
            'field', rule.field,
            'data_classification_code', rule.data_classification_code,
            'max_action', rule.max_action,
            'is_excluded', rule.is_excluded,
            'historical_readable', rule.historical_readable
          )
          order by rule.is_excluded, rule.resource, rule.field
        )
        from privacy.scope_resource_rules as rule
        where rule.scope_definition_id = definition.id
      ),
      '[]'::jsonb
    )
  )
  from privacy.scope_definitions as definition
  where definition.id = p_definition_id
$function$;

-- The version number is the server's to assign, never the client's: two curators
-- publishing at once produce two versions rather than a race.
create or replace function privacy.publish_scope_definition(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_scope_code text,
  p_rules jsonb,
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
  definition_id uuid;
  next_version integer;
  candidate jsonb;
  included integer := 0;
  response jsonb;
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);

  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) = 0 then
    raise exception 'a scope version enumerates at least one resource and field'
      using errcode = '22023';
  end if;

  -- Criterion 1 asks what a permission includes *and* excludes. A version that
  -- includes nothing grants nothing, so it is refused rather than published as a
  -- permission that means nothing.
  for candidate in select * from jsonb_array_elements(p_rules) loop
    if not coalesce((candidate->>'is_excluded')::boolean, false) then
      included := included + 1;
    end if;
  end loop;
  if included = 0 then
    raise exception 'a scope version that includes nothing is not a permission'
      using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-PRV-011', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select privacy.scope_definition_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent scope publication not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  select coalesce(max(definition.version_number), 0) + 1 into next_version
  from privacy.scope_definitions as definition
  where definition.scope_code = p_scope_code;

  insert into privacy.scope_definitions (scope_code, version_number, status)
  values (p_scope_code, next_version, 'draft')
  returning id into definition_id;

  insert into privacy.scope_resource_rules (
    scope_definition_id, resource, field, data_classification_code, max_action,
    is_excluded, historical_readable
  )
  select
    definition_id,
    rule->>'resource',
    rule->>'field',
    rule->>'data_classification_code',
    (rule->>'max_action')::privacy.access_level,
    coalesce((rule->>'is_excluded')::boolean, false),
    coalesce((rule->>'historical_readable')::boolean, false)
  from jsonb_array_elements(p_rules) as rule;

  -- Published last, so the immutability triggers guard a version whose rules are
  -- already complete. Publishing first would freeze an empty one.
  update privacy.scope_definitions
  set status = 'published', published_at = clock_timestamp()
  where id = definition_id;

  perform system.enqueue_outbox_event(
    'scope_definition', definition_id, 'privacy.scope_definition_published.v1',
    jsonb_build_object(
      'scope_definition_id', definition_id,
      'scope_code', p_scope_code,
      'version_number', next_version
    )
  );

  response := privacy.scope_definition_projection(definition_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'scope-definition-published',
    'scope_definition', definition_id
  );
  return query select response, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PRV-011 — read what is published
-- ---------------------------------------------------------------------------

create or replace function privacy.list_scope_definitions(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns table (result jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform catalog.require_global_catalog_curator(p_actor_person_id, p_actor_session_id);

  return query
  select privacy.scope_definition_projection(definition.id)
  from privacy.scope_definitions as definition
  where definition.status = 'published'
  order by definition.scope_code, definition.version_number desc;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter table privacy.data_classifications owner to allfit_owner;
alter table privacy.scope_definitions owner to allfit_owner;
alter table privacy.scope_resource_rules owner to allfit_owner;
alter function privacy.prevent_published_scope_mutation() owner to allfit_owner;
alter function privacy.prevent_published_scope_rule_mutation() owner to allfit_owner;
alter function privacy.scope_definition_projection(uuid) owner to allfit_owner;
alter function privacy.publish_scope_definition(uuid, uuid, text, jsonb, uuid, uuid, bytea) owner to allfit_owner;
alter function privacy.list_scope_definitions(uuid, uuid) owner to allfit_owner;

revoke all on table privacy.data_classifications from public;
revoke all on table privacy.scope_definitions from public;
revoke all on table privacy.scope_resource_rules from public;
revoke all on function privacy.scope_definition_projection(uuid) from public;
revoke all on function privacy.publish_scope_definition(uuid, uuid, text, jsonb, uuid, uuid, bytea) from public;
revoke all on function privacy.list_scope_definitions(uuid, uuid) from public;

grant select on table privacy.data_classifications to allfit_api;
grant execute on function privacy.publish_scope_definition(uuid, uuid, text, jsonb, uuid, uuid, bytea) to allfit_api;
grant execute on function privacy.list_scope_definitions(uuid, uuid) to allfit_api;
