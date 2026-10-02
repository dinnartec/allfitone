-- T-IDN-CLIENT-DECISION-01 — OP-IDN-009, client half.
--
-- The claim being tested: accepting a relationship is not accepting the data
-- it asked for. Each option is answered on its own, silence counts as no, and
-- a person can end up a client of a gym that may read nothing of theirs.
--
-- That last case is the one worth staring at. It is not an edge case or a
-- degraded state — it is a person saying "yes, train me, and no, you may not
-- see my body measurements", which the product is built to allow.

begin;

select plan(18);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b2000-0000-7000-8000-000000000001', 'Ana', 'Alvarez', 'active'),
  ('019b2000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019b2000-0000-7000-8000-000000000101', 'gym', 'Decide Gym',
  '{"party_kind":"legal_entity","party_name":"Decide SAS","purpose":"studio_operations"}'
);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019b2000-0000-7000-8000-000000000201', '019b2000-0000-7000-8000-000000000101',
  '019b2000-0000-7000-8000-000000000011', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values ('019b2000-0000-7000-8000-000000000201', 'owner');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values
  ('019b2000-0000-7000-8000-000000000301', 'relationship_training', 1, 'published', clock_timestamp()),
  ('019b2000-0000-7000-8000-000000000302', 'body_progress', 1, 'published', clock_timestamp()),
  ('019b2000-0000-7000-8000-000000000303', 'health_context', 1, 'published', clock_timestamp());

-- The gym asks for three things.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select is(
  (select count(*) from identity.issue_client_invitation(
      '019b2000-0000-7000-8000-000000000011',
      '019b2000-0000-7000-8000-000000000101',
      'email', 'ana@example.test',
      '[{"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar",
         "presented_snapshot":{"title":"Entrenamiento"}},
        {"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
         "presented_snapshot":{"title":"Progreso"}},
        {"scope_code":"health_context","access_level":"read","purpose":"Seguridad",
         "presented_snapshot":{"title":"Salud"}}]'::jsonb,
      extensions.digest('client-token', 'sha256'), 1::smallint,
      '019b2000-0000-7000-8000-000000000f01',
      '019b2000-0000-7000-8000-000000000f01',
      extensions.digest('request-1', 'sha256')
    )),
  1::bigint,
  'the gym issues an invitation asking for three scopes'
);

-- The person answers: yes to training, yes to progress, and nothing at all
-- about health context.
select set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000001', true),
       set_config('app.actor_verified_email', 'ana@example.test', true);

select lives_ok(
  $$select * from identity.decide_client_invitation(
      '019b2000-0000-7000-8000-000000000001',
      extensions.digest('client-token', 'sha256'),
      (select id from identity.invitation_intents where kind = 'service_relationship'),
      'accepted',
      '{"relationship_training":"accepted","body_progress":"accepted"}'::jsonb,
      '019b2000-0000-7000-8000-000000000f02',
      '019b2000-0000-7000-8000-000000000f02',
      extensions.digest('request-2', 'sha256')
    )$$,
  'the person decides the invitation'
);

select is(
  (select count(*) from relationships.service_relationships
     where person_id = '019b2000-0000-7000-8000-000000000001' and status = 'active'),
  1::bigint,
  'a relationship exists'
);

-- Three decisions recorded, two grants issued: silence is not consent.
select is(
  (select count(*) from privacy.consent_events),
  3::bigint,
  'every option presented is answered, including the one left unmentioned'
);

select is(
  (select decision from privacy.consent_events where scope_code = 'health_context'),
  'rejected'::privacy.consent_decision,
  'and the unmentioned one is recorded as declined, not as pending'
);

select is(
  (select array_agg(scope_code order by scope_code) from privacy.data_grants
     where status = 'active'),
  array['body_progress', 'relationship_training'],
  'only the accepted options become grants'
);

select is(
  (select count(*) from privacy.data_grants where scope_code = 'health_context'),
  0::bigint,
  'a declined option grants nothing at all'
);

-- The grant carries the level and purpose that were offered, not a default.
select is(
  (select access_level from privacy.data_grants where scope_code = 'relationship_training'),
  'contribute'::privacy.access_level,
  'a grant keeps the level the offer named'
);

