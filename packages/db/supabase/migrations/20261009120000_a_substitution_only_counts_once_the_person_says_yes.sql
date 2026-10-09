-- A substitution only counts once the person says yes, and stops counting by
-- itself.
--
-- `OP-REL-004` proposes a professional to cover a client for a while. Two of
-- its criteria are about access rather than about the proposal, and both land
-- in the formula every row policy in this schema asks:
--
--   · Criterion 4 — until the person accepts, the proposed professional reads
--     nothing. **Silence is never acceptance.**
--   · Criterion 8 — the substitution expires on its end date, and the access
--     has to stop "sin depender de que un proceso posterior actualice su
--     estado". So the formula reads the date. Nothing sweeps the table at
--     midnight, and nothing needs to: a job that has not run yet is a job that
--     is still granting access it should not.
--
-- `relationships.actor_is_assigned` honoured neither, because until today no
-- operation created a substitution and the gap could not be reached. It can be
-- reached from the moment the function below exists, which is why both are in
-- one migration: shipping the proposal without the formula would hand somebody
-- permanent access on the first expired cover.
--
-- Three things the formula now also refuses, all of them states the proposal
-- can produce:
--
--   · A substitution whose window has not started. `valid_from` was never
--     checked, which is harmless for a holder — theirs is the instant they were
--     assigned — and wrong for a cover agreed on Monday for next month.
--   · A substitution accepted but past its `ends_on`.
--   · A substitution marked active that nobody accepted. The table's own check
--     already forbids the row; the formula refuses it too, because this is the
--     sentence that decides who reads somebody's health data and it should not
--     depend on a constraint elsewhere staying correct.

set lock_timeout = '5s';
set statement_timeout = '60s';

/*
 * `current_date` and not a timezone-aware boundary, following
 * `professional_credentials.expires_on` in `20260810030000`, which is the same
 * question — valid until a date — answered the same way. A convention that
 * holds across the schema is worth more here than five hours of precision at
 * one boundary.
 */
create or replace function relationships.actor_is_assigned(p_relationship_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from relationships.relationship_professional_assignments as assignment
    join organizations.organization_memberships as membership
      on membership.id = assignment.membership_id
    where assignment.relationship_id = p_relationship_id
      and assignment.status = 'active'
      and assignment.valid_from <= clock_timestamp()
      and (assignment.valid_to is null or assignment.valid_to > clock_timestamp())
      and (
        assignment.kind = 'holder'
        or (
          assignment.accepted_by_person_at is not null
          and assignment.ends_on is not null
          and assignment.ends_on >= current_date
        )
      )
      and membership.person_id = access_control.person()
      and membership.status = 'active'
  );
$function$;

alter function relationships.actor_is_assigned(uuid) owner to allfit_owner;
revoke all on function relationships.actor_is_assigned(uuid) from public;
grant execute on function relationships.actor_is_assigned(uuid) to allfit_api;

-- ———————————————————————————————————————— OP-REL-004

/*
 * Criterion 9, as an index rather than as a look-before-you-write.
 *
 * Asking twice must not leave two pending covers for the same professional
 * over the same window — a double click, or a retry after a timeout the caller
 * never saw resolve. A `select` first and an `insert` after cannot promise
 * that: two commands arriving together both read no proposal and both write
 * one. The index is the only form of the rule that holds under concurrency.
 *
 * It is also the only form the holder can rely on. `A3` is a coach, and this
 * table shows a coach their own assignment rows and nothing else — a cover
 * carries the *substitute's* membership, so the holder who proposed it cannot
 * read it back. A rule that depends on reading it would hold for an
 * administrator and quietly fail for the holder.
 *
 * Partial, like `uidx_relationship_professional_assignments_holder`: once a
 * proposal is answered it stops blocking the next one.
 */
create unique index uidx_relationship_professional_assignments_pending_substitute
  on relationships.relationship_professional_assignments (
    relationship_id, membership_id, valid_from, ends_on
  )
  where kind = 'substitute' and status = 'proposed';

/*
 * Who may propose: the holder, or somebody who may assign professionals.
 *
 * The catalogue says `A3` (el titular) o `A4`, `A5`. The holder is in the list
 * because they are the one who knows they will be away, and asking an
 * administrator to file their own absence is how a client ends up uncovered.
 *
 * This function never reads a *substitution* row, and that is what makes the
 * holder a real actor rather than one only the tests exercise. It runs with the
 * caller's own read permissions, and this table shows a coach their own
 * assignment rows and nothing more: the holder can see the holder row it looks
 * up — theirs — and could not see the cover it writes, which carries somebody
 * else's membership. So every value the operation returns comes from the
 * request or from the idempotency receipt, and criterion 9 is an index rather
 * than a query. An administrator would not have noticed the difference.
 */
