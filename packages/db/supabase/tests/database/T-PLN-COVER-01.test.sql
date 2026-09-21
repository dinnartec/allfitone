-- `IX-48` — la portada la pone el programa, y qué se le permite ser.
--
-- Lo que tiene que valer: una rutina **no** puede declarar portada —la clave dejó de
-- existir en su contenido y la lista blanca de forma la rechaza entera—; un programa sí,
-- y cada clase lleva exactamente su carga; la rutina se viste del programa que la usa;
-- una rutina suelta no lleva ninguna; y vestir un programa **no publica nada**, porque
-- el estilo no describe lo que se entrena.
--
-- La negativa se escribió primero y se vio pasar contra las funciones viejas: mientras
-- `session_content_errors` conoció la clave `cover`, un borrador que la llevara se
-- aceptaba, y ésa es la aserción de arriba. La lista blanca es lo que hace imposible
-- cualquier otra clave, así que se comprueba que la portada volvió a caer fuera de ella.
--
-- La aserción que más importa es la del final del bloque del programa: si vestir acuñara
-- una versión, cambiar de icono reescribiría lo que alguien está entrenando.

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

-- Una portada de catálogo contra la que elegir, con sus dos juegos. Propia del test:
-- `seed.sql` no carga la curaduría, así que las veinticuatro reales pueden no estar
-- donde esto corra.
insert into planning.programs (id, content_scope, status)
values ('019ef000-0000-7000-8000-0000000000c1', 'global', 'published');

insert into planning.program_cover_photos (program_id, audience, object_key)
values
  ('019ef000-0000-7000-8000-0000000000c1', 'male',
   'programs/019ef000-0000-7000-8000-0000000000c1/male/prueba.webp'),
  ('019ef000-0000-7000-8000-0000000000c1', 'female',
   'programs/019ef000-0000-7000-8000-0000000000c1/female/prueba.webp');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef000-0000-7000-8000-000000000001', true);

-- ---------------------------------------------------------------- la rutina no elige

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"cover":{"kind":"muscles"}}'::jsonb,
    null, 'test_strength', false),
  array['invalid-content-shape'],
  'IX-48 · a routine cannot declare a cover: the key is not part of its content');

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[],"portada":"barra"}'::jsonb,
    null, 'test_strength', false),
  array['invalid-content-shape'],
  'and the allow-list is what makes every other key impossible, which is why');

select is(
  planning.session_content_errors(
    '{"title":"Pierna","activity_type_id":null,"steps":[]}'::jsonb,
    null, 'test_strength', false),
  array[]::text[],
  'a routine with nothing but its own content is valid');

select is(
  planning.canonical_session_content(
    '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[],"cover":{"kind":"icon","icon":"strength"}}'::jsonb)
    ? 'cover',
  false,
  'IX-48 · and it is outside the publication hash, because it is not the routine to give');

-- ------------------------------------------------------------- el programa sí elige

select (planning.create_my_program(
  '019ef000-0000-7000-8000-000000000001', 'Mi plan',
  '82cf2222-2222-4222-8222-000000000001', extensions.uuid_generate_v7(),
  decode(repeat('a1', 32), 'hex'))).program as mine \gset
select (:'mine'::jsonb->>'id') as program_id \gset

select is(
  (select routine_cover_kind::text from planning.programs where id = :'program_id'::uuid),
  null,
  'a programme starts saying nothing, and its routines are known by their names');

select is(
  planning.set_my_program_cover(
    '019ef000-0000-7000-8000-000000000001', :'program_id'::uuid, 'icon', 'strength',
    '82cf2222-2222-4222-8222-000000000002', extensions.uuid_generate_v7(),
    decode(repeat('a2', 32), 'hex')),
  jsonb_build_object('program_id', :'program_id', 'cover',
                     '{"kind":"icon","icon":"strength"}'::jsonb),
  'IX-48 · dressing it answers what its routines now wear');

select is(
  (select jsonb_build_object('kind', routine_cover_kind, 'icon', routine_cover_icon)
   from planning.programs where id = :'program_id'::uuid),
  '{"kind": "icon", "icon": "strength"}'::jsonb,
  'and that is what the row holds');

select throws_ok(
  format($$select planning.set_my_program_cover(%L, %L, 'muscles', 'strength', %L, %L, %L)$$,
         '019ef000-0000-7000-8000-000000000001', :'program_id',
         '82cf2222-2222-4222-8222-000000000003', extensions.uuid_generate_v7(),
         decode(repeat('a3', 32), 'hex')),
  '22023', null,
  'IX-48 · a muscle cover carrying an icon is two answers to one question');

select throws_ok(
  format($$select planning.set_my_program_cover(%L, %L, 'icon', null, %L, %L, %L)$$,
         '019ef000-0000-7000-8000-000000000001', :'program_id',
         '82cf2222-2222-4222-8222-000000000004', extensions.uuid_generate_v7(),
         decode(repeat('a4', 32), 'hex')),
  '22023', null,
  'and an icon cover naming no icon is refused');

select throws_ok(
  format($$select planning.set_my_program_cover(%L, %L, 'barra', null, %L, %L, %L)$$,
         '019ef000-0000-7000-8000-000000000001', :'program_id',
         '82cf2222-2222-4222-8222-000000000005', extensions.uuid_generate_v7(),
         decode(repeat('a5', 32), 'hex')),
  '22023', null,
  'and a name outside the vocabulary is not a cover');

select throws_ok(
  format($$select planning.set_my_program_cover(%L, %L, 'muscles', null, %L, %L, %L)$$,
         '019ef000-0000-7000-8000-000000000001', '019ef000-0000-7000-8000-0000000000c1',
         '82cf2222-2222-4222-8222-000000000006', extensions.uuid_generate_v7(),
         decode(repeat('a6', 32), 'hex')),
  'P0002', null,
  'IX-48 · and a programme that is not theirs cannot be redressed at all');

-- **Vestir no publica.** Si acuñara una versión, cambiar de icono reescribiría lo que
-- alguien está entrenando.
select is(
  (select count(*)::integer from planning.program_versions
   where program_id = :'program_id'::uuid),
  0,
  'IX-48 · dressing a programme mints no version: the style is not what is trained');

-- ------------------------------------------------------- y la rutina se viste de él

select (planning.create_my_session_template(
  '019ef000-0000-7000-8000-000000000001', 'test_strength', 'Pierna',
  '82cf1111-1111-4111-8111-000000000001', extensions.uuid_generate_v7(),
  decode(repeat('f1', 32), 'hex'))).template as created \gset
select (:'created'::jsonb->>'id') as template_id,
       (:'created'::jsonb->'draft'->>'etag') as etag0 \gset

select is(
  (select mine.item->'cover' from jsonb_array_elements(
     planning.read_my_content('019ef000-0000-7000-8000-000000000001')) as mine(item)
   where mine.item->>'template_id' = :'template_id'),
  'null'::jsonb,
  'IX-48 · a routine no programme holds wears nothing, and its name does the work');

select is(
  planning.pick_routine_cover(:'template_id'::uuid, 'lower',
                              '019ef000-0000-7000-8000-000000000001'),
  planning.pick_routine_cover(:'template_id'::uuid, 'lower',
                              '019ef000-0000-7000-8000-000000000001'),
  'IX-48 · and within a photograph, the same routine always gets the same picture');

select * from finish();

rollback;
