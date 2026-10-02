-- Schema `relationships`: the accepted service link between a person and an
-- organization, and the professional authorized inside it.
--
-- A relationship is the first of the five conditions a professional must meet
-- before reading anything of a person's. It grants nothing on its own — knowing
-- that someone is a client is operational data, not fitness data — but nothing
-- is readable without it.
--
-- Two tables arrive together because the first one's policy names the second.
-- "An effective assignment" is what lets a coach read the relationships they
-- were put in charge of, and a policy that could not express it would either
-- deny every coach or allow every member.
--
-- ENUM VALUES ARE DERIVED, NOT SPECIFIED. V1_DATA_DICTIONARY names exactly
-- three: `kind='holder'`, `status='active'` and `status='proposed'`. The rest
-- come from the domain events the same section declares —
-- `relationship.terminated.v1`, `substitution_decided`, `substitution_ended`,
-- `substitution_expired` — and from its prose ("titular o suplente"). They are
-- listed here so a reviewer can correct them before this reaches production;
-- an enum value is immutable once deployed and forward-only afterwards.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists relationships;
alter schema relationships owner to allfit_owner;

create type relationships.relationship_status as enum ('active', 'terminated');
create type relationships.assignment_kind as enum ('holder', 'substitute');
create type relationships.assignment_status as enum (
  'proposed',
  'active',
  'rejected',
  'ended',
  'expired'
);

alter type relationships.relationship_status owner to allfit_owner;
alter type relationships.assignment_kind owner to allfit_owner;
alter type relationships.assignment_status owner to allfit_owner;

create table relationships.service_relationships (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  organization_id uuid not null,
  status relationships.relationship_status not null default 'active',
  previous_relationship_id uuid,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  ended_reason text,
  ended_by_kind identity.actor_kind,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_service_relationships primary key (id),
  -- Carrying keys, so a child row cannot point at one relationship's id while
  -- claiming another's person or organization.
  constraint uq_service_relationships_id_person unique (id, person_id),
  constraint uq_service_relationships_id_organization unique (id, organization_id),
  constraint uq_service_relationships_carrier unique (id, person_id, organization_id),
  constraint fk_service_relationships_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_service_relationships_organization foreign key (organization_id) references organizations.organizations(id) on delete restrict,
  -- IX-01: a returning client's new relationship may only point at one of their
  -- own, in the same organization.
  constraint fk_service_relationships_previous foreign key (previous_relationship_id, person_id, organization_id) references relationships.service_relationships(id, person_id, organization_id)
    on delete restrict,
  constraint ck_service_relationships_ended_at check (ended_at is null or ended_at >= started_at),
  constraint ck_service_relationships_ended_reason check (ended_reason is null or btrim(ended_reason) <> ''),
  constraint ck_service_relationships_not_self check (previous_relationship_id is null or previous_relationship_id <> id)
);

-- One active relationship per person and organization. A person who leaves and
-- comes back gets a new row, not a revived one.
create unique index uidx_service_relationships_active
  on relationships.service_relationships (person_id, organization_id)
  where status = 'active';

create index idx_service_relationships_person_status
  on relationships.service_relationships (person_id, status);
create index idx_service_relationships_organization_status
  on relationships.service_relationships (organization_id, status);

create table relationships.relationship_professional_assignments (
  id uuid not null default extensions.uuid_generate_v7(),
  relationship_id uuid not null,
  person_id uuid not null,
  organization_id uuid not null,
  membership_id uuid not null,
  kind relationships.assignment_kind not null,
  status relationships.assignment_status not null,
  valid_from timestamptz not null default clock_timestamp(),
  valid_to timestamptz,
  ends_on date,
  accepted_by_person_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_relationship_professional_assignments primary key (id),
  constraint uq_relationship_professional_assignments_id_person unique (id, person_id),
  constraint uq_relationship_professional_assignments_carrier
    unique (id, relationship_id, person_id, organization_id, membership_id),
  constraint fk_relationship_professional_assignments_relationship foreign key (relationship_id, person_id, organization_id) references relationships.service_relationships(id, person_id, organization_id)
    on delete restrict,
  -- IX-02: the assigned membership belongs to the same organization as the
  -- relationship. A professional from another organization is never assignable,
  -- even when the person is a client of both.
  constraint fk_relationship_professional_assignments_membership foreign key (membership_id, organization_id) references organizations.organization_memberships(id, organization_id)
    on delete restrict,
  constraint ck_relationship_professional_assignments_valid_to check (valid_to is null or valid_to >= valid_from),
  -- A substitution always ends on a date; a holder's assignment is open-ended.
  constraint ck_relationship_professional_assignments_ends_on check (kind = 'holder' or ends_on is not null),
  -- A substitution only becomes effective once the person accepts it.
  constraint ck_relationship_professional_assignments_accepted check (kind = 'holder' or accepted_by_person_at is not null or status = 'proposed')
);

