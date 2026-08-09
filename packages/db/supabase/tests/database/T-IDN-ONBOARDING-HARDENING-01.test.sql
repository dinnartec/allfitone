begin;

select plan(7);

insert into identity.access_accounts (id, provider, issuer, subject)
values
  ('0198d100-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'onboarding_no_evidence'),
  ('0198d100-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'onboarding_ineligible'),
  ('0198d100-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'onboarding_legal_rejections'),
  ('0198d100-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'onboarding_constraint_guard');

set local role allfit_api;
select set_config('app.actor_kind', 'account', true);
select set_config('app.actor_account_id', '0198d100-0000-7000-8000-000000000021', true);

create temporary table no_evidence_attempt as
select *
from identity.start_onboarding_attempt(
  '0198d100-0000-7000-8000-000000000021',
  '31111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111112',
  decode(repeat('31', 32), 'hex')
);

select throws_ok(
  $$
    select identity.activate_person(
      '0198d100-0000-7000-8000-000000000021',
      (select attempt_id from no_evidence_attempt),
      'No',
      'Evidence',
      true,
      true,
      '31111111-1111-4111-8111-111111111121',
      '31111111-1111-4111-8111-111111111122',
      decode(repeat('32', 32), 'hex')
    )
  $$,
  '23514',
  null,
  'T-IDN-INT-02 rejects activation without adult eligibility evidence'
);

select set_config('app.actor_account_id', '0198d100-0000-7000-8000-000000000022', true);

create temporary table ineligible_attempt as
select *
from identity.start_onboarding_attempt(
  '0198d100-0000-7000-8000-000000000022',
  '32222222-2222-4222-8222-222222222211',
  '32222222-2222-4222-8222-222222222212',
  decode(repeat('33', 32), 'hex')
);

select identity.record_adult_eligibility(
  '0198d100-0000-7000-8000-000000000022',
  (select attempt_id from ineligible_attempt),
  false,
  '32222222-2222-4222-8222-222222222221',
  '32222222-2222-4222-8222-222222222222',
  decode(repeat('34', 32), 'hex')
);

select throws_ok(
  $$
    select identity.activate_person(
      '0198d100-0000-7000-8000-000000000022',
      (select attempt_id from ineligible_attempt),
      'Not',
      'Eligible',
      true,
      true,
      '32222222-2222-4222-8222-222222222231',
      '32222222-2222-4222-8222-222222222232',
      decode(repeat('35', 32), 'hex')
    )
  $$,
  '23514',
  null,
  'T-IDN-INT-03 rejects activation after a failed adult declaration'
);

select set_config('app.actor_account_id', '0198d100-0000-7000-8000-000000000023', true);

create temporary table legal_attempt as
select *
from identity.start_onboarding_attempt(
  '0198d100-0000-7000-8000-000000000023',
  '33333333-3333-4333-8333-333333333311',
  '33333333-3333-4333-8333-333333333312',
  decode(repeat('36', 32), 'hex')
);

select identity.record_adult_eligibility(
  '0198d100-0000-7000-8000-000000000023',
  (select attempt_id from legal_attempt),
  true,
  '33333333-3333-4333-8333-333333333321',
  '33333333-3333-4333-8333-333333333322',
  decode(repeat('37', 32), 'hex')
);

select throws_ok(
  $$
    select identity.activate_person(
      '0198d100-0000-7000-8000-000000000023',
      (select attempt_id from legal_attempt),
      'Missing',
      'Terms',
      false,
      true,
      '33333333-3333-4333-8333-333333333331',
      '33333333-3333-4333-8333-333333333332',
      decode(repeat('38', 32), 'hex')
    )
  $$,
  '23514',
  null,
  'T-IDN-INT-04 rejects activation without terms acceptance'
);

select throws_ok(
  $$
    select identity.activate_person(
      '0198d100-0000-7000-8000-000000000023',
      (select attempt_id from legal_attempt),
      'Missing',
      'Privacy',
      true,
      false,
      '33333333-3333-4333-8333-333333333341',
      '33333333-3333-4333-8333-333333333342',
      decode(repeat('39', 32), 'hex')
    )
  $$,
  '23514',
  null,
  'T-IDN-INT-05 rejects activation without privacy acceptance'
);

select throws_ok(
  $$
    delete from identity.eligibility_evidence
    where onboarding_attempt_id = (select attempt_id from legal_attempt)
  $$,
  '42501',
  null,
  'T-IDN-RLS-03 runtime cannot delete eligibility evidence'
);

select throws_ok(
  $$
    update identity.eligibility_evidence
    set result = 'fail'
    where onboarding_attempt_id = (select attempt_id from legal_attempt)
  $$,
  '42501',
  null,
  'T-IDN-RLS-04 runtime cannot mutate eligibility evidence'
);

reset role;

insert into identity.people (id, given_name, family_name)
values ('0198d100-0000-7000-8000-000000000031', 'Constraint', 'Guard');

insert into identity.onboarding_attempts (
  id,
  account_id,
  person_id,
  status,
  terms_version,
  terms_accepted_at,
  privacy_notice_version,
  privacy_notice_accepted_at,
  expires_at
) values (
  '0198d100-0000-7000-8000-000000000041',
  '0198d100-0000-7000-8000-000000000024',
  '0198d100-0000-7000-8000-000000000031',
  'open',
  'platform_terms_v1',
  clock_timestamp(),
  'privacy_notice_v1',
  clock_timestamp(),
  clock_timestamp() + interval '1 hour'
);

select throws_ok(
  $$
    update identity.onboarding_attempts
    set status = 'activated'
    where id = '0198d100-0000-7000-8000-000000000041'
  $$,
  '23514',
  null,
  'T-ONBOARD-2 the database boundary rejects activated state without passing evidence'
);

select * from finish();
rollback;
