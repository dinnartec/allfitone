-- A relationship can tell its own history.
--
-- `OP-REL-011` says how a relationship stands right now. It cannot say how it
-- got there. Since yesterday an administrator can replace the professional in
-- charge, and nothing anywhere shows that the replacement happened — the state
-- document simply names a different holder than it did before. A change in who
-- may read somebody's data that leaves no visible trace is the gap this closes.
--
-- `OP-REL-014` answers it as a timeline, newest first, with a cursor.
--
-- **There is no event table, and this does not add one.** The catalogue names a
-- `RELATIONSHIP_EVENT` entity, and the same catalogue records that the sibling
-- table it names for assignments, `professional_assignment_events`, does not
-- exist in V1 either. The history is derived instead, from the three places that
-- already record it:
--
--   · `service_relationships` carries `started_at`, `ended_at`, `ended_reason`
--     and `ended_by_kind` — the opening, the close, and who closed it.
--   · `relationship_professional_assignments` is a validity-interval table, not
--     an overwritten one. A reassignment closes a row with `valid_to` and
--     inserts the next, so the sequence of holders and substitutions is already
--     there to be read in order.
--   · `privacy.consent_events` is a true append-only log: it has `decided_at`
--     and nothing else that moves.
--
-- What that costs, stated plainly: closing a holder's assignment **updates**
-- that row's `valid_to`, so this is a derived timeline rather than an immutable
-- log. Nothing is deleted and nothing can be — every foreign key into these
-- tables is `on delete restrict`, and `consent_events` has no delete policy at
-- all. A dedicated log would buy strict append-only at the price of retrofitting
-- two functions already serving production and backfilling their history, which
-- is more risk than this screen is worth.
--
-- Nothing here filters by role, for the same reason `read_relationship_state`
-- does not: the row policies already do, and a second copy of that logic is free
-- to drift from the first. One consequence is deliberate and worth naming —
-- `relationship_professional_assignments_select_actor` shows a coach only their
-- own assignment, so **a coach reads a shorter history than an owner** and never
-- learns who attended this person before them.
--
-- The termination reason follows the catalogue's rule: visible only to the party
-- that declared it. Studio acts for the organization, so it reads the reason only
-- when the organization declared it. A reason the person gave for leaving is
-- theirs, and Space is where they see it.

set lock_timeout = '5s';
set statement_timeout = '60s';

/*
 * Encoder and parser, paired as in `execution.history_cursor` /
 * `execution.history_cursor_parts`: base64 over unit-separated fields, `22023`
 * for anything that does not parse.
 *
 * Three fields rather than two, because one assignment row produces more than
 * one event — assigned and ended — and
 * `ck_relationship_professional_assignments_valid_to` admits
 * `valid_to = valid_from`, so neither the instant nor the row id is enough on
 * its own to make the order total. A cursor over a non-total order silently
 * skips or repeats rows at the page boundary, which is the kind of defect that
 * only shows up once there is enough history to need a second page.
 */
create function relationships.history_cursor(
  p_occurred_at timestamp with time zone,
  p_source_id uuid,
  p_rank smallint
)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select encode(convert_to(
    to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    || chr(31) || p_source_id::text
    || chr(31) || p_rank::text,
    'UTF8'), 'base64')
$function$;

alter function relationships.history_cursor(timestamp with time zone, uuid, smallint) owner to allfit_owner;
revoke all on function relationships.history_cursor(timestamp with time zone, uuid, smallint) from public;

create function relationships.history_cursor_parts(p_cursor text)
returns table (sort_at timestamp with time zone, sort_id uuid, sort_rank smallint)
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  parts text[];
begin
  if p_cursor is null or btrim(p_cursor) = '' then
    return;
  end if;
  begin
    parts := string_to_array(convert_from(decode(p_cursor, 'base64'), 'UTF8'), chr(31));
    if array_length(parts, 1) <> 3 then
      raise exception 'invalid cursor';
    end if;
    sort_at := (parts[1] || '+00')::timestamp with time zone;
    sort_id := parts[2]::uuid;
    sort_rank := parts[3]::smallint;
  exception when others then
    raise exception 'invalid cursor' using errcode = '22023';
  end;
  return next;
end;
$function$;

alter function relationships.history_cursor_parts(text) owner to allfit_owner;
revoke all on function relationships.history_cursor_parts(text) from public;

-- ———————————————————————————————————————— OP-REL-014

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
    select 4::smallint,
           'substitution_proposed',
           assignment.valid_from,
           assignment.id,
           jsonb_build_object(
             'assignment_id', assignment.id,
             'membership_id', assignment.membership_id,
             'professional_person_id', membership.person_id,
             'display_name', professional.display_name,
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
