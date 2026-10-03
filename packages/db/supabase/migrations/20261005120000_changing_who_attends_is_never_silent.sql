-- Changing who attends somebody is never silent.
--
-- `OP-REL-002` puts a coach where there is none. This is `OP-REL-003`, which
-- takes the client away from the coach who has them, and it exists as its own
-- operation for one reason: it owes the person a notification, and
-- `OP-REL-002` has no way to owe anybody anything.
--
-- The four criteria, and where each one actually lives:
--
--   · **The permission survives.** Nothing here touches `privacy.data_grants`,
--     because nothing it records has changed: not the organization, not the
--     responsible party, not the purpose, not the category. What changes is who
--     may exercise it. A reassignment that re-asked the person for consent
--     would be asking again for something already given.
--   · **The previous professional loses access at once.** `actor_is_assigned`
--     reads `status = 'active'`, so ending the old row is the revocation —
--     there is no cache to wait out and no second place to remember.
--   · **Authorship survives.** The old assignment is ended, never deleted. Who
--     attended this person, and until when, is the record `HU-STUDIO-026`
--     reads, and what the professional registered stays theirs.
--   · **The person is notified, or nothing happens.** The notification is an
--     outbox row written by this function, so it is inside this transaction by
--     construction: if it cannot be written, the reassignment is not written
--     either. That is criterion 4, and it is structural rather than checked —
--     there is no code path where the assignment commits and the notice does
--     not.
--
-- Reassigning to the coach who is already in charge writes nothing and notifies
-- nobody. It is not an error — somebody can reasonably re-confirm what is
-- already true — but it is also not a change, and a notice saying a person's
-- coach changed to the same coach is noise that teaches people to ignore the
-- real one.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function relationships.reassign_relationship_holder(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_relationship_id uuid,
  p_membership_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  assignment_id uuid,
  relationship_id uuid,
  membership_id uuid,
  professional_person_id uuid,
  valid_from timestamptz,
  replaced_assignment_id uuid,
  reassigned boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject record;
  current_holder record;
  assigned_person_id uuid;
  notice record;
  assignment relationships.relationship_professional_assignments%rowtype;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  if not access_control.has_capability(p_organization_id, 'assign_professionals') then
    raise exception 'reassigning a professional requires assign_professionals'
      using errcode = '42501';
  end if;

  select relationship.id, relationship.person_id, relationship.status
    into subject
  from relationships.service_relationships as relationship
  where relationship.id = p_relationship_id
    and relationship.organization_id = p_organization_id;

  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;

  if subject.status <> 'active' then
    raise exception 'only an active relationship takes a holder' using errcode = 'P0004';
  end if;

  select membership.person_id into assigned_person_id
  from organizations.organization_memberships as membership
  join organizations.membership_roles as role
    on role.membership_id = membership.id
   and role.role_code = 'coach'
  where membership.id = p_membership_id
    and membership.organization_id = p_organization_id
    and membership.status = 'active';

  if assigned_person_id is null then
    raise exception 'a holder must be an active coach of this organization'
      using errcode = '42501';
  end if;

  select holder.id, holder.membership_id
    into current_holder
  from relationships.relationship_professional_assignments as holder
  where holder.relationship_id = p_relationship_id
    and holder.kind = 'holder'
    and holder.status = 'active';

  -- Nobody to take the client from. Putting the first coach in charge is
  -- `OP-REL-002`, which notifies nobody because nobody is losing anything.
  if current_holder.id is null then
    raise exception 'this relationship has no holder to change; assigning one is a separate operation'
      using errcode = 'P0004';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-REL-003', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    return query
    select existing.id,
           existing.relationship_id,
           existing.membership_id,
           membership.person_id,
           existing.valid_from,
           null::uuid,
           false,
           true
    from relationships.relationship_professional_assignments as existing
    join organizations.organization_memberships as membership
      on membership.id = existing.membership_id
    where existing.id = receipt.aggregate_id;
    return;
  end if;

  -- Already theirs. Nothing to write and nobody to tell.
  if current_holder.membership_id = p_membership_id then
    select * into assignment
    from relationships.relationship_professional_assignments as holder
    where holder.id = current_holder.id;

    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'relationship-holder-unchanged',
      'relationship_professional_assignment', assignment.id
    );

    return query
    select assignment.id, assignment.relationship_id, assignment.membership_id,
           assigned_person_id, assignment.valid_from, null::uuid, false, false;
    return;
  end if;

  update relationships.relationship_professional_assignments as holder
  set status = 'ended',
      valid_to = clock_timestamp(),
      updated_at = clock_timestamp()
  where holder.id = current_holder.id;

  insert into relationships.relationship_professional_assignments (
    relationship_id, person_id, organization_id, membership_id, kind, status
  )
  values (
    p_relationship_id, subject.person_id, p_organization_id, p_membership_id,
    'holder', 'active'
  )
  returning * into assignment;

  /*
   * Everything the notice has to say, resolved now and carried in the event.
   *
   * The worker could look these up at delivery time instead, but reading a
   * relationship and a person requires widening a row policy written to keep
   * exactly those two out of reach — a large privacy concession to buy a small
   * freshness gain. Resolved here it also reads better: the notice says who
   * attended this person at the moment the change happened, and goes to the
   * contact that was on file then.
   */
  select person.display_name,
         person.contact_email,
         organization.display_name as organization_name,
         incoming.display_name as incoming_name,
         outgoing.display_name as outgoing_name
    into notice
  from identity.people as person
  cross join organizations.organizations as organization
  join organizations.organization_memberships as incoming_membership
    on incoming_membership.id = p_membership_id
  join identity.people as incoming on incoming.id = incoming_membership.person_id
  join organizations.organization_memberships as outgoing_membership
    on outgoing_membership.id = current_holder.membership_id
  join identity.people as outgoing on outgoing.id = outgoing_membership.person_id
  where person.id = subject.person_id
    and organization.id = p_organization_id;

  -- Fails closed. A reassignment nobody can be told about is the silent one the
  -- whole operation exists to prevent, so it does not happen.
  if notice.contact_email is null then
    raise exception 'the person has no contact to notify of a reassignment'
      using errcode = 'P0004';
  end if;

  /*
   * Criterion 4. This row is the notification, and it is written here rather
   * than by whatever calls this function: an outbox insert shares the
   * transaction, so a reassignment that cannot be announced cannot commit.
   */
  perform system.enqueue_outbox_event(
    'service_relationship',
    p_relationship_id,
    'relationship.professional_reassigned.v1',
    jsonb_build_object(
      'relationship_id', p_relationship_id,
      'organization_id', p_organization_id,
      'person_id', subject.person_id,
      'assignment_id', assignment.id,
      'replaced_assignment_id', current_holder.id,
      'contact', notice.contact_email,
      'person_name', notice.display_name,
      'organization_name', notice.organization_name,
      'professional_name', notice.incoming_name,
      'previous_professional_name', notice.outgoing_name
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'relationship-holder-reassigned',
    'relationship_professional_assignment', assignment.id
  );

  return query
  select assignment.id, assignment.relationship_id, assignment.membership_id,
         assigned_person_id, assignment.valid_from, current_holder.id, true, false;
end
$function$;

alter function relationships.reassign_relationship_holder(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea
) owner to allfit_owner;
revoke all on function relationships.reassign_relationship_holder(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea
) from public;
grant execute on function relationships.reassign_relationship_holder(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea
) to allfit_api;
