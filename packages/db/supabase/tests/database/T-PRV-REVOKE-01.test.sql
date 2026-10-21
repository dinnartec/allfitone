-- T-PRV-REVOKE-01 — what she shares, and taking one category back (HU-SP-030, HU-SP-031).
--
-- OP-PRV-013 and OP-PRV-005 from Space. What must hold:
--   · she lists, per gym and category, what she accepted, what she declined and what she
--     took back — never anybody else's;
--   · she revokes one grant and only that one; the others stay as they were;
--   · a frozen grant, left by an ended relationship, can be revoked too (ADR-023);
--   · nobody else can revoke hers, and a revoked grant never comes back;
--   · the revocation is announced to the outbox without any of the data it covered;
--   · the relationship's history says she stopped sharing.
--
-- The scope versions are 901 and up so this runs beside scopes a local seed published.
-- Written before the migration and watched failing.

begin;

select plan(19);

insert into identity.people (id, given_name, family_name, status)
values
  ('019b5000-0000-7000-8000-000000000001', 'Ana', 'Alvarez', 'active'),
  ('019b5000-0000-7000-8000-000000000002', 'Bea', 'Beltrán', 'active'),
  ('019b5000-0000-7000-8000-000000000011', 'Laura', 'Gómez', 'active');

insert into organizations.organizations (id, type_code, display_name, responsible_party)
values ('019b5000-0000-7000-8000-000000000101', 'gym', 'Bodytech Chicó',
  '{"party_kind":"legal_entity","party_name":"Bodytech SAS","purpose":"studio_operations"}');

insert into organizations.organization_memberships (id, organization_id, person_id, status)
values ('019b5000-0000-7000-8000-000000000201', '019b5000-0000-7000-8000-000000000101',
        '019b5000-0000-7000-8000-000000000011', 'active');
insert into organizations.membership_roles (membership_id, role_code)
values ('019b5000-0000-7000-8000-000000000201', 'owner');

insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
values ('019b5000-0000-7000-8000-000000000301', 'relationship_training', 901, 'published', clock_timestamp()),
       ('019b5000-0000-7000-8000-000000000302', 'body_progress', 901, 'published', clock_timestamp()),
       ('019b5000-0000-7000-8000-000000000303', 'nutrition_intake', 901, 'published', clock_timestamp());

-- Laura invites Ana, asking for three categories.
select set_config('app.actor_kind', 'person', true),
       set_config('app.actor_person_id', '019b5000-0000-7000-8000-000000000011', true),
       set_config('app.request_id', gen_random_uuid()::text, true);

select identity.issue_client_invitation(
  '019b5000-0000-7000-8000-000000000011', '019b5000-0000-7000-8000-000000000101',
  'email', 'ana@example.test',
  '[{"scope_code":"relationship_training","access_level":"contribute","purpose":"Entrenar","presented_snapshot":{"title":"Entrenamiento"}},
    {"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento","presented_snapshot":{"title":"Medidas del cuerpo"}},
    {"scope_code":"nutrition_intake","access_level":"read","purpose":"Orientarte","presented_snapshot":{"title":"Tus comidas"}}]'::jsonb,
  extensions.digest('token-ana', 'sha256'), 1::smallint,
  '019b5000-0000-7000-8000-000000000f01', '019b5000-0000-7000-8000-000000000f01',
  extensions.digest('issue-ana', 'sha256'));

-- She shares training and measurements, and declines her meals.
select set_config('app.actor_person_id', '019b5000-0000-7000-8000-000000000001', true),
       set_config('app.actor_verified_email', 'ana@example.test', true);

select intent_status from identity.decide_client_invitation(
  '019b5000-0000-7000-8000-000000000001', extensions.digest('token-ana', 'sha256'),
  (select intent.id from identity.invitation_intents as intent
   join identity.invitations as invitation on invitation.id = intent.invitation_id
   where invitation.contact = 'ana@example.test'),
  'accepted',
  '{"relationship_training":"accepted","body_progress":"accepted","nutrition_intake":"rejected"}'::jsonb,
  '019b5000-0000-7000-8000-000000000f02', '019b5000-0000-7000-8000-000000000f02',
  extensions.digest('ana-decides', 'sha256'));

