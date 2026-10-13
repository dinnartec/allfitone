-- T-PAY-LIFECYCLE-01 — `OP-PAY-007..015` and `IX-40`.
--
-- The life of a subscription through the eight closed functions, and the one claim that
-- the whole design rests on: **suspending for non-payment touches nothing that granted
-- access.**
--
-- That claim is why the grant fixture below is as long as it is. A test for "suspension
-- does not revoke the grant" that has no grant proves nothing, and the obvious
-- implementation — revoke now, restore on payment — passes every other assertion in this
-- file. So a real `privacy.data_grants` row is built through its real chain (scope
-- definition, invitation, intent, scope option, consent event), snapshotted, and compared
-- after each transition. It is the assertion that would fail if somebody made suspension
-- "simpler".
--
-- The other two halves of `IX-40` are here too: the professional assignment stays
-- attached, and the service relationship stays active. The matrix names exactly those
-- three.
--
-- Reactivation is **subtractive**. It closes the one cause it opened and recalculates from
-- whatever is true now. There is no snapshot to restore, which is the point: a revoked
-- grant would need the person's consent again, and a gym cannot hand that back to itself.

begin;

select plan(46);

-- ---------------------------------------------------------------------------
-- A gym, its owner, a coach, two clients, and a gym next door
-- ---------------------------------------------------------------------------

insert into identity.people (id, given_name, family_name, status, contact_email)
values
  ('019c2000-0000-7000-8000-000000000001', 'Olivia', 'Owner', 'active', null),
  ('019c2000-0000-7000-8000-000000000002', 'Carla', 'Cliente', 'active', 'carla@example.test'),
  ('019c2000-0000-7000-8000-000000000003', 'Cesar', 'Coach', 'active', null),
  ('019c2000-0000-7000-8000-000000000004', 'Otra', 'Owner', 'active', null),
  ('019c2000-0000-7000-8000-000000000005', 'Dora', 'Cliente', 'active', 'dora@example.test');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values
  ('019c2000-0000-7000-8000-000000000101', 'gym', 'Gimnasio Uno',
   '{"party_kind":"legal_entity","party_name":"Uno SAS","purpose":"studio_operations"}'),
  ('019c2000-0000-7000-8000-000000000102', 'gym', 'Gimnasio Dos',
   '{"party_kind":"legal_entity","party_name":"Dos SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019c2000-0000-7000-8000-000000000201', '019c2000-0000-7000-8000-000000000101',
   '019c2000-0000-7000-8000-000000000001', 'active'),
  ('019c2000-0000-7000-8000-000000000202', '019c2000-0000-7000-8000-000000000101',
   '019c2000-0000-7000-8000-000000000003', 'active'),
  ('019c2000-0000-7000-8000-000000000203', '019c2000-0000-7000-8000-000000000102',
   '019c2000-0000-7000-8000-000000000004', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019c2000-0000-7000-8000-000000000201', 'owner'),
  ('019c2000-0000-7000-8000-000000000202', 'coach'),
  ('019c2000-0000-7000-8000-000000000203', 'owner');

insert into payments.gateway_connections (id, organization_id, provider, status)
values ('019c2000-0000-7000-8000-000000000301', '019c2000-0000-7000-8000-000000000101',
  'mercado_pago', 'active');

insert into payments.gateway_credentials
  (connection_id, organization_id, external_account_ref, credential_secret_ref)
values ('019c2000-0000-7000-8000-000000000301', '019c2000-0000-7000-8000-000000000101',
  'mp_acct_uno', 'vault://gateway/uno');

insert into payments.organization_plans (id, organization_id, name, status)
values
  ('019c2000-0000-7000-8000-000000000401', '019c2000-0000-7000-8000-000000000101',
   'Mensual', 'published'),
  -- Never offered: a draft is not a price anybody agreed to show.
  ('019c2000-0000-7000-8000-000000000402', '019c2000-0000-7000-8000-000000000101',
   'Anual', 'draft');

insert into payments.plan_versions
  (id, plan_id, organization_id, version_number, amount_minor, currency_code,
   billing_period, status, published_at, deprecated_at)
values
  ('019c2000-0000-7000-8000-000000000501', '019c2000-0000-7000-8000-000000000401',
   '019c2000-0000-7000-8000-000000000101', 2, 12000000, 'COP', 'month', 'published',
   clock_timestamp(), null),
  -- Last year's price. Still readable by whoever pays it, never offered again.
  ('019c2000-0000-7000-8000-000000000502', '019c2000-0000-7000-8000-000000000401',
   '019c2000-0000-7000-8000-000000000101', 1, 9000000, 'COP', 'month', 'deprecated',
   clock_timestamp(), clock_timestamp());

insert into relationships.service_relationships (id, person_id, organization_id, status)
values
  ('019c2000-0000-7000-8000-000000000701', '019c2000-0000-7000-8000-000000000002',
   '019c2000-0000-7000-8000-000000000101', 'active'),
  ('019c2000-0000-7000-8000-000000000702', '019c2000-0000-7000-8000-000000000005',
   '019c2000-0000-7000-8000-000000000101', 'active');

insert into relationships.relationship_professional_assignments (
  id, relationship_id, person_id, organization_id, membership_id, kind, status,
  accepted_by_person_at
) values (
  '019c2000-0000-7000-8000-000000000801', '019c2000-0000-7000-8000-000000000701',
  '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000202', 'holder', 'active', clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- A real grant, so that "suspension does not revoke it" can be asserted
-- ---------------------------------------------------------------------------

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019c2000-0000-7000-8000-000000000a01', 'body_progress', 1, 'published',
  clock_timestamp());

insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party, status, expires_at
) values (
  '019c2000-0000-7000-8000-000000000b01', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000201', 'email', 'carla@example.test',
  extensions.digest('token', 'sha256'), 1, extensions.digest('proposal', 'sha256'),
  '{"party_kind":"legal_entity","party_name":"Uno SAS","purpose":"studio_operations"}',
  'completed', clock_timestamp() + interval '7 days'
);

