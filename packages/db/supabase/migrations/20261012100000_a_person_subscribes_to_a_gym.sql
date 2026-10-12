-- The paying bond between a person and a gym — `payments` 13.1 to 13.4 and 13.6.
--
-- The rule that governs this schema: **Allfit reflects the state of a payment, it never
-- processes one.** No card data, no balances, no transfers, no reconciliation. The money
-- goes from the person to the gym's own gateway account; Allfit learns what happened and
-- writes it down.
--
-- Six objects, in the order they depend on each other:
--
-- 1. `gateway_connections` — that a gym has an account at a provider, and which one.
-- 2. `gateway_credentials` — the account reference and the vault key. Owner only.
-- 3. `organization_plans` — the identity of a commercial plan. No price.
-- 4. `plan_versions` — a published, immutable price. This is what a subscription freezes.
-- 5. `plan_subscriptions` — the bond itself.
-- 6. `subscription_events` — append-only history with its actor.
--
-- **A subscription is not a service relationship.** It is a separate entity with its own
-- lifecycle, and that separation is the whole design: a person can train at a gym and owe
-- it nothing, or owe it money and no longer train there. No table here holds a foreign
-- key into `relationships`, `planning` or `privacy`. When a suspension has to make
-- training ineffective, `planning.service_access_blocks` points *at* a subscription; the
-- arrow never turns around, which is what lets a payment problem be undone without
-- restoring grants, relationships or assignments.
--
-- **What a published version costs never moves.** A subscription holds a version id, and
-- the version refuses every edit except being retired. Raising a price publishes another
-- version. A reader who finds this over-strict should try the alternative: a price column
-- somebody can update, and a client who agreed to one number and is charged another.
--
-- **A coach does not read any of this.** The payment state of a client is not their
-- business, so the read policy admits the person it belongs to and the organization only
-- with `manage_billing` — which `owner` and `admin` carry and `coach` and `staff` do not.
--
-- The gateway credentials are narrower still, and the dictionary disagrees with itself
-- about them: its actor line says "solo `owner`. Ni `admin`, ni `coach`, ni `staff`" and
-- its RLS line names `manage_billing`, which `admin` also carries.
-- `connect_billing_account` exists, belongs to `owner` alone, and is the only reading of
-- the two that an `admin` cannot satisfy, so that is what guards them. A test asserts the
-- difference, because otherwise the two capabilities look interchangeable: today every
-- `owner` holds both.
--
-- **Nothing ends without somebody deciding it.** The gateway worker moves a subscription
-- between `active` and `suspended` and that is all it can do: ending requires an actor
-- kind this schema accepts, and `worker` is not one of them. That check is the reason a
-- failed charge can never quietly look like a cancellation.
--
-- No runtime DML reaches these tables. `allfit_api` gets no table privilege at all; the
-- lifecycle operations arrive in the next migration as closed functions, together with
-- `planning.service_access_blocks`, which `IX-40` needs and which does not exist yet.
-- Until then these tables are writable only by a superuser, which is the honest state:
-- the shape is settled and reviewable, and no operation pretends to work.
--
-- `IX-38` is the composite foreign key on `plan_subscriptions`: the version a gym charges
-- for belongs to that gym.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type payments.subscription_status as enum ('active', 'suspended', 'ended');
alter type payments.subscription_status owner to allfit_owner;

/*
 * Whether the actor is currently a client of this organization.
 *
 * Four policies below need it, and none of them can be written with
 * `has_membership`: a person who pays a gym works nowhere. It is the counterpart of
 * `has_capability` on the other side of the counter.
 *
 * Narrow on purpose. It answers only about the acting person, so the policy on
 * `service_relationships` admits the row it reads and this does not become a way to
 * ask about somebody else's relationships.
 */
create or replace function access_control.has_active_relationship(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from relationships.service_relationships as relationship
    where relationship.organization_id = p_organization_id
      and relationship.person_id = access_control.person()
      and relationship.status = 'active'
  )
$function$;

alter function access_control.has_active_relationship(uuid) owner to allfit_owner;
revoke all on function access_control.has_active_relationship(uuid) from public, allfit_api;

-- ---------------------------------------------------------------------------
-- 13.1 The gym's own gateway account
-- ---------------------------------------------------------------------------

