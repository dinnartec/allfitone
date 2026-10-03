-- T-IDN-CLIENT-RESEND-01 — NEW-IDN-RESEND / OP-IDN-051: resending a gym's client
-- invitation from Backoffice.
--
-- `HU-BO-011`, the client half. The team and ownership halves are `T-IDN-RESEND-01`;
-- the verification half has nothing to resend until Space can change a contact.
--
-- **A client invitation is an offer, and resending it must offer the same thing.**
-- That is the whole risk here. A team invitation proposes a role, one column the
-- reissue copies; a client invitation proposes a set of scopes that live in another
-- schema under a policy written for the organization and the invited person — not
-- for support. Copy them without being able to read them and the reissue goes out
-- offering **nothing**, with a 200 and a cheerful message. So two things are tested:
-- that support can read the offer, and that the database refuses a reissue whose
-- offer does not match, even when the writer owns the tables.
--
-- **Only what is still pending goes out again**, same as the team half: a live one
-- is redelivered, a lapsed one is reissued once and the lapsed one stays lapsed, and
-- an accepted one is never resent.

begin;

select plan(31);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b3000-0000-7000-8000-000000000001', 'Owner', 'Uno', 'active'),
  ('019b3000-0000-7000-8000-000000000002', 'Support', 'Dos', 'active'),
  ('019b3000-0000-7000-8000-000000000003', 'Badged', 'Tres', 'active'),
  ('019b3000-0000-7000-8000-000000000004', 'Admin', 'Cuatro', 'active'),
  ('019b3000-0000-7000-8000-000000000005', 'Admin', 'Cinco', 'active'),
  ('019b3000-0000-7000-8000-000000000006', 'Client', 'Seis', 'active');

insert into identity.access_accounts (id, provider, issuer, subject, person_id)
values
  ('019b3000-0000-7000-8000-000000000021', 'workos', 'https://issuer.test', 'cuatro_cr', null),
  ('019b3000-0000-7000-8000-000000000022', 'workos', 'https://issuer.test', 'cinco_cr', null),
  ('019b3000-0000-7000-8000-000000000023', 'workos', 'https://issuer.test', 'dos_cr',
    '019b3000-0000-7000-8000-000000000002'),
  ('019b3000-0000-7000-8000-000000000024', 'workos', 'https://issuer.test', 'tres_cr',
    '019b3000-0000-7000-8000-000000000003');

select support.bootstrap_backoffice_administrators(
  '019b3000-0000-7000-8000-000000000004', 'cuatro_cr',
  '019b3000-0000-7000-8000-000000000005', 'cinco_cr',
  'https://issuer.test', clock_timestamp() + interval '30 days', 'CEREMONY-IDN-CLIENT-RESEND-01'
);

insert into identity.access_sessions (
  id, access_account_id, provider_session_id, surface, token_hash, token_ciphertext,
  access_token_expires_at, assurance_level, authentication_method,
  assurance_verified_at, last_activity_at, absolute_expires_at
)
select
  session_id, account_id, 'sid_' || suffix, 'backoffice', decode(repeat(hash_byte, 32), 'hex'),
  'v1.' || suffix, clock_timestamp() + interval '5 minutes', 2, 'password_totp',
  clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '8 hours'
from (values
  ('019b3000-0000-7000-8000-000000000041'::uuid, '019b3000-0000-7000-8000-000000000021'::uuid,
    'cuatro_cr', 'c4'),
  ('019b3000-0000-7000-8000-000000000042'::uuid, '019b3000-0000-7000-8000-000000000023'::uuid,
    'dos_cr', 'c2'),
  ('019b3000-0000-7000-8000-000000000043'::uuid, '019b3000-0000-7000-8000-000000000024'::uuid,
    'tres_cr', 'c3')
) as session_row(session_id, account_id, suffix, hash_byte);

