-- T-PAY-FEATURE-01 — what each plan opens, and how a limit is asked (DT-018, ADR-043,
-- HU-SP-084..088).
--
-- The catalogue lists the functions a plan can limit. A version declares every one of
-- them; a function its version does not declare limits nothing, because that version was
-- published before the function existed and whoever holds it never accepted the limit.
-- A limit reached raises AF402 with the function's code, so the API can say which.
--
-- Written before the migration and watched failing.

begin;

select plan(19);

-- ---------------------------------------------------------------------------
-- Fixture: two commercial managers, a gym, and three people
-- ---------------------------------------------------------------------------

insert into identity.people (id, given_name, family_name, status)
values
  ('019b5100-0000-7000-8000-000000000001', 'Manager', 'Alpha', 'active'),
  ('019b5100-0000-7000-8000-000000000002', 'Manager', 'Beta', 'active'),
  ('019b5100-0000-7000-8000-000000000003', 'Commerce', 'Gamma', 'active'),
  ('019b5100-0000-7000-8000-000000000004', 'Commerce', 'Delta', 'active'),
  ('019b5100-0000-7000-8000-000000000032', 'Bruno', 'Gimnasio', 'active'),
  ('019b5100-0000-7000-8000-000000000033', 'Carla', 'Gratis', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b5100-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'alpha_feat', null),
  ('019b5100-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'beta_feat', null),
  ('019b5100-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'gamma_feat',
    '019b5100-0000-7000-8000-000000000003'),
  ('019b5100-0000-7000-8000-000000000014', 'workos', 'https://issuer.test', 'delta_feat',
    '019b5100-0000-7000-8000-000000000004');

select support.bootstrap_backoffice_administrators(
  '019b5100-0000-7000-8000-000000000001', 'alpha_feat',
  '019b5100-0000-7000-8000-000000000002', 'beta_feat',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-PAY-FEATURE-01'
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
  ('019b5100-0000-7000-8000-000000000021'::uuid, '019b5100-0000-7000-8000-000000000011'::uuid,
    'alpha_feat', 'e1'),
  ('019b5100-0000-7000-8000-000000000023'::uuid, '019b5100-0000-7000-8000-000000000013'::uuid,
    'gamma_feat', 'e3'),
  ('019b5100-0000-7000-8000-000000000024'::uuid, '019b5100-0000-7000-8000-000000000014'::uuid,
    'delta_feat', 'e4')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b5100-0000-7000-8000-000000000001', '019b5100-0000-7000-8000-000000000021',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b5100-0000-7000-8000-000000000003'::uuid, '019b5100-0000-7000-8000-000000000103'::uuid,
    '019b5100-0000-7000-8000-000000000203'::uuid, '73'),
  ('019b5100-0000-7000-8000-000000000004'::uuid, '019b5100-0000-7000-8000-000000000104'::uuid,
    '019b5100-0000-7000-8000-000000000204'::uuid, '74')
) as grant_row(person_id, key, command, hash_byte);

select support.assign_platform_duty(
  '019b5100-0000-7000-8000-000000000001', '019b5100-0000-7000-8000-000000000021',
  person_id, 'manage_platform_commercial', clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-2026-FEAT', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b5100-0000-7000-8000-000000000003'::uuid,
    '019b5100-0000-7000-8000-000000000113'::uuid, '019b5100-0000-7000-8000-000000000213'::uuid, '63'),
  ('019b5100-0000-7000-8000-000000000004'::uuid,
    '019b5100-0000-7000-8000-000000000114'::uuid, '019b5100-0000-7000-8000-000000000214'::uuid, '64')
) as duty_row(person_id, key, command, hash_byte);

insert into organizations.organizations (id, type_code, display_name, responsible_party, claimed_at)
values ('019b5100-0000-7000-8000-000000000301', 'gym', 'Bodytech',
  '{"party_kind":"legal_entity","party_name":"Bodytech SAS","purpose":"studio_operations"}',
  clock_timestamp());
insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019b5100-0000-7000-8000-000000000401', '019b5100-0000-7000-8000-000000000032',
  '019b5100-0000-7000-8000-000000000301', 'active');