insert into identity.invitation_intents (id, invitation_id, kind, status, proposed_role_code)
values ('019c2000-0000-7000-8000-000000000c01', '019c2000-0000-7000-8000-000000000b01',
  'service_relationship', 'pending', null);

insert into privacy.invitation_scope_options (
  id, invitation_intent_id, scope_definition_id, scope_code,
  offered_access_level, purpose, presented_snapshot, decision, decided_at
) values (
  '019c2000-0000-7000-8000-000000000d01', '019c2000-0000-7000-8000-000000000c01',
  '019c2000-0000-7000-8000-000000000a01', 'body_progress', 'read',
  'Seguimiento de progreso', '{"title":"Progreso corporal"}'::jsonb,
  'accepted', clock_timestamp()
);

insert into privacy.consent_events (
  id, person_id, relationship_id, organization_id, invitation_scope_option_id,
  scope_definition_id, scope_code, decision, presented_snapshot
) values (
  '019c2000-0000-7000-8000-000000000e01', '019c2000-0000-7000-8000-000000000002',
  '019c2000-0000-7000-8000-000000000701', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000d01', '019c2000-0000-7000-8000-000000000a01',
  'body_progress', 'accepted', '{"title":"Progreso corporal"}'::jsonb
);

insert into privacy.data_grants (
  id, person_id, relationship_id, organization_id, scope_definition_id, scope_code,
  consent_event_id, access_level, purpose
) values (
  '019c2000-0000-7000-8000-000000000f01', '019c2000-0000-7000-8000-000000000002',
  '019c2000-0000-7000-8000-000000000701', '019c2000-0000-7000-8000-000000000101',
  '019c2000-0000-7000-8000-000000000a01', 'body_progress',
  '019c2000-0000-7000-8000-000000000e01', 'read', 'Seguimiento de progreso'
);

/*
 * The three things suspension must not move, taken as a fingerprint rather than as a
 * list of columns: a hash notices a column nobody thought to assert on.
 */
create temporary table untouched_state on commit drop as
select 'grant' as what,
       md5(string_agg(grant_row::text, '|' order by grant_row.id)) as fingerprint
from privacy.data_grants as grant_row
where grant_row.person_id = '019c2000-0000-7000-8000-000000000002'
union all
select 'assignment',
       md5(string_agg(assignment::text, '|' order by assignment.id))
from relationships.relationship_professional_assignments as assignment
where assignment.person_id = '019c2000-0000-7000-8000-000000000002'
union all
select 'relationship',
       md5(string_agg(relationship::text, '|' order by relationship.id))
from relationships.service_relationships as relationship
where relationship.person_id = '019c2000-0000-7000-8000-000000000002';

