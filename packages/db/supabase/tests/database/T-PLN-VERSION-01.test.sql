-- `ADR-009` — publicar avanza, nunca retrocede.
--
-- Lo que tiene que sostenerse: publicar un borrador idéntico a la **última** versión no
-- crea otra y devuelve esa; publicar uno idéntico a una versión **anterior** crea la
-- siguiente. Deshacer un cambio es historia hacia adelante, no un regreso.
--
-- La prueba nació de un defecto real. La deduplicación comparaba el hash contra todas
-- las versiones de la plantilla, y un índice único `(template_id, content_hash)` la
-- obligaba: quitar la portada que se acababa de poner devolvía el identificador de una
-- versión vieja. Ese identificador vive en la semana de un programa, y el resto del
-- producto resuelve el contenido vigente por la última versión publicada, así que el
-- día quedaba apuntando a una versión real que ninguna consulta de biblioteca nombra y
-- la rutina desaparecía del programa.
--
-- La aserción que importa es la última: la versión que publicar devuelve es siempre la
-- de número más alto. Es exactamente lo que la semana necesita para resolver.

begin;

select plan(9);

insert into identity.people (id, given_name, family_name)
values ('019ef000-0000-7000-8000-0000000000b1', 'Quien', 'Publica');

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values ('019ef000-0000-7000-8000-0000000000b2', 'test_strength', 'Sentadilla de prueba',
        'sentadilla de prueba', 'global', 'published');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef000-0000-7000-8000-0000000000b1', true);

select (planning.create_my_session_template(
  '019ef000-0000-7000-8000-0000000000b1', 'test_strength', 'Pierna',
  '82cf2222-2222-4222-8222-000000000001', extensions.uuid_generate_v7(),
  decode(repeat('a1', 32), 'hex'))).template as created \gset
select (:'created'::jsonb->>'id') as template_id,
       (:'created'::jsonb->'draft'->>'etag') as etag0 \gset

-- Sin portada: el contenido del que se sale y al que se vuelve.
select (planning.replace_my_session_template_draft(
  '019ef000-0000-7000-8000-0000000000b1', :'template_id'::uuid, :'etag0',
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","cover":null,"steps":[{"position":1,"movement_id":"019ef000-0000-7000-8000-0000000000b2","target":{"family":"strength","target_sets":3,"target_reps":10}}]}'::jsonb,
  '82cf2222-2222-4222-8222-000000000002', extensions.uuid_generate_v7(),
  decode(repeat('a2', 32), 'hex'))).draft as bare \gset
select (:'bare'::jsonb->>'etag') as etag_bare \gset

select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-0000000000b1', :'template_id'::uuid, :'etag_bare',
  '82cf2222-2222-4222-8222-000000000003', extensions.uuid_generate_v7(),
  decode(repeat('a3', 32), 'hex'))).version as first \gset
select (:'first'::jsonb->>'id') as v1 \gset

select is(
  (select version_number from planning.session_template_versions where id = :'v1'::uuid),
  1,
  'la primera publicación es la versión 1');

-- Se le pone portada: contenido distinto, versión distinta.
select (planning.replace_my_session_template_draft(
  '019ef000-0000-7000-8000-0000000000b1', :'template_id'::uuid, :'etag_bare',
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","cover":{"kind":"muscles"},"steps":[{"position":1,"movement_id":"019ef000-0000-7000-8000-0000000000b2","target":{"family":"strength","target_sets":3,"target_reps":10}}]}'::jsonb,
  '82cf2222-2222-4222-8222-000000000004', extensions.uuid_generate_v7(),
  decode(repeat('a4', 32), 'hex'))).draft as covered \gset
select (:'covered'::jsonb->>'etag') as etag_covered \gset

select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-0000000000b1', :'template_id'::uuid, :'etag_covered',
  '82cf2222-2222-4222-8222-000000000005', extensions.uuid_generate_v7(),
  decode(repeat('a5', 32), 'hex'))).version as second \gset
select (:'second'::jsonb->>'id') as v2 \gset

select is(
  (select version_number from planning.session_template_versions where id = :'v2'::uuid),
  2,
  'ponerle portada es la versión 2');

-- Y se le quita: el contenido vuelve a ser el de la versión 1.
select (planning.replace_my_session_template_draft(
  '019ef000-0000-7000-8000-0000000000b1', :'template_id'::uuid, :'etag_covered',
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","cover":null,"steps":[{"position":1,"movement_id":"019ef000-0000-7000-8000-0000000000b2","target":{"family":"strength","target_sets":3,"target_reps":10}}]}'::jsonb,
  '82cf2222-2222-4222-8222-000000000006', extensions.uuid_generate_v7(),
  decode(repeat('a6', 32), 'hex'))).draft as undone \gset
select (:'undone'::jsonb->>'etag') as etag_undone \gset

select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-0000000000b1', :'template_id'::uuid, :'etag_undone',
  '82cf2222-2222-4222-8222-000000000007', extensions.uuid_generate_v7(),
  decode(repeat('a7', 32), 'hex'))).version as third \gset
select (:'third'::jsonb->>'id') as v3 \gset

select isnt(
  :'v3'::uuid, :'v1'::uuid,
  'quitar la portada no devuelve la versión que tenía ese mismo contenido');

select is(
  (select version_number from planning.session_template_versions where id = :'v3'::uuid),
  3,
  'sino que crea la siguiente');

select is(
  (select count(*)::integer from planning.session_template_versions
   where template_id = :'template_id'::uuid),
  3,
  'y la plantilla tiene tres versiones, no dos');

select is(
  (select v1.content_hash from planning.session_template_versions as v1 where v1.id = :'v1'::uuid),
  (select v3.content_hash from planning.session_template_versions as v3 where v3.id = :'v3'::uuid),
  'dos versiones de una plantilla pueden repetir contenido: eso es deshacer un cambio');

-- Publicar lo mismo otra vez, sin tocar nada: no hay versión nueva que crear.
select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-0000000000b1', :'template_id'::uuid, :'etag_undone',
  '82cf2222-2222-4222-8222-000000000008', extensions.uuid_generate_v7(),
  decode(repeat('a8', 32), 'hex'))).version as again \gset

select is(
  (:'again'::jsonb->>'id')::uuid, :'v3'::uuid,
  'republicar lo que ya está publicado devuelve esa misma versión');

select is(
  (select count(*)::integer from planning.session_template_versions
   where template_id = :'template_id'::uuid),
  3,
  'y no crea ninguna');

-- Lo que la semana de un programa necesita para resolver el día.
select is(
  (:'again'::jsonb->>'id')::uuid,
  (select id from planning.session_template_versions
   where template_id = :'template_id'::uuid
   order by version_number desc limit 1),
  'publicar devuelve siempre la versión de número más alto');

select * from finish();

rollback;
