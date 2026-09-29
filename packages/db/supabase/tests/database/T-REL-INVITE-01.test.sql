-- T-REL-INVITE-01 — OP-REL-001.
--
-- Inviting a client creates an invitation and an offer, and deliberately
-- nothing else: no person, no account, no relationship, no grant, no
-- assignment. Those are the person's to accept, one option at a time.
--
-- The assertion that carries the most weight is the last group: reissuing the
-- same offer reuses the pending invitation, and changing what is asked for
-- does not, because the person would be answering a different question.

begin;

select plan(13);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b1000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active'),
  ('019b1000-0000-7000-8000-000000000012', 'Camilo', 'Coach', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019b1000-0000-7000-8000-000000000101', 'gym', 'Invite Gym',
  '{"party_kind":"legal_entity","party_name":"Invite SAS","purpose":"studio_operations"}'
);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values
  ('019b1000-0000-7000-8000-000000000201', '019b1000-0000-7000-8000-000000000101',
    '019b1000-0000-7000-8000-000000000011', 'active'),
  ('019b1000-0000-7000-8000-000000000202', '019b1000-0000-7000-8000-000000000101',
    '019b1000-0000-7000-8000-000000000012', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values
  ('019b1000-0000-7000-8000-000000000201', 'owner'),
  ('019b1000-0000-7000-8000-000000000202', 'coach');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values
  ('019b1000-0000-7000-8000-000000000301', 'body_progress', 1, 'published', clock_timestamp()),
  ('019b1000-0000-7000-8000-000000000302', 'relationship_training', 1, 'published', clock_timestamp()),
  ('019b1000-0000-7000-8000-000000000303', 'health_context', 1, 'draft', null);

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b1000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

-- The offer: two published scopes, each with its level and purpose.
select lives_ok(
  $$select * from identity.issue_client_invitation(
      '019b1000-0000-7000-8000-000000000011',
      '019b1000-0000-7000-8000-000000000101',
      'email', 'Ana@Example.test',
      '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
         "presented_snapshot":{"title":"Progreso corporal"}},
        {"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar",
         "presented_snapshot":{"title":"Entrenamiento"}}]'::jsonb,
      extensions.digest('token-1', 'sha256'), 1::smallint,
      '019b1000-0000-7000-8000-000000000f01',
      '019b1000-0000-7000-8000-000000000f01',
      extensions.digest('request-1', 'sha256')
    )$$,
  'an owner may invite a person as a client'
);

select is(
  (select count(*) from privacy.invitation_scope_options),
  2::bigint,
  'and the two scopes it asked for are recorded as options'
);

select is(
  (select count(*) from privacy.invitation_scope_options where decision is not null),
  0::bigint,
  'undecided, because offering is not granting'
);

-- Criterion: nothing else comes into being.
select is(
  (select count(*) from relationships.service_relationships),
  0::bigint,
  'no relationship is created by inviting'
);

select is(
  (select count(*) from privacy.data_grants),
  0::bigint,
  'and no grant either'
);

select is(
  (select contact_hint from identity.client_invitation_projection((
     select id from identity.invitations limit 1))),
  'a***@example.test',
  -- Lower-cased on the way in, so 'Ana@Example.test' and 'ana@example.test'
  -- are one contact rather than two invitations to the same person.
  'the contact comes back lower-cased and as a hint, never in full'
);

-- Reissuing the same offer reuses the pending invitation rather than stacking
-- a second one on the same person.
select is(
  (select reused from identity.issue_client_invitation(
      '019b1000-0000-7000-8000-000000000011',
      '019b1000-0000-7000-8000-000000000101',
      'email', 'ana@example.test',
      '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
         "presented_snapshot":{"title":"Progreso corporal"}},
        {"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar",
         "presented_snapshot":{"title":"Entrenamiento"}}]'::jsonb,
      extensions.digest('token-2', 'sha256'), 1::smallint,
      '019b1000-0000-7000-8000-000000000f02',
      '019b1000-0000-7000-8000-000000000f02',
      extensions.digest('request-2', 'sha256')
    )),
  true,
  'reissuing the same offer reuses the pending invitation'
);

