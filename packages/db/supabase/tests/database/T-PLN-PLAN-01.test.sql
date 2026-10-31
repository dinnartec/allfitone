-- T-PLN-PLAN-01 — what the free plan keeps of one's own programmes and routines
-- (DT-018, HU-SP-084..088).
--
-- On the free plan: Allfit's free selection and one programme of one's own at a time,
-- three routines of one's own, no duplicating. The copies a programme brings with it are
-- not the person's routines and never count. With every function open, all of it works.
--
-- Written before the migration and watched failing.

begin;

select plan(14);

insert into identity.people (id, given_name, family_name, status)
values ('019ef800-0000-7000-8000-000000000001', 'Quien', 'Planifica', 'active');

-- The free plan, published the only way it can be: proposed by one commercial manager and
-- published by another. Calling it again publishes the next version.
insert into identity.people (id, given_name, family_name, status)
values ('019ef800-0000-7000-8000-0000000000e1', 'Manager', 'Alpha', 'active'),
       ('019ef800-0000-7000-8000-0000000000e2', 'Manager', 'Beta', 'active'),
       ('019ef800-0000-7000-8000-0000000000e3', 'Commerce', 'Gamma', 'active'),
       ('019ef800-0000-7000-8000-0000000000e4', 'Commerce', 'Delta', 'active');
insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values ('019ef800-0000-7000-8000-0000000000f1', 'workos', 'https://issuer.test', 'alpha_plnplan', null),
       ('019ef800-0000-7000-8000-0000000000f2', 'workos', 'https://issuer.test', 'beta_plnplan', null),
       ('019ef800-0000-7000-8000-0000000000f3', 'workos', 'https://issuer.test', 'gamma_plnplan',
         '019ef800-0000-7000-8000-0000000000e3'),
       ('019ef800-0000-7000-8000-0000000000f4', 'workos', 'https://issuer.test', 'delta_plnplan',
         '019ef800-0000-7000-8000-0000000000e4');
select support.bootstrap_backoffice_administrators(
  '019ef800-0000-7000-8000-0000000000e1', 'alpha_plnplan',
  '019ef800-0000-7000-8000-0000000000e2', 'beta_plnplan',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-PLN-PLAN-01');
insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at)
select session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019ef800-0000-7000-8000-0000000000d1'::uuid, '019ef800-0000-7000-8000-0000000000f1'::uuid, 'alpha_plnplan', 'a1'),
  ('019ef800-0000-7000-8000-0000000000d3'::uuid, '019ef800-0000-7000-8000-0000000000f3'::uuid, 'gamma_plnplan', 'a3'),
  ('019ef800-0000-7000-8000-0000000000d4'::uuid, '019ef800-0000-7000-8000-0000000000f4'::uuid, 'delta_plnplan', 'a4')
) as session_row(session_id, account_id, suffix, hash_byte);
select support.assign_platform_role(
  '019ef800-0000-7000-8000-0000000000e1', '019ef800-0000-7000-8000-0000000000d1',
  person_id, 'allfit_admin', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019ef800-0000-7000-8000-0000000000e3'::uuid), ('019ef800-0000-7000-8000-0000000000e4'::uuid))
  as grant_row(person_id);
select support.assign_platform_duty(
  '019ef800-0000-7000-8000-0000000000e1', '019ef800-0000-7000-8000-0000000000d1',
  person_id, 'manage_platform_commercial', clock_timestamp(), clock_timestamp() + interval '30 days',
  'CASE-PLN-PLAN', gen_random_uuid(), gen_random_uuid(), extensions.gen_random_bytes(32))
from (values ('019ef800-0000-7000-8000-0000000000e3'::uuid), ('019ef800-0000-7000-8000-0000000000e4'::uuid))
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
  perform set_config('app.actor_person_id', '019ef800-0000-7000-8000-0000000000e3', true);
  select id into plan_id from payments.platform_plans where plan_kind = 'free';
  if plan_id is null then
    select (result->>'id')::uuid into plan_id from payments.create_platform_plan(
      '019ef800-0000-7000-8000-0000000000e3', '019ef800-0000-7000-8000-0000000000d3',
      'free', 'Gratis', 'free', gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  end if;
  select (result->'proposal'->>'id')::uuid into version_id
  from payments.propose_platform_plan_version(
    '019ef800-0000-7000-8000-0000000000e3', '019ef800-0000-7000-8000-0000000000d3',
    plan_id, 0, null, null,
    (select jsonb_agg(jsonb_build_object(
       'feature_code', feature.code,
       'enabled', coalesce((p_limits->feature.code->>'enabled')::boolean, true),
       'limit_value', (p_limits->feature.code->>'limit_value')::integer))
     from payments.platform_features as feature),
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32));
  perform set_config('app.actor_person_id', '019ef800-0000-7000-8000-0000000000e4', true);
  perform payments.publish_platform_plan_version(
    '019ef800-0000-7000-8000-0000000000e4', '019ef800-0000-7000-8000-0000000000d4',
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

-- Two of Allfit's programmes: one in the free selection and one that the full catalogue opens.
insert into planning.programs (id, content_scope, status)
values ('019ef800-0000-7000-8000-0000000000c1', 'global', 'published'),
       ('019ef800-0000-7000-8000-0000000000c2', 'global', 'published');
update planning.programs set unlock_feature_code = 'full_program_catalogue'
where id = '019ef800-0000-7000-8000-0000000000c2';
insert into planning.program_versions (id, program_id, version_number, title, status, published_at, content_hash)
values ('019ef800-0000-7000-8000-0000000000d1', '019ef800-0000-7000-8000-0000000000c1', 1,
        'Básico', 'published', now(), decode(repeat('c1', 32), 'hex')),
       ('019ef800-0000-7000-8000-0000000000d2', '019ef800-0000-7000-8000-0000000000c2', 1,
        'Avanzado', 'published', now(), decode(repeat('c2', 32), 'hex'));
insert into planning.session_templates (id, discipline_code, content_scope, status)
values ('019ef800-0000-7000-8000-0000000000e1', 'test_strength', 'global', 'published'),
       ('019ef800-0000-7000-8000-0000000000e2', 'test_strength', 'global', 'published');
insert into planning.session_template_versions
  (id, template_id, version_number, title, discipline_code, activity_type_id, status, published_at, content_hash)
values ('019ef800-0000-7000-8000-0000000000e3', '019ef800-0000-7000-8000-0000000000e1', 1, 'Pierna',
        'test_strength', '019c0000-0000-7000-8000-000000000011', 'published', now(), decode(repeat('b1', 32), 'hex')),
       ('019ef800-0000-7000-8000-0000000000e4', '019ef800-0000-7000-8000-0000000000e2', 1, 'Torso',
        'test_strength', '019c0000-0000-7000-8000-000000000011', 'published', now(), decode(repeat('b2', 32), 'hex'));
insert into planning.program_version_sessions (program_version_id, week, day, position, template_version_id)
values ('019ef800-0000-7000-8000-0000000000d1', 1, 1, 1, '019ef800-0000-7000-8000-0000000000e3'),
       ('019ef800-0000-7000-8000-0000000000d2', 1, 1, 1, '019ef800-0000-7000-8000-0000000000e4');

select pg_temp.free_plan('{"active_personal_programs":{"enabled":true,"limit_value":1},
  "own_routines":{"enabled":true,"limit_value":3},
  "routine_duplication":{"enabled":false,"limit_value":null},
  "full_program_catalogue":{"enabled":false,"limit_value":null}}');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef800-0000-7000-8000-000000000001', true);

create function pg_temp.take(p_version uuid)
returns uuid
language sql
as $fn$
  select planning.self_assign_program('019ef800-0000-7000-8000-000000000001', p_version, 'America/Bogota',
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32))
$fn$;

