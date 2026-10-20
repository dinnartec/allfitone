-- A cover says whom it covers, so the holder can see it.
--
-- `OP-REL-004` lets the holder propose their own cover. They can create it and
-- then cannot read it, because the row policy on this table identifies a coach
-- by `membership_id` — and a cover carries the *substitute's* membership, not
-- theirs. A professional who asks for cover and never learns whether it was
-- accepted goes away not knowing their client is attended, which is the whole
-- purpose of the story.
--
-- The gap is older than `OP-REL-004`: `OP-REL-011` has always returned an empty
-- `substitutions` array to a holder, and both screens that read it say so in a
-- comment. Nothing could create a substitution, so nothing could fall in.
--
-- **The predicate has to be row-local.** The obvious fix — asking
-- `actor_is_assigned(relationship_id)` — is the one the original migration
-- already recorded as tried and failed: that function reads this very table, so
-- a policy calling it recurses until the stack gives out. `security definer`
-- does not escape it either, because the table forces row level security on its
-- owner too. So the row itself has to name the holder being covered, and
-- `owns_membership` answers from `organization_memberships`, never from here.
--
-- The column earns its place beyond the policy. A substitution exists to cover
-- one particular holder, and until now nothing recorded which: reassign the
-- holder mid-cover and the cover is orphaned, standing in for somebody who no
-- longer attends the person.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table relationships.relationship_professional_assignments
  add column covers_membership_id uuid;

comment on column relationships.relationship_professional_assignments.covers_membership_id is
  'The holder this cover stands in for. Null on a holder row. Lets the holder read a cover that carries somebody else''s membership.';

/*
 * Backfill before constraining, so the constraint below cannot fail a deploy.
 * No substitution exists in any database today — `propose_substitution` is the
 * only thing that creates one, it has been live since 2026-10-13, and no
 * production relationship has a holder to cover. This is a no-op that stops
 * being one the moment that stops being true.
 */
update relationships.relationship_professional_assignments as cover
set covers_membership_id = holder.membership_id
from relationships.relationship_professional_assignments as holder
where cover.kind = 'substitute'
  and cover.covers_membership_id is null
  and holder.relationship_id = cover.relationship_id
  and holder.kind = 'holder'
  and holder.status = 'active';

-- Same composite reference as `membership_id`: the holder being covered belongs
-- to the organization the relationship belongs to, and that is checked by the
-- key rather than by whoever writes the row.
alter table relationships.relationship_professional_assignments
  add constraint fk_relationship_professional_assignments_covers foreign key (covers_membership_id, organization_id) references organizations.organization_memberships(id, organization_id)
  on delete restrict;

alter table relationships.relationship_professional_assignments
  add constraint ck_relationship_professional_assignments_covers check (
    (kind = 'holder' and covers_membership_id is null)
    or (kind = 'substitute' and covers_membership_id is not null)
  );

-- Covering yourself is not covering. `propose_substitution` already refuses it;
-- the table refuses it too, because this is what the read policy leans on.
alter table relationships.relationship_professional_assignments
  add constraint ck_relationship_professional_assignments_covers_not_self check (
    covers_membership_id is null or covers_membership_id <> membership_id
  );

create index idx_relationship_professional_assignments_covers
  on relationships.relationship_professional_assignments (covers_membership_id)
  where covers_membership_id is not null;

/*
 * One more disjunct, and it is row-local on purpose: `owns_membership` reads
 * `organization_memberships`, so this policy still never reads the table it
 * guards.
 *
 * It widens exactly one thing: a professional sees the covers of relationships
 * they hold. It does not let a coach see covers of clients they do not attend,
 * and it does not let a proposed substitute see anything — their own row they
 * could already see by `membership_id`, and the rest of the relationship stays
 * behind `actor_is_assigned`, which refuses a cover nobody has accepted.
 */
create or replace function relationships.relationship_assignment_is_visible(
  p_person_id uuid,
  p_organization_id uuid,
  p_membership_id uuid,
  p_covers_membership_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $function$
  select p_person_id = access_control.person()
    or (
      p_organization_id = access_control.org()
      and (
        access_control.has_capability(p_organization_id, 'view_directory')
        or access_control.owns_membership(p_membership_id)
        or access_control.owns_membership(p_covers_membership_id)
      )
    );
$function$;

alter function relationships.relationship_assignment_is_visible(uuid, uuid, uuid, uuid)
  owner to allfit_owner;
revoke all on function relationships.relationship_assignment_is_visible(uuid, uuid, uuid, uuid) from public;
grant execute on function relationships.relationship_assignment_is_visible(uuid, uuid, uuid, uuid) to allfit_api;

drop policy relationship_professional_assignments_select_actor
  on relationships.relationship_professional_assignments;

create policy relationship_professional_assignments_select_actor
  on relationships.relationship_professional_assignments
  for select to allfit_owner
  using (
    relationships.relationship_assignment_is_visible(
      person_id, organization_id, membership_id, covers_membership_id
    )
  );

-- ———————————————————————————————————————— OP-REL-004

/*
 * The operation now records whom the cover is for. `current_holder` was already
 * resolved to authorise the caller, so this adds a column to the insert and
 * nothing else — and `returning` stays out, because the holder still cannot
 * read the row at the instant it is written: the policy above is evaluated
 * against the row, and the row is theirs to see only once it exists.
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

  if p_membership_id = current_holder.membership_id then
    raise exception 'the holder cannot stand in for themselves' using errcode = 'P0004';
  end if;

  window_start := p_starts_on::timestamptz;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-REL-004', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    return query
    select receipt.aggregate_id, p_relationship_id, p_membership_id, substitute_person_id,
           p_starts_on, p_ends_on, false, true;
    return;
  end if;

  new_assignment_id := extensions.uuid_generate_v7();

  insert into relationships.relationship_professional_assignments (
    id, relationship_id, person_id, organization_id, membership_id,
    covers_membership_id, kind, status, valid_from, ends_on
  )
  values (
    new_assignment_id, p_relationship_id, subject.person_id, p_organization_id,
    p_membership_id, current_holder.membership_id, 'substitute', 'proposed',
    window_start, p_ends_on
  );

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
