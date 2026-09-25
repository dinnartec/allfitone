-- NEW-PAY-PLATFORM-PLAN, OP-PAY-017 and OP-PAY-024..026 — the plans Allfit sells to people
-- (`HU-BO-025`, `HU-BO-026`).
--
-- The first objects of `payments`, and only the catalogue: which plans exist, what each
-- version costs and what it includes. Nothing here charges anybody, holds a card or talks
-- to a gateway — `payments` reflects the state of a payment, it never processes one — and
-- resolving where a person's Premium comes from (DB-P5-008) stays undecided on purpose:
-- publishing the catalogue does not need it.
--
-- **A published version never changes.** A subscription will point at an exact version,
-- so whoever subscribed keeps what they accepted. A price or a limit changes by
-- publishing another version, which retires the one in force; triggers refuse every
-- other edit and every deletion.
--
-- **Two people publish.** One proposes a version, somebody else publishes it, and the
-- proposal carries what changes against the version it would replace. Every version
-- needs the second pair of eyes — the first one sets a price too — and a proposal that
-- changes nothing is refused, because there is nothing to review. A plan has one
-- proposal open at a time, so the version a reviewer compares against is still the one
-- in force when they publish. Each step keeps its author and the duty assignment it was
-- taken under.
--
-- **The free plan is a plan.** It is published here at zero, with no currency and no
-- billing period, and its limits are data like any other. There is one free plan, ever:
-- what changes is its versions, not which plan is free. That is stricter than "one
-- published free plan", and it is what makes the stricter rule unnecessary.
--
-- **The feature catalogue changes only by migration.** A limit means something only when
-- code enforces it, so a function enters `payments.platform_features` together with the
-- code that honours it — and product has deliberately not decided the list yet, so it
-- ships empty. A version declares every function in the catalogue, enabled or not, so
-- nothing is left to guess. No privacy, consent, portability or erasure function can
-- enter the catalogue: a check refuses the codes that name one.
--
-- A price list is nobody's data, so no access is recorded.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists payments authorization allfit_owner;

revoke all on schema payments from public;
grant usage on schema payments to allfit_api;

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