select support.assign_platform_role(
  '019b3000-0000-7000-8000-000000000004', '019b3000-0000-7000-8000-000000000041',
  person_id, 'allfit_admin', key, command, decode(repeat(hash_byte, 32), 'hex')
)
from (values
  ('019b3000-0000-7000-8000-000000000002'::uuid, '019b3000-0000-7000-8000-000000000102'::uuid,
    '019b3000-0000-7000-8000-000000000202'::uuid, '72'),
  ('019b3000-0000-7000-8000-000000000003'::uuid, '019b3000-0000-7000-8000-000000000103'::uuid,
    '019b3000-0000-7000-8000-000000000203'::uuid, '73')
) as grant_row(person_id, key, command, hash_byte);

-- Only one of the two support people carries the duty that resends.
select support.assign_platform_duty(
  '019b3000-0000-7000-8000-000000000004', '019b3000-0000-7000-8000-000000000041',
  '019b3000-0000-7000-8000-000000000002', 'diagnose_support_metadata',
  clock_timestamp(), clock_timestamp() + interval '30 days', 'CASE-2026-011',
  '019b3000-0000-7000-8000-000000000112', '019b3000-0000-7000-8000-000000000212',
  decode(repeat('82', 32), 'hex')
);

insert into organizations.organizations (id, type_code, display_name, responsible_party, status)
values (
  '019b3000-0000-7000-8000-000000000301', 'gym', 'Reenvio Cliente',
  '{"party_kind":"legal_entity","party_name":"Reenvio SAS","purpose":"studio_operations"}',
  'active'
);

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019b3000-0000-7000-8000-000000000311', '019b3000-0000-7000-8000-000000000301',
  '019b3000-0000-7000-8000-000000000001', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values ('019b3000-0000-7000-8000-000000000311', 'owner');

-- A machine where the catalogue has already been published keeps what it has: the
-- offer must be read from whatever version is newest, which is what the command
-- itself freezes onto the option.
insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values
  ('019b3000-0000-7000-8000-000000000401', 'relationship_training', 1, 'published', clock_timestamp()),
  ('019b3000-0000-7000-8000-000000000402', 'body_progress', 1, 'published', clock_timestamp()),
  ('019b3000-0000-7000-8000-000000000403', 'health_context', 1, 'published', clock_timestamp())
on conflict do nothing;

create temporary table offered_version on commit drop as
select scope_code, (
  select newest.id from privacy.scope_definitions as newest
  where newest.scope_code = asked.scope_code and newest.status = 'published'
  order by newest.version_number desc
  limit 1
) as definition_id
from (values ('relationship_training'), ('body_progress'), ('health_context'))
  as asked(scope_code);

-- ---------------------------------------------------------------------------
-- The gym invites three people as clients
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000001', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

-- Live: two scopes, one of them at `contribute`.
select * from identity.issue_client_invitation(
  '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000301',
  'email', 'live.client@example.test',
  '[{"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar",
     "presented_snapshot":{"title":"Entrenamiento"}},
    {"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento",
     "presented_snapshot":{"title":"Progreso"}}]'::jsonb,
  extensions.digest('T-IDN-CLIENT-RESEND-01 live', 'sha256'), 1::smallint,
  'f0000000-0000-4000-8000-000000000001', '019b3000-0000-7000-8000-000000000501',
  decode(repeat('f1', 32), 'hex')
);

-- To be lapsed and then reissued.
select * from identity.issue_client_invitation(
  '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000301',
  'email', 'lapsed.client@example.test',
  '[{"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar",
     "presented_snapshot":{"title":"Entrenamiento"}},
    {"scope_code":"health_context","access_level":"read","purpose":"Seguridad",
     "presented_snapshot":{"title":"Salud"}}]'::jsonb,
  extensions.digest('T-IDN-CLIENT-RESEND-01 lapsed', 'sha256'), 1::smallint,
  'f0000000-0000-4000-8000-000000000002', '019b3000-0000-7000-8000-000000000502',
  decode(repeat('f2', 32), 'hex')
);

