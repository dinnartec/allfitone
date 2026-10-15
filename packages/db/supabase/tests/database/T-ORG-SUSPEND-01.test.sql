-- T-ORG-SUSPEND-01 — OP-ORG-024/025 and NEW-ORG-SUSPEND: stopping a gym (`HU-BO-016`).
--
-- **Suspension destroys nothing, and that is the only thing worth proving here.** The
-- easy implementation revokes grants, ends relationships and cancels sessions, then
-- puts them back. It cannot put them back: a revoked grant needs consent again, a
-- terminated relationship is a new relationship, a cancelled session is gone. So this
-- file counts what still exists after the gym is stopped, not only what stopped.
--
-- **Reactivating closes one cause, by its event.** A subscription suspended for
-- non-payment during the period keeps denying afterwards, because its cause is a
-- different row. That is criterion 7 and it is the assertion that would quietly pass
-- if reactivation ever closed blocks by organization instead.
--
-- **Who stopped it and why outlives the state.** The status column cannot hold it once
-- the gym is active again, so the period does, and the history is read back after
-- reactivation.
--
-- The new policy is the other half: without it the Backoffice counts zero people
-- affected right after stopping a gym, and zero affected is the one figure that makes
-- a suspension look like it did nothing.

begin;

select plan(30);

insert into identity.people (id, given_name, family_name, status)
values
  ('019af000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019af000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019af000-0000-7000-8000-000000000003', 'Lifecycle', 'Gamma', 'active'),
  ('019af000-0000-7000-8000-000000000004', 'Badged', 'Delta', 'active'),
  ('019af000-0000-7000-8000-000000000006', 'Owner', 'Zeta', 'active'),
  ('019af000-0000-7000-8000-000000000008', 'Client', 'Theta', 'active'),
  ('019af000-0000-7000-8000-000000000009', 'Client', 'Iota', 'active'),
  ('019af000-0000-7000-8000-000000000010', 'Client', 'Kappa', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019af000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'alpha16', null),
  ('019af000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'beta16', null),
  ('019af000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'gamma16',
    '019af000-0000-7000-8000-000000000003'),
  ('019af000-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'delta16',
    '019af000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019af000-0000-7000-8000-000000000001', 'alpha16',
  '019af000-0000-7000-8000-000000000002', 'beta16',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-ORG-SUSPEND-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
) values
  ('019af000-0000-7000-8000-000000000041', '019af000-0000-7000-8000-000000000021',
    'sid_alpha_16', 'backoffice', decode(repeat('a1', 32), 'hex'), 'v1.alpha',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019af000-0000-7000-8000-000000000043', '019af000-0000-7000-8000-000000000023',
    'sid_gamma_16', 'backoffice', decode(repeat('a3', 32), 'hex'), 'v1.gamma',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'),
  ('019af000-0000-7000-8000-000000000044', '019af000-0000-7000-8000-000000000024',
    'sid_delta_16', 'backoffice', decode(repeat('a4', 32), 'hex'), 'v1.delta',
    clock_timestamp() + interval '5 minutes', 2, 'password_totp',
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours');

select support.assign_platform_role(
  '019af000-0000-7000-8000-000000000001', '019af000-0000-7000-8000-000000000041',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019af000-0000-7000-8000-000000000003'::uuid, '019af000-0000-7000-8000-000000000103'::uuid,
    '019af000-0000-7000-8000-000000000203'::uuid, 'c3'),
  ('019af000-0000-7000-8000-000000000004'::uuid, '019af000-0000-7000-8000-000000000104'::uuid,
    '019af000-0000-7000-8000-000000000204'::uuid, 'c4')
) as grant_row(person_id, key, command, hash_byte);

-- Only Gamma may stop a gym. Delta carries the base role and no duty at all, which is
-- what the first assertion is for.
select support.assign_platform_duty(
  '019af000-0000-7000-8000-000000000001', '019af000-0000-7000-8000-000000000041',
  '019af000-0000-7000-8000-000000000003', 'manage_organization_lifecycle',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-016',
  '019af000-0000-7000-8000-000000000113', '019af000-0000-7000-8000-000000000213',
  decode(repeat('e3', 32), 'hex')
);

-- Publishing a plan version needs two signatures. Beta supplies the second one and
-- holds nothing that touches an organization, so the duty assertions are unaffected.
select support.assign_platform_duty(
  '019af000-0000-7000-8000-000000000001', '019af000-0000-7000-8000-000000000041',
  '019af000-0000-7000-8000-000000000002', 'manage_platform_commercial',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-016',
  '019af000-0000-7000-8000-000000000114', '019af000-0000-7000-8000-000000000214',
  decode(repeat('e4', 32), 'hex')
);

insert into organizations.organizations (
  id, type_code, display_name, legal_name, responsible_party
) values
  ('019af000-0000-7000-8000-000000000301', 'gym', 'Gimnasio Moroso', 'Moroso SAS',
    '{"party_kind":"legal_entity","party_name":"Moroso SAS","purpose":"studio_operations"}'::jsonb);

insert into organizations.organizations (
  id, type_code, display_name, legal_name, status, claimed_at, responsible_party
) values
  ('019af000-0000-7000-8000-000000000302', 'gym', 'Sin Reclamar', 'Sin Reclamar SAS',
    'unclaimed', null,
    '{"party_kind":"legal_entity","party_name":"Sin Reclamar SAS","purpose":"studio_operations"}'::jsonb);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019af000-0000-7000-8000-000000000311', '019af000-0000-7000-8000-000000000301',
  '019af000-0000-7000-8000-000000000006', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values ('019af000-0000-7000-8000-000000000311', 'owner');

-- Two people the gym is serving and one who already left. The one who left is not
-- blocked: there is no service of hers to stop.
insert into relationships.service_relationships (
  id, person_id, organization_id, status, started_at, ended_at, ended_reason
) values
  ('019af000-0000-7000-8000-000000000321', '019af000-0000-7000-8000-000000000008',
    '019af000-0000-7000-8000-000000000301', 'active', clock_timestamp(), null, null),
  ('019af000-0000-7000-8000-000000000322', '019af000-0000-7000-8000-000000000009',
    '019af000-0000-7000-8000-000000000301', 'active', clock_timestamp(), null, null),
  ('019af000-0000-7000-8000-000000000323', '019af000-0000-7000-8000-000000000010',
    '019af000-0000-7000-8000-000000000301', 'terminated',
    clock_timestamp() - interval '10 days', clock_timestamp(), 'left');

-- Pro exists and is published, so by `ADR-043` every *active* gym grants it.
insert into payments.platform_plans (
  id, code, name, plan_kind, status, created_by_person_id, created_by_duty_assignment_id
)
select '019af000-0000-7000-8000-000000000401', 'pro', 'Pro', 'paid', 'published',
  '019af000-0000-7000-8000-000000000003', duty.id
from support.platform_duty_assignments as duty
where duty.person_id = '019af000-0000-7000-8000-000000000003';

insert into payments.platform_plan_versions (
  id, platform_plan_id, plan_kind, version_number, amount_minor, currency_code,
  billing_period, status, proposed_by_person_id, proposed_by_duty_assignment_id,
  published_by_person_id, published_by_duty_assignment_id, published_at
)
values ('019af000-0000-7000-8000-000000000402', '019af000-0000-7000-8000-000000000401',
  'paid', 1, 1990000, 'COP', 'month', 'published',
  '019af000-0000-7000-8000-000000000002',
  (select id from support.platform_duty_assignments
    where person_id = '019af000-0000-7000-8000-000000000002' limit 1),
  '019af000-0000-7000-8000-000000000003',
  (select id from support.platform_duty_assignments
    where person_id = '019af000-0000-7000-8000-000000000003' limit 1),
  clock_timestamp());

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000003', true),
       set_config('app.actor_session_id', '019af000-0000-7000-8000-000000000043', true);

-- ---------------------------------------------------------------------------
-- The duty, and the reason
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from organizations.suspend_organization(
    '019af000-0000-7000-8000-000000000004', '019af000-0000-7000-8000-000000000044',
    '019af000-0000-7000-8000-000000000301', 'nonpayment',
    '44444444-4444-4444-8444-444444444401', '019af000-0000-7000-8000-000000000501',
    decode(repeat('b1', 32), 'hex')
  ) $$,
  '42501',
  'managing the organization lifecycle requires an effective duty',
  'the base role alone does not stop a gym'
);

select throws_ok(
  $$ select * from organizations.suspend_organization(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    '019af000-0000-7000-8000-000000000301', 'because_i_said_so',
    '44444444-4444-4444-8444-444444444402', '019af000-0000-7000-8000-000000000502',
    decode(repeat('b2', 32), 'hex')
  ) $$,
  '22023',
  'a suspension is recorded under one of the agreed reasons',
  'the reason comes from a closed list, so the record cannot become free text'
);

select throws_ok(
  $$ select * from organizations.suspend_organization(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    '019af000-0000-7000-8000-000000000302', 'nonpayment',
    '44444444-4444-4444-8444-444444444403', '019af000-0000-7000-8000-000000000503',
    decode(repeat('b3', 32), 'hex')
  ) $$,
  '55000',
  'only a gym that is operating is suspended',
  'a gym nobody claimed is not operating, so there is nothing to stop'
);

-- ---------------------------------------------------------------------------
-- What the gym looked like before
-- ---------------------------------------------------------------------------

create temporary table before_suspension on commit drop as
select
  (select count(*)::integer from relationships.service_relationships
    where organization_id = '019af000-0000-7000-8000-000000000301' and status = 'active')
    as relationships_active,
  (select count(*)::integer from organizations.organization_memberships
    where organization_id = '019af000-0000-7000-8000-000000000301' and status = 'active')
    as memberships_active;

select set_config('app.actor_kind', 'person', true);
select is(
  (payments.resolve_pro('019af000-0000-7000-8000-000000000008')->>'effective_source'),
  'organization',
  'a client of the gym has Pro through it while the gym operates'
);
select set_config('app.actor_kind', 'support', true);

-- ---------------------------------------------------------------------------
-- Stopping it
-- ---------------------------------------------------------------------------

create temporary table suspended on commit drop as
select * from organizations.suspend_organization(
  '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
  '019af000-0000-7000-8000-000000000301', 'nonpayment',
  '44444444-4444-4444-8444-444444444404', '019af000-0000-7000-8000-000000000504',
  decode(repeat('b4', 32), 'hex')
);

select is(
  (select (result->>'suspended')::boolean from suspended),
  true,
  'the gym is stopped'
);

select is(
  (select status::text from organizations.organizations
   where id = '019af000-0000-7000-8000-000000000301'),
  'suspended',
  'and its state says so, which is what every `status = ''active''` check already reads'
);

select is(
  (select result->'current'->>'reason_code' from suspended),
  'nonpayment',
  'the reason is on the record, not in somebody''s memory'
);

select is(
  (select (result->'current'->>'people_blocked')::integer from suspended),
  2,
  'one cause per person the gym was serving, and none for the one who already left'
);

select is(
  (select count(*)::integer from organizations.organization_events
   where organization_id = '019af000-0000-7000-8000-000000000301'
     and event_type = 'organization.suspended.v1'
     and before_snapshot->>'status' = 'active'
     and after_snapshot->>'status' = 'suspended'
     and actor_person_id = '019af000-0000-7000-8000-000000000003'
     and actor_duty_assignment_id is not null),
  1,
  'the event carries both sides and a named person acting under a duty'
);

-- The screen that stops a gym is the gym's own file, so the file has to open
-- already knowing the answer rather than asking a second time.
select is(
  (organizations.read_backoffice_organization(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    '019af000-0000-7000-8000-000000000301'
  )->'suspension'->'current'->>'reason_code'),
  'nonpayment',
  'the gym file carries the suspension, so the screen opens knowing it'
);

-- ---------------------------------------------------------------------------
-- What it did not do — criteria 3 and 4
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from relationships.service_relationships
   where organization_id = '019af000-0000-7000-8000-000000000301' and status = 'active'),
  (select relationships_active from before_suspension),
  'no relationship ended: suspending is not cancelling'
);

