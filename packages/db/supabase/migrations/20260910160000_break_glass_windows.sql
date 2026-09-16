-- Break-glass windows: `OP-SUP-001` through `OP-SUP-004`.
--
-- The exceptional path. A member of staff who cannot resolve a case with the
-- minimised projection asks for a narrow, approved, time-boxed window over one
-- person's data, and every exercise of it leaves evidence the person can see.
--
-- Three tables, and the reason there are three: the request is the file, the
-- approvals are append-only decisions by other people, and the events are the
-- proof of what was actually reached. Collapsing any two of them would let a
-- single write both authorise and record itself.
--
-- What the server decides and the client never sends: the sensitivity tier, the
-- number of approvals and the duration. They follow from the categories asked
-- for — standard is one approver and thirty minutes, restricted two distinct
-- approvers and fifteen. A mixed request inherits the most restrictive tier.
--
-- `nutrition_media` and everything else on the forbidden list is not a category
-- with a higher bar; it is refused before a window can exist, and the attempt is
-- recorded. There is no scope for "the whole account", no extension and no
-- reopening: continuing means asking again.
--
-- **The exercise never raises, and that is a correctness requirement rather than
-- a style choice.** A denied attempt has to leave evidence, and in PostgreSQL an
-- exception rolls back the whole function — including the two rows that prove the
-- attempt happened. So the function returns its outcome and the API turns a
-- denial into 403. "Fails closed" means returning no content, not throwing.
--
-- What this slice cannot finish, said plainly rather than implied: `OP-SUP-003`
-- reads over `execution` and `nutrition`, and neither schema exists. So an
-- authorised exercise records its evidence and answers `content_unavailable`
-- instead of inventing data. The authorisation half is complete and tested; the
-- projection half waits for those domains.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

-- The five closed purposes from ADR-028. There is deliberately no `other`:
-- marketing, commercial recovery, AI training and operational curiosity are not
-- purposes, and an open field would become all four.
create type support.break_glass_purpose as enum (
  'service_dispute',
  'legal_or_regulatory_obligation',
  'customer_support_request',
  'security_investigation',
  'authorized_quality_review'
);

create type support.break_glass_tier as enum ('standard', 'restricted');

-- Tier, quorum and duration are derived, never declared. A request that could
-- state its own tier could state the cheapest one.
create or replace function support.break_glass_category_tier(p_category text)
returns support.break_glass_tier
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_category in ('relationship_training', 'prior_training_history', 'nutrition_guidance')
      then 'standard'::support.break_glass_tier
    when p_category in ('body_progress', 'health_context', 'nutrition_intake')
      then 'restricted'::support.break_glass_tier
  end
$function$;

create or replace function support.break_glass_scope_tier(p_categories text[])
returns support.break_glass_tier
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  category text;
  tier support.break_glass_tier;
  worst support.break_glass_tier := 'standard';
begin
  if p_categories is null or cardinality(p_categories) = 0 then
    raise exception 'a break-glass request names at least one category'
      using errcode = '22023';
  end if;

  foreach category in array p_categories loop
    tier := support.break_glass_category_tier(category);
    -- A forbidden category is not a stricter tier: it has no tier at all.
    if tier is null then
      raise exception 'category % can never be approved for break-glass', category
        using errcode = '42501';
    end if;
    if tier = 'restricted' then worst := 'restricted'; end if;
  end loop;

  return worst;
end
$function$;

create or replace function support.break_glass_required_approvals(p_tier support.break_glass_tier)
returns smallint
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_tier when 'restricted' then 2::smallint else 1::smallint end
$function$;

create or replace function support.break_glass_duration_minutes(p_tier support.break_glass_tier)
returns smallint
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_tier when 'restricted' then 15::smallint else 30::smallint end
$function$;

-- ---------------------------------------------------------------------------
-- The request
-- ---------------------------------------------------------------------------