create function pg_temp.routine(p_title text)
returns uuid
language sql
as $fn$
  select ((planning.create_my_session_template('019ef800-0000-7000-8000-000000000001', 'test_strength', p_title,
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32))).template->>'id')::uuid
$fn$;

-- ---------------------------------------------------------------------------
-- Allfit's catalogue
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(entry.title || ':' || entry.locked::text || ':' || coalesce(entry.unlock_feature, '-')
                    order by entry.title)
   from planning.read_program_catalogue('019ef800-0000-7000-8000-000000000001') as entry),
  array['Avanzado:true:full_program_catalogue', 'Básico:false:-'],
  'T-PLN-PLAN-01 the catalogue says which programmes Pro opens'
);

select is(
  pg_temp.refusal($$ select pg_temp.take('019ef800-0000-7000-8000-0000000000d2') $$),
  'AF402:full_program_catalogue',
  'T-PLN-PLAN-02 the free plan cannot take a programme outside its selection'
);

select isnt(pg_temp.take('019ef800-0000-7000-8000-0000000000d1'), null,
  'T-PLN-PLAN-03 and takes one from it');

select is(
  pg_temp.refusal($$ select pg_temp.take('019ef800-0000-7000-8000-0000000000d1') $$),
  'AF402:active_personal_programs',
  'T-PLN-PLAN-04 one programme of one''s own at a time'
);

-- ---------------------------------------------------------------------------
-- Routines
-- ---------------------------------------------------------------------------

select is(planning.count_own_routines('019ef800-0000-7000-8000-000000000001'), 0,
  'T-PLN-PLAN-05 the copies a programme brings are not the person''s routines');

select isnt(pg_temp.routine('Una'), null, 'T-PLN-PLAN-06 a first routine');
select isnt(pg_temp.routine('Dos'), null, 'T-PLN-PLAN-07 a second');
select pg_temp.routine('Tres') as third \gset

select is(
  pg_temp.refusal($$ select pg_temp.routine('Cuatro') $$),
  'AF402:own_routines',
  'T-PLN-PLAN-08 a fourth is refused'
);

select is(
  pg_temp.refusal(format($$ select planning.duplicate_my_session_template('019ef800-0000-7000-8000-000000000001', %L,
    gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)) $$, :'third')),
  'AF402:routine_duplication',
  'T-PLN-PLAN-09 duplicating is Pro'
);

-- ---------------------------------------------------------------------------
-- With every function open
-- ---------------------------------------------------------------------------

select pg_temp.free_plan('{}');

select isnt(pg_temp.take('019ef800-0000-7000-8000-0000000000d2'), null,
  'T-PLN-PLAN-10 the whole catalogue, and more than one programme');

select isnt(pg_temp.routine('Cuatro'), null, 'T-PLN-PLAN-11 routines without limit');

select is(
  ((planning.duplicate_my_session_template('019ef800-0000-7000-8000-000000000001', :'third',
     gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32))).template
   ->'draft'->'content'->>'title'),
  'Tres - Copia',
  'T-PLN-PLAN-12 a duplicated routine is a copy of the person''s own'
);

select is(planning.count_own_routines('019ef800-0000-7000-8000-000000000001'), 5,
  'T-PLN-PLAN-13 and counts as one of them');

select throws_ok(
  $$ select planning.duplicate_my_session_template('019ef800-0000-7000-8000-000000000001', '019ef800-0000-7000-8000-0000000000e1',
     gen_random_uuid(), extensions.uuid_generate_v7(), extensions.gen_random_bytes(32)) $$,
  'P0002', null,
  'T-PLN-PLAN-14 only one''s own routines are duplicated'
);

select * from finish();

rollback;
