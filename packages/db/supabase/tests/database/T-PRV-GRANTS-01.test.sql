-- T-PRV-GRANTS-01 — IX-05, IX-07; supports OP-REL-011.
--
-- What a consent leaves in force, and the four ways it must refuse to change.
--
-- The distinction the whole design rests on: ending a relationship *freezes* a
-- grant, so the organization keeps what it already had and nothing after the
-- cut; the person revoking *revokes* it, and that ends all access. Neither is
-- the other's synonym, and neither road goes backwards.

begin;

select plan(13);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b0000-0000-7000-8000-000000000001', 'Ana', 'Alvarez', 'active'),
  ('019b0000-0000-7000-8000-000000000011', 'Olivia', 'Owner', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019b0000-0000-7000-8000-000000000101', 'gym', 'Grants Gym',
  '{"party_kind":"legal_entity","party_name":"Grants SAS","purpose":"studio_operations"}'
);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019b0000-0000-7000-8000-000000000201', '019b0000-0000-7000-8000-000000000101',
  '019b0000-0000-7000-8000-000000000011', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values ('019b0000-0000-7000-8000-000000000201', 'owner');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019b0000-0000-7000-8000-000000000301', 'body_progress', 1, 'published', clock_timestamp());

insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party, status, expires_at
) values (
  '019b0000-0000-7000-8000-000000000401', '019b0000-0000-7000-8000-000000000101',
  '019b0000-0000-7000-8000-000000000201', 'email', 'ana@example.test',
  extensions.digest('token', 'sha256'), 1, extensions.digest('proposal', 'sha256'),
  '{"party_kind":"legal_entity","party_name":"Grants SAS","purpose":"studio_operations"}',
  'completed', clock_timestamp() + interval '7 days'
);

insert into identity.invitation_intents (id, invitation_id, kind, status, proposed_role_code)
values ('019b0000-0000-7000-8000-000000000501', '019b0000-0000-7000-8000-000000000401',
  'service_relationship', 'pending', null);

insert into privacy.invitation_scope_options (
  id, invitation_intent_id, scope_definition_id, scope_code,
  offered_access_level, purpose, presented_snapshot, decision, decided_at
) values (
  '019b0000-0000-7000-8000-000000000601', '019b0000-0000-7000-8000-000000000501',
  '019b0000-0000-7000-8000-000000000301', 'body_progress', 'read',
  'Seguimiento de progreso', '{"title":"Progreso corporal"}'::jsonb,
  'accepted', clock_timestamp()
);

insert into relationships.service_relationships (id, person_id, organization_id, status)
values ('019b0000-0000-7000-8000-000000000701', '019b0000-0000-7000-8000-000000000001',
  '019b0000-0000-7000-8000-000000000101', 'active');

insert into privacy.consent_events (
  id, person_id, relationship_id, organization_id, invitation_scope_option_id,
  scope_definition_id, scope_code, decision, presented_snapshot
) values (
  '019b0000-0000-7000-8000-000000000801', '019b0000-0000-7000-8000-000000000001',
  '019b0000-0000-7000-8000-000000000701', '019b0000-0000-7000-8000-000000000101',
  '019b0000-0000-7000-8000-000000000601', '019b0000-0000-7000-8000-000000000301',
  'body_progress', 'accepted', '{"title":"Progreso corporal"}'::jsonb
);

-- A decision is history: it can be written once and never touched again.
select throws_ok(
  $$update privacy.consent_events set decision = 'rejected'
      where id = '019b0000-0000-7000-8000-000000000801'$$,
  '42501',
  'privacy.consent_events is append-only',
  'a consent decision cannot be rewritten'
);

select throws_ok(
  $$delete from privacy.consent_events
      where id = '019b0000-0000-7000-8000-000000000801'$$,
  '42501',
  'privacy.consent_events is append-only',
  'nor deleted'
);

insert into privacy.data_grants (
  id, person_id, relationship_id, organization_id, scope_definition_id, scope_code,
  consent_event_id, access_level, purpose
) values (
  '019b0000-0000-7000-8000-000000000901', '019b0000-0000-7000-8000-000000000001',
  '019b0000-0000-7000-8000-000000000701', '019b0000-0000-7000-8000-000000000101',
  '019b0000-0000-7000-8000-000000000301', 'body_progress',
  '019b0000-0000-7000-8000-000000000801', 'read', 'Seguimiento de progreso'
);

select is(
  (select status from privacy.data_grants where id = '019b0000-0000-7000-8000-000000000901'),
  'active'::privacy.grant_status,
  'a consent leaves an active grant in force'
);

-- One live grant per scope, whatever versions came before.
select throws_ok(
  $$insert into privacy.data_grants (
      person_id, relationship_id, organization_id, scope_definition_id, scope_code,
      consent_event_id, access_level, purpose
    ) values (
      '019b0000-0000-7000-8000-000000000001', '019b0000-0000-7000-8000-000000000701',
      '019b0000-0000-7000-8000-000000000101', '019b0000-0000-7000-8000-000000000301',
      'body_progress', '019b0000-0000-7000-8000-000000000801', 'contribute', 'Otra'
    )$$,
  '23505',
  null,
  'a second live grant for the same scope is refused'
);

-- A grant cannot claim a state without the cut that state requires.
select throws_ok(
  $$update privacy.data_grants set status = 'frozen'
      where id = '019b0000-0000-7000-8000-000000000901'$$,
  '23514',
  null,
  'freezing without recording when is refused'
);

select throws_ok(
  $$update privacy.data_grants set status = 'revoked'
      where id = '019b0000-0000-7000-8000-000000000901'$$,
  '23514',
  null,
  'and so is revoking without recording when'
);

-- Ending the relationship freezes it: the organization keeps what it had.
select lives_ok(
  $$update privacy.data_grants
      set status = 'frozen', frozen_at = clock_timestamp()
      where id = '019b0000-0000-7000-8000-000000000901'$$,
  'ending the relationship freezes the grant'
);

select isnt(
  (select frozen_at from privacy.data_grants where id = '019b0000-0000-7000-8000-000000000901'),
  null,
  'and records the instant its window closes'
);

-- The road does not go backwards.
select throws_ok(
  $$update privacy.data_grants set status = 'active', frozen_at = null
      where id = '019b0000-0000-7000-8000-000000000901'$$,
  '23514',
  'a grant cannot be reopened',
  'a frozen grant cannot be reopened'
);

select throws_ok(
  $$update privacy.data_grants set frozen_at = clock_timestamp() + interval '1 day'
      where id = '019b0000-0000-7000-8000-000000000901'$$,
  '23514',
  'a recorded freeze cannot move',
  'and its window cannot be widened after the fact'
);

-- A frozen grant may still be revoked: the person changing their mind ends
-- even the historical window.
select lives_ok(
  $$update privacy.data_grants
      set status = 'revoked', revoked_at = clock_timestamp()
      where id = '019b0000-0000-7000-8000-000000000901'$$,
  'a frozen grant can still be revoked outright'
);

select throws_ok(
  $$update privacy.data_grants set status = 'frozen'
      where id = '019b0000-0000-7000-8000-000000000901'$$,
  '23514',
  'a revoked grant cannot be frozen',
  'but a revoked grant never becomes merely frozen'
);

select throws_ok(
  $$update privacy.data_grants set status = 'active', revoked_at = null
      where id = '019b0000-0000-7000-8000-000000000901'$$,
  '23514',
  'a grant cannot be reopened',
  'nor active again'
);

select * from finish();

rollback;
