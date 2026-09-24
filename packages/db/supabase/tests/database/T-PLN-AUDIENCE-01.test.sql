-- `AFO-186` — la portada del catálogo se parece a quien la mira.
--
-- Lo que tiene que valer: quien declaró hombre ve el juego de hombre y quien declaró
-- mujer el de mujer; quien prefirió no decirlo ve uno de los dos y **el mismo la
-- segunda vez**, porque una portada que cambiara en cada lectura sería una portada
-- distinta cada vez que la pantalla se refresca; y dos programas no le caen del mismo
-- lado, que es lo único que hace que «mezclado» signifique algo. La portada que una
-- rutina toma prestada del catálogo también es la del juego de quien pregunta, y un
-- programa propio hereda la cara del que le presta con la misma regla.
--
-- Y la negativa se lee sin decirla: preguntar por la portada de otra persona diría cuál
-- es su sexo declarado, así que la función sólo contesta por quien pregunta.

begin;

select plan(9);

insert into identity.people (id, given_name, family_name, biological_sex)
values
  ('019ef100-0000-7000-8000-000000000001', 'Quien', 'Dijo Hombre', 'male'),
  ('019ef100-0000-7000-8000-000000000002', 'Quien', 'Dijo Mujer', 'female'),
  ('019ef100-0000-7000-8000-000000000003', 'Quien', 'No Lo Dijo', null);

-- Dos programas del catálogo con sus dos juegos. Propios del test: `seed.sql` no carga
-- la curación, así que los veinticuatro reales pueden no estar donde esto corra.
insert into planning.programs (id, content_scope, status)
values
  ('019ef100-0000-7000-8000-0000000000c1', 'global', 'published'),
  ('019ef100-0000-7000-8000-0000000000c2', 'global', 'published');

insert into planning.program_cover_photos (program_id, audience, object_key)
values
  ('019ef100-0000-7000-8000-0000000000c1', 'male',
   'programs/019ef100-0000-7000-8000-0000000000c1/male/uno.webp'),
  ('019ef100-0000-7000-8000-0000000000c1', 'female',
   'programs/019ef100-0000-7000-8000-0000000000c1/female/uno.webp'),
  ('019ef100-0000-7000-8000-0000000000c2', 'male',
   'programs/019ef100-0000-7000-8000-0000000000c2/male/dos.webp'),
  ('019ef100-0000-7000-8000-0000000000c2', 'female',
   'programs/019ef100-0000-7000-8000-0000000000c2/female/dos.webp');

-- Un programa propio que no tiene fotografías suyas y toma prestada la cara del primero.
insert into planning.programs
  (id, content_scope, owner_person_id, author_person_id, status, cover_from_program_id)
values
  ('019ef100-0000-7000-8000-0000000000d1', 'person',
   '019ef100-0000-7000-8000-000000000001', '019ef100-0000-7000-8000-000000000001',
   'published', '019ef100-0000-7000-8000-0000000000c1');

-- Una rutina a la que el catálogo le presta la suya.
insert into planning.session_templates (id, content_scope, owner_person_id, author_person_id, discipline_code, status)
values ('019ef100-0000-7000-8000-0000000000e1', 'person',
        '019ef100-0000-7000-8000-000000000001', '019ef100-0000-7000-8000-000000000001',
        'test_strength', 'published');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);

-- ------------------------------------------------------- lo que cada juego contesta

select set_config('app.actor_person_id', '019ef100-0000-7000-8000-000000000001', true);

select is(
  planning.cover_for('019ef100-0000-7000-8000-0000000000c1',
                     '019ef100-0000-7000-8000-000000000001'),
  'programs/019ef100-0000-7000-8000-0000000000c1/male/uno.webp',
  'T-PLN-AUDIENCE-01 quien declaró hombre ve la fotografía de hombre');

select is(
  planning.cover_for('019ef100-0000-7000-8000-0000000000d1',
                     '019ef100-0000-7000-8000-000000000001'),
  'programs/019ef100-0000-7000-8000-0000000000c1/male/uno.webp',
  'T-PLN-AUDIENCE-02 y su programa propio lleva la cara prestada, también de su juego');

select is(
  planning.cover_for('019ef100-0000-7000-8000-0000000000c1',
                     '019ef100-0000-7000-8000-000000000002'),
  null,
  'T-PLN-AUDIENCE-03 preguntar por la de otra persona diría cuál es su sexo declarado');

select is(
  (select photo.audience::text
   from planning.program_cover_photos as photo
   where photo.object_key = planning.pick_routine_cover(
     '019ef100-0000-7000-8000-0000000000e1', 'lower', '019ef100-0000-7000-8000-000000000001')),
  'male',
  'T-PLN-AUDIENCE-04 la portada que el catálogo le presta a una rutina es la de su juego');

select set_config('app.actor_person_id', '019ef100-0000-7000-8000-000000000002', true);

select is(
  planning.cover_for('019ef100-0000-7000-8000-0000000000c1',
                     '019ef100-0000-7000-8000-000000000002'),
  'programs/019ef100-0000-7000-8000-0000000000c1/female/uno.webp',
  'T-PLN-AUDIENCE-05 quien declaró mujer ve la fotografía de mujer');

select is(
  (select photo.audience::text
   from planning.program_cover_photos as photo
   where photo.object_key = planning.pick_routine_cover(
     '019ef100-0000-7000-8000-0000000000e1', 'lower', '019ef100-0000-7000-8000-000000000002')),
  'female',
  'T-PLN-AUDIENCE-06 y a la misma rutina le presta la de mujer cuando quien pregunta lo es');

-- ---------------------------------------------------------------- y con la negativa

select set_config('app.actor_person_id', '019ef100-0000-7000-8000-000000000003', true);

select planning.cover_for('019ef100-0000-7000-8000-0000000000c1',
                          '019ef100-0000-7000-8000-000000000003') as primera \gset

select ok(
  :'primera' = any (array['programs/019ef100-0000-7000-8000-0000000000c1/male/uno.webp',
                          'programs/019ef100-0000-7000-8000-0000000000c1/female/uno.webp']),
  'T-PLN-AUDIENCE-07 quien no lo dijo ve uno de los dos juegos, que son los que hay');

select is(
  planning.cover_for('019ef100-0000-7000-8000-0000000000c1',
                     '019ef100-0000-7000-8000-000000000003'),
  :'primera',
  'T-PLN-AUDIENCE-08 y el mismo la segunda vez: si no, sería otra portada en cada refresco');

-- **La mezcla es real.** Elegir siempre el mismo lado sería determinista y sería un solo
-- juego con otro nombre.
select is(
  (select count(distinct photo.audience)::integer
   from planning.program_cover_photos as photo
   where photo.object_key in (
     planning.cover_for('019ef100-0000-7000-8000-0000000000c1',
                        '019ef100-0000-7000-8000-000000000003'),
     planning.cover_for('019ef100-0000-7000-8000-0000000000c2',
                        '019ef100-0000-7000-8000-000000000003'))),
  2,
  'T-PLN-AUDIENCE-09 y dos programas no le caen del mismo lado: la mezcla es real');

select * from finish();

rollback;
