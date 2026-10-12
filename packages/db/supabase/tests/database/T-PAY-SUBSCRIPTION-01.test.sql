-- T-PAY-SUBSCRIPTION-01 — the paying bond between a person and a gym.
--
-- `payments.plan_subscriptions` and the three tables it needs to exist at all: the gym's
-- gateway connection, its commercial plans and their published versions, plus the
-- append-only history of what happened to a subscription.
--
-- **A subscription is not a relationship.** The dictionary says so and the schema has to
-- keep saying it: a person can be trained by a gym and owe it nothing, or owe it money
-- and no longer train there. Nothing here points at `relationships`.
--
-- **A published version is frozen.** A subscription points at one and keeps pointing at
-- it, so whoever subscribed keeps what they accepted. Raising a price publishes another
-- version; it does not move what somebody already agreed to pay.
--
-- **A coach does not read this.** The dictionary is explicit — the payment state of a
-- client is not their business — so the policy admits the person it belongs to, and the
-- organization only with `manage_billing`. Both directions are proved, and the coach is
-- denied *from inside his own gym*, which is the only version of that test worth having.
--
-- `IX-38`: the version subscribed belongs to the organization that charges.
-- `IX-39` (`payment_records`) and `IX-40` (`service_access_blocks`) belong to the
-- lifecycle functions and are not asserted here.

begin;

select plan(44);

-- ---------------------------------------------------------------------------
-- Two gyms, two people, and a coach who may not look
-- ---------------------------------------------------------------------------

insert into identity.people (id, given_name, family_name, status)
values
  ('019c1000-0000-7000-8000-000000000001', 'Olivia', 'Owner', 'active'),
  ('019c1000-0000-7000-8000-000000000002', 'Carla', 'Cliente', 'active'),
  ('019c1000-0000-7000-8000-000000000003', 'Cesar', 'Coach', 'active'),
  ('019c1000-0000-7000-8000-000000000004', 'Otra', 'Owner', 'active'),
  ('019c1000-0000-7000-8000-000000000005', 'Otra', 'Cliente', 'active'),
  ('019c1000-0000-7000-8000-000000000006', 'Adela', 'Admin', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c1000-0000-7000-8000-000000000101', 'gym', 'Gimnasio Uno',
   '{"party_kind":"legal_entity","party_name":"Uno SAS","purpose":"studio_operations"}'),
  ('019c1000-0000-7000-8000-000000000102', 'gym', 'Gimnasio Dos',
   '{"party_kind":"legal_entity","party_name":"Dos SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c1000-0000-7000-8000-000000000201', '019c1000-0000-7000-8000-000000000101',
   '019c1000-0000-7000-8000-000000000001', 'active'),
  ('019c1000-0000-7000-8000-000000000202', '019c1000-0000-7000-8000-000000000101',
   '019c1000-0000-7000-8000-000000000003', 'active'),
  ('019c1000-0000-7000-8000-000000000203', '019c1000-0000-7000-8000-000000000102',
   '019c1000-0000-7000-8000-000000000004', 'active'),
  ('019c1000-0000-7000-8000-000000000204', '019c1000-0000-7000-8000-000000000101',
   '019c1000-0000-7000-8000-000000000006', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c1000-0000-7000-8000-000000000201', 'owner'),
  ('019c1000-0000-7000-8000-000000000202', 'coach'),
  ('019c1000-0000-7000-8000-000000000203', 'owner'),
  ('019c1000-0000-7000-8000-000000000204', 'admin');

-- Carla trains at gym one as well as paying it. The two are separate bonds, which is the
-- point of this whole schema, but she needs the relationship to be told whether the gym
-- can be paid at all.
insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c1000-0000-7000-8000-000000000701', '019c1000-0000-7000-8000-000000000002',
   '019c1000-0000-7000-8000-000000000101', 'active');

-- ---------------------------------------------------------------------------
-- The gym connects its gateway: the money goes to the gym, not to Allfit
-- ---------------------------------------------------------------------------

insert into payments.gateway_connections
  (id, organization_id, provider, status)
values
  ('019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000101',
   'mercado_pago', 'active');

insert into payments.gateway_credentials
  (connection_id, organization_id, external_account_ref, credential_secret_ref)
values
  ('019c1000-0000-7000-8000-000000000301', '019c1000-0000-7000-8000-000000000101',
   'mp_acct_uno', 'vault://gateway/uno');

select throws_ok(
  $$ insert into payments.gateway_connections (organization_id, provider, status)
     values ('019c1000-0000-7000-8000-000000000101', 'wompi', 'active') $$,
  '23505',
  null,
  'a gym holds one active gateway connection, not two'
);