select is(
  (select count(*) from identity.invitations),
  1::bigint,
  'so the person does not receive two'
);

-- A different offer is a different question, and gets its own invitation.
select is(
  (select reused from identity.issue_client_invitation(
      '019b1000-0000-7000-8000-000000000011',
      '019b1000-0000-7000-8000-000000000101',
      'email', 'ana@example.test',
      '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
         "presented_snapshot":{"title":"Progreso corporal"}}]'::jsonb,
      extensions.digest('token-3', 'sha256'), 1::smallint,
      '019b1000-0000-7000-8000-000000000f03',
      '019b1000-0000-7000-8000-000000000f03',
      extensions.digest('request-3', 'sha256')
    )),
  false,
  'asking for fewer scopes is a different proposal, not a reuse'
);

-- A scope nobody approved cannot be asked for.
select throws_ok(
  $$select * from identity.issue_client_invitation(
      '019b1000-0000-7000-8000-000000000011',
      '019b1000-0000-7000-8000-000000000101',
      'email', 'bruno@example.test',
      '[{"scope_code":"health_context","access_level":"read","purpose":"Contexto",
         "presented_snapshot":{"title":"Salud"}}]'::jsonb,
      extensions.digest('token-4', 'sha256'), 1::smallint,
      '019b1000-0000-7000-8000-000000000f04',
      '019b1000-0000-7000-8000-000000000f04',
      extensions.digest('request-4', 'sha256')
    )$$,
  '22023',
  'no published scope definition for the offer',
  'a draft scope cannot be offered to anyone'
);

-- An offer with no scopes is not an offer.
select throws_ok(
  $$select * from identity.issue_client_invitation(
      '019b1000-0000-7000-8000-000000000011',
      '019b1000-0000-7000-8000-000000000101',
      'email', 'bruno@example.test', '[]'::jsonb,
      extensions.digest('token-5', 'sha256'), 1::smallint,
      '019b1000-0000-7000-8000-000000000f05',
      '019b1000-0000-7000-8000-000000000f05',
      extensions.digest('request-5', 'sha256')
    )$$,
  '22023',
  'invalid client invitation',
  'an invitation with no scopes is refused'
);

-- A coach may invite clients: all four roles hold `invite_clients`, which is
-- what OP-REL-001 means by A3-A6. Inviting your own client is the coach's job.
select set_config('app.actor_person_id', '019b1000-0000-7000-8000-000000000012', true);

select lives_ok(
  $$select * from identity.issue_client_invitation(
      '019b1000-0000-7000-8000-000000000012',
      '019b1000-0000-7000-8000-000000000101',
      'email', 'bruno@example.test',
      '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
         "presented_snapshot":{"title":"Progreso"}}]'::jsonb,
      extensions.digest('token-6', 'sha256'), 1::smallint,
      '019b1000-0000-7000-8000-000000000f06',
      '019b1000-0000-7000-8000-000000000f06',
      extensions.digest('request-6', 'sha256')
    )$$,
  'a coach may invite a client of their own'
);

-- Someone with no membership in this organization cannot, whatever they hold
-- elsewhere.
insert into identity.people (id, given_name, family_name, status)
values ('019b1000-0000-7000-8000-000000000013', 'Ximena', 'Externa', 'active');

select set_config('app.actor_person_id', '019b1000-0000-7000-8000-000000000013', true);

select throws_ok(
  $$select * from identity.issue_client_invitation(
      '019b1000-0000-7000-8000-000000000013',
      '019b1000-0000-7000-8000-000000000101',
      'email', 'carla@example.test',
      '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
         "presented_snapshot":{"title":"Progreso"}}]'::jsonb,
      extensions.digest('token-7', 'sha256'), 1::smallint,
      '019b1000-0000-7000-8000-000000000f07',
      '019b1000-0000-7000-8000-000000000f07',
      extensions.digest('request-7', 'sha256')
    )$$,
  'P0002',
  'organization membership not found',
  'someone outside the organization cannot invite into it'
);

select * from finish();

rollback;