/*
 * Scaffolding, and `security definer` on purpose: the question is what is *in* those
 * tables, not what the current actor may see of them. Comparing under a person's own
 * policies would report a difference every time the actor changed and prove nothing about
 * whether suspension moved anything.
 */
create or replace function pg_temp.state_moved()
returns text
language sql
security definer
as $function$
  select coalesce(string_agg(current.what, ', ' order by current.what), 'nothing')
  from (
    select 'grant' as what,
           md5(string_agg(grant_row::text, '|' order by grant_row.id)) as fingerprint
    from privacy.data_grants as grant_row
    where grant_row.person_id = '019c2000-0000-7000-8000-000000000002'
    union all
    select 'assignment',
           md5(string_agg(assignment::text, '|' order by assignment.id))
    from relationships.relationship_professional_assignments as assignment
    where assignment.person_id = '019c2000-0000-7000-8000-000000000002'
    union all
    select 'relationship',
           md5(string_agg(relationship::text, '|' order by relationship.id))
    from relationships.service_relationships as relationship
    where relationship.person_id = '019c2000-0000-7000-8000-000000000002'
  ) as current
  join untouched_state as before on before.what = current.what
  where before.fingerprint is distinct from current.fingerprint
$function$;

-- ---------------------------------------------------------------------------
-- Choosing a plan — `OP-PAY-011`
-- ---------------------------------------------------------------------------

set local role allfit_owner;

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000002', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select is(
  (select count(*)::integer from payments.list_organization_plans(
    '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000101',
    50, null, null)),
  1,
  'one plan is on offer: the draft and last year''s price are not'
);

select is(
  (select plan_version_id from payments.list_organization_plans(
    '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000101',
    50, null, null)),
  '019c2000-0000-7000-8000-000000000501'::uuid,
  'and it is the published version, not the deprecated one with the lower number'
);

select is(
  (select count(*)::integer from payments.list_organization_plans(
    '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000102',
    50, null, null)),
  0,
  'the gym next door offers her nothing, because she is not its client'
);

-- ---------------------------------------------------------------------------
-- Subscribing — `OP-PAY-012`
-- ---------------------------------------------------------------------------

select is(
  (select started from payments.subscribe_to_plan(
    '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000501',
    '019c2000-0000-7000-8000-000000001001', '019c2000-0000-7000-8000-000000001001',
    extensions.digest('subscribe-carla', 'sha256'))),
  true,
  'she subscribes to the published version'
);

select is(
  (select amount_minor from payments.subscribe_to_plan(
    '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000501',
    '019c2000-0000-7000-8000-000000001001', '019c2000-0000-7000-8000-000000001001',
    extensions.digest('subscribe-carla', 'sha256'))),
  12000000::bigint,
  'the same command repeated answers the same price'
);

select is(
  (select replayed from payments.subscribe_to_plan(
    '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000501',
    '019c2000-0000-7000-8000-000000001001', '019c2000-0000-7000-8000-000000001001',
    extensions.digest('subscribe-carla', 'sha256'))),
  true,
  'and says so rather than creating a second subscription'
);

select is(
  (select count(*)::integer from payments.plan_subscriptions
    where person_id = '019c2000-0000-7000-8000-000000000002'),
  1,
  'which is the assertion that matters: one row, however many times she pressed it'
);

-- A different key with the same intention. The partial unique is what refuses it, so this
-- holds even for two requests arriving at once, which a read followed by an insert could
-- not promise.
select throws_ok(
  $$select * from payments.subscribe_to_plan(
      '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000501',
      '019c2000-0000-7000-8000-000000001002', '019c2000-0000-7000-8000-000000001002',
      extensions.digest('subscribe-carla-again', 'sha256'))$$,
  'P0004',
  'this person already has a live subscription with this organization',
  'a second live subscription with the same gym is refused'
);

select throws_ok(
  $$select * from payments.subscribe_to_plan(
      '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000502',
      '019c2000-0000-7000-8000-000000001003', '019c2000-0000-7000-8000-000000001003',
      extensions.digest('subscribe-deprecated', 'sha256'))$$,
  'P0002',
  'plan version not found',
  'and a retired version cannot be subscribed to at all'
);

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000004', true);

