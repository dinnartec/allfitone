-- ADR-043 — Allfit Pro: a person pays for it through their phone's store, or has it through
-- an active gym; OP-PAY-018..021 and OP-PAY-023 (`HU-SP-084..088`). Closes DB-P5-007/008.
--
-- **The store charges; Allfit records.** Inside Space, Pro is sold only through the App
-- Store and Google Play. The API verifies every purchase and every notification with the
-- store before calling these functions, so what arrives here is already the store's word.
-- No table holds card data or a notification's content: a notification is remembered by its
-- id and a hash, which is all deduplication needs.
--
-- **Each paid version is sold by its own store products.** `platform_store_products` ties
-- a product to an exact catalogue version, so a subscription knows which version it bought
-- and keeps it after another is published. A new price is a new product. The free plan is
-- never sold.
--
-- **Pro is resolved on read, never stored as a flag** (`resolve_pro`), in this order:
-- 1. a live subscription of one's own — active, or in grace — gives its frozen version;
-- 2. otherwise an active relationship with an active organization gives the version of the
--    paid plan called `pro` in force: whoever gets Pro through a gym follows what Pro is;
-- 3. otherwise the free plan in force.
-- Any doubt resolves to free: without a published `pro`, a gym gives nothing more. Every
-- source in force is reported, so whoever pays knows whether a gym would cover them too.
--
-- **A store subscription belongs to one person.** Whoever records it first owns it, and the
-- purchase must carry that person's id as its account token, so a signed transaction copied
-- from someone else is refused. Purchases for one person are serialized; a person has one
-- live subscription at most.
--
-- **Notifications move the state, in order.** Each carries when the store observed it; one
-- older than the last applied is stale and changes nothing, so a late delivery cannot undo
-- a renewal. A notification for a subscription nobody recorded is kept and ignored: the
-- purchase always reaches Allfit through the app, which presents it again on restore.
--
-- Ending Pro deletes nothing and touches no permission or relationship.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type payments.platform_store as enum ('app_store', 'google_play');
create type payments.platform_subscription_status as enum ('active', 'grace', 'suspended', 'ended');

alter type payments.platform_store owner to allfit_owner;
alter type payments.platform_subscription_status owner to allfit_owner;

-- ---------------------------------------------------------------------------
-- Store products
-- ---------------------------------------------------------------------------

create table payments.platform_store_products (
  store payments.platform_store not null,
  product_id text not null,
  platform_plan_version_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_platform_store_products primary key (store, product_id),
  -- Carries the version, so a subscription cannot name a product and claim another version.
  constraint uq_platform_store_products_version unique (store, product_id, platform_plan_version_id),
  constraint fk_platform_store_products_version foreign key (platform_plan_version_id) references payments.platform_plan_versions(id) on delete restrict,
  constraint ck_platform_store_products_product check (product_id ~ '^[A-Za-z0-9][A-Za-z0-9._]{0,99}$')
);

create index idx_platform_store_products_version
  on payments.platform_store_products (platform_plan_version_id);

create or replace function payments.platform_store_product_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a store product is never changed or removed' using errcode = '55000';
  end if;
  if not exists (
    select 1 from payments.platform_plan_versions as version
    where version.id = new.platform_plan_version_id and version.plan_kind = 'paid'
  ) then
    raise exception 'only a paid version is sold in a store' using errcode = '22023';
  end if;
  return new;
end
$function$;

create trigger trg_platform_store_products_guard
before insert or update or delete on payments.platform_store_products
for each row execute function payments.platform_store_product_guard_tg();

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

