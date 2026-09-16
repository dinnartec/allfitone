-- Organization lifecycle shape and the Backoffice organization directory.
--
-- `HU-BO-012`, and the foundation `HU-BO-014` and `HU-BO-015` stand on: an
-- organization can now exist without operating.
--
-- **Not operating is already structural.** Every Studio command requires
-- `status = 'active'`, so an unclaimed organization cannot invite, publish plans,
-- take payments or be read through Studio. This migration adds what makes the
-- state itself impossible to fake: an unclaimed organization carries no claim and
-- no cancellation, a cancelled one carries its cancellation and never a claim, an
-- operating one says when it was claimed, and an organization nobody has claimed
-- cannot receive a member.
--
-- **`closed` is left loosely shaped on purpose.** There is no closure flow yet, and
-- existing fixtures move organizations to `closed` without a timestamp. Requiring
-- one now would break them for a column nothing writes; the closure slice owns it.
--
-- **Existing organizations were claimed when they were created,** because until now
-- only an owner could create one. The backfill copies `created_at` into
-- `claimed_at` with the update timestamp trigger disabled for that one statement:
-- otherwise every real organization would report the migration as its last change.
--
-- **The directory is organizations, never people.** Search matches the display
-- name only, literally, from two characters. The legal name — which for an
-- independent professional is a person's name — is neither searched nor returned,
-- and neither is the responsible party. Reading it needs the support duty or the
-- lifecycle duty: both have reason to reach a gym, and neither implies the other.
--
-- **How many people an organization serves is not a guess.** `relationships` does
-- not exist, so `people_served` is null, never zero — zero would claim the gym
-- serves nobody.
--
-- The directory writes no access record. `privacy.access_events` records reaching a
-- person's data, and its organization branch requires an acting membership that
-- staff do not have; nothing here identifies a person.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Lifecycle shape
-- ---------------------------------------------------------------------------

alter table organizations.organizations
  add column claimed_at timestamptz,
  add column cancelled_at timestamptz;

alter table organizations.organizations disable trigger trg_organizations_before_update_timestamp;
update organizations.organizations
set claimed_at = created_at
where status in ('active', 'closed');
alter table organizations.organizations enable trigger trg_organizations_before_update_timestamp;

-- An organization its owner creates is claimed at that moment. Only the Backoffice
-- creation path inserts an explicit null.
alter table organizations.organizations
  alter column claimed_at set default clock_timestamp();

alter table organizations.organizations
  add constraint ck_organizations_lifecycle_shape check (
    (status = 'unclaimed' and claimed_at is null and cancelled_at is null)
    or (status = 'active' and claimed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and claimed_at is null and cancelled_at is not null)
    or (status = 'closed' and cancelled_at is null)
  );

create index idx_organizations_directory
  on organizations.organizations (lower(display_name), id);
create index idx_organizations_status_created
  on organizations.organizations (status, created_at);

create or replace function organizations.forbid_membership_before_claim_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if exists (
    select 1
    from organizations.organizations as organization
    where organization.id = new.organization_id
      and organization.status in ('unclaimed', 'cancelled')
  ) then
    raise exception 'an organization nobody has claimed has no members' using errcode = '55000';
  end if;
  return new;
end
$function$;

-- Claiming flips the organization to active before inserting the owner, in the same
-- transaction, so this never stands in the way of the one legitimate path.
create trigger trg_organization_memberships_before_insert_claimed
before insert on organizations.organization_memberships
for each row execute function organizations.forbid_membership_before_claim_tg();

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

create or replace function organizations.require_organization_directory_reader(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
     or not (
       access_control.has_platform_duty(
         p_actor_person_id, p_actor_session_id, 'diagnose_support_metadata'
       )
       or access_control.has_platform_duty(
         p_actor_person_id, p_actor_session_id, 'manage_organization_lifecycle'
       )
     ) then
    raise exception 'reading the organization directory requires an effective support or lifecycle duty'
      using errcode = '42501';
  end if;
end
$function$;

-- ---------------------------------------------------------------------------
-- NEW-SUP-ORG-SEARCH — the directory
-- ---------------------------------------------------------------------------

create or replace function organizations.list_backoffice_organizations(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_query text,
  p_status text,
  p_limit integer,
  p_after_name text,
  p_after_id uuid
)
returns table (
  organization_id uuid,
  display_name text,
  type_code text,
  type_name text,
  status text,
  created_at timestamptz,
  claimed_at timestamptz,
  cancelled_at timestamptz,
  active_member_count integer,
  site_count integer,
  people_served integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
#variable_conflict use_column
declare
  needle text;
begin
  perform organizations.require_organization_directory_reader(p_actor_person_id, p_actor_session_id);

  if p_query is not null then
    needle := lower(btrim(p_query));
    -- Two characters at least, so a search is a question rather than a way to page
    -- through everything under another name.
    if char_length(needle) < 2 then
      raise exception 'an organization search needs at least two characters' using errcode = '22023';
    end if;
    -- `%` and `_` in a name are characters to find, not a pattern to expand.
    needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  if p_status is not null and p_status not in ('unclaimed', 'active', 'closed', 'cancelled') then
    raise exception 'unknown organization lifecycle state' using errcode = '22023';
  end if;

  if (p_after_name is null) <> (p_after_id is null) then
    raise exception 'a page cursor names both the last name and the last identifier'
      using errcode = '22023';
  end if;

  return query
  select
    organization.id,
    organization.display_name,
    organization.type_code,
    organization_type.name,
    organization.status::text,
    organization.created_at,
    organization.claimed_at,
    organization.cancelled_at,
    (
      select count(*)::integer
      from organizations.organization_memberships as membership
      where membership.organization_id = organization.id
        and membership.status = 'active'
    ),
    (
      select count(*)::integer
      from organizations.organization_sites as site
      where site.organization_id = organization.id
        and site.status = 'active'
    ),
    -- Nothing to count until `relationships` exists. Null, never zero.
    null::integer
  from organizations.organizations as organization
  join organizations.organization_types as organization_type
    on organization_type.code = organization.type_code
  where (needle is null or lower(organization.display_name) like '%' || needle || '%' escape '\')
    and (p_status is null or organization.status::text = p_status)
    and (
      p_after_name is null
      or (lower(organization.display_name), organization.id) > (lower(p_after_name), p_after_id)
    )
  order by lower(organization.display_name), organization.id
  -- One more than the largest page the API serves, so it can tell whether another
  -- page exists without a second query.
  limit least(greatest(coalesce(p_limit, 50), 1), 101);
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function organizations.forbid_membership_before_claim_tg() owner to allfit_owner;
alter function organizations.require_organization_directory_reader(uuid, uuid) owner to allfit_owner;
alter function organizations.list_backoffice_organizations(
  uuid, uuid, text, text, integer, text, uuid
) owner to allfit_owner;

revoke all on function organizations.forbid_membership_before_claim_tg() from public, allfit_api;
revoke all on function organizations.require_organization_directory_reader(uuid, uuid) from public, allfit_api;
revoke all on function organizations.list_backoffice_organizations(
  uuid, uuid, text, text, integer, text, uuid
) from public;

grant execute on function organizations.list_backoffice_organizations(
  uuid, uuid, text, text, integer, text, uuid
) to allfit_api;
