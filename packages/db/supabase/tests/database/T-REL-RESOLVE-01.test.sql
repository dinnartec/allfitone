-- T-REL-RESOLVE-01 — OP-REL-002.
--
-- Reading an invitation is not a neutral act here: what comes back is the list
-- of health-data categories an organization wants access to. So most of this
-- file is refusals, and the one group that returns data checks that every field
-- the person needs in order to answer is actually present.
--
-- The assertion that carries the most weight is the third group: a signed-in
-- person holding someone else's token is refused, not handed an invitation with
-- an empty offer. An empty offer would still confirm the invitation exists.

begin;

select plan(13);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b2000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019b2000-0000-7000-8000-000000000021', 'Ana', 'Client', 'active'),
  ('019b2000-0000-7000-8000-000000000022', 'Bruno', 'Bystander', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019b2000-0000-7000-8000-000000000101', 'gym', 'Resolve Gym',
  '{"party_kind":"legal_entity","party_name":"Resolve SAS","purpose":"studio_operations"}'
);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values (
  '019b2000-0000-7000-8000-000000000201', '019b2000-0000-7000-8000-000000000101',
  '019b2000-0000-7000-8000-000000000011', 'active'
);

insert into organizations.membership_roles (membership_id, role_code)
values ('019b2000-0000-7000-8000-000000000201', 'owner');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values
  ('019b2000-0000-7000-8000-000000000301', 'body_progress', 1, 'published', clock_timestamp()),
  ('019b2000-0000-7000-8000-000000000302', 'relationship_training', 1, 'published', clock_timestamp());

-- The owner issues the invitation Ana will later be asked to answer.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

create temporary table issued as
select * from identity.issue_client_invitation(
  '019b2000-0000-7000-8000-000000000011',
  '019b2000-0000-7000-8000-000000000101',
  'email', 'ana@example.test',
  '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento de medidas",
     "presented_snapshot":{"title":"Progreso corporal"}},
    {"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar",
     "presented_snapshot":{"title":"Entrenamiento"}}]'::jsonb,
  extensions.digest('resolve-token-1', 'sha256'), 1::smallint,
  '019b2000-0000-7000-8000-000000000f01',
  '019b2000-0000-7000-8000-000000000f01',
  extensions.digest('resolve-request-1', 'sha256')
);

-- An anonymous caller. Team invitations resolve this way; this one must not.
select set_config('app.actor_kind', 'anonymous', true),
       set_config('app.actor_person_id', '', true),
       set_config('app.actor_verified_email', '', true);

select throws_ok(
  $$select * from identity.resolve_client_invitation(
      extensions.digest('resolve-token-1', 'sha256'))$$,
  '42501',
  'person actor required',
  'an anonymous caller cannot read what an invitation asks for'
);

-- Bruno is signed in and holds Ana's token.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000022', true),
       set_config('app.actor_verified_email', 'bruno@example.test', true);

select throws_ok(
  $$select * from identity.resolve_client_invitation(
      extensions.digest('resolve-token-1', 'sha256'))$$,
  '42501',
  'verified email mismatch',
  'holding the token is not enough: the invitation is addressed to a contact'
);

-- Ana, the person it was addressed to.
select set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000021', true),
       set_config('app.actor_verified_email', 'ANA@Example.test', true);

select is(
  (select count(*)::int from identity.resolve_client_invitation(
     extensions.digest('resolve-token-1', 'sha256'))),
  1,
  'the person it was addressed to reads it, case of the email aside'
);

select is(
  (select organization_display_name from identity.resolve_client_invitation(
     extensions.digest('resolve-token-1', 'sha256'))),
  'Resolve Gym',
  'and sees who is asking'
);

select is(
  (select jsonb_array_length(scope_options) from identity.resolve_client_invitation(
     extensions.digest('resolve-token-1', 'sha256'))),
  2,
  'with every scope it asks for listed separately'
);

select is(
  (select scope_options -> 0 ->> 'scope_code' from identity.resolve_client_invitation(
     extensions.digest('resolve-token-1', 'sha256'))),
  'body_progress',
  'in a stable order, so the same offer never reads differently twice'
);

select is(
  (select scope_options -> 0 ->> 'purpose' from identity.resolve_client_invitation(
     extensions.digest('resolve-token-1', 'sha256'))),
  'Seguimiento de medidas',
  'each one carrying the purpose it was asked for'
);

select is(
  (select scope_options -> 0 ->> 'offered_access_level' from identity.resolve_client_invitation(
     extensions.digest('resolve-token-1', 'sha256'))),
  'read',
  'and the access level asked for'
);

select is(
  (select scope_options -> 0 -> 'presented_snapshot' ->> 'title'
     from identity.resolve_client_invitation(
       extensions.digest('resolve-token-1', 'sha256'))),
  'Progreso corporal',
  'and the contract exactly as it was presented'
);

select is(
  (select scope_options -> 0 ->> 'decision' from identity.resolve_client_invitation(
     extensions.digest('resolve-token-1', 'sha256'))),
  null,
  'undecided until she decides it'
);

select is(
  (select count(*)::int from identity.resolve_client_invitation(
     extensions.digest('no-such-token', 'sha256'))),
  0,
  'a token nobody issued resolves to nothing, without saying why'
);

select throws_ok(
  $$select * from identity.resolve_client_invitation('\x00'::bytea)$$,
  '22023',
  'invalid invitation token',
  'and a value that is not a token hash is refused outright'
);

-- Expiry is settled on read. `ck_invitations_expiry` keeps `expires_at` after
-- `created_at`, so the invitation is aged rather than given a deadline it never
-- could have had.
update identity.invitations
set created_at = clock_timestamp() - interval '8 days',
    expires_at = clock_timestamp() - interval '1 second'
where token_hash = extensions.digest('resolve-token-1', 'sha256');

select is(
  (select count(*)::int from identity.resolve_client_invitation(
     extensions.digest('resolve-token-1', 'sha256'))),
  0,
  'an expired invitation returns nothing rather than an offer that cannot be taken'
);

select * from finish();

rollback;