create or replace function relationships.propose_substitution(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_relationship_id uuid,
  p_membership_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  assignment_id uuid,
  relationship_id uuid,
  membership_id uuid,
  professional_person_id uuid,
  starts_on date,
  ends_on date,
  proposed boolean,
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
  substitute_person_id uuid;
  notice record;
  new_assignment_id uuid;
  window_start timestamptz;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  /*
   * Fails closed, before anything else is read: the catalogue's «Sin fecha de
   * fin, rechazo». A cover with no end is not a cover.
   *
   * `22023` and not `P0004`, because these three are a malformed request and
   * the handler turns `22023` into 422 and `P0004` into 409. Telling a caller
   * their missing end date is a conflict sends them looking for a conflicting
   * cover that does not exist.
   */
  if p_ends_on is null or p_starts_on is null then
    raise exception 'a substitution needs a start and an end' using errcode = '22023';
  end if;

  if p_ends_on < p_starts_on then
    raise exception 'a substitution cannot end before it starts' using errcode = '22023';
  end if;

  if p_ends_on < current_date then
    raise exception 'a substitution cannot end in the past' using errcode = '22023';
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
    raise exception 'only an active relationship takes a substitution' using errcode = 'P0004';
  end if;

  select holder.id, holder.membership_id
    into current_holder
  from relationships.relationship_professional_assignments as holder
  where holder.relationship_id = p_relationship_id
    and holder.kind = 'holder'
    and holder.status = 'active';

  /*
   * Nobody to cover for. A substitution stands in for a holder, so proposing
   * one where there is none would create a professional whose authority has no
   * source — and `OP-REL-002` is the operation for putting the first coach in
   * charge.
   */
  if current_holder.id is null then
    raise exception 'this relationship has no holder to cover for' using errcode = 'P0004';
  end if;

  if not (
    access_control.has_capability(p_organization_id, 'assign_professionals')
    or access_control.owns_membership(current_holder.membership_id)
  ) then
    raise exception 'proposing a substitution requires assign_professionals or being the holder'
      using errcode = '42501';
  end if;

  select membership.person_id into substitute_person_id
  from organizations.organization_memberships as membership
  join organizations.membership_roles as role
    on role.membership_id = membership.id
   and role.role_code = 'coach'
  where membership.id = p_membership_id
    and membership.organization_id = p_organization_id
    and membership.status = 'active';

  if substitute_person_id is null then
    raise exception 'a substitute must be an active coach of this organization'
      using errcode = '42501';
  end if;

  -- Covering for yourself is not a cover, and it would read as one on the
  -- relationship screen.
  if p_membership_id = current_holder.membership_id then
    raise exception 'the holder cannot stand in for themselves' using errcode = 'P0004';
  end if;

  window_start := p_starts_on::timestamptz;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-REL-004', p_idempotency_key, p_command_id, p_request_hash
  );

  /*
   * The same command arriving twice. `begin_idempotency` has already checked
   * that the request is byte-for-byte the one that was claimed, so every field
   * of the answer is either in the receipt or in the arguments — and reading
   * the row back instead would answer a different question: what the
   * substitution looks like *now*, which may already have been accepted or
   * rejected, rather than what this command did.
   */
  if not receipt.claimed then
    return query
    select receipt.aggregate_id, p_relationship_id, p_membership_id, substitute_person_id,
           p_starts_on, p_ends_on, false, true;
    return;
  end if;

  /*
   * `proposed`, never `active`. The person has not been asked yet, and the
   * formula above refuses a substitute with no `accepted_by_person_at`, so this
   * row grants nothing on its own. That is criterion 3 and criterion 4 written
   * as data rather than as a promise.
   *
   * The id is generated here rather than taken from `returning`, which reads
   * the new row and so answers to the read policy: a holder cannot read a row
   * carrying somebody else's membership, and `returning` would turn their
   * proposal into an error after the write had already happened.
   */
  new_assignment_id := extensions.uuid_generate_v7();

  insert into relationships.relationship_professional_assignments (
    id, relationship_id, person_id, organization_id, membership_id,
    kind, status, valid_from, ends_on
  )
  values (
    new_assignment_id, p_relationship_id, subject.person_id, p_organization_id,
    p_membership_id, 'substitute', 'proposed', window_start, p_ends_on
  );

  -- Resolved here and carried in the event, for the same reason as the
  -- reassignment notice: reading a relationship at delivery time would mean
  -- widening the row policies that keep the worker out of them.
  select person.display_name,
         person.contact_email,
         organization.display_name as organization_name,
         substitute.display_name as substitute_name,
         holder_person.display_name as holder_name
    into notice
  from identity.people as person
  cross join organizations.organizations as organization
  join organizations.organization_memberships as substitute_membership
    on substitute_membership.id = p_membership_id
  join identity.people as substitute on substitute.id = substitute_membership.person_id
  join organizations.organization_memberships as holder_membership
    on holder_membership.id = current_holder.membership_id
  join identity.people as holder_person on holder_person.id = holder_membership.person_id
  where person.id = subject.person_id
    and organization.id = p_organization_id;

  /*
   * Fails closed. A proposal is a question put to the person, and a question
   * nobody can be asked is not pending — it is a professional waiting on an
   * answer that will never come, in a row that looks like it was asked for.
   */
  if notice.contact_email is null then
    raise exception 'the person has no contact to be asked about a substitution'
      using errcode = 'P0004';
  end if;

  perform system.enqueue_outbox_event(
    'service_relationship',
    p_relationship_id,
    'relationship.substitution_proposed.v1',
    jsonb_build_object(
      'relationship_id', p_relationship_id,
      'organization_id', p_organization_id,
      'person_id', subject.person_id,
      'assignment_id', new_assignment_id,
      'contact', notice.contact_email,
      'person_name', notice.display_name,
      'organization_name', notice.organization_name,
      'substitute_name', notice.substitute_name,
      'holder_name', notice.holder_name,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'relationship-substitution-proposed',
    'relationship_professional_assignment', new_assignment_id
  );

  return query
  select new_assignment_id, p_relationship_id, p_membership_id,
         substitute_person_id, p_starts_on, p_ends_on, true, false;
end
$function$;

alter function relationships.propose_substitution(
  uuid, uuid, uuid, uuid, date, date, uuid, uuid, bytea
) owner to allfit_owner;
revoke all on function relationships.propose_substitution(
  uuid, uuid, uuid, uuid, date, date, uuid, uuid, bytea
) from public;
grant execute on function relationships.propose_substitution(
  uuid, uuid, uuid, uuid, date, date, uuid, uuid, bytea
) to allfit_api;