create table support.break_glass_requests (
  id uuid not null default extensions.uuid_generate_v7(),
  requester_person_id uuid not null,
  requester_duty_assignment_id uuid not null,
  subject_person_id uuid not null,
  policy_code text not null default 'break_glass.v1',
  categories text[] not null,
  purpose support.break_glass_purpose not null,
  case_reference text not null,
  sensitivity_tier support.break_glass_tier not null,
  required_approvals smallint not null,
  requested_duration_minutes smallint not null,
  requested_at timestamptz not null default clock_timestamp(),
  request_expires_at timestamptz not null,
  status text not null default 'requested',
  window_starts_at timestamptz,
  window_ends_at timestamptz,
  closed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_person_id uuid,
  reviewed_by_duty_assignment_id uuid,
  review_outcome text,
  constraint pk_break_glass_requests primary key (id),
  -- The carrier key the evidence rows reference, so an event cannot be attached
  -- to a request while naming a different requester or subject.
  constraint uq_break_glass_requests_carrier unique (id, requester_person_id, subject_person_id, requester_duty_assignment_id),
  constraint fk_break_glass_requests_requester foreign key (requester_person_id) references identity.people (id) on delete restrict,
  constraint fk_break_glass_requests_subject foreign key (subject_person_id) references identity.people (id) on delete restrict,
  constraint fk_break_glass_requests_reviewer foreign key (reviewed_by_person_id) references identity.people (id) on delete restrict,
  constraint fk_break_glass_requests_duty foreign key (requester_duty_assignment_id) references support.platform_duty_assignments (id) on delete restrict,
  constraint fk_break_glass_requests_review_duty foreign key (reviewed_by_duty_assignment_id) references support.platform_duty_assignments (id) on delete restrict,
  -- Nobody opens a window over their own data.
  constraint ck_break_glass_requests_not_self check (requester_person_id <> subject_person_id),
  constraint ck_break_glass_requests_policy check (policy_code = 'break_glass.v1'),
  -- Duplicates are refused too, but by the trigger below: a CHECK cannot contain
  -- the subquery that de-duplicating an array needs.
  constraint ck_break_glass_requests_categories check (
    cardinality(categories) > 0
    and categories <@ array['relationship_training', 'prior_training_history', 'nutrition_guidance', 'body_progress', 'health_context', 'nutrition_intake']
  ),
  constraint ck_break_glass_requests_case check (case_reference ~ '^[A-Z][A-Z0-9_-]{2,63}$'),
  -- A pending request dies on its own after thirty minutes, whether or not any
  -- job runs. The expiry is arithmetic, not a scheduled task.
  constraint ck_break_glass_requests_expiry check (request_expires_at = requested_at + interval '30 minutes'),
  constraint ck_break_glass_requests_status check (status in ('requested', 'approved', 'rejected', 'closed', 'expired')),
  constraint ck_break_glass_requests_derived check (
    required_approvals = support.break_glass_required_approvals(sensitivity_tier)
    and requested_duration_minutes = support.break_glass_duration_minutes(sensitivity_tier)
  ),
  -- Exact shape per state: a window exists only once approved, and a closure or
  -- a review only on a state that can carry one.
  constraint ck_break_glass_requests_window check (
    (status in ('requested', 'rejected', 'expired') and window_starts_at is null and window_ends_at is null)
    or (status in ('approved', 'closed') and window_starts_at is not null and window_ends_at = window_starts_at + make_interval(mins => requested_duration_minutes))
  ),
  constraint ck_break_glass_requests_closure check ((status = 'closed') = (closed_at is not null)),
  constraint ck_break_glass_requests_review check (
    (reviewed_at is null and reviewed_by_person_id is null and reviewed_by_duty_assignment_id is null and review_outcome is null)
    or (reviewed_at is not null and reviewed_by_person_id is not null and reviewed_by_duty_assignment_id is not null and review_outcome in ('justified', 'unjustified', 'incident_opened'))
  ),
  -- A reviewer who requested or approved the case is not independent, and the
  -- one who reviews is never the subject either.
  constraint ck_break_glass_requests_reviewer_independent check (
    reviewed_by_person_id is null
    or (reviewed_by_person_id <> requester_person_id and reviewed_by_person_id <> subject_person_id)
  )
);

create index idx_break_glass_requests_requester on support.break_glass_requests (requester_person_id, status, request_expires_at);
create index idx_break_glass_requests_subject on support.break_glass_requests (subject_person_id, requested_at desc);
create index idx_break_glass_requests_pending on support.break_glass_requests (status, request_expires_at);
create index idx_break_glass_requests_windows on support.break_glass_requests (status, window_ends_at);
create index idx_break_glass_requests_review on support.break_glass_requests (reviewed_at) where status in ('closed', 'expired');

alter table support.break_glass_requests enable row level security;
alter table support.break_glass_requests force row level security;

