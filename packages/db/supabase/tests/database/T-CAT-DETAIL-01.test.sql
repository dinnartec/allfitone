-- What a movement is, read in one call.
--
-- `OP-CAT-010` answers the whole thing — aliases, muscles with their primary,
-- equipment, the steps in order and the variants with their note — because a detail
-- screen that arrived in five pieces would draw itself five times.
--
-- The order of the steps is the part worth testing hardest: they are instructions for
-- loading a barbell, and out of order they are wrong in a way that reads as right.
--
-- The negatives are the point of the rest. A variant needs **both** ends visible, so
-- it can never be a way to see a movement you could not otherwise see; and the runtime
-- role cannot write any of them, because this is curated content whose safety comes
-- from being reviewed before it ships — the demonstration included, since its row says
-- which bytes were reviewed.

begin;

select plan(14);

insert into identity.people (id, given_name, family_name)
values ('019ed000-0000-7000-8000-000000000001', 'Quien', 'Mira');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values
  ('019ed000-0000-7000-8000-0000000000f1', 'test_strength', 'Press de prueba',
   'press de prueba', 'global', 'published'),
  ('019ed000-0000-7000-8000-0000000000f2', 'test_strength', 'Press de prueba con mancuernas',
   'press de prueba con mancuernas', 'global', 'published'),
  -- Never published, so it must not surface through anything, including a variant.
  ('019ed000-0000-7000-8000-0000000000f3', 'test_strength', 'Press oculto',
   'press oculto', 'global', 'draft');

insert into catalog.muscles (id, code, name, region, body_slug, status, display_order)
values
  ('019ed000-0000-7000-8000-0000000000a1', 'test_chest', 'Pecho', 'upper', 'chest', 'published', 1),
  ('019ed000-0000-7000-8000-0000000000a2', 'test_triceps', 'Tríceps', 'upper', 'triceps', 'published', 2);

insert into catalog.movement_muscles (movement_id, muscle_id, is_primary)
values
  ('019ed000-0000-7000-8000-0000000000f1', '019ed000-0000-7000-8000-0000000000a1', true),
  ('019ed000-0000-7000-8000-0000000000f1', '019ed000-0000-7000-8000-0000000000a2', false);

insert into catalog.movement_aliases (movement_id, locale, name)
values
  ('019ed000-0000-7000-8000-0000000000f1', 'es', 'bench de prueba'),
  ('019ed000-0000-7000-8000-0000000000f1', 'en', 'test bench press');

-- Inserted out of order on purpose: the projection must not depend on insertion.
insert into catalog.movement_instructions (movement_id, locale, position, text)
values
  ('019ed000-0000-7000-8000-0000000000f1', 'es', 3, 'Tercero'),
  ('019ed000-0000-7000-8000-0000000000f1', 'es', 1, 'Primero'),
  ('019ed000-0000-7000-8000-0000000000f1', 'es', 2, 'Segundo');

insert into catalog.movement_variants (base_movement_id, variant_movement_id, relation, note)
values
  ('019ed000-0000-7000-8000-0000000000f1', '019ed000-0000-7000-8000-0000000000f2', 'variant', 'Más recorrido'),
  ('019ed000-0000-7000-8000-0000000000f1', '019ed000-0000-7000-8000-0000000000f3', 'variant', 'No debe verse');

insert into catalog.movement_media
  (movement_id, kind, object_key, content_type, width, height, byte_size, checksum)
values
  ('019ed000-0000-7000-8000-0000000000f1', 'demo', 'movements/press-de-prueba.webp',
   'image/webp', 180, 180, 94208, 'sha256:abc');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ed000-0000-7000-8000-000000000001', true);

select is(
  (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
    '019ed000-0000-7000-8000-0000000000f1'))->>'name',
  'Press de prueba',
  'T-CAT-DETAIL-01 the movement answers with its own name');

