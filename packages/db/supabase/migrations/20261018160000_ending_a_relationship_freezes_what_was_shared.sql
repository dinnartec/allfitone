/*
 * `OP-REL-008` — the organization ends a relationship.
 *
 * HU-STUDIO-032. One transaction, one effective instant `T`, and nothing in
 * between: «si cualquier paso falla, se revierte todo: no existe una
 * terminación a medias».
 *
 * **Freezing is the heart of it, and freezing is not revoking.** Every grant of
 * the relationship stops at `T`: the organization keeps what it was shown up to
 * `T` and receives nothing created after. Reading that frozen history is not an
 * ordinary read — it happens only through the restricted surface, with a
 * historical-access case, an eligible actor, MFA and a purpose. A `revoked`
 * grant is the other thing entirely, and this operation never produces one.
 *
 * **`T` is read once and used everywhere.** `clock_timestamp()` moves inside a
 * transaction, so calling it per statement would close the relationship at one
 * instant, the grants at another and the assignments at a third — three
 * different answers to «when did this stop», and the one that matters is the
 * one a historical-access case is measured against.
 *
 * **A coach cannot do this**, which is the catalogue's own rule. Nor can the
 * person from here: ending her own relationship is `OP-REL-007`, a separate
 * operation on the Space surface, and it is not built.
 *
 * ———— What this transaction does not do, and why it is not an omission ————
 *
 * The catalogue also asks it to close each managed assignment's management
 * period, pause future planned sessions, and cancel pending correction and
 * nutrition proposals. **None of those can exist yet:**
 *
 *   · `assignment_management_periods` is not a table in V1.
 *   · `planning.program_assignments` is constrained to `lifecycle = 'personal'`
 *     with `origin_relationship_id is null`, so no assignment can come from a
 *     relationship — and a planned session hangs off an assignment.
 *   · There is no proposals table of either kind.
 *
 * So there is nothing to close, pause or cancel. The day that stops being true
 * this operation has to grow with it, and a relationship terminated without
 * closing those would leave access alive after `T` — which is the one thing it
 * exists to prevent. `T-REL-TERMINATE-01` asserts those constraints still
 * stand, so whoever relaxes them is told.
 */

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ———————————————————————————————————————— OP-REL-008

create or replace function relationships.terminate_relationship(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_relationship_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  relationship_id uuid,
  person_id uuid,
  ended_at timestamptz,
  frozen_grants integer,
  closed_assignments integer,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject record;
  notice record;
  effective_at timestamptz;
  frozen integer;
  closed integer;
  reason text;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  -- Blank is not a reason. The column already refuses it, and catching it here
  -- turns a constraint violation into a request the caller can understand.
  reason := nullif(btrim(coalesce(p_reason, '')), '');

  select relationship.id,
         relationship.person_id,
         relationship.status,
         relationship.ended_at
    into subject
  from relationships.service_relationships as relationship
  where relationship.id = p_relationship_id
    and relationship.organization_id = p_organization_id;

  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;

  /*
   * Converges, as the catalogue requires, and converges to the **same `T`**:
   * a relationship that is already over answers with the instant it ended
   * rather than raising. Asking twice is asking for a state that already holds.
   */
  if subject.status = 'terminated' then
    return query
    select subject.id, subject.person_id, subject.ended_at, 0, 0, true;
    return;
  end if;

  /*
   * `assign_professionals` is the capability an administrator and an owner hold
   * and a coach does not, which is exactly the catalogue's «un `coach` no puede
   * ejecutar esta operación». A coach who wants this asks for it instead —
   * `OP-REL-009`, which is not built either.
   */
  if not access_control.has_capability(p_organization_id, 'assign_professionals') then
    raise exception 'ending a relationship requires assign_professionals'
      using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-REL-008', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    select relationship.ended_at into effective_at
    from relationships.service_relationships as relationship
    where relationship.id = p_relationship_id;

    return query
    select p_relationship_id, subject.person_id, effective_at, 0, 0, true;
    return;
  end if;

  -- Read once. Every row this transaction closes carries this same instant, so
  -- «when did this stop» has one answer rather than three.
  effective_at := clock_timestamp();

  update relationships.service_relationships as relationship
  set status = 'terminated',
      ended_at = effective_at,
      ended_reason = reason,
      /*
       * `professional`, not `person`. The history screen reads this column to
       * decide whose decision it was — `declared_by_us` is literally
       * `ended_by_kind = 'professional'` — so writing `person` here would make
       * a client's timeline say she ended a relationship the gym ended.
       */
      ended_by_kind = 'professional',
      updated_at = effective_at
  where relationship.id = p_relationship_id;

  if not found then
    raise exception 'the relationship could not be closed' using errcode = 'P0004';
  end if;

  /*
   * Only the grants still active. The transition guard records `frozen_at` once
   * and refuses to move it, so touching an already-frozen grant would raise —
   * and a grant the person revoked earlier stays revoked, because revoking is
   * the stronger of the two and this must not soften it.
   */
  update privacy.data_grants as shared
  set status = 'frozen',
      frozen_at = effective_at,
      updated_at = effective_at
  where shared.relationship_id = p_relationship_id
    and shared.status = 'active';

  get diagnostics frozen = row_count;

  /*
   * The holder and every cover the person actually accepted, in one statement
   * and at the same instant.
   *
   * A cover nobody answered is left alone, and that is the schema's rule rather
   * than a choice:
   * `ck_relationship_professional_assignments_accepted` lets a substitute leave
   * `proposed` only once `accepted_by_person_at` is set, so an unanswered
   * proposal has no other state to go to. It grants nothing either way —
   * `actor_is_assigned` refuses a substitute without that timestamp — so the
   * row is untidy, not dangerous. Withdrawing it is STUDIO-150's problem.
   */
  update relationships.relationship_professional_assignments as assignment
  set status = 'ended',
      valid_to = effective_at,
      updated_at = effective_at
  where assignment.relationship_id = p_relationship_id
    and assignment.status = 'active'
    and (assignment.kind = 'holder' or assignment.accepted_by_person_at is not null);

  get diagnostics closed = row_count;

  /*
   * The notice carries its own words rather than ids, for the same reason the
   * reassignment notice does: reading the person and the organization at
   * delivery time would mean widening the row policies that keep the worker out
   * of them. And it is written here, inside the transaction, so a termination
   * that cannot be announced is a termination that does not happen.
   */
  select person.display_name,
         person.contact_email,
         organization.display_name as organization_name
    into notice
  from relationships.service_relationships as relationship
  join identity.people as person on person.id = relationship.person_id
  join organizations.organizations as organization
    on organization.id = relationship.organization_id
  where relationship.id = p_relationship_id;

  if notice.contact_email is not null then
    perform system.enqueue_outbox_event(
      'service_relationship',
      p_relationship_id,
      'relationship.terminated.v1',
      jsonb_build_object(
        'relationship_id', p_relationship_id,
        'contact_email', notice.contact_email,
        'person_name', notice.display_name,
        'organization_name', notice.organization_name,
        'ended_at', effective_at,
        'reason', reason
      )
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'relationship-terminated',
    'service_relationship', p_relationship_id
  );

  return query
  select p_relationship_id, subject.person_id, effective_at, frozen, closed, false;
end;
$function$;

alter function relationships.terminate_relationship(uuid, uuid, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;
revoke all on function relationships.terminate_relationship(uuid, uuid, uuid, text, uuid, uuid, bytea)
  from public;
grant execute on function relationships.terminate_relationship(uuid, uuid, uuid, text, uuid, uuid, bytea)
  to allfit_api;