-- Not "forbidden": the same answer as a version that does not exist. Learning that a
-- price exists at a gym you have no relationship with is already learning something.
select throws_ok(
  $$select * from payments.subscribe_to_plan(
      '019c2000-0000-7000-8000-000000000004', '019c2000-0000-7000-8000-000000000501',
      '019c2000-0000-7000-8000-000000001004', '019c2000-0000-7000-8000-000000001004',
      extensions.digest('subscribe-outsider', 'sha256'))$$,
  'P0002',
  'plan version not found',
  'somebody with no relationship with the gym is told the plan does not exist'
);

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000005', true);

select is(
  (select started from payments.subscribe_to_plan(
    '019c2000-0000-7000-8000-000000000005', '019c2000-0000-7000-8000-000000000501',
    '019c2000-0000-7000-8000-000000001005', '019c2000-0000-7000-8000-000000001005',
    extensions.digest('subscribe-dora', 'sha256'))),
  true,
  'the other client subscribes to the same version, which is a different bond'
);

-- ---------------------------------------------------------------------------
-- Who may see the list — `OP-PAY-007`
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000001', true);

select is(
  (select count(*)::integer from payments.list_organization_subscriptions(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    null, 50, null, null, null)),
  2,
  'the owner sees both people who pay the gym'
);

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000003', true);

select throws_ok(
  $$select * from payments.list_organization_subscriptions(
      '019c2000-0000-7000-8000-000000000003', '019c2000-0000-7000-8000-000000000101',
      null, 50, null, null, null)$$,
  'P0002',
  'organization subscriptions not found',
  'the coach is told the list does not exist, assigned clients and all'
);

select throws_ok(
  $$select * from payments.suspend_subscription(
      '019c2000-0000-7000-8000-000000000003', '019c2000-0000-7000-8000-000000000101',
      (select id from payments.plan_subscriptions
        where person_id = '019c2000-0000-7000-8000-000000000002'),
      '019c2000-0000-7000-8000-000000001006', '019c2000-0000-7000-8000-000000001006',
      extensions.digest('coach-suspends', 'sha256'))$$,
  'P0002',
  'subscription not found',
  'and he cannot suspend what he cannot see'
);

-- ---------------------------------------------------------------------------
-- Suspending — `OP-PAY-008` and the three things it must not move
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000001', true);

select is(
  (select suspended from payments.suspend_subscription(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000002'),
    '019c2000-0000-7000-8000-000000001007', '019c2000-0000-7000-8000-000000001007',
    extensions.digest('suspend-carla', 'sha256'))),
  true,
  'the owner suspends her subscription'
);

select is(
  (select status::text from payments.plan_subscriptions
    where person_id = '019c2000-0000-7000-8000-000000000002'),
  'suspended',
  'the subscription says so'
);

select is(
  (select count(*)::integer from planning.service_access_blocks as block
    where block.person_id = '019c2000-0000-7000-8000-000000000002'
      and block.ended_at is null),
  1,
  'and exactly one cause is open'
);

select is(
  (select block.source_kind || ' / ' || block.blocks_future_sessions::text || ' / '
       || block.blocks_professional_contribution::text || ' / '
       || (block.relationship_id = '019c2000-0000-7000-8000-000000000701')::text
   from planning.service_access_blocks as block
   where block.person_id = '019c2000-0000-7000-8000-000000000002'
     and block.ended_at is null),
  'subscription_suspension / true / true / true',
  'naming its source, both effects, and the relationship it affects'
);

/*
 * `IX-40`. This is the assertion the file exists for: the grant is still live, the coach
 * is still attached and the relationship is still active. The obvious implementation —
 * revoke, unassign, restore later — passes every other test here and fails this one.
 */
select is(
  (select pg_temp.state_moved()),
  'nothing',
  'IX-40 suspending moved no grant, no assignment and no relationship'
);

select is(
  (select status::text from privacy.data_grants
    where id = '019c2000-0000-7000-8000-000000000f01'),
  'active',
  'and the grant in particular is neither revoked nor frozen'
);

-- Converges. A retry, or a second owner pressing the same button, must not open a second
-- cause — and the one open row is what makes closing it later unambiguous.
select is(
  (select suspended from payments.suspend_subscription(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000002'),
    '019c2000-0000-7000-8000-000000001008', '019c2000-0000-7000-8000-000000001008',
    extensions.digest('suspend-carla-twice', 'sha256'))),
  false,
  'suspending an already suspended subscription converges'
);

select is(
  (select count(*)::integer from planning.service_access_blocks as block
    where block.person_id = '019c2000-0000-7000-8000-000000000002'),
  1,
  'without a second cause to go with it'
);

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000002', true);

