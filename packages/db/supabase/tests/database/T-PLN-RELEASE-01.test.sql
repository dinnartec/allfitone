-- Descartar una rutina la saca de tus programas — `OP-PLN-028`.
--
-- Lo que tiene que sostenerse: el programa que la usaba **se republica sin ella** y quien
-- lo estaba entrenando queda en la versión nueva sin hacer nada. La versión anterior no
-- se toca —es lo que alguien entrenó— y las sesiones ya planificadas de la rutina
-- descartada desaparecen de la agenda.
--
-- Y el límite: **un programa no se vacía**. Si la rutina es la única que le queda, el
-- descarte se rechaza nombrando el programa, porque uno sin sesiones no se puede publicar
-- y dejar a alguien con algo que ya no se puede tocar es peor que no borrar la rutina.
--
-- El orden importa y por eso el archivo está escrito así: primero se descarta la rutina
-- que **no** es la única, y sólo después se intenta con la que sí lo es.

begin;

select plan(7);

insert into identity.people (id, given_name, family_name)
values ('019ed000-0000-7000-8000-000000000001', 'Quien', 'Descarta');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ed000-0000-7000-8000-000000000001', true);

-- Dos rutinas, para que quitar una deje algo en pie.
select (planning.create_my_session_template(
  '019ed000-0000-7000-8000-000000000001', 'test_strength', 'Empuje',
  '84111111-1111-4111-8111-000000000001', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as created_a \gset
select (:'created_a'::jsonb->>'id') as template_a,
       (:'created_a'::jsonb->'draft'->>'etag') as etag_a0 \gset

select (planning.replace_my_session_template_draft(
  '019ed000-0000-7000-8000-000000000001', :'template_a'::uuid, :'etag_a0',
  '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":3,"target_reps":8}}]}'::jsonb,
  '84111111-1111-4111-8111-000000000002', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as saved_a \gset

select (planning.publish_my_session_template(
  '019ed000-0000-7000-8000-000000000001', :'template_a'::uuid, (:'saved_a'::jsonb->>'etag'),
  '84111111-1111-4111-8111-000000000003', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as version_a \gset

select (planning.create_my_session_template(
  '019ed000-0000-7000-8000-000000000001', 'test_strength', 'Tirón',
  '84111111-1111-4111-8111-000000000004', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).template as created_b \gset
select (:'created_b'::jsonb->>'id') as template_b,
       (:'created_b'::jsonb->'draft'->>'etag') as etag_b0 \gset

select (planning.replace_my_session_template_draft(
  '019ed000-0000-7000-8000-000000000001', :'template_b'::uuid, :'etag_b0',
  '{"title":"Tirón","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":4,"target_reps":6}}]}'::jsonb,
  '84111111-1111-4111-8111-000000000005', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as saved_b \gset

select (planning.publish_my_session_template(
  '019ed000-0000-7000-8000-000000000001', :'template_b'::uuid, (:'saved_b'::jsonb->>'etag'),
  '84111111-1111-4111-8111-000000000006', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as version_b \gset

-- Un programa con las dos, publicado y tomado.
select (planning.create_my_program(
  '019ed000-0000-7000-8000-000000000001', 'Mi semana',
  '84111111-1111-4111-8111-000000000007', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex'))).program as program \gset
select (:'program'::jsonb->>'id') as program_id,
       (:'program'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ed000-0000-7000-8000-000000000001', :'program_id'::uuid, :'petag0',
  ('{"title":"Mi semana","notes":null,"sessions":[{"position":1,"week":1,"day":1,"template_version_id":"' || (:'version_a'::jsonb->>'id') || '"},{"position":2,"week":1,"day":3,"template_version_id":"' || (:'version_b'::jsonb->>'id') || '"}]}')::jsonb,
  '84111111-1111-4111-8111-000000000008', extensions.uuid_generate_v7(),
  decode(repeat('08', 32), 'hex'))).draft as pdraft \gset

select (planning.publish_my_program(
  '019ed000-0000-7000-8000-000000000001', :'program_id'::uuid, (:'pdraft'::jsonb->>'etag'),
  '84111111-1111-4111-8111-000000000009', extensions.uuid_generate_v7(),
  decode(repeat('09', 32), 'hex'))).version as pversion \gset
select (:'pversion'::jsonb->>'id') as version_uno \gset

select planning.self_assign_program(
  '019ed000-0000-7000-8000-000000000001', :'version_uno'::uuid, 'America/Bogota',
  '84111111-1111-4111-8111-000000000010', extensions.uuid_generate_v7(),
  decode(repeat('0a', 32), 'hex')) as assignment \gset

select is(
  (select count(*)::integer from planning.program_version_sessions
   where program_version_id = :'version_uno'::uuid),
  2,
  'T-PLN-REL-01 el programa sale con las dos rutinas');

-- Y se descarta la primera.
select (planning.discard_my_session_template(
  '019ed000-0000-7000-8000-000000000001', :'template_a'::uuid,
  '84111111-1111-4111-8111-000000000011', extensions.uuid_generate_v7(),
  decode(repeat('0b', 32), 'hex'))).template as discarded \gset

select is(
  (:'discarded'::jsonb->>'status'),
  'archived',
  'T-PLN-REL-02 la rutina publicada se descarta');

select is(
  (select count(*)::integer from planning.program_versions where program_id = :'program_id'::uuid),
  2,
  'T-PLN-REL-03 y el programa gana una versión nueva en vez de cambiar la que había');

select is(
  (select count(*)::integer from planning.program_version_sessions
   where program_version_id = :'version_uno'::uuid),
  2,
  'T-PLN-REL-04 la versión anterior se queda como estaba, porque es lo que alguien entrenó');

select is(
  (select count(*)::integer
   from planning.program_version_sessions as composition
   join planning.session_template_versions as used on used.id = composition.template_version_id
   where composition.program_version_id = (
     select id from planning.program_versions where program_id = :'program_id'::uuid
     order by version_number desc limit 1)
     and used.template_id = :'template_a'::uuid),
  0,
  'T-PLN-REL-05 y la nueva ya no la lleva');

-- Lo que hace que la persona no tenga que hacer nada.
select is(
  (select version.version_number from planning.program_assignments as assignment
   join planning.program_versions as version on version.id = assignment.program_version_id
   where assignment.person_id = '019ed000-0000-7000-8000-000000000001'),
  2,
  'T-PLN-REL-06 la asignación se muda sola a la versión nueva');

-- El límite: la que queda es la única, y vaciar el programa no es una opción.
select throws_ok(
  format($$ select planning.discard_my_session_template(
    '019ed000-0000-7000-8000-000000000001', %L,
    '84111111-1111-4111-8111-000000000012', extensions.uuid_generate_v7(),
    decode(repeat('0c', 32), 'hex')) $$, :'template_b'),
  '23514',
  null,
  'T-PLN-REL-07 y la última rutina de un programa no se descarta: lo dejaría vacío');

select * from finish();

rollback;