/*
 * Two tables and not the dictionary's one, because row-level security cannot hide a
 * column from somebody who is entitled to another column of the same row.
 *
 * "This gym can be paid" is a fact the person about to pay is entitled to: without it
 * they cannot be told why subscribing is refused. "Which account, and which vault key"
 * is the gym owner's alone. Keeping both in one row forces a choice between a policy
 * that denies the payer and a policy that hands them the credential reference, and the
 * dictionary asks for neither.
 *
 * So the connection is the payable fact, and the credentials hang off it one-to-one.
 */
create table payments.gateway_connections (
  id uuid not null default extensions.uuid_generate_v7(),
  organization_id uuid not null,
  provider text not null,
  status text not null default 'active',
  connected_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint pk_gateway_connections primary key (id),
  -- Carrying key: the credentials cannot claim one connection's id under another
  -- organization's name.
  constraint uq_gateway_connections_carrier unique (id, organization_id),
  constraint fk_gateway_connections_organization foreign key (organization_id) references organizations.organizations(id) on delete restrict,
  constraint ck_gateway_connections_provider check (provider in ('mercado_pago', 'wompi')),
  constraint ck_gateway_connections_status check (status in ('active', 'revoked')),
  constraint ck_gateway_connections_revocation check (
    (status = 'revoked') = (revoked_at is not null)
  ),
  constraint ck_gateway_connections_revoked_at check (
    revoked_at is null or revoked_at >= connected_at
  )
);

-- One account at a time. Revoking keeps the row, because the charges it reported are
-- still the gym's history.
create unique index uidx_gateway_connections_active
  on payments.gateway_connections (organization_id)
  where status = 'active';

create index idx_gateway_connections_organization
  on payments.gateway_connections (organization_id);

create table payments.gateway_credentials (
  connection_id uuid not null,
  organization_id uuid not null,
  external_account_ref text not null,
  -- A pointer into a secret store, never the secret. Nothing in this database can be
  -- used to charge anybody, which is what keeps a database leak from being a payments
  -- incident.
  credential_secret_ref text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_gateway_credentials primary key (connection_id),
  constraint fk_gateway_credentials_connection foreign key (connection_id, organization_id) references payments.gateway_connections(id, organization_id) on delete restrict,
  constraint ck_gateway_credentials_account_ref check (btrim(external_account_ref) <> ''),
  constraint ck_gateway_credentials_secret_ref check (btrim(credential_secret_ref) <> '')
);

-- ---------------------------------------------------------------------------
-- 13.2 The plan, which has no price
-- ---------------------------------------------------------------------------

create table payments.organization_plans (
  id uuid not null default extensions.uuid_generate_v7(),
  organization_id uuid not null,
  name text not null,
  status catalog.publication_status not null default 'draft',
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_organization_plans primary key (id),
  -- Carrying key: a version cannot point at one plan's id while claiming another
  -- organization.
  constraint uq_organization_plans_carrier unique (id, organization_id),
  constraint fk_organization_plans_organization foreign key (organization_id) references organizations.organizations(id) on delete restrict,
  constraint ck_organization_plans_name check (
    btrim(name) <> '' and name = btrim(name) and char_length(name) <= 80
  ),
  -- A plan is a draft until one of its versions is published. Retiring a plan is not
  -- part of these stories, so neither state exists yet.
  constraint ck_organization_plans_status check (status in ('draft', 'published'))
);

create unique index uidx_organization_plans_name
  on payments.organization_plans (organization_id, lower(name));

create index idx_organization_plans_organization_status
  on payments.organization_plans (organization_id, status);

create or replace function payments.organization_plan_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a plan is never deleted: its versions carry prices people agreed to'
      using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.created_at is distinct from old.created_at then
    raise exception 'a plan keeps its identity and its organization' using errcode = '55000';
  end if;
  if old.status = 'published' and new.status is distinct from old.status then
    raise exception 'a published plan stays published' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_organization_plans_guard
before update or delete on payments.organization_plans
for each row execute function payments.organization_plan_guard_tg();

-- ---------------------------------------------------------------------------
-- 13.3 The version, which is the price and is frozen
-- ---------------------------------------------------------------------------

