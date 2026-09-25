-- Suspending a disposition — `OP-PRV-009`, `OP-PRV-010`, `HU-BO-033`.
--
-- A legal hold is the only thing in this system that stops a person's erasure from
-- running. Everything here is a limit on that power.
--
-- **No indefinite holds.** `valid_to` is not nullable and has to be in the future.
-- A hold that lapses is still a hold somebody has to release: nothing resumes a
-- disposition on a date by itself, because "the calendar decided" is not an answer
-- anybody can be held to.
--
-- **A hold suspends; it does not reveal.** Applying one returns the hold and never
-- the data it protects, reads nothing, and writes no access record — there is
-- nothing to record, because nothing was read. Seeing that person's file still
-- needs a break-glass window.
--
-- The separation refusal answers `AF403` and not a plain `42501`. Both are 403 to
-- the client, but "you are not allowed" and "you specifically, because you asked to
-- read this person's file" are different facts, and the screen has to say the second
-- one in those words.
--
-- **Whoever asked to look cannot decide to keep.** An officer who requested or
-- approved a break-glass window over a person is refused a hold over that person's
-- dispositions. Concentrating "let me see it" and "nobody may delete it" in one
-- pair of hands is the failure this rule exists to prevent. It is deliberately
-- coarse — per person, not per case — because a hold is rare and the cost of being
-- strict is asking a colleague.
--
-- **Releasing puts the item back to `pending` and nowhere else.** It does not
-- execute what it was holding: deciding to delete somebody's data is not the
-- reviewer's call to make on their behalf.
--
-- Two deliberate deviations from the data dictionary's sketch (7.15, 7.16):
--
-- `created_by text` became `applied_by_person_id uuid`, resolved from the session
-- and never accepted from the request. A name typed by hand is unverifiable and is
-- itself personal data; an identifier is neither.
--
-- `reason text` became `reason_code` over a closed list, because `HU-BO-033`
-- criterion 5 asks for a closed reason. Free text would make the ground for a hold
-- unqueryable and unauditable, which is the opposite of what it is for.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- The hold
-- ---------------------------------------------------------------------------