select is(
  (select count(*)::integer from organizations.organization_memberships
   where organization_id = '019af000-0000-7000-8000-000000000301' and status = 'active'),
  (select memberships_active from before_suspension),
  'and nobody lost their membership, so reactivating needs no new acceptance'
);

select is(
  (select count(*)::integer from relationships.service_relationships
   where organization_id = '019af000-0000-7000-8000-000000000301'
     and person_id = '019af000-0000-7000-8000-000000000008'),
  1,
  'the client keeps the bond that carries her whole history with the gym'
);

-- Criterion 5. The same column the status check reads, so this cannot drift from it.
select set_config('app.actor_kind', 'person', true);
select is(
  (payments.resolve_pro('019af000-0000-7000-8000-000000000008')->>'effective_source'),
  'free',
  'her Pro drops to the free plan while the gym is stopped, and her data stays'
);
select set_config('app.actor_kind', 'support', true);

-- ---------------------------------------------------------------------------
-- Converging, and the record
-- ---------------------------------------------------------------------------

select is(
  (select (result->'current'->>'people_blocked')::integer
   from organizations.suspend_organization(
     '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
     '019af000-0000-7000-8000-000000000301', 'terms_breach',
     '44444444-4444-4444-8444-444444444405', '019af000-0000-7000-8000-000000000505',
     decode(repeat('b5', 32), 'hex')
   )),
  2,
  'stopping a stopped gym converges: no second period and no second set of causes'
);