create table payments.platform_plans (
  id uuid not null default extensions.uuid_generate_v7(),
  code text not null,
  name text not null,
  plan_kind text not null,
  status catalog.publication_status not null default 'draft',
  created_by_person_id uuid not null,
  created_by_duty_assignment_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_platform_plans primary key (id),
  constraint uq_platform_plans_code unique (code),
  -- Carries the kind into each version, so the price rule can be a plain check there.
  constraint uq_platform_plans_kind unique (id, plan_kind),
  constraint fk_platform_plans_creator foreign key (created_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_plans_duty foreign key (created_by_duty_assignment_id) references support.platform_duty_assignments(id) on delete restrict,
  constraint ck_platform_plans_code check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint ck_platform_plans_name check (
    btrim(name) <> '' and name = btrim(name) and char_length(name) <= 80
  ),
  constraint ck_platform_plans_kind check (plan_kind in ('free', 'paid')),
  -- A plan is a draft until its first version is published. Retiring a plan is not part
  -- of these stories, so neither state exists yet.
  constraint ck_platform_plans_status check (status in ('draft', 'published'))
);

create unique index uidx_platform_plans_single_free
  on payments.platform_plans (plan_kind)
  where plan_kind = 'free';

create index idx_platform_plans_creator on payments.platform_plans (created_by_person_id);
create index idx_platform_plans_duty on payments.platform_plans (created_by_duty_assignment_id);

create or replace function payments.platform_plan_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a platform plan is never deleted' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.code is distinct from old.code
     or new.name is distinct from old.name
     or new.plan_kind is distinct from old.plan_kind
     or new.created_by_person_id is distinct from old.created_by_person_id
     or new.created_by_duty_assignment_id is distinct from old.created_by_duty_assignment_id
     or new.created_at is distinct from old.created_at then
    raise exception 'a platform plan keeps its code, name, kind and author' using errcode = '55000';
  end if;
  if old.status = 'published' and new.status is distinct from old.status then
    raise exception 'a published platform plan stays published' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_platform_plans_guard
before update or delete on payments.platform_plans
for each row execute function payments.platform_plan_guard_tg();

-- ---------------------------------------------------------------------------
-- Versions
-- ---------------------------------------------------------------------------

create table payments.platform_plan_versions (
  id uuid not null default extensions.uuid_generate_v7(),
  platform_plan_id uuid not null,
  plan_kind text not null,
  version_number integer not null,
  amount_minor bigint not null,
  currency_code text,
  billing_period text,
  status catalog.publication_status not null default 'draft',
  supersedes_version_id uuid,
  proposed_by_person_id uuid not null,
  proposed_by_duty_assignment_id uuid not null,
  proposed_at timestamptz not null default clock_timestamp(),
  published_by_person_id uuid,
  published_by_duty_assignment_id uuid,
  published_at timestamptz,
  deprecated_at timestamptz,
  withdrawn_by_person_id uuid,
  withdrawn_by_duty_assignment_id uuid,
  withdrawn_at timestamptz,
  constraint pk_platform_plan_versions primary key (id),
  constraint uq_platform_plan_versions_number unique (platform_plan_id, version_number),
  constraint uq_platform_plan_versions_plan unique (id, platform_plan_id),
  constraint fk_platform_plan_versions_plan foreign key (platform_plan_id, plan_kind) references payments.platform_plans(id, plan_kind) on delete restrict,
  constraint fk_platform_plan_versions_supersedes foreign key (supersedes_version_id, platform_plan_id) references payments.platform_plan_versions(id, platform_plan_id) on delete restrict,
  constraint fk_platform_plan_versions_proposer foreign key (proposed_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_plan_versions_proposer_duty foreign key (proposed_by_duty_assignment_id) references support.platform_duty_assignments(id) on delete restrict,
  constraint fk_platform_plan_versions_publisher foreign key (published_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_plan_versions_publisher_duty foreign key (published_by_duty_assignment_id) references support.platform_duty_assignments(id) on delete restrict,
  constraint fk_platform_plan_versions_withdrawer foreign key (withdrawn_by_person_id) references identity.people(id) on delete restrict,
  constraint fk_platform_plan_versions_withdrawer_duty foreign key (withdrawn_by_duty_assignment_id) references support.platform_duty_assignments(id) on delete restrict,
  constraint ck_platform_plan_versions_number check (version_number > 0),
  constraint ck_platform_plan_versions_currency check (
    currency_code is null or currency_code ~ '^[A-Z]{3}$'
  ),
  -- IX-41: a paid version costs something, in a currency, every month or year; the free
  -- plan costs nothing and has neither.
  constraint ck_platform_plan_versions_price check (
    (plan_kind = 'paid'
      and amount_minor > 0 and amount_minor <= 100000000000
      and currency_code is not null
      and billing_period in ('month', 'year'))
    or (plan_kind = 'free'
      and amount_minor = 0
      and currency_code is null
      and billing_period is null)
  ),
  constraint ck_platform_plan_versions_status check (
    status in ('draft', 'published', 'deprecated', 'archived')
  ),
  constraint ck_platform_plan_versions_review check (
    published_by_person_id is null or published_by_person_id <> proposed_by_person_id
  ),
  constraint ck_platform_plan_versions_lifecycle check (
    (published_at is not null)
      = (published_by_person_id is not null and published_by_duty_assignment_id is not null)
    and (withdrawn_at is not null)
      = (withdrawn_by_person_id is not null and withdrawn_by_duty_assignment_id is not null)
    and (
      (status = 'draft' and published_at is null and withdrawn_at is null and deprecated_at is null)
      or (status = 'published' and published_at is not null and withdrawn_at is null
        and deprecated_at is null)
      or (status = 'deprecated' and published_at is not null and withdrawn_at is null
        and deprecated_at is not null)
      or (status = 'archived' and published_at is null and withdrawn_at is not null
        and deprecated_at is null)
    )
  )
);

-- One version in force, and one proposal open, per plan.
create unique index uidx_platform_plan_versions_published
  on payments.platform_plan_versions (platform_plan_id)
  where status = 'published';
create unique index uidx_platform_plan_versions_proposal
  on payments.platform_plan_versions (platform_plan_id)
  where status = 'draft';

create index idx_platform_plan_versions_supersedes
  on payments.platform_plan_versions (supersedes_version_id, platform_plan_id);
create index idx_platform_plan_versions_plan_kind
  on payments.platform_plan_versions (platform_plan_id, plan_kind);
create index idx_platform_plan_versions_proposer
  on payments.platform_plan_versions (proposed_by_person_id);
create index idx_platform_plan_versions_proposer_duty
  on payments.platform_plan_versions (proposed_by_duty_assignment_id);
create index idx_platform_plan_versions_publisher
  on payments.platform_plan_versions (published_by_person_id);
create index idx_platform_plan_versions_publisher_duty
  on payments.platform_plan_versions (published_by_duty_assignment_id);
create index idx_platform_plan_versions_withdrawer
  on payments.platform_plan_versions (withdrawn_by_person_id);
create index idx_platform_plan_versions_withdrawer_duty
  on payments.platform_plan_versions (withdrawn_by_duty_assignment_id);

create or replace function payments.platform_plan_version_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a plan version is never deleted' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.platform_plan_id is distinct from old.platform_plan_id
     or new.plan_kind is distinct from old.plan_kind
     or new.version_number is distinct from old.version_number
     or new.amount_minor is distinct from old.amount_minor
     or new.currency_code is distinct from old.currency_code
     or new.billing_period is distinct from old.billing_period
     or new.supersedes_version_id is distinct from old.supersedes_version_id
     or new.proposed_by_person_id is distinct from old.proposed_by_person_id
     or new.proposed_by_duty_assignment_id is distinct from old.proposed_by_duty_assignment_id
     or new.proposed_at is distinct from old.proposed_at then
    raise exception 'a plan version never changes what it offers or who proposed it'
      using errcode = '55000';
  end if;
  -- Forward only: a proposal is published or withdrawn, and a published version is
  -- retired by the next one. Nothing returns, and a finished step is never rewritten.
  if not (
    (old.status = 'draft' and new.status in ('published', 'archived'))
    or (old.status = 'published' and new.status = 'deprecated'
      and new.published_by_person_id is not distinct from old.published_by_person_id
      and new.published_by_duty_assignment_id is not distinct from old.published_by_duty_assignment_id
      and new.published_at is not distinct from old.published_at)
  ) then
    raise exception 'a plan version only moves forward' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_platform_plan_versions_guard
before update or delete on payments.platform_plan_versions
for each row execute function payments.platform_plan_version_guard_tg();

-- ---------------------------------------------------------------------------
-- Functions a plan can limit
-- ---------------------------------------------------------------------------

create table payments.platform_features (
  code text not null,
  name text not null,
  unit text,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_platform_features primary key (code),
  constraint ck_platform_features_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_platform_features_name check (
    btrim(name) <> '' and name = btrim(name) and char_length(name) <= 120
  ),
  constraint ck_platform_features_unit check (unit is null or unit ~ '^[a-z][a-z_]{0,31}$'),
  -- Controlling one's own data is never for sale (HU-BO-025 criterion 4).
  constraint ck_platform_features_not_privacy check (
    code !~ '(privacy|consent|grant|permission|access_(log|history|event)|portab|export|erasure|delet|supres|disposition|legal_hold)'
  )
);

create table payments.platform_plan_features (
  id uuid not null default extensions.uuid_generate_v7(),
  platform_plan_version_id uuid not null,
  feature_code text not null,
  limit_value integer,
  enabled boolean not null,
  constraint pk_platform_plan_features primary key (id),
  constraint uq_platform_plan_features_version unique (platform_plan_version_id, feature_code),
  constraint fk_platform_plan_features_version foreign key (platform_plan_version_id) references payments.platform_plan_versions(id) on delete cascade,
  constraint fk_platform_plan_features_feature foreign key (feature_code) references payments.platform_features(code) on delete restrict,
  -- Null is unlimited; a function left out of the plan has nothing to limit.
  constraint ck_platform_plan_features_limit check (limit_value is null or limit_value >= 0),
  constraint ck_platform_plan_features_disabled check (enabled or limit_value is null)
);

create index idx_platform_plan_features_feature
  on payments.platform_plan_features (feature_code);

create or replace function payments.platform_plan_feature_guard_tg()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from payments.platform_plan_versions as version
      where version.id = new.platform_plan_version_id
        and version.status = 'draft'
    ) then
      raise exception 'a function is declared only while its version is a proposal'
        using errcode = '55000';
    end if;
    return new;
  end if;
  raise exception 'a declared function never changes' using errcode = '55000';
end
$function$;

create trigger trg_platform_plan_features_guard
before insert or update or delete on payments.platform_plan_features
for each row execute function payments.platform_plan_feature_guard_tg();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table payments.platform_plans enable row level security;
alter table payments.platform_plans force row level security;
alter table payments.platform_plan_versions enable row level security;
alter table payments.platform_plan_versions force row level security;
alter table payments.platform_features enable row level security;
alter table payments.platform_features force row level security;
alter table payments.platform_plan_features enable row level security;
alter table payments.platform_plan_features force row level security;

create policy platform_plans_all_owner
  on payments.platform_plans
  for all to allfit_owner using (true) with check (true);

create policy platform_plan_versions_all_owner
  on payments.platform_plan_versions
  for all to allfit_owner using (true) with check (true);

create policy platform_features_all_owner
  on payments.platform_features
  for all to allfit_owner using (true) with check (true);

create policy platform_plan_features_all_owner
  on payments.platform_plan_features
  for all to allfit_owner using (true) with check (true);

create or replace function payments.require_platform_commercial_manager(
  p_actor_person_id uuid,
  p_actor_session_id uuid
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
  if access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
     and access_control.has_platform_duty(
       p_actor_person_id, p_actor_session_id, 'manage_platform_commercial'
     ) then
    select assignment.id into assignment_id
    from support.platform_duty_assignments as assignment
    where assignment.person_id = p_actor_person_id
      and assignment.duty_code = 'manage_platform_commercial'
      and assignment.status = 'active'
      and clock_timestamp() >= assignment.valid_from
      and clock_timestamp() < assignment.valid_to
    order by assignment.valid_to desc
    limit 1;
  end if;

  if assignment_id is null then
    raise exception 'managing Allfit''s plans requires an effective commercial duty'
      using errcode = '42501';
  end if;
  return assignment_id;
end
$function$;

-- ---------------------------------------------------------------------------
-- Projections
-- ---------------------------------------------------------------------------

-- What a version changes against another, field by field. The reviewer reads this
-- rather than two versions side by side.
create or replace function payments.platform_plan_version_changes(
  p_before_id uuid,
  p_after_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  with pair as (
    select
      before_version.amount_minor as before_amount,
      after_version.amount_minor as after_amount,
      before_version.currency_code as before_currency,
      after_version.currency_code as after_currency,
      before_version.billing_period as before_period,
      after_version.billing_period as after_period
    from payments.platform_plan_versions as before_version,
         payments.platform_plan_versions as after_version
    where before_version.id = p_before_id
      and after_version.id = p_after_id
  ),
  before_features as (
    select feature.feature_code,
           jsonb_build_object('enabled', feature.enabled, 'limit_value', feature.limit_value) as state
    from payments.platform_plan_features as feature
    where feature.platform_plan_version_id = p_before_id
  ),
  after_features as (
    select feature.feature_code,
           jsonb_build_object('enabled', feature.enabled, 'limit_value', feature.limit_value) as state
    from payments.platform_plan_features as feature
    where feature.platform_plan_version_id = p_after_id
  ),
  changes as (
    select 'amount_minor'::text as field, null::text as feature_code,
           to_jsonb(pair.before_amount) as before_value, to_jsonb(pair.after_amount) as after_value
    from pair where pair.before_amount is distinct from pair.after_amount
    union all
    select 'currency_code', null, to_jsonb(pair.before_currency), to_jsonb(pair.after_currency)
    from pair where pair.before_currency is distinct from pair.after_currency
    union all
    select 'billing_period', null, to_jsonb(pair.before_period), to_jsonb(pair.after_period)
    from pair where pair.before_period is distinct from pair.after_period
    union all
    select 'feature', coalesce(before_feature.feature_code, after_feature.feature_code),
           before_feature.state, after_feature.state
    from before_features as before_feature
    full join after_features as after_feature
      on after_feature.feature_code = before_feature.feature_code
    where before_feature.state is distinct from after_feature.state
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'field', changes.field,
        'feature_code', changes.feature_code,
        'before', changes.before_value,
        'after', changes.after_value
      )
      order by changes.field, changes.feature_code
    ),
    '[]'::jsonb
  )
  from changes
$function$;

create or replace function payments.platform_plan_version_projection(
  p_version_id uuid,
  p_actor_person_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', version.id,
    'version_number', version.version_number,
    'status', version.status,
    'amount_minor', version.amount_minor,
    'currency_code', version.currency_code,
    'billing_period', version.billing_period,
    'features', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'feature_code', feature.feature_code,
            'enabled', feature.enabled,
            'limit_value', feature.limit_value
          )
          order by feature.feature_code
        )
        from payments.platform_plan_features as feature
        where feature.platform_plan_version_id = version.id
      ),
      '[]'::jsonb
    ),
    'supersedes_version_id', version.supersedes_version_id,
    'changes', case
      when version.supersedes_version_id is null then null
      else payments.platform_plan_version_changes(version.supersedes_version_id, version.id)
    end,
    'proposed_by_person_id', version.proposed_by_person_id,
    'proposed_by_self', version.proposed_by_person_id = p_actor_person_id,
    'proposed_at', version.proposed_at,
    'published_by_person_id', version.published_by_person_id,
    'published_at', version.published_at,
    'deprecated_at', version.deprecated_at,
    'withdrawn_by_person_id', version.withdrawn_by_person_id,
    'withdrawn_at', version.withdrawn_at
  )
  from payments.platform_plan_versions as version
  where version.id = p_version_id
