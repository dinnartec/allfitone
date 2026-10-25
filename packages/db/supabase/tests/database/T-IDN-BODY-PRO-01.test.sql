-- T-IDN-BODY-PRO-01 — body measurements and photos with Pro (DT-018, HU-SP-025..027).
--
-- Weight and height are always free: they are the profile. Every other measurement needs
-- `body_measurements`, and a photo needs `body_photos`. A photo belongs to its person
-- alone: nobody else lists or deletes it, deleting it queues its object for removal, and
-- reading or deleting one's own photos is never limited.
--
-- Written before the migration and watched failing.

begin;

select plan(13);

insert into identity.people (id, given_name, family_name, status)
values ('019ef900-0000-7000-8000-000000000001', 'Quien', 'Se Mide', 'active'),
       ('019ef900-0000-7000-8000-000000000002', 'La', 'Vecina', 'active');
insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values ('019ef900-0000-7000-8000-0000000000c1', 'workos', 'https://issuer.test', 'body_pro_one', '019ef900-0000-7000-8000-000000000001');

-- The free plan, published the only way it can be: proposed by one commercial manager and
-- published by another. Calling it again publishes the next version.
insert into identity.people (id, given_name, family_name, status)
values ('019ef900-0000-7000-8000-0000000000e1', 'Manager', 'Alpha', 'active'),
       ('019ef900-0000-7000-8000-0000000000e2', 'Manager', 'Beta', 'active'),
       ('019ef900-0000-7000-8000-0000000000e3', 'Commerce', 'Gamma', 'active'),
       ('019ef900-0000-7000-8000-0000000000e4', 'Commerce', 'Delta', 'active');
insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values ('019ef900-0000-7000-8000-0000000000f1', 'workos', 'https://issuer.test', 'alpha_bodypro', null),
       ('019ef900-0000-7000-8000-0000000000f2', 'workos', 'https://issuer.test', 'beta_bodypro', null),
       ('019ef900-0000-7000-8000-0000000000f3', 'workos', 'https://issuer.test', 'gamma_bodypro',
         '019ef900-0000-7000-8000-0000000000e3'),
       ('019ef900-0000-7000-8000-0000000000f4', 'workos', 'https://issuer.test', 'delta_bodypro',
         '019ef900-0000-7000-8000-0000000000e4');
select support.bootstrap_backoffice_administrators(
  '019ef900-0000-7000-8000-0000000000e1', 'alpha_bodypro',
  '019ef900-0000-7000-8000-0000000000e2', 'beta_bodypro',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-IDN-BODY-PRO-01');
insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at)
select session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019ef900-0000-7000-8000-0000000000d1'::uuid, '019ef900-0000-7000-8000-0000000000f1'::uuid, 'alpha_bodypro', 'a1'),
  ('019ef900-0000-7000-8000-0000000000d3'::uuid, '019ef900-0000-7000-8000-0000000000f3'::uuid, 'gamma_bodypro', 'a3'),
  ('019ef900-0000-7000-8000-0000000000d4'::uuid, '019ef900-0000-7000-8000-0000000000f4'::uuid, 'delta_bodypro', 'a4')
) as session_row(session_id, account_id, suffix, hash_byte);
select support.assign_platform_role(
  '019ef900-0000-7000-8000-0000000000e1', '019ef900-0000-7000-8000-0000000000d1',
  person_id, 'allfit_admin', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019ef900-0000-7000-8000-0000000000e3'::uuid), ('019ef900-0000-7000-8000-0000000000e4'::uuid))
  as grant_row(person_id);
select support.assign_platform_duty(
  '019ef900-0000-7000-8000-0000000000e1', '019ef900-0000-7000-8000-0000000000d1',
  person_id, 'manage_platform_commercial', clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-IDN-BODY-PRO', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019ef900-0000-7000-8000-0000000000e3'::uuid), ('019ef900-0000-7000-8000-0000000000e4'::uuid))
  as duty_row(person_id);

create function pg_temp.free_plan(p_limits jsonb)
returns void
language plpgsql
as $fn$
declare
  plan_id uuid;
  version_id uuid;
  kind text := current_setting('app.actor_kind', true);
  actor text := current_setting('app.actor_person_id', true);