select is(
  (select count(*)::integer from organizations.organization_suspensions
   where organization_id = '019af000-0000-7000-8000-000000000301'),
  1,
  'there is exactly one period, and its reason is still the first one given'
);

select is(
  (select replayed from organizations.suspend_organization(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    '019af000-0000-7000-8000-000000000301', 'nonpayment',
    '44444444-4444-4444-8444-444444444404', '019af000-0000-7000-8000-000000000504',
    decode(repeat('b4', 32), 'hex')
  )),
  true,
  'and the same command replays rather than deciding again'
);

-- ---------------------------------------------------------------------------
-- Another cause, opened during the suspension — criterion 7
-- ---------------------------------------------------------------------------

insert into payments.organization_plans (id, organization_id, name, status)
values ('019af000-0000-7000-8000-000000000601', '019af000-0000-7000-8000-000000000301',
  'Mensual', 'published');

insert into payments.plan_versions (
  id, plan_id, organization_id, version_number, amount_minor, currency_code,
  billing_period, status, published_at
)
values ('019af000-0000-7000-8000-000000000602', '019af000-0000-7000-8000-000000000601',
  '019af000-0000-7000-8000-000000000301', 1, 12000000, 'COP', 'month', 'published',
  clock_timestamp());

insert into payments.plan_subscriptions (
  id, person_id, organization_id, plan_version_id, status, current_period_end, suspended_at
)
values ('019af000-0000-7000-8000-000000000603', '019af000-0000-7000-8000-000000000008',
  '019af000-0000-7000-8000-000000000301', '019af000-0000-7000-8000-000000000602',
  'suspended', (clock_timestamp() + interval '30 days')::date, clock_timestamp());

