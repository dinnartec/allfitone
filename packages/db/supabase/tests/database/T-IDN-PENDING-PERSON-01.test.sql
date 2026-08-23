begin;

select plan(33);

select has_function('identity', 'declare_fitness_id',
  'T-IDN-PHY-11 the pending Fitness ID is reachable only through a closed command');
select has_column('identity', 'people', 'username',
  'T-IDN-PHY-12 the handle belongs to the person, not to a separate relation');
select hasnt_table('identity', 'usernames',
  'T-IDN-PHY-13 the handle relation is gone: one owner means one source of truth');
select hasnt_column('identity', 'onboarding_attempts', 'given_name',
  'T-IDN-PHY-14 the attempt no longer carries identity');

select is(
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'person_status' and e.enumlabel = 'pending_activation'),
  1::bigint,
  'the third state exists'
);

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('019f1000-0000-7000-8000-000000000011', 'workos', 'https://issuer.test', 'pending_one'),
  ('019f1000-0000-7000-8000-000000000012', 'workos', 'https://issuer.test', 'pending_two'),
  ('019f1000-0000-7000-8000-000000000013', 'workos', 'https://issuer.test', 'studio_one');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f1000-0000-7000-8000-000000000011', true);

create temporary table attempt_one as
select attempt_id from identity.start_onboarding_attempt(
  '019f1000-0000-7000-8000-000000000011',
  '31111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111112',
  decode(repeat('31', 32), 'hex'));

-- Adulthood before the person exists: DT-012 is not relaxed by creating earlier.
select throws_ok(
  $$ select identity.declare_fitness_id(
       '019f1000-0000-7000-8000-000000000011',
       (select attempt_id from attempt_one),
       'Ada', 'Lovelace', 'ada_lovelace', 'ada@example.test', true,
       '31111111-1111-4111-8111-111111111121',
       '31111111-1111-4111-8111-111111111122',
       decode(repeat('32', 32), 'hex')) $$,
  '23514', null,
  'T-IDN-INT-11 no person is created before adulthood is credentialed');

select identity.record_adult_eligibility(
  '019f1000-0000-7000-8000-000000000011',
  (select attempt_id from attempt_one), true,
  '31111111-1111-4111-8111-111111111131',
  '31111111-1111-4111-8111-111111111132',
  decode(repeat('33', 32), 'hex'));

create temporary table pending_one as
select * from identity.declare_fitness_id(
  '019f1000-0000-7000-8000-000000000011',
  (select attempt_id from attempt_one),
  '  Ada  ', 'Lovelace', 'Ada_Lovelace', '  Ada@Example.TEST  ', true,
  '31111111-1111-4111-8111-111111111141',
  '31111111-1111-4111-8111-111111111142',
  decode(repeat('34', 32), 'hex'));

select is((select given_name from pending_one), 'Ada', 'the name is trimmed on the way in');
select is((select username from pending_one), 'ada_lovelace', 'the handle is lowercased on the way in');

reset role;
select is(
  (select status::text from identity.people where id = (select person_id from pending_one)),
  'pending_activation',
  'T-IDN-INT-12 the Fitness ID exists before it is active');
select is(
  (select activated_at from identity.people where id = (select person_id from pending_one)),
  null::timestamptz,
  'and carries no activation stamp, because it has not happened');
select is(
  (select person_id from identity.access_accounts where id = '019f1000-0000-7000-8000-000000000011'),
  (select person_id from pending_one),
  'the account is linked immediately');
select is(
  (select status::text from identity.onboarding_attempts where id = (select attempt_id from attempt_one)),
  'open',
  'and the attempt stays open: existing is not being active');
select is(
  (select contact_email::text from identity.people where id = (select person_id from pending_one)),
  'ada@example.test',
  'the credential address is the contact, trimmed and lowercased: DT-016');
select isnt(
  (select contact_email_verified_at from identity.people where id = (select person_id from pending_one)),
  null::timestamptz,
  'and it is stamped verified, which OP-SYS-002 needs to notify at all');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f1000-0000-7000-8000-000000000011', true);

