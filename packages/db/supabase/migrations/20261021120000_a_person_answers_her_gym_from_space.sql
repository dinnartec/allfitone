-- A person's side of her gyms, on Space (HU-SP-016..020, HU-SP-095).
--
-- The invitation could be resolved and decided, but only by somebody holding the link,
-- and it never said who sent it. Her relationships could be listed, but not read, not
-- ended by her, and a cover a coach proposed could not be answered at all. This closes
-- those, each through the person and never through a membership she does not have:
--
--   · `resolve_client_invitation` says who invited her.
--   · `list_my_client_invitations` finds the pending invitations addressed to her verified
--     email — the same key the decision already requires (ADR-001) — so an invitation is
--     not lost with the email that carried it. `read_my_client_invitation` and
--     `decide_my_client_invitation` reach one by id; both defer to the token functions,
--     so the email test and every rule of the decision stay in one place.
--   · `read_relationship_history` admits the person reading her own (`OP-REL-014`), and
--     each reader sees only the reason their own side declared.
--   · `decide_substitution` (`OP-REL-005`): a cover runs only once she says yes, and a
--     no is recorded as a no. Silence is neither (ADR-022).
--   · `end_my_relationship` (`OP-REL-007`): the same closing the organization's
--     `OP-REL-008` performs — now one function, `close_relationship`, so the freezing
--     rule lives in one place — written as hers.
--   · `list_my_relationships` names her coach (HU-SP-018).

set lock_timeout = '5s';
set statement_timeout = '120s';

-- ———————————————————————————————————————— who invited her

drop function identity.resolve_client_invitation(bytea);