-- Her subscription stops being paid while the gym is stopped. A different cause, and
-- reactivating the gym must not touch it.
insert into planning.service_access_blocks (
  id, person_id, organization_id, relationship_id, subscription_id, source_kind,
  blocks_future_sessions, blocks_professional_contribution, created_by_kind
)
values ('019af000-0000-7000-8000-000000000604', '019af000-0000-7000-8000-000000000008',
  '019af000-0000-7000-8000-000000000301', '019af000-0000-7000-8000-000000000321',
  '019af000-0000-7000-8000-000000000603', 'subscription_suspension', true, true, 'person');

-- ---------------------------------------------------------------------------
-- Letting it operate again
-- ---------------------------------------------------------------------------

create temporary table reactivated on commit drop as
select * from organizations.reactivate_organization(
  '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
  '019af000-0000-7000-8000-000000000301',
  '44444444-4444-4444-8444-444444444406', '019af000-0000-7000-8000-000000000506',
  decode(repeat('b6', 32), 'hex')
);

select is(
  (select (result->>'suspended')::boolean from reactivated),
  false,
  'the gym operates again'
);

select is(
  (select suspended_at from organizations.organizations
   where id = '019af000-0000-7000-8000-000000000301'),
  null,
  'and carries no open mark of having been stopped'
);