create table payments.plan_versions (
  id uuid not null default extensions.uuid_generate_v7(),
  plan_id uuid not null,
  organization_id uuid not null,
  version_number integer not null,
  amount_minor bigint not null,
  currency_code text not null,
  billing_period text not null,
  status catalog.publication_status not null default 'published',
  published_at timestamptz not null default clock_timestamp(),
  deprecated_at timestamptz,
  constraint pk_plan_versions primary key (id),
  -- Carrying key, and the other half of IX-38: whatever subscribes to this version
  -- inherits the organization from here and cannot name a different one.
  constraint uq_plan_versions_carrier unique (id, organization_id),
  constraint uq_plan_versions_number unique (plan_id, version_number),
  constraint fk_plan_versions_plan foreign key (plan_id, organization_id) references payments.organization_plans(id, organization_id) on delete restrict,
  constraint ck_plan_versions_number check (version_number > 0),
  -- A gym plan charges something. A plan at zero is the free platform plan, which is a
  -- different table and a different decision.
  constraint ck_plan_versions_amount check (amount_minor > 0),
  constraint ck_plan_versions_currency check (currency_code ~ '^[A-Z]{3}$'),
  constraint ck_plan_versions_billing_period check (billing_period in ('month', 'year')),
  -- A version exists only once published. There is no draft price.
  constraint ck_plan_versions_status check (status in ('published', 'deprecated')),
  constraint ck_plan_versions_deprecation check (
    (status = 'deprecated') = (deprecated_at is not null)
  ),
  constraint ck_plan_versions_deprecated_at check (
    deprecated_at is null or deprecated_at >= published_at
  )
);

create index idx_plan_versions_plan_status
  on payments.plan_versions (plan_id, status);

create or replace function payments.plan_version_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a published plan version is never deleted' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.plan_id is distinct from old.plan_id
     or new.organization_id is distinct from old.organization_id
     or new.version_number is distinct from old.version_number
     or new.amount_minor is distinct from old.amount_minor
     or new.currency_code is distinct from old.currency_code
     or new.billing_period is distinct from old.billing_period
     or new.published_at is distinct from old.published_at then
    raise exception 'a published plan version is never edited; publish another one'
      using errcode = '55000';
  end if;
  -- Retiring is the one change allowed, and only once and only forwards. A version that
  -- came back would change what a live subscription is pointing at.
  if old.deprecated_at is not null and new.deprecated_at is distinct from old.deprecated_at then
    raise exception 'a retired plan version does not come back' using errcode = '55000';
  end if;
  if old.status = 'deprecated' and new.status is distinct from old.status then
    raise exception 'a retired plan version stays retired' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_plan_versions_guard
before update or delete on payments.plan_versions
for each row execute function payments.plan_version_guard_tg();

-- ---------------------------------------------------------------------------
-- 13.4 The subscription
-- ---------------------------------------------------------------------------

create table payments.plan_subscriptions (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  organization_id uuid not null,
  plan_version_id uuid not null,
  status payments.subscription_status not null default 'active',
  external_subscription_ref text,
  current_period_end date,
  started_at timestamptz not null default clock_timestamp(),
  suspended_at timestamptz,
  ended_at timestamptz,
  ended_by_kind identity.actor_kind,
  ended_by_membership_id uuid,
  constraint pk_plan_subscriptions primary key (id),
  -- Carrying key. `planning.service_access_blocks` follows it so a block cannot claim one
  -- subscription's id with another person's or organization's name on it.
  constraint uq_plan_subscriptions_carrier unique (id, person_id, organization_id),
  constraint fk_plan_subscriptions_person foreign key (person_id) references identity.people(id) on delete restrict,
  -- IX-38. Without the organization in this key a gym could charge for another gym's
  -- price and nothing would notice.
  constraint fk_plan_subscriptions_version foreign key (plan_version_id, organization_id) references payments.plan_versions(id, organization_id) on delete restrict,
  constraint fk_plan_subscriptions_ended_by foreign key (ended_by_membership_id, organization_id) references organizations.organization_memberships(id, organization_id) on delete restrict,
  constraint ck_plan_subscriptions_suspension check (
    (status = 'suspended') = (suspended_at is not null)
  ),
  constraint ck_plan_subscriptions_termination check (
    (status = 'ended') = (ended_at is not null)
  ),
  -- Nothing ends without somebody deciding it. The gateway worker transitions between
  -- `active` and `suspended` and has no actor kind this check accepts, so a failed charge
  -- can never arrive looking like a cancellation.
  constraint ck_plan_subscriptions_ended_actor check (
    status <> 'ended' or ended_by_kind in ('person', 'professional')
  ),
  constraint ck_plan_subscriptions_suspended_at check (
    suspended_at is null or suspended_at >= started_at
  ),
  constraint ck_plan_subscriptions_ended_at check (
    ended_at is null or ended_at >= started_at
  ),
  constraint ck_plan_subscriptions_external_ref check (
    external_subscription_ref is null or btrim(external_subscription_ref) <> ''
  )
);