create function identity.resolve_client_invitation(p_token_hash bytea)
returns table (
  invitation_id uuid,
  status text,
  organization_id uuid,
  organization_display_name text,
  responsible_party jsonb,
  expires_at timestamptz,
  invitation_intent_id uuid,
  scope_options jsonb,
  invited_by text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
begin
  if access_control.actor_kind() <> 'person' then
    raise exception 'person actor required' using errcode = '42501';
  end if;
  if octet_length(p_token_hash) <> 32 then
    raise exception 'invalid invitation token' using errcode = '22023';
  end if;

  select invitation.id,
         invitation.status::text as invitation_status,
         invitation.organization_id,
         invitation.contact::text as contact,
         invitation.expires_at,
         intent.id as intent_id
    into target
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'service_relationship'
  where invitation.token_hash = p_token_hash;

  if not found then
    return;
  end if;

  -- The invitation is addressed to a contact, and only the person who proved
  -- that contact is theirs may read it. Same test as the decision.
  if lower(target.contact) is distinct from
     lower(nullif(current_setting('app.actor_verified_email', true), '')) then
    raise exception 'verified email mismatch' using errcode = '42501';
  end if;

  /*
   * Expiry is settled on read, as it is for team invitations: nothing else
   * runs between the deadline passing and someone arriving with the link, and
   * an invitation that reads as pending after it expired would be answered.
   */
  if target.invitation_status = 'pending' and target.expires_at <= clock_timestamp() then
    update identity.invitations as invitation
    set status = 'expired'
    where invitation.id = target.id;

    update identity.invitation_intents as intent
    set status = 'expired', decided_at = clock_timestamp()
    where intent.invitation_id = target.id
      and intent.status = 'pending';

    perform system.enqueue_outbox_event(
      'invitation',
      target.id,
      'identity.invitation_expired.v1',
      jsonb_build_object('invitation_id', target.id)
    );
    return;
  end if;

  return query
  select target.id,
         target.invitation_status,
         target.organization_id,
         organization.display_name,
         invitation.responsible_party,
         target.expires_at,
         target.intent_id,
         coalesce(
           (
             select jsonb_agg(
                      jsonb_build_object(
                        'scope_code', option.scope_code,
                        'offered_access_level', option.offered_access_level,
                        'purpose', option.purpose,
                        'presented_snapshot_schema_version', option.presented_snapshot_schema_version,
                        'presented_snapshot', option.presented_snapshot,
                        'decision', option.decision
                      )
                      order by option.scope_code
                    )
             from privacy.invitation_scope_options as option
             where option.invitation_intent_id = target.intent_id
           ),
           '[]'::jsonb
         ),
         -- Who sent it, by name: «Te invita Laura Gómez» is part of what she decides on.
         inviter.display_name
  from identity.invitations as invitation
  join organizations.organizations as organization
    on organization.id = invitation.organization_id
  left join organizations.organization_memberships as membership
    on membership.id = invitation.issued_by_membership_id
  left join identity.people as inviter on inviter.id = membership.person_id
  where invitation.id = target.id;
end;
$function$;

grant execute on function identity.resolve_client_invitation(bytea) to allfit_api;

-- ———————————————————————————————————————— her pending invitations

create function identity.list_my_client_invitations()
returns table (
  invitation_id uuid,
  invitation_intent_id uuid,
  organization_id uuid,
  organization_name text,
  invited_by text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  email text := lower(nullif(current_setting('app.actor_verified_email', true), ''));
begin
  -- An account still registering may ask too: it is told something waits, not what.
  if access_control.actor_kind() not in ('account', 'person') then
    raise exception 'person or account actor required' using errcode = '42501';
  end if;
  if email is null then
    raise exception 'a verified email is required' using errcode = '42501';
  end if;

  return query
  select invitation.id,
         intent.id,
         invitation.organization_id,
         organization.display_name,
         inviter.display_name,
         invitation.expires_at
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'service_relationship'
   and intent.status = 'pending'
  join organizations.organizations as organization
    on organization.id = invitation.organization_id
  left join organizations.organization_memberships as membership
    on membership.id = invitation.issued_by_membership_id
  left join identity.people as inviter on inviter.id = membership.person_id
  where invitation.status = 'pending'
    and invitation.expires_at > clock_timestamp()
    and lower(invitation.contact::text) = email
  order by invitation.expires_at asc, invitation.id;
end
$function$;

-- The token functions keep the rules; these only find the token for an id.
create function identity.read_my_client_invitation(p_invitation_id uuid)
returns table (
  invitation_id uuid,
  status text,
  organization_id uuid,
  organization_display_name text,
  responsible_party jsonb,
  expires_at timestamptz,
  invitation_intent_id uuid,
  scope_options jsonb,
  invited_by text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  hash bytea;
begin
  select invitation.token_hash into hash
  from identity.invitations as invitation
  where invitation.id = p_invitation_id;
  if hash is null then
    return;
  end if;
  return query select * from identity.resolve_client_invitation(hash);
end
$function$;

create function identity.decide_my_client_invitation(
  p_person_id uuid,
  p_invitation_id uuid,
  p_intent_id uuid,
  p_relationship_decision text,
  p_scope_decisions jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  invitation_id uuid,
  invitation_status text,
  organization_id uuid,
  invitation_intent_id uuid,
  intent_status text,
  relationship_id uuid,
  granted_scope_codes text[],
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  hash bytea;
begin
  select invitation.token_hash into hash
  from identity.invitations as invitation
  where invitation.id = p_invitation_id;
  if hash is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  return query select * from identity.decide_client_invitation(
    p_person_id, hash, p_intent_id, p_relationship_decision, p_scope_decisions,
    p_idempotency_key, p_command_id, p_request_hash);
end
$function$;

-- ———————————————————————————————————————— the history, read by her too

create or replace function relationships.read_relationship_history(
  p_person_id uuid,
  p_organization_id uuid,
  p_relationship_id uuid,
  p_limit integer,
  p_cursor text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor_membership_id uuid;
  -- `subject`, not `relationship`: the latter is a table alias below, and
  -- PL/pgSQL would resolve `relationship.id` to this variable instead of the
  -- column.
  subject record;
  start record;
  size integer;
  result jsonb;
  -- Whose reason a reader may see: the organization's own, or the person's own.
  viewer_kind identity.actor_kind := case when p_organization_id is null
                                          then 'person' else 'professional' end;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  /*
   * Two readers. Staff read a client's relationship through their organization, as
   * before; the person reads her own from Space (`OP-REL-014`), with no organization,
   * and never through a membership she does not have.
   */
  if p_organization_id is not null then
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

    -- The row policies resolve the organization through `access_control.org()`.
    perform set_config('app.actor_org_id', p_organization_id::text, true);
  end if;

  select relationship.id,
         relationship.person_id,
         relationship.previous_relationship_id,
         relationship.started_at,
         relationship.ended_at,
         relationship.ended_reason,
         relationship.ended_by_kind
    into subject
  from relationships.service_relationships as relationship
  where relationship.id = p_relationship_id
    and (p_organization_id is null or relationship.organization_id = p_organization_id)
    and (p_organization_id is not null or relationship.person_id = p_person_id);

  -- Not found and not permitted are the same answer, as in `OP-REL-011`: telling
  -- a coach a relationship exists but is not theirs leaks that the gym has that
  -- client.
  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;

  size := least(greatest(coalesce(p_limit, 50), 1), 100);

  select * into start from relationships.history_cursor_parts(p_cursor);

  with
  timeline as (
    /*
     * `rank` orders events that share an instant, and is also the third cursor
     * field. It has to stay stable: renumbering a rank re-orders a page someone
     * already holds a cursor into. Append new kinds, never renumber.
     */
    select 1::smallint as rank,
           'relationship_started' as event_type,
           subject.started_at as occurred_at,
           subject.id as source_id,
           jsonb_build_object(
             'continues_relationship_id', subject.previous_relationship_id
           ) as detail

    union all
    select 2::smallint,
           'holder_assigned',
           assignment.valid_from,
           assignment.id,
           jsonb_build_object(
             'assignment_id', assignment.id,
             'membership_id', assignment.membership_id,
             'professional_person_id', membership.person_id,
             'display_name', professional.display_name
           )
    from relationships.relationship_professional_assignments as assignment
    join organizations.organization_memberships as membership
      on membership.id = assignment.membership_id
    join identity.people as professional on professional.id = membership.person_id
    where assignment.relationship_id = p_relationship_id
      and assignment.kind = 'holder'

    union all
    select 3::smallint,
           'holder_ended',
           assignment.valid_to,
           assignment.id,
           jsonb_build_object(
             'assignment_id', assignment.id,
             'membership_id', assignment.membership_id,
             'professional_person_id', membership.person_id,
             'display_name', professional.display_name
           )
    from relationships.relationship_professional_assignments as assignment
    join organizations.organization_memberships as membership
      on membership.id = assignment.membership_id
    join identity.people as professional on professional.id = membership.person_id
    where assignment.relationship_id = p_relationship_id
      and assignment.kind = 'holder'
      and assignment.valid_to is not null

    union all
    /*
     * `created_at`, not `valid_from`. The moment is when somebody asked; the
     * days the cover would run are what they asked about, and both ends of that
     * window belong in the detail where a screen can read them.
     */
    select 4::smallint,
           'substitution_proposed',
           assignment.created_at,
           assignment.id,
           jsonb_build_object(
             'assignment_id', assignment.id,
             'membership_id', assignment.membership_id,
             'professional_person_id', membership.person_id,
             'display_name', professional.display_name,
             'starts_on', assignment.valid_from::date,
             'ends_on', assignment.ends_on
           )
    from relationships.relationship_professional_assignments as assignment
    join organizations.organization_memberships as membership
      on membership.id = assignment.membership_id
    join identity.people as professional on professional.id = membership.person_id
    where assignment.relationship_id = p_relationship_id
      and assignment.kind = 'substitute'

    union all
    -- A substitution only takes effect once the person accepts it, so the
    -- acceptance is its own moment, not a field on the proposal.
    select 5::smallint,
           'substitution_accepted',
           assignment.accepted_by_person_at,
           assignment.id,
           jsonb_build_object(
             'assignment_id', assignment.id,
             'membership_id', assignment.membership_id,
             'professional_person_id', membership.person_id,
             'display_name', professional.display_name
           )
    from relationships.relationship_professional_assignments as assignment
    join organizations.organization_memberships as membership
      on membership.id = assignment.membership_id
    join identity.people as professional on professional.id = membership.person_id
    where assignment.relationship_id = p_relationship_id
      and assignment.kind = 'substitute'
      and assignment.accepted_by_person_at is not null

    union all
    select 6::smallint,
           'substitution_ended',
           assignment.valid_to,
           assignment.id,
           jsonb_build_object(
             'assignment_id', assignment.id,
             'membership_id', assignment.membership_id,
             'professional_person_id', membership.person_id,
             'display_name', professional.display_name
           )
    from relationships.relationship_professional_assignments as assignment
    join organizations.organization_memberships as membership
      on membership.id = assignment.membership_id
    join identity.people as professional on professional.id = membership.person_id
    where assignment.relationship_id = p_relationship_id
      and assignment.kind = 'substitute'
      and assignment.valid_to is not null

    union all
    /*
     * The decision, the scope it names and the version presented — never the
     * data the scope covers. Same separation `OP-REL-011` keeps: learning that
     * measurements were shared is not learning a measurement.
     */
    select 7::smallint,
           'consent_decided',
           consent.decided_at,
           consent.id,
           jsonb_build_object(
             'scope_code', consent.scope_code,
             'decision', consent.decision,
             'scope_definition_id', consent.scope_definition_id
           )
    from privacy.consent_events as consent
    where consent.relationship_id = p_relationship_id

    union all
    select 8::smallint,
           'relationship_ended',
           subject.ended_at,
           subject.id,
           jsonb_build_object(
             'ended_by_kind', subject.ended_by_kind,
             /*
              * Criterion 3, and the catalogue's rule: the reason belongs to the
              * party that declared it. Studio acts for the organization, so a
              * reason it did not give is withheld — `support` and `worker` are
              * not the organization either, and neither is the person.
              * `declared_by_us` says which case this is, so a screen can state
              * that the person ended it without pretending no reason exists.
              */
             'declared_by_us', subject.ended_by_kind = viewer_kind,
             'reason', case
                         when subject.ended_by_kind = viewer_kind
                         then subject.ended_reason
                       end
           )
    where subject.ended_at is not null
  ),
  chosen as (
    select timeline.rank, timeline.event_type, timeline.occurred_at,
           timeline.source_id, timeline.detail
    from timeline
    -- `holder_ended` and the rest only exist once their instant does; an open
    -- assignment has no `valid_to` and contributes no event yet.
    where timeline.occurred_at is not null
      and (
        start.sort_at is null
        or (timeline.occurred_at, timeline.source_id, timeline.rank)
           < (start.sort_at, start.sort_id, start.sort_rank)
      )
    order by timeline.occurred_at desc, timeline.source_id desc, timeline.rank desc
    -- One more than asked: its presence is what says another page exists,
    -- without a second pass over the same union.
    limit size + 1
  ),
  page as (
    select *
    from chosen
    order by occurred_at desc, source_id desc, rank desc
    limit size
  )
  select jsonb_build_object(
    'relationship_id', subject.id,
    'person_id', subject.person_id,
    'data', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'type', page.event_type,
                  'occurred_at', page.occurred_at,
                  'source_id', page.source_id,
                  'detail', page.detail)
                order by page.occurred_at desc, page.source_id desc, page.rank desc)
       from page),
      '[]'::jsonb),
    'page', jsonb_build_object(
      'next_cursor', (
        select relationships.history_cursor(last.occurred_at, last.source_id, last.rank)
        from (select page.occurred_at, page.source_id, page.rank from page
              order by page.occurred_at asc, page.source_id asc, page.rank asc limit 1) as last
        where (select count(*) from chosen) > size),
      'has_more', (select count(*) from chosen) > size))
  into result;

  return result;
end
$function$;

-- ———————————————————————————————————————— closing a relationship, once

-- Every grant frozen and every assignment ended at one instant. Shared by the
-- organization's `OP-REL-008` and the person's `OP-REL-007`.
create function relationships.close_relationship(
  p_relationship_id uuid,
  p_effective_at timestamptz,
  p_ended_by_kind identity.actor_kind,
  p_reason text
)
returns table (frozen_grants integer, closed_assignments integer)
language plpgsql
set search_path = pg_catalog
as $function$
declare
  frozen integer;
  closed integer;
begin
  update relationships.service_relationships as relationship
  set status = 'terminated',
      ended_at = p_effective_at,
      ended_reason = p_reason,
      ended_by_kind = p_ended_by_kind,
      updated_at = p_effective_at
  where relationship.id = p_relationship_id
    and relationship.status = 'active';

  if not found then
    raise exception 'the relationship could not be closed' using errcode = 'P0004';
  end if;

  -- Only what is still active: a grant the person revoked stays revoked.
  update privacy.data_grants as shared
  set status = 'frozen',
      frozen_at = p_effective_at,
      updated_at = p_effective_at
  where shared.relationship_id = p_relationship_id
    and shared.status = 'active';
  get diagnostics frozen = row_count;

  -- The holder and every cover she accepted; an unanswered proposal grants nothing.
  update relationships.relationship_professional_assignments as assignment
  set status = 'ended',
      valid_to = p_effective_at,
      updated_at = p_effective_at
  where assignment.relationship_id = p_relationship_id
    and assignment.status = 'active'
    and (assignment.kind = 'holder' or assignment.accepted_by_person_at is not null);
  get diagnostics closed = row_count;

  return query select frozen, closed;
end
$function$;

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

  select closing.frozen_grants, closing.closed_assignments into frozen, closed
  from relationships.close_relationship(p_relationship_id, effective_at, 'professional', reason) as closing;

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

create function relationships.end_my_relationship(
  p_person_id uuid,
  p_relationship_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  relationship_id uuid,
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
  effective_at timestamptz;
  frozen integer;
  closed integer;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  select relationship.id, relationship.status, relationship.ended_at
    into subject
  from relationships.service_relationships as relationship
  where relationship.id = p_relationship_id
    and relationship.person_id = p_person_id;

  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;

  -- Asking twice is asking for a state that already holds, at the same instant.
  if subject.status = 'terminated' then
    return query select subject.id, subject.ended_at, 0, 0, true;
    return;
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-REL-007', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query
    select subject.id, relationship.ended_at, 0, 0, true
    from relationships.service_relationships as relationship
    where relationship.id = p_relationship_id;
    return;
  end if;

  effective_at := clock_timestamp();
  select closing.frozen_grants, closing.closed_assignments into frozen, closed
  from relationships.close_relationship(
    p_relationship_id, effective_at, 'person', nullif(btrim(coalesce(p_reason, '')), '')
  ) as closing;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'relationship-ended-by-person',
    'service_relationship', p_relationship_id
  );

  return query select p_relationship_id, effective_at, frozen, closed, false;
end
$function$;

-- ———————————————————————————————————————— deciding a cover

-- A rejected cover never had her acceptance, and that is the record it must keep.
alter table relationships.relationship_professional_assignments
  drop constraint ck_relationship_professional_assignments_accepted;
alter table relationships.relationship_professional_assignments
  add constraint ck_relationship_professional_assignments_accepted check (kind = 'holder' or accepted_by_person_at is not null or status in ('proposed', 'rejected'));

create function relationships.decide_substitution(
  p_person_id uuid,
  p_relationship_id uuid,
  p_assignment_id uuid,
  p_decision text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  assignment_id uuid,
  status text,
  accepted_by_person_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  cover record;
  decided_at timestamptz;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'invalid substitution decision' using errcode = '22023';
  end if;

  -- Her own relationship, still active; anyone else is told nothing exists.
  select cover_row.id, cover_row.status, cover_row.ends_on, cover_row.accepted_by_person_at
    into cover
  from relationships.relationship_professional_assignments as cover_row
  join relationships.service_relationships as relationship
    on relationship.id = cover_row.relationship_id
  where cover_row.id = p_assignment_id
    and cover_row.relationship_id = p_relationship_id
    and cover_row.kind = 'substitute'
    and relationship.person_id = p_person_id
    and relationship.status = 'active'
  for update of cover_row;

  if not found then
    raise exception 'substitution not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-REL-005', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select cover.id, cover.status::text, cover.accepted_by_person_at, true;
    return;
  end if;

  -- Decided once; a cover whose end has passed is not there to accept.
  if cover.status <> 'proposed' or cover.ends_on < current_date then
    raise exception 'only a pending substitution can be decided' using errcode = 'P0004';
  end if;

  decided_at := clock_timestamp();
  update relationships.relationship_professional_assignments as cover_row
  set status = case when p_decision = 'accepted' then 'active' else 'rejected' end::relationships.assignment_status,
      accepted_by_person_at = case when p_decision = 'accepted' then decided_at end,
      updated_at = decided_at
  where cover_row.id = cover.id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'relationship-substitution-decided',
    'relationship_professional_assignment', cover.id
  );

  return query
  select cover_row.id, cover_row.status::text, cover_row.accepted_by_person_at, false
  from relationships.relationship_professional_assignments as cover_row
  where cover_row.id = cover.id;
end
$function$;

-- ———————————————————————————————————————— her gyms name her coach

drop function relationships.list_my_relationships(uuid, integer, timestamptz, uuid);

create function relationships.list_my_relationships(
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
  previous_relationship_id uuid,
  holder_name text
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

  -- Which rows come back is still the row policy's decision, as before.
  return query
  select relationship.id,
         relationship.organization_id,
         organization.display_name,
         organization.type_code,
         relationship.status::text,
         relationship.started_at,
         relationship.ended_at,
         relationship.previous_relationship_id,
         holder.display_name
  from relationships.service_relationships as relationship
  join organizations.organizations as organization
    on organization.id = relationship.organization_id
  left join lateral (
    select professional.display_name
    from relationships.relationship_professional_assignments as assignment
    join organizations.organization_memberships as membership
      on membership.id = assignment.membership_id
    join identity.people as professional on professional.id = membership.person_id
    where assignment.relationship_id = relationship.id
      and assignment.kind = 'holder'
      and assignment.status = 'active'
    order by assignment.valid_from desc
    limit 1
  ) as holder on true
  where (
    p_cursor_started_at is null
    or (relationship.started_at, relationship.id) < (p_cursor_started_at, p_cursor_relationship_id)
  )
  order by relationship.started_at desc, relationship.id desc
  limit p_limit;
end
$function$;

alter function identity.list_my_client_invitations() owner to allfit_owner;
revoke all on function identity.list_my_client_invitations() from public;
grant execute on function identity.list_my_client_invitations() to allfit_api;
alter function identity.read_my_client_invitation(uuid) owner to allfit_owner;
revoke all on function identity.read_my_client_invitation(uuid) from public;
grant execute on function identity.read_my_client_invitation(uuid) to allfit_api;
alter function identity.decide_my_client_invitation(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.decide_my_client_invitation(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) from public;
grant execute on function identity.decide_my_client_invitation(uuid, uuid, uuid, text, jsonb, uuid, uuid, bytea) to allfit_api;
alter function relationships.close_relationship(uuid, timestamptz, identity.actor_kind, text) owner to allfit_owner;
revoke all on function relationships.close_relationship(uuid, timestamptz, identity.actor_kind, text) from public;
alter function relationships.end_my_relationship(uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function relationships.end_my_relationship(uuid, uuid, text, uuid, uuid, bytea) from public;
grant execute on function relationships.end_my_relationship(uuid, uuid, text, uuid, uuid, bytea) to allfit_api;
alter function relationships.decide_substitution(uuid, uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function relationships.decide_substitution(uuid, uuid, uuid, text, uuid, uuid, bytea) from public;
grant execute on function relationships.decide_substitution(uuid, uuid, uuid, text, uuid, uuid, bytea) to allfit_api;
alter function relationships.list_my_relationships(uuid, integer, timestamptz, uuid) owner to allfit_owner;
revoke all on function relationships.list_my_relationships(uuid, integer, timestamptz, uuid) from public;
grant execute on function relationships.list_my_relationships(uuid, integer, timestamptz, uuid) to allfit_api;
