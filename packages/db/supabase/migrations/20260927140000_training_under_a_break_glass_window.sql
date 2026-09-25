-- A break-glass window reads the training of the person it names (`HU-BO-008`).
--
-- The window opened, answered `allowed`, and handed back nothing. Not a bug in the
-- ceremony — the ceremony was correct — but in what the reader is allowed to see:
-- `execution.executed_sessions` forces row-level security and its only policy is
-- `person_id = access_control.person()`, so a support operator exercising a window
-- sees their own training and nobody else's. `allfit_owner` does not bypass RLS, so
-- `support.exercise_break_glass`, which runs as it, was filtered too. The screen said
-- the person had never trained.
--
-- The other categories do not hit this because their tables carry an `_all_owner`
-- policy over everything and authorise inside the function. That is not copied here.
-- Training stays invisible by default and becomes visible only for the exact case
-- that is already authorised and audited: an approved, live window, opened by this
-- actor, naming this person and this category.
--
-- The authority comes from the window row, never from a flag: a transaction-local
-- setting would be forgeable by the runtime role, and the whole point of the window
-- is that nobody can grant it to themselves.
--
-- The policy is a floor, not the gate. `support.exercise_break_glass` still checks
-- the duty, AAL2, the quorum, the category and the expiry, and writes the access
-- record before returning anything. This only stops the database from hiding the
-- rows that check has already approved.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Whether the acting person may read this subject's data under a window right now.
--
-- Not SECURITY DEFINER on purpose: it runs as whoever is asking, and the window table
-- has its own policy that only answers a support actor.
create or replace function access_control.reads_under_break_glass(
  p_subject_person_id uuid,
  p_category text
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from support.break_glass_requests as window_row
    where window_row.subject_person_id = p_subject_person_id
      and window_row.requester_person_id = access_control.person()
      and window_row.status = 'approved'
      and p_category = any (window_row.categories)
      and clock_timestamp() >= window_row.window_starts_at
      and clock_timestamp() < window_row.window_ends_at
  )
$function$;

alter function access_control.reads_under_break_glass(uuid, text) owner to allfit_owner;
revoke all on function access_control.reads_under_break_glass(uuid, text) from public;

-- Reading only. A window never writes, and this policy must never be the reason one
-- could: `executed_sessions_all_self` stays exactly as Space wrote it.
create policy executed_sessions_break_glass
  on execution.executed_sessions
  for select
  to allfit_owner
  using (access_control.reads_under_break_glass(person_id, 'prior_training_history'));

-- The child tables already follow their parent: their policies ask only whether the
-- session row is visible, so nothing more is needed for segments, sets or laps.

-- This projection shows a session to somebody who is not its owner, which is the one
-- thing row-level security is here to govern — and it was owned by `postgres`, a role
-- that bypasses RLS. It worked for exactly the wrong reason. Owned by `allfit_owner`
-- it is subject to the policy above, so it can only project what the window allows.
alter function execution.session_projection(uuid) owner to allfit_owner;
revoke all on function execution.session_projection(uuid) from public;
