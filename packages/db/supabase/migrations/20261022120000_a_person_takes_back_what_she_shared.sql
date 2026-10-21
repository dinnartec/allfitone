-- What a person shares, and taking one category back, on Space (HU-SP-030, HU-SP-031).
--
-- She decided what to share when she accepted a gym, and from then on could neither see
-- it nor take it back. This adds both, through the person and nothing else:
--
--   · `list_my_consents` (`OP-PRV-013`): per relationship and category she was asked
--     for, the answer she gave and, where she said yes, how that grant stands now —
--     active, frozen by an ended relationship, or revoked.
--   · `revoke_my_grant` (`OP-PRV-005`): one grant, active or frozen, becomes revoked.
--     Nothing else moves: the other grants, her data (ADR-012) and the evidence of who
--     read what before stay as they were. The existing transition trigger already makes
--     it final; sharing again takes a new consent (ADR-007).
--   · `read_relationship_history` tells the moment she stopped sharing.
--
-- No consent event is written for a revocation. That table records answers to an
-- invitation's options, each tied to the option it answered; a revocation answers none.
-- The grant, which cannot change once revoked, and the outbox event are the record.
--
-- Nothing reads a grant through a cache or a projection today, and every reader checks
-- the grant's status in the same statement, so the cut is immediate (criterion 2).

set lock_timeout = '5s';
set statement_timeout = '120s';

-- ———————————————————————————————————————— what she shares

create function privacy.list_my_consents(p_person_id uuid)
returns table (
  relationship_id uuid,
  organization_id uuid,
  organization_name text,
  relationship_status text,
  started_at timestamptz,
  ended_at timestamptz,
  scope_code text,
  presented_snapshot jsonb,
  decision text,
  decided_at timestamptz,
  grant_id uuid,
  grant_status text,
  access_level text,
  granted_at timestamptz,
  frozen_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  -- The latest answer per relationship and category; a yes carries its grant.
  return query
  select distinct on (consent.relationship_id, consent.scope_code)
         consent.relationship_id,
         consent.organization_id,
         organization.display_name::text,
         relationship.status::text,
         relationship.started_at,
         relationship.ended_at,
         consent.scope_code,
         consent.presented_snapshot,
         consent.decision::text,
         consent.decided_at,
         grant_row.id,
         grant_row.status::text,
         grant_row.access_level::text,
         grant_row.granted_at,
         grant_row.frozen_at,
         grant_row.revoked_at
  from privacy.consent_events as consent
  join relationships.service_relationships as relationship
    on relationship.id = consent.relationship_id
  join organizations.organizations as organization
    on organization.id = consent.organization_id
  left join privacy.data_grants as grant_row
    on grant_row.consent_event_id = consent.id
  where consent.person_id = p_person_id
  order by consent.relationship_id, consent.scope_code, consent.decided_at desc;
end
$function$;

-- ———————————————————————————————————————— taking one back

create function privacy.revoke_my_grant(
  p_person_id uuid,
  p_grant_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  grant_id uuid,
  status text,
  revoked_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  target record;
  revoked_instant timestamptz;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  -- Hers, or nothing: somebody else's grant reads as one that does not exist.
  select grant_row.id, grant_row.status, grant_row.relationship_id,
         grant_row.organization_id, grant_row.scope_code, definition.version_number
    into target
  from privacy.data_grants as grant_row
  join privacy.scope_definitions as definition
    on definition.id = grant_row.scope_definition_id
  where grant_row.id = p_grant_id
    and grant_row.person_id = p_person_id
  for update of grant_row;

  if not found then
    raise exception 'grant not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-PRV-005', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query
    select grant_row.id, grant_row.status::text, grant_row.revoked_at, true
    from privacy.data_grants as grant_row
    where grant_row.id = p_grant_id;
    return;
  end if;

  if target.status = 'revoked' then
    raise exception 'the grant is already revoked' using errcode = 'P0004';
  end if;

  revoked_instant := clock_timestamp();
  update privacy.data_grants as grant_row
  set status = 'revoked',
      revoked_at = revoked_instant
  where grant_row.id = p_grant_id;

  -- The category and its version, never what it covered.
  perform system.enqueue_outbox_event(
    'data_grant',
    p_grant_id,
    'privacy.grant_revoked.v1',
    jsonb_build_object(
      'grant_id', p_grant_id,
      'relationship_id', target.relationship_id,
      'organization_id', target.organization_id,
      'scope_code', target.scope_code,
      'scope_version', target.version_number,
      'revoked_at', revoked_instant
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'data-grant-revoked', 'data_grant', p_grant_id
  );

  return query select p_grant_id, 'revoked'::text, revoked_instant, false;
end
$function$;

-- ———————————————————————————————————————— the history says so

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

    union all
    -- She took a category back (`OP-PRV-005`). The scope, never what it covered.
    select 9::smallint,
           'grant_revoked',
           grant_row.revoked_at,
           grant_row.id,
           jsonb_build_object('scope_code', grant_row.scope_code)
    from privacy.data_grants as grant_row
    where grant_row.relationship_id = p_relationship_id
      and grant_row.revoked_at is not null
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

alter function privacy.list_my_consents(uuid) owner to allfit_owner;
revoke all on function privacy.list_my_consents(uuid) from public;
grant execute on function privacy.list_my_consents(uuid) to allfit_api;
alter function privacy.revoke_my_grant(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function privacy.revoke_my_grant(uuid, uuid, uuid, uuid, bytea) from public;
grant execute on function privacy.revoke_my_grant(uuid, uuid, uuid, uuid, bytea) to allfit_api;
