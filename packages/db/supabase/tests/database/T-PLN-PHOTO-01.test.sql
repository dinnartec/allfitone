-- `T-TPL-11`, `T-TPL-12` y los invariantes de `ADR-031` — la portada que alguien sube.
--
-- What has to hold: the bytes belong to the template they were uploaded against; a
-- neighbour cannot read them and cannot name them in her own routine; replacing destroys
-- what it replaced and says so in the disposition log; a photo a published version points
-- at survives everything, because the version is immutable and its cover has to keep
-- existing; and discarding the template takes its photos with it.
--
-- The two negatives were written first and watched succeeding. Without the ownership
-- check in the draft writer, a draft naming somebody else's photo saved cleanly; without
-- excluding published versions from the collection, publishing and then changing the
-- cover destroyed the picture the published routine was still showing.

begin;

select plan(15);

insert into identity.people (id, given_name, family_name)
values
  ('019f1000-0000-7000-8000-000000000001', 'Quien', 'Sube'),
  ('019f1000-0000-7000-8000-000000000002', 'Vecina', 'Ajena');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019f1000-0000-7000-8000-0000000000f1', 'test_strength', 'Sentadilla de prueba',
        'sentadilla de prueba', 'global', 'published');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f1000-0000-7000-8000-000000000001', true);

select (planning.create_my_session_template(
  '019f1000-0000-7000-8000-000000000001', 'test_strength', 'Pierna',
  '82f11111-1111-4111-8111-000000000001', extensions.uuid_generate_v7(),
  decode(repeat('a1', 32), 'hex'))).template as created \gset
select (:'created'::jsonb->>'id') as template_id,
       (:'created'::jsonb->'draft'->>'etag') as etag0 \gset

-- Dos subidas: la primera se elige, la segunda la sustituye.
select (planning.upload_my_cover_photo(
  '019f1000-0000-7000-8000-000000000001', :'template_id'::uuid,
  decode('52494646', 'hex'),
  '82f11111-1111-4111-8111-000000000002', extensions.uuid_generate_v7(),
  decode(repeat('a2', 32), 'hex'))).photo as first_photo \gset
select (:'first_photo'::jsonb->>'id') as photo_one \gset

select (planning.upload_my_cover_photo(
  '019f1000-0000-7000-8000-000000000001', :'template_id'::uuid,
  decode('5249464632', 'hex'),
  '82f11111-1111-4111-8111-000000000003', extensions.uuid_generate_v7(),
  decode(repeat('a3', 32), 'hex'))).photo as second_photo \gset
select (:'second_photo'::jsonb->>'id') as photo_two \gset

select is(
  (select content_type from planning.session_template_cover_photos where id = :'photo_one'::uuid),
  'image/webp',
  'a stored cover is webp, because the server is what produced it');

select is(
  (select byte_size from planning.session_template_cover_photos where id = :'photo_one'::uuid),
  4,
  'and it knows how big it is');

-- `T-TPL-12` · the neighbour reads nothing, and nothing is not an error.
select is(
  (select count(*)::integer from planning.read_my_cover_photo(
     '019f1000-0000-7000-8000-000000000002', :'photo_one'::uuid)),
  0,
  'T-TPL-12 · a neighbour reads no bytes of a photo that is not hers');

select is(
  (select count(*)::integer from planning.read_my_cover_photo(
     '019f1000-0000-7000-8000-000000000001', :'photo_one'::uuid)),
  1,
  'and the owner does');

-- `T-TPL-11` · naming somebody else's photo is refused where the person can see it.
select set_config('app.actor_person_id', '019f1000-0000-7000-8000-000000000002', true);

select (planning.create_my_session_template(
  '019f1000-0000-7000-8000-000000000002', 'test_strength', 'De la vecina',
  '82f11111-1111-4111-8111-000000000004', extensions.uuid_generate_v7(),
  decode(repeat('a4', 32), 'hex'))).template as hers \gset
select (:'hers'::jsonb->>'id') as her_template_id,
       (:'hers'::jsonb->'draft'->>'etag') as her_etag \gset

select throws_ok(
  format($$ select planning.replace_my_session_template_draft(
    '019f1000-0000-7000-8000-000000000002', %L::uuid, %L,
    '{"title":"De la vecina","activity_type_id":null,"cover":{"kind":"photo","photo_id":"%s"},"steps":[]}'::jsonb,
    %L, extensions.uuid_generate_v7(), decode(repeat('a5', 32), 'hex')) $$,
    :'her_template_id', :'her_etag', :'photo_one', '82f11111-1111-4111-8111-000000000005'),
  '22023',
  'invalid session template draft',
  'T-TPL-11 · a draft may not name a photo that belongs to somebody else');