-- One live subscription per person and gym. Coming back is a new row, not a revived one:
-- the old one keeps who ended it and when.
create unique index uidx_plan_subscriptions_live
  on payments.plan_subscriptions (person_id, organization_id)
  where status <> 'ended';

-- Beyond the dictionary, and the gateway consumer is why: it arrives with a provider
-- reference and has to find exactly one subscription. Two rows carrying the same
-- reference would make a webhook suspend whichever one it happened to read first.
create unique index uidx_plan_subscriptions_external_ref
  on payments.plan_subscriptions (organization_id, external_subscription_ref)
  where external_subscription_ref is not null;

create index idx_plan_subscriptions_person_status
  on payments.plan_subscriptions (person_id, status);
create index idx_plan_subscriptions_organization_status
  on payments.plan_subscriptions (organization_id, status);

create or replace function payments.plan_subscription_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a subscription is never deleted: it is the record of what was charged'
      using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.person_id is distinct from old.person_id
     or new.organization_id is distinct from old.organization_id
     or new.started_at is distinct from old.started_at then
    raise exception 'a subscription keeps its person, its organization and its start'
      using errcode = '55000';
  end if;
  -- The point of versioning prices. Moving this column is how a client ends up paying a
  -- number they never agreed to.
  if new.plan_version_id is distinct from old.plan_version_id then
    raise exception 'a subscription keeps the plan version it was taken on'
      using errcode = '55000';
  end if;
  if old.status = 'ended' then
    raise exception 'an ended subscription does not restart; subscribing again is a new row'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_plan_subscriptions_guard
before update or delete on payments.plan_subscriptions
for each row execute function payments.plan_subscription_guard_tg();

-- ---------------------------------------------------------------------------
-- 13.6 What happened to it
-- ---------------------------------------------------------------------------

create table payments.subscription_events (
  id uuid not null default extensions.uuid_generate_v7(),
  subscription_id uuid not null,
  event_type text not null,
  actor_kind identity.actor_kind not null,
  -- No foreign key to `identity.people` on purpose: anonymising a person breaks the link
  -- to their data, and an audit row has to survive that rather than block it.
  actor_person_id uuid,
  actor_membership_id uuid,
  detail_schema_version smallint,
  detail jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint pk_subscription_events primary key (id),
  constraint fk_subscription_events_subscription foreign key (subscription_id) references payments.plan_subscriptions(id) on delete cascade,
  constraint ck_subscription_events_type check (
    event_type in ('started', 'suspended', 'reactivated', 'ended')
  ),
  -- Every event names the person who caused it, unless the gateway worker did.
  constraint ck_subscription_events_actor check (
    actor_person_id is not null or actor_kind = 'worker'
  ),
  constraint ck_subscription_events_detail check (
    num_nonnulls(detail_schema_version, detail) <> 1
  ),
  constraint ck_subscription_events_detail_shape check (
    detail is null or jsonb_typeof(detail) = 'object'
  )
);

create index idx_subscription_events_subscription
  on payments.subscription_events (subscription_id, occurred_at desc);

create or replace function payments.subscription_event_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  -- The declared `on delete cascade` can therefore never fire, which is deliberate:
  -- removing a subscription has to come back here and decide what happens to its history
  -- instead of dropping it on the way past.
  if tg_op = 'DELETE' then
    raise exception 'the history of a subscription is never deleted' using errcode = '55000';
  end if;
  raise exception 'the history of a subscription is never rewritten' using errcode = '55000';
