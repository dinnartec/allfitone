/*
 * `OP-REL-013` — listing the covers of a relationship.
 *
 * HU-STUDIO-031. Two surfaces again: a coach, administrator or owner lists them
 * from Studio, and **the person lists her own from Space**. That second one is
 * the half that does not exist anywhere today — `OP-REL-011` is Studio-only and
 * its actors are `A3`–`A6`, so the person has had no way to see who has been
 * authorised over her data. The catalogue states it as a rule rather than a
 * feature: «la persona siempre puede ver quién está autorizado sobre sus datos,
 * incluidas suplencias pendientes de su decisión».
 *
 * **Newest first**, which is the other thing this adds. The relationship card
 * embeds its covers ordered by `valid_from` ascending, so the cover that is
 * running sinks below every cover that is over — invisible today with one or
 * two, and a wall after a few years.
 *
 * **Current and past, and past grants nothing.** Criterion 2 is not enforced
 * here: it is already true, because `relationships.actor_is_assigned` refuses
 * an assignment whose `valid_to` has passed or whose `ends_on` is behind us.
 * Listing a cover is reading a fact about the past, not reopening it — and
 * there is an assertion whose only job is to prove that reading one does not
 * hand its professional anything.
 *
 * **Which rows come back is the row policy's decision**, not this function's.
 * A coach sees their own assignments and the covers of the clients they hold;
 * an owner sees them all. Narrowing here as well would be a second copy of that
 * rule, free to drift from the policy it duplicates.
 */

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ———————————————————————————————————————— OP-REL-013

create or replace function relationships.list_relationship_substitutions(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_relationship_id uuid,
  p_limit integer,
  p_cursor_valid_from timestamptz,
  p_cursor_assignment_id uuid
)
returns table (
  assignment_id uuid,
  membership_id uuid,
  professional_person_id uuid,
  display_name text,
  status text,
  valid_from timestamptz,
  valid_to timestamptz,
  ends_on date,
  accepted_by_person_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  subject record;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  if p_limit not between 1 and 101 then
    raise exception 'invalid page limit' using errcode = '22023';
  end if;

  /*
   * Both halves of the cursor or neither. One alone is a caller who built it by
   * hand, and silently serving page one to somebody paging forward reads as
   * duplicated covers rather than as a bug.
   */
  if (p_cursor_valid_from is null) <> (p_cursor_assignment_id is null) then
    raise exception 'invalid substitution cursor' using errcode = '22023';
  end if;

  /*
   * The organization is an argument on the Studio surface and absent on the
   * Space one, whose route carries no `orgId`. Resolved from the relationship
   * either way, so a Studio caller who names another organization's
   * relationship finds nothing rather than being told it exists.
   */
  select relationship.id, relationship.person_id, relationship.organization_id
    into subject
  from relationships.service_relationships as relationship
  where relationship.id = p_relationship_id
    and (p_organization_id is null or relationship.organization_id = p_organization_id);

  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;

  if access_control.is_self(subject.person_id) then
    /*
     * Her own relationship, read without an organization context. Lending her
     * one would lend her a membership she does not have, and the row policy
     * already serves a person her own rows through `access_control.person()`.
     */
    null;
  else
    /*
     * Same two capabilities the relationship card asks for, and the same
     * reason: `view_assigned_directory` is what a coach holds, and without
     * declaring the organization the policy cannot resolve it and a coach reads
     * nothing at all.
     */
    if not (
      access_control.has_capability(subject.organization_id, 'view_directory')
      or access_control.has_capability(subject.organization_id, 'view_assigned_directory')
    ) then
      -- Not found and not permitted are the same answer on purpose: who is a
      -- client of whom is not confirmed to somebody who may not see it.
      raise exception 'relationship not found' using errcode = 'P0002';
    end if;
    perform set_config('app.actor_org_id', subject.organization_id::text, true);
  end if;

  return query
  select cover.id,
         cover.membership_id,
         membership.person_id,
         professional.display_name,
         cover.status::text,
         cover.valid_from,
         cover.valid_to,
         cover.ends_on,
         cover.accepted_by_person_at
  from relationships.relationship_professional_assignments as cover
  join organizations.organization_memberships as membership
    on membership.id = cover.membership_id
  join identity.people as professional on professional.id = membership.person_id
  where cover.relationship_id = p_relationship_id
    and cover.kind = 'substitute'
    and (
      p_cursor_valid_from is null
      or (cover.valid_from, cover.id) < (p_cursor_valid_from, p_cursor_assignment_id)
    )
  order by cover.valid_from desc, cover.id desc
  limit p_limit;
end
$function$;

alter function relationships.list_relationship_substitutions(uuid, uuid, uuid, integer, timestamptz, uuid)
  owner to allfit_owner;
revoke all on function relationships.list_relationship_substitutions(uuid, uuid, uuid, integer, timestamptz, uuid)
  from public;
grant execute on function relationships.list_relationship_substitutions(uuid, uuid, uuid, integer, timestamptz, uuid)
  to allfit_api;