$function$;

create or replace function payments.platform_plan_projection(
  p_plan_id uuid,
  p_actor_person_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', plan.id,
    'code', plan.code,
    'name', plan.name,
    'plan_kind', plan.plan_kind,
    'status', plan.status,
    'created_by_person_id', plan.created_by_person_id,
    'created_at', plan.created_at,
    'current_version', (
      select payments.platform_plan_version_projection(version.id, p_actor_person_id)
      from payments.platform_plan_versions as version
      where version.platform_plan_id = plan.id and version.status = 'published'
    ),
    'proposal', (
      select payments.platform_plan_version_projection(version.id, p_actor_person_id)
      from payments.platform_plan_versions as version
      where version.platform_plan_id = plan.id and version.status = 'draft'
    ),
    'history', coalesce(
      (
        select jsonb_agg(
          payments.platform_plan_version_projection(version.id, p_actor_person_id)
          order by version.version_number desc
        )
        from payments.platform_plan_versions as version
        where version.platform_plan_id = plan.id
      ),
      '[]'::jsonb
    )
  )
  from payments.platform_plans as plan
  where plan.id = p_plan_id
$function$;

-- ---------------------------------------------------------------------------
-- NEW-PAY-PLATFORM-PLAN — the read
-- ---------------------------------------------------------------------------