-- One effective holder per relationship.
create unique index uidx_relationship_professional_assignments_holder
  on relationships.relationship_professional_assignments (relationship_id)
  where kind = 'holder' and status = 'active';

create index idx_relationship_professional_assignments_relationship
  on relationships.relationship_professional_assignments
  (relationship_id, status, valid_from, valid_to);
create index idx_relationship_professional_assignments_person
  on relationships.relationship_professional_assignments (person_id, status);
create index idx_relationship_professional_assignments_organization
  on relationships.relationship_professional_assignments (organization_id, status);

alter table relationships.service_relationships owner to allfit_owner;
alter table relationships.relationship_professional_assignments owner to allfit_owner;

create trigger trg_service_relationships_before_update_timestamp
before update on relationships.service_relationships
for each row execute function access_control.set_updated_at();

create trigger trg_professional_assignments_before_update_timestamp
before update on relationships.relationship_professional_assignments
for each row execute function access_control.set_updated_at();

/*
 * Who may read a relationship.
 *
 * The person, always — it is theirs. Inside the organization it splits by
 * capability, which is the distinction the role catalog already draws:
 * `view_directory` (owner, admin, staff) reads the whole client directory,
 * while a coach holds `view_assigned_directory` and reads only the
 * relationships they were actually assigned to.
 *
 * Denied without exception: another organization, a coach of this organization
 * with no assignment in this relationship, and anyone without a live
 * membership.
 */
create or replace function relationships.actor_is_assigned(p_relationship_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from relationships.relationship_professional_assignments as assignment
    join organizations.organization_memberships as membership
      on membership.id = assignment.membership_id
    where assignment.relationship_id = p_relationship_id
      and assignment.status = 'active'
      and (assignment.valid_to is null or assignment.valid_to > clock_timestamp())
      and membership.person_id = access_control.person()
      and membership.status = 'active'
  );
$function$;

alter function relationships.actor_is_assigned(uuid) owner to allfit_owner;
revoke all on function relationships.actor_is_assigned(uuid) from public;
grant execute on function relationships.actor_is_assigned(uuid) to allfit_api;

alter table relationships.service_relationships enable row level security;
alter table relationships.service_relationships force row level security;
alter table relationships.relationship_professional_assignments enable row level security;
alter table relationships.relationship_professional_assignments force row level security;

/*
 * The policy is written against the table owner, not against the runtime role.
 * Commands and reads reach these rows through `security definer` functions,
 * which run as the owner, and `force row level security` above means the owner
 * does not escape the policy either. So the actor context decides what is
 * visible even inside a privileged function — which is the whole point of
 * keeping the boundary in PostgreSQL. The runtime role gets no direct select:
 * there is nothing for it to read around.
 */
create policy service_relationships_select_actor
  on relationships.service_relationships
  for select to allfit_owner
  using (
    person_id = access_control.person()
    or (
      organization_id = access_control.org()
      and (
        access_control.has_capability(organization_id, 'view_directory')
        or relationships.actor_is_assigned(id)
      )
    )
  );

/*
 * Writes only. `for all` would include `select`, and policies combine with OR,
 * so a permissive write policy silently grants every reader everything the
 * select policy was written to withhold. The denial tests caught exactly that.
 */
create policy service_relationships_insert_owner
  on relationships.service_relationships
  for insert to allfit_owner
  with check (access_control.actor_kind() is not null);

create policy service_relationships_update_owner
  on relationships.service_relationships
  for update to allfit_owner
  using (access_control.actor_kind() is not null)
  with check (access_control.actor_kind() is not null);

/*
 * An assignment is visible to whoever may see the relationship it belongs to,
 * stated without asking that question back.
 *
 * `actor_is_assigned` reads this very table, so a policy here that called it
 * would recurse until the stack gave out — which is precisely what happened.
 * A coach's own assignment is identifiable directly: the membership is theirs.
 */
create policy relationship_professional_assignments_select_actor
  on relationships.relationship_professional_assignments
  for select to allfit_owner
  using (
    person_id = access_control.person()
    or (
      organization_id = access_control.org()
      and (
        access_control.has_capability(organization_id, 'view_directory')
        or access_control.owns_membership(membership_id)
      )
    )
  );

/*
 * Writes only. `for all` would include `select`, and policies combine with OR,
 * so a permissive write policy silently grants every reader everything the
 * select policy was written to withhold. The denial tests caught exactly that.
 */
create policy relationship_professional_assignments_insert_owner
  on relationships.relationship_professional_assignments
  for insert to allfit_owner
  with check (access_control.actor_kind() is not null);

create policy relationship_professional_assignments_update_owner
  on relationships.relationship_professional_assignments
  for update to allfit_owner
  using (access_control.actor_kind() is not null)
  with check (access_control.actor_kind() is not null);

revoke all on
  relationships.service_relationships,
  relationships.relationship_professional_assignments
from public, allfit_api;

grant usage on schema relationships to allfit_api;
