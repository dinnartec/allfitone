-- The two halves of a consent: what the person decided, and what that leaves
-- in force today.
--
-- `consent_events` is the decision with the exact wording that produced it,
-- append-only and classified as audit. `data_grants` is the answer to "may
-- this be read right now", and it is the row the system consults before every
-- read of a person's data.
--
-- They are separate because they answer different questions and age
-- differently. A decision is history and never changes; a grant moves through
-- states as the relationship does. Storing only the second would make it
-- impossible to show what someone was told when they agreed.
--
-- The state that carries the most weight is `frozen`, and the distinction is
-- the one the dictionary insists on: ending a relationship freezes a grant, so
-- the organization keeps the history it already had and nothing after the cut;
-- the person revoking consent revokes it, and that is the end of all access.
-- Different paths, different outcomes, and neither is the other's synonym.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type privacy.grant_status as enum ('active', 'frozen', 'revoked');
alter type privacy.grant_status owner to allfit_owner;

create table privacy.consent_events (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  relationship_id uuid not null,
  organization_id uuid not null,
  invitation_scope_option_id uuid not null,
  scope_definition_id uuid not null,
  scope_code text not null,
  decision privacy.consent_decision not null,
  presented_snapshot_schema_version smallint not null default 1,
  presented_snapshot jsonb not null,
  decided_at timestamptz not null default clock_timestamp(),
  constraint pk_consent_events primary key (id),
  constraint fk_consent_events_relationship foreign key (relationship_id, person_id, organization_id) references relationships.service_relationships(id, person_id, organization_id) on delete restrict,
  -- IX-05: the decision points at the exact option it answered, under the
  -- exact scope version that option offered.
  constraint fk_consent_events_option foreign key (invitation_scope_option_id, scope_definition_id, scope_code) references privacy.invitation_scope_options(id, scope_definition_id, scope_code) on delete restrict,
  constraint fk_consent_events_scope foreign key (scope_definition_id, scope_code) references privacy.scope_definitions(id, scope_code) on delete restrict,
  constraint uq_consent_events_carrier unique (id, person_id, relationship_id, organization_id, scope_definition_id, scope_code),
  constraint ck_consent_events_snapshot_version check (presented_snapshot_schema_version = 1),
  constraint ck_consent_events_snapshot check (jsonb_typeof(presented_snapshot) = 'object')
);

create index idx_consent_events_person
  on privacy.consent_events (person_id, decided_at desc);
create index idx_consent_events_relationship
  on privacy.consent_events (relationship_id, scope_code, decided_at desc);
create index idx_consent_events_organization
  on privacy.consent_events (organization_id, decided_at desc);

alter table privacy.consent_events owner to allfit_owner;

/*
 * Append-only in the table, not in the grants. `privacy.access_events` learned
 * this the hard way: with immutability resting on nobody holding a permission,
 * both UPDATE and DELETE succeeded for anyone who did. A record of consent
 * that can be rewritten is not a record of consent.
 */
create or replace function privacy.reject_consent_event_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'privacy.consent_events is append-only' using errcode = '42501';
end
$function$;

alter function privacy.reject_consent_event_rewrite() owner to allfit_owner;
revoke all on function privacy.reject_consent_event_rewrite() from public, allfit_api;

create trigger trg_consent_events_reject_rewrite
before update or delete on privacy.consent_events
for each row execute function privacy.reject_consent_event_rewrite();

create table privacy.data_grants (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  relationship_id uuid not null,
  organization_id uuid not null,
  scope_definition_id uuid not null,
  scope_code text not null,
  consent_event_id uuid not null,
  access_level privacy.access_level not null,
  purpose text not null,
  status privacy.grant_status not null default 'active',
  granted_at timestamptz not null default clock_timestamp(),
  frozen_at timestamptz,
  revoked_at timestamptz,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_data_grants primary key (id),
  constraint fk_data_grants_relationship foreign key (relationship_id, person_id, organization_id) references relationships.service_relationships(id, person_id, organization_id) on delete restrict,
  constraint fk_data_grants_scope foreign key (scope_definition_id, scope_code) references privacy.scope_definitions(id, scope_code) on delete restrict,
  -- IX-07: a grant cannot exist without the decision that produced it, and
  -- cannot drift onto a decision about a different person, relationship or
  -- scope.
  constraint fk_data_grants_consent foreign key (consent_event_id, person_id, relationship_id, organization_id, scope_definition_id, scope_code) references privacy.consent_events(id, person_id, relationship_id, organization_id, scope_definition_id, scope_code) on delete restrict,
  constraint ck_data_grants_purpose check (btrim(purpose) <> ''),
  -- Each state says exactly which cuts it may carry.
  constraint ck_data_grants_active check (status <> 'active' or (frozen_at is null and revoked_at is null)),
  constraint ck_data_grants_frozen check (status <> 'frozen' or (frozen_at is not null and revoked_at is null)),
  constraint ck_data_grants_revoked check (status <> 'revoked' or revoked_at is not null)
);

