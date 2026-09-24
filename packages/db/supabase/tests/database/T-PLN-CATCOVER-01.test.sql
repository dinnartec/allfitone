-- `OP-PLN-020` — el catálogo responde con cara, y es la de quien pregunta.
--
-- La ficha ya lo exigía —«la portada de cada programa es la del juego de quien
-- pregunta»— y la lectura del catálogo no devolvía ninguna: la fotografía sólo
-- aparecía después de tomar el programa. Elegir entre tres fichas de texto y luego
-- descubrir la imagen es decidir sobre otra cosa.
--
-- Lo que tiene que valer: quien declaró recibe su juego; quien no declaró recibe uno
-- estable, el mismo cada vez y **no** siempre el mismo para todos los programas; un
-- programa sin fotografía responde nulo y no desaparece del catálogo; y la clave que
-- sale es la de quien pregunta y nunca la de la vecina.

begin;

select plan(6);

insert into identity.people (id, given_name, family_name, biological_sex)
values
  ('019ef100-0000-7000-8000-000000000001', 'Quien', 'Declaró Hombre', 'male'),
  ('019ef100-0000-7000-8000-000000000002', 'Quien', 'Declaró Mujer', 'female'),
  ('019ef100-0000-7000-8000-000000000003', 'Quien', 'Prefirió Callar', null);

-- Dos programas globales publicados con una sesión cada uno: uno con sus dos juegos de
-- portada y otro sin ninguna, que es el que prueba que el catálogo no se encoge.
insert into planning.programs (id, content_scope, status)
values
  ('019ef100-0000-7000-8000-0000000000c1', 'global', 'published'),
  ('019ef100-0000-7000-8000-0000000000c2', 'global', 'published');

insert into planning.program_cover_photos (program_id, audience, object_key)
values
  ('019ef100-0000-7000-8000-0000000000c1', 'male',
   'programs/019ef100-0000-7000-8000-0000000000c1/male/prueba.webp'),
  ('019ef100-0000-7000-8000-0000000000c1', 'female',
   'programs/019ef100-0000-7000-8000-0000000000c1/female/prueba.webp');

insert into planning.program_versions (id, program_id, version_number, title, status, published_at, content_hash)
values
  ('019ef100-0000-7000-8000-0000000000d1', '019ef100-0000-7000-8000-0000000000c1', 1,
   'Con portada', 'published', now(), decode(repeat('c1', 32), 'hex')),
  ('019ef100-0000-7000-8000-0000000000d2', '019ef100-0000-7000-8000-0000000000c2', 1,
   'Sin portada', 'published', now(), decode(repeat('c2', 32), 'hex'));

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef100-0000-7000-8000-0000000000f1', 'test_strength', 'Sentadilla de catálogo',
        'sentadilla de catalogo', 'global', 'published');

insert into planning.session_templates (id, discipline_code, content_scope, status)
values
  ('019ef100-0000-7000-8000-0000000000e1', 'test_strength', 'global', 'published'),
  ('019ef100-0000-7000-8000-0000000000e2', 'test_strength', 'global', 'published');

insert into planning.session_template_versions
  (id, template_id, version_number, title, discipline_code, activity_type_id, status,
   published_at, content_hash)
values
  ('019ef100-0000-7000-8000-0000000000e3', '019ef100-0000-7000-8000-0000000000e1', 1,
   'Pierna', 'test_strength', '019c0000-0000-7000-8000-000000000011', 'published',
   now(), decode(repeat('b1', 32), 'hex')),
  ('019ef100-0000-7000-8000-0000000000e4', '019ef100-0000-7000-8000-0000000000e2', 1,
   'Torso', 'test_strength', '019c0000-0000-7000-8000-000000000011', 'published',
   now(), decode(repeat('b2', 32), 'hex'));

insert into planning.program_version_sessions
  (program_version_id, week, day, position, template_version_id)
values
  ('019ef100-0000-7000-8000-0000000000d1', 1, 1, 1, '019ef100-0000-7000-8000-0000000000e3'),
  ('019ef100-0000-7000-8000-0000000000d2', 1, 1, 1, '019ef100-0000-7000-8000-0000000000e4');

set local role allfit_owner;

-- ------------------------------------------------------ el juego es el que se declaró

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef100-0000-7000-8000-000000000001', true);

select is(
  (select entry.cover_object_key
   from planning.read_program_catalogue('019ef100-0000-7000-8000-000000000001') as entry
   where entry.program_id = '019ef100-0000-7000-8000-0000000000c1'),
  'programs/019ef100-0000-7000-8000-0000000000c1/male/prueba.webp',
  'OP-PLN-020 · the catalogue answers the set of whoever declared male');

select is(
  (select entry.cover_object_key
   from planning.read_program_catalogue('019ef100-0000-7000-8000-000000000001') as entry
   where entry.program_id = '019ef100-0000-7000-8000-0000000000c2'),
  null,
  'and a programme with no artwork answers null instead of dropping out of the catalogue');

select is(
  (select count(*)::integer
   from planning.read_program_catalogue('019ef100-0000-7000-8000-000000000001') as entry
   where entry.program_id in ('019ef100-0000-7000-8000-0000000000c1',
                              '019ef100-0000-7000-8000-0000000000c2')),
  2,
  'OP-PLN-020 · which is what "instead of dropping out" means: both are still offered');

select set_config('app.actor_person_id', '019ef100-0000-7000-8000-000000000002', true);

select is(
  (select entry.cover_object_key
   from planning.read_program_catalogue('019ef100-0000-7000-8000-000000000002') as entry
   where entry.program_id = '019ef100-0000-7000-8000-0000000000c1'),
  'programs/019ef100-0000-7000-8000-0000000000c1/female/prueba.webp',
  'OP-PLN-020 · and the other set for whoever declared female');

-- --------------------------------------------- quien calló recibe una mezcla estable

select set_config('app.actor_person_id', '019ef100-0000-7000-8000-000000000003', true);

select is(
  (select entry.cover_object_key
   from planning.read_program_catalogue('019ef100-0000-7000-8000-000000000003') as entry
   where entry.program_id = '019ef100-0000-7000-8000-0000000000c1'),
  (select entry.cover_object_key
   from planning.read_program_catalogue('019ef100-0000-7000-8000-000000000003') as entry
   where entry.program_id = '019ef100-0000-7000-8000-0000000000c1'),
  'OP-PLN-020 · whoever declined gets the same picture every time they come back');

select isnt(
  (select entry.cover_object_key
   from planning.read_program_catalogue('019ef100-0000-7000-8000-000000000003') as entry
   where entry.program_id = '019ef100-0000-7000-8000-0000000000c1'),
  null,
  'and a set, not an empty tile: declining is not having no face');

select * from finish();

rollback;
