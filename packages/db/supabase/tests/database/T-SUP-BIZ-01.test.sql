-- T-SUP-BIZ-01 — NEW-SUP-BUSINESS: how the business is going (`HU-BO-004`).
--
-- **A number without a period is not shown.** Every metric carries the window it was
-- measured over, because a count means nothing until it says since when.
--
-- **What cannot be computed is empty, never zero.** Payments have no tables and Space
-- persists no session, so those metrics answer `not_modelled` with no value. Zero
-- would be a claim about the business; this is a claim about the platform.
--
-- **A count of people hides a small group.** Below the declared minimum the figure is
-- withheld, so no metric narrows the platform down to somebody. A true zero is still
-- shown, because it singles out nobody.
--
-- The panel needs `view_platform_metrics`, an `A10` duty: the base role reads nothing.

begin;

select plan(24);

create function pg_temp.metric(p_panel jsonb, p_key text) returns integer
language sql immutable as $fn$
  select (entry->>'value')::integer
  from jsonb_array_elements(p_panel->'metrics') as entry
  where entry->>'key' = p_key
$fn$;

create function pg_temp.metric_field(p_panel jsonb, p_key text, p_field text) returns text
language sql immutable as $fn$
  select entry #>> string_to_array(p_field, '.')
  from jsonb_array_elements(p_panel->'metrics') as entry
  where entry->>'key' = p_key
$fn$;

insert into identity.people (id, given_name, family_name, status)
values
  ('019b3000-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019b3000-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019b3000-0000-7000-8000-000000000003', 'Founder', 'Gamma', 'active'),
  ('019b3000-0000-7000-8000-000000000004', 'Owner', 'Delta', 'active');

-- Enough people to clear the minimum before the first reading, so every count below
-- is a difference this test caused and not whatever the database already held.
insert into identity.people (id, given_name, family_name, status, created_at, activated_at)
select ('019b3000-0000-7000-8000-00000000010' || step)::uuid, 'Baseline', 'Person' || step,
  'active', clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days'
from generate_series(1, 8) as step;

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b3000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha_biz', null),
  ('019b3000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta_biz', null),
  ('019b3000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma_biz',
    '019b3000-0000-7000-8000-000000000003'),
  ('019b3000-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta_biz',
    '019b3000-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019b3000-0000-7000-8000-000000000001', 'alpha_biz',
  '019b3000-0000-7000-8000-000000000002', 'beta_biz',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-SUP-BIZ-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
)
select
  session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019b3000-0000-7000-8000-000000000021'::uuid, '019b3000-0000-7000-8000-000000000011'::uuid,
    'alpha_biz', 'f1'),
  ('019b3000-0000-7000-8000-000000000023'::uuid, '019b3000-0000-7000-8000-000000000013'::uuid,
    'gamma_biz', 'f3')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000021',
  '019b3000-0000-7000-8000-000000000003', 'allfit_admin',
  '019b3000-0000-7000-8000-000000000103', '019b3000-0000-7000-8000-000000000203',
  decode(repeat('71', 32), 'hex')
);

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000003', true);

-- ---------------------------------------------------------------------------
-- Who reads the panel
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select support.read_business_panel(
    '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
  ) $$,
  '42501',
  null,
  'the base role alone does not read how the business is going'
);

select support.assign_platform_duty(
  '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000021',
  '019b3000-0000-7000-8000-000000000003', 'view_platform_metrics',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-004',
  '019b3000-0000-7000-8000-000000000113', '019b3000-0000-7000-8000-000000000213',
  decode(repeat('73', 32), 'hex')
);

select is(
  (select actor_mode::text from support.platform_duty_assignments
   where person_id = '019b3000-0000-7000-8000-000000000003'
     and duty_code = 'view_platform_metrics'),
  'A10',
  'reading platform metrics is an A10 duty'
);

select throws_ok(
  $$ select support.read_business_panel(
    '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000021'
  ) $$,
  '42501',
  null,
  'a session that is not the operator''s own reads nothing'
);

create temporary table biz_before on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

-- ---------------------------------------------------------------------------
-- Every figure says of what period it is
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from biz_before, jsonb_array_elements(panel->'metrics') as entry
   where entry->'period'->>'kind' is null or entry->'period'->>'to' is null),
  0::bigint,
  'no figure is published without the period it was measured over'
);

