-- A relationship can say how it stands.
--
-- Until now the only way to read a relationship was the directory, which lists
-- a name and the state of a link. Nothing could answer the next question a
-- person in the organization actually asks: who attends this client, and what
-- did they agree to let us see.
--
-- `OP-REL-011` answers it, and the shape of the answer is the point. It returns
-- **that** a permission was granted, which scope it is and in what version —
-- never the content the permission covers. Knowing that `health_context` is
-- granted is not reading anybody's injuries, and these two things have to stay
-- separable or the screen that lists permissions becomes a way around them.
--
-- Nothing here filters by role. Three policies already do, and reimplementing
-- them in this function would be a second answer to the same question, free to
-- drift from the first:
--
--   · `service_relationships_select_actor` narrows a coach to the relationships
--     they hold an effective assignment on. That is the matrix's "para A3:
--     asignación efectiva vigente", and it is why the relationship is resolved
--     first: when the policy hides it, this raises not-found and never reaches
--     a grant.
--   · `relationship_professional_assignments_select_actor` shows every
--     assignment to whoever holds `view_directory`, and to a coach only their
--     own. So a coach reading a client they attend sees themself as holder and
--     does not see who else was ever assigned. That is deliberate, and it means
--     this document is narrower for a coach than for an owner.
--   · `data_grants_select_actor` admits any member of the organization, so the
--     relationship read above is the only gate on grant state. Resolving the
--     relationship before touching grants is load-bearing, not tidiness.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function relationships.read_relationship_state(
  p_person_id uuid,
  p_organization_id uuid,
  p_relationship_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_membership_id uuid;
  -- Neither `relationship` nor `found`: the first is the table alias below, and
  -- PL/pgSQL would resolve `relationship.id` in the select list to this variable
  -- instead of the column; the second is its own `FOUND` flag, which the
  -- not-found check below depends on.
  subject record;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  select membership.id into actor_membership_id
  from organizations.organizations as organization
  join organizations.organization_memberships as membership
    on membership.organization_id = organization.id
   and membership.person_id = p_person_id
   and membership.status = 'active'
  where organization.id = p_organization_id
    and organization.status = 'active';

  if actor_membership_id is null
     or not (
       access_control.has_capability(p_organization_id, 'view_directory')
       or access_control.has_capability(p_organization_id, 'view_assigned_directory')
     ) then
    raise exception 'reading a relationship requires a directory capability'
      using errcode = '42501';
  end if;

  /*
   * The row policy resolves the organization through `access_control.org()`,
   * which reads this setting and then checks the actor really holds a live
   * membership in it. Declaring it here grants nothing the check above would
   * not already allow; omitting it leaves the policy blind to the organization,
   * and a coach would silently read nothing.
   */
  perform set_config('app.actor_org_id', p_organization_id::text, true);

  select relationship.id,
         relationship.person_id,
         person.display_name,
         relationship.status,
         relationship.started_at,
         relationship.ended_at
    into subject
  from relationships.service_relationships as relationship
  join identity.people as person on person.id = relationship.person_id
  where relationship.id = p_relationship_id
    and relationship.organization_id = p_organization_id;

  -- Not found and not permitted are the same answer on purpose. Telling a coach
  -- that a relationship exists but is not theirs leaks that the gym has that
  -- client, which is the directory's narrowing undone by an error message.
  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'relationship_id', subject.id,
    'person_id', subject.person_id,
    'display_name', subject.display_name,
    'status', subject.status,
    'started_at', subject.started_at,
    'ended_at', subject.ended_at,
    /*
     * `professional_person_id`, not `person_id`. On the assignment row,
     * `person_id` is the client being attended — it carries into the composite
     * key to the relationship — so reading it here as "who attends" returns the
     * client under the professional's name. It did, until a smoke read showed
     * the two ids were the same person.
     */
    'holder', (
      select jsonb_build_object(
               'assignment_id', assignment.id,
               'membership_id', assignment.membership_id,
               'professional_person_id', membership.person_id,
               'display_name', professional.display_name,
               'valid_from', assignment.valid_from
             )
      from relationships.relationship_professional_assignments as assignment
      join organizations.organization_memberships as membership
        on membership.id = assignment.membership_id
      join identity.people as professional on professional.id = membership.person_id
      where assignment.relationship_id = p_relationship_id
        and assignment.kind = 'holder'
        and assignment.status = 'active'
    ),
    'substitutions', (
      select coalesce(jsonb_agg(entry order by entry ->> 'valid_from'), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'assignment_id', assignment.id,
                 'membership_id', assignment.membership_id,
                 'professional_person_id', membership.person_id,
                 'display_name', professional.display_name,
                 'status', assignment.status,
                 'valid_from', assignment.valid_from,
                 'ends_on', assignment.ends_on,
                 'accepted_by_person_at', assignment.accepted_by_person_at
               ) as entry
        from relationships.relationship_professional_assignments as assignment
        join organizations.organization_memberships as membership
          on membership.id = assignment.membership_id
        join identity.people as professional on professional.id = membership.person_id
        where assignment.relationship_id = p_relationship_id
          and assignment.kind = 'substitute'
      ) as substitutions
    ),
    /*
     * Criteria 2 and 3. Every field here is about the permission, and none is
     * from the data it covers: the scope it names, the version that was agreed,
     * whether it still stands, and the words the person was shown. A reader
     * learns that measurements were shared without learning a single
     * measurement.
     */
    'grants', (
      select coalesce(jsonb_agg(entry order by entry ->> 'scope_code'), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'grant_id', grant_row.id,
                 'scope_code', grant_row.scope_code,
                 'display_name', presentation.display_name,
                 'version_number', definition.version_number,
                 'access_level', grant_row.access_level,
                 'status', grant_row.status,
                 'purpose', grant_row.purpose,
                 'granted_at', grant_row.granted_at,
                 'revoked_at', grant_row.revoked_at
               ) as entry
        from privacy.data_grants as grant_row
        join privacy.scope_definitions as definition
          on definition.id = grant_row.scope_definition_id
         and definition.scope_code = grant_row.scope_code
        left join privacy.scope_presentations as presentation
          on presentation.scope_code = grant_row.scope_code
        where grant_row.relationship_id = p_relationship_id
      ) as grants
    )
  );
end
$function$;

alter function relationships.read_relationship_state(uuid, uuid, uuid) owner to allfit_owner;
revoke all on function relationships.read_relationship_state(uuid, uuid, uuid) from public;
grant execute on function relationships.read_relationship_state(uuid, uuid, uuid) to allfit_api;