select throws_ok(
  $$ insert into payments.gateway_connections (organization_id, provider, status)
     values ('019c1000-0000-7000-8000-000000000102', 'paypal', 'active') $$,
  '23514',
  null,
  'and only from a provider the platform actually integrates'
);

select throws_ok(
  $$ insert into payments.gateway_connections
       (organization_id, provider, status, revoked_at)
     values ('019c1000-0000-7000-8000-000000000102', 'wompi', 'active',
             clock_timestamp()) $$,
  '23514',
  null,
  'a connection is revoked exactly when it says it is'
);

insert into payments.gateway_connections (id, organization_id, provider, status)
values
  ('019c1000-0000-7000-8000-000000000302', '019c1000-0000-7000-8000-000000000102',
   'wompi', 'active');

select throws_ok(
  $$ insert into payments.gateway_credentials
       (connection_id, organization_id, external_account_ref, credential_secret_ref)
     values ('019c1000-0000-7000-8000-000000000302',
             '019c1000-0000-7000-8000-000000000101', 'wompi_acct_dos',
             'vault://gateway/dos') $$,
  '23503',
  null,
  'and a credential cannot be filed under an organization that is not its connection''s'
);

-- The secret itself never lands here: the column holds a reference to a vault, and the
-- absence is worth asserting because the obvious shortcut is to paste the token in.
select is(
  (select count(*)::integer from information_schema.columns
    where table_schema = 'payments'
      and table_name in ('gateway_connections', 'gateway_credentials')
      and column_name in ('credential_secret', 'access_token', 'api_key', 'secret')),
  0,
  'the connection stores a reference to a secret and never a secret'
);

-- And the fact of being payable carries no account at all, which is what lets the person
-- about to pay read it.
select is(
  (select count(*)::integer from information_schema.columns
    where table_schema = 'payments' and table_name = 'gateway_connections'
      and column_name in ('external_account_ref', 'credential_secret_ref')),
  0,
  'nor anything identifying the account, which lives one table along'
);

-- ---------------------------------------------------------------------------
-- A plan, and a version that is frozen the moment it is published
-- ---------------------------------------------------------------------------

insert into payments.organization_plans (id, organization_id, name, status)
values
  ('019c1000-0000-7000-8000-000000000401', '019c1000-0000-7000-8000-000000000101',
   'Mensual', 'published'),
  ('019c1000-0000-7000-8000-000000000402', '019c1000-0000-7000-8000-000000000102',
   'Mensual', 'published'),
  -- A price the gym is still thinking about. It is not an offer, so no client sees it.
  ('019c1000-0000-7000-8000-000000000403', '019c1000-0000-7000-8000-000000000101',
   'Anual', 'draft');

select throws_ok(
  $$ insert into payments.organization_plans (organization_id, name, status)
     values ('019c1000-0000-7000-8000-000000000101', 'mensual', 'draft') $$,
  '23505',
  null,
  'one plan per name in a gym, however it is capitalised'
);

select lives_ok(
  $$ insert into payments.organization_plans (organization_id, name, status)
     values ('019c1000-0000-7000-8000-000000000102', 'Mensual Dos', 'draft') $$,
  'but the other gym names its own plans freely'
);

insert into payments.plan_versions
  (id, plan_id, organization_id, version_number, amount_minor, currency_code,
   billing_period, status, published_at)
values
  ('019c1000-0000-7000-8000-000000000501', '019c1000-0000-7000-8000-000000000401',
   '019c1000-0000-7000-8000-000000000101', 1, 12000000, 'COP', 'month', 'published',
   clock_timestamp()),
  ('019c1000-0000-7000-8000-000000000502', '019c1000-0000-7000-8000-000000000402',
   '019c1000-0000-7000-8000-000000000102', 1, 9000000, 'COP', 'month', 'published',
   clock_timestamp());

select throws_ok(
  $$ insert into payments.plan_versions
       (plan_id, organization_id, version_number, amount_minor, currency_code,
        billing_period, status, published_at)
     values ('019c1000-0000-7000-8000-000000000401', '019c1000-0000-7000-8000-000000000101',
             1, 15000000, 'COP', 'month', 'published', clock_timestamp()) $$,
  '23505',
  null,
  'a version number is published once per plan'
);