select is(
  (select purpose from privacy.data_grants where scope_code = 'body_progress'),
  'Seguimiento',
  'and the purpose it was granted for'
);

-- Every grant points at the decision that created it.
select is(
  (select count(*) from privacy.data_grants as grant_row
     join privacy.consent_events as consent on consent.id = grant_row.consent_event_id
     where consent.decision = 'accepted'),
  2::bigint,
  'each grant cites the acceptance that produced it'
);

select is(
  (select status from identity.invitations),
  'completed'::identity.invitation_status,
  'the invitation closes once nothing is left to answer'
);

-- A retry with the same key changes nothing.
select is(
  (select replayed from identity.decide_client_invitation(
      '019b2000-0000-7000-8000-000000000001',
      extensions.digest('client-token', 'sha256'),
      (select id from identity.invitation_intents where kind = 'service_relationship'),
      'accepted',
      '{"relationship_training":"accepted","body_progress":"accepted"}'::jsonb,
      '019b2000-0000-7000-8000-000000000f02',
      '019b2000-0000-7000-8000-000000000f02',
      extensions.digest('request-2', 'sha256')
    )),
  true,
  'a retry replays rather than deciding twice'
);

select is(
  (select count(*) from privacy.data_grants),
  2::bigint,
  'and creates no second set of grants'
);

-- Someone else holding the token cannot answer for the person it names.
select set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000011', true),
       set_config('app.actor_verified_email', 'olivia@example.test', true);

select throws_ok(
  $$select * from identity.decide_client_invitation(
      '019b2000-0000-7000-8000-000000000011',
      extensions.digest('client-token', 'sha256'),
      (select id from identity.invitation_intents where kind = 'service_relationship'),
      'accepted', '{}'::jsonb,
      '019b2000-0000-7000-8000-000000000f03',
      '019b2000-0000-7000-8000-000000000f03',
      extensions.digest('request-3', 'sha256')
    )$$,
  '42501',
  'verified email mismatch',
  'holding the token is not enough: it must be your verified address'
);

/*
 * Declining. The branch the linter found broken and no test had run: saying no
 * to the relationship declines everything it was asking for, leaves no
 * relationship and no grant, and records the refusal rather than leaving the
 * options open forever.
 */
select set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000011', true),
       set_config('app.actor_verified_email', 'olivia@example.test', true);

select is(
  (select count(*) from identity.issue_client_invitation(
      '019b2000-0000-7000-8000-000000000011',
      '019b2000-0000-7000-8000-000000000101',
      'email', 'bruno@example.test',
      '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
         "presented_snapshot":{"title":"Progreso"}}]'::jsonb,
      extensions.digest('second-token', 'sha256'), 1::smallint,
      '019b2000-0000-7000-8000-000000000f04',
      '019b2000-0000-7000-8000-000000000f04',
      extensions.digest('request-4', 'sha256')
    )),
  1::bigint,
  'a second person is invited'
);

select set_config('app.actor_person_id', '019b2000-0000-7000-8000-000000000001', true),
       set_config('app.actor_verified_email', 'bruno@example.test', true);

select lives_ok(
  $$select * from identity.decide_client_invitation(
      '019b2000-0000-7000-8000-000000000001',
      extensions.digest('second-token', 'sha256'),
      (select intent.id from identity.invitation_intents as intent
         join identity.invitations as invitation on invitation.id = intent.invitation_id
        where invitation.contact::text = 'bruno@example.test'),
      'rejected', '{}'::jsonb,
      '019b2000-0000-7000-8000-000000000f05',
      '019b2000-0000-7000-8000-000000000f05',
      extensions.digest('request-5', 'sha256')
    )$$,
  'the person may decline the invitation outright'
);

select is(
  (select count(*) from relationships.service_relationships),
  1::bigint,
  'declining creates no relationship'
);

select is(
  (select count(*) from privacy.invitation_scope_options where decision is null),
  0::bigint,
  'and leaves no option waiting for an answer that will never come'
);

select * from finish();

rollback;