select is(
  (select count(*)::integer from planning.service_access_blocks as block
   join organizations.organization_suspensions as period
     on period.started_event_id = block.organization_event_id
   where period.organization_id = '019af000-0000-7000-8000-000000000301'
     and block.ended_at is null),
  0,
  'every cause this suspension opened is closed'
);

-- The assertion that would quietly pass if reactivation ever closed blocks by
-- organization instead of by event.
select is(
  (select ended_at from planning.service_access_blocks
   where id = '019af000-0000-7000-8000-000000000604'),
  null,
  'and the unpaid subscription keeps denying, because its cause is a different row'
);

select set_config('app.actor_kind', 'person', true);
select is(
  (payments.resolve_pro('019af000-0000-7000-8000-000000000008')->>'effective_source'),
  'organization',
  'her Pro comes back from the state that is true now, not from a restored copy'
);
select set_config('app.actor_kind', 'support', true);

-- ---------------------------------------------------------------------------
-- The record outlives the state — criterion 8
-- ---------------------------------------------------------------------------

select is(
  (select jsonb_array_length(result->'history') from reactivated),
  1,
  'a gym back on its feet still says it was stopped'
);

select is(
  (select result->'history'->0->>'reason_code' from reactivated),
  'nonpayment',
  'with why'
);

select is(
  (select (result->'history'->0->>'ended_by_person_id') from reactivated),
  '019af000-0000-7000-8000-000000000003',
  'and who lifted it'
);

select is(
  (select result->'current' from reactivated),
  'null'::jsonb,
  'while nothing is open any more'
);

-- ---------------------------------------------------------------------------
-- Terminal records
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update organizations.organization_suspensions set reason_code = 'terms_breach'
     where organization_id = '019af000-0000-7000-8000-000000000301' $$,
  '55000',
  'a suspension period keeps why it started; a new reason is a new period',
  'the reason a gym was stopped is not edited afterwards'
);

select throws_ok(
  $$ select * from organizations.reactivate_organization(
    '019af000-0000-7000-8000-000000000003', '019af000-0000-7000-8000-000000000043',
    '019af000-0000-7000-8000-000000000302',
    '44444444-4444-4444-8444-444444444407', '019af000-0000-7000-8000-000000000507',
    decode(repeat('b7', 32), 'hex')
  ) $$,
  '55000',
  'only a suspended gym is reactivated',
  'and a gym that was never stopped is not restarted'
);

-- ---------------------------------------------------------------------------
-- Who may read the causes
-- ---------------------------------------------------------------------------

set local role allfit_owner;

-- Written `using (false)` the next assertion fails, which is the only reason it is
-- worth having: the Backoffice would count zero people affected by its own decision.
select is(
  (select count(*)::integer from planning.service_access_blocks
   where organization_id = '019af000-0000-7000-8000-000000000301'
     and source_kind = 'organization_suspension'),
  2,
  'whoever may stop a gym reads the causes stopping it opened'
);

select set_config('app.actor_person_id', '019af000-0000-7000-8000-000000000004', true),
       set_config('app.actor_session_id', '019af000-0000-7000-8000-000000000044', true);

select is(
  (select count(*)::integer from planning.service_access_blocks
   where organization_id = '019af000-0000-7000-8000-000000000301'),
  0,
  'and somebody of Allfit without that duty reads none of them'
);

reset role;

select * from finish();
rollback;
