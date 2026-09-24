begin;

select plan(16);

select has_column('identity', 'people', 'biological_sex',
  'T-IDN-PHY-15 the datum lives on the person, not in a claims catalogue');
select is(
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'biological_sex'),
  2::bigint,
  'and the enum has exactly the two declarable values');

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019f2000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'biosex_one'),
  ('019f2000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'biosex_two'),
  ('019f2000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'biosex_none');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f2000-0000-7000-8000-000000000021', true);

create temporary table attempt_one as
select attempt_id from identity.start_onboarding_attempt(
  '019f2000-0000-7000-8000-000000000021',
  '41111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111112',
  decode(repeat('41', 32), 'hex'));

select identity.record_adult_eligibility(
  '019f2000-0000-7000-8000-000000000021',
  (select attempt_id from attempt_one), true,
  '41111111-1111-4111-8111-111111111121',
  '41111111-1111-4111-8111-111111111122',
  decode(repeat('42', 32), 'hex'));

create temporary table person_one as
select person_id from identity.declare_fitness_id(
  '019f2000-0000-7000-8000-000000000021',
  (select attempt_id from attempt_one),
  'Ada', 'Lovelace', 'ada_biosex', 'ada.biosex@example.test', true,
  '41111111-1111-4111-8111-111111111131',
  '41111111-1111-4111-8111-111111111132',
  decode(repeat('43', 32), 'hex'));

-- El valor tiene que estar en el enum, y el enum es la única fuente de esa lista.
select throws_ok(
  $$ select identity.declare_biological_sex(
       '019f2000-0000-7000-8000-000000000021',
       (select attempt_id from attempt_one),
       'other',
       '41111111-1111-4111-8111-111111111141',
       '41111111-1111-4111-8111-111111111142',
       decode(repeat('44', 32), 'hex')) $$,
  '22023', null,
  'a value outside the enum is refused before anything is written');

create temporary table declared_one as
select * from identity.declare_biological_sex(
  '019f2000-0000-7000-8000-000000000021',
  (select attempt_id from attempt_one),
  'female',
  '41111111-1111-4111-8111-111111111151',
  '41111111-1111-4111-8111-111111111152',
  decode(repeat('45', 32), 'hex'));

select is((select biological_sex from declared_one), 'female', 'the declaration comes back');
select is((select replayed from declared_one), false, 'and it is not a replay');

select is(
  (select biological_sex::text from identity.declare_biological_sex(
    '019f2000-0000-7000-8000-000000000021',
    (select attempt_id from attempt_one),
    'female',
    '41111111-1111-4111-8111-111111111151',
    '41111111-1111-4111-8111-111111111152',
    decode(repeat('45', 32), 'hex'))),
  'female',
  'T-IDN-IDEM-12 replaying the same command returns the same value');

-- Volver atrás y cambiar la respuesta es una corrección, no un conflicto.
select is(
  (select biological_sex from identity.declare_biological_sex(
    '019f2000-0000-7000-8000-000000000021',
    (select attempt_id from attempt_one),
    'male',
    '41111111-1111-4111-8111-111111111161',
    '41111111-1111-4111-8111-111111111162',
    decode(repeat('46', 32), 'hex'))),
  'male',
  'T-IDN-INT-16 going back changes the answer instead of being refused');

select is(
  (select answers -> 'biological_sex' ->> 'value'
     from identity.read_current_onboarding('019f2000-0000-7000-8000-000000000021')),
  'male',
  'T-IDN-RLS-15 the resume read carries the current value, which is what prefills the screen');

reset role;
select is(
  (select biological_sex::text from identity.people where id = (select person_id from person_one)),
  'male',
  'and the person carries the corrected value, not the first one');
select is(
  (select status::text from identity.onboarding_attempts where id = (select attempt_id from attempt_one)),
  'open',
  'the attempt stays open: declaring is not activating');

-- Una cuenta ajena no puede declarar sobre el intento de otra.
set local role allfit_api;
select set_config('app.actor_account_id', '019f2000-0000-7000-8000-000000000022', true);
select throws_ok(
  $$ select identity.declare_biological_sex(
       '019f2000-0000-7000-8000-000000000021',
       (select attempt_id from attempt_one),
       'male',
       '41111111-1111-4111-8111-111111111171',
       '41111111-1111-4111-8111-111111111172',
       decode(repeat('47', 32), 'hex')) $$,
  '42501', null,
  'T-IDN-RLS-13 a neighbour cannot declare the sex of another person');

-- Sin persona vinculada no hay sujeto de la afirmación.
select set_config('app.actor_account_id', '019f2000-0000-7000-8000-000000000023', true);
create temporary table attempt_none as
select attempt_id from identity.start_onboarding_attempt(
  '019f2000-0000-7000-8000-000000000023',
  '41111111-1111-4111-8111-111111111211',
  '41111111-1111-4111-8111-111111111212',
  decode(repeat('48', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f2000-0000-7000-8000-000000000023',
  (select attempt_id from attempt_none), true,
  '41111111-1111-4111-8111-111111111221',
  '41111111-1111-4111-8111-111111111222',
  decode(repeat('49', 32), 'hex'));

select throws_ok(
  $$ select identity.declare_biological_sex(
       '019f2000-0000-7000-8000-000000000023',
       (select attempt_id from attempt_none),
       'male',
       '41111111-1111-4111-8111-111111111231',
       '41111111-1111-4111-8111-111111111232',
       decode(repeat('4a', 32), 'hex')) $$,
  '42501', null,
  'declaring before the Fitness ID exists is refused');

-- Declinar: ninguna respuesta en el perfil, pero el intento queda sellado.
select set_config('app.actor_account_id', '019f2000-0000-7000-8000-000000000023', true);
create temporary table person_none as
select person_id from identity.declare_fitness_id(
  '019f2000-0000-7000-8000-000000000023',
  (select attempt_id from attempt_none),
  'Grace', 'Hopper', 'grace_biosex', 'grace.biosex@example.test', true,
  '41111111-1111-4111-8111-111111111241',
  '41111111-1111-4111-8111-111111111242',
  decode(repeat('4b', 32), 'hex'));

select is(
  (select biological_sex from identity.declare_biological_sex(
    '019f2000-0000-7000-8000-000000000023',
    (select attempt_id from attempt_none),
    null,
    '41111111-1111-4111-8111-111111111251',
    '41111111-1111-4111-8111-111111111252',
    decode(repeat('4c', 32), 'hex'))),
  null::text,
  'declining records no value');
select is(
  (select (answers -> 'biological_sex' ->> 'answered')::boolean
     from identity.read_current_onboarding('019f2000-0000-7000-8000-000000000023')),
  true,
  'T-IDN-INT-17 but the attempt records that the question was answered, so the flow advances');

reset role;
select is(
  (select biological_sex::text from identity.people where id = (select person_id from person_none)),
  null::text,
  'and the person carries no sentinel: the profile never learns of the refusal');

set local role allfit_api;

-- El dato hereda la política de `people`: solo la propia persona lo lee.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f2000-0000-7000-8000-0000000000ff', true);
select is_empty(
  $$ select biological_sex from identity.people where biological_sex is not null $$,
  'T-IDN-RLS-14 another person cannot read it, because no policy on people allows it');

select * from finish();
rollback;
