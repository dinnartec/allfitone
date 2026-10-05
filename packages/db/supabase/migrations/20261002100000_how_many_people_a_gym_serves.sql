-- How many people a gym serves, and in what state (`HU-BO-013`, criterion 3).
--
-- The file answered `people_served` with null and said why: service relationships did
-- not exist. They do now, so the figure is a figure, and the criterion asks for the
-- states beside it — the same shape the file already gives for the team.
--
-- Reading them takes a policy. `relationships.service_relationships` forces row-level
-- security and answers for the person, or for the organization when the reader belongs
-- to it with the directory capability or an assignment. A Backoffice operator is
-- neither, so without this the count would come back zero — a figure, and a wrong one,
-- which is worse than the null it replaces.
--
-- The policy admits exactly the reader the file already demands: an `allfit_admin` on a
-- live AAL2 Backoffice session holding one of the two duties that open a gym's file.
-- `organizations.read_backoffice_organization` still checks the duty against the exact
-- session before counting anything; this only stops the database from hiding rows that
-- check has already approved.
--
-- The predicate is the one the business panel needed, with the duty as an argument.
-- `access_control.counts_platform_metrics` now delegates to it, so the rule that says
-- what a Backoffice reader is lives in one place.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- A Backoffice reader: the role, the duty, and a session that could carry it. A policy
-- cannot see the session the request arrived on, so it asks for any live one that
-- would qualify; the calling function checks the exact one.
create or replace function access_control.holds_backoffice_duty(p_duty_code text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from identity.people as person
    join support.platform_role_assignments as role_assignment
      on role_assignment.person_id = person.id
     and role_assignment.platform_role = 'allfit_admin'
     and role_assignment.status = 'active'
    join support.platform_duty_assignments as duty_assignment
      on duty_assignment.person_id = person.id
     and duty_assignment.duty_code = p_duty_code
     and duty_assignment.status = 'active'
     and clock_timestamp() >= duty_assignment.valid_from
     and clock_timestamp() < duty_assignment.valid_to
    join identity.access_accounts as account
      on account.person_id = person.id
    join identity.access_sessions as session
      on session.access_account_id = account.id
     and session.surface = 'backoffice'::identity.access_session_surface
     and session.assurance_level = 2
     and session.authentication_method = 'password_totp'
     and session.revoked_at is null
     and session.absolute_expires_at > clock_timestamp()
     and session.last_activity_at > clock_timestamp() - interval '15 minutes'
     and duty_assignment.required_aal <= session.assurance_level
    where person.id = access_control.person()
      and person.status = 'active'
  )
$function$;

alter function access_control.holds_backoffice_duty(text) owner to allfit_owner;
revoke all on function access_control.holds_backoffice_duty(text) from public;

-- Same rule, one place.
create or replace function access_control.counts_platform_metrics()
returns boolean
language sql
stable
set search_path = pg_catalog
as $function$
  select access_control.holds_backoffice_duty('view_platform_metrics')
$function$;

alter function access_control.counts_platform_metrics() owner to allfit_owner;
revoke all on function access_control.counts_platform_metrics() from public;

-- Reading only. A Backoffice operator never writes a relationship: ending one is the
-- person's or the gym's, and `HU-BO-017` is deferred by decision.
create policy service_relationships_select_backoffice_directory
  on relationships.service_relationships
  for select
  to allfit_owner
  using (
    access_control.holds_backoffice_duty('diagnose_support_metadata')
    or access_control.holds_backoffice_duty('manage_organization_lifecycle')
  );