create table payments.platform_subscriptions (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  platform_plan_version_id uuid not null,
  store payments.platform_store not null,
  store_product_id text not null,
  -- Apple's originalTransactionId, or Google's first purchase token, hashed by the API.
  store_subscription_ref text not null,
  environment text not null,
  status payments.platform_subscription_status not null,
  auto_renews boolean not null,
  current_period_end timestamptz not null,
  grace_until timestamptz,
  last_observed_at timestamptz not null,
  started_at timestamptz not null default clock_timestamp(),
  suspended_at timestamptz,
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_platform_subscriptions primary key (id),
  constraint uq_platform_subscriptions_id_person unique (id, person_id),
  constraint fk_platform_subscriptions_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_subscriptions_product foreign key (store, store_product_id, platform_plan_version_id) references payments.platform_store_products(store, product_id, platform_plan_version_id) on delete restrict,
  constraint ck_platform_subscriptions_ref check (char_length(store_subscription_ref) between 1 and 200),
  constraint ck_platform_subscriptions_environment check (environment in ('production', 'sandbox', 'xcode')),
  constraint ck_platform_subscriptions_ended check (
    (status = 'ended') = (ended_at is not null and ended_reason is not null)
  ),
  constraint ck_platform_subscriptions_ended_reason check (
    ended_reason is null or ended_reason in ('expired', 'refunded', 'revoked', 'replaced')
  ),
  constraint ck_platform_subscriptions_grace check (status <> 'grace' or grace_until is not null),
  constraint ck_platform_subscriptions_suspended check (status <> 'suspended' or suspended_at is not null)
);

create unique index uidx_platform_subscriptions_live
  on payments.platform_subscriptions (person_id)
  where status <> 'ended';

-- A live store subscription belongs to one row, and so to one person.
create unique index uidx_platform_subscriptions_ref_live
  on payments.platform_subscriptions (store, store_subscription_ref)
  where status <> 'ended';

create index idx_platform_subscriptions_ref
  on payments.platform_subscriptions (store, store_subscription_ref);
create index idx_platform_subscriptions_product
  on payments.platform_subscriptions (store, store_product_id, platform_plan_version_id);

create or replace function payments.platform_subscription_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a subscription is history and is never deleted' using errcode = '55000';
  end if;
  if new.person_id <> old.person_id
     or new.platform_plan_version_id <> old.platform_plan_version_id
     or new.store <> old.store
     or new.store_product_id <> old.store_product_id
     or new.store_subscription_ref <> old.store_subscription_ref
     or new.environment <> old.environment
     or new.started_at <> old.started_at
     or new.created_at <> old.created_at then
    raise exception 'a subscription keeps its person, version and store reference' using errcode = '55000';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

create trigger trg_platform_subscriptions_guard
before update or delete on payments.platform_subscriptions
for each row execute function payments.platform_subscription_guard_tg();

-- ---------------------------------------------------------------------------
-- History and charges
-- ---------------------------------------------------------------------------

create table payments.platform_subscription_events (
  id uuid not null default extensions.uuid_generate_v7(),
  platform_subscription_id uuid not null,
  kind text not null,
  status payments.platform_subscription_status not null,
  auto_renews boolean not null,
  current_period_end timestamptz not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint pk_platform_subscription_events primary key (id),
  constraint fk_platform_subscription_events_subscription foreign key (platform_subscription_id) references payments.platform_subscriptions(id) on delete restrict,
  constraint ck_platform_subscription_events_kind check (kind in ('started', 'changed'))
);

create index idx_platform_subscription_events_subscription
  on payments.platform_subscription_events (platform_subscription_id, observed_at);

create table payments.platform_payment_records (
  id uuid not null default extensions.uuid_generate_v7(),
  platform_subscription_id uuid not null,
  person_id uuid not null,
  store payments.platform_store not null,
  store_transaction_id text not null,
  amount_minor bigint,
  currency_code text,
  result text not null,
  failure_code text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint pk_platform_payment_records primary key (id),
  constraint uq_platform_payment_records_transaction unique (store, store_transaction_id),
  constraint fk_platform_payment_records_subscription foreign key (platform_subscription_id, person_id) references payments.platform_subscriptions(id, person_id) on delete restrict,
  constraint ck_platform_payment_records_transaction check (char_length(store_transaction_id) between 1 and 200),
  constraint ck_platform_payment_records_amount check (amount_minor is null or amount_minor >= 0),
  constraint ck_platform_payment_records_currency check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  constraint ck_platform_payment_records_result check (result in ('succeeded', 'failed')),
  constraint ck_platform_payment_records_failure check (result = 'failed' or failure_code is null)
);

create index idx_platform_payment_records_subscription
  on payments.platform_payment_records (platform_subscription_id, person_id);
create index idx_platform_payment_records_person
  on payments.platform_payment_records (person_id, occurred_at);

create or replace function payments.platform_append_only_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end
$function$;

create trigger trg_platform_subscription_events_append_only
before update or delete on payments.platform_subscription_events
for each row execute function payments.platform_append_only_guard_tg();