create table privacy.legal_holds (
  id uuid not null default extensions.uuid_generate_v7(),
  scope_description text not null,
  reason_code text not null,
  case_reference text not null,
  valid_from timestamptz not null default clock_timestamp(),
  valid_to timestamptz not null,
  status text not null default 'active',
  applied_by_person_id uuid not null,
  released_at timestamptz,
  released_by_person_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_legal_holds primary key (id),
  constraint fk_legal_holds_applied_by foreign key (applied_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_legal_holds_released_by foreign key (released_by_person_id) references identity.people(id) on delete restrict,
  constraint ck_legal_holds_status check (status in ('active', 'released')),
  constraint ck_legal_holds_scope check (btrim(scope_description) <> ''),
  constraint ck_legal_holds_case_reference check (btrim(case_reference) <> ''),
  constraint ck_legal_holds_reason check (
    reason_code in (
      'judicial_order', 'regulatory_request', 'service_dispute', 'tax_or_accounting_obligation'
    )
  ),
  -- There is no hold without an end, and none that ends before it begins.
  constraint ck_legal_holds_vigency check (valid_to > valid_from),
  constraint ck_legal_holds_released check ((status = 'released') = (released_at is not null)),
  constraint ck_legal_holds_released_by check ((released_at is null) = (released_by_person_id is null))
);

create index idx_legal_holds_status_valid_to on privacy.legal_holds (status, valid_to);

alter table privacy.legal_holds enable row level security;
alter table privacy.legal_holds force row level security;

create policy legal_holds_all_owner on privacy.legal_holds
  for all to allfit_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Which dispositions it stops
-- ---------------------------------------------------------------------------

create table privacy.hold_applications (
  id uuid not null default extensions.uuid_generate_v7(),
  legal_hold_id uuid not null,
  disposition_item_id uuid not null,
  status text not null default 'active',
  applied_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  constraint pk_hold_applications primary key (id),
  constraint fk_hold_applications_hold foreign key (legal_hold_id) references privacy.legal_holds(id) on delete restrict,
  constraint fk_hold_applications_item foreign key (disposition_item_id) references privacy.disposition_items(id) on delete restrict,
  constraint ck_hold_applications_status check (status in ('active', 'released')),
  constraint ck_hold_applications_released check ((status = 'released') = (released_at is not null))
);

-- One disposition is held by one hold: a second one would make "release" ambiguous.
create unique index uidx_hold_applications_active
  on privacy.hold_applications (disposition_item_id) where status = 'active';
create index idx_hold_applications_hold on privacy.hold_applications (legal_hold_id, status);

alter table privacy.hold_applications enable row level security;
alter table privacy.hold_applications force row level security;

create policy hold_applications_all_owner on privacy.hold_applications
  for all to allfit_owner using (true) with check (true);

-- Neither table is ever rewritten or deleted: a hold is evidence.
create or replace function privacy.hold_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a legal hold is never deleted' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_legal_holds_guard
before delete on privacy.legal_holds
for each row execute function privacy.hold_guard_tg();

create trigger trg_hold_applications_guard
before delete on privacy.hold_applications
for each row execute function privacy.hold_guard_tg();

-- ---------------------------------------------------------------------------
-- Separation of duties, per person
-- ---------------------------------------------------------------------------

-- True when this officer asked for, or approved, an exceptional read of this
-- person's data. Whoever wanted to look does not get to decide what is kept.
create or replace function privacy.asked_to_read_this_person(
  p_actor_person_id uuid,
  p_subject_person_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from support.break_glass_requests as file
    where file.subject_person_id = p_subject_person_id
      and (
        file.requester_person_id = p_actor_person_id
        or exists (
          select 1
          from support.break_glass_approvals as approval
          where approval.request_id = file.id
            and approval.approver_person_id = p_actor_person_id
        )
      )
  )
$function$;

-- ---------------------------------------------------------------------------
-- The projection an officer gets back
-- ---------------------------------------------------------------------------

create or replace function privacy.legal_hold_projection(p_hold_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', hold.id,
    'scope_description', hold.scope_description,
    'reason_code', hold.reason_code,
    'case_reference', hold.case_reference,
    'valid_from', hold.valid_from,
    'valid_to', hold.valid_to,
    'status', hold.status,
    'applied_by_person_id', hold.applied_by_person_id,
    'released_at', hold.released_at,
    'released_by_person_id', hold.released_by_person_id,
    'suspended_items', (
      select count(*)::int from privacy.hold_applications as application
      where application.legal_hold_id = hold.id and application.status = 'active'
    ),
    'items', (
      select count(*)::int from privacy.hold_applications as application
      where application.legal_hold_id = hold.id
    )
  )
  from privacy.legal_holds as hold
  where hold.id = p_hold_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-PRV-009 — apply
-- ---------------------------------------------------------------------------

create or replace function privacy.apply_legal_hold(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_scope_description text,
  p_reason_code text,
  p_case_reference text,
  p_valid_to timestamptz,
  p_disposition_item_ids uuid[],
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
  response jsonb;
  hold_id uuid;
  targeted integer;
  subject uuid;
begin
  perform privacy.require_privacy_request_manager(p_actor_person_id, p_actor_session_id);

  if p_disposition_item_ids is null or cardinality(p_disposition_item_ids) = 0 then
    raise exception 'a legal hold names the dispositions it stops' using errcode = '22023';
  end if;
  if cardinality(p_disposition_item_ids) > 500 then
    raise exception 'a legal hold covers at most 500 dispositions' using errcode = '22023';
  end if;

  -- Whose data this is, and whether the officer already asked to look at it. The
  -- check runs before the hold exists, so a refusal leaves nothing behind.
  for subject in
    select distinct item.subject_person_id
    from privacy.disposition_items as item
    where item.id = any(p_disposition_item_ids)
  loop
    if privacy.asked_to_read_this_person(p_actor_person_id, subject) then
      raise exception 'whoever requested an exceptional read of this person cannot hold their data'
        using errcode = 'AF403';
    end if;
  end loop;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-PRV-009', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select privacy.legal_hold_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent legal hold not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  select count(*)::int into targeted
  from privacy.disposition_items as item
  where item.id = any(p_disposition_item_ids);
  if targeted <> cardinality(p_disposition_item_ids) then
    raise exception 'a disposition named by this hold does not exist' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from privacy.disposition_items as item
    where item.id = any(p_disposition_item_ids) and item.status = 'executed'
  ) then
    raise exception 'what has already been disposed of cannot be held' using errcode = '55000';
  end if;

  insert into privacy.legal_holds (
    scope_description, reason_code, case_reference, valid_to, applied_by_person_id
  ) values (
    p_scope_description, p_reason_code, p_case_reference, p_valid_to, p_actor_person_id
  )
  returning id into hold_id;

  insert into privacy.hold_applications (legal_hold_id, disposition_item_id)
  select hold_id, item.id
  from privacy.disposition_items as item
  where item.id = any(p_disposition_item_ids);

  update privacy.disposition_items as item
  set status = 'suspended'
  where item.id = any(p_disposition_item_ids) and item.status = 'pending';

  -- Identifiers of the hold, never of whose data it protects.
  perform system.enqueue_outbox_event(
    'legal_hold', hold_id, 'privacy.legal_hold_applied.v1',
    jsonb_build_object('legal_hold_id', hold_id, 'reason_code', p_reason_code)
  );

  select privacy.legal_hold_projection(hold_id) into response;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'legal-hold-applied', 'legal_hold', hold_id
  );

  return query select response, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PRV-010 — release