select throws_ok(
  $$ insert into payments.plan_versions
       (plan_id, organization_id, version_number, amount_minor, currency_code,
        billing_period, status, published_at)
     values ('019c1000-0000-7000-8000-000000000401', '019c1000-0000-7000-8000-000000000101',
             2, 0, 'COP', 'month', 'published', clock_timestamp()) $$,
  '23514',
  null,
  'and it charges something: a gym plan at zero is the free platform plan, not this'
);

select throws_ok(
  $$ insert into payments.plan_versions
       (plan_id, organization_id, version_number, amount_minor, currency_code,
        billing_period, status, published_at)
     values ('019c1000-0000-7000-8000-000000000401', '019c1000-0000-7000-8000-000000000101',
             3, 100, 'COP', 'fortnight', 'published', clock_timestamp()) $$,
  '23514',
  null,
  'and it bills by month or by year, not by anything somebody invents'
);

-- IX-38, half of it: a version cannot claim an organization that is not its plan's, so
-- the carrying key a subscription follows cannot lie further down.
select throws_ok(
  $$ insert into payments.plan_versions
       (plan_id, organization_id, version_number, amount_minor, currency_code,
        billing_period, status, published_at)
     values ('019c1000-0000-7000-8000-000000000401', '019c1000-0000-7000-8000-000000000102',
             9, 100, 'COP', 'month', 'published', clock_timestamp()) $$,
  '23503',
  null,
  'a version belongs to the organization its plan belongs to'
);

select throws_ok(
  $$ update payments.plan_versions set amount_minor = 1
      where id = '019c1000-0000-7000-8000-000000000501' $$,
  '55000',
  null,
  'a published version is never edited: the price somebody agreed to does not move'
);

select throws_ok(
  $$ delete from payments.plan_versions
      where id = '019c1000-0000-7000-8000-000000000501' $$,
  '55000',
  null,
  'and never deleted, because a subscription points at it'
);

select lives_ok(
  $$ update payments.plan_versions
        set status = 'deprecated', deprecated_at = clock_timestamp()
      where id = '019c1000-0000-7000-8000-000000000502' $$,
  'retiring it is the one change allowed, and it stops nobody already subscribed'
);

select throws_ok(
  $$ update payments.plan_versions set deprecated_at = null
      where id = '019c1000-0000-7000-8000-000000000502' $$,
  '55000',
  null,
  'and a retired version does not come back'
);

-- ---------------------------------------------------------------------------
-- The subscription itself
-- ---------------------------------------------------------------------------

-- A second published version of the same plan: the price went up. Nobody already
-- subscribed is supposed to feel it, and the assertion below is what proves it.
insert into payments.plan_versions
  (id, plan_id, organization_id, version_number, amount_minor, currency_code,
   billing_period, status, published_at)
values
  ('019c1000-0000-7000-8000-000000000503', '019c1000-0000-7000-8000-000000000401',
   '019c1000-0000-7000-8000-000000000101', 2, 15000000, 'COP', 'month', 'published',
   clock_timestamp());

insert into payments.plan_subscriptions
  (id, person_id, organization_id, plan_version_id, status, current_period_end)
values
  ('019c1000-0000-7000-8000-000000000601', '019c1000-0000-7000-8000-000000000002',
   '019c1000-0000-7000-8000-000000000101', '019c1000-0000-7000-8000-000000000501',
   'active', (clock_timestamp() + interval '30 days')::date);

-- IX-38: the version subscribed belongs to the organization that charges. Without the
-- composite key this insert succeeds and gym one charges gym two's price forever.
select throws_ok(
  $$ insert into payments.plan_subscriptions
       (person_id, organization_id, plan_version_id, status)
     values ('019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000101',
             '019c1000-0000-7000-8000-000000000502', 'active') $$,
  '23503',
  null,
  'IX-38 a gym cannot charge for another gym''s plan version'
);

select throws_ok(
  $$ insert into payments.plan_subscriptions
       (person_id, organization_id, plan_version_id, status)
     values ('019c1000-0000-7000-8000-000000000002', '019c1000-0000-7000-8000-000000000101',
             '019c1000-0000-7000-8000-000000000501', 'active') $$,
  '23505',
  null,
  'and a person owes a gym at most one live subscription'
);

select throws_ok(
  $$ insert into payments.plan_subscriptions
       (person_id, organization_id, plan_version_id, status, suspended_at)
     values ('019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000101',
             '019c1000-0000-7000-8000-000000000501', 'active', clock_timestamp()) $$,
  '23514',
  null,
  'a subscription is suspended exactly when it says it is'
);