-- What AF402 says, or what else was raised.
create function pg_temp.refusal(p_sql text)
returns text
language plpgsql
as $fn$
declare
  detail text;
begin
  execute p_sql;
  return 'allowed';
exception when others then
  get stacked diagnostics detail = pg_exception_detail;
  return sqlstate || ':' || coalesce(detail, '');
end
$fn$;

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

select ok(
  (select array_agg(code) from payments.platform_features) @> array['active_personal_programs', 'body_measurements', 'body_photos', 'full_program_catalogue',
        'meal_photo_recognition', 'nutrition_history_months', 'own_routines', 'period_analysis',
        'routine_duplication', 'training_history_months'],
  'T-PAY-FEATURE-01 the catalogue lists the functions a plan can limit'
);

-- ---------------------------------------------------------------------------
-- Before any plan declares them, nothing is limited
-- ---------------------------------------------------------------------------

select is(
  (select row(declared, enabled, limit_value)::text
   from payments.feature_for('019b5100-0000-7000-8000-000000000033', 'own_routines')),
  '(f,t,)',
  'T-PAY-FEATURE-02 a function no version declares limits nothing'
);

select is(
  pg_temp.refusal($$ select payments.require_below_limit(
    '019b5100-0000-7000-8000-000000000033', 'own_routines', 500) $$),
  'allowed',
  'T-PAY-FEATURE-03 so no count is refused'
);

select is(
  payments.history_cutoff('019b5100-0000-7000-8000-000000000033', 'training_history_months',
    'America/Bogota'),
  null,
  'T-PAY-FEATURE-04 and no history is hidden'
);

-- ---------------------------------------------------------------------------
-- Publishing the free plan and Pro with the real catalogue
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true);

create function pg_temp.publish(p_plan uuid, p_amount bigint, p_currency text, p_period text,
  p_features jsonb)
returns uuid
language plpgsql
as $fn$
declare
  version uuid;
begin
  perform set_config('app.actor_person_id', '019b5100-0000-7000-8000-000000000003', true);
  select (result->'proposal'->>'id')::uuid into version
  from payments.propose_platform_plan_version(
    '019b5100-0000-7000-8000-000000000003', '019b5100-0000-7000-8000-000000000023',
    p_plan, p_amount, p_currency, p_period, p_features,
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  );
  perform set_config('app.actor_person_id', '019b5100-0000-7000-8000-000000000004', true);
  perform payments.publish_platform_plan_version(
    '019b5100-0000-7000-8000-000000000004', '019b5100-0000-7000-8000-000000000024',
    p_plan, version,
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  );
  return version;
end
$fn$;

create temporary table plan_ids as
select
  (select (result->>'id')::uuid from payments.create_platform_plan(
    '019b5100-0000-7000-8000-000000000003', '019b5100-0000-7000-8000-000000000023',
    'free', 'Gratis', 'free',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  )) as free_plan,
  (select (result->>'id')::uuid from payments.create_platform_plan(
    '019b5100-0000-7000-8000-000000000003', '019b5100-0000-7000-8000-000000000023',
    'pro', 'Pro', 'paid',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)
  )) as pro_plan;

select is(
  pg_temp.refusal(format($$ select pg_temp.publish(%L, 0, null, null,
    '[{"feature_code":"own_routines","enabled":true,"limit_value":3}]') $$,
    (select free_plan from plan_ids))),
  '22023:',
  'T-PAY-FEATURE-05 a version that leaves a function undecided is refused'
);

-- Whatever else the catalogue lists stays open; these are the free plan's limits.
create temporary table free_limits (feature_code text, enabled boolean, limit_value integer);
insert into free_limits values
  ('training_history_months', true, 1), ('nutrition_history_months', true, 1),
  ('active_personal_programs', true, 1), ('own_routines', true, 3),
  ('routine_duplication', false, null), ('full_program_catalogue', false, null),
  ('period_analysis', false, null), ('body_measurements', false, null),
  ('body_photos', false, null), ('meal_photo_recognition', false, null);

select lives_ok(
  format($$ select pg_temp.publish(%L, 0, null, null, %L) $$,
    (select free_plan from plan_ids),
    (select jsonb_agg(jsonb_build_object(
       'feature_code', feature.code,
       'enabled', coalesce(free_limits.enabled, true),
       'limit_value', free_limits.limit_value))
     from payments.platform_features as feature
     left join free_limits on free_limits.feature_code = feature.code)),
  'T-PAY-FEATURE-06 the free plan declares every function'
);