begin
  perform set_config('app.actor_kind', 'support', true);
  perform set_config('app.actor_person_id', '019ef900-0000-7000-8000-0000000000e3', true);
  select id into plan_id from payments.platform_plans where plan_kind = 'free';
  if plan_id is null then
    select (result->>'id')::uuid into plan_id from payments.create_platform_plan(
      '019ef900-0000-7000-8000-0000000000e3', '019ef900-0000-7000-8000-0000000000d3',
      'free', 'Gratis', 'free', gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  end if;
  select (result->'proposal'->>'id')::uuid into version_id
  from payments.propose_platform_plan_version(
    '019ef900-0000-7000-8000-0000000000e3', '019ef900-0000-7000-8000-0000000000d3',
    plan_id, 0, null, null,
    (select jsonb_agg(jsonb_build_object(
       'feature_code', feature.code,
       'enabled', coalesce((p_limits->feature.code->>'enabled')::boolean, true),
       'limit_value', (p_limits->feature.code->>'limit_value')::integer))
     from payments.platform_features as feature),
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_person_id', '019ef900-0000-7000-8000-0000000000e4', true);
  perform payments.publish_platform_plan_version(
    '019ef900-0000-7000-8000-0000000000e4', '019ef900-0000-7000-8000-0000000000d4',
    plan_id, version_id, gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_kind', kind, true);
  perform set_config('app.actor_person_id', actor, true);
end
$fn$;

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

select pg_temp.free_plan('{"body_measurements":{"enabled":false,"limit_value":null},
  "body_photos":{"enabled":false,"limit_value":null}}');

create function pg_temp.measure(p_metric text, p_value numeric, p_unit text)
returns text
language plpgsql
as $fn$
begin
  -- As the API calls it: the account, and no person in the context.
  perform set_config('app.actor_kind', 'account', true);
  perform set_config('app.actor_account_id', '019ef900-0000-7000-8000-0000000000c1', true);
  perform set_config('app.actor_person_id', '', true);
  return pg_temp.refusal(format(
    $$ select * from identity.record_body_progress('019ef900-0000-7000-8000-0000000000c1', %L, %s, %L,
       current_date, gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)) $$,
    p_metric, p_value, p_unit));
end
$fn$;

create function pg_temp.photo(p_ref text)
returns text
language plpgsql
as $fn$
begin
  perform set_config('app.actor_kind', 'person', true);
  perform set_config('app.actor_person_id', '019ef900-0000-7000-8000-000000000001', true);
  return pg_temp.refusal(format(
    $$ select identity.record_body_photo('019ef900-0000-7000-8000-000000000001', current_date, %L,
       gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)) $$, p_ref));
end
$fn$;

-- ---------------------------------------------------------------------------
-- On the free plan
-- ---------------------------------------------------------------------------

select is(pg_temp.measure('body_weight', 64, 'kg'), 'allowed', 'T-IDN-BODY-PRO-01 weight is always free');
select is(pg_temp.measure('body_height', 168, 'cm'), 'allowed', 'T-IDN-BODY-PRO-02 and so is height');
select is(pg_temp.measure('waist', 80, 'cm'), 'AF402:body_measurements',
  'T-IDN-BODY-PRO-03 the rest of the measurements come with Pro');
select is(pg_temp.photo('body/019ef900-0000-7000-8000-000000000001/a.jpg'), 'AF402:body_photos',
  'T-IDN-BODY-PRO-04 and so do photos');

-- ---------------------------------------------------------------------------
-- Pro because her gym says so
-- ---------------------------------------------------------------------------

-- The API records a measurement as the account (onboarding records before the person is
-- active), so the gym that makes her Pro has to be found from the account's person.
create function pg_temp.pro_plan()
returns void
language plpgsql
as $fn$
declare
  plan_id uuid;
  version_id uuid;
begin
  perform set_config('app.actor_kind', 'support', true);
  perform set_config('app.actor_person_id', '019ef900-0000-7000-8000-0000000000e3', true);
  select (result->>'id')::uuid into plan_id from payments.create_platform_plan(
    '019ef900-0000-7000-8000-0000000000e3', '019ef900-0000-7000-8000-0000000000d3',
    'pro', 'Pro', 'paid', gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  select (result->'proposal'->>'id')::uuid into version_id
  from payments.propose_platform_plan_version(
    '019ef900-0000-7000-8000-0000000000e3', '019ef900-0000-7000-8000-0000000000d3',
    plan_id, 19900, 'COP', 'month',
    (select jsonb_agg(jsonb_build_object('feature_code', feature.code, 'enabled', true, 'limit_value', null))
     from payments.platform_features as feature),
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_person_id', '019ef900-0000-7000-8000-0000000000e4', true);
  perform payments.publish_platform_plan_version(
    '019ef900-0000-7000-8000-0000000000e4', '019ef900-0000-7000-8000-0000000000d4',
    plan_id, version_id, gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
end
$fn$;

select pg_temp.pro_plan();
insert into organizations.organizations (id, type_code, display_name, responsible_party, claimed_at)
values ('019ef900-0000-7000-8000-0000000000b1', 'gym', 'Gimnasio',
  '{"party_kind":"legal_entity","party_name":"Gimnasio SAS","purpose":"studio_operations"}',
  clock_timestamp());
insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019ef900-0000-7000-8000-0000000000b2', '019ef900-0000-7000-8000-000000000001',
  '019ef900-0000-7000-8000-0000000000b1', 'active');

select is(pg_temp.measure('waist', 81, 'cm'), 'allowed',
  'T-IDN-BODY-PRO-13 a person who is Pro through her gym measures the waist');

update relationships.service_relationships set status = 'terminated'
where id = '019ef900-0000-7000-8000-0000000000b2';

-- ---------------------------------------------------------------------------
-- With every function open
-- ---------------------------------------------------------------------------

select pg_temp.free_plan('{}');

select is(pg_temp.measure('waist', 80, 'cm'), 'allowed', 'T-IDN-BODY-PRO-05 Pro measures the waist');
select is(pg_temp.photo('body/019ef900-0000-7000-8000-000000000001/a.jpg'), 'allowed',
  'T-IDN-BODY-PRO-06 and keeps a photo');
select is(pg_temp.photo('body/019ef900-0000-7000-8000-000000000002/b.jpg'), '23514:',
  'T-IDN-BODY-PRO-07 under the person''s own key and no one else''s');

select is(
  (select jsonb_array_length(identity.list_my_body_photos('019ef900-0000-7000-8000-000000000001'))),
  1,
  'T-IDN-BODY-PRO-08 the person lists her photos'
);

select set_config('app.actor_person_id', '019ef900-0000-7000-8000-000000000002', true);
select is(
  pg_temp.refusal($$ select identity.list_my_body_photos('019ef900-0000-7000-8000-000000000001') $$),
  '42501:',
  'T-IDN-BODY-PRO-09 nobody else lists them'
);
select set_config('app.actor_person_id', '019ef900-0000-7000-8000-000000000001', true);

select is(
  identity.delete_my_body_photo('019ef900-0000-7000-8000-000000000001',
    (select id from identity.body_photos where person_id = '019ef900-0000-7000-8000-000000000001'),
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)),
  'body/019ef900-0000-7000-8000-000000000001/a.jpg',
  'T-IDN-BODY-PRO-10 deleting a photo hands back its object to remove'
);

select is(
  (select count(*)::integer from identity.body_photo_disposals
   where media_ref = 'body/019ef900-0000-7000-8000-000000000001/a.jpg' and sealed_at is null),
  1,
  'T-IDN-BODY-PRO-11 and queues it until the object is gone'
);

select ok(
  has_function_privilege('allfit_api', 'identity.record_body_photo(uuid, date, text, uuid, uuid, bytea)', 'execute')
  and has_function_privilege('allfit_api', 'identity.list_my_body_photos(uuid)', 'execute')
  and has_function_privilege('allfit_api', 'identity.delete_my_body_photo(uuid, uuid, uuid, uuid, bytea)', 'execute')
  and has_function_privilege('allfit_api', 'identity.seal_body_photo_disposal(uuid, text)', 'execute')
  and not has_table_privilege('allfit_api', 'identity.body_photos', 'select'),
  'T-IDN-BODY-PRO-12 the API reaches photos only through their functions'
);

select * from finish();

rollback;