select set_config('app.actor_person_id', '019f1000-0000-7000-8000-000000000001', true);

-- The routine takes the first photo, and is published with it.
select (planning.replace_my_session_template_draft(
  '019f1000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag0',
  format('{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","cover":{"kind":"photo","photo_id":"%s"},"steps":[{"position":1,"movement_id":"019f1000-0000-7000-8000-0000000000f1","target":{"family":"strength","target_sets":3,"target_reps":10}}]}', :'photo_one')::jsonb,
  '82f11111-1111-4111-8111-000000000006', extensions.uuid_generate_v7(),
  decode(repeat('a6', 32), 'hex'))).draft as saved \gset
select (:'saved'::jsonb->>'etag') as etag1 \gset

select is(
  (select count(*)::integer from planning.session_template_cover_photos where template_id = :'template_id'::uuid),
  1,
  'saving the draft collects the upload nothing ended up naming');

select is(
  (select count(*)::integer from privacy.binary_disposals
   where object_id = :'photo_two'::uuid and reason = 'replaced'),
  1,
  'ADR-031 · and the destruction leaves a typed trace of who it belonged to');

select (planning.publish_my_session_template(
  '019f1000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag1',
  '82f11111-1111-4111-8111-000000000007', extensions.uuid_generate_v7(),
  decode(repeat('a7', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as version_id \gset

select is(
  (select cover_photo_id from planning.session_template_versions where id = :'version_id'::uuid),
  :'photo_one'::uuid,
  'publishing pins the photo onto the immutable version');

select is(
  planning.session_version_projection(:'version_id'::uuid)->'cover'->>'kind',
  'photo',
  'and the projection says what kind of cover it is');

-- The one that matters: changing the cover afterwards must not destroy what the
-- published routine is still showing.
select (planning.replace_my_session_template_draft(
  '019f1000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag1',
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","cover":{"kind":"icon","icon":"strength"},"steps":[{"position":1,"movement_id":"019f1000-0000-7000-8000-0000000000f1","target":{"family":"strength","target_sets":3,"target_reps":10}}]}'::jsonb,
  '82f11111-1111-4111-8111-000000000008', extensions.uuid_generate_v7(),
  decode(repeat('a8', 32), 'hex'))).draft as moved \gset

select ok(
  exists (select 1 from planning.session_template_cover_photos where id = :'photo_one'::uuid),
  'ADR-031 · a photo a published version points at survives the cover changing');

select is(
  (select count(*)::integer from privacy.binary_disposals where object_id = :'photo_one'::uuid),
  0,
  'and nothing was disposed of that was still referenced');

-- What the list draws.
select is(
  (select mine.item->'cover'->>'kind' from jsonb_array_elements(
     planning.read_my_content('019f1000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'template_id'),
  'icon',
  'my list carries the cover I last chose, not the published one');

select is(
  (select count(*)::integer from jsonb_array_elements(
     planning.read_my_content('019f1000-0000-7000-8000-000000000002')) as hers(item)
   where hers.item->>'template_id' = :'template_id'),
  0,
  'T-TPL-11 · and a neighbour does not see the routine at all');

-- Descartar la rutina se lleva sus fotos: archivar no borra la plantilla, así que el
-- cascade nunca dispara y sin esto los bytes sobrevivirían a la rutina.
select (planning.create_my_session_template(
  '019f1000-0000-7000-8000-000000000001', 'test_strength', 'Para descartar',
  '82f11111-1111-4111-8111-000000000009', extensions.uuid_generate_v7(),
  decode(repeat('a9', 32), 'hex'))).template as throwaway \gset
select (:'throwaway'::jsonb->>'id') as throwaway_id \gset

select (planning.upload_my_cover_photo(
  '019f1000-0000-7000-8000-000000000001', :'throwaway_id'::uuid,
  decode('5249464633', 'hex'),
  '82f11111-1111-4111-8111-00000000000a', extensions.uuid_generate_v7(),
  decode(repeat('aa', 32), 'hex'))).photo as doomed \gset
select (:'doomed'::jsonb->>'id') as doomed_id \gset

select (planning.discard_my_session_template(
  '019f1000-0000-7000-8000-000000000001', :'throwaway_id'::uuid,
  '82f11111-1111-4111-8111-00000000000b', extensions.uuid_generate_v7(),
  decode(repeat('ab', 32), 'hex'))).template as discarded \gset

select ok(
  not exists (select 1 from planning.session_template_cover_photos where id = :'doomed_id'::uuid),
  'ADR-031 · discarding a routine destroys its photographs, though it only archives the routine');

select is(
  (select reason from privacy.binary_disposals where object_id = :'doomed_id'::uuid),
  'content_discarded',
  'and the trace says why, not just that it happened');

select * from finish();

rollback;