-- No client reaches these tables. The closed functions are the only path, and
-- they revalidate authority on every call.
create policy break_glass_requests_select_platform on support.break_glass_requests
for select
using (access_control.actor_kind() = 'support');

create policy break_glass_requests_insert_platform on support.break_glass_requests
for insert
with check (access_control.actor_kind() = 'support');

create policy break_glass_requests_update_platform on support.break_glass_requests
for update
using (access_control.actor_kind() = 'support');

comment on table support.break_glass_requests is
  'Immutable break-glass file. Subject, scope, purpose and duration never change.';

-- Subject, scope, purpose and duration are immutable. Only the state machine and
-- the review may move, and only forward.
-- The array rules a CHECK cannot express.
create or replace function support.enforce_break_glass_scope()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if cardinality(new.categories) <> (
    select count(distinct category) from unnest(new.categories) as category
  ) then
    raise exception 'a break-glass request names each category once'
      using errcode = '22023';
  end if;
  return new;
end
$function$;

create trigger trg_break_glass_requests_scope
before insert on support.break_glass_requests
for each row execute function support.enforce_break_glass_scope();

create or replace function support.prevent_break_glass_request_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a break-glass request is never deleted' using errcode = '55000';
  end if;
  if new.requester_person_id is distinct from old.requester_person_id
    or new.subject_person_id is distinct from old.subject_person_id
    or new.requester_duty_assignment_id is distinct from old.requester_duty_assignment_id
    or new.categories is distinct from old.categories
    or new.purpose is distinct from old.purpose
    or new.case_reference is distinct from old.case_reference
    or new.sensitivity_tier is distinct from old.sensitivity_tier
    or new.required_approvals is distinct from old.required_approvals
    or new.requested_duration_minutes is distinct from old.requested_duration_minutes
    or new.requested_at is distinct from old.requested_at
    or new.request_expires_at is distinct from old.request_expires_at then
    raise exception 'the subject, scope, purpose and duration of a break-glass request are immutable'
      using errcode = '55000';
  end if;
  -- No reopening and no extension: a terminal state is terminal.
  if old.status in ('rejected', 'closed', 'expired') and new.status <> old.status then
    raise exception 'a closed break-glass window is never reopened: request another'
      using errcode = '55000';
  end if;
  if old.window_starts_at is not null and new.window_starts_at is distinct from old.window_starts_at then
    raise exception 'a break-glass window is never extended' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_break_glass_requests_immutable
before update or delete on support.break_glass_requests
for each row execute function support.prevent_break_glass_request_rewrite();

-- ---------------------------------------------------------------------------
-- The approvals
-- ---------------------------------------------------------------------------

create table support.break_glass_approvals (
  id uuid not null default extensions.uuid_generate_v7(),
  request_id uuid not null,
  approver_person_id uuid not null,
  approver_duty_assignment_id uuid not null,
  decision text not null,
  reason_code text not null,
  decided_at timestamptz not null default clock_timestamp(),
  constraint pk_break_glass_approvals primary key (id),
  -- One decision per approver per request: the quorum counts people, not clicks.
  constraint uq_break_glass_approvals_approver unique (request_id, approver_person_id),
  constraint fk_break_glass_approvals_request foreign key (request_id) references support.break_glass_requests (id) on delete restrict,
  constraint fk_break_glass_approvals_approver foreign key (approver_person_id) references identity.people (id) on delete restrict,
  constraint fk_break_glass_approvals_duty foreign key (approver_duty_assignment_id) references support.platform_duty_assignments (id) on delete restrict,
  constraint ck_break_glass_approvals_decision check (decision in ('approved', 'rejected')),
  constraint ck_break_glass_approvals_reason check (reason_code ~ '^[A-Z][A-Z0-9_-]{2,63}$')
);

create index idx_break_glass_approvals_quorum on support.break_glass_approvals (request_id, decision);
create index idx_break_glass_approvals_approver on support.break_glass_approvals (approver_person_id, decided_at desc);

alter table support.break_glass_approvals enable row level security;
alter table support.break_glass_approvals force row level security;

create policy break_glass_approvals_select_platform on support.break_glass_approvals
for select
using (access_control.actor_kind() = 'support');

create policy break_glass_approvals_insert_platform on support.break_glass_approvals
for insert
with check (access_control.actor_kind() = 'support');

comment on table support.break_glass_approvals is
  'Append-only decision of each approver. An approver is never the requester or the subject.';

