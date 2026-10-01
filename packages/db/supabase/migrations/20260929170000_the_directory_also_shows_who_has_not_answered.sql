-- OP-REL-010 — the directory also shows who was invited and has not answered.
--
-- The previous version of this function listed relationships only, and said so:
-- "NOT YET RETURNED: the invitation state the matrix also asks for." Invitations
-- with a `service_relationship` intent did not exist then. They do now.
--
-- Listing relationships alone would make the invitation state the matrix asks
-- for a constant: a relationship only exists once somebody accepted, so its
-- invitation is always `accepted`. Worse, an organization that invited twenty
-- people and heard back from twelve would have nowhere at all to see the other
-- eight — no other operation lists client invitations, unlike team ones.
--
-- So a directory entry is now one of two things, and says which: a relationship
-- with a person behind it, or an invitation nobody has answered yet. The second
-- kind deliberately carries no person and no name, because HU-STUDIO-023
-- criterion 8 is that nothing exists until the person accepts — not even a
-- provisional person. It carries the masked contact the invitation was sent to,
-- in the same form the issuing command already returns.
--
-- Who sees the unanswered ones follows who sees the answered ones. Holding
-- `view_directory` shows every invitation of the organization. A coach holds
-- only `view_assigned_directory`, and an unanswered invitation has no
-- assignment to narrow by, so the narrowing is the one that does exist: the
-- invitations that coach issued. A coach does not see what a colleague sent.
--
-- That check lives here rather than in a row policy because
-- `identity.invitations` is `using (true)` for the owner — its security is the
-- function's, as `resolve_staff_invitation` and the others already assume.

set lock_timeout = '5s';
set statement_timeout = '60s';

drop function if exists relationships.list_organization_clients(
  uuid, uuid, text, integer, text, text, uuid
);

create or replace function relationships.list_organization_clients(
  p_person_id uuid,
  p_organization_id uuid,
  p_status text,
  p_limit integer,
  p_cursor_group text,
  p_cursor_name text,
  p_cursor_id uuid
)
returns table (
  entry_kind text,
  relationship_id uuid,
  invitation_id uuid,
  person_id uuid,
  display_name text,
  contact_hint text,
  relationship_status text,
  invitation_status text,
  started_at timestamptz,
  ended_at timestamptz,
  sort_group text,
  sort_name text,
  sort_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  sees_every_client boolean;
  actor_membership_id uuid;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in ('active', 'terminated', 'invited') then
    raise exception 'invalid directory status' using errcode = '22023';
  end if;

  if p_limit not between 1 and 101 then
    raise exception 'invalid page limit' using errcode = '22023';
  end if;

  if (p_cursor_group is null) <> (p_cursor_name is null)
     or (p_cursor_group is null) <> (p_cursor_id is null)
     or (p_cursor_group is not null
         and p_cursor_group not in ('active', 'invited', 'terminated')) then
    raise exception 'invalid directory cursor' using errcode = '22023';
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
    raise exception 'client directory requires a directory capability'
      using errcode = '42501';
  end if;

  sees_every_client := access_control.has_capability(p_organization_id, 'view_directory');

  /*
   * The row policy resolves the organization through `access_control.org()`,
   * which reads this setting and then checks the actor really holds a live
   * membership in it. Declaring it here grants nothing the check above would
   * not already allow; omitting it leaves the policy blind to the organization,
   * and a coach would silently see an empty directory.
   */
  perform set_config('app.actor_org_id', p_organization_id::text, true);

  return query
  with entries as (
    -- People the organization already has a relationship with. Which of these
    -- come back is the row policy's decision, not this function's.
    select
      'relationship'::text as entry_kind,
      relationship.id as relationship_id,
      null::uuid as invitation_id,
      relationship.person_id,
      person.display_name,
      null::text as contact_hint,
      relationship.status::text as relationship_status,
      'accepted'::text as invitation_status,
      relationship.started_at,
      relationship.ended_at,
      relationship.status::text as sort_group,
      lower(person.display_name) collate "C" as sort_name,
      relationship.id as sort_id
    from relationships.service_relationships as relationship
    join identity.people as person on person.id = relationship.person_id
    where relationship.organization_id = p_organization_id

    union all

    -- People who were invited and have not answered. No person, no name: until
    -- they accept, neither exists.
    select
      'invitation'::text,
      null::uuid,
      invitation.id,
      null::uuid,
      null::text,
      left(invitation.contact::text, 1) || '***'
        || substring(invitation.contact::text from position('@' in invitation.contact::text)),
      null::text,
      intent.status::text,
      invitation.created_at,
      null::timestamptz,
      'invited'::text,
      lower(invitation.contact::text) collate "C",
      invitation.id
    from identity.invitations as invitation
    join identity.invitation_intents as intent
      on intent.invitation_id = invitation.id
     and intent.kind = 'service_relationship'
     and intent.status = 'pending'
    where invitation.organization_id = p_organization_id
      and invitation.status = 'pending'
      and (sees_every_client or invitation.issued_by_membership_id = actor_membership_id)
  )
  select
    entries.entry_kind,
    entries.relationship_id,
    entries.invitation_id,
    entries.person_id,
    entries.display_name,
    entries.contact_hint,
    entries.relationship_status,
    entries.invitation_status,
    entries.started_at,
    entries.ended_at,
    entries.sort_group,
    entries.sort_name,
    entries.sort_id
  from entries
  where (p_status is null or entries.sort_group = p_status)
    and (
      p_cursor_group is null
      or (entries.sort_group, entries.sort_name, entries.sort_id)
         > (p_cursor_group, lower(p_cursor_name) collate "C", p_cursor_id)
    )
  order by entries.sort_group, entries.sort_name, entries.sort_id
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
