-- `IX-48` — the cover of a routine, and what it is allowed to be.
--
-- What has to hold: a cover is optional and nulls out cleanly; a muscle cover carries
-- nothing but the decision; an icon cover names one of the twelve the vocabulary has;
-- the two never mix; the choice survives publication; and changing only the cover is a
-- change, because the cover is inside the publication hash.
--
-- The negatives were written first and watched succeeding against the old functions:
-- before `session_content_errors` learned the key, a draft carrying `cover` was
-- rejected whole as `invalid-content-shape`, and that is the assertion at the top —
-- kept, because the allow-list is the thing that makes every other key impossible.
--
-- The hash assertion is the one that matters most. A cover outside the hash would let
-- somebody change how their routine looks, press publish, and be told it was already
-- published — the change reaching nothing.

begin;

select plan(14);

insert into identity.people (id, given_name, family_name)
values ('019ef000-0000-7000-8000-000000000001', 'Quien', 'Elige');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef000-0000-7000-8000-0000000000f1', 'test_strength', 'Sentadilla de prueba',
        'sentadilla de prueba', 'global', 'published');

insert into catalog.muscles (id, code, name, region, body_slug, status, display_order)
values
  ('019ef000-0000-7000-8000-0000000000a1', 'test_quads', 'Cuádriceps de prueba', 'lower', 'quadriceps', 'published', 1),
  ('019ef000-0000-7000-8000-0000000000a2', 'test_glutes', 'Glúteos de prueba', 'lower', 'gluteal', 'published', 2);

insert into catalog.movement_muscles (movement_id, muscle_id, is_primary)
values
  ('019ef000-0000-7000-8000-0000000000f1', '019ef000-0000-7000-8000-0000000000a1', true),
  ('019ef000-0000-7000-8000-0000000000f1', '019ef000-0000-7000-8000-0000000000a2', false);

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef000-0000-7000-8000-000000000001', true);

select (planning.create_my_session_template(
  '019ef000-0000-7000-8000-000000000001', 'test_strength', 'Pierna',
  '82cf1111-1111-4111-8111-000000000001', extensions.uuid_generate_v7(),
  decode(repeat('f1', 32), 'hex'))).template as created \gset
select (:'created'::jsonb->>'id') as template_id,
       (:'created'::jsonb->'draft'->>'etag') as etag0 \gset

-- What the shape check has to keep refusing, with or without the cover.
select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"portada":"barra"}'::jsonb,
    null, 'test_strength', false),
  array['invalid-content-shape'],
  'a key nobody declared still invalidates the whole draft');

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"cover":{"kind":"muscles"}}'::jsonb,
    null, 'test_strength', false),
  array[]::text[],
  'IX-48 · a muscle cover carries nothing but the decision');

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"cover":null}'::jsonb,
    null, 'test_strength', false),
  array[]::text[],
  'and null is a routine with no cover, which is allowed');

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"cover":{"kind":"muscles","icon":"strength"}}'::jsonb,
    null, 'test_strength', false),
  array['cover'],
  'IX-48 · a muscle cover carrying an icon is refused');

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"cover":{"kind":"icon"}}'::jsonb,
    null, 'test_strength', false),
  array['cover'],
  'IX-48 · and an icon cover naming no icon is refused');

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"cover":{"kind":"icon","icon":"barra"}}'::jsonb,
    null, 'test_strength', false),
  array['cover'],
  'IX-48 · a name outside the twelve is not an icon');

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"cover":{"kind":"icon","icon":"strength"}}'::jsonb,
    null, 'test_strength', false),
  array[]::text[],
  'IX-48 · one of the twelve is');

-- The routine itself, with a cover, published.
select (planning.replace_my_session_template_draft(
  '019ef000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag0',
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","cover":{"kind":"icon","icon":"strength"},"steps":[{"position":1,"movement_id":"019ef000-0000-7000-8000-0000000000f1","target":{"family":"strength","target_sets":3,"target_reps":10}}]}'::jsonb,
  '82cf1111-1111-4111-8111-000000000002', extensions.uuid_generate_v7(),
  decode(repeat('f2', 32), 'hex'))).draft as saved \gset
select (:'saved'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag1',
  '82cf1111-1111-4111-8111-000000000003', extensions.uuid_generate_v7(),
  decode(repeat('f3', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as version_id \gset

select is(
  (select cover_kind::text from planning.session_template_versions where id = :'version_id'::uuid),
  'icon',
  'publishing carries the cover onto the version');

select is(
  (select cover_icon::text from planning.session_template_versions where id = :'version_id'::uuid),
  'strength',
  'and which icon it is');

select is(
  planning.session_version_projection(:'version_id'::uuid)->'cover',
  '{"kind":"icon","icon":"strength"}'::jsonb,
  'and the projection answers it as it was written');

-- The version is immutable, so nothing may bend its cover afterwards.
select throws_ok(
  format('update planning.session_template_versions set cover_kind = %L where id = %L',
         'muscles', :'version_id'),
  null,
  'a published cover is as immutable as the rest of the version');

-- Changing only the cover: a different routine to look at, so a different version.
select (planning.replace_my_session_template_draft(
  '019ef000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag1',
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","cover":{"kind":"muscles"},"steps":[{"position":1,"movement_id":"019ef000-0000-7000-8000-0000000000f1","target":{"family":"strength","target_sets":3,"target_reps":10}}]}'::jsonb,
  '82cf1111-1111-4111-8111-000000000004', extensions.uuid_generate_v7(),
  decode(repeat('f4', 32), 'hex'))).draft as recovered \gset
select (:'recovered'::jsonb->>'etag') as etag2 \gset

select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-000000000001', :'template_id'::uuid, :'etag2',
  '82cf1111-1111-4111-8111-000000000005', extensions.uuid_generate_v7(),
  decode(repeat('f5', 32), 'hex'))).version as republished \gset

select is(
  (select count(*)::integer from planning.session_template_versions
   where template_id = :'template_id'::uuid),
  2,
  'changing only the cover is a change: the cover is inside the publication hash');

-- What the list needs to draw both kinds of cover.
select is(
  (select mine.item->'cover' from jsonb_array_elements(
     planning.read_my_content('019ef000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'template_id'),
  '{"kind":"muscles"}'::jsonb,
  'my list carries the cover I last chose');

select is(
  (select mine.item->'muscles' from jsonb_array_elements(
     planning.read_my_content('019ef000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'template_id'),
  '["test_quads","test_glutes"]'::jsonb,
  'and the muscles a muscle cover is drawn from, the ones it trains first');

select * from finish();

rollback;