-- The conflict rule the unique constraint cannot express: an approver may not be
-- the requester, the subject, or somebody who already decided.
create or replace function support.enforce_break_glass_approver_independence()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  file support.break_glass_requests%rowtype;
begin
  select * into file from support.break_glass_requests where id = new.request_id;

  if new.approver_person_id = file.requester_person_id then
    raise exception 'a break-glass request is never approved by the person who asked for it'
      using errcode = '42501';
  end if;
  if new.approver_person_id = file.subject_person_id then
    raise exception 'a break-glass request is never approved by its subject'
      using errcode = '42501';
  end if;
  return new;
end
$function$;

create trigger trg_break_glass_approvals_independent
before insert on support.break_glass_approvals
for each row execute function support.enforce_break_glass_approver_independence();

create or replace function support.reject_break_glass_approval_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a break-glass decision is append-only' using errcode = '55000';
end
$function$;

create trigger trg_break_glass_approvals_append_only
before update or delete on support.break_glass_approvals
for each row execute function support.reject_break_glass_approval_rewrite();

-- ---------------------------------------------------------------------------
-- The evidence
-- ---------------------------------------------------------------------------

create table support.break_glass_events (
  id uuid not null default extensions.uuid_generate_v7(),
  request_id uuid not null,
  requester_person_id uuid not null,
  requester_duty_assignment_id uuid not null,
  subject_person_id uuid not null,
  category text not null,
  result text not null,
  resource_type text not null,
  resource_id uuid,
  operation_code text not null,
  reason_code text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  access_event_id uuid not null,
  access_event_occurred_at timestamptz not null,
  constraint pk_break_glass_events primary key (id),
  -- The person's visible audit row and this one are the same event seen from two
  -- sides, so they are joined one to one and cannot drift apart in time.
  constraint uq_break_glass_events_access_event unique (access_event_id, access_event_occurred_at),
  constraint fk_break_glass_events_request foreign key (request_id, requester_person_id, subject_person_id, requester_duty_assignment_id) references support.break_glass_requests (id, requester_person_id, subject_person_id, requester_duty_assignment_id) on delete restrict,
  constraint fk_break_glass_events_duty foreign key (requester_duty_assignment_id) references support.platform_duty_assignments (id) on delete restrict,
  constraint ck_break_glass_events_result check (result in ('allowed', 'denied')),
  constraint ck_break_glass_events_operation check (operation_code ~ '^OP-[A-Z]+-[0-9]{3}$'),
  constraint ck_break_glass_events_reason check (reason_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_break_glass_events_resource check (resource_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  constraint ck_break_glass_events_mirror check (occurred_at = access_event_occurred_at)
);

create index idx_break_glass_events_request on support.break_glass_events (request_id, occurred_at);
create index idx_break_glass_events_requester on support.break_glass_events (requester_person_id, occurred_at desc);
create index idx_break_glass_events_subject on support.break_glass_events (subject_person_id, occurred_at desc);
create index idx_break_glass_events_result on support.break_glass_events (result, occurred_at desc);

alter table support.break_glass_events enable row level security;
alter table support.break_glass_events force row level security;

create policy break_glass_events_select_platform on support.break_glass_events
for select
using (access_control.actor_kind() = 'support');

create policy break_glass_events_insert_platform on support.break_glass_events
for insert
with check (access_control.actor_kind() = 'support');

comment on table support.break_glass_events is
  'Append-only proof of every attempt, allowed or denied. Mirrored in privacy.access_events.';

create or replace function support.reject_break_glass_event_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'break-glass evidence is append-only' using errcode = '55000';
end
$function$;

create trigger trg_break_glass_events_append_only
before update or delete on support.break_glass_events
for each row execute function support.reject_break_glass_event_rewrite();

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

-- The duty assignment identifier is returned, not just a boolean: the request
-- records which assignment authorised it, so a later revocation can be traced to
-- the windows it should close.
create or replace function support.require_break_glass_duty(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_duty_code text
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  assignment_id uuid;
begin
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
    or not access_control.has_platform_duty(p_actor_person_id, p_actor_session_id, p_duty_code) then
    raise exception 'this break-glass operation requires an effective duty'
      using errcode = '42501';
  end if;

  select assignment.id into assignment_id
  from support.platform_duty_assignments as assignment
  where assignment.person_id = p_actor_person_id
    and assignment.duty_code = p_duty_code
    and assignment.status = 'active'
    and clock_timestamp() >= assignment.valid_from
    and clock_timestamp() < assignment.valid_to
  order by assignment.valid_to desc
  limit 1;

  if assignment_id is null then
    raise exception 'this break-glass operation requires an effective duty'
      using errcode = '42501';
  end if;
  return assignment_id;
end
$function$;

-- One place decides whether a file is live, so the exercise, the closure and the
-- review cannot disagree about it. Expiry is evaluated by timestamp on every
-- call rather than by a job.
create or replace function support.effective_break_glass_status(
  p_status text,
  p_request_expires_at timestamptz,
  p_window_ends_at timestamptz
)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_status = 'requested' and clock_timestamp() >= p_request_expires_at then 'expired'
    when p_status = 'approved' and clock_timestamp() >= p_window_ends_at then 'expired'
    else p_status
  end
$function$;

create or replace function support.break_glass_request_projection(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', file.id,
    'requester_person_id', file.requester_person_id,
    'subject_person_id', file.subject_person_id,
    'categories', to_jsonb(file.categories),
    'purpose', file.purpose,
    'case_reference', file.case_reference,
    'sensitivity_tier', file.sensitivity_tier,
    'required_approvals', file.required_approvals,
    'requested_duration_minutes', file.requested_duration_minutes,
    'requested_at', file.requested_at,
    'request_expires_at', file.request_expires_at,
    'status', support.effective_break_glass_status(
      file.status, file.request_expires_at, file.window_ends_at
    ),
    'window_starts_at', file.window_starts_at,
    'window_ends_at', file.window_ends_at,
    'closed_at', file.closed_at,
    'reviewed_at', file.reviewed_at,
    'review_outcome', file.review_outcome,
    'approvals', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'approver_person_id', approval.approver_person_id,
            'decision', approval.decision,
            'reason_code', approval.reason_code,
            'decided_at', approval.decided_at
          )
          order by approval.decided_at
        )
        from support.break_glass_approvals as approval
        where approval.request_id = file.id
      ),
      '[]'::jsonb
    ),
    'exercise_count', (
      select count(*) from support.break_glass_events as event
      where event.request_id = file.id and event.result = 'allowed'
    )
  )
  from support.break_glass_requests as file
  where file.id = p_request_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-001 — request a window