-- The one that matters most: these are instructions for loading a barbell, and out
-- of order they are wrong in a way that still reads as right.
select is(
  (select array_agg(step->>'text' order by (step->>'position')::integer)
   from jsonb_array_elements(
     (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
       '019ed000-0000-7000-8000-0000000000f1'))->'instructions') as step),
  array['Primero', 'Segundo', 'Tercero'],
  'T-CAT-DETAIL-02 the steps come in the order they are done, not the order they were written');

select is(
  (select array_agg(step->>'text')
   from jsonb_array_elements(
     (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
       '019ed000-0000-7000-8000-0000000000f1'))->'instructions') as step),
  array['Primero', 'Segundo', 'Tercero'],
  'T-CAT-DETAIL-03 and the projection itself is ordered, so no screen has to sort');

select is(
  (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
    '019ed000-0000-7000-8000-0000000000f2'))->'instructions',
  '[]'::jsonb,
  'T-CAT-DETAIL-04 a movement with no steps answers an empty list, not null');

select is(
  (select (muscle->>'primary')::boolean
   from jsonb_array_elements(
     (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
       '019ed000-0000-7000-8000-0000000000f1'))->'muscles') as muscle
   limit 1),
  true,
  'T-CAT-DETAIL-05 the primary muscle leads, because that is what the figure lights');

select is(
  (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
    '019ed000-0000-7000-8000-0000000000f1'))->'aliases',
  '["bench de prueba"]'::jsonb,
  'T-CAT-DETAIL-06 only the locale being read, so a translation does not leak into it');

select is(
  (select count(*)::integer
   from jsonb_array_elements(
     (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
       '019ed000-0000-7000-8000-0000000000f1'))->'variants') as one),
  1,
  'T-CAT-DETAIL-07 an unpublished movement is not reachable through a variant');

select is(
  (select one->>'note'
   from jsonb_array_elements(
     (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
       '019ed000-0000-7000-8000-0000000000f1'))->'variants') as one),
  'Más recorrido',
  'T-CAT-DETAIL-08 a variant says why it is worth doing instead');

select is(
  catalog.read_movement('019ed000-0000-7000-8000-000000000001',
    '019ed000-0000-7000-8000-0000000000f3'),
  null::jsonb,
  'T-CAT-DETAIL-09 an unpublished movement answers nothing, the same as one that does not exist');

-- The negative that matters. These are instructions whose safety comes from being
-- reviewed before they ship; written from the product they would skip that review.
set local role allfit_api;

select throws_ok(
  $$insert into catalog.movement_instructions (movement_id, locale, position, text)
    values ('019ed000-0000-7000-8000-0000000000f1', 'es', 9, 'Colado')$$,
  '42501',
  null,
  'T-CAT-RLS-03 the runtime role cannot write an instruction');

select throws_ok(
  $$insert into catalog.movement_aliases (movement_id, locale, name)
    values ('019ed000-0000-7000-8000-0000000000f1', 'es', 'colado')$$,
  '42501',
  null,
  'T-CAT-RLS-04 nor an alias, which is how a movement is found');

select is(
  (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
    '019ed000-0000-7000-8000-0000000000f1'))->>'demo_object_key',
  'movements/press-de-prueba.webp',
  'T-CAT-DETAIL-10 the projection carries the key, never a URL: the origin is configuration');

select is(
  (catalog.read_movement('019ed000-0000-7000-8000-000000000001',
    '019ed000-0000-7000-8000-0000000000f2'))->>'demo_object_key',
  null,
  'T-CAT-DETAIL-11 a movement with no demonstration projects null, not a broken address');

select throws_ok(
  $$insert into catalog.movement_media
      (movement_id, kind, object_key, content_type, width, height, byte_size, checksum)
    values ('019ed000-0000-7000-8000-0000000000f1', 'demo', 'colado.webp',
            'image/webp', 1, 1, 1, 'sha256:zzz')$$,
  '42501',
  null,
  'T-CAT-RLS-05 nor a demonstration, which is what an exercise looks like');

select finish();
rollback;
