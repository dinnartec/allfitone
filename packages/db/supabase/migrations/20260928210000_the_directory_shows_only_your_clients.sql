-- OP-REL-010 — list the client directory of an organization.
--
-- The function checks that the caller may read *a* directory at all; the row
-- policy on `service_relationships` decides *which* rows that turns out to be.
-- Owner, admin and staff hold `view_directory` and see every client; a coach
-- holds `view_assigned_directory` and the policy narrows the same query to the
-- relationships they were actually assigned, as holder or as substitute.
--
-- No access event is written. The operations matrix is explicit that the
-- directory consumes no grant and produces no `ACCESS_EVENT`: it carries the
-- person's identity and the state of the link, and no fitness data of any kind,
-- not even aggregated. The read ritual's audit step belongs to reads that
-- expose a person's data, and this is not one.
--
-- NOT YET RETURNED: the invitation state the matrix also asks for. Invitations
-- carrying a `service_relationship` intent do not exist yet, so there is
-- nothing to report; adding the column later is additive.

create or replace function relationships.list_organization_clients(
  p_person_id uuid,
  p_organization_id uuid,
  p_status text,
  p_limit integer,
  p_cursor_status text,
  p_cursor_display_name text,
  p_cursor_relationship_id uuid
)
returns table (
  relationship_id uuid,
  person_id uuid,
  display_name text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  sort_display_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in ('active', 'terminated') then
    raise exception 'invalid relationship status' using errcode = '22023';
  end if;

  if p_limit not between 1 and 101 then
    raise exception 'invalid page limit' using errcode = '22023';
  end if;

  if (p_cursor_status is null) <> (p_cursor_display_name is null)
     or (p_cursor_status is null) <> (p_cursor_relationship_id is null)
     or (p_cursor_status is not null and p_cursor_status not in ('active', 'terminated')) then
    raise exception 'invalid relationship cursor' using errcode = '22023';
  end if;

  -- Either directory capability opens the door. Which rows come back is the
  -- row policy's decision, not this function's.
  if not exists (
    select 1
    from organizations.organizations as organization
    join organizations.organization_memberships as membership
      on membership.organization_id = organization.id
     and membership.person_id = p_person_id
     and membership.status = 'active'
    where organization.id = p_organization_id
      and organization.status = 'active'
      and (
        access_control.has_capability(p_organization_id, 'view_directory')
        or access_control.has_capability(p_organization_id, 'view_assigned_directory')
      )
  ) then
    raise exception 'client directory requires a directory capability'
      using errcode = '42501';
  end if;

  /*
   * The row policy resolves the organization through `access_control.org()`,
   * which reads this setting and then checks the actor really holds a live
   * membership in it. Declaring it here grants nothing that the check would
   * not already allow; omitting it leaves the policy blind to the
   * organization, and a coach would silently see an empty directory.
   */
  perform set_config('app.actor_org_id', p_organization_id::text, true);

  return query
  select
    relationship.id,
    relationship.person_id,
    person.display_name,
    relationship.status::text,
    relationship.started_at,
    relationship.ended_at,
    lower(person.display_name) collate "C"
  from relationships.service_relationships as relationship
  join identity.people as person on person.id = relationship.person_id
  where relationship.organization_id = p_organization_id
    and (p_status is null or relationship.status::text = p_status)
    and (
      p_cursor_status is null
      or (
        relationship.status::text,
        lower(person.display_name) collate "C",
        relationship.id
      ) > (
        p_cursor_status,
        lower(p_cursor_display_name) collate "C",
        p_cursor_relationship_id
      )
    )
  order by
    relationship.status::text,
    lower(person.display_name) collate "C",
    relationship.id
  limit p_limit;
end
$function$;

alter function relationships.list_organization_clients(
  uuid, uuid, text, integer, text, text, uuid
) owner to allfit_owner;
revoke all on function relationships.list_organization_clients(
  uuid, uuid, text, integer, text, text, uuid
) from public;
grant execute on function relationships.list_organization_clients(
  uuid, uuid, text, integer, text, text, uuid
) to allfit_api;
