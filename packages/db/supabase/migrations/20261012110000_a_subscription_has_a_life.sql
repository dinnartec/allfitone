-- The life of a subscription — `OP-PAY-007..015`, and `IX-40`.
--
-- Eight closed functions and one table. The table is the reason the functions can exist:
-- `planning.service_access_blocks` is how a payment problem makes training ineffective
-- **without touching anything that granted it**.
--
-- That is the whole design decision, and it is worth saying plainly. The obvious way to
-- suspend somebody for not paying is to revoke their grants, unassign their coach and
-- cancel their sessions, then put it all back when they pay. It cannot be put back. A
-- revoked grant needs the person's consent again. A terminated relationship is a new
-- relationship with a new history. A cancelled session is gone. So suspension never
-- mutates any of that: it writes **a cause**, and every projection derives from the open
-- causes. Reactivating removes one cause and recalculates from whatever is true now — it
-- does not restore a snapshot, because there is no snapshot to restore.
--
-- The consequences, each of which is a test:
--
-- * Suspending writes exactly one row in `service_access_blocks` and changes one column
--   in `plan_subscriptions`. Grants, relationship, assignment and sessions are untouched.
-- * Reactivating closes **only** the block of that subscription. Another open cause —
--   the organization being suspended, say — keeps denying.
-- * A cause is closed once. A closed row never reopens and never changes source.
--
-- **Ending is a one-way door, and it closes its own cause.** The dictionary does not say
-- so, and it has to be this way: reactivation requires a subscription that is not ended,
-- so a block left open by a terminated subscription could never be closed by anything.
-- The person would be blocked forever by a bond that no longer exists. Denying service to
-- somebody who stopped paying is the relationship's business — `OP-REL-008` — not an
-- orphaned row's.
--
-- **The gateway worker is not here.** `OP-PAY-016` records what a provider reports and
-- needs `payment_records`, which is the next slice. Until then suspension is manual only,
-- which is also why no function in this file takes a `worker` actor.
--
-- **Nothing is delivered yet.** The four domain events are enqueued with the contact and
-- the names already resolved — the same shape the substitution notice uses, so a worker
-- can send them without widening a single row policy. The worker and the templates arrive
-- next; until they do, `apps/worker/src/delivery-coverage.test.ts` does not list these
-- kinds, and its docblock explains exactly why that is the dangerous state to leave them
-- in. They are not left in it for long.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- The cause — `planning` 9.17
-- ---------------------------------------------------------------------------

create table planning.service_access_blocks (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  organization_id uuid not null,
  relationship_id uuid,
  subscription_id uuid,
  organization_event_id uuid,
  source_kind text not null,
  blocks_future_sessions boolean not null,
  blocks_professional_contribution boolean not null,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  created_by_kind identity.actor_kind not null,
  created_by_membership_id uuid,
  constraint pk_service_access_blocks primary key (id),
  constraint fk_service_access_blocks_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_service_access_blocks_relationship foreign key (relationship_id, person_id, organization_id) references relationships.service_relationships(id, person_id, organization_id) on delete restrict,
  constraint fk_service_access_blocks_subscription foreign key (subscription_id, person_id, organization_id) references payments.plan_subscriptions(id, person_id, organization_id) on delete restrict,
  constraint fk_service_access_blocks_organization_event foreign key (organization_event_id) references organizations.organization_events(id) on delete restrict,
  constraint fk_service_access_blocks_created_by foreign key (created_by_membership_id, organization_id) references organizations.organization_memberships(id, organization_id) on delete restrict,
  -- Exactly one source, and the kind says which. Two columns and a loose label would let
  -- a row claim to be a payment suspension while pointing at an organization event.
  constraint ck_service_access_blocks_single_source check (
    num_nonnulls(subscription_id, organization_event_id) = 1
  ),
  constraint ck_service_access_blocks_source_kind check (
    (source_kind = 'subscription_suspension' and subscription_id is not null)
    or (source_kind = 'organization_suspension' and organization_event_id is not null)
  ),
  -- A block that blocks nothing is a row that only looks like a reason.
  constraint ck_service_access_blocks_effect check (
    blocks_future_sessions or blocks_professional_contribution
  ),
  constraint ck_service_access_blocks_ended_at check (
    ended_at is null or ended_at >= started_at
  )
);

-- One open cause per source. This is what makes opening idempotent and closing
-- unambiguous: there is never a second row to wonder about.
create unique index uidx_service_access_blocks_open_subscription
  on planning.service_access_blocks (subscription_id)
  where ended_at is null and subscription_id is not null;

