-- Following an erasure request — `OP-PRV-021`, `HU-BO-032`.
--
-- The tables this reads already exist: a person who deletes their own data opens a
-- `privacy.disposition_cases` row, one `disposition_items` row per thing to dispose
-- of, and a `disposition_events` row per outcome. What was missing is the officer's
-- side of it: whether anything is still owed to the person who asked.
--
-- Three decisions are worth stating.
--
-- **It lists requests, not dispositions.** A case opened by a retention policy runs
-- under the same rules, but nobody asked for it and nobody is waiting on an answer,
-- so it does not belong on a screen whose whole purpose is the thirty-day clock.
-- `origin` travels in the projection, so widening this later is a filter.
--
-- **Thirty days is a target date, not a countdown.** The function answers `due_at`
-- and never "days left": days computed here are days in the database's zone, and
-- the officer is the one who has to know whether it is late. The period is the one
-- `HU-BO-032` fixes, and it is deliberately not read from a retention policy — a
-- policy says how long data is kept, which is a different clock.
--
-- **The resolution is grouped, not itemised.** Deleting forty meals is one line
-- that says "nutrition, deleted, 40", because the officer is answering "is this
-- person's request finished" and the identifiers of forty deleted rows are exactly
-- the data the erasure was supposed to remove.
--
-- Today every owner request opens and closes inside one transaction, so the open
-- list is empty until a disposition needs a worker or a legal hold. The panel is
-- built for that case now rather than after somebody is already waiting.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- The duty, checked against the tables
-- ---------------------------------------------------------------------------

create or replace function privacy.require_privacy_request_manager(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if not access_control.has_platform_role(
    p_actor_person_id, p_actor_session_id, 'allfit_admin'
  ) then
    raise exception 'following erasure requests requires the platform administrator role'
      using errcode = '42501';
  end if;

  if not access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'manage_privacy_requests'
  ) then
    raise exception 'following erasure requests requires an effective privacy duty'
      using errcode = '42501';
  end if;
end
$function$;

-- ---------------------------------------------------------------------------
-- What a request resolved, category by category
-- ---------------------------------------------------------------------------

-- One line per classification, action and state. `result` is the outcome the
-- disposition recorded; `retained_until` exists only where something was kept, and
-- comes from the policy that decided to keep it.
create or replace function privacy.erasure_request_categories(p_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'data_classification_code', grouped.data_classification_code,
        'action', grouped.action,
        'status', grouped.status,
        'items', grouped.items,
        'result', grouped.result,
        'executed_at', grouped.executed_at,
        'retained_until', grouped.retained_until
      )
      order by grouped.data_classification_code, grouped.action, grouped.status
    ),
    '[]'::jsonb
  )
  from (
    select
      item.data_classification_code as data_classification_code,
      item.action::text as action,
      item.status::text as status,
      count(*)::int as items,
      max(item.executed_at) as executed_at,
      max(
        case
          when item.action = 'retain_restricted' and item.executed_at is not null
            then item.executed_at + policy.retention_period
        end
      ) as retained_until,
      (array_remove(array_agg(latest.result order by latest.executed_at desc), null))[1]
        as result
    from privacy.disposition_items as item
    join privacy.retention_policies as policy on policy.id = item.retention_policy_id
    left join lateral (
      select event.result, event.executed_at
      from privacy.disposition_events as event
      where event.disposition_item_id = item.id
      order by event.executed_at desc
      limit 1
    ) as latest on true
    where item.disposition_case_id = p_case_id
    group by item.data_classification_code, item.action, item.status
  ) as grouped
$function$;

-- ---------------------------------------------------------------------------
-- OP-PRV-021 — the panel
-- ---------------------------------------------------------------------------