-- ---------------------------------------------------------------------------

create or replace function privacy.release_legal_hold(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_hold_id uuid,
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
  response jsonb;
  hold record;
  subject uuid;
begin
  perform privacy.require_privacy_request_manager(p_actor_person_id, p_actor_session_id);

  select * into hold from privacy.legal_holds as candidate where candidate.id = p_hold_id;
  if hold.id is null then
    raise exception 'legal hold not found' using errcode = 'P0002';
  end if;

  for subject in
    select distinct item.subject_person_id
    from privacy.hold_applications as application
    join privacy.disposition_items as item on item.id = application.disposition_item_id
    where application.legal_hold_id = p_hold_id
  loop
    if privacy.asked_to_read_this_person(p_actor_person_id, subject) then
      raise exception 'whoever requested an exceptional read of this person cannot release their hold'
        using errcode = 'AF403';
    end if;
  end loop;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-PRV-010', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    select privacy.legal_hold_projection(receipt.aggregate_id) into response;
    if response is null then
      raise exception 'idempotent legal hold release not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  if hold.status <> 'active' then
    raise exception 'this hold was already released' using errcode = '55000';
  end if;

  -- Back to waiting its turn, and no further: releasing never executes.
  update privacy.disposition_items as item
  set status = 'pending'
  from privacy.hold_applications as application
  where application.legal_hold_id = p_hold_id
    and application.status = 'active'
    and item.id = application.disposition_item_id
    and item.status = 'suspended';

  update privacy.hold_applications as application
  set status = 'released', released_at = clock_timestamp()
  where application.legal_hold_id = p_hold_id and application.status = 'active';

  update privacy.legal_holds as candidate
  set status = 'released',
      released_at = clock_timestamp(),
      released_by_person_id = p_actor_person_id
  where candidate.id = p_hold_id;

  perform system.enqueue_outbox_event(
    'legal_hold', p_hold_id, 'privacy.legal_hold_released.v1',
    jsonb_build_object('legal_hold_id', p_hold_id)
  );

  select privacy.legal_hold_projection(p_hold_id) into response;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'legal-hold-released', 'legal_hold', p_hold_id
  );

  return query select response, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- What the erasure panel now has to show
-- ---------------------------------------------------------------------------

-- Two things the panel could not answer before holds existed: which dispositions a
-- category is made of — so an officer can hold exactly those and nothing else — and,
-- where one is held, under what reason and until when.
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
        'item_ids', grouped.item_ids,
        'result', grouped.result,
        'executed_at', grouped.executed_at,
        'retained_until', grouped.retained_until,
        'hold', grouped.hold
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
      jsonb_agg(item.id order by item.id) as item_ids,
      max(item.executed_at) as executed_at,
      max(
        case
          when item.action = 'retain_restricted' and item.executed_at is not null
            then item.executed_at + policy.retention_period
        end
      ) as retained_until,
      (array_remove(array_agg(latest.result order by latest.executed_at desc), null))[1]
        as result,
      (
        array_remove(
          array_agg(
            case
              when held.id is not null then jsonb_build_object(
                'id', held.id,
                'reason_code', held.reason_code,
                'valid_to', held.valid_to
              )
            end
          ),
          null
        )
      )[1] as hold
    from privacy.disposition_items as item
    join privacy.retention_policies as policy on policy.id = item.retention_policy_id
    left join lateral (
      select event.result, event.executed_at
      from privacy.disposition_events as event
      where event.disposition_item_id = item.id
      order by event.executed_at desc
      limit 1
    ) as latest on true
    left join lateral (
      select hold.id, hold.reason_code, hold.valid_to
      from privacy.hold_applications as application
      join privacy.legal_holds as hold on hold.id = application.legal_hold_id
      where application.disposition_item_id = item.id and application.status = 'active'
      limit 1
    ) as held on true
    where item.disposition_case_id = p_case_id
    group by item.data_classification_code, item.action, item.status
  ) as grouped
$function$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function privacy.asked_to_read_this_person(uuid, uuid) from public;
revoke all on function privacy.legal_hold_projection(uuid) from public;
revoke all on function privacy.apply_legal_hold(
  uuid, uuid, text, text, text, timestamptz, uuid[], uuid, uuid, bytea
) from public;
revoke all on function privacy.release_legal_hold(uuid, uuid, uuid, uuid, uuid, bytea) from public;

-- The runtime role runs the two commands and reaches neither table, so a hold can
-- only be applied or released through the rules above.
grant execute on function privacy.apply_legal_hold(
  uuid, uuid, text, text, text, timestamptz, uuid[], uuid, uuid, bytea
) to allfit_api;
grant execute on function privacy.release_legal_hold(
  uuid, uuid, uuid, uuid, uuid, bytea
) to allfit_api;