create unique index uidx_service_access_blocks_open_event
  on planning.service_access_blocks (organization_event_id, person_id)
  where ended_at is null and organization_event_id is not null;

create index idx_service_access_blocks_person_ended
  on planning.service_access_blocks (person_id, ended_at);
create index idx_service_access_blocks_organization_ended
  on planning.service_access_blocks (organization_id, ended_at);
create index idx_service_access_blocks_relationship_ended
  on planning.service_access_blocks (relationship_id, ended_at);

/*
 * The organization branch has no composite key to follow, because
 * `organizations.organization_events` carries no `unique (id, organization_id)` and adding
 * one is a change to another domain's table. So the tenant match is checked here instead,
 * which is what the dictionary specifies.
 *
 * `organization.suspended.v1` does not exist yet: `NEW-ORG-SUSPEND` is the operation that
 * will emit it. Until then this branch accepts nothing at all, which is the correct state
 * — there is no legitimate organization suspension to record — and the day that operation
 * ships, the name below is the one it has to use.
 */
create or replace function planning.enforce_service_access_block_source()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  source_event record;
begin
  if new.organization_event_id is null then
    return null;
  end if;

  select event.organization_id, event.event_type
    into source_event
  from organizations.organization_events as event
  where event.id = new.organization_event_id;

  if source_event.organization_id is distinct from new.organization_id then
    raise exception 'a service access block and its organization event share one organization'
      using errcode = '23514';
  end if;

  if source_event.event_type <> 'organization.suspended.v1' then
    raise exception 'only an organization suspension blocks service access'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create constraint trigger trg_service_access_blocks_after_source_invariant
after insert or update on planning.service_access_blocks
deferrable initially deferred
for each row execute function planning.enforce_service_access_block_source();

create or replace function planning.service_access_block_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a service access block is the evidence of a blocked period and is never deleted'
      using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.person_id is distinct from old.person_id
     or new.organization_id is distinct from old.organization_id
     or new.relationship_id is distinct from old.relationship_id
     or new.subscription_id is distinct from old.subscription_id
     or new.organization_event_id is distinct from old.organization_event_id
     or new.source_kind is distinct from old.source_kind
     or new.started_at is distinct from old.started_at
     or new.created_by_kind is distinct from old.created_by_kind
     or new.created_by_membership_id is distinct from old.created_by_membership_id then
    raise exception 'a service access block keeps its cause; a new cause is a new row'
      using errcode = '55000';
  end if;
  -- Closing is the only change, and it happens once. A reopened row would make the
  -- blocked period unknowable after the fact.
  if old.ended_at is not null then
    raise exception 'a closed service access block does not reopen' using errcode = '55000';
  end if;
  -- What it blocks is part of the cause. Narrowing it mid-flight would move the effect
  -- without leaving a trace of when it moved.
  if new.blocks_future_sessions is distinct from old.blocks_future_sessions
     or new.blocks_professional_contribution is distinct from old.blocks_professional_contribution then
    raise exception 'a service access block keeps its effect' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_service_access_blocks_guard
before update or delete on planning.service_access_blocks
for each row execute function planning.service_access_block_guard_tg();

alter table planning.service_access_blocks enable row level security;
alter table planning.service_access_blocks force row level security;

/*
 * The person sees why she is blocked, and the billing administration of her gym sees the
 * blocks it caused. A coach reads none of it: the commercial cause of a pause is not a
 * training fact, which is the same line drawn in `plan_subscriptions`.
 *
 * What a coach needs is the *effect*, not the cause, and that is a separate problem: the
 * aggregate `access_control.has_service_block` that `PR-29` describes cannot be written
 * under this policy, because `allfit_owner` does not bypass row-level security and so a
 * coach's call would come back empty rather than true. It arrives with the first
 * projection that consumes it, which is also when there is a real case to decide it
 * against. Nothing derives from these rows yet, so nothing silently returns the wrong
 * answer in the meantime.
 */
create policy service_access_blocks_select_actor
  on planning.service_access_blocks
  for select to allfit_owner
  using (
    person_id = access_control.person()
    or (
      organization_id = access_control.org()
      and access_control.has_capability(organization_id, 'manage_billing')
    )
  );

create policy service_access_blocks_insert_owner
  on planning.service_access_blocks
  for insert to allfit_owner
  with check (access_control.actor_kind() is not null);

