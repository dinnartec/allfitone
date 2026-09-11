-- OP-SUP-009 — reading the access log.
--
-- `HU-BO-030`. An independent auditor answers "who from the team looked at whose
-- data", which makes this the read that justifies every other read in the system.
-- Three decisions shape it.
--
-- **The log becomes append-only in the database, not by omission.** Before this
-- migration `UPDATE` and `DELETE` on `privacy.access_events` both succeeded. The
-- only thing standing in the way was that `allfit_api` holds no grants on the
-- table — which protects the routes and not the table. Criterion 4 says the record
-- cannot be edited or deleted, and an audit log whose immutability depends on
-- nobody being given a permission is not immutable. Retention still works:
-- dropping a monthly partition is DDL, and a row-level trigger does not see it.
--
-- **Separation of duties is per case, not global.** An auditor who requested or
-- approved one break-glass window is disqualified from auditing *that* window and
-- stays a perfectly good auditor for every other one. The global version is easier
-- to write and would quietly make the whole log unauditable for anyone who had
-- ever approved anything.
--
-- **What is withheld is counted, in its own query.** An auditor who cannot tell
-- their view is partial will read an empty list as "nobody touched this person's
-- data" when somebody did — themselves. The count is a second function rather than
-- a column on the rows precisely so that it survives a list with nothing in it.
-- It reveals nothing they were not already present for, and it tells them to hand
-- the case to someone else.
--
-- The projection carries the record of the access and never what was read. That is
-- not a matter of discipline here: `privacy.access_events` has no content columns
-- at all, and `T-PRV-AUD-01` asserts the declared result type so that a content
-- column added later fails the test instead of leaking.

-- ---------------------------------------------------------------------------
-- Criterion 4 — append-only, including for the owner
-- ---------------------------------------------------------------------------

create or replace function privacy.reject_access_event_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'the access log is append-only' using errcode = '55000';
end
$function$;

-- Row-level triggers on a partitioned parent propagate to every partition, so a
-- write aimed straight at `access_events_2026_09` is refused too.
create trigger trg_access_events_append_only
before update or delete on privacy.access_events
for each row execute function privacy.reject_access_event_rewrite();

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

-- `audit_platform_access` and nothing else. The base role signs you in; a duty
-- authorises an operation. Another effective duty is not a rank that stands in.
create or replace function privacy.require_access_log_auditor(
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
    raise exception 'reading the access log requires the platform administrator role'
      using errcode = '42501';
  end if;

  if not access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'audit_platform_access'
  ) then
    raise exception 'reading the access log requires an effective audit duty'
      using errcode = '42501';
  end if;
end
$function$;

-- ---------------------------------------------------------------------------
-- The per-case disqualification, shared by both queries
-- ---------------------------------------------------------------------------

-- True when this access row belongs to a break-glass case the actor requested or
-- decided. Written once so the list and the count can never disagree about which
-- rows are withheld — two copies of this rule would drift and the count would stop
-- describing the list.
create or replace function privacy.is_own_break_glass_case(
  p_event_id uuid,
  p_event_occurred_at timestamptz,
  p_actor_person_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from support.break_glass_events as evidence
    where evidence.access_event_id = p_event_id
      and evidence.access_event_occurred_at = p_event_occurred_at
      and (
        evidence.requester_person_id = p_actor_person_id
        or exists (
          select 1
          from support.break_glass_approvals as approval
          where approval.request_id = evidence.request_id
            and approval.approver_person_id = p_actor_person_id
        )
      )
  )
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-009 — the log
-- ---------------------------------------------------------------------------

create or replace function privacy.list_access_events(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_filter_actor_person_id uuid,
  p_filter_subject_person_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer
)
returns table (
  actor_person_id uuid,
  subject_person_id uuid,
  resource text,
  resource_id uuid,
  purpose text,
  result text,
  scope_code text,
  scope_version integer,
  access_mode privacy.access_mode,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  -- `perform`, inside plpgsql, and deliberately not a cross join in a `language
  -- sql` body: the guard returns void, so the planner is free to elide an unused
  -- FROM item and the check would never run. That mistake was made here first and
  -- T-PRV-AUD-01 caught it.
  perform privacy.require_access_log_auditor(p_actor_person_id, p_actor_session_id);

  return query
  select
    event.actor_person_id,
    event.subject_person_id,
    event.resource,
    event.resource_id,
    event.purpose,
    event.result,
    event.scope_code,
    event.scope_version,
    event.access_mode,
    event.occurred_at
  from privacy.access_events as event
  where (p_filter_actor_person_id is null or event.actor_person_id = p_filter_actor_person_id)
    and (
      p_filter_subject_person_id is null
      or event.subject_person_id = p_filter_subject_person_id
    )
    and (p_from is null or event.occurred_at >= p_from)
    and (p_to is null or event.occurred_at < p_to)
    and not privacy.is_own_break_glass_case(
      event.id, event.occurred_at, p_actor_person_id
    )
  order by event.occurred_at desc, event.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$function$;

-- The same filters, counting only what the auditor is disqualified from, so an
-- empty list still says what it is missing.
create or replace function privacy.count_withheld_access_events(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_filter_actor_person_id uuid,
  p_filter_subject_person_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  withheld integer;
begin
  perform privacy.require_access_log_auditor(p_actor_person_id, p_actor_session_id);

  select count(*)::integer into withheld
  from privacy.access_events as event
  where (p_filter_actor_person_id is null or event.actor_person_id = p_filter_actor_person_id)
    and (
      p_filter_subject_person_id is null
      or event.subject_person_id = p_filter_subject_person_id
    )
    and (p_from is null or event.occurred_at >= p_from)
    and (p_to is null or event.occurred_at < p_to)
    and privacy.is_own_break_glass_case(
      event.id, event.occurred_at, p_actor_person_id
    );

  return withheld;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function privacy.reject_access_event_rewrite() owner to allfit_owner;
alter function privacy.require_access_log_auditor(uuid, uuid) owner to allfit_owner;
alter function privacy.is_own_break_glass_case(uuid, timestamptz, uuid) owner to allfit_owner;
alter function privacy.list_access_events(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) owner to allfit_owner;
alter function privacy.count_withheld_access_events(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz
) owner to allfit_owner;

revoke all on function privacy.require_access_log_auditor(uuid, uuid) from public;
revoke all on function privacy.is_own_break_glass_case(uuid, timestamptz, uuid) from public;
revoke all on function privacy.list_access_events(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) from public;
revoke all on function privacy.count_withheld_access_events(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz
) from public;

-- The runtime role runs the two queries. It never runs the guard, never runs the
-- disqualification on its own, and never reaches the table — so there is no path
-- from the API to an unfiltered log.
grant execute on function privacy.list_access_events(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) to allfit_api;
grant execute on function privacy.count_withheld_access_events(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz
) to allfit_api;
