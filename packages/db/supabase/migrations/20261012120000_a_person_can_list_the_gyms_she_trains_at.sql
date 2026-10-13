-- `OP-REL-012` — the relationships a person has, and had.
--
-- The door that was missing. Everything a person does with one of her gyms — look at its
-- plans, subscribe, see what she pays — needs an organization id, and until now Space had
-- no operation that produced one. A screen that asked her to type a UUID is not a screen,
-- so the subscription story could not be reached at all.
--
-- **Closed relationships are included.** Somebody who left a gym and came back has two
-- rows, and the new one carries `previous_relationship_id` so the continuity can be shown.
-- Showing it grants nothing: the old relationship's permissions were frozen when it
-- ended, and the link is a fact about her history rather than a key to it.
--
-- Which rows come back is the row policy's decision and not this function's. There is no
-- `where person_id =` here on purpose: the policy on `service_relationships` already
-- admits the acting person's own rows and nobody else's, and a second copy of that filter
-- is a second place for it to drift.
--
-- No access record is written. A list of the organizations somebody trains at carries no
-- fitness data of any kind — not a measurement, not a session, not a note.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function relationships.list_my_relationships(
  p_actor_person_id uuid,
  p_limit integer,
  p_cursor_started_at timestamptz,
  p_cursor_relationship_id uuid
)
returns table (
  relationship_id uuid,
  organization_id uuid,
  organization_name text,
  organization_type_code text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  previous_relationship_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  if p_limit not between 1 and 101 then
    raise exception 'invalid page limit' using errcode = '22023';
  end if;

  if (p_cursor_started_at is null) <> (p_cursor_relationship_id is null) then
    raise exception 'invalid relationship cursor' using errcode = '22023';
  end if;

  return query
  select relationship.id,
         relationship.organization_id,
         organization.display_name,
         organization.type_code,
         relationship.status::text,
         relationship.started_at,
         relationship.ended_at,
         relationship.previous_relationship_id
  from relationships.service_relationships as relationship
  join organizations.organizations as organization
    on organization.id = relationship.organization_id
  where (
    p_cursor_started_at is null
    or (relationship.started_at, relationship.id) < (p_cursor_started_at, p_cursor_relationship_id)
  )
  order by relationship.started_at desc, relationship.id desc
  limit p_limit;
end
$function$;

alter function relationships.list_my_relationships(uuid, integer, timestamptz, uuid)
  owner to allfit_owner;
revoke all on function relationships.list_my_relationships(uuid, integer, timestamptz, uuid)
  from public;
grant execute on function relationships.list_my_relationships(uuid, integer, timestamptz, uuid)
  to allfit_api;
