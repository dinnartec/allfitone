begin;

select plan(10);

set local role allfit_api;

create temporary table test_account as
select * from identity.resolve_or_create_access_account('workos', 'https://issuer.test', 'user_new');

select is((select count(*) from test_account), 1::bigint, 'authentication creates one unlinked access account');
select is(
  (select count(*) from identity.resolve_or_create_access_account('workos', 'https://issuer.test', 'user_new')),
  1::bigint,
  'replaying account resolution returns one account'
);
select is(
  (select person_id from identity.resolve_or_create_access_account('workos', 'https://issuer.test', 'user_new')),
  null::uuid,
  'authentication never creates a person'
);

create temporary table test_session_id as
select identity.create_access_session(
  (select account_id from identity.resolve_or_create_access_account('workos', 'https://issuer.test', 'user_new')),
  'session_test',
  'studio',
  decode(repeat('ab', 32), 'hex'),
  'v1.encrypted-payload',
  clock_timestamp() + interval '5 minutes'
) as id;

select is(
  (select token_version from identity.load_access_session(decode(repeat('ab', 32), 'hex'), 'studio')),
  1,
  'a new session starts at token version one'
);
select is(
  (select person_id from identity.load_access_session(decode(repeat('ab', 32), 'hex'), 'studio')),
  null::uuid,
  'the session reports registration incomplete through a null person'
);
select ok(
  identity.rotate_access_session(
    (select id from test_session_id),
    1,
    'v1.rotated-payload',
    clock_timestamp() + interval '5 minutes'
  ),
  'the expected token version rotates'
);
select ok(
  not identity.rotate_access_session(
    (select id from test_session_id),
    1,
    'v1.stale-payload',
    clock_timestamp() + interval '5 minutes'
  ),
  'a stale token version cannot overwrite the winner'
);
select is(
  (select token_version from identity.load_access_session(decode(repeat('ab', 32), 'hex'), 'studio')),
  2,
  'rotation increments the token version'
);
select ok(identity.revoke_access_session((select id from test_session_id)), 'the current session can be revoked');
select is_empty(
  $$ select session_id from identity.load_access_session(decode(repeat('ab', 32), 'hex'), 'studio') $$,
  'a revoked session cannot be loaded'
);

reset role;
select * from finish();
rollback;