select lives_ok(
  format($$ select pg_temp.publish(%L, 1990000, 'COP', 'month',
    (select jsonb_agg(jsonb_build_object('feature_code', code, 'enabled', true, 'limit_value', null))
     from payments.platform_features)) $$,
    (select pro_plan from plan_ids)),
  'T-PAY-FEATURE-07 and Pro opens all of them, without limit'
);

-- ---------------------------------------------------------------------------
-- On the free plan
-- ---------------------------------------------------------------------------

select is(
  (select row(declared, enabled, limit_value)::text
   from payments.feature_for('019b5100-0000-7000-8000-000000000033', 'own_routines')),
  '(t,t,3)',
  'T-PAY-FEATURE-08 the free plan keeps three routines of one''s own'
);

select is(
  pg_temp.refusal($$ select payments.require_below_limit(
    '019b5100-0000-7000-8000-000000000033', 'own_routines', 2) $$),
  'allowed',
  'T-PAY-FEATURE-09 the third one is still allowed'
);

select is(
  pg_temp.refusal($$ select payments.require_below_limit(
    '019b5100-0000-7000-8000-000000000033', 'own_routines', 3) $$),
  'AF402:own_routines',
  'T-PAY-FEATURE-10 the fourth is refused, and the refusal names the function'
);

select is(
  pg_temp.refusal($$ select payments.require_feature(
    '019b5100-0000-7000-8000-000000000033', 'meal_photo_recognition') $$),
  'AF402:meal_photo_recognition',
  'T-PAY-FEATURE-11 a function the free plan does not open is refused'
);

select is(
  payments.history_cutoff('019b5100-0000-7000-8000-000000000033', 'training_history_months',
    'America/Bogota'),
  (date_trunc('day', clock_timestamp() at time zone 'America/Bogota') - interval '1 month')
    at time zone 'America/Bogota',
  'T-PAY-FEATURE-12 the free plan shows history from the start of the day a month ago'
);

-- ---------------------------------------------------------------------------
-- With Pro through a gym
-- ---------------------------------------------------------------------------

select is(
  pg_temp.refusal($$ select payments.require_below_limit(
    '019b5100-0000-7000-8000-000000000032', 'own_routines', 400) $$),
  'allowed',
  'T-PAY-FEATURE-13 Pro has no routine limit'
);

select is(
  pg_temp.refusal($$ select payments.require_feature(
    '019b5100-0000-7000-8000-000000000032', 'meal_photo_recognition') $$),
  'allowed',
  'T-PAY-FEATURE-14 Pro opens the recognition of meals'
);

select is(
  payments.history_cutoff('019b5100-0000-7000-8000-000000000032', 'training_history_months',
    'America/Bogota'),
  null,
  'T-PAY-FEATURE-15 and Pro hides no history'
);

-- ---------------------------------------------------------------------------
-- The catalogue of programmes points at a function
-- ---------------------------------------------------------------------------

select col_type_is('planning', 'programs', 'unlock_feature_code', 'text',
  'T-PAY-FEATURE-16 a programme can name the function that opens it');

select fk_ok('planning', 'programs', 'unlock_feature_code', 'payments', 'platform_features', 'code',
  'T-PAY-FEATURE-17 and it is always a function of the catalogue');

-- ---------------------------------------------------------------------------
-- Who runs them
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('allfit_api', 'payments.require_feature(uuid, text)', 'execute')
  and not has_function_privilege('allfit_api', 'payments.require_below_limit(uuid, text, integer)', 'execute')
  and not has_function_privilege('public', 'payments.history_cutoff(uuid, text, text)', 'execute'),
  'T-PAY-FEATURE-18 the checks run inside the database, never called on their own'
);

select ok(
  not exists (
    select 1 from payments.platform_features
    where code ~ '(privacy|consent|grant|permission|export|erasure|delet)'
  ),
  'T-PAY-FEATURE-19 no function of the catalogue touches the control of one''s own data'
);

select * from finish();

rollback;