select id as relationship from relationships.service_relationships
where person_id = '019b5000-0000-7000-8000-000000000001' \gset
select id as training from privacy.data_grants
where relationship_id = :'relationship'::uuid and scope_code = 'relationship_training' \gset
select id as measures from privacy.data_grants
where relationship_id = :'relationship'::uuid and scope_code = 'body_progress' \gset

-- ------------------------------------------------------------------ what she shares

select is(
  (select array_agg(scope_code || ':' || decision || ':' || coalesce(grant_status, '-') order by scope_code)
   from privacy.list_my_consents('019b5000-0000-7000-8000-000000000001')),
  array['body_progress:accepted:active', 'nutrition_intake:rejected:-',
        'relationship_training:accepted:active'],
  'T-PRV-REVOKE-01 she sees each category she was asked for: what she shares and what she declined');

select is(
  (select presented_snapshot ->> 'title'
   from privacy.list_my_consents('019b5000-0000-7000-8000-000000000001')
   where scope_code = 'nutrition_intake'),
  'Tus comidas',
  'T-PRV-REVOKE-02 under the title the gym showed her');

select is(
  (select organization_name || ':' || relationship_status
   from privacy.list_my_consents('019b5000-0000-7000-8000-000000000001')
   where scope_code = 'relationship_training'),
  'Bodytech Chicó:active',
  'T-PRV-REVOKE-03 grouped by the gym and how the relationship stands');

select set_config('app.actor_person_id', '019b5000-0000-7000-8000-000000000002', true),
       set_config('app.actor_verified_email', 'bea@example.test', true);

select throws_ok(
  $$ select * from privacy.list_my_consents('019b5000-0000-7000-8000-000000000001') $$,
  '42501', null,
  'T-PRV-REVOKE-04 nobody else lists hers');

select is(
  (select count(*)::integer from privacy.list_my_consents('019b5000-0000-7000-8000-000000000002')),
  0,
  'T-PRV-REVOKE-05 and listing one''s own never returns hers');

select throws_ok(
  format($$ select * from privacy.revoke_my_grant(
       '019b5000-0000-7000-8000-000000000002', %L,
       '019b5000-0000-7000-8000-000000000f03', '019b5000-0000-7000-8000-000000000f03',
       extensions.digest('bea-takes-it', 'sha256')) $$, :'training'),
  'P0002', null,
  'T-PRV-REVOKE-06 nobody else revokes hers, and is not told it exists');

-- ------------------------------------------------------------------ taking one back

select set_config('app.actor_person_id', '019b5000-0000-7000-8000-000000000001', true),
       set_config('app.actor_verified_email', 'ana@example.test', true);

select is(
  (select array[status, replayed::text]
   from privacy.revoke_my_grant(
     '019b5000-0000-7000-8000-000000000001', :'training'::uuid,
     '019b5000-0000-7000-8000-000000000f04', '019b5000-0000-7000-8000-000000000f04',
     extensions.digest('ana-revokes', 'sha256'))),
  array['revoked', 'false'],
  'T-PRV-REVOKE-07 she revokes one category');

select is(
  (select status::text from privacy.data_grants where id = :'measures'::uuid),
  'active',
  'T-PRV-REVOKE-08 the others stay exactly as they were');

select isnt(
  (select revoked_at from privacy.data_grants where id = :'training'::uuid),
  null,
  'T-PRV-REVOKE-09 the grant records when it was revoked');

select is(
  (select array[payload ->> 'scope_code', payload ->> 'scope_version']
   from system.outbox_events
   where event_type = 'privacy.grant_revoked.v1' and aggregate_id = :'training'::uuid),
  array['relationship_training', '901'],
  'T-PRV-REVOKE-10 the revocation is announced in the same transaction');