-- To be accepted.
select * from identity.issue_client_invitation(
  '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000301',
  'email', 'taken.client@example.test',
  '[{"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar",
     "presented_snapshot":{"title":"Entrenamiento"}}]'::jsonb,
  extensions.digest('T-IDN-CLIENT-RESEND-01 taken', 'sha256'), 1::smallint,
  'f0000000-0000-4000-8000-000000000003', '019b3000-0000-7000-8000-000000000503',
  decode(repeat('f3', 32), 'hex')
);

-- A team invitation in the same gym, so the two lists are shown not to bleed.
select * from identity.issue_staff_invitation(
  '019b3000-0000-7000-8000-000000000001', '019b3000-0000-7000-8000-000000000301',
  'email', 'coach@example.test', 'coach',
  extensions.digest('T-IDN-CLIENT-RESEND-01 coach', 'sha256'), 1::smallint,
  'f0000000-0000-4000-8000-000000000004', '019b3000-0000-7000-8000-000000000504',
  decode(repeat('f4', 32), 'hex')
);

-- The third person accepts.
select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000006', true),
       set_config('app.actor_verified_email', 'taken.client@example.test', true);
select * from identity.decide_client_invitation(
  '019b3000-0000-7000-8000-000000000006',
  extensions.digest('T-IDN-CLIENT-RESEND-01 taken', 'sha256'),
  (select intent.id from identity.invitation_intents as intent
     join identity.invitations as invitation on invitation.id = intent.invitation_id
    where invitation.contact::text = 'taken.client@example.test'),
  'accepted', '{"relationship_training":"accepted"}'::jsonb,
  'f0000000-0000-4000-8000-000000000005', '019b3000-0000-7000-8000-000000000505',
  decode(repeat('f5', 32), 'hex')
);

-- And the second one lapses.
update identity.invitations
set created_at = clock_timestamp() - interval '8 days',
    expires_at = clock_timestamp() - interval '1 day'
where contact::text = 'lapsed.client@example.test';

select set_config('app.actor_verified_email', '', true);

-- ---------------------------------------------------------------------------
-- Who may read and resend
-- ---------------------------------------------------------------------------