create or replace function privacy.list_erasure_requests(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_status text,
  p_limit integer,
  p_cursor_key timestamptz,
  p_cursor_id uuid
)
returns table (
  id uuid,
  subject_person_id uuid,
  origin text,
  status text,
  opened_at timestamptz,
  closed_at timestamptz,
  due_at timestamptz,
  pending_items integer,
  suspended_items integer,
  resolved_items integer,
  categories jsonb
)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  -- The period HU-BO-032 fixes for answering the person who asked.
  response_period constant interval := interval '30 days';
  page uuid[];
begin
  perform privacy.require_privacy_request_manager(p_actor_person_id, p_actor_session_id);

  if p_status is null or p_status not in ('open', 'closed') then
    raise exception 'an erasure request is either open or closed' using errcode = '22023';
  end if;

  if (p_cursor_key is null) <> (p_cursor_id is null) then
    raise exception 'a cursor names both the instant and the request'
      using errcode = '22023';
  end if;

  -- The oldest open request is the most urgent one; a resolved one is read newest
  -- first, because nobody is waiting on it.
  if p_status = 'open' then
    select coalesce(array_agg(selected.id order by selected.opened_at, selected.id), '{}')
    into page
    from (
      select dcase.id, dcase.opened_at
      from privacy.disposition_cases as dcase
      where dcase.origin = 'request'
        and dcase.status = 'open'
        and (
          p_cursor_key is null
          or (dcase.opened_at, dcase.id) > (p_cursor_key, p_cursor_id)
        )
      order by dcase.opened_at, dcase.id
      limit p_limit
    ) as selected;
  else
    select coalesce(
      array_agg(selected.id order by selected.closed_at desc, selected.id desc), '{}'
    )
    into page
    from (
      select dcase.id, dcase.closed_at
      from privacy.disposition_cases as dcase
      where dcase.origin = 'request'
        and dcase.status = 'closed'
        and (
          p_cursor_key is null
          or (dcase.closed_at, dcase.id) < (p_cursor_key, p_cursor_id)
        )
      order by dcase.closed_at desc, dcase.id desc
      limit p_limit
    ) as selected;
  end if;

  -- The read ritual: one record per person revealed, written before the officer
  -- sees anything. It is per person and not per case because two requests from the
  -- same person are one reading of that person's disposition file.
  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, purpose, result, request_id, access_mode
  )
  select
    p_actor_person_id,
    revealed.subject_person_id,
    'privacy.disposition_cases',
    'privacy_request_tracking',
    'allowed',
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    'support_metadata'
  from (
    select distinct dcase.subject_person_id
    from privacy.disposition_cases as dcase
    where dcase.id = any(page)
  ) as revealed;

  return query
  select
    dcase.id,
    dcase.subject_person_id,
    dcase.origin,
    dcase.status,
    dcase.opened_at,
    dcase.closed_at,
    dcase.opened_at + response_period,
    count(*) filter (where item.status = 'pending')::int,
    count(*) filter (where item.status = 'suspended')::int,
    count(*) filter (where item.status = 'executed')::int,
    privacy.erasure_request_categories(dcase.id)
  from privacy.disposition_cases as dcase
  left join privacy.disposition_items as item
    on item.disposition_case_id = dcase.id
  where dcase.id = any(page)
  group by dcase.id, dcase.subject_person_id, dcase.origin, dcase.status,
    dcase.opened_at, dcase.closed_at
  order by
    case when p_status = 'open' then dcase.opened_at end asc,
    case when p_status = 'closed' then dcase.closed_at end desc,
    dcase.id;
end
$function$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function privacy.require_privacy_request_manager(uuid, uuid) from public;
revoke all on function privacy.erasure_request_categories(uuid) from public;
revoke all on function privacy.list_erasure_requests(
  uuid, uuid, text, integer, timestamptz, uuid
) from public;

-- The runtime role runs the panel and nothing under it: not the guard, not the
-- grouping, and never the tables, so there is no path from the API to a case the
-- duty did not open.
grant execute on function privacy.list_erasure_requests(
  uuid, uuid, text, integer, timestamptz, uuid
) to allfit_api;