end
$function$;

create trigger trg_subscription_events_guard
before update or delete on payments.subscription_events
for each row execute function payments.subscription_event_guard_tg();

-- ---------------------------------------------------------------------------
-- Who may read what
-- ---------------------------------------------------------------------------

alter table payments.gateway_connections enable row level security;
alter table payments.gateway_connections force row level security;
alter table payments.gateway_credentials enable row level security;
alter table payments.gateway_credentials force row level security;
alter table payments.organization_plans enable row level security;
alter table payments.organization_plans force row level security;
alter table payments.plan_versions enable row level security;
alter table payments.plan_versions force row level security;
alter table payments.plan_subscriptions enable row level security;
alter table payments.plan_subscriptions force row level security;
alter table payments.subscription_events enable row level security;
alter table payments.subscription_events force row level security;

/*
 * Every policy below is split by command. `for all` would include `select`, and policies
 * combine with OR, so one permissive write policy hands every reader everything the read
 * policy was written to withhold. That mistake has already been made in this repository
 * and the denial tests are what caught it.
 *
 * Writes are admitted to any actor and authorized by the closed functions that will own
 * these tables: the policy's job here is to keep a stray statement from reaching rows it
 * has no business in, not to re-decide the operation. There is no delete policy anywhere,
 * so deletes are denied by absence as well as by the guard triggers.
 */

/*
 * Whether a gym can be paid at all. The team reads it because the answer is operational,
 * and so does a person who has an active relationship with the gym: when subscribing is
 * refused for want of a gateway, telling them anything useful requires reading this.
 *
 * It is deliberately only the fact. Nothing here identifies an account.
 */
create policy gateway_connections_select_payable
  on payments.gateway_connections
  for select to allfit_owner
  using (
    access_control.has_membership(organization_id)
    or access_control.has_active_relationship(organization_id)
  );

create policy gateway_connections_insert_billing
  on payments.gateway_connections
  for insert to allfit_owner
  with check (
    access_control.has_membership(organization_id)
    and access_control.has_capability(organization_id, 'connect_billing_account')
  );

create policy gateway_connections_update_billing
  on payments.gateway_connections
  for update to allfit_owner
  using (
    access_control.has_membership(organization_id)
    and access_control.has_capability(organization_id, 'connect_billing_account')
  )
  with check (
    access_control.has_membership(organization_id)
    and access_control.has_capability(organization_id, 'connect_billing_account')
  );

-- The credentials are the narrowest thing in the schema: the owner of that one gym and
-- nobody else. Not an admin, not a coach, not a client, not another gym. Whoever widens
-- this to `manage_billing` to make an admin screen work has handed the credential
-- reference to a role the dictionary excluded by name.
create policy gateway_credentials_select_owner
  on payments.gateway_credentials
  for select to allfit_owner
  using (
    access_control.has_membership(organization_id)
    and access_control.has_capability(organization_id, 'connect_billing_account')
  );

create policy gateway_credentials_insert_owner
  on payments.gateway_credentials
  for insert to allfit_owner
  with check (
    access_control.has_membership(organization_id)
    and access_control.has_capability(organization_id, 'connect_billing_account')
  );

create policy gateway_credentials_update_owner
  on payments.gateway_credentials
  for update to allfit_owner
  using (
    access_control.has_membership(organization_id)
    and access_control.has_capability(organization_id, 'connect_billing_account')
  )
  with check (
    access_control.has_membership(organization_id)
    and access_control.has_capability(organization_id, 'connect_billing_account')
  );

/*
 * A price list is not a secret from the team that works there, and a coach being asked
 * "how much is the monthly plan?" should be able to answer. What the team cannot see is
 * who pays it.
 *
 * A client of the gym sees the published plans and no drafts, because that is what she is
 * choosing from. The filter sits here and not in the query function: a draft price is not
 * an offer, and whether it reaches her should not depend on which function asked.
 *
 * This is not a marketplace. Without an active relationship there is nothing to see, so
 * browsing gyms stays as deferred as the catalogue says it is.
 */
create policy organization_plans_select_member
  on payments.organization_plans
  for select to allfit_owner
  using (
    access_control.has_membership(organization_id)
    or (status = 'published' and access_control.has_active_relationship(organization_id))
  );