-- ---------------------------------------------------------------------------

create or replace function support.request_break_glass(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_subject_person_id uuid,
  p_categories text[],
  p_purpose text,
  p_case_reference text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  duty_id uuid;
  tier support.break_glass_tier;
  request_id uuid;
  requested timestamptz := clock_timestamp();
  response jsonb;
begin
  duty_id := support.require_break_glass_duty(
    p_actor_person_id, p_actor_session_id, 'request_break_glass'
  );

  if p_actor_person_id = p_subject_person_id then
    raise exception 'a break-glass window is never opened over your own data'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from identity.people as person where person.id = p_subject_person_id
  ) then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;

  -- Raises for a forbidden category before anything is written, so the tier is
  -- computed and the refusal happens in the same step.
  tier := support.break_glass_scope_tier(p_categories);

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-SUP-001', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select support.break_glass_request_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent break-glass request not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  insert into support.break_glass_requests (
    requester_person_id, requester_duty_assignment_id, subject_person_id,
    categories, purpose, case_reference, sensitivity_tier, required_approvals,
    requested_duration_minutes, requested_at, request_expires_at
  ) values (
    p_actor_person_id, duty_id, p_subject_person_id,
    p_categories, p_purpose::support.break_glass_purpose, btrim(p_case_reference), tier,
    support.break_glass_required_approvals(tier),
    support.break_glass_duration_minutes(tier),
    requested, requested + interval '30 minutes'
  )
  returning id into request_id;

  perform system.enqueue_outbox_event(
    'break_glass_request', request_id, 'support.break_glass_requested.v1',
    jsonb_build_object(
      'request_id', request_id,
      'subject_person_id', p_subject_person_id,
      'sensitivity_tier', tier,
      'required_approvals', support.break_glass_required_approvals(tier)
    )
  );

  response := support.break_glass_request_projection(request_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'break-glass-requested',
    'break_glass_request', request_id
  );
  return query select response, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-002 — approve or reject
-- ---------------------------------------------------------------------------

