-- `OP-PLN-021` — el detalle del programa se ve antes de leerse.
--
-- La ficha exige la portada del programa —«la del detalle es la misma que la de la
-- lista»— y la lectura no devolvía ninguna. Con ella entra la de cada día del reparto.
-- Decidir ocho semanas mirando una lista de nombres es decidir a ciegas sobre lo único
-- que hay que mirar.
--
-- La demostración de cada ejercicio **no se prueba aquí porque no sale de aquí**: vive
-- en el catálogo de movimientos y la pantalla la cruza por identificador, igual que
-- hace el editor de rutina.
--
-- Lo que tiene que valer: el programa responde la portada del juego de quien pregunta;
-- el día responde la de su rutina, que sale de la región que esa rutina trabaja; y un
-- ejercicio sin arte curado no se cae ni desaparece del día.

begin;

select plan(5);

insert into identity.people (id, given_name, family_name, biological_sex)
values
  ('019ef200-0000-7000-8000-000000000001', 'Quien', 'Declaró Hombre', 'male'),
  ('019ef200-0000-7000-8000-000000000002', 'Quien', 'Declaró Mujer', 'female');

-- Un programa global con sus dos juegos de portada, y otro que prestará la suya.
insert into planning.programs (id, content_scope, status)
values ('019ef200-0000-7000-8000-0000000000c1', 'global', 'published');

insert into planning.program_cover_photos (program_id, audience, object_key)
values
  ('019ef200-0000-7000-8000-0000000000c1', 'male',
   'programs/019ef200-0000-7000-8000-0000000000c1/male/prueba.webp'),
  ('019ef200-0000-7000-8000-0000000000c1', 'female',
   'programs/019ef200-0000-7000-8000-0000000000c1/female/prueba.webp');

insert into planning.program_versions
  (id, program_id, version_number, title, status, published_at, content_hash)
values ('019ef200-0000-7000-8000-0000000000d1', '019ef200-0000-7000-8000-0000000000c1', 1,
        'Con arte', 'published', now(), decode(repeat('d1', 32), 'hex'));

-- Un movimiento con demostración y otro sin ella: la curaduría siempre va por detrás
-- del catálogo, y eso no puede tumbar la lectura.
insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values
  ('019ef200-0000-7000-8000-0000000000f1', 'test_strength', 'Sentadilla con demo',
   'sentadilla con demo', 'global', 'published'),
  ('019ef200-0000-7000-8000-0000000000f2', 'test_strength', 'Zancada sin demo',
   'zancada sin demo', 'global', 'published');

insert into catalog.movement_media
  (movement_id, kind, object_key, content_type, width, height, byte_size, checksum)
values ('019ef200-0000-7000-8000-0000000000f1', 'demo',
        'movements/019ef200-0000-7000-8000-0000000000f1/demo.webp', 'image/webp',
        180, 180, 1000, repeat('a', 64));

-- La rutina del día trabaja pierna, que es lo que decide qué portada se le presta.
insert into catalog.muscles (id, code, name, region, body_slug, status, display_order)
values ('019ef200-0000-7000-8000-0000000000a1', 'test_quads_detail', 'Cuádriceps de detalle',
        'lower', 'quadriceps', 'published', 1);

insert into catalog.movement_muscles (movement_id, muscle_id, is_primary)
values
  ('019ef200-0000-7000-8000-0000000000f1', '019ef200-0000-7000-8000-0000000000a1', true),
  ('019ef200-0000-7000-8000-0000000000f2', '019ef200-0000-7000-8000-0000000000a1', true);

insert into planning.session_templates (id, discipline_code, content_scope, status)
values ('019ef200-0000-7000-8000-0000000000e1', 'test_strength', 'global', 'published');

insert into planning.session_template_versions
  (id, template_id, version_number, title, discipline_code, activity_type_id, status,
   published_at, content_hash)
values ('019ef200-0000-7000-8000-0000000000e3', '019ef200-0000-7000-8000-0000000000e1', 1,
        'Pierna', 'test_strength', '019c0000-0000-7000-8000-000000000011', 'published',
        now(), decode(repeat('b1', 32), 'hex'));

insert into planning.planned_steps (id, template_version_id, position, movement_id)
values
  ('019ef200-0000-7000-8000-000000000091', '019ef200-0000-7000-8000-0000000000e3', 1,
   '019ef200-0000-7000-8000-0000000000f1'),
  ('019ef200-0000-7000-8000-000000000092', '019ef200-0000-7000-8000-0000000000e3', 2,
   '019ef200-0000-7000-8000-0000000000f2');

insert into planning.program_version_sessions
  (program_version_id, week, day, position, template_version_id)
values ('019ef200-0000-7000-8000-0000000000d1', 1, 1, 1, '019ef200-0000-7000-8000-0000000000e3');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef200-0000-7000-8000-000000000001', true);

-- --------------------------------------------------------- la portada del programa

select is(
  (select detail.cover_object_key
   from planning.read_program_version('019ef200-0000-7000-8000-000000000001',
                                      '019ef200-0000-7000-8000-0000000000d1') as detail),
  'programs/019ef200-0000-7000-8000-0000000000c1/male/prueba.webp',
  'OP-PLN-021 · the detail answers the cover of the set that is asking');

select set_config('app.actor_person_id', '019ef200-0000-7000-8000-000000000002', true);

select is(
  (select detail.cover_object_key
   from planning.read_program_version('019ef200-0000-7000-8000-000000000002',
                                      '019ef200-0000-7000-8000-0000000000d1') as detail),
  'programs/019ef200-0000-7000-8000-0000000000c1/female/prueba.webp',
  'and the other set for whoever declared the other, like the list does');

select set_config('app.actor_person_id', '019ef200-0000-7000-8000-000000000001', true);

-- ------------------------------------------------------------- la portada del día

select isnt(
  (select detail.days->0->>'cover_object_key'
   from planning.read_program_version('019ef200-0000-7000-8000-000000000001',
                                      '019ef200-0000-7000-8000-0000000000d1') as detail),
  null,
  'OP-PLN-021 · each day of the split answers the picture its routine wears');

select is(
  (select detail.days->0->>'cover_object_key'
   from planning.read_program_version('019ef200-0000-7000-8000-000000000001',
                                      '019ef200-0000-7000-8000-0000000000d1') as detail),
  planning.pick_routine_cover('019ef200-0000-7000-8000-0000000000e1', 'lower',
                              '019ef200-0000-7000-8000-000000000001'),
  'and it is the one its region earns it, not one picked at random');

select is(
  (select jsonb_array_length(detail.days->0->'steps')
   from planning.read_program_version('019ef200-0000-7000-8000-000000000001',
                                      '019ef200-0000-7000-8000-0000000000d1') as detail),
  2,
  'OP-PLN-021 · and a movement with no curated demonstration still travels in its day');

select * from finish();

rollback;