create trigger trg_platform_payment_records_append_only
before update or delete on payments.platform_payment_records
for each row execute function payments.platform_append_only_guard_tg();

-- ---------------------------------------------------------------------------
-- Notification receipts
-- ---------------------------------------------------------------------------

create table payments.store_notification_receipts (
  id uuid not null default extensions.uuid_generate_v7(),
  store payments.platform_store not null,
  notification_id text not null,
  payload_hash bytea not null,
  outcome text not null,
  platform_subscription_id uuid,
  received_at timestamptz not null default clock_timestamp(),
  constraint pk_store_notification_receipts primary key (id),
  constraint uq_store_notification_receipts_notification unique (store, notification_id),
  constraint fk_store_notification_receipts_subscription foreign key (platform_subscription_id) references payments.platform_subscriptions(id) on delete restrict,
  constraint ck_store_notification_receipts_notification check (char_length(notification_id) between 1 and 200),
  constraint ck_store_notification_receipts_hash check (octet_length(payload_hash) = 32),
  constraint ck_store_notification_receipts_outcome check (outcome in ('processed', 'ignored', 'stale'))
);

create index idx_store_notification_receipts_subscription
  on payments.store_notification_receipts (platform_subscription_id);

-- ---------------------------------------------------------------------------
-- Row-level security: nobody but the owner reads or writes these tables
-- ---------------------------------------------------------------------------

alter table payments.platform_store_products enable row level security;
alter table payments.platform_store_products force row level security;
alter table payments.platform_subscriptions enable row level security;
alter table payments.platform_subscriptions force row level security;
alter table payments.platform_subscription_events enable row level security;
alter table payments.platform_subscription_events force row level security;
alter table payments.platform_payment_records enable row level security;
alter table payments.platform_payment_records force row level security;
alter table payments.store_notification_receipts enable row level security;
alter table payments.store_notification_receipts force row level security;

create policy platform_store_products_all_owner on payments.platform_store_products
  for all to allfit_owner using (true) with check (true);
create policy platform_subscriptions_all_owner on payments.platform_subscriptions
  for all to allfit_owner using (true) with check (true);
create policy platform_subscription_events_all_owner on payments.platform_subscription_events
  for all to allfit_owner using (true) with check (true);
create policy platform_payment_records_all_owner on payments.platform_payment_records
  for all to allfit_owner using (true) with check (true);
create policy store_notification_receipts_all_owner on payments.store_notification_receipts
  for all to allfit_owner using (true) with check (true);

revoke all on payments.platform_store_products, payments.platform_subscriptions,
  payments.platform_subscription_events, payments.platform_payment_records,
  payments.store_notification_receipts
  from public, allfit_api;

-- ---------------------------------------------------------------------------
-- Projections
-- ---------------------------------------------------------------------------

create or replace function payments.platform_version_features(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', feature.code, 'name', feature.name, 'unit', feature.unit,
        'enabled', limit_row.enabled, 'limit_value', limit_row.limit_value
      )
      order by feature.code
    ),
    '[]'::jsonb
  )
  from payments.platform_plan_features as limit_row
  join payments.platform_features as feature on feature.code = limit_row.feature_code
  where limit_row.platform_plan_version_id = p_version_id
$function$;

