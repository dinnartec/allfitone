-- Searching the exercise library.
--
-- What has to hold: the search finds the global library, matches on what was typed,
-- respects the discipline, and answers an empty list rather than everything when
-- nothing matches. The library itself is curated content, so the rows here are
-- fixtures shaped like the curated ones.
--
-- The reader answers `{data, page}` rather than a bare array, which is why every
-- assertion below reads `->'data'`. The envelope is not decoration: a capped array
-- with no way to ask for the next page looks exactly like the whole catalogue, and
-- that stopped being harmless when the library grew past one page.
begin;

select plan(21);

insert into identity.people (id, given_name, family_name)
values ('019eb000-0000-7000-8000-000000000001', 'Quien', 'Busca');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values
  ('019eb000-0000-7000-8000-0000000000f1', 'test_strength', 'Sentadilla con barra',
   'sentadilla con barra', 'global', 'published'),
  ('019eb000-0000-7000-8000-0000000000f2', 'test_strength', 'Press de banca con barra',
   'press de banca con barra', 'global', 'published'),
  ('019eb000-0000-7000-8000-0000000000f3', 'test_endurance', 'Carrera continua',
   'carrera continua', 'global', 'published'),
  ('019eb000-0000-7000-8000-0000000000f4', 'test_strength', 'Remo con barra',
   'remo con barra', 'global', 'draft');

insert into catalog.muscles (id, code, name, region, body_slug, status, display_order)
values
  ('019eb000-0000-7000-8000-0000000000a1', 'test_chest', 'Pecho de prueba', 'upper', 'chest', 'published', 1),
  ('019eb000-0000-7000-8000-0000000000a2', 'test_back', 'Espalda de prueba', 'upper', 'upper-back', 'published', 2),
  ('019eb000-0000-7000-8000-0000000000a3', 'test_draft', 'Borrador', 'upper', null, 'draft', 3);

insert into catalog.equipment (id, code, name, content_scope, status, display_order)
values
  ('019eb000-0000-7000-8000-0000000000b1', 'test_barbell', 'Barra de prueba', 'global', 'published', 1),
  ('019eb000-0000-7000-8000-0000000000b2', 'test_dumbbell', 'Mancuerna de prueba', 'global', 'published', 2);

-- f1 is chest with a barbell; f2 is back with a dumbbell. f3 carries no label at all,
-- which is the case that must never appear under any chip.
insert into catalog.movement_muscles (movement_id, muscle_id, is_primary)
values
  ('019eb000-0000-7000-8000-0000000000f1', '019eb000-0000-7000-8000-0000000000a1', true),
  ('019eb000-0000-7000-8000-0000000000f2', '019eb000-0000-7000-8000-0000000000a2', true);

insert into catalog.movement_equipment (movement_id, equipment_id, requirement)
values
  ('019eb000-0000-7000-8000-0000000000f1', '019eb000-0000-7000-8000-0000000000b1', 'required'),
  ('019eb000-0000-7000-8000-0000000000f2', '019eb000-0000-7000-8000-0000000000b2', 'required');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019eb000-0000-7000-8000-000000000001', true);

-- Counted over this test's own fixtures rather than over the whole library. The
-- curated catalogue is loaded into the same database the app uses and this asserted
-- an empty one, so running the app and running the tests were mutually exclusive.
select is(
  (select count(*)::integer
   from jsonb_array_elements(catalog.read_movements(
     '019eb000-0000-7000-8000-000000000001', null, null, 200)->'data') as found
   -- By id, not by name: the curated catalogue has a 'Sentadilla con barra' of its
   -- own, and matching on the word would count both.
   where (found->>'id')::uuid in (
     '019eb000-0000-7000-8000-0000000000f1',
     '019eb000-0000-7000-8000-0000000000f2',
     '019eb000-0000-7000-8000-0000000000f3')),
  3,
  'T-CAT-SEARCH-01 the search answers the published global library');

select is(
  jsonb_array_length(catalog.read_movements(
    '019eb000-0000-7000-8000-000000000001', 'test_strength', null, 40)->'data'),
  2,
  'T-CAT-SEARCH-02 and only the discipline the routine is written in');

select is(
  (catalog.read_movements(
    '019eb000-0000-7000-8000-000000000001', 'test_strength', 'senta', 40)->'data')->0->>'name',
  'Sentadilla con barra',
  'T-CAT-SEARCH-03 matching on what was typed, anywhere in the name');

-- Accents are not folded, and saying so is the point: this is what the reader promises.
-- Compared against itself rather than to a number, so a real catalogue alongside the
-- fixtures cannot make a case-insensitivity test fail for being case-insensitive.
select is(
  catalog.read_movements('019eb000-0000-7000-8000-000000000001', null, 'BARRA', 200)->'data',
  catalog.read_movements('019eb000-0000-7000-8000-000000000001', null, 'barra', 200)->'data',
  'T-CAT-SEARCH-04 case does not matter');

select is(
  catalog.read_movements('019eb000-0000-7000-8000-000000000001', null, 'zzz', 40)->'data',
  '[]'::jsonb,
  'T-CAT-SEARCH-05 and nothing matching answers nothing, not everything');

-- A wildcard typed into the box is a character, not a query.
select is(
  catalog.read_movements('019eb000-0000-7000-8000-000000000001', null, '%', 40)->'data',
  '[]'::jsonb,
  'T-CAT-SEARCH-06 a percent sign is text somebody typed');

