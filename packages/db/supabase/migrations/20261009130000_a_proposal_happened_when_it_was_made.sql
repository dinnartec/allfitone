-- A proposal happened when it was made, not when the cover would start.
--
-- `read_relationship_history` dated `substitution_proposed` by the assignment's
-- `valid_from`. For a holder that is right — they take over the instant they are
-- assigned — and for a substitution it is the day the cover *would begin*, which
-- is in the future when somebody books a holiday a month ahead.
--
-- Nothing had ever created a substitution, so the rank read as "when it was
-- proposed" and never had to be anything else. `OP-REL-004` creates them now,
-- and a cover proposed today for November landed at the top of a newest-first
-- timeline, dated November: a decision that had already been taken, filed under
-- a date that had not arrived.
--
-- So the moment is `created_at` — when somebody asked — and the window the
-- proposal names moves into the detail, where the screen can read both ends of
-- it. `starts_on` was missing from the detail entirely, so a timeline could say
-- who would cover and until when, but never from when.
--
-- Rank 4 keeps its number. Renumbering re-orders a page somebody already holds
-- a cursor into, which is what the comment inside the function says and is why
-- this changes the instant and not the order.

set lock_timeout = '5s';
set statement_timeout = '60s';

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

  -- The row policies resolve the organization through `access_control.org()`,
  -- which reads this setting and then checks the actor holds a live membership
  -- in it. Omitting it leaves the policies blind and a coach reads nothing.
  perform set_config('app.actor_org_id', p_organization_id::text, true);

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
    and relationship.organization_id = p_organization_id;

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
             'declared_by_us', subject.ended_by_kind = 'professional',
             'reason', case
                         when subject.ended_by_kind = 'professional'
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

alter function relationships.read_relationship_history(uuid, uuid, uuid, integer, text) owner to allfit_owner;
revoke all on function relationships.read_relationship_history(uuid, uuid, uuid, integer, text) from public;
grant execute on function relationships.read_relationship_history(uuid, uuid, uuid, integer, text) to allfit_api;