select is(
  (select status::text || ' / ' || (blocked_since is not null)::text
   from payments.read_my_subscriptions('019c2000-0000-7000-8000-000000000002')),
  'suspended / true',
  'she reads her own subscription paused, and since when'
);

-- ---------------------------------------------------------------------------
-- Reactivating — `OP-PAY-009`, subtractively
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000001', true);

select is(
  (select reactivated from payments.reactivate_subscription(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000002'),
    '019c2000-0000-7000-8000-000000001009', '019c2000-0000-7000-8000-000000001009',
    extensions.digest('reactivate-carla', 'sha256'))),
  true,
  'the owner reactivates it once she pays'
);

select is(
  (select status::text || ' / ' || (suspended_at is null)::text
   from payments.plan_subscriptions
   where person_id = '019c2000-0000-7000-8000-000000000002'),
  'active / true',
  'the subscription is live again and carries no suspension date'
);

select is(
  (select count(*)::integer from planning.service_access_blocks as block
    where block.person_id = '019c2000-0000-7000-8000-000000000002'
      and block.ended_at is null),
  0,
  'the cause is closed'
);

select is(
  (select count(*)::integer from planning.service_access_blocks as block
    where block.person_id = '019c2000-0000-7000-8000-000000000002'),
  1,
  'and kept, because the blocked period is evidence of what happened'
);

select is(
  (select pg_temp.state_moved()),
  'nothing',
  'IX-40 and reactivating restored nothing either: there was nothing to restore'
);

select is(
  (select reactivated from payments.reactivate_subscription(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000002'),
    '019c2000-0000-7000-8000-00000000100a', '019c2000-0000-7000-8000-00000000100a',
    extensions.digest('reactivate-carla-twice', 'sha256'))),
  false,
  'reactivating an active subscription converges'
);

select throws_ok(
  $$update planning.service_access_blocks set ended_at = null
      where person_id = '019c2000-0000-7000-8000-000000000002'$$,
  '55000',
  'a closed service access block does not reopen',
  'and the closed cause cannot be reopened to make the period unknowable'
);

-- ---------------------------------------------------------------------------
-- Fails closed when something has written around these functions
-- ---------------------------------------------------------------------------

reset role;

-- A subscription that says `suspended` with no open cause is a state the functions cannot
-- produce. Guessing which cause to close would be exactly the wrong way to discover that
-- something else wrote here.
update payments.plan_subscriptions
set status = 'suspended', suspended_at = clock_timestamp()
where person_id = '019c2000-0000-7000-8000-000000000005';

set local role allfit_owner;

select throws_ok(
  $$select * from payments.reactivate_subscription(
      '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
      (select id from payments.plan_subscriptions
        where person_id = '019c2000-0000-7000-8000-000000000005'),
      '019c2000-0000-7000-8000-00000000100b', '019c2000-0000-7000-8000-00000000100b',
      extensions.digest('reactivate-dora', 'sha256'))$$,
  'P0004',
  'this suspension has no open cause to close',
  'reactivation refuses a suspension whose cause it cannot find'
);

-- ---------------------------------------------------------------------------
-- Ending it — `OP-PAY-010` and `OP-PAY-015`
-- ---------------------------------------------------------------------------

-- Dora is suspended with no cause open, which is also the shape that proves ending does
-- not depend on one existing.
select is(
  (select ended from payments.end_subscription(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000005'),
    '019c2000-0000-7000-8000-00000000100c', '019c2000-0000-7000-8000-00000000100c',
    extensions.digest('end-dora', 'sha256'))),
  true,
  'the gym ends a subscription'
);

select is(
  (select status::text || ' / ' || ended_by_kind::text || ' / '
       || (ended_by_membership_id = '019c2000-0000-7000-8000-000000000201')::text
   from payments.plan_subscriptions
   where person_id = '019c2000-0000-7000-8000-000000000005'),
  'ended / person / true',
  'naming the member of the gym who decided it'
);

select is(
  (select status::text from relationships.service_relationships
    where person_id = '019c2000-0000-7000-8000-000000000005'),
  'active',
  'and her relationship with the gym is untouched: ending the money is not ending the bond'
);

select is(
  (select ended from payments.end_subscription(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000005'),
    '019c2000-0000-7000-8000-00000000100d', '019c2000-0000-7000-8000-00000000100d',
    extensions.digest('end-dora-twice', 'sha256'))),
  false,
  'ending an ended subscription converges without effect'
);

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000002', true);