create or replace function payments.list_platform_plans(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform payments.require_platform_commercial_manager(p_actor_person_id, p_actor_session_id);

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'feature_catalog', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('code', feature.code, 'name', feature.name, 'unit', feature.unit)
          order by feature.code
        )
        from payments.platform_features as feature
      ),
      '[]'::jsonb
    ),
    'plans', coalesce(
      (
        select jsonb_agg(
          payments.platform_plan_projection(plan.id, p_actor_person_id)
          order by plan.plan_kind = 'paid', plan.code
        )
        from payments.platform_plans as plan
      ),
      '[]'::jsonb
    )
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PAY-024 — create a plan
-- ---------------------------------------------------------------------------

create or replace function payments.create_platform_plan(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_code text,
  p_name text,
  p_plan_kind text,
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
  plan_id uuid;
begin
  duty_id := payments.require_platform_commercial_manager(p_actor_person_id, p_actor_session_id);
  if coalesce(p_code, '') !~ '^[a-z][a-z0-9_]{1,39}$'
     or btrim(coalesce(p_name, '')) = ''
     or char_length(btrim(p_name)) > 80
     or coalesce(p_plan_kind, '') not in ('free', 'paid') then
    raise exception 'a plan needs a stable code, a name and a kind' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-PAY-024', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent plan creation not found' using errcode = '40001';
    end if;
    return query select payments.platform_plan_projection(receipt.aggregate_id, p_actor_person_id), true;
    return;
  end if;

  -- A taken code or a second free plan is a unique violation, answered as a conflict.
  insert into payments.platform_plans (
    code, name, plan_kind, created_by_person_id, created_by_duty_assignment_id
  ) values (
    p_code, btrim(p_name), p_plan_kind, p_actor_person_id, duty_id
  )
  returning id into plan_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'platform-plan-created', 'platform_plan', plan_id
  );
  return query select payments.platform_plan_projection(plan_id, p_actor_person_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PAY-025 — propose a version
-- ---------------------------------------------------------------------------

create or replace function payments.propose_platform_plan_version(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_platform_plan_id uuid,
  p_amount_minor bigint,
  p_currency_code text,
  p_billing_period text,
  p_features jsonb,
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
  target payments.platform_plans%rowtype;
  in_force_id uuid;
  next_number integer;
  version_id uuid;
begin
  duty_id := payments.require_platform_commercial_manager(p_actor_person_id, p_actor_session_id);

  select * into target from payments.platform_plans as plan where plan.id = p_platform_plan_id;
  if target.id is null then
    raise exception 'platform plan not found' using errcode = 'P0002';
  end if;

  if target.plan_kind = 'free' then
    if p_amount_minor is distinct from 0 or p_currency_code is not null or p_billing_period is not null then
      raise exception 'the free plan costs nothing and has no billing period' using errcode = '22023';
    end if;
  elsif coalesce(p_amount_minor, 0) <= 0
     or p_amount_minor > 100000000000
     or coalesce(p_currency_code, '') !~ '^[A-Z]{3}$'
     or coalesce(p_billing_period, '') not in ('month', 'year') then
    raise exception 'a paid plan has a price, an ISO 4217 currency and a monthly or yearly period'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_features) is distinct from 'array' then
    raise exception 'a version declares its functions as a list' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_features) as entry
    where jsonb_typeof(entry) <> 'object'
       or coalesce(jsonb_typeof(entry->'feature_code'), 'missing') <> 'string'
       or coalesce(jsonb_typeof(entry->'enabled'), 'missing') <> 'boolean'
       or coalesce(jsonb_typeof(entry->'limit_value'), 'null') not in ('number', 'null')
       or (jsonb_typeof(entry->'limit_value') = 'number'
         and ((entry->>'limit_value')::numeric < 0
           or (entry->>'limit_value')::numeric > 2147483647
           or (entry->>'limit_value')::numeric <> trunc((entry->>'limit_value')::numeric)
           or not (entry->>'enabled')::boolean))
  ) then
    raise exception 'each function is enabled or not, with a whole, non-negative limit only when enabled'
      using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct entry->>'feature_code')
      from jsonb_array_elements(p_features) as entry) then
    raise exception 'a function is declared once' using errcode = '22023';
  end if;
  -- The catalogue is closed: nothing outside it, and nothing in it left unsaid.
  if exists (
    select 1 from jsonb_array_elements(p_features) as entry
    where not exists (
      select 1 from payments.platform_features as feature
      where feature.code = entry->>'feature_code'
    )
  ) or exists (
    select 1 from payments.platform_features as feature
    where not exists (
      select 1 from jsonb_array_elements(p_features) as entry
      where entry->>'feature_code' = feature.code
    )
  ) then
    raise exception 'a version declares exactly the functions in the catalogue' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-PAY-025', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent plan proposal not found' using errcode = '40001';
    end if;
    return query select payments.platform_plan_projection(target.id, p_actor_person_id), true;
    return;
  end if;

  perform 1 from payments.platform_plans as plan where plan.id = target.id for update;

  if exists (
    select 1 from payments.platform_plan_versions as version
    where version.platform_plan_id = target.id and version.status = 'draft'
  ) then
    raise exception 'a plan has one proposal open at a time' using errcode = '55000';
  end if;

  select version.id into in_force_id
  from payments.platform_plan_versions as version
  where version.platform_plan_id = target.id and version.status = 'published';

  select coalesce(max(version.version_number), 0) + 1 into next_number
  from payments.platform_plan_versions as version
  where version.platform_plan_id = target.id;

  insert into payments.platform_plan_versions (
    platform_plan_id, plan_kind, version_number, amount_minor, currency_code, billing_period,
    supersedes_version_id, proposed_by_person_id, proposed_by_duty_assignment_id
  ) values (
    target.id, target.plan_kind, next_number, p_amount_minor, p_currency_code, p_billing_period,
    in_force_id, p_actor_person_id, duty_id
  )
  returning id into version_id;

  insert into payments.platform_plan_features (
    platform_plan_version_id, feature_code, limit_value, enabled
  )
  select version_id,
         entry->>'feature_code',
         (entry->>'limit_value')::integer,
         (entry->>'enabled')::boolean
  from jsonb_array_elements(p_features) as entry;

  if in_force_id is not null
     and payments.platform_plan_version_changes(in_force_id, version_id) = '[]'::jsonb then
    raise exception 'a proposal that changes nothing has nothing to review' using errcode = '55000';
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'platform-plan-version-proposed',
    'platform_plan_version', version_id
  );
  return query select payments.platform_plan_projection(target.id, p_actor_person_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PAY-017 — publish a proposal somebody else made
-- ---------------------------------------------------------------------------

create or replace function payments.publish_platform_plan_version(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_platform_plan_id uuid,
  p_version_id uuid,
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
  plan_status catalog.publication_status;
  proposal payments.platform_plan_versions%rowtype;
  in_force_id uuid;
begin
  duty_id := payments.require_platform_commercial_manager(p_actor_person_id, p_actor_session_id);

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-PAY-017', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent plan publication not found' using errcode = '40001';
    end if;
    return query select payments.platform_plan_projection(p_platform_plan_id, p_actor_person_id), true;
    return;
  end if;

  select plan.status into plan_status
  from payments.platform_plans as plan
  where plan.id = p_platform_plan_id
  for update;
  if plan_status is null then
    raise exception 'platform plan not found' using errcode = 'P0002';
  end if;

  select * into proposal
  from payments.platform_plan_versions as version
  where version.id = p_version_id and version.platform_plan_id = p_platform_plan_id
  for update;
  if proposal.id is null then
    raise exception 'plan version not found' using errcode = 'P0002';
  end if;
  if proposal.status <> 'draft' then
    raise exception 'only an open proposal is published' using errcode = '55000';
  end if;
  if proposal.proposed_by_person_id = p_actor_person_id then
    raise exception 'a plan version is published by somebody other than who proposed it'
      using errcode = '42501';
  end if;

  select version.id into in_force_id
  from payments.platform_plan_versions as version
  where version.platform_plan_id = p_platform_plan_id and version.status = 'published'
  for update;

  if in_force_id is not null then
    update payments.platform_plan_versions as version
    set status = 'deprecated', deprecated_at = clock_timestamp()
    where version.id = in_force_id;
  end if;

  update payments.platform_plan_versions as version
  set status = 'published',
      published_at = clock_timestamp(),
      published_by_person_id = p_actor_person_id,
      published_by_duty_assignment_id = duty_id
  where version.id = proposal.id;

  if plan_status = 'draft' then
    update payments.platform_plans as plan
    set status = 'published'
    where plan.id = p_platform_plan_id;

    perform system.enqueue_outbox_event(
      'platform_plan', p_platform_plan_id, 'payments.platform_plan_published.v1',
      jsonb_build_object('platform_plan_id', p_platform_plan_id)
    );
  end if;

  perform system.enqueue_outbox_event(
    'platform_plan_version', proposal.id, 'payments.platform_plan_version_published.v1',
    jsonb_build_object(
      'platform_plan_id', p_platform_plan_id,
      'platform_plan_version_id', proposal.id,
      'version_number', proposal.version_number,
      'supersedes_version_id', in_force_id
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'platform-plan-version-published',
    'platform_plan_version', proposal.id
  );
  return query select payments.platform_plan_projection(p_platform_plan_id, p_actor_person_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-PAY-026 — withdraw a proposal
-- ---------------------------------------------------------------------------

create or replace function payments.withdraw_platform_plan_version(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_platform_plan_id uuid,
  p_version_id uuid,
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
  proposal payments.platform_plan_versions%rowtype;
begin
  duty_id := payments.require_platform_commercial_manager(p_actor_person_id, p_actor_session_id);

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-PAY-026', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent plan withdrawal not found' using errcode = '40001';
    end if;
    return query select payments.platform_plan_projection(p_platform_plan_id, p_actor_person_id), true;
    return;
  end if;

  perform 1 from payments.platform_plans as plan where plan.id = p_platform_plan_id for update;

  select * into proposal
  from payments.platform_plan_versions as version
  where version.id = p_version_id and version.platform_plan_id = p_platform_plan_id
  for update;
  if proposal.id is null then
    raise exception 'plan version not found' using errcode = 'P0002';
  end if;
  if proposal.status <> 'draft' then
    raise exception 'only an open proposal is withdrawn' using errcode = '55000';
  end if;

  -- The proposer changing their mind and a reviewer who disagrees end the same way.
  update payments.platform_plan_versions as version
  set status = 'archived',
      withdrawn_at = clock_timestamp(),
      withdrawn_by_person_id = p_actor_person_id,
      withdrawn_by_duty_assignment_id = duty_id
  where version.id = proposal.id;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'platform-plan-version-withdrawn',
    'platform_plan_version', proposal.id
  );
  return query select payments.platform_plan_projection(p_platform_plan_id, p_actor_person_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter table payments.platform_plans owner to allfit_owner;
alter table payments.platform_plan_versions owner to allfit_owner;
alter table payments.platform_features owner to allfit_owner;
alter table payments.platform_plan_features owner to allfit_owner;

alter function payments.platform_plan_guard_tg() owner to allfit_owner;
alter function payments.platform_plan_version_guard_tg() owner to allfit_owner;
alter function payments.platform_plan_feature_guard_tg() owner to allfit_owner;
alter function payments.require_platform_commercial_manager(uuid, uuid) owner to allfit_owner;
alter function payments.platform_plan_version_changes(uuid, uuid) owner to allfit_owner;
alter function payments.platform_plan_version_projection(uuid, uuid) owner to allfit_owner;
alter function payments.platform_plan_projection(uuid, uuid) owner to allfit_owner;
alter function payments.list_platform_plans(uuid, uuid) owner to allfit_owner;
alter function payments.create_platform_plan(uuid, uuid, text, text, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function payments.propose_platform_plan_version(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, uuid, bytea
) owner to allfit_owner;
alter function payments.publish_platform_plan_version(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function payments.withdraw_platform_plan_version(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;

revoke all on function payments.platform_plan_guard_tg() from public;
revoke all on function payments.platform_plan_version_guard_tg() from public;
revoke all on function payments.platform_plan_feature_guard_tg() from public;
revoke all on function payments.require_platform_commercial_manager(uuid, uuid) from public;
revoke all on function payments.platform_plan_version_changes(uuid, uuid) from public;
revoke all on function payments.platform_plan_version_projection(uuid, uuid) from public;
revoke all on function payments.platform_plan_projection(uuid, uuid) from public;
revoke all on function payments.list_platform_plans(uuid, uuid) from public;
revoke all on function payments.create_platform_plan(uuid, uuid, text, text, text, uuid, uuid, bytea)
  from public;
revoke all on function payments.propose_platform_plan_version(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, uuid, bytea
) from public;
revoke all on function payments.publish_platform_plan_version(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  from public;
revoke all on function payments.withdraw_platform_plan_version(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  from public;

grant execute on function payments.list_platform_plans(uuid, uuid) to allfit_api;
grant execute on function payments.create_platform_plan(uuid, uuid, text, text, text, uuid, uuid, bytea)
  to allfit_api;
grant execute on function payments.propose_platform_plan_version(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, uuid, bytea
) to allfit_api;
grant execute on function payments.publish_platform_plan_version(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function payments.withdraw_platform_plan_version(uuid, uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