create policy organization_plans_insert_billing
  on payments.organization_plans
  for insert to allfit_owner
  with check (access_control.has_capability(organization_id, 'manage_billing'));

create policy organization_plans_update_billing
  on payments.organization_plans
  for update to allfit_owner
  using (access_control.has_capability(organization_id, 'manage_billing'))
  with check (access_control.has_capability(organization_id, 'manage_billing'));

-- A retired version is still readable by whoever is subscribed to it — her own
-- subscription names it, and a price she is paying that she cannot be shown is worse than
-- useless. What she cannot do is pick one, and that is the function's filter, not this.
create policy plan_versions_select_member
  on payments.plan_versions
  for select to allfit_owner
  using (
    access_control.has_membership(organization_id)
    or access_control.has_active_relationship(organization_id)
    or exists (
      select 1
      from payments.plan_subscriptions as subscription
      where subscription.plan_version_id = plan_versions.id
        and subscription.person_id = access_control.person()
    )
  );

create policy plan_versions_insert_billing
  on payments.plan_versions
  for insert to allfit_owner
  with check (access_control.has_capability(organization_id, 'manage_billing'));

create policy plan_versions_update_billing
  on payments.plan_versions
  for update to allfit_owner
  using (access_control.has_capability(organization_id, 'manage_billing'))
  with check (access_control.has_capability(organization_id, 'manage_billing'));

-- The person, and the billing administration of the gym she pays. A coach of that same
-- gym resolves `org()` and still reads nothing, because what his client pays is not his
-- business — which is the only interesting half of this policy and is tested as such.
create policy plan_subscriptions_select_actor
  on payments.plan_subscriptions
  for select to allfit_owner
  using (
    person_id = access_control.person()
    or (
      organization_id = access_control.org()
      and access_control.has_capability(organization_id, 'manage_billing')
    )
  );

create policy plan_subscriptions_insert_owner
  on payments.plan_subscriptions
  for insert to allfit_owner
  with check (access_control.actor_kind() is not null);

create policy plan_subscriptions_update_owner
  on payments.plan_subscriptions
  for update to allfit_owner
  using (access_control.actor_kind() is not null)
  with check (access_control.actor_kind() is not null);

/*
 * Via the subscription, and literally: the subquery is filtered by the subscription's own
 * policy, because that table forces row-level security on `allfit_owner` too. The rule is
 * therefore stated once. Copying it here instead would be a second place to forget.
 *
 * This table carries no person or organization column, so there is nothing to compare
 * directly against — unlike the assignments in `relationships`, which do.
 */
create policy subscription_events_select_actor
  on payments.subscription_events
  for select to allfit_owner
  using (
    exists (
      select 1
      from payments.plan_subscriptions as subscription
      where subscription.id = subscription_id
    )
  );

create policy subscription_events_insert_owner
  on payments.subscription_events
  for insert to allfit_owner
  with check (access_control.actor_kind() is not null);

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter table payments.gateway_connections owner to allfit_owner;
alter table payments.gateway_credentials owner to allfit_owner;
alter table payments.organization_plans owner to allfit_owner;
alter table payments.plan_versions owner to allfit_owner;
alter table payments.plan_subscriptions owner to allfit_owner;
alter table payments.subscription_events owner to allfit_owner;

alter function payments.organization_plan_guard_tg() owner to allfit_owner;
alter function payments.plan_version_guard_tg() owner to allfit_owner;
alter function payments.plan_subscription_guard_tg() owner to allfit_owner;
alter function payments.subscription_event_guard_tg() owner to allfit_owner;

revoke all on function payments.organization_plan_guard_tg() from public;
revoke all on function payments.plan_version_guard_tg() from public;
revoke all on function payments.plan_subscription_guard_tg() from public;
revoke all on function payments.subscription_event_guard_tg() from public;

-- The runtime role reaches these tables through closed functions or not at all, and the
-- next migration is where those functions arrive. There is nothing here to read around.
revoke all on
  payments.gateway_connections,
  payments.gateway_credentials,
  payments.organization_plans,
  payments.plan_versions,
  payments.plan_subscriptions,
  payments.subscription_events
from public, allfit_api;