select set_config('app.actor_kind', 'support', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000003', true);

select throws_ok(
  $$ select identity.list_backoffice_client_invitations(
    '019b3000-0000-7000-8000-000000000003', '019b3000-0000-7000-8000-000000000043',
    '019b3000-0000-7000-8000-000000000301'
  ) $$,
  '42501',
  null,
  'the base role alone does not see a gym''s client invitations'
);

-- The same read, by the person the duty belongs to, from a session that is not theirs.
select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000002', true);

select throws_ok(
  $$ select identity.list_backoffice_client_invitations(
    '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000043',
    '019b3000-0000-7000-8000-000000000301'
  ) $$,
  '42501',
  null,
  'a session that is not the operator''s own opens nothing'
);

select throws_ok(
  $$ select identity.list_backoffice_client_invitations(
    '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000042',
    '019b3000-0000-7000-8000-000000009999'
  ) $$,
  'P0002',
  null,
  'a gym that does not exist is not found'
);

-- ---------------------------------------------------------------------------
-- What support sees
-- ---------------------------------------------------------------------------

create temporary table client_list on commit drop as
select identity.list_backoffice_client_invitations(
  '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000042',
  '019b3000-0000-7000-8000-000000000301'
) as payload;

select is(
  (select jsonb_array_length(payload->'items') from client_list),
  3,
  'the three client invitations are listed'
);

select is(
  (select count(*) from client_list, jsonb_array_elements(payload->'items') as item
    where item->>'contact_hint' like '%coach%'),
  0::bigint,
  'and the gym''s team invitation is not among them'
);

select is(
  (select payload::text like '%live.client@example.test%' from client_list),
  false,
  'no full address travels: the contact is only a hint'
);

-- The offer is the point of a client invitation, so the list carries it. Picked by
-- identifier, not by hint: a hint is not unique, which is rather the idea.
select is(
  (select item->'scope_codes' from client_list, jsonb_array_elements(payload->'items') as item
    where item->>'invitation_id' = '019b3000-0000-7000-8000-000000000501'),
  '["body_progress", "relationship_training"]'::jsonb,
  'each invitation says which scopes it asked for'
);

select is(
  (select item->>'state' from client_list, jsonb_array_elements(payload->'items') as item
    where item->>'invitation_id' = '019b3000-0000-7000-8000-000000000503'),
  'accepted',
  'the accepted one reads as accepted'
);

select is(
  (select item->'resendable' from client_list, jsonb_array_elements(payload->'items') as item
    where item->>'invitation_id' = '019b3000-0000-7000-8000-000000000503'),
  'false'::jsonb,
  'and offers no resend'
);

-- ---------------------------------------------------------------------------
-- A live invitation is redelivered
-- ---------------------------------------------------------------------------

create temporary table redelivery on commit drop as
select * from identity.resend_client_invitation(
  '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000042',
  '019b3000-0000-7000-8000-000000000301', '019b3000-0000-7000-8000-000000000501',
  extensions.digest('T-IDN-CLIENT-RESEND-01 r1', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000001', '019b3000-0000-7000-8000-000000000601',
  decode(repeat('a1', 32), 'hex')
);

select is(
  (select result->>'outcome' from redelivery),
  'redelivered',
  'a live client invitation goes out as itself'
);

select is(
  (select result->>'invitation_id' from redelivery),
  '019b3000-0000-7000-8000-000000000501',
  'the same invitation, so the first email keeps working'
);

select is(
  (select count(*) from identity.invitations
    where reissues_invitation_id = '019b3000-0000-7000-8000-000000000501'),
  0::bigint,
  'and nothing replaces it'
);

select is(
  (select kind::text from identity.invitation_resends
    where invitation_id = '019b3000-0000-7000-8000-000000000501'),
  'service_relationship',
  'the record says which kind of message went out'
);

-- The same command again changes nothing and sends nothing.
select is(
  (select replayed from identity.resend_client_invitation(
    '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000042',
    '019b3000-0000-7000-8000-000000000301', '019b3000-0000-7000-8000-000000000501',
    extensions.digest('T-IDN-CLIENT-RESEND-01 r1', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000001', '019b3000-0000-7000-8000-000000000601',
    decode(repeat('a1', 32), 'hex')
  )),
  true,
  'replaying the command replays the answer'
);

select is(
  (select count(*) from identity.invitation_resends
    where invitation_id = '019b3000-0000-7000-8000-000000000501'),
  1::bigint,
  'and records a single resend, not two'
);

-- ---------------------------------------------------------------------------
-- A lapsed invitation is reissued, offering exactly what it offered
-- ---------------------------------------------------------------------------

create temporary table reissue on commit drop as
select * from identity.resend_client_invitation(
  '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000042',
  '019b3000-0000-7000-8000-000000000301', '019b3000-0000-7000-8000-000000000502',
  extensions.digest('T-IDN-CLIENT-RESEND-01 r2', 'sha256'), 1::smallint,
  'a0000000-0000-4000-8000-000000000002', '019b3000-0000-7000-8000-000000000602',
  decode(repeat('a2', 32), 'hex')
);

select is(
  (select result->>'outcome' from reissue),
  'reissued',
  'a lapsed client invitation is replaced'
);

select is(
  (select status::text from identity.invitations where id = '019b3000-0000-7000-8000-000000000502'),
  'expired',
  'the lapsed one stays lapsed and never works again'
);

select is(
  (select reissues_invitation_id from identity.invitations
    where id = '019b3000-0000-7000-8000-000000000602'),
  '019b3000-0000-7000-8000-000000000502'::uuid,
  'the replacement points at what it replaces'
);

select is(
  (select issued_by_person_id from identity.invitations
    where id = '019b3000-0000-7000-8000-000000000602'),
  '019b3000-0000-7000-8000-000000000002'::uuid,
  'Allfit signs the replacement rather than impersonating the gym'
);

-- The assertion this whole test exists for.
select is(
  (select array_agg(option.scope_code order by option.scope_code)
     from privacy.invitation_scope_options as option
     join identity.invitation_intents as intent on intent.id = option.invitation_intent_id
    where intent.invitation_id = '019b3000-0000-7000-8000-000000000602'),
  array['health_context', 'relationship_training'],
  'the replacement asks for exactly the scopes the original asked for'
);

select is(
  (select array_agg(option.offered_access_level::text order by option.scope_code)
     from privacy.invitation_scope_options as option
     join identity.invitation_intents as intent on intent.id = option.invitation_intent_id
    where intent.invitation_id = '019b3000-0000-7000-8000-000000000602'),
  array['read', 'contribute'],
  'at exactly the levels it asked for'
);

select is(
  (select array_agg(option.scope_definition_id order by option.scope_code)
     from privacy.invitation_scope_options as option
     join identity.invitation_intents as intent on intent.id = option.invitation_intent_id
    where intent.invitation_id = '019b3000-0000-7000-8000-000000000602'),
  (select array_agg(definition_id order by scope_code) from offered_version
    where scope_code in ('health_context', 'relationship_training')),
  'and under the same published version, never a later one'
);

-- The invariant is deferred, so nothing above has run it yet. Running it here proves
-- it accepts the reissue the command wrote — a check that only ever refuses is as
-- broken as one that never does.
select lives_ok(
  $$ set constraints all immediate $$,
  'and satisfies the invariant that compares it with the original'
);

-- Back to deferred: left immediate, the idempotency receipt of every command below
-- would be checked for a terminal state before the command reached one.
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- What is never resent
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from identity.resend_client_invitation(
    '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000042',
    '019b3000-0000-7000-8000-000000000301', '019b3000-0000-7000-8000-000000000502',
    extensions.digest('T-IDN-CLIENT-RESEND-01 r3', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000003', '019b3000-0000-7000-8000-000000000603',
    decode(repeat('a3', 32), 'hex')
  ) $$,
  '55000',
  null,
  'a lapsed invitation is reissued once, not twice'
);

select throws_ok(
  $$ select * from identity.resend_client_invitation(
    '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000042',
    '019b3000-0000-7000-8000-000000000301', '019b3000-0000-7000-8000-000000000503',
    extensions.digest('T-IDN-CLIENT-RESEND-01 r4', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000004', '019b3000-0000-7000-8000-000000000604',
    decode(repeat('a4', 32), 'hex')
  ) $$,
  '55000',
  null,
  'an accepted invitation is never resent'
);

select throws_ok(
  $$ select * from identity.resend_client_invitation(
    '019b3000-0000-7000-8000-000000000002', '019b3000-0000-7000-8000-000000000042',
    '019b3000-0000-7000-8000-000000000301', '019b3000-0000-7000-8000-000000000504',
    extensions.digest('T-IDN-CLIENT-RESEND-01 r5', 'sha256'), 1::smallint,
    'a0000000-0000-4000-8000-000000000005', '019b3000-0000-7000-8000-000000000605',
    decode(repeat('a5', 32), 'hex')
  ) $$,
  'P0002',
  null,
  'and the team invitation is not a client invitation this command can reach'
);

-- ---------------------------------------------------------------------------
-- The offer cannot be rewritten on the way out — not even by the owner
-- ---------------------------------------------------------------------------

-- Built on the accepted invitation, the one that is no longer pending: a second
-- pending row with the same proposal is already impossible, and what is under test
-- here is the offer, not that index. `set constraints all immediate` forces the
-- deferred check to run where it can be caught.
select throws_ok(
  $$
  insert into identity.invitations (
    id, organization_id, issued_by_person_id, issued_by_duty_assignment_id,
    reissues_invitation_id, channel, contact, token_hash, token_key_version, proposal_hash,
    responsible_party, expires_at
  )
  select '019b3000-0000-7000-8000-00000000070a', original.organization_id,
         '019b3000-0000-7000-8000-000000000002', duty.id,
         original.id, original.channel, original.contact,
         extensions.digest('tampered', 'sha256'), 1::smallint, original.proposal_hash,
         original.responsible_party, clock_timestamp() + interval '7 days'
  from identity.invitations as original
  cross join (
    select assignment.id from support.platform_duty_assignments as assignment
    where assignment.person_id = '019b3000-0000-7000-8000-000000000002'
      and assignment.duty_code = 'diagnose_support_metadata'
  ) as duty
  where original.id = '019b3000-0000-7000-8000-000000000503';

  insert into identity.invitation_intents (id, invitation_id, kind)
  values ('019b3000-0000-7000-8000-00000000070b', '019b3000-0000-7000-8000-00000000070a',
    'service_relationship');

  insert into privacy.invitation_scope_options (
    invitation_intent_id, scope_definition_id, scope_code,
    offered_access_level, purpose, presented_snapshot
  )
  select '019b3000-0000-7000-8000-00000000070b', definition_id,
    'health_context', 'read', 'Seguridad', '{"title":"Salud"}'
  from offered_version where scope_code = 'health_context';

  set constraints all immediate;
  $$,
  '23514',
  null,
  'a replacement that asks for something else is refused'
);

select throws_ok(
  $$
  insert into identity.invitations (
    id, organization_id, issued_by_person_id, issued_by_duty_assignment_id,
    reissues_invitation_id, channel, contact, token_hash, token_key_version, proposal_hash,
    responsible_party, expires_at
  )
  select '019b3000-0000-7000-8000-00000000071a', original.organization_id,
         '019b3000-0000-7000-8000-000000000002', duty.id,
         original.id, original.channel, original.contact,
         extensions.digest('empty', 'sha256'), 1::smallint, original.proposal_hash,
         original.responsible_party, clock_timestamp() + interval '7 days'
  from identity.invitations as original
  cross join (
    select assignment.id from support.platform_duty_assignments as assignment
    where assignment.person_id = '019b3000-0000-7000-8000-000000000002'
      and assignment.duty_code = 'diagnose_support_metadata'
  ) as duty
  where original.id = '019b3000-0000-7000-8000-000000000503';

  insert into identity.invitation_intents (id, invitation_id, kind)
  values ('019b3000-0000-7000-8000-00000000071b', '019b3000-0000-7000-8000-00000000071a',
    'service_relationship');

  set constraints all immediate;
  $$,
  '23514',
  null,
  'and so is one that quietly asks for nothing at all'
);

-- ---------------------------------------------------------------------------
-- Support reads the offer because a policy says so, and only then
-- ---------------------------------------------------------------------------

-- As the owner the definer functions run as, which is subject to the policies.
-- The harness itself is a superuser and would read everything either way.
set local role allfit_owner;

select isnt_empty(
  $$ select 1 from privacy.invitation_scope_options as option
     join identity.invitation_intents as intent on intent.id = option.invitation_intent_id
    where intent.invitation_id = '019b3000-0000-7000-8000-000000000501' $$,
  'the duty that resends reads what the invitation offered'
);

select set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000003', true);

select is_empty(
  $$ select 1 from privacy.invitation_scope_options as option
     join identity.invitation_intents as intent on intent.id = option.invitation_intent_id
    where intent.invitation_id = '019b3000-0000-7000-8000-000000000501' $$,
  'the base role without that duty reads none of it'
);

select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b3000-0000-7000-8000-000000000006', true),
       set_config('app.actor_verified_email', 'someone.else@example.test', true);

select is_empty(
  $$ select 1 from privacy.invitation_scope_options as option
     join identity.invitation_intents as intent on intent.id = option.invitation_intent_id
    where intent.invitation_id = '019b3000-0000-7000-8000-000000000501' $$,
  'and a person the invitation was not addressed to reads none of it either'
);

reset role;

select * from finish();

rollback;