select is(
  (select count(*) from biz_before, jsonb_array_elements(panel->'metrics') as entry
   where entry->>'availability' not in ('available', 'below_threshold', 'not_modelled')),
  0::bigint,
  'a figure is available, below the minimum, or not modelled at all'
);

select is(
  (select (panel->>'minimum_aggregate')::integer from biz_before),
  5,
  'the panel states the smallest group of people it will report'
);

-- ---------------------------------------------------------------------------
-- What the platform cannot compute stays empty
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select entry->>'key', entry->>'availability', entry->>'value'
     from biz_before, jsonb_array_elements(panel->'metrics') as entry
     where entry->>'key' in ('active_people_this_week', 'active_subscriptions',
       'billed_this_month', 'premium_people')
     order by 1 $$,
  $$ values ('active_people_this_week'::text, 'not_modelled'::text, null::text),
            ('active_subscriptions'::text, 'not_modelled'::text, null::text),
            ('billed_this_month'::text, 'not_modelled'::text, null::text),
            ('premium_people'::text, 'not_modelled'::text, null::text) $$,
  'Space activity, subscriptions, billing and Premium answer not modelled with no figure'
);

select is(
  (select pg_temp.metric_field(panel, 'active_people_this_week', 'reason') from biz_before),
  'space_sessions_not_recorded',
  'and each one says why, so the gap can be argued with'
);

-- ---------------------------------------------------------------------------
-- People: how many registered, how many arrived this week
-- ---------------------------------------------------------------------------

insert into identity.people (id, given_name, family_name, status, created_at, activated_at)
select ('019b3000-0000-7000-8000-00000000030' || step)::uuid, 'Fresh', 'Person' || step, 'active',
  clock_timestamp(), clock_timestamp()
from generate_series(1, 6) as step;

insert into identity.people (id, given_name, family_name, status, created_at, activated_at)
values
  ('019b3000-0000-7000-8000-000000000401', 'Older', 'Person', 'active',
    clock_timestamp() - interval '40 days', clock_timestamp() - interval '40 days'),
  ('019b3000-0000-7000-8000-000000000402', 'Closed', 'Person', 'closed',
    clock_timestamp(), clock_timestamp());

create temporary table biz_people on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

select is(
  (select pg_temp.metric(a.panel, 'registered_people') - pg_temp.metric(b.panel, 'registered_people')
   from biz_people as a, biz_before as b),
  7,
  'seven more people registered, and the one who closed their account is not among them'
);

select is(
  (select pg_temp.metric(a.panel, 'new_people_this_week')
        - pg_temp.metric(b.panel, 'new_people_this_week')
   from biz_people as a, biz_before as b),
  6,
  'only those who arrived inside the window are new this week'
);

select is(
  (select pg_temp.metric_field(panel, 'new_people_this_week', 'period.kind') from biz_people),
  'week',
  'the arrivals figure is a weekly one and says so'
);

select is(
  (select pg_temp.metric_field(panel, 'registered_people', 'period.kind') from biz_people),
  'total',
  'the registered figure is a running total and says so'
);

-- ---------------------------------------------------------------------------
-- Professionals working in Studio: the only activity the platform records
-- ---------------------------------------------------------------------------

select is(
  (select pg_temp.metric_field(panel, 'studio_active_professionals_this_week', 'availability')
   from biz_people),
  'available',
  'nobody working in Studio is a figure the panel can give: a real zero'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, last_activity_at
) values (
  '019b3000-0000-7000-8000-000000000024', '019b3000-0000-7000-8000-000000000014',
  'sid_delta_studio', 'studio', decode(repeat('f4', 32), 'hex'), 'v1.delta',
  clock_timestamp() + interval '5 minutes', clock_timestamp()
);

create temporary table biz_studio on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

select results_eq(
  $$ select entry->>'availability', entry->>'value'
     from biz_studio, jsonb_array_elements(panel->'metrics') as entry
     where entry->>'key' = 'studio_active_professionals_this_week' $$,
  $$ values ('below_threshold'::text, null::text) $$,
  'a group of people smaller than the minimum is withheld instead of counted out loud'
);

-- ---------------------------------------------------------------------------
-- Gyms: how many exist, and how many actually operate
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000004', true);