select throws_ok(
  $$ insert into payments.plan_subscriptions
       (person_id, organization_id, plan_version_id, status, started_at, ended_at)
     values ('019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000101',
             '019c1000-0000-7000-8000-000000000501', 'active',
             clock_timestamp() - interval '30 days', clock_timestamp()) $$,
  '23514',
  null,
  'and ended exactly when it says it is'
);

-- The rule that keeps the gateway worker from ending anything: it suspends and
-- reactivates, and it has no actor to put in this column that the check accepts. Without
-- this, a failed charge arrives looking exactly like a cancellation.
select throws_ok(
  $$ insert into payments.plan_subscriptions
       (person_id, organization_id, plan_version_id, status, started_at,
        ended_at, ended_by_kind)
     values ('019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000101',
             '019c1000-0000-7000-8000-000000000501', 'ended',
             clock_timestamp() - interval '30 days', clock_timestamp(), 'worker') $$,
  '23514',
  null,
  'a subscription ends because somebody decided it, never because a worker ran'
);

select throws_ok(
  $$ insert into payments.plan_subscriptions
       (person_id, organization_id, plan_version_id, status, started_at, ended_at,
        ended_by_kind, ended_by_membership_id)
     values ('019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000101',
             '019c1000-0000-7000-8000-000000000501', 'ended',
             clock_timestamp() - interval '30 days', clock_timestamp(),
             'person', '019c1000-0000-7000-8000-000000000203') $$,
  '23503',
  null,
  'and whoever ended it on the gym''s behalf is a member of that gym'
);

select lives_ok(
  $$ insert into payments.plan_subscriptions
       (person_id, organization_id, plan_version_id, status, started_at, ended_at,
        ended_by_kind, ended_by_membership_id)
     values ('019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000101',
             '019c1000-0000-7000-8000-000000000501', 'ended',
             clock_timestamp() - interval '30 days', clock_timestamp(),
             'person', '019c1000-0000-7000-8000-000000000201') $$,
  'the owner ends it, and the pair is free to subscribe again'
);

select lives_ok(
  $$ insert into payments.plan_subscriptions
       (person_id, organization_id, plan_version_id, status)
     values ('019c1000-0000-7000-8000-000000000005', '019c1000-0000-7000-8000-000000000101',
             '019c1000-0000-7000-8000-000000000501', 'active') $$,
  'which is the point of the partial unique: coming back is a new row, not a revived one'
);

-- What versioning a price is *for*. The gym published version 2 at a higher amount; the
-- subscription Carla took on version 1 cannot be walked over to it.
select throws_ok(
  $$ update payments.plan_subscriptions
        set plan_version_id = '019c1000-0000-7000-8000-000000000503'
      where id = '019c1000-0000-7000-8000-000000000601' $$,
  '55000',
  null,
  'a price rise does not move a subscription somebody already agreed to'
);

select throws_ok(
  $$ delete from payments.plan_subscriptions
      where id = '019c1000-0000-7000-8000-000000000601' $$,
  '55000',
  null,
  'and a subscription is never deleted: it is the record of what was charged'
);

-- The history has to exist before anybody is asked not to read it. Written here and not
-- further down for a reason: with the row inserted after the read assertions, `is_empty`
-- was true because the table was empty, and the denial stayed green with the policy
-- replaced by `using (true)`. That is the failure mode the TDD rule is about.
insert into payments.subscription_events
  (subscription_id, event_type, actor_kind, actor_person_id)
