-- T-PRV-SCOPE-OPTIONS-01 — IX-06, supports OP-REL-001.
--
-- What a client invitation offers, and the three refusals that make the offer
-- trustworthy: it can only hang off a service relationship intent, it can only
-- name a published scope, and once the person has decided it cannot change.
--
-- That last one is the reason the presented snapshot is worth storing at all.
-- Evidence that can be edited after the fact is not evidence.

begin;

select plan(11);

insert into identity.people (id, given_name, family_name, status)
values ('019ae000-0000-7000-8000-000000000001', 'Olivia', 'Owner', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values (
  '019ae000-0000-7000-8000-000000000101', 'gym', 'Scope Gym',
  '{"party_kind":"legal_entity","party_name":"Scope SAS","purpose":"studio_operations"}'
);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019ae000-0000-7000-8000-000000000201', '019ae000-0000-7000-8000-000000000101',
  '019ae000-0000-7000-8000-000000000001', 'active');

insert into organizations.membership_roles (membership_id, role_code)
values ('019ae000-0000-7000-8000-000000000201', 'owner');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values
  ('019ae000-0000-7000-8000-000000000301', 'body_progress', 1, 'published', clock_timestamp()),
  ('019ae000-0000-7000-8000-000000000302', 'health_context', 1, 'draft', null);

insert into identity.invitations (
  id, organization_id, issued_by_membership_id, channel, contact,
  token_hash, token_key_version, proposal_hash, responsible_party,
  status, expires_at
) values (
  '019ae000-0000-7000-8000-000000000401', '019ae000-0000-7000-8000-000000000101',
  '019ae000-0000-7000-8000-000000000201', 'email', 'client@example.test',
  extensions.digest('token', 'sha256'), 1, extensions.digest('proposal', 'sha256'),
  '{"party_kind":"legal_entity","party_name":"Scope SAS","purpose":"studio_operations"}',
  'pending', clock_timestamp() + interval '7 days'
);

-- A membership intent carries the role it proposes; a service relationship
-- intent carries none. The second one is here only to be refused a scope.
insert into identity.invitation_intents (id, invitation_id, kind, status, proposed_role_code)
values
  ('019ae000-0000-7000-8000-000000000501', '019ae000-0000-7000-8000-000000000401',
    'service_relationship', 'pending', null),
  ('019ae000-0000-7000-8000-000000000502', '019ae000-0000-7000-8000-000000000401',
    'membership', 'pending', 'staff');

-- The offer itself: a published scope, a level and a declared purpose.
select lives_ok(
  $$insert into privacy.invitation_scope_options (
      id, invitation_intent_id, scope_definition_id, scope_code,
      offered_access_level, purpose, presented_snapshot
    ) values (
      '019ae000-0000-7000-8000-000000000601',
      '019ae000-0000-7000-8000-000000000501',
      '019ae000-0000-7000-8000-000000000301',
      'body_progress', 'read', 'Seguimiento de progreso',
      '{"title":"Progreso corporal","includes":["peso","medidas"]}'::jsonb
    )$$,
  'an option may offer a published scope on a service relationship intent'
);

select is(
  (select decision from privacy.invitation_scope_options
     where id = '019ae000-0000-7000-8000-000000000601'),
  null::privacy.consent_decision,
  'and arrives undecided, because offering is not granting'
);

-- One offer per scope: asking twice for the same category in one invitation
-- would leave two answers to the same question.
select throws_ok(
  $$insert into privacy.invitation_scope_options (
      invitation_intent_id, scope_definition_id, scope_code,
      offered_access_level, purpose, presented_snapshot
    ) values (
      '019ae000-0000-7000-8000-000000000501',
      '019ae000-0000-7000-8000-000000000301',
      'body_progress', 'contribute', 'Otra vez', '{}'::jsonb
    )$$,
  '23505',
  null,
  'the same scope cannot be offered twice in one invitation'
);

-- Data scopes have no meaning beside a staff membership.
select throws_ok(
  $$insert into privacy.invitation_scope_options (
      invitation_intent_id, scope_definition_id, scope_code,
      offered_access_level, purpose, presented_snapshot
    ) values (
      '019ae000-0000-7000-8000-000000000502',
      '019ae000-0000-7000-8000-000000000301',
      'body_progress', 'read', 'Sobre una membresía', '{}'::jsonb
    )$$,
  '23514',
  'IX-06 scope options belong to a service relationship intent',
  'an option cannot hang off a membership intent'
);

-- A scope whose wording nobody approved cannot be asked for.
select throws_ok(
  $$insert into privacy.invitation_scope_options (
      invitation_intent_id, scope_definition_id, scope_code,
      offered_access_level, purpose, presented_snapshot
    ) values (
      '019ae000-0000-7000-8000-000000000501',
      '019ae000-0000-7000-8000-000000000302',
      'health_context', 'read', 'Contexto de salud', '{}'::jsonb
    )$$,
  '23514',
  'IX-06 scope definition is not published',
  'a draft scope cannot be offered'
);

-- A decision and its timestamp arrive together or not at all.
select throws_ok(
  $$update privacy.invitation_scope_options
      set decision = 'accepted'
      where id = '019ae000-0000-7000-8000-000000000601'$$,
  '23514',
  null,
  'a decision without its timestamp is refused'
);

select throws_ok(
  $$insert into privacy.invitation_scope_options (
      invitation_intent_id, scope_definition_id, scope_code,
      offered_access_level, purpose, presented_snapshot
    ) values (
      '019ae000-0000-7000-8000-000000000501',
      '019ae000-0000-7000-8000-000000000301',
      'body_progress', 'read', '   ', '{}'::jsonb
    )$$,
  '23514',
  null,
  'a purpose of only spaces is not a declared purpose'
);

-- Deciding it is allowed exactly once.
select lives_ok(
  $$update privacy.invitation_scope_options
      set decision = 'accepted', decided_at = clock_timestamp()
      where id = '019ae000-0000-7000-8000-000000000601'$$,
  'the person may decide the option'
);

-- And then it is evidence, not a draft.
select throws_ok(
  $$update privacy.invitation_scope_options
      set purpose = 'Otra finalidad'
      where id = '019ae000-0000-7000-8000-000000000601'$$,
  '23514',
  'IX-06 a decided scope option cannot change',
  'a decided option cannot have its purpose rewritten'
);

select throws_ok(
  $$update privacy.invitation_scope_options
      set presented_snapshot = '{"title":"Otra cosa"}'::jsonb
      where id = '019ae000-0000-7000-8000-000000000601'$$,
  '23514',
  'IX-06 a decided scope option cannot change',
  'nor the snapshot of what it showed'
);

select throws_ok(
  $$update privacy.invitation_scope_options
      set decision = 'rejected'
      where id = '019ae000-0000-7000-8000-000000000601'$$,
  '23514',
  'IX-06 a decided scope option cannot change',
  'nor the decision itself'
);

select * from finish();

rollback;