select * from organizations.create_organization(
  '019b3000-0000-7000-8000-000000000004', 'Negocio Norte', 'gym', 'natural_person', null,
  'b0000000-0000-4000-8000-000000000001', '019b3000-0000-7000-8000-000000000501',
  decode(repeat('81', 32), 'hex')
);

insert into organizations.organizations (
  id, type_code, display_name, status, claimed_at, cancelled_at, responsible_party
) values
  ('019b3000-0000-7000-8000-000000000601', 'gym', 'Negocio Sin Reclamar', 'unclaimed',
    null, null,
    '{"party_kind":"legal_entity","party_name":"Sin Reclamar SAS","purpose":"studio_operations"}'),
  ('019b3000-0000-7000-8000-000000000602', 'gym', 'Negocio Cancelado', 'cancelled',
    null, clock_timestamp(),
    '{"party_kind":"legal_entity","party_name":"Cancelado SAS","purpose":"studio_operations"}'),
  ('019b3000-0000-7000-8000-000000000603', 'gym', 'Negocio Vacio', 'active',
    clock_timestamp(), null,
    '{"party_kind":"legal_entity","party_name":"Vacio SAS","purpose":"studio_operations"}');

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000003', true);

create temporary table biz_gyms on commit drop as
select support.read_business_panel(
  '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000023'
) as panel;

select is(
  (select pg_temp.metric(a.panel, 'organizations') - pg_temp.metric(b.panel, 'organizations')
   from biz_gyms as a, biz_studio as b),
  4,
  'every gym counts in the total, whatever state it is in'
);

select is(
  (select pg_temp.metric(a.panel, 'operating_organizations')
        - pg_temp.metric(b.panel, 'operating_organizations')
   from biz_gyms as a, biz_studio as b),
  1,
  'only the one somebody actually runs counts as operating, not the one left empty'
);

select is(
  (select pg_temp.metric(a.panel, 'unclaimed_organizations')
        - pg_temp.metric(b.panel, 'unclaimed_organizations')
   from biz_gyms as a, biz_studio as b),
  1,
  'the one nobody claimed is counted apart: it exists, but it does not operate'
);

select is(
  (select pg_temp.metric_field(panel, 'operating_organizations', 'period.kind') from biz_gyms),
  'total',
  'the operating figure is a total at the moment it was read'
);

-- ---------------------------------------------------------------------------
-- A figure leads nowhere
-- ---------------------------------------------------------------------------

select ok(
  (select position('019b3000-0000-7000-8000' in panel::text) = 0
     and position('Negocio' in panel::text) = 0
     and position('Baseline' in panel::text) = 0
     and position('@' in panel::text) = 0
   from biz_gyms),
  'no identifier, no name and no contact travels in the panel: counts only'
);

select is(
  (select count(*) from privacy.access_events as event
   where event.actor_person_id = '019b3000-0000-7000-8000-000000000003'),
  0::bigint,
  'counting nobody in particular reaches nobody, so no access is recorded'
);

-- ---------------------------------------------------------------------------
-- A figure and its availability never disagree
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from biz_gyms, jsonb_array_elements(panel->'metrics') as entry
   where entry->>'availability' = 'available' and entry->'value' = 'null'::jsonb),
  0::bigint,
  'an available figure always carries its number'
);

select is(
  (select count(*) from biz_gyms, jsonb_array_elements(panel->'metrics') as entry
   where entry->>'availability' <> 'available' and entry->'value' <> 'null'::jsonb),
  0::bigint,
  'and one that is not available never carries one'
);

-- ---------------------------------------------------------------------------
-- What the runtime may do
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('allfit_api', 'support.read_business_panel(uuid,uuid)', 'EXECUTE')
  and not has_table_privilege('allfit_api', 'organizations.organizations', 'SELECT')
  and not has_table_privilege('allfit_api', 'organizations.organization_memberships', 'SELECT')
  and not has_table_privilege('allfit_api', 'identity.access_sessions', 'SELECT'),
  'the runtime reads the panel, never the tables the figures come from'
);

select ok(
  not has_function_privilege(
    'allfit_api', 'support.require_platform_metrics_reader(uuid,uuid)', 'EXECUTE'
  ),
  'the duty check behind it stays private'
);

select * from finish();
rollback;