create or replace function support.decide_break_glass(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason_code text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  duty_id uuid;
  file support.break_glass_requests%rowtype;
  approvals integer;
  opened timestamptz;
  response jsonb;
begin
  duty_id := support.require_break_glass_duty(
    p_actor_person_id, p_actor_session_id, 'approve_break_glass'
  );

  if p_decision not in ('approved', 'rejected') then
    raise exception 'a break-glass decision is an approval or a rejection'
      using errcode = '22023';
  end if;

  -- Serialised per request: two concurrent decisions cannot both complete the
  -- quorum, and cannot open two windows.
  select * into file
  from support.break_glass_requests
  where id = p_request_id
  for update;

  if file.id is null then
    raise exception 'break-glass request not found' using errcode = 'P0002';
  end if;
  if support.effective_break_glass_status(
    file.status, file.request_expires_at, file.window_ends_at
  ) <> 'requested' then
    raise exception 'only a pending break-glass request can be decided'
      using errcode = '55000';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-SUP-002', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select support.break_glass_request_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent break-glass decision not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  -- The independence trigger refuses the requester and the subject; the unique
  -- constraint refuses a second decision by the same approver.
  insert into support.break_glass_approvals (
    request_id, approver_person_id, approver_duty_assignment_id, decision, reason_code
  ) values (
    p_request_id, p_actor_person_id, duty_id, p_decision, btrim(p_reason_code)
  );

  if p_decision = 'rejected' then
    -- A rejection is terminal: no later approval can revive the request.
    update support.break_glass_requests set status = 'rejected' where id = p_request_id;
    perform system.enqueue_outbox_event(
      'break_glass_request', p_request_id, 'support.break_glass_decided.v1',
      jsonb_build_object('request_id', p_request_id, 'decision', 'rejected')
    );
  else
    select count(*) into approvals
    from support.break_glass_approvals as approval
    where approval.request_id = p_request_id and approval.decision = 'approved';

    perform system.enqueue_outbox_event(
      'break_glass_request', p_request_id, 'support.break_glass_decided.v1',
      jsonb_build_object('request_id', p_request_id, 'decision', 'approved')
    );

    -- The window opens only when the quorum is complete. A partial approval
    -- leaves the request exactly where it was.
    if approvals >= file.required_approvals then
      opened := clock_timestamp();
      update support.break_glass_requests
      set status = 'approved',
          window_starts_at = opened,
          window_ends_at = opened + make_interval(mins => file.requested_duration_minutes)
      where id = p_request_id;

      perform system.enqueue_outbox_event(
        'break_glass_request', p_request_id, 'support.break_glass_window_opened.v1',
        jsonb_build_object(
          'request_id', p_request_id,
          'window_starts_at', opened,
          'window_ends_at', opened + make_interval(mins => file.requested_duration_minutes)
        )
      );
    end if;
  end if;

  response := support.break_glass_request_projection(p_request_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'break-glass-decided',
    'break_glass_request', p_request_id
  );
  return query select response, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-003 — exercise the window
-- ---------------------------------------------------------------------------

-- Every authorisation condition is revalidated here, and both evidence rows are
-- written before anything is returned: if the audit write fails, the read does
-- not happen.
--
-- It returns rather than raises. An exception would roll back the evidence of the
-- very attempt it was refusing, which is the opposite of what this table exists
-- for. Only a lookup that finds no request raises, because then there is no file
-- to attach evidence to.
create or replace function support.exercise_break_glass(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_request_id uuid,
  p_category text,
  p_resource_type text,
  p_resource_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  duty_id uuid;
  file support.break_glass_requests%rowtype;
  approvals integer;
  denial text;
  event_id uuid;
  occurred timestamptz := clock_timestamp();
begin
  -- The only raise before the evidence is written: without a file there is
  -- nothing to attach an event to, so there is no evidence to lose.
  select * into file from support.break_glass_requests where id = p_request_id;
  if file.id is null then
    raise exception 'break-glass request not found' using errcode = 'P0002';
  end if;

  duty_id := file.requester_duty_assignment_id;

  select count(*) into approvals
  from support.break_glass_approvals as approval
  where approval.request_id = p_request_id and approval.decision = 'approved';

  -- Each refusal carries its own reason, because "denied" without one is useless
  -- to the review that comes later. Order matters: the most fundamental failure
  -- is named first, so an impostor is not told their category was out of scope.
  denial := case
    when file.requester_person_id <> p_actor_person_id then 'not_the_requester'
    when not access_control.has_platform_role(
      p_actor_person_id, p_actor_session_id, 'allfit_admin'
    ) or not access_control.has_platform_duty(
      p_actor_person_id, p_actor_session_id, 'request_break_glass'
    ) then 'duty_not_effective'
    when support.effective_break_glass_status(
      file.status, file.request_expires_at, file.window_ends_at
    ) <> 'approved' then 'window_not_open'
    when approvals < file.required_approvals then 'quorum_incomplete'
    when not (p_category = any (file.categories)) then 'category_out_of_scope'
    else null
  end;

  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, resource_id, purpose, result,
    request_id, access_mode, occurred_at
  ) values (
    p_actor_person_id, file.subject_person_id, p_resource_type, p_resource_id,
    file.purpose::text, case when denial is null then 'allowed' else 'denied' end,
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    'break_glass'::privacy.access_mode, occurred
  )
  returning id into event_id;

  insert into support.break_glass_events (
    request_id, requester_person_id, requester_duty_assignment_id, subject_person_id,
    category, result, resource_type, resource_id, operation_code, reason_code,
    occurred_at, access_event_id, access_event_occurred_at
  ) values (
    p_request_id, file.requester_person_id, file.requester_duty_assignment_id,
    file.subject_person_id, p_category,
    case when denial is null then 'allowed' else 'denied' end,
    p_resource_type, p_resource_id, 'OP-SUP-003',
    coalesce(denial, 'authorized_exercise'), occurred, event_id, occurred
  );

  -- Returned, never raised: the evidence above has to survive the refusal.
  if denial is not null then
    return jsonb_build_object(
      'outcome', 'denied',
      'reason_code', denial,
      'break_glass_event_id', event_id,
      'occurred_at', occurred
    );
  end if;

  -- Authorised, and honest about the content: `execution` and `nutrition` do not
  -- exist, so there is nothing to project. The evidence of the authorised
  -- exercise stands on its own.
  return jsonb_build_object(
    'outcome', 'content_unavailable',
    'reason_code', 'execution_and_nutrition_absent',
    'break_glass_event_id', event_id,
    'occurred_at', occurred,
    'category', p_category
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-004 — close my window
-- ---------------------------------------------------------------------------

create or replace function support.close_break_glass(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  file support.break_glass_requests%rowtype;
  response jsonb;
begin
  perform support.require_break_glass_duty(
    p_actor_person_id, p_actor_session_id, 'request_break_glass'
  );

  select * into file from support.break_glass_requests where id = p_request_id for update;
  if file.id is null then
    raise exception 'break-glass request not found' using errcode = 'P0002';
  end if;
  if file.requester_person_id <> p_actor_person_id then
    raise exception 'only the requester closes their own break-glass window'
      using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-SUP-004', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select support.break_glass_request_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent break-glass closure not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  -- Closing an already closed window converges rather than failing: the operator
  -- asked for a state the system is already in.
  if file.status = 'approved' then
    update support.break_glass_requests
    set status = 'closed', closed_at = clock_timestamp()
    where id = p_request_id;

    perform system.enqueue_outbox_event(
      'break_glass_request', p_request_id, 'support.break_glass_closed.v1',
      jsonb_build_object('request_id', p_request_id)
    );
  elsif file.status <> 'closed' then
    raise exception 'only an approved break-glass window can be closed'
      using errcode = '55000';
  end if;

  response := support.break_glass_request_projection(p_request_id);
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'break-glass-closed',
    'break_glass_request', p_request_id
  );
  return query select response, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- The debt AFO-241 left behind
-- ---------------------------------------------------------------------------

-- `support.close_platform_duty` documented that withdrawing `request_break_glass`
-- must close that person's open windows, and could not do it because this table
-- did not exist. It does now.
create or replace function support.close_break_glass_for_withdrawn_duty(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update support.break_glass_requests
  set status = 'closed', closed_at = clock_timestamp()
  where requester_person_id = p_person_id
    and status = 'approved';

  -- A pending request from somebody who just lost the duty cannot become a
  -- window either.
  update support.break_glass_requests
  set status = 'expired'
  where requester_person_id = p_person_id
    and status = 'requested';
end
$function$;

-- ---------------------------------------------------------------------------
-- Queries
-- ---------------------------------------------------------------------------

create or replace function support.list_break_glass_requests(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_mine boolean,
  p_status text,
  p_limit integer
)
returns table (result jsonb)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  -- Either duty reads the tray: the requester needs their own, an approver needs
  -- what is pending. Neither read grants anything.
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
    or not (
      access_control.has_platform_duty(p_actor_person_id, p_actor_session_id, 'request_break_glass')
      or access_control.has_platform_duty(p_actor_person_id, p_actor_session_id, 'approve_break_glass')
      or access_control.has_platform_duty(p_actor_person_id, p_actor_session_id, 'audit_break_glass')
    ) then
    raise exception 'reading the break-glass tray requires an effective duty'
      using errcode = '42501';
  end if;

  return query
  select support.break_glass_request_projection(file.id)
  from support.break_glass_requests as file
  where (not p_mine or file.requester_person_id = p_actor_person_id)
    and (
      p_status is null
      or support.effective_break_glass_status(
        file.status, file.request_expires_at, file.window_ends_at
      ) = p_status
    )
  order by file.requested_at desc
  limit greatest(p_limit, 1);
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter table support.break_glass_requests owner to allfit_owner;
alter table support.break_glass_approvals owner to allfit_owner;
alter table support.break_glass_events owner to allfit_owner;
alter function support.break_glass_category_tier(text) owner to allfit_owner;
alter function support.break_glass_scope_tier(text[]) owner to allfit_owner;
alter function support.break_glass_required_approvals(support.break_glass_tier) owner to allfit_owner;
alter function support.break_glass_duration_minutes(support.break_glass_tier) owner to allfit_owner;
alter function support.enforce_break_glass_scope() owner to allfit_owner;
alter function support.prevent_break_glass_request_rewrite() owner to allfit_owner;
alter function support.enforce_break_glass_approver_independence() owner to allfit_owner;
alter function support.reject_break_glass_approval_rewrite() owner to allfit_owner;
alter function support.reject_break_glass_event_rewrite() owner to allfit_owner;
alter function support.require_break_glass_duty(uuid, uuid, text) owner to allfit_owner;
alter function support.effective_break_glass_status(text, timestamptz, timestamptz) owner to allfit_owner;
alter function support.break_glass_request_projection(uuid) owner to allfit_owner;
alter function support.request_break_glass(uuid, uuid, uuid, text[], text, text, uuid, uuid, bytea) owner to allfit_owner;
alter function support.decide_break_glass(uuid, uuid, uuid, text, text, uuid, uuid, bytea) owner to allfit_owner;
alter function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid) owner to allfit_owner;
alter function support.close_break_glass(uuid, uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
alter function support.close_break_glass_for_withdrawn_duty(uuid) owner to allfit_owner;
alter function support.list_break_glass_requests(uuid, uuid, boolean, text, integer) owner to allfit_owner;

revoke all on table support.break_glass_requests from public;
revoke all on table support.break_glass_approvals from public;
revoke all on table support.break_glass_events from public;
revoke all on function support.require_break_glass_duty(uuid, uuid, text) from public;
revoke all on function support.break_glass_request_projection(uuid) from public;
revoke all on function support.request_break_glass(uuid, uuid, uuid, text[], text, text, uuid, uuid, bytea) from public;
revoke all on function support.decide_break_glass(uuid, uuid, uuid, text, text, uuid, uuid, bytea) from public;
revoke all on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid) from public;
revoke all on function support.close_break_glass(uuid, uuid, uuid, uuid, uuid, bytea) from public;
revoke all on function support.close_break_glass_for_withdrawn_duty(uuid) from public;
revoke all on function support.list_break_glass_requests(uuid, uuid, boolean, text, integer) from public;

-- The runtime role executes the four operations and the tray. It never reaches
-- the tables, the authority guard, or the cascade that closes a withdrawn duty's
-- windows — that one belongs to the duty command, not to a request.
grant execute on function support.request_break_glass(uuid, uuid, uuid, text[], text, text, uuid, uuid, bytea) to allfit_api;
grant execute on function support.decide_break_glass(uuid, uuid, uuid, text, text, uuid, uuid, bytea) to allfit_api;
grant execute on function support.exercise_break_glass(uuid, uuid, uuid, text, text, uuid) to allfit_api;
grant execute on function support.close_break_glass(uuid, uuid, uuid, uuid, uuid, bytea) to allfit_api;
grant execute on function support.list_break_glass_requests(uuid, uuid, boolean, text, integer) to allfit_api;