values
  ('019c1000-0000-7000-8000-000000000601', 'started', 'person',
   '019c1000-0000-7000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Who reads a subscription
-- ---------------------------------------------------------------------------

-- The harness runs as superuser, which ignores every policy. `allfit_owner` owns these
-- tables and is forced to obey them, and it is the role the closed functions run as, so
-- it is the only role under which these assertions mean anything.
set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000002', true),
       set_config('app.actor_org_id', '', true);

select isnt_empty(
  $$ select 1 from payments.plan_subscriptions
      where id = '019c1000-0000-7000-8000-000000000601' $$,
  'the person reads the subscription that is hers'
);

select isnt_empty(
  $$ select 1 from payments.gateway_connections
      where organization_id = '019c1000-0000-7000-8000-000000000101' $$,
  'and whether the gym she trains at can be paid, which is why that fact is its own row'
);

select is_empty(
  $$ select 1 from payments.gateway_credentials
      where organization_id = '019c1000-0000-7000-8000-000000000101' $$,
  'but never the account it would be paid into'
);

select is(
  (select count(*)::integer from payments.organization_plans
    where organization_id = '019c1000-0000-7000-8000-000000000101'),
  1,
  'she sees the published plan of her gym and not the draft beside it'
);

select isnt_empty(
  $$ select 1 from payments.plan_versions
      where id = '019c1000-0000-7000-8000-000000000501' $$,
  'and the published version she would be subscribing to'
);

select is_empty(
  $$ select 1 from payments.organization_plans
      where organization_id = '019c1000-0000-7000-8000-000000000102' $$,
  'and nothing at all from a gym she has no relationship with: this is not a marketplace'
);

-- Inside his own gym, with the organization resolved. What denies him is the capability
-- and nothing else, which is the assertion the dictionary asks for.
select set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000003', true),
       set_config('app.actor_org_id', '019c1000-0000-7000-8000-000000000101', true);

select is_empty(
  $$ select 1 from payments.plan_subscriptions
      where id = '019c1000-0000-7000-8000-000000000601' $$,
  'the coach of that same gym reads nothing: what a client pays is not his business'
);

select is_empty(
  $$ select 1 from payments.subscription_events
      where subscription_id = '019c1000-0000-7000-8000-000000000601' $$,
  'nor its history, which would say the same thing one table along'
);

select set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000001', true),
       set_config('app.actor_org_id', '019c1000-0000-7000-8000-000000000101', true);

select isnt_empty(
  $$ select 1 from payments.plan_subscriptions
      where id = '019c1000-0000-7000-8000-000000000601' $$,
  'the owner, who carries manage_billing, reads what the gym charges'
);

-- The admin is the whole reason the gateway connection is guarded by a different
-- capability. She administers billing, so she reads who pays; she is not the owner, so
-- she does not get the credential reference. With both policies on `manage_billing` these
-- two assertions would read the same and neither would mean anything.
select set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000006', true),
       set_config('app.actor_org_id', '019c1000-0000-7000-8000-000000000101', true);

select isnt_empty(
  $$ select 1 from payments.plan_subscriptions
      where id = '019c1000-0000-7000-8000-000000000601' $$,
  'the admin, who also carries manage_billing, reads what the gym charges'
);

select isnt_empty(
  $$ select 1 from payments.gateway_connections
      where organization_id = '019c1000-0000-7000-8000-000000000101' $$,
  'and whether the gym can be paid, which is operational and not a secret'
);

select is_empty(
  $$ select 1 from payments.gateway_credentials
      where organization_id = '019c1000-0000-7000-8000-000000000101' $$,
  'and still not the gateway credentials, which are the owner''s alone'
);

select set_config('app.actor_person_id', '019c1000-0000-7000-8000-000000000004', true),
       set_config('app.actor_org_id', '019c1000-0000-7000-8000-000000000102', true);

select is_empty(
  $$ select 1 from payments.plan_subscriptions
      where id = '019c1000-0000-7000-8000-000000000601' $$,
  'and the other gym reads nothing of it at all'
);

select is_empty(
  $$ select 1 from payments.gateway_connections
      where organization_id = '019c1000-0000-7000-8000-000000000101' $$,
  'nor whether a gym that is not theirs can be paid'
);

select is_empty(
  $$ select 1 from payments.gateway_credentials
      where organization_id = '019c1000-0000-7000-8000-000000000101' $$,
  'and least of all its gateway credentials'
);

reset role;

-- ---------------------------------------------------------------------------
-- The history is append-only
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update payments.subscription_events set event_type = 'ended'
      where subscription_id = '019c1000-0000-7000-8000-000000000601' $$,
  '55000',
  null,
  'the history of a subscription is written once and never rewritten'
);

select throws_ok(
  $$ delete from payments.subscription_events
      where subscription_id = '019c1000-0000-7000-8000-000000000601' $$,
  '55000',
  null,
  'and never deleted'
);

-- ---------------------------------------------------------------------------
-- Nothing here reaches into another domain
-- ---------------------------------------------------------------------------

-- A subscription is not a relationship: the dictionary says so and the schema must not
-- quietly couple them through a foreign key nobody asked for. `planning` points *at* a
-- subscription when it blocks access; the arrow never turns around.
select is(
  (select count(*)::integer
     from pg_constraint as constraint_row
     join pg_class as source on source.oid = constraint_row.conrelid
     join pg_namespace as source_schema on source_schema.oid = source.relnamespace
     join pg_class as target on target.oid = constraint_row.confrelid
     join pg_namespace as target_schema on target_schema.oid = target.relnamespace
    where constraint_row.contype = 'f'
      and source_schema.nspname = 'payments'
      and target_schema.nspname in ('relationships', 'planning', 'privacy')),
  0,
  'payments points at no relationship, no plan of training and no consent'
);

select * from finish();

rollback;
