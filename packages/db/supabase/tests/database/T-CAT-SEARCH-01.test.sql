-- Searching the exercise library.
--
-- What has to hold: the search finds the global library, matches on what was typed,
-- respects the discipline, and answers an empty list rather than everything when
-- nothing matches. The library itself is curated content, so the rows here are
-- fixtures shaped like the curated ones.
begin;

select plan(6);

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

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019eb000-0000-7000-8000-000000000001', true);

select is(
  jsonb_array_length(catalog.read_movements(
    '019eb000-0000-7000-8000-000000000001', null, null, 40)),
  3,
  'T-CAT-SEARCH-01 the search answers the published global library');

select is(
  jsonb_array_length(catalog.read_movements(
    '019eb000-0000-7000-8000-000000000001', 'test_strength', null, 40)),
  2,
  'T-CAT-SEARCH-02 and only the discipline the routine is written in');

select is(
  (catalog.read_movements(
    '019eb000-0000-7000-8000-000000000001', 'test_strength', 'senta', 40))->0->>'name',
  'Sentadilla con barra',
  'T-CAT-SEARCH-03 matching on what was typed, anywhere in the name');

-- Accents are not folded, and saying so is the point: this is what the reader promises.
select is(
  jsonb_array_length(catalog.read_movements(
    '019eb000-0000-7000-8000-000000000001', null, 'BARRA', 40)),
  2,
  'T-CAT-SEARCH-04 case does not matter');

select is(
  catalog.read_movements('019eb000-0000-7000-8000-000000000001', null, 'zzz', 40),
  '[]'::jsonb,
  'T-CAT-SEARCH-05 and nothing matching answers nothing, not everything');

-- A wildcard typed into the box is a character, not a query.
select is(
  catalog.read_movements('019eb000-0000-7000-8000-000000000001', null, '%', 40),
  '[]'::jsonb,
  'T-CAT-SEARCH-06 a percent sign is text somebody typed');

select finish();
rollback;