-- At most one grant per scope that has not been revoked, whatever versions
-- came before it.
create unique index uidx_data_grants_live
  on privacy.data_grants (relationship_id, scope_code)
  where status in ('active', 'frozen');

-- The dictionary calls this the most critical index in the system: it is what
-- every read of a person's data consults before returning anything.
create index idx_data_grants_relationship_scope_status
  on privacy.data_grants (relationship_id, scope_code, status);
create index idx_data_grants_person_status
  on privacy.data_grants (person_id, status);
create index idx_data_grants_organization_status
  on privacy.data_grants (organization_id, status);
create index idx_data_grants_frozen_window
  on privacy.data_grants (relationship_id, scope_code, frozen_at)
  where status = 'frozen';

alter table privacy.data_grants owner to allfit_owner;

create trigger trg_data_grants_before_update_timestamp
before update on privacy.data_grants
for each row execute function access_control.set_updated_at();

/*
 * A grant only ever closes further. Reopening one would mean an organization
 * regained access the person had ended, without the person deciding anything,
 * and a cut already recorded is evidence of when access stopped — moving it
 * would rewrite that.
 */
create or replace function privacy.enforce_data_grant_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if old.status in ('frozen', 'revoked') and new.status = 'active' then
    raise exception 'a grant cannot be reopened' using errcode = '23514';
  end if;
  if old.status = 'revoked' and new.status = 'frozen' then
    raise exception 'a revoked grant cannot be frozen' using errcode = '23514';
  end if;
  if old.frozen_at is not null and new.frozen_at is distinct from old.frozen_at then
    raise exception 'a recorded freeze cannot move' using errcode = '23514';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a recorded revocation cannot move' using errcode = '23514';
  end if;
  return new;
end
$function$;

alter function privacy.enforce_data_grant_transition() owner to allfit_owner;
revoke all on function privacy.enforce_data_grant_transition() from public, allfit_api;

create trigger trg_data_grants_enforce_transition
before update on privacy.data_grants
for each row execute function privacy.enforce_data_grant_transition();

/*
 * The person reads their own consents and grants; the organization of the
 * relationship reads the state of what it was given. Reading that a grant
 * exists is not reading what it covers — the data behind it has its own
 * conditions, and this table is only one of them.
 */
alter table privacy.consent_events enable row level security;
alter table privacy.consent_events force row level security;
alter table privacy.data_grants enable row level security;
alter table privacy.data_grants force row level security;

create policy consent_events_select_actor
  on privacy.consent_events
  for select to allfit_owner
  using (
    person_id = access_control.person()
    or organization_id = access_control.org()
  );

create policy consent_events_insert_owner
  on privacy.consent_events
  for insert to allfit_owner
  with check (access_control.actor_kind() is not null);

create policy data_grants_select_actor
  on privacy.data_grants
  for select to allfit_owner
  using (
    person_id = access_control.person()
    or organization_id = access_control.org()
  );

create policy data_grants_insert_owner
  on privacy.data_grants
  for insert to allfit_owner
  with check (access_control.actor_kind() is not null);

create policy data_grants_update_owner
  on privacy.data_grants
  for update to allfit_owner
  using (access_control.actor_kind() is not null)
  with check (access_control.actor_kind() is not null);

-- Deleting a grant is not a thing that happens: closing one is a state, so the
-- record of when access ended survives. No delete policy exists for either.
revoke all on privacy.consent_events, privacy.data_grants from public, allfit_api;