-- ---------------------------------------------------------------------------
-- Filtering by muscle and by equipment
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(found->>'id' order by found->>'id')
   from jsonb_array_elements(catalog.read_movements(
     '019eb000-0000-7000-8000-000000000001', null, null, 200,
     array['test_chest'], null)->'data') as found),
  array['019eb000-0000-7000-8000-0000000000f1'],
  'T-CAT-SEARCH-07 one muscle answers the movements that work it');

-- Two values of the same chip widen. A filter that narrowed here would make picking a
-- second muscle feel like a mistake.
select is(
  (select count(*)::integer
   from jsonb_array_elements(catalog.read_movements(
     '019eb000-0000-7000-8000-000000000001', null, null, 200,
     array['test_chest', 'test_back'], null)->'data') as found),
  2,
  'T-CAT-SEARCH-08 two muscles are or, so choosing a second one widens');

-- Two different chips narrow. This is the pair that proves the semantics are not
-- uniformly `or`, which is the mistake that looks right until you use it.
select is(
  (select count(*)::integer
   from jsonb_array_elements(catalog.read_movements(
     '019eb000-0000-7000-8000-000000000001', null, null, 200,
     array['test_chest'], array['test_dumbbell'])->'data') as found),
  0,
  'T-CAT-SEARCH-09 muscle and equipment are and, so they narrow each other');

select is(
  (select count(*)::integer
   from jsonb_array_elements(catalog.read_movements(
     '019eb000-0000-7000-8000-000000000001', null, null, 200,
     null, array['test_barbell'])->'data') as found),
  1,
  'T-CAT-SEARCH-10 equipment filters on its own too');

select is(
  (select array_agg(found->>'id')
   from jsonb_array_elements(catalog.read_movements(
     '019eb000-0000-7000-8000-000000000001', null, null, 200,
     array['test_chest', 'test_back'], null)->'data') as found
   where found->>'id' = '019eb000-0000-7000-8000-0000000000f3'),
  null::text[],
  'T-CAT-SEARCH-11 a movement with no label appears under no chip');

select is(
  (select (found->'muscles')::jsonb
   from jsonb_array_elements(catalog.read_movements(
     '019eb000-0000-7000-8000-000000000001', null, null, 200)->'data') as found
   where found->>'id' = '019eb000-0000-7000-8000-0000000000f1'),
  '["test_chest"]'::jsonb,
  'T-CAT-SEARCH-12 every movement says what it trains, so the row can explain itself');

select is(
  (select count(*)::integer
   from jsonb_array_elements(catalog.read_muscles(
     '019eb000-0000-7000-8000-000000000001')) as listed
   where listed->>'code' = 'test_draft'),
  0,
  'T-CAT-SEARCH-13 a draft muscle is not offered as a chip');

-- The negative that matters. The global catalogue is published by Allfit alone, so a
-- muscle label written from the product would be curatorial content with no curation.
set local role allfit_api;
select throws_ok(
  $$insert into catalog.muscles (code, name, region, status)
    values ('sneaked', 'Colado', 'upper', 'published')$$,
  '42501',
  null,
  'T-CAT-RLS-01 the runtime role cannot write the muscle catalogue');

select throws_ok(
  $$insert into catalog.movement_muscles (movement_id, muscle_id)
    values ('019eb000-0000-7000-8000-0000000000f3', '019eb000-0000-7000-8000-0000000000a1')$$,
  '42501',
  null,
  'T-CAT-RLS-02 nor tag a movement with a muscle');

-- The walk. Three fixtures of this test share a discipline, so a page of two must
-- leave exactly one behind and say so.
select is(
  (catalog.read_movements('019eb000-0000-7000-8000-000000000001',
    'test_strength', null, 1))->'page'->>'has_more',
  'true',
  'T-CAT-SEARCH-16 a page that does not hold everything says so');

select isnt(
  (catalog.read_movements('019eb000-0000-7000-8000-000000000001',
    'test_strength', null, 1))->'page'->>'next_cursor',
  null,
  'T-CAT-SEARCH-17 and hands back the cursor to continue from');

-- The one that matters: the second page must not repeat the first, and between them
-- they must be the whole set. An offset cursor gets this wrong the moment a row is
-- inserted mid-walk; a keyset cannot.
select is(
  (select array_agg(found->>'id' order by found->>'name')
   from jsonb_array_elements(
     (catalog.read_movements('019eb000-0000-7000-8000-000000000001',
       'test_strength', null, 1,
       null, null,
       (catalog.read_movements('019eb000-0000-7000-8000-000000000001',
         'test_strength', null, 1))->'page'->>'next_cursor'))->'data') as found),
  array['019eb000-0000-7000-8000-0000000000f1'],
  'T-CAT-SEARCH-18 the next page starts strictly after the last row of the previous one');

select is(
  (catalog.read_movements('019eb000-0000-7000-8000-000000000001',
    'test_strength', null, 200))->'page'->>'has_more',
  'false',
  'T-CAT-SEARCH-19 a page that holds everything says there is no more');

select is(
  (catalog.read_movements('019eb000-0000-7000-8000-000000000001',
    'test_strength', null, 200))->'page'->>'next_cursor',
  null,
  'T-CAT-SEARCH-20 and hands back no cursor, because there is nowhere to continue to');

-- A wrong page looks exactly like a right one, so garbage must raise rather than
-- answer something arbitrary.
select throws_ok(
  $$select catalog.read_movements('019eb000-0000-7000-8000-000000000001',
      null, null, 40, null, null, 'not-a-cursor!!')$$,
  '22023',
  null,
  'T-CAT-SEARCH-21 a malformed cursor raises instead of answering an arbitrary page');

select finish();
rollback;
