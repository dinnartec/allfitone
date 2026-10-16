/*
 * `OP-REL-006` — ending a substitution before its date.
 *
 * HU-STUDIO-030. Two surfaces, one function: an administrator or owner ends it
 * from Studio, and the person being attended ends it from Space. The catalogue
 * gives the operation actors `A2`, `A4` and `A5` — the person, the admin and
 * the owner.
 *
 * `A3` is deliberately absent, and the asymmetry is worth naming because it
 * reads oddly on screen: the holder may *propose* a cover (`OP-REL-004` accepts
 * them) and may not end one. The user story says «como admin u owner», so this
 * follows the story rather than symmetry.
 *
 * **Ending is closing the row, never deleting it.** `status` becomes `ended`
 * and `valid_to` becomes now. Two things fall out of that and neither needs
 * code of its own:
 *
 *   · The access stops at once, because `relationships.actor_is_assigned` —
 *     the formula every row policy in this schema consults — already refuses an
 *     assignment whose `valid_to` has passed. Criterion 1 is a column, not a
 *     job that has to run.
 *
 *   · The relationship's history shows it, because `read_relationship_history`
 *     draws `substitution_ended` from a substitute row having a `valid_to`.
 *
 * What the substitute recorded while covering is untouched, which is criterion
 * 3: this closes an authorisation, it does not retract work.
 *
 * **Only a cover that is running can be ended.** A proposal nobody has answered
 * grants no access, so there is nothing to cut, and closing it the same way
 * would make the history say somebody covered this person and stopped — when
 * nobody ever did. Withdrawing a proposal is a different operation and is
 * recorded as STUDIO-150.
 */

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ———————————————————————————————————————— OP-REL-006

create or replace function relationships.end_substitution(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_relationship_id uuid,
  p_assignment_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  assignment_id uuid,
  relationship_id uuid,
  membership_id uuid,
  professional_person_id uuid,
  ended_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject record;
  cover record;
  closed_at timestamptz;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  /*
   * The organization is an argument on the Studio surface and absent on the
   * Space one, whose route carries no `orgId`: the person reaches a
   * relationship of hers directly. Resolving it from the relationship rather
   * than trusting the caller keeps one tenant check for both surfaces — a
   * Studio caller who names another organization's relationship finds nothing.
   */
  select relationship.id,
         relationship.person_id,
         relationship.organization_id,
         relationship.status
    into subject
  from relationships.service_relationships as relationship
  where relationship.id = p_relationship_id
    and (p_organization_id is null or relationship.organization_id = p_organization_id);

  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;

  /*
   * Only on the Studio surface. `app.actor_org_id` is what tells the row
   * policies which organization the actor is acting inside, and the person
   * reaching her own relationship from Space is acting inside none — handing
   * her that context would lend her a membership she does not have.
   */
  if p_organization_id is not null then
    perform set_config('app.actor_org_id', p_organization_id::text, true);
  end if;

  /*
   * Either the person whose relationship this is, or somebody who may assign
   * professionals in the organization — which is the admin and the owner, and
   * nobody else. A coach is refused here even when the cover stands in for
   * them, which is what keeps this operation inside its catalogue actors.
   */
  if not (
    access_control.is_self(subject.person_id)
    or access_control.has_capability(subject.organization_id, 'assign_professionals')
  ) then
    raise exception 'ending a substitution requires assign_professionals or being the person'
      using errcode = '42501';
  end if;

  select cover_row.id,
         cover_row.membership_id,
         cover_row.status,
         cover_row.valid_to,
         membership.person_id as professional_person_id
    into cover
  from relationships.relationship_professional_assignments as cover_row
  join organizations.organization_memberships as membership
    on membership.id = cover_row.membership_id
  where cover_row.id = p_assignment_id
    and cover_row.relationship_id = p_relationship_id
    and cover_row.kind = 'substitute';

  if not found then
    raise exception 'substitution not found' using errcode = 'P0002';
  end if;

  /*
   * Converges, as the catalogue requires. A cover that is already closed
   * answers with what closed it instead of raising: the caller asked for it to
   * be over and it is over, and a second press after a timeout nobody saw
   * resolve must not read as a failure.
   */
  if cover.status = 'ended' then
    return query
    select cover.id, p_relationship_id, cover.membership_id, cover.professional_person_id,
           cover.valid_to, true;
    return;
  end if;

  /*
   * `P0004` and not `P0002`: the cover exists and the caller may see it, but it
   * is not in a state this operation can act on. A proposal nobody answered is
   * withdrawn, not ended (STUDIO-150), and one the person refused is already
   * over.
   */
  if cover.status <> 'active' then
    raise exception 'only a running substitution can be ended' using errcode = 'P0004';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-REL-006', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    return query
    select cover.id, p_relationship_id, cover.membership_id, cover.professional_person_id,
           cover.valid_to, true;
    return;
  end if;

  closed_at := clock_timestamp();

  update relationships.relationship_professional_assignments as cover_row
  set status = 'ended',
      valid_to = closed_at,
      updated_at = closed_at
  where cover_row.id = cover.id;

  /*
   * An `update` that matches nothing does not fail — it reports success having
   * written nothing, and the caller is told the access was cut when it was not.
   * The row was read a moment ago through the same policies, so zero rows here
   * means something changed underneath or a policy refuses the write; either
   * way the honest answer is to fail the transaction rather than lie about it.
   */
  if not found then
    raise exception 'the substitution could not be closed' using errcode = 'P0004';
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'relationship-substitution-ended',
    'relationship_professional_assignment', cover.id
  );

  return query
  select cover.id, p_relationship_id, cover.membership_id, cover.professional_person_id,
         closed_at, false;
end;
$function$;

alter function relationships.end_substitution(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
revoke all on function relationships.end_substitution(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  from public;
grant execute on function relationships.end_substitution(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
