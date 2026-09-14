-- NEW-SUP-ORG-DETAIL — a gym's file as Allfit's team reads it (`HU-BO-013`).
--
-- The part of the story that has tables behind it: the organization's data, its
-- owner, its sites and its team. Four decisions shape it.
--
-- **The file is about the organization, never about names.** ADR-028 keeps ordinary
-- support to identifiers, states, dates and counters, and the support projection
-- already refuses names and full contacts. The owner and the team are therefore
-- person identifiers with their roles. The responsible party is not returned, and
-- the legal name only for a company: for an independent professional both are a
-- person's name. Opening a member as a person still goes through the support card,
-- which asks for a case reference.
--
-- **Every person revealed is an access.** Belonging to a gym is personal data. Each
-- active member the file returns is written to `privacy.access_events` before the
-- file travels, under `support_metadata`, in the same transaction; if a record fails
-- the read fails. A former member is counted, never listed, and so never recorded.
-- No case reference is asked for the file itself: nothing would keep it, and the
-- access record is what an auditor follows.
--
-- **A home is not a site.** An independent professional often works from home, so a
-- natural person's site address is withheld and the file says it was.
--
-- **What does not exist is not zero.** People served, plans, the payment method and
-- Premium have no tables yet. They come back as `null` and `not_modelled`, the same
-- vocabulary the support projection uses.
--
-- Readable with the support duty or the lifecycle duty, like the directory it opens
-- from. The team list stops at 200 active members and says when it did.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function organizations.read_backoffice_organization(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target organizations.organizations%rowtype;
  type_label text;
  natural_person boolean;
  owner_entry jsonb;
  team_entries jsonb := '[]'::jsonb;
  site_entries jsonb;
  active_count integer;
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
    'people_served', null,
    'plans_availability', 'not_modelled',
    'payment_method_availability', 'not_modelled',
    'premium_availability', 'not_modelled'
  );
end
$function$;

alter function organizations.read_backoffice_organization(uuid, uuid, uuid) owner to allfit_owner;
revoke all on function organizations.read_backoffice_organization(uuid, uuid, uuid) from public;
grant execute on function organizations.read_backoffice_organization(uuid, uuid, uuid) to allfit_api;