select is(
  (select ended from payments.cancel_my_subscription(
    '019c2000-0000-7000-8000-000000000002',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000002'),
    '019c2000-0000-7000-8000-00000000100e', '019c2000-0000-7000-8000-00000000100e',
    extensions.digest('cancel-carla', 'sha256'))),
  true,
  'she cancels her own subscription'
);

select is(
  (select ended_by_membership_id is null from payments.plan_subscriptions
    where person_id = '019c2000-0000-7000-8000-000000000002'),
  true,
  'with no membership named, which is how her cancellation reads apart from a termination'
);

/*
 * The rule that is easiest to get wrong and worst to get wrong. Cancelling the payment
 * revokes nothing: cutting access to her data is `OP-PRV-005` and ending the relationship
 * is `OP-REL-007`, and both are separate decisions on purpose. Somebody who stops paying
 * has not withdrawn her consent.
 */
select is(
  (select pg_temp.state_moved()),
  'nothing',
  'cancelling revoked no grant, dropped no coach and ended no relationship'
);

select is(
  (select count(*)::integer from payments.read_my_subscriptions(
    '019c2000-0000-7000-8000-000000000002')),
  0,
  'and she no longer has a live subscription to read'
);

select is(
  (select started from payments.subscribe_to_plan(
    '019c2000-0000-7000-8000-000000000002', '019c2000-0000-7000-8000-000000000501',
    '019c2000-0000-7000-8000-00000000100f', '019c2000-0000-7000-8000-00000000100f',
    extensions.digest('resubscribe-carla', 'sha256'))),
  true,
  'coming back is a new subscription, which the ended one does not stand in the way of'
);

-- ---------------------------------------------------------------------------
-- Ending while suspended closes its own cause
-- ---------------------------------------------------------------------------

select set_config('app.actor_person_id', '019c2000-0000-7000-8000-000000000001', true);

select is(
  (select suspended from payments.suspend_subscription(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000002'
        and status <> 'ended'),
    '019c2000-0000-7000-8000-000000001010', '019c2000-0000-7000-8000-000000001010',
    extensions.digest('suspend-again', 'sha256'))),
  true,
  'the new subscription is suspended in turn'
);

select is(
  (select ended from payments.end_subscription(
    '019c2000-0000-7000-8000-000000000001', '019c2000-0000-7000-8000-000000000101',
    (select id from payments.plan_subscriptions
      where person_id = '019c2000-0000-7000-8000-000000000002'
        and status <> 'ended'),
    '019c2000-0000-7000-8000-000000001011', '019c2000-0000-7000-8000-000000001011',
    extensions.digest('end-suspended', 'sha256'))),
  true,
  'and then ended while suspended'
);

/*
 * The trap this closes. Reactivation requires a subscription that has not ended, so a
 * cause left open here could never be closed by anything at all and she would stay
 * blocked by a bond that no longer exists.
 */
select is(
  (select count(*)::integer from planning.service_access_blocks as block
    where block.person_id = '019c2000-0000-7000-8000-000000000002'
      and block.ended_at is null),
  0,
  'ending closed its own cause, which nothing else could have closed'
);

-- ---------------------------------------------------------------------------
-- The history, and what left the transaction
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select string_agg(event.event_type, ', ' order by event.occurred_at, event.event_type)
   from payments.subscription_events as event
   join payments.plan_subscriptions as subscription on subscription.id = event.subscription_id
   where subscription.person_id = '019c2000-0000-7000-8000-000000000002'),
  'started, suspended, reactivated, ended, started, suspended, ended',
  'the history reads as what happened, in order, twice over'
);

select is(
  (select string_agg(distinct event.event_type, ', ' order by event.event_type)
   from system.outbox_events as event
   where event.aggregate_type = 'plan_subscription'),
  'payments.subscription_ended.v1, payments.subscription_reactivated.v1, '
    || 'payments.subscription_started.v1, payments.subscription_suspended.v1',
  'and all four domain events left the transaction for somebody to deliver'
);

select is(
  (select event.payload->>'contact'
   from system.outbox_events as event
   where event.event_type = 'payments.subscription_suspended.v1'
   order by event.occurred_at
   limit 1),
  'carla@example.test',
  'carrying the contact resolved inside the transaction, so no worker reads her row'
);

select * from finish();

rollback;
