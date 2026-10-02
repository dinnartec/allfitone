-- Somebody has to be the one who attends them.
--
-- `relationship_professional_assignments` has existed since the relationships
-- schema was created, and the client directory already reads it: a coach sees
-- the people assigned to them and nobody else. But nothing could ever write a
-- row. So in production today a coach sees **zero clients** and always will,
-- however many the gym has — not a bug in the directory, a missing half.
--
-- This is that half, and only that half. `OP-REL-002` puts a holder on a
-- relationship that has none. Replacing a holder is `OP-REL-003`, a separate
-- operation on its own surface, because it carries a rule this one does not:
-- the person is notified inside the same transaction, and if that notification
-- cannot be enqueued the change does not commit. Changing who can act on
-- somebody's data without being able to tell them is not a side effect. So
-- when a relationship already has a different holder, this function refuses
-- rather than quietly doing the other operation's job without its guarantee.
--
-- The table already carries most of the story's criteria in its own shape, and
-- this function does not restate them:
--
--   · Criterion 2, nobody from another organization: the foreign key is
--     composite on `(membership_id, organization_id)`, so a membership of a
--     different gym simply does not fit. Structural, not a check somebody can
--     forget.
--   · Criterion 3, one effective holder: `uidx_..._holder` is unique on the
--     relationship where the kind is holder and the status active. Two commands
--     racing collide with the index rather than with a line of code, and the
--     loser fails closed.
--   · Criterion 4, assigning grants no data: nothing here touches
--     `privacy.data_grants`. An assignment says who attends, never what they
--     may read, and those are two of the five conditions a read must satisfy.
--
-- What is left is criterion 1 — the person assigned holds a live membership
-- here **and the coach role** — and that is what this function checks before
-- anything is written.
--
-- The matrix also names a `PROFESSIONAL_ASSIGNMENT_EVENT` record. No such table
-- exists in V1, and inventing one here would be a guess at a shape nobody has
-- designed; the outbox event carries the same fact and is what every other
-- command in this schema uses.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function relationships.assign_relationship_holder(
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
  person_id uuid,
  valid_from timestamptz,
  created boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  target record;
  current_holder record;
  assigned_person_id uuid;
  assignment relationships.relationship_professional_assignments%rowtype;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  if not access_control.has_capability(p_organization_id, 'assign_professionals') then
    raise exception 'assigning a professional requires assign_professionals'
      using errcode = '42501';
  end if;

  select relationship.id,
         relationship.person_id,
         relationship.status
    into target
  from relationships.service_relationships as relationship
  where relationship.id = p_relationship_id
    and relationship.organization_id = p_organization_id;

  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;

  -- A terminated relationship has nobody to attend. Assigning into one would
  -- create a responsibility over a link that no longer exists.
  if target.status <> 'active' then
    raise exception 'only an active relationship takes a holder' using errcode = 'P0004';
  end if;

  /*
   * Criterion 1, and the only one the table cannot enforce on its own: a live
   * membership in this organization carrying the coach role. The composite
   * foreign key already guarantees the organization; what it cannot see is
   * whether that membership is still active or what role it holds.
   */
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

  -- Taking the holder away from somebody is `OP-REL-003`, and it owes the
  -- person a notification this operation never sends.
  if current_holder.id is not null and current_holder.membership_id <> p_membership_id then
    raise exception 'this relationship already has a holder; changing it is a separate operation'
      using errcode = 'P0004';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-REL-002', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    return query
    select existing.id,
           existing.relationship_id,
           existing.membership_id,
           existing.person_id,
           existing.valid_from,
           false,
           true
    from relationships.relationship_professional_assignments as existing
    where existing.id = receipt.aggregate_id;
    return;
  end if;

  /*
   * Already the holder. Ending and recreating the same assignment would churn
   * the history and reset the date they have attended this person since, so
   * this answers with what is already true and writes nothing.
   */
  if current_holder.id is not null then
    select * into assignment
    from relationships.relationship_professional_assignments as holder
    where holder.id = current_holder.id;

    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'relationship-holder-unchanged',
      'relationship_professional_assignment', assignment.id
    );

    return query
    select assignment.id, assignment.relationship_id, assignment.membership_id,
           assignment.person_id, assignment.valid_from, false, false;
    return;
  end if;

  insert into relationships.relationship_professional_assignments (
    relationship_id, person_id, organization_id, membership_id, kind, status
  )
  values (
    p_relationship_id, target.person_id, p_organization_id, p_membership_id,
    'holder', 'active'
  )
  returning * into assignment;

  perform system.enqueue_outbox_event(
    'service_relationship',
    p_relationship_id,
    'relationship.professional_assigned.v1',
    jsonb_build_object(
      'relationship_id', p_relationship_id,
      'assignment_id', assignment.id,
      'membership_id', p_membership_id
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'relationship-holder-assigned',
    'relationship_professional_assignment', assignment.id
  );

  return query
  select assignment.id, assignment.relationship_id, assignment.membership_id,
         assignment.person_id, assignment.valid_from, true, false;
end
$function$;

alter function relationships.assign_relationship_holder(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea
) owner to allfit_owner;
revoke all on function relationships.assign_relationship_holder(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea
) from public;
grant execute on function relationships.assign_relationship_holder(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea
) to allfit_api;