create policy service_access_blocks_update_owner
  on planning.service_access_blocks
  for update to allfit_owner
  using (access_control.actor_kind() is not null)
  with check (access_control.actor_kind() is not null);

-- ---------------------------------------------------------------------------
-- Telling the person
-- ---------------------------------------------------------------------------

/*
 * One payload shape for all four transitions, with the contact and the names resolved
 * here rather than at delivery time.
 *
 * That is not convenience. A worker that looked these up itself would need to read a
 * subscription, a person and an organization, and the policies on all three are written
 * to keep it out. Resolving inside the transaction that caused the event is what lets the
 * row policies stay as narrow as they are — the same reason the substitution notice
 * carries its names.
 *
 * `contact` can be null: a person with no contact is still suspended, because the gym's
 * decision does not depend on being able to tell her. The worker completes such an event
 * without sending anything, and the technical panel shows it for what it is.
 *
 * The status is deliberately absent. A payload that says `active` for an event named
 * `ended` is the kind of thing that gets read once and believed.
 */
create or replace function payments.enqueue_subscription_notice(
  p_subscription_id uuid,
  p_event_type text
)
returns void
language plpgsql
set search_path = pg_catalog
as $function$
declare
  notice record;
begin
  select subscription.person_id,
         subscription.organization_id,
         subscription.plan_version_id,
         person.display_name,
         person.contact_email,
         organization.display_name as organization_name,
         plan.name as plan_name,
         version.amount_minor,
         version.currency_code,
         version.billing_period
    into notice
  from payments.plan_subscriptions as subscription
  join identity.people as person
    on person.id = subscription.person_id
  join organizations.organizations as organization
    on organization.id = subscription.organization_id
  join payments.plan_versions as version
    on version.id = subscription.plan_version_id
  join payments.organization_plans as plan
    on plan.id = version.plan_id
  where subscription.id = p_subscription_id;

  if notice.person_id is null then
    raise exception 'cannot announce a subscription that cannot be read' using errcode = '42501';
  end if;

  perform system.enqueue_outbox_event(
    'plan_subscription',
    p_subscription_id,
    p_event_type,
    jsonb_build_object(
      'subscription_id', p_subscription_id,
      'person_id', notice.person_id,
      'organization_id', notice.organization_id,
      'plan_version_id', notice.plan_version_id,
      'contact', notice.contact_email,
      'person_name', notice.display_name,
      'organization_name', notice.organization_name,
      'plan_name', notice.plan_name,
      'amount_minor', notice.amount_minor,
      'currency_code', notice.currency_code,
      'billing_period', notice.billing_period
    )
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- What the gym offers — `OP-PAY-011`
-- ---------------------------------------------------------------------------

/*
 * The published versions of a gym's plans, cheapest first.
 *
 * Which plans are visible is the row policy's decision and not this function's: a client
 * sees published plans, the team sees drafts too. What this adds is the version filter,
 * because a retired version is still readable — somebody is paying it — and must not be
 * offered to somebody who is not.
 */
create or replace function payments.list_organization_plans(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_limit integer,
  p_cursor_amount_minor bigint,
  p_cursor_version_id uuid
)
returns table (
  plan_id uuid,
  plan_version_id uuid,
  plan_name text,
  version_number integer,
  amount_minor bigint,
  currency_code text,
  billing_period text,
  published_at timestamptz
)
language plpgsql
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

  if (p_cursor_amount_minor is null) <> (p_cursor_version_id is null) then
    raise exception 'invalid plan cursor' using errcode = '22023';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  return query
  select plan.id,
         version.id,
         plan.name,
         version.version_number,
         version.amount_minor,
         version.currency_code,
         version.billing_period,
         version.published_at
  from payments.plan_versions as version
  join payments.organization_plans as plan
    on plan.id = version.plan_id
   and plan.organization_id = version.organization_id
  where version.organization_id = p_organization_id
    and version.status = 'published'
    and version.deprecated_at is null
    and (
      p_cursor_amount_minor is null
      or (version.amount_minor, version.id) > (p_cursor_amount_minor, p_cursor_version_id)
    )
  order by version.amount_minor, version.id
  limit p_limit;
end
$function$;

-- ---------------------------------------------------------------------------
-- Subscribing — `OP-PAY-012`
-- ---------------------------------------------------------------------------

/*
 * Four preconditions, and each one is a different refusal the person can act on:
 * the version must be on offer, she must be a client of that gym, the gym must have
 * somewhere to be paid, and she must not already owe it.
 *
 * It returns what the price is, not where to pay it. The checkout is created server-side
 * with the gym's credential, which this function cannot read and does not need to: a card
 * number never touches Allfit, and neither does the account it goes to.
 */
create or replace function payments.subscribe_to_plan(
  p_actor_person_id uuid,
  p_plan_version_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  subscription_id uuid,
  organization_id uuid,
  plan_version_id uuid,
  plan_name text,
  amount_minor bigint,
  currency_code text,
  billing_period text,
  provider text,
  started boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  offer record;
  notice record;
  new_subscription_id uuid;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  select version.id,
         version.organization_id,
         version.amount_minor,
         version.currency_code,
         version.billing_period,
         plan.name as plan_name
    into offer
  from payments.plan_versions as version
  join payments.organization_plans as plan
    on plan.id = version.plan_id
   and plan.organization_id = version.organization_id
  where version.id = p_plan_version_id
    and version.status = 'published'
    and version.deprecated_at is null;

  -- A version she cannot see and a version that is not on offer answer the same way. She
  -- is not entitled to learn which of the two it was.
  if offer.id is null then
    raise exception 'plan version not found' using errcode = 'P0002';
  end if;

  if not access_control.has_active_relationship(offer.organization_id) then
    raise exception 'plan version not found' using errcode = 'P0002';
  end if;

  /*
   * Fails closed, and loudly. Without a gateway there is nowhere for the money to go, so
   * a subscription created here would be a row saying somebody owes what cannot be
   * collected — and the gym, not the person, is the one who has to fix it.
   */
  if not exists (
    select 1
    from payments.gateway_connections as connection
    where connection.organization_id = offer.organization_id
      and connection.status = 'active'
  ) then
    raise exception 'this organization cannot take a payment yet' using errcode = 'P0004';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-PAY-012', p_idempotency_key, p_command_id, p_request_hash
  );

  select connection.provider into notice
  from payments.gateway_connections as connection
  where connection.organization_id = offer.organization_id
    and connection.status = 'active';

  /*
   * The same command arriving twice. Everything in the answer is in the receipt or in the
   * offer, so the row is not read back: that would answer what the subscription looks like
   * *now*, which may already be suspended, instead of what this command did.
   */
  if not receipt.claimed then
    return query
    select receipt.aggregate_id, offer.organization_id, offer.id, offer.plan_name,
           offer.amount_minor, offer.currency_code, offer.billing_period,
           notice.provider, false, true;
    return;
  end if;

  /*
   * After the receipt, deliberately. Checked before it, this conflict answers a retry of
   * the command that created the subscription with "you already have one" — which is
   * exactly the case idempotency exists to handle, and the caller who never saw the first
   * answer has no way to tell that from a real conflict. The test caught this.
   *
   * The partial unique index on a live pair is the real guarantee; this check is only here
   * to name the conflict instead of leaking a constraint violation.
   */
  if exists (
    select 1
    from payments.plan_subscriptions as live
    where live.person_id = p_actor_person_id
      and live.organization_id = offer.organization_id
      and live.status <> 'ended'
  ) then
    raise exception 'this person already has a live subscription with this organization'
      using errcode = 'P0004';
  end if;

  new_subscription_id := extensions.uuid_generate_v7();

  -- `current_period_end` stays null until the provider reports a charge. Allfit does not
  -- decide when a period ends; it records what it is told.
  insert into payments.plan_subscriptions (
    id, person_id, organization_id, plan_version_id, status
  )
  values (
    new_subscription_id, p_actor_person_id, offer.organization_id, offer.id, 'active'
  );

  insert into payments.subscription_events (
    subscription_id, event_type, actor_kind, actor_person_id
  )
  values (new_subscription_id, 'started', 'person', p_actor_person_id);

  perform payments.enqueue_subscription_notice(
    new_subscription_id, 'payments.subscription_started.v1'
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'subscription-started',
    'plan_subscription', new_subscription_id
  );

  return query
  select new_subscription_id, offer.organization_id, offer.id, offer.plan_name,
         offer.amount_minor, offer.currency_code, offer.billing_period,
         notice.provider, true, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Reading it — `OP-PAY-013` and `OP-PAY-007`
-- ---------------------------------------------------------------------------

/*
 * What a person owes, to whom, at what price, and whether it is paused. Her own rows and
 * nothing else — the policy decides that, so there is no `where person_id =` here to go
 * out of step with it.
 *
 * The plan version is joined, not copied: the whole point of freezing a version id is
 * that this answer never changes under her.
 */
create or replace function payments.read_my_subscriptions(p_actor_person_id uuid)
returns table (
  subscription_id uuid,
  organization_id uuid,
  organization_name text,
  plan_name text,
  plan_version_id uuid,
  amount_minor bigint,
  currency_code text,
  billing_period text,
  status payments.subscription_status,
  current_period_end date,
  started_at timestamptz,
  suspended_at timestamptz,
  blocked_since timestamptz
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

  return query
  select subscription.id,
         subscription.organization_id,
         organization.display_name,
         plan.name,
         version.id,
         version.amount_minor,
         version.currency_code,
         version.billing_period,
         subscription.status,
         subscription.current_period_end,
         subscription.started_at,
         subscription.suspended_at,
         block.started_at
  from payments.plan_subscriptions as subscription
  join payments.plan_versions as version
    on version.id = subscription.plan_version_id
  join payments.organization_plans as plan
    on plan.id = version.plan_id
  join organizations.organizations as organization
    on organization.id = subscription.organization_id
  left join planning.service_access_blocks as block
    on block.subscription_id = subscription.id
   and block.ended_at is null
  where subscription.status <> 'ended'
  order by subscription.started_at desc, subscription.id;
end
$function$;

/*
 * Who pays this gym. `manage_billing` or nothing: a coach with that client assigned still
 * gets the same answer as a stranger, which is `OP-PAY-007`'s rule written where it
 * cannot be forgotten.
 *
 * Ordered by state and then by start descending, so the ones that need attention are the
 * ones on the first page.
 */
create or replace function payments.list_organization_subscriptions(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_status payments.subscription_status,
  p_limit integer,
  p_cursor_status payments.subscription_status,
  p_cursor_started_at timestamptz,
  p_cursor_subscription_id uuid
)
returns table (
  subscription_id uuid,
  person_id uuid,
  person_name text,
  plan_name text,
  plan_version_id uuid,
  amount_minor bigint,
  currency_code text,
  billing_period text,
  status payments.subscription_status,
  current_period_end date,
  started_at timestamptz,
  suspended_at timestamptz,
  ended_at timestamptz
)
language plpgsql
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

  if (p_cursor_status is null) <> (p_cursor_started_at is null)
     or (p_cursor_status is null) <> (p_cursor_subscription_id is null) then
    raise exception 'invalid subscription cursor' using errcode = '22023';
  end if;

  -- Same answer as "no existe". A coach learning that the operation exists but is not
  -- theirs already learns that this gym charges people.
  if not access_control.has_capability(p_organization_id, 'manage_billing') then
    raise exception 'organization subscriptions not found' using errcode = 'P0002';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  return query
  select subscription.id,
         subscription.person_id,
         person.display_name,
         plan.name,
         version.id,
         version.amount_minor,
         version.currency_code,
         version.billing_period,
         subscription.status,
         subscription.current_period_end,
         subscription.started_at,
         subscription.suspended_at,
         subscription.ended_at
  from payments.plan_subscriptions as subscription
  join payments.plan_versions as version
    on version.id = subscription.plan_version_id
  join payments.organization_plans as plan
    on plan.id = version.plan_id
  join identity.people as person
    on person.id = subscription.person_id
  where subscription.organization_id = p_organization_id
    and (p_status is null or subscription.status = p_status)
    and (
      p_cursor_status is null
      or (subscription.status, subscription.started_at, subscription.id)
         < (p_cursor_status, p_cursor_started_at, p_cursor_subscription_id)
    )
  order by subscription.status desc, subscription.started_at desc, subscription.id desc
  limit p_limit;
end
$function$;

-- ---------------------------------------------------------------------------
-- Suspending and reactivating — `OP-PAY-008`, `OP-PAY-009`, and `IX-40`
-- ---------------------------------------------------------------------------

/*
 * Two writes and nothing else: the subscription's state, and one open cause.
 *
 * `for update` on the subscription is what serialises this against termination,
 * reactivation and a concurrent suspension. The partial unique on an open block is what
 * makes opening it idempotent: a second attempt in a racing transaction waits on the
 * index and then finds the row.
 */
create or replace function payments.suspend_subscription(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_subscription_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  subscription_id uuid,
  status payments.subscription_status,
  block_id uuid,
  suspended boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject record;
  actor_membership_id uuid;
  relationship_id uuid;
  open_block_id uuid;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  if not access_control.has_capability(p_organization_id, 'manage_billing') then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  select membership.id into actor_membership_id
  from organizations.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.person_id = p_actor_person_id
    and membership.status = 'active';

  select subscription.id, subscription.person_id, subscription.status
    into subject
  from payments.plan_subscriptions as subscription
  where subscription.id = p_subscription_id
    and subscription.organization_id = p_organization_id
  for update;

  if subject.id is null then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  if subject.status = 'ended' then
    raise exception 'an ended subscription is not suspended' using errcode = 'P0004';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-PAY-008', p_idempotency_key, p_command_id, p_request_hash
  );

  select block.id into open_block_id
  from planning.service_access_blocks as block
  where block.subscription_id = p_subscription_id
    and block.ended_at is null;

  -- Converges. Already suspended, with its cause open, is the state this command asks
  -- for, so it is not a conflict — and a retried request must not open a second cause.
  if not receipt.claimed or subject.status = 'suspended' then
    if receipt.claimed then
      perform system.finish_idempotency(
        receipt.receipt_id, 200::smallint, 'subscription-already-suspended',
        'plan_subscription', p_subscription_id
      );
    end if;
    return query
    select p_subscription_id, 'suspended'::payments.subscription_status, open_block_id,
           false, true;
    return;
  end if;

  -- Recorded when the cause opens, so the blocked period can be read back against the
  -- relationship it affected even after that relationship ends.
  select relationship.id into relationship_id
  from relationships.service_relationships as relationship
  where relationship.person_id = subject.person_id
    and relationship.organization_id = p_organization_id
    and relationship.status = 'active';

  update payments.plan_subscriptions
  set status = 'suspended',
      suspended_at = clock_timestamp()
  where id = p_subscription_id;

  open_block_id := extensions.uuid_generate_v7();

  /*
   * Both effects, because an unpaid subscription stops the two things the gym provides:
   * the coach's contribution counts for nothing while it is open, and future managed
   * sessions project as paused. Neither is deleted, and that is the point.
   */
  insert into planning.service_access_blocks (
    id, person_id, organization_id, relationship_id, subscription_id, source_kind,
    blocks_future_sessions, blocks_professional_contribution,
    created_by_kind, created_by_membership_id
  )
  values (
    open_block_id, subject.person_id, p_organization_id, relationship_id,
    p_subscription_id, 'subscription_suspension', true, true, 'person',
    actor_membership_id
  );

  insert into payments.subscription_events (
    subscription_id, event_type, actor_kind, actor_person_id, actor_membership_id
  )
  values (
    p_subscription_id, 'suspended', 'person', p_actor_person_id, actor_membership_id
  );

  perform payments.enqueue_subscription_notice(
    p_subscription_id, 'payments.subscription_suspended.v1'
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'subscription-suspended',
    'plan_subscription', p_subscription_id
  );

  return query
  select p_subscription_id, 'suspended'::payments.subscription_status, open_block_id,
         true, false;
end
$function$;

/*
 * Subtractive. It removes one cause and nothing else: no grant comes back, no
 * relationship restarts, no cancelled session returns. Whatever else is open keeps
 * denying, which is why this closes a block by its source and never by its person.
 */
create or replace function payments.reactivate_subscription(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_subscription_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  subscription_id uuid,
  status payments.subscription_status,
  closed_block_id uuid,
  reactivated boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject record;
  actor_membership_id uuid;
  closing_block_id uuid;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  if not access_control.has_capability(p_organization_id, 'manage_billing') then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  select membership.id into actor_membership_id
  from organizations.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.person_id = p_actor_person_id
    and membership.status = 'active';

  select subscription.id, subscription.person_id, subscription.status
    into subject
  from payments.plan_subscriptions as subscription
  where subscription.id = p_subscription_id
    and subscription.organization_id = p_organization_id
  for update;

  if subject.id is null then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  if subject.status = 'ended' then
    raise exception 'an ended subscription is not reactivated' using errcode = 'P0004';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-PAY-009', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed or subject.status = 'active' then
    if receipt.claimed then
      perform system.finish_idempotency(
        receipt.receipt_id, 200::smallint, 'subscription-already-active',
        'plan_subscription', p_subscription_id
      );
    end if;
    return query
    select p_subscription_id, 'active'::payments.subscription_status, null::uuid,
           false, true;
    return;
  end if;

  /*
   * Fails closed on the exact block. A subscription that says `suspended` with no open
   * cause is a state this schema cannot produce, so finding one means something wrote
   * around these functions — and guessing which cause to close would be the wrong way to
   * find that out.
   */
  select block.id into closing_block_id
  from planning.service_access_blocks as block
  where block.subscription_id = p_subscription_id
    and block.ended_at is null
  for update;

  if closing_block_id is null then
    raise exception 'this suspension has no open cause to close' using errcode = 'P0004';
  end if;

  update planning.service_access_blocks
  set ended_at = clock_timestamp()
  where id = closing_block_id;

  update payments.plan_subscriptions
  set status = 'active',
      suspended_at = null
  where id = p_subscription_id;

  insert into payments.subscription_events (
    subscription_id, event_type, actor_kind, actor_person_id, actor_membership_id
  )
  values (
    p_subscription_id, 'reactivated', 'person', p_actor_person_id, actor_membership_id
  );

  perform payments.enqueue_subscription_notice(
    p_subscription_id, 'payments.subscription_reactivated.v1'
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'subscription-reactivated',
    'plan_subscription', p_subscription_id
  );

  return query
  select p_subscription_id, 'active'::payments.subscription_status, closing_block_id,
         true, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ending it — `OP-PAY-010` and `OP-PAY-015`
-- ---------------------------------------------------------------------------

/*
 * One body for both endings, because the only difference is who decided and whether a
 * membership is named. Writing it twice would be two chances to forget that ending has to
 * close its own cause.
 *
 * Not reachable from the runtime: it takes no idempotency key and the two operations
 * above it do. It exists so that "terminate" and "cancel" cannot drift apart.
 */
create or replace function payments.close_subscription(
  p_subscription_id uuid,
  p_actor_person_id uuid,
  p_actor_membership_id uuid
)
returns void
language plpgsql
set search_path = pg_catalog
as $function$
declare
  open_block_id uuid;
begin
  -- An open cause outlives nothing. Reactivation requires a subscription that has not
  -- ended, so a block left open here could never be closed by anything at all.
  select block.id into open_block_id
  from planning.service_access_blocks as block
  where block.subscription_id = p_subscription_id
    and block.ended_at is null
  for update;

  if open_block_id is not null then
    update planning.service_access_blocks
    set ended_at = clock_timestamp()
    where id = open_block_id;
  end if;

  update payments.plan_subscriptions
  set status = 'ended',
      suspended_at = null,
      ended_at = clock_timestamp(),
      ended_by_kind = 'person',
      ended_by_membership_id = p_actor_membership_id
  where id = p_subscription_id;

  insert into payments.subscription_events (
    subscription_id, event_type, actor_kind, actor_person_id, actor_membership_id
  )
  values (
    p_subscription_id, 'ended', 'person', p_actor_person_id, p_actor_membership_id
  );
end
$function$;

/*
 * The gym ends it. **This does not end the service relationship** — they are different
 * bonds, and ending the relationship is `OP-REL-008` with its own effects. Somebody who
 * stops paying and keeps training is a decision the gym has to make on purpose.
 */
create or replace function payments.end_subscription(
  p_actor_person_id uuid,
  p_organization_id uuid,
  p_subscription_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  subscription_id uuid,
  status payments.subscription_status,
  ended boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject record;
  actor_membership_id uuid;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  perform set_config('app.actor_org_id', p_organization_id::text, true);

  if not access_control.has_capability(p_organization_id, 'manage_billing') then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  select membership.id into actor_membership_id
  from organizations.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.person_id = p_actor_person_id
    and membership.status = 'active';

  -- The table requires a membership of this organization for a termination taken on its
  -- behalf, so an owner who left mid-request is refused here rather than by a foreign key.
  if actor_membership_id is null then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  select subscription.id, subscription.status
    into subject
  from payments.plan_subscriptions as subscription
  where subscription.id = p_subscription_id
    and subscription.organization_id = p_organization_id
  for update;

  if subject.id is null then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-PAY-010', p_idempotency_key, p_command_id, p_request_hash
  );

  -- Converges without effect, which is what the catalogue asks for: already ended is the
  -- state this command wanted.
  if not receipt.claimed or subject.status = 'ended' then
    if receipt.claimed then
      perform system.finish_idempotency(
        receipt.receipt_id, 200::smallint, 'subscription-already-ended',
        'plan_subscription', p_subscription_id
      );
    end if;
    return query
    select p_subscription_id, 'ended'::payments.subscription_status, false, true;
    return;
  end if;

  perform payments.enqueue_subscription_notice(
    p_subscription_id, 'payments.subscription_ended.v1'
  );

  perform payments.close_subscription(
    p_subscription_id, p_actor_person_id, actor_membership_id
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'subscription-ended',
    'plan_subscription', p_subscription_id
  );

  return query
  select p_subscription_id, 'ended'::payments.subscription_status, true, false;
end
$function$;

/*
 * The person cancels. Cancelling the money **revokes nothing**: her Fitness ID, her
 * history and every permission she granted stay exactly as they were. Cutting access to
 * her data is `OP-PRV-005`, ending the relationship is `OP-REL-007`, and both are
 * separate decisions on purpose — somebody who stops paying has not withdrawn consent.
 */
create or replace function payments.cancel_my_subscription(
  p_actor_person_id uuid,
  p_subscription_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  subscription_id uuid,
  status payments.subscription_status,
  ended boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  subject record;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_actor_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  select subscription.id, subscription.status
    into subject
  from payments.plan_subscriptions as subscription
  where subscription.id = p_subscription_id
    and subscription.person_id = p_actor_person_id
  for update;

  if subject.id is null then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'OP-PAY-015', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed or subject.status = 'ended' then
    if receipt.claimed then
      perform system.finish_idempotency(
        receipt.receipt_id, 200::smallint, 'subscription-already-ended',
        'plan_subscription', p_subscription_id
      );
    end if;
    return query
    select p_subscription_id, 'ended'::payments.subscription_status, false, true;
    return;
  end if;

  perform payments.enqueue_subscription_notice(
    p_subscription_id, 'payments.subscription_ended.v1'
  );

  -- No membership: she is not a member of the gym she pays. The column stays null and the
  -- event says `person`, which is how the history tells her cancellation apart from the
  -- gym's termination.
  perform payments.close_subscription(p_subscription_id, p_actor_person_id, null);

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'subscription-cancelled',
    'plan_subscription', p_subscription_id
  );

  return query
  select p_subscription_id, 'ended'::payments.subscription_status, true, false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter table planning.service_access_blocks owner to allfit_owner;

alter function planning.enforce_service_access_block_source() owner to allfit_owner;
alter function planning.service_access_block_guard_tg() owner to allfit_owner;
alter function payments.enqueue_subscription_notice(uuid, text) owner to allfit_owner;
alter function payments.close_subscription(uuid, uuid, uuid) owner to allfit_owner;
alter function payments.list_organization_plans(uuid, uuid, integer, bigint, uuid)
  owner to allfit_owner;
alter function payments.subscribe_to_plan(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;
alter function payments.read_my_subscriptions(uuid) owner to allfit_owner;
alter function payments.list_organization_subscriptions(
  uuid, uuid, payments.subscription_status, integer, payments.subscription_status,
  timestamptz, uuid
) owner to allfit_owner;
alter function payments.suspend_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function payments.reactivate_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function payments.end_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function payments.cancel_my_subscription(uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;

revoke all on planning.service_access_blocks from public, allfit_api;

revoke all on function planning.enforce_service_access_block_source() from public;
revoke all on function planning.service_access_block_guard_tg() from public;
revoke all on function payments.enqueue_subscription_notice(uuid, text)
  from public, allfit_api;
revoke all on function payments.close_subscription(uuid, uuid, uuid) from public, allfit_api;
revoke all on function payments.list_organization_plans(uuid, uuid, integer, bigint, uuid)
  from public;
revoke all on function payments.subscribe_to_plan(uuid, uuid, uuid, uuid, bytea) from public;
revoke all on function payments.read_my_subscriptions(uuid) from public;
revoke all on function payments.list_organization_subscriptions(
  uuid, uuid, payments.subscription_status, integer, payments.subscription_status,
  timestamptz, uuid
) from public;
revoke all on function payments.suspend_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;
revoke all on function payments.reactivate_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;
revoke all on function payments.end_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;
revoke all on function payments.cancel_my_subscription(uuid, uuid, uuid, uuid, bytea)
  from public;

-- The runtime reaches the eight operations and nothing else. `close_subscription` and
-- `enqueue_subscription_notice` are deliberately absent: ending without an idempotency
-- receipt, or sending a notice without a transition, are not operations.
grant execute on function payments.list_organization_plans(uuid, uuid, integer, bigint, uuid)
  to allfit_api;
grant execute on function payments.subscribe_to_plan(uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function payments.read_my_subscriptions(uuid) to allfit_api;
grant execute on function payments.list_organization_subscriptions(
  uuid, uuid, payments.subscription_status, integer, payments.subscription_status,
  timestamptz, uuid
) to allfit_api;
grant execute on function payments.suspend_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function payments.reactivate_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function payments.end_subscription(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function payments.cancel_my_subscription(uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