-- The source that decides a person's limits, and every source in force beside it.
create or replace function payments.resolve_pro(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  subscription payments.platform_subscriptions%rowtype;
  pro_version uuid;
  free_version uuid;
  gyms jsonb;
begin
  select * into subscription
  from payments.platform_subscriptions as live
  where live.person_id = p_person_id
    and (
      (live.status = 'active' and live.current_period_end > clock_timestamp())
      or (live.status = 'grace' and live.grace_until > clock_timestamp())
    );

  select version.id into pro_version
  from payments.platform_plan_versions as version
  join payments.platform_plans as plan on plan.id = version.platform_plan_id
  where plan.code = 'pro' and plan.plan_kind = 'paid' and version.status = 'published';

  select version.id into free_version
  from payments.platform_plan_versions as version
  join payments.platform_plans as plan on plan.id = version.platform_plan_id
  where plan.plan_kind = 'free' and version.status = 'published';

  select coalesce(
    jsonb_agg(
      jsonb_build_object('organization_id', organization.id, 'organization_name', organization.display_name)
      order by organization.display_name, organization.id
    ),
    '[]'::jsonb
  ) into gyms
  from relationships.service_relationships as relationship
  join organizations.organizations as organization on organization.id = relationship.organization_id
  where relationship.person_id = p_person_id
    and relationship.status = 'active'
    and organization.status = 'active';

  return jsonb_build_object(
    'effective_source', case
      when subscription.id is not null then 'subscription'
      when jsonb_array_length(gyms) > 0 and pro_version is not null then 'organization'
      else 'free'
    end,
    'version_id', case
      when subscription.id is not null then subscription.platform_plan_version_id
      when jsonb_array_length(gyms) > 0 and pro_version is not null then pro_version
      else free_version
    end,
    'organizations', gyms
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PAY-020 — my Pro and where it comes from
-- ---------------------------------------------------------------------------

create or replace function payments.read_my_pro(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  resolution jsonb;
  effective_version uuid;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() is distinct from p_person_id then
    raise exception 'Pro is read only by its own person' using errcode = '42501';
  end if;

  resolution := payments.resolve_pro(p_person_id);
  effective_version := (resolution->>'version_id')::uuid;

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'effective_source', resolution->>'effective_source',
    'is_pro', resolution->>'effective_source' <> 'free',
    'plan', (
      select jsonb_build_object(
        'id', plan.id, 'code', plan.code, 'name', plan.name, 'kind', plan.plan_kind,
        'version_id', version.id, 'version_number', version.version_number
      )
      from payments.platform_plan_versions as version
      join payments.platform_plans as plan on plan.id = version.platform_plan_id
      where version.id = effective_version
    ),
    'features', case when effective_version is null then '[]'::jsonb
                     else payments.platform_version_features(effective_version) end,
    'sources', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'kind', 'subscription', 'store', subscription.store, 'status', subscription.status,
            'auto_renews', subscription.auto_renews,
            'current_period_end', subscription.current_period_end,
            'grace_until', subscription.grace_until,
            'version_id', subscription.platform_plan_version_id
          )
        )
        from payments.platform_subscriptions as subscription
        where subscription.person_id = p_person_id and subscription.status <> 'ended'
      ),
      '[]'::jsonb
    ) || coalesce(
      (
        select jsonb_agg(gym || jsonb_build_object('kind', 'organization'))
        from jsonb_array_elements(resolution->'organizations') as gym_row(gym)
      ),
      '[]'::jsonb
    )
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PAY-018 — what each plan offers
-- ---------------------------------------------------------------------------

create or replace function payments.list_pro_plans(p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() is distinct from p_person_id then
    raise exception 'plans are read in one''s own name' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'plans', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', plan.id, 'code', plan.code, 'name', plan.name, 'kind', plan.plan_kind,
            'version_id', version.id, 'version_number', version.version_number,
            'amount_minor', version.amount_minor, 'currency_code', version.currency_code,
            'billing_period', version.billing_period,
            'features', payments.platform_version_features(version.id),
            'store_products', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object('store', product.store, 'product_id', product.product_id)
                  order by product.store, product.product_id
                )
                from payments.platform_store_products as product
                where product.platform_plan_version_id = version.id
              ),
              '[]'::jsonb
            )
          )
          order by plan.plan_kind = 'paid', plan.code
        )
        from payments.platform_plans as plan
        join payments.platform_plan_versions as version
          on version.platform_plan_id = plan.id and version.status = 'published'
      ),
      '[]'::jsonb
    )
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- Shared by the purchase and the notification: one subscription's state
-- ---------------------------------------------------------------------------