-- The account actor cannot see `people` through a policy, so the read has to be a
-- governed function. A plain join returned null here and the API concluded the
-- Fitness ID did not exist, which would have offered to create a second one.
select is(
  (select username from identity.read_current_onboarding('019f1000-0000-7000-8000-000000000011')),
  'ada_lovelace',
  'T-IDN-RLS-12 an account reads the Fitness ID it owns, which no policy on people allows');
select is_empty(
  $$ select id from identity.people $$,
  'and still cannot read the table directly: the function is the only way in');

select is(
  (select person_id from identity.declare_fitness_id(
    '019f1000-0000-7000-8000-000000000011',
    (select attempt_id from attempt_one),
    'Ada', 'Lovelace', 'ada_lovelace', 'ada@example.test', true,
    '31111111-1111-4111-8111-111111111141',
    '31111111-1111-4111-8111-111111111142',
    decode(repeat('34', 32), 'hex'))),
  (select person_id from pending_one),
  'T-IDN-IDEM-11 replaying never creates a second Fitness ID');

-- Corregir el nombre reutiliza la persona: una cuenta tiene exactamente una.
select is(
  (select given_name from identity.declare_fitness_id(
    '019f1000-0000-7000-8000-000000000011',
    (select attempt_id from attempt_one),
    'Augusta', 'Byron', 'ada_lovelace', 'ada@example.test', true,
    '31111111-1111-4111-8111-111111111151',
    '31111111-1111-4111-8111-111111111152',
    decode(repeat('3f', 32), 'hex'))),
  'Augusta',
  'T-IDN-INT-18 going back corrects the Fitness ID instead of being refused');

reset role;
-- Se afirma sobre el vínculo de esta cuenta, no sobre el conteo de la tabla: estas
-- pruebas corren contra la base local compartida y cualquier fila ajena las rompería.
select is(
  (select person_id from identity.access_accounts where id = '019f1000-0000-7000-8000-000000000011'),
  (select person_id from pending_one),
  'and correcting reuses the same person: an account owns exactly one');
select is(
  (select username::text from identity.people where id = (select person_id from pending_one)),
  'ada_lovelace',
  'and the handle it kept is still taken, so the collision below is a real one');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f1000-0000-7000-8000-000000000011', true);