select is(
  (select array_agg(key order by key)
   from system.outbox_events, jsonb_object_keys(payload) as key
   where event_type = 'privacy.grant_revoked.v1' and aggregate_id = :'training'::uuid),
  array['grant_id', 'organization_id', 'relationship_id', 'revoked_at', 'scope_code', 'scope_version'],
  'T-PRV-REVOKE-11 and the announcement carries nothing the category covered');

select is(
  (select array[status, replayed::text]
   from privacy.revoke_my_grant(
     '019b5000-0000-7000-8000-000000000001', :'training'::uuid,
     '019b5000-0000-7000-8000-000000000f04', '019b5000-0000-7000-8000-000000000f04',
     extensions.digest('ana-revokes', 'sha256'))),
  array['revoked', 'true'],
  'T-PRV-REVOKE-12 the same command again is the same answer');

select throws_ok(
  format($$ select * from privacy.revoke_my_grant(
       '019b5000-0000-7000-8000-000000000001', %L,
       '019b5000-0000-7000-8000-000000000f05', '019b5000-0000-7000-8000-000000000f05',
       extensions.digest('ana-revokes-again', 'sha256')) $$, :'training'),
  'P0004', null,
  'T-PRV-REVOKE-13 a new command on a revoked grant is refused: there is nothing left to cut');

select throws_ok(
  format($$ update privacy.data_grants set status = 'active', revoked_at = null where id = %L $$, :'training'),
  null, null,
  'T-PRV-REVOKE-14 a revoked grant never comes back: sharing again needs a new consent');

select is(
  (select grant_status || ':' || (revoked_at is not null)::text
   from privacy.list_my_consents('019b5000-0000-7000-8000-000000000001')
   where scope_code = 'relationship_training'),
  'revoked:true',
  'T-PRV-REVOKE-15 her list says she stopped sharing it');

select is(
  (select count(*)::integer
   from jsonb_array_elements(
     relationships.read_relationship_history(
       '019b5000-0000-7000-8000-000000000001', null, :'relationship'::uuid, 50, null) -> 'data') as event
   where event ->> 'type' = 'grant_revoked'
     and event -> 'detail' ->> 'scope_code' = 'relationship_training'),
  1,
  'T-PRV-REVOKE-16 the relationship''s history says she stopped sharing it');

-- ------------------------------------------------------------------ after the relationship

select ended_at from relationships.end_my_relationship(
  '019b5000-0000-7000-8000-000000000001', :'relationship'::uuid, null,
  '019b5000-0000-7000-8000-000000000f06', '019b5000-0000-7000-8000-000000000f06',
  extensions.digest('ana-ends', 'sha256'));

select is(
  (select array[status, replayed::text]
   from privacy.revoke_my_grant(
     '019b5000-0000-7000-8000-000000000001', :'measures'::uuid,
     '019b5000-0000-7000-8000-000000000f07', '019b5000-0000-7000-8000-000000000f07',
     extensions.digest('ana-revokes-frozen', 'sha256'))),
  array['revoked', 'false'],
  'T-PRV-REVOKE-17 what an ended gym kept can still be taken back');

select throws_ok(
  $$ select * from privacy.revoke_my_grant(
       '019b5000-0000-7000-8000-000000000001', '019b5000-0000-7000-8000-00000000dead',
       '019b5000-0000-7000-8000-000000000f08', '019b5000-0000-7000-8000-000000000f08',
       extensions.digest('ana-revokes-nothing', 'sha256')) $$,
  'P0002', null,
  'T-PRV-REVOKE-18 a grant that does not exist reads the same as somebody else''s');

select ok(
  has_function_privilege('allfit_api', 'privacy.list_my_consents(uuid)', 'execute')
  and has_function_privilege('allfit_api', 'privacy.revoke_my_grant(uuid, uuid, uuid, uuid, bytea)', 'execute')
  and not has_function_privilege('public', 'privacy.revoke_my_grant(uuid, uuid, uuid, uuid, bytea)', 'execute'),
  'T-PRV-REVOKE-19 only the API runs them');

select * from finish();

rollback;
