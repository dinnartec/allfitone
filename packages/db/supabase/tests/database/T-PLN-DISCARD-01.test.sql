-- `T-TPL-8`, `T-TPL-9` and `T-TPL-10` — discarding a programme somebody never
-- published, and finding the one they did leave behind.
--
-- What has to hold: a programme of my own goes to `archived` and loses its draft; one
-- with a published version is refused, because assignments reference that version and
-- sessions were materialised from it; discarding twice converges rather than failing;
-- and nothing is deleted from `planning.programs`, because `allfit_api` has no
-- `DELETE` on this resource and the discard does not need one.
--
-- The negatives were written first and watched succeeding: without the version guard,
-- a programme people were training from could be archived out from under them.

begin;

select plan(12);

insert into identity.people (id, given_name, family_name)
values
  ('019ed000-0000-7000-8000-000000000001', 'Quien', 'Planifica'),
  ('019ed000-0000-7000-8000-000000000002', 'Vecina', 'Ajena');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ed000-0000-7000-8000-000000000001', true);

select (planning.create_my_program(
  '019ed000-0000-7000-8000-000000000001', 'Fuerza inicial',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('d1', 32), 'hex'))).program as created \gset
select (:'created'::jsonb->>'id') as program_id \gset

select isnt(
  (select status from planning.programs where id = :'program_id'::uuid),
  'archived',
  'a programme just created is not archived'
);

select ok(
  exists (select 1 from planning.program_drafts where program_id = :'program_id'::uuid),
  'and it has a draft to lose'
);

-- The act itself.
select (planning.discard_my_program(
  '019ed000-0000-7000-8000-000000000001', :'program_id'::uuid,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('d2', 32), 'hex'))).program as discarded \gset

select is(
  (select status from planning.programs where id = :'program_id'::uuid),
  'archived',
  'T-TPL-9 · discarding archives the programme'
);

select ok(
  not exists (select 1 from planning.program_drafts where program_id = :'program_id'::uuid),
  'T-TPL-9 · and retires its draft'
);

select ok(
  exists (select 1 from planning.programs where id = :'program_id'::uuid),
  'T-TPL-9 · without deleting the row: a discard is a state, and the grant has no DELETE'
);

-- Twice converges. Somebody pressing it again, or a retry arriving late, is not an
-- error — it is the same intention reaching the same place.
select lives_ok(
  $$ select planning.discard_my_program(
       '019ed000-0000-7000-8000-000000000001',
       (select id from planning.programs where owner_person_id = '019ed000-0000-7000-8000-000000000001'),
       extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
       decode(repeat('d3', 32), 'hex')) $$,
  'discarding twice converges rather than failing'
);

-- A published programme is refused, and publishing one needs a routine to put in it.
select (planning.create_my_session_template(
  '019ed000-0000-7000-8000-000000000001', 'test_strength', 'Empuje',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('c1', 32), 'hex'))).template as template \gset
select (:'template'::jsonb->>'id') as template_id,
       (:'template'::jsonb->'draft'->>'etag') as tetag0 \gset

select (planning.replace_my_session_template_draft(
  '019ed000-0000-7000-8000-000000000001', :'template_id'::uuid, :'tetag0',
  '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":4,"target_reps":8}}]}'::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('c2', 32), 'hex'))).draft as tsaved \gset
select (:'tsaved'::jsonb->>'etag') as tetag1 \gset

select (planning.publish_my_session_template(
  '019ed000-0000-7000-8000-000000000001', :'template_id'::uuid, :'tetag1',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('c3', 32), 'hex'))).version as tversion \gset
select (:'tversion'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019ed000-0000-7000-8000-000000000001', 'Ya publicado',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('d4', 32), 'hex'))).program as second \gset
select (:'second'::jsonb->>'id') as live_id,
       (:'second'::jsonb->'draft'->>'etag') as live_etag \gset

select (planning.replace_my_program_draft(
  '019ed000-0000-7000-8000-000000000001', :'live_id'::uuid, :'live_etag',
  ('{"title":"Ya publicado","notes":null,"sessions":[{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('d5', 32), 'hex'))).draft as saved \gset
select (:'saved'::jsonb->>'etag') as live_etag2 \gset

select lives_ok(
  format($$ select planning.publish_my_program(
    '019ed000-0000-7000-8000-000000000001', %L::uuid, %L,
    extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
    decode(repeat('d6', 32), 'hex')) $$, :'live_id', :'live_etag2'),
  'a programme with days can be published'
);

select throws_ok(
  format($$ select planning.discard_my_program(
    '019ed000-0000-7000-8000-000000000001', %L::uuid,
    extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
    decode(repeat('d7', 32), 'hex')) $$, :'live_id'),
  '23514',
  'program has published versions',
  'T-TPL-8 · a programme with a published version is refused'
);

-- `OP-PLN-030`. Without it a programme draft cannot be resumed at all: assignments are
-- where every other query starts, and an unpublished programme has none.
select set_config('app.actor_person_id', '019ed000-0000-7000-8000-000000000002', true);
select is(
  planning.read_my_unpublished_program('019ed000-0000-7000-8000-000000000002'),
  null,
  'T-TPL-10 · somebody with no programme of their own is answered nothing'
);

select set_config('app.actor_person_id', '019ed000-0000-7000-8000-000000000001', true);
select (planning.create_my_program(
  '019ed000-0000-7000-8000-000000000001', 'A medias',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('d8', 32), 'hex'))).program as pending \gset
select (:'pending'::jsonb->>'id') as pending_id \gset

select is(
  planning.read_my_unpublished_program('019ed000-0000-7000-8000-000000000001')->>'id',
  :'pending_id',
  'an unpublished programme of mine is the one answered'
);

select isnt(
  planning.read_my_unpublished_program('019ed000-0000-7000-8000-000000000001')->>'id',
  :'live_id',
  'and never the published one, which is reached by its assignment'
);

select is(
  planning.read_my_unpublished_program('019ed000-0000-7000-8000-000000000002'),
  null,
  'T-TPL-10 · and it is not the neighbour who gets it'
);

select * from finish();

rollback;