-- A second account cannot take the handle.
select set_config('app.actor_account_id', '019f1000-0000-7000-8000-000000000012', true);
create temporary table attempt_two as
select attempt_id from identity.start_onboarding_attempt(
  '019f1000-0000-7000-8000-000000000012',
  '31111111-1111-4111-8111-111111111211',
  '31111111-1111-4111-8111-111111111212',
  decode(repeat('35', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f1000-0000-7000-8000-000000000012',
  (select attempt_id from attempt_two), true,
  '31111111-1111-4111-8111-111111111221',
  '31111111-1111-4111-8111-111111111222',
  decode(repeat('36', 32), 'hex'));

select throws_ok(
  $$ select identity.declare_fitness_id(
       '019f1000-0000-7000-8000-000000000012',
       (select attempt_id from attempt_two),
       'Grace', 'Hopper', 'ada_lovelace', 'grace@example.test', true,
       '31111111-1111-4111-8111-111111111231',
       '31111111-1111-4111-8111-111111111232',
       decode(repeat('37', 32), 'hex')) $$,
  '23505', null,
  'T-IDN-INT-13 a handle another person holds cannot be taken');

select throws_ok(
  $$ select identity.declare_fitness_id(
       '019f1000-0000-7000-8000-000000000012',
       (select attempt_id from attempt_two),
       'Grace', 'Hopper', 'Grace Hopper!', 'grace@example.test', true,
       '31111111-1111-4111-8111-111111111241',
       '31111111-1111-4111-8111-111111111242',
       decode(repeat('38', 32), 'hex')) $$,
  '23514', null,
  'a malformed handle is refused by a constraint, not only by the application');

select throws_ok(
  $$ select identity.declare_fitness_id(
       '019f1000-0000-7000-8000-000000000012',
       (select attempt_id from attempt_two),
       'Grace', 'Hopper', 'grace_hopper', '   ', true,
       '31111111-1111-4111-8111-111111111251',
       '31111111-1111-4111-8111-111111111252',
       decode(repeat('3d', 32), 'hex')) $$,
  '22023', null,
  'a Fitness ID with no contact is refused: nothing could ever reach that person');

-- Unverified stores the address and withholds the stamp. That is the whole point
-- of keeping them separate: an unverified contact receives no notifications.
create temporary table pending_two as
select * from identity.declare_fitness_id(
  '019f1000-0000-7000-8000-000000000012',
  (select attempt_id from attempt_two),
  'Grace', 'Hopper', 'grace_hopper', 'Grace@Example.test', false,
  '31111111-1111-4111-8111-111111111261',
  '31111111-1111-4111-8111-111111111262',
  decode(repeat('3e', 32), 'hex'));

reset role;
select is(
  (select contact_email::text from identity.people where id = (select person_id from pending_two)),
  'grace@example.test',
  'an unverified contact is still recorded');
select is(
  (select contact_email_verified_at from identity.people where id = (select person_id from pending_two)),
  null::timestamptz,
  'and carries no verification stamp, so it receives nothing');

set local role allfit_api;

-- A pending person cannot do what needs an active Fitness ID.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', (select person_id::text from pending_one), true);
select throws_ok(
  $$ select identity.upsert_professional_profile(
       (select person_id from pending_one), 'Bio', null, null, null, null, null, null) $$,
  null, null,
  'T-IDN-RLS-11 a pending Fitness ID cannot open a professional profile');

-- Activation is a transition, not a creation. The snapshot is taken unfiltered:
-- read as allfit_api it would count what the actor can see, not what exists.
reset role;
create temporary table people_before as select count(*) as total from identity.people;

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f1000-0000-7000-8000-000000000011', true);

select is(
  identity.activate_person(
    '019f1000-0000-7000-8000-000000000011',
    (select attempt_id from attempt_one),
    'Ada', 'Lovelace', true, true,
    '31111111-1111-4111-8111-111111111251',
    '31111111-1111-4111-8111-111111111252',
    decode(repeat('39', 32), 'hex')),
  (select person_id from pending_one),
  'T-IDN-INT-14 activation reuses the person it already had');

reset role;
select is((select count(*) from identity.people), (select total from people_before),
  'and creates none: activating is not creating');
select is(
  (select status::text from identity.people where id = (select person_id from pending_one)),
  'active',
  'the Fitness ID is active');
select isnt(
  (select activated_at from identity.people where id = (select person_id from pending_one)),
  null::timestamptz,
  'and the stamp is set at the transition, not at creation');
select is(
  (select status::text from identity.onboarding_attempts where id = (select attempt_id from attempt_one)),
  'activated',
  'the attempt closes with the legal versions recorded');

-- Studio: no person, name from the provider, one call. Unchanged behaviour.
set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '019f1000-0000-7000-8000-000000000013', true);
create temporary table attempt_studio as
select attempt_id from identity.start_onboarding_attempt(
  '019f1000-0000-7000-8000-000000000013',
  '31111111-1111-4111-8111-111111111311',
  '31111111-1111-4111-8111-111111111312',
  decode(repeat('3a', 32), 'hex'));
select identity.record_adult_eligibility(
  '019f1000-0000-7000-8000-000000000013',
  (select attempt_id from attempt_studio), true,
  '31111111-1111-4111-8111-111111111321',
  '31111111-1111-4111-8111-111111111322',
  decode(repeat('3b', 32), 'hex'));

create temporary table studio_person as
select identity.activate_person(
  '019f1000-0000-7000-8000-000000000013',
  (select attempt_id from attempt_studio),
  'Grace', 'Hopper', true, true,
  '31111111-1111-4111-8111-111111111331',
  '31111111-1111-4111-8111-111111111332',
  decode(repeat('3c', 32), 'hex')) as person_id;

reset role;
select is(
  (select status::text from identity.people where id = (select person_id from studio_person)),
  'active',
  'T-IDN-INT-15 Studio still creates and activates in one call, with no handle');
select is(
  (select username from identity.people where id = (select person_id from studio_person)),
  null::extensions.citext,
  'and its person has no handle, because Studio never asks for one');

select * from finish();
rollback;