create or replace function payments.platform_subscription_record_charge(
  p_subscription payments.platform_subscriptions,
  p_change jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if nullif(p_change->>'transaction_id', '') is null then
    return;
  end if;
  insert into payments.platform_payment_records (
    platform_subscription_id, person_id, store, store_transaction_id,
    amount_minor, currency_code, result, occurred_at
  ) values (
    p_subscription.id, p_subscription.person_id, p_subscription.store, p_change->>'transaction_id',
    (p_change->>'amount_minor')::bigint, p_change->>'currency_code', 'succeeded',
    (p_change->>'observed_at')::timestamptz
  )
  on conflict on constraint uq_platform_payment_records_transaction do nothing;
end
$function$;

create or replace function payments.platform_subscription_event(
  p_subscription_id uuid,
  p_kind text
)
returns void
language sql
security definer
set search_path = pg_catalog
as $function$
  insert into payments.platform_subscription_events (
    platform_subscription_id, kind, status, auto_renews, current_period_end, observed_at
  )
  select subscription.id, p_kind, subscription.status, subscription.auto_renews,
         subscription.current_period_end, subscription.last_observed_at
  from payments.platform_subscriptions as subscription
  where subscription.id = p_subscription_id
$function$;

create or replace function payments.platform_subscription_open(
  p_person_id uuid,
  p_store payments.platform_store,
  p_change jsonb,
  p_environment text,
  p_ref text
)
returns payments.platform_subscriptions
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  product payments.platform_store_products%rowtype;
  opened payments.platform_subscriptions%rowtype;
  opening_status payments.platform_subscription_status;
begin
  select * into product
  from payments.platform_store_products as candidate
  where candidate.store = p_store and candidate.product_id = p_change->>'product_id';
  if product.product_id is null then
    raise exception 'Allfit does not sell this store product' using errcode = '22023';
  end if;

  opening_status := (p_change->>'status')::payments.platform_subscription_status;

  -- One live subscription per person: a new one replaces whatever was still open.
  update payments.platform_subscriptions
  set status = 'ended', ended_at = clock_timestamp(), ended_reason = 'replaced',
      grace_until = null
  where person_id = p_person_id and status <> 'ended';

  insert into payments.platform_subscriptions (
    person_id, platform_plan_version_id, store, store_product_id, store_subscription_ref,
    environment, status, auto_renews, current_period_end, grace_until, last_observed_at,
    suspended_at, ended_at, ended_reason
  ) values (
    p_person_id, product.platform_plan_version_id, p_store, product.product_id, p_ref,
    p_environment, opening_status, coalesce((p_change->>'auto_renews')::boolean, false),
    (p_change->>'current_period_end')::timestamptz,
    case when opening_status = 'grace' then (p_change->>'grace_until')::timestamptz end,
    (p_change->>'observed_at')::timestamptz,
    case when opening_status = 'suspended' then (p_change->>'observed_at')::timestamptz end,
    case when opening_status = 'ended' then (p_change->>'observed_at')::timestamptz end,
    case when opening_status = 'ended' then coalesce(p_change->>'ended_reason', 'expired') end
  )
  returning * into opened;

  perform payments.platform_subscription_event(opened.id, 'started');
  perform system.enqueue_outbox_event(
    'platform_subscription', opened.id, 'payments.platform_subscription_started.v1',
    jsonb_build_object(
      'platform_subscription_id', opened.id,
      'platform_plan_version_id', opened.platform_plan_version_id
    )
  );
  return opened;
end
$function$;

create or replace function payments.platform_subscription_move(
  p_subscription payments.platform_subscriptions,
  p_change jsonb
)
returns payments.platform_subscriptions
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  moved payments.platform_subscriptions%rowtype;
  next_status payments.platform_subscription_status := coalesce(
    (p_change->>'status')::payments.platform_subscription_status, p_subscription.status
  );
  observed timestamptz := (p_change->>'observed_at')::timestamptz;
  event_type text;
begin
  update payments.platform_subscriptions
  set status = next_status,
      auto_renews = coalesce((p_change->>'auto_renews')::boolean, p_subscription.auto_renews),
      current_period_end = coalesce(
        (p_change->>'current_period_end')::timestamptz, p_subscription.current_period_end
      ),
      grace_until = case when next_status = 'grace' then (p_change->>'grace_until')::timestamptz end,
      suspended_at = case when next_status = 'suspended'
                          then coalesce(p_subscription.suspended_at, observed) end,
      ended_at = case when next_status = 'ended' then observed end,
      ended_reason = case when next_status = 'ended'
                          then coalesce(p_change->>'ended_reason', 'expired') end,
      last_observed_at = observed
  where id = p_subscription.id
  returning * into moved;

  perform payments.platform_subscription_event(moved.id, 'changed');

  event_type := case
    when moved.status = p_subscription.status then null
    when moved.status = 'ended' then 'payments.platform_subscription_ended.v1'
    when moved.status = 'suspended' then 'payments.platform_subscription_suspended.v1'
    when p_subscription.status in ('suspended', 'ended') then 'payments.platform_subscription_reactivated.v1'
  end;
  if event_type is not null then
    perform system.enqueue_outbox_event(
      'platform_subscription', moved.id, event_type,
      jsonb_build_object('platform_subscription_id', moved.id)
    );
  end if;
  return moved;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PAY-019 — record a purchase the store already verified
-- ---------------------------------------------------------------------------

create or replace function payments.record_store_subscription(
  p_person_id uuid,
  p_purchase jsonb,
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
  chosen_store payments.platform_store;
  ref text := p_purchase->>'subscription_ref';
  current_row payments.platform_subscriptions%rowtype;
begin
  if access_control.actor_kind() <> 'person' or access_control.person() is distinct from p_person_id then
    raise exception 'a purchase is recorded only by its own person' using errcode = '42501';
  end if;

  select * into receipt from system.begin_idempotency(
    p_person_id, 'space'::system.command_surface, 'space',
    'OP-PAY-019', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select payments.read_my_pro(p_person_id), true;
    return;
  end if;

  if jsonb_typeof(p_purchase) is distinct from 'object'
     or not (p_purchase->>'store' = any (enum_range(null::payments.platform_store)::text[]))
     or not (p_purchase->>'status' = any (enum_range(null::payments.platform_subscription_status)::text[]))
     or nullif(ref, '') is null
     or p_purchase->>'current_period_end' is null
     or p_purchase->>'observed_at' is null then
    raise exception 'a purchase names its store, subscription, state and period' using errcode = '22023';
  end if;
  -- The app buys with the person's id as account token; any other token is someone else's.
  if p_purchase->>'account_token' is distinct from p_person_id::text then
    raise exception 'this purchase was made for another account' using errcode = '42501';
  end if;
  chosen_store := (p_purchase->>'store')::payments.platform_store;

  perform pg_advisory_xact_lock(hashtextextended('payments.platform_subscriptions:' || p_person_id::text, 0));

  if exists (
    select 1 from payments.platform_subscriptions as other
    where other.store = chosen_store and other.store_subscription_ref = ref
      and other.person_id <> p_person_id
  ) then
    raise exception 'this store subscription belongs to another person' using errcode = '23505';
  end if;

  select * into current_row
  from payments.platform_subscriptions as mine
  where mine.person_id = p_person_id and mine.store = chosen_store
    and mine.store_subscription_ref = ref and mine.status <> 'ended'
    and mine.store_product_id = p_purchase->>'product_id'
  for update;

  if current_row.id is null then
    current_row := payments.platform_subscription_open(
      p_person_id, chosen_store, p_purchase, coalesce(p_purchase->>'environment', 'production'), ref
    );
  elsif (p_purchase->>'observed_at')::timestamptz > current_row.last_observed_at then
    current_row := payments.platform_subscription_move(current_row, p_purchase);
  end if;

  perform payments.platform_subscription_record_charge(current_row, p_purchase);

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'pro-subscription-recorded', 'platform_subscription', current_row.id
  );
  return query select payments.read_my_pro(p_person_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PAY-023 — apply what a store notification says
-- ---------------------------------------------------------------------------

create or replace function payments.apply_store_notification(
  p_store text,
  p_notification_id text,
  p_payload_hash bytea,
  p_change jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  notified_store payments.platform_store;
  receipt_id uuid;
  earlier payments.store_notification_receipts%rowtype;
  subscription payments.platform_subscriptions%rowtype;
  observed timestamptz;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'only the store notification consumer reports what a store says' using errcode = '42501';
  end if;
  if not (p_store = any (enum_range(null::payments.platform_store)::text[]))
     or nullif(p_notification_id, '') is null
     or octet_length(p_payload_hash) is distinct from 32 then
    raise exception 'a notification names its store, its id and its hash' using errcode = '22023';
  end if;
  notified_store := p_store::payments.platform_store;

  insert into payments.store_notification_receipts (store, notification_id, payload_hash, outcome)
  values (notified_store, p_notification_id, p_payload_hash, 'ignored')
  on conflict on constraint uq_store_notification_receipts_notification do nothing
  returning id into receipt_id;

  if receipt_id is null then
    select * into earlier
    from payments.store_notification_receipts as receipt
    where receipt.store = notified_store and receipt.notification_id = p_notification_id;
    if earlier.payload_hash <> p_payload_hash then
      raise exception 'one notification id never carries two contents' using errcode = '23505';
    end if;
    return 'replayed';
  end if;

  observed := (p_change->>'observed_at')::timestamptz;
  if observed is null then
    raise exception 'a notification says when the store observed it' using errcode = '22023';
  end if;

  select * into subscription
  from payments.platform_subscriptions as candidate
  where candidate.store = notified_store and candidate.store_subscription_ref = p_change->>'subscription_ref'
  order by candidate.status <> 'ended' desc, candidate.started_at desc
  limit 1
  for update;

  if subscription.id is null then
    return 'ignored';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('payments.platform_subscriptions:' || subscription.person_id::text, 0)
  );

  if observed <= subscription.last_observed_at then
    update payments.store_notification_receipts
    set outcome = 'stale', platform_subscription_id = subscription.id
    where id = receipt_id;
    return 'stale';
  end if;

  -- A different product is a different version: the old subscription ends, a new one opens.
  if p_change ? 'product_id' and p_change->>'product_id' <> subscription.store_product_id then
    subscription := payments.platform_subscription_open(
      subscription.person_id, notified_store, p_change, subscription.environment,
      subscription.store_subscription_ref
    );
  else
    subscription := payments.platform_subscription_move(subscription, p_change);
  end if;

  perform payments.platform_subscription_record_charge(subscription, p_change);

  update payments.store_notification_receipts
  set outcome = 'processed', platform_subscription_id = subscription.id
  where id = receipt_id;
  return 'processed';
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter table payments.platform_store_products owner to allfit_owner;
alter table payments.platform_subscriptions owner to allfit_owner;
alter table payments.platform_subscription_events owner to allfit_owner;
alter table payments.platform_payment_records owner to allfit_owner;
alter table payments.store_notification_receipts owner to allfit_owner;

alter function payments.platform_store_product_guard_tg() owner to allfit_owner;
alter function payments.platform_subscription_guard_tg() owner to allfit_owner;
alter function payments.platform_append_only_guard_tg() owner to allfit_owner;
alter function payments.platform_version_features(uuid) owner to allfit_owner;
alter function payments.resolve_pro(uuid) owner to allfit_owner;
alter function payments.read_my_pro(uuid) owner to allfit_owner;
alter function payments.list_pro_plans(uuid) owner to allfit_owner;
alter function payments.platform_subscription_record_charge(payments.platform_subscriptions, jsonb) owner to allfit_owner;
alter function payments.platform_subscription_event(uuid, text) owner to allfit_owner;
alter function payments.platform_subscription_open(uuid, payments.platform_store, jsonb, text, text) owner to allfit_owner;
alter function payments.platform_subscription_move(payments.platform_subscriptions, jsonb) owner to allfit_owner;
alter function payments.record_store_subscription(uuid, jsonb, uuid, uuid, bytea) owner to allfit_owner;
alter function payments.apply_store_notification(text, text, bytea, jsonb) owner to allfit_owner;

revoke all on function payments.platform_store_product_guard_tg() from public;
revoke all on function payments.platform_subscription_guard_tg() from public;
revoke all on function payments.platform_append_only_guard_tg() from public;
revoke all on function payments.platform_version_features(uuid) from public;
revoke all on function payments.resolve_pro(uuid) from public;
revoke all on function payments.read_my_pro(uuid) from public;
revoke all on function payments.list_pro_plans(uuid) from public;
revoke all on function payments.platform_subscription_record_charge(payments.platform_subscriptions, jsonb) from public;
revoke all on function payments.platform_subscription_event(uuid, text) from public;
revoke all on function payments.platform_subscription_open(uuid, payments.platform_store, jsonb, text, text) from public;
revoke all on function payments.platform_subscription_move(payments.platform_subscriptions, jsonb) from public;
revoke all on function payments.record_store_subscription(uuid, jsonb, uuid, uuid, bytea) from public;
revoke all on function payments.apply_store_notification(text, text, bytea, jsonb) from public;

grant execute on function payments.read_my_pro(uuid) to allfit_api;
grant execute on function payments.list_pro_plans(uuid) to allfit_api;
grant execute on function payments.record_store_subscription(uuid, jsonb, uuid, uuid, bytea) to allfit_api;
grant execute on function payments.apply_store_notification(text, text, bytea, jsonb) to allfit_api;