-- The file itself, with the two figures filled in. Everything else is unchanged.
CREATE OR REPLACE FUNCTION organizations.read_backoffice_organization(p_actor_person_id uuid, p_actor_session_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target organizations.organizations%rowtype;
  type_label text;
  natural_person boolean;
  owner_entry jsonb;
  team_entries jsonb := '[]'::jsonb;
  site_entries jsonb;
  active_count integer;
  served_active integer;
  served_terminated integer;
  terminated_count integer;
  member record;
  trace uuid := coalesce(
    nullif(current_setting('app.request_id', true), '')::uuid,
    extensions.uuid_generate_v7()
  );
begin
  perform organizations.require_organization_directory_reader(p_actor_person_id, p_actor_session_id);

  select organization.* into target
  from organizations.organizations as organization
  where organization.id = p_organization_id;
  if target.id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select organization_type.name into type_label
  from organizations.organization_types as organization_type
  where organization_type.code = target.type_code;
  natural_person := target.responsible_party->>'party_kind' = 'natural_person';

  select count(*) filter (where membership.status = 'active'),
         count(*) filter (where membership.status = 'terminated')
  into active_count, terminated_count
  from organizations.organization_memberships as membership
  where membership.organization_id = p_organization_id;

  -- The people it serves, counted the way the team is. A relationship that ended is
  -- kept apart rather than dropped: criterion 3 asks for the state as well.
  select count(*) filter (where relationship.status = 'active'),
         count(*) filter (where relationship.status = 'terminated')
  into served_active, served_terminated
  from relationships.service_relationships as relationship
  where relationship.organization_id = p_organization_id;

  select jsonb_build_object(
           'person_id', membership.person_id,
           'membership_id', membership.id,
           'since', membership_role.valid_from
         )
  into owner_entry
  from organizations.organization_memberships as membership
  join organizations.membership_roles as membership_role
    on membership_role.membership_id = membership.id
   and membership_role.role_code = 'owner'
   and membership_role.valid_to is null
  where membership.organization_id = p_organization_id
    and membership.status = 'active'
  order by membership_role.valid_from desc
  limit 1;

  -- The owner is listed first, so a truncated team never leaves out the one member
  -- the file already named.
  for member in
    select listed.*
    from (
      select membership.id as membership_id,
             membership.person_id,
             membership.joined_at,
             coalesce((
               select array_agg(
                 membership_role.role_code
                 order by case membership_role.role_code
                   when 'owner' then 1
                   when 'admin' then 2
                   when 'coach' then 3
                   else 4
                 end
               )
               from organizations.membership_roles as membership_role
               where membership_role.membership_id = membership.id
                 and membership_role.valid_from <= statement_timestamp()
                 and membership_role.valid_to is null
             ), array[]::text[]) as roles
      from organizations.organization_memberships as membership
      where membership.organization_id = p_organization_id
        and membership.status = 'active'
    ) as listed
    order by ('owner' = any(listed.roles)) desc, listed.joined_at, listed.membership_id
    limit 200
  loop
    insert into privacy.access_events (
      actor_person_id, subject_person_id, resource, resource_id, purpose, result,
      request_id, access_mode
    ) values (
      p_actor_person_id, member.person_id, 'organizations.organization_memberships',
      member.membership_id, 'support_diagnosis', 'allowed', trace,
      'support_metadata'::privacy.access_mode
    );
    team_entries := team_entries || jsonb_build_array(jsonb_build_object(
      'membership_id', member.membership_id,
      'person_id', member.person_id,
      'roles', to_jsonb(member.roles),
      'joined_at', member.joined_at
    ));
  end loop;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'site_id', site.id,
               'name', site.name,
               'address', case when natural_person then null else site.address end,
               'address_withheld', natural_person and site.address is not null,
               'status', site.status
             )
             order by site.created_at, site.id
           ),
           '[]'::jsonb
         )
  into site_entries
  from organizations.organization_sites as site
  where site.organization_id = p_organization_id;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'organization_id', target.id,
      'display_name', target.display_name,
      'type_code', target.type_code,
      'type_name', type_label,
      'status', target.status,
      'party_kind', target.responsible_party->>'party_kind',
      'legal_name', case when natural_person then null else target.legal_name end,
      'created_at', target.created_at,
      'claimed_at', target.claimed_at,
      'cancelled_at', target.cancelled_at
    ),
    'owner', owner_entry,
    'team', team_entries,
    'team_counts', jsonb_build_object('active', active_count, 'terminated', terminated_count),
    'team_truncated', active_count > 200,
    'sites', site_entries,
    'people_served', served_active,
    'relationship_counts',
      jsonb_build_object('active', served_active, 'terminated', served_terminated),
    'plans_availability', 'not_modelled',
    'payment_method_availability', 'not_modelled',
    'premium_availability', 'not_modelled'
  );
end
$function$;

alter function organizations.read_backoffice_organization(uuid, uuid, uuid) owner to allfit_owner;
revoke all on function organizations.read_backoffice_organization(uuid, uuid, uuid) from public;
grant execute on function organizations.read_backoffice_organization(uuid, uuid, uuid) to allfit_api;

-- And the row in the directory, which answers how many and leaves the states to the
-- file. Everything else is unchanged.
CREATE OR REPLACE FUNCTION organizations.list_backoffice_organizations(p_actor_person_id uuid, p_actor_session_id uuid, p_query text, p_status text, p_limit integer, p_after_name text, p_after_id uuid)
 RETURNS TABLE(organization_id uuid, display_name text, type_code text, type_name text, status text, created_at timestamp with time zone, claimed_at timestamp with time zone, cancelled_at timestamp with time zone, active_member_count integer, site_count integer, people_served integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    (
      select count(*)::integer
      from relationships.service_relationships as relationship
      where relationship.organization_id = organization.id
        and relationship.status = 'active'
    )
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

alter function organizations.list_backoffice_organizations(uuid, uuid, text, text, integer, text, uuid)
  owner to allfit_owner;
revoke all on function organizations.list_backoffice_organizations(uuid, uuid, text, text, integer, text, uuid)
  from public;
grant execute on function organizations.list_backoffice_organizations(uuid, uuid, text, text, integer, text, uuid)
  to allfit_api;
