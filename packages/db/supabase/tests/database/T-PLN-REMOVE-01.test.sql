-- `OP-PLN-034` y `OP-PLN-035` — eliminar un programa y duplicarlo.
--
-- What has to hold: removing a published programme archives it, deprecates its
-- versions and **ends** the assignment — which is the part the screen reads, because
-- `read_my_programs` has no `program.status` predicate at all and answers whatever the
-- assignment says. What was trained survives; what was only planned is gone. With the
-- flag, a routine that only this programme used is archived and **one that another
-- programme of the person also uses is not** — archiving it would leave that other
-- programme unpublishable, which `OP-PLN-028` already refuses to do. Without the flag
-- no routine is touched at all. And duplicating leaves a draft and nothing else: no
-- version, no assignment, `- Copia` on the title.
--
-- The shared-routine assertion was written first and watched failing against a version
-- of the operation with the "no other programme uses it" guard taken out: `Empuje` came
-- back `archived`. Worth knowing what that experiment also showed — the neighbouring
-- programme kept reading **and kept publishing**, because `program_content_errors`
-- checks that a template version exists and is the person's, never whether its template
-- was archived. So the damage is invisible to the database and shows up in the library,
-- which is exactly why the guard has to be in the operation.
--
-- Every path sets `app.actor_person_id`. A `security definer` function under FORCE RLS
-- with no actor runs its loops, writes nothing and answers as if it had worked, so
-- everything here is asserted by counting rows and never by the call having returned.

begin;

select plan(37);

insert into identity.people (id, given_name, family_name)
values
  ('019ef000-0000-7000-8000-000000000001', 'Quien', 'Elimina'),
  ('019ef000-0000-7000-8000-000000000002', 'Vecina', 'Ajena');

-- El actor va primero, antes de escribir nada: las políticas del catálogo global lo
-- exigen y sin él la inserción no ve lo que acaba de poner.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef000-0000-7000-8000-000000000001', true);

-- Un programa global mínimo, para el caso de la copia de uno tomado de Allfit:
-- `db:reset` no carga el catálogo curado.
insert into planning.session_templates (id, content_scope, discipline_code, status)
values ('019ef000-0000-7000-8000-000000000201', 'global', 'test_strength', 'published');
insert into planning.programs (id, content_scope, status)
values ('019ef000-0000-7000-8000-000000000301', 'global', 'published');
update planning.programs
set routine_cover_kind = 'icon', routine_cover_icon = 'strength'
where id = '019ef000-0000-7000-8000-000000000301';

select set_config('app.planning_publication', 'true', true);
insert into planning.session_template_versions (
  id, template_id, version_number, discipline_code, activity_type_id, title, content_hash
) values (
  '019ef000-0000-7000-8000-000000000211', '019ef000-0000-7000-8000-000000000201', 1,
  'test_strength', '019c0000-0000-7000-8000-000000000011', 'Sentadilla',
  decode(repeat('e1', 32), 'hex'));
insert into planning.planned_steps (id, template_version_id, position)
values ('019ef000-0000-7000-8000-000000000221', '019ef000-0000-7000-8000-000000000211', 1);
insert into planning.strength_targets (planned_step_id, target_sets, target_reps)
values ('019ef000-0000-7000-8000-000000000221', 4, 8);
insert into planning.program_versions (id, program_id, version_number, title, content_hash)
values ('019ef000-0000-7000-8000-000000000303', '019ef000-0000-7000-8000-000000000301', 1,
  'Programa de Allfit', decode(repeat('e2', 32), 'hex'));
insert into planning.program_version_sessions (
  program_version_id, template_version_id, position, week, day
) values ('019ef000-0000-7000-8000-000000000303',
  '019ef000-0000-7000-8000-000000000211', 1, 1, 1);
select set_config('app.planning_publication', '', true);

set local role allfit_owner;

-- Tres rutinas propias. `Empuje` va a estar en dos programas y por eso se queda.
select (planning.create_my_session_template(
  '019ef000-0000-7000-8000-000000000001', 'test_strength', 'Empuje',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('a1', 32), 'hex'))).template as r1 \gset
select (:'r1'::jsonb->>'id') as r1_id, (:'r1'::jsonb->'draft'->>'etag') as r1_etag0 \gset
select (planning.replace_my_session_template_draft(
  '019ef000-0000-7000-8000-000000000001', :'r1_id'::uuid, :'r1_etag0',
  '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":4,"target_reps":8}}]}'::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('a2', 32), 'hex'))).draft as r1d \gset
select (:'r1d'::jsonb->>'etag') as r1_etag1 \gset
select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-000000000001', :'r1_id'::uuid, :'r1_etag1',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('a3', 32), 'hex'))).version as r1v \gset
select (:'r1v'::jsonb->>'id') as r1_version \gset

select (planning.create_my_session_template(
  '019ef000-0000-7000-8000-000000000001', 'test_strength', 'Tirón',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('b1', 32), 'hex'))).template as r2 \gset
select (:'r2'::jsonb->>'id') as r2_id, (:'r2'::jsonb->'draft'->>'etag') as r2_etag0 \gset
select (planning.replace_my_session_template_draft(
  '019ef000-0000-7000-8000-000000000001', :'r2_id'::uuid, :'r2_etag0',
  '{"title":"Tirón","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":3,"target_reps":10}}]}'::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('b2', 32), 'hex'))).draft as r2d \gset
select (:'r2d'::jsonb->>'etag') as r2_etag1 \gset
select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-000000000001', :'r2_id'::uuid, :'r2_etag1',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('b3', 32), 'hex'))).version as r2v \gset
select (:'r2v'::jsonb->>'id') as r2_version \gset

select (planning.create_my_session_template(
  '019ef000-0000-7000-8000-000000000001', 'test_strength', 'Core',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('c1', 32), 'hex'))).template as r3 \gset
select (:'r3'::jsonb->>'id') as r3_id, (:'r3'::jsonb->'draft'->>'etag') as r3_etag0 \gset
select (planning.replace_my_session_template_draft(
  '019ef000-0000-7000-8000-000000000001', :'r3_id'::uuid, :'r3_etag0',
  '{"title":"Core","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":5,"target_reps":12}}]}'::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('c2', 32), 'hex'))).draft as r3d \gset
select (:'r3d'::jsonb->>'etag') as r3_etag1 \gset
select (planning.publish_my_session_template(
  '019ef000-0000-7000-8000-000000000001', :'r3_id'::uuid, :'r3_etag1',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('c3', 32), 'hex'))).version as r3v \gset
select (:'r3v'::jsonb->>'id') as r3_version \gset

-- `Torso y pierna`: dos semanas, `Empuje` y `Tirón`. Es el que se elimina.
select (planning.create_my_program(
  '019ef000-0000-7000-8000-000000000001', 'Torso y pierna',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('11', 32), 'hex'))).program as p1 \gset
select (:'p1'::jsonb->>'id') as p1_id, (:'p1'::jsonb->'draft'->>'etag') as p1_etag0 \gset
select (planning.replace_my_program_draft(
  '019ef000-0000-7000-8000-000000000001', :'p1_id'::uuid, :'p1_etag0',
  format('{"title":"Torso y pierna","notes":null,"sessions":[{"position":1,"week":1,"day":1,"template_version_id":%s},{"position":2,"week":1,"day":3,"template_version_id":%s},{"position":3,"week":2,"day":1,"template_version_id":%s},{"position":4,"week":2,"day":3,"template_version_id":%s}]}',
    to_json(:'r1_version'::text), to_json(:'r2_version'::text),
    to_json(:'r1_version'::text), to_json(:'r2_version'::text))::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('12', 32), 'hex'))).draft as p1d \gset
select (:'p1d'::jsonb->>'etag') as p1_etag1 \gset
select (planning.publish_my_program(
  '019ef000-0000-7000-8000-000000000001', :'p1_id'::uuid, :'p1_etag1',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('13', 32), 'hex'))).version as p1v \gset
select (:'p1v'::jsonb->>'id') as p1_version \gset
select planning.self_assign_program(
  '019ef000-0000-7000-8000-000000000001', :'p1_version'::uuid, 'America/Bogota',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('14', 32), 'hex')) as p1_assignment \gset

-- `Sólo empuje`: comparte `Empuje` con el anterior y no se acaba nunca. Es el que tiene
-- que seguir en pie cuando el otro se vaya.
select (planning.create_my_program(
  '019ef000-0000-7000-8000-000000000001', 'Sólo empuje',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('21', 32), 'hex'))).program as p2 \gset
select (:'p2'::jsonb->>'id') as p2_id, (:'p2'::jsonb->'draft'->>'etag') as p2_etag0 \gset
select (planning.replace_my_program_draft(
  '019ef000-0000-7000-8000-000000000001', :'p2_id'::uuid, :'p2_etag0',
  format('{"title":"Sólo empuje","notes":null,"repeats_forever":true,"sessions":[{"position":1,"week":1,"day":2,"template_version_id":%s}]}',
    to_json(:'r1_version'::text))::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('22', 32), 'hex'))).draft as p2d \gset
select (:'p2d'::jsonb->>'etag') as p2_etag1 \gset
select (planning.publish_my_program(
  '019ef000-0000-7000-8000-000000000001', :'p2_id'::uuid, :'p2_etag1',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('23', 32), 'hex'))).version as p2v \gset
select (:'p2v'::jsonb->>'id') as p2_version \gset
select planning.self_assign_program(
  '019ef000-0000-7000-8000-000000000001', :'p2_version'::uuid, 'America/Bogota',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('24', 32), 'hex')) as p2_assignment \gset
select planning.set_my_program_cover(
  '019ef000-0000-7000-8000-000000000001', :'p2_id'::uuid, 'icon', 'strength',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('25', 32), 'hex')) as p2_cover \gset

-- `Con core`: el que se elimina **sin** la casilla, para ver que su rutina se queda.
select (planning.create_my_program(
  '019ef000-0000-7000-8000-000000000001', 'Con core',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('31', 32), 'hex'))).program as p3 \gset
select (:'p3'::jsonb->>'id') as p3_id, (:'p3'::jsonb->'draft'->>'etag') as p3_etag0 \gset
select (planning.replace_my_program_draft(
  '019ef000-0000-7000-8000-000000000001', :'p3_id'::uuid, :'p3_etag0',
  format('{"title":"Con core","notes":null,"sessions":[{"position":1,"week":1,"day":5,"template_version_id":%s}]}',
    to_json(:'r3_version'::text))::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('32', 32), 'hex'))).draft as p3d \gset
select (:'p3d'::jsonb->>'etag') as p3_etag1 \gset
select (planning.publish_my_program(
  '019ef000-0000-7000-8000-000000000001', :'p3_id'::uuid, :'p3_etag1',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('33', 32), 'hex'))).version as p3v \gset
select (:'p3v'::jsonb->>'id') as p3_version \gset
select planning.self_assign_program(
  '019ef000-0000-7000-8000-000000000001', :'p3_version'::uuid, 'America/Bogota',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('34', 32), 'hex')) as p3_assignment \gset

-- Lo entrenado, de las dos maneras en las que se puede estar entrenado: una sesión
-- cerrada y otra abierta con un intento encima. La clave foránea de
-- `planned_session_executions` es `RESTRICT` y la segunda rompería el borrado.
select id as p1_done from planning.planned_sessions
where assignment_id = :'p1_assignment'::uuid
order by scheduled_at, id limit 1 \gset
update planning.planned_sessions set status = 'completed' where id = :'p1_done'::uuid;

select id as p1_attempted from planning.planned_sessions
where assignment_id = :'p1_assignment'::uuid and id <> :'p1_done'::uuid
order by scheduled_at, id limit 1 \gset
select * from execution.start_planned_session_attempt(
  '019ef000-0000-7000-8000-000000000001', :'p1_attempted'::uuid,
  clock_timestamp(), 'America/Bogota', 'detailed', 'manual',
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('41', 32), 'hex'));

select is(
  (select count(*)::integer from planning.planned_sessions
    where assignment_id = :'p1_assignment'::uuid),
  4,
  'T-PLN-REMOVE-00 the programme starts with four planned sessions, two of them trained');

-- El acto.
select (planning.remove_my_program(
  '019ef000-0000-7000-8000-000000000001', :'p1_id'::uuid, true,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('51', 32), 'hex'))).program as removed \gset

select is(
  (select status::text from planning.programs where id = :'p1_id'::uuid),
  'archived',
  'T-PLN-REMOVE-01 removing a programme archives it');

select ok(
  exists (select 1 from planning.programs where id = :'p1_id'::uuid),
  'T-PLN-REMOVE-02 without deleting the row: `allfit_api` has no DELETE on this resource');

select ok(
  not exists (select 1 from planning.program_drafts where program_id = :'p1_id'::uuid),
  'T-PLN-REMOVE-03 and its draft is gone');

select is(
  (select count(*)::integer from planning.program_versions
    where program_id = :'p1_id'::uuid and status = 'published'),
  0,
  'T-PLN-REMOVE-04 every published version is deprecated');

select is(
  (select count(*)::integer from planning.program_versions
    where program_id = :'p1_id'::uuid and status = 'deprecated'),
  1,
  'T-PLN-REMOVE-05 and not one of them is deleted: `ADR-009` freezes them');

select is(
  (select lifecycle::text from planning.program_assignments
    where id = :'p1_assignment'::uuid),
  'ended',
  'T-PLN-REMOVE-06 the personal assignment ends — the first writer of that value');

-- Lo que de verdad lo saca de la pantalla: `read_my_programs` no mira el estado del
-- programa, mira la asignación.
select ok(
  not exists (
    select 1 from planning.read_my_programs('019ef000-0000-7000-8000-000000000001')
    where program_id = :'p1_id'::uuid),
  'T-PLN-REMOVE-07 and it stops being one of my programmes');

select ok(
  exists (
    select 1 from planning.read_my_programs('019ef000-0000-7000-8000-000000000001')
    where program_id = :'p2_id'::uuid),
  'T-PLN-REMOVE-08 while the neighbouring programme stays exactly where it was');

select ok(
  exists (select 1 from planning.planned_sessions where id = :'p1_done'::uuid),
  'T-PLN-REMOVE-09 the session already closed survives: it is somebody''s morning');

select ok(
  exists (select 1 from planning.planned_sessions where id = :'p1_attempted'::uuid),
  'T-PLN-REMOVE-10 and so does the one with an attempt on it');

select is(
  (select count(*)::integer from planning.planned_sessions
    where assignment_id = :'p1_assignment'::uuid),
  2,
  'T-PLN-REMOVE-11 and the two that were only planned are gone');

select is(
  (select status::text from planning.session_templates where id = :'r2_id'::uuid),
  'archived',
  'T-PLN-REMOVE-12 with the flag, the routine only this programme used is archived');

select ok(
  exists (select 1 from planning.session_template_drafts where template_id = :'r2_id'::uuid),
  'T-PLN-REMOVE-13 and keeps its draft, because archiving is not deleting — as in OP-PLN-028');

select isnt(
  (select status::text from planning.session_templates where id = :'r1_id'::uuid),
  'archived',
  'T-PLN-REMOVE-14 but one that another programme of mine also uses is **not**');

select is(
  (select count(*)::integer from planning.read_my_programs('019ef000-0000-7000-8000-000000000001')
    where program_id = :'p2_id'::uuid),
  1,
  'T-PLN-REMOVE-15 so that programme still reads');

-- Y todavía se puede publicar, que es la prueba de verdad: una rutina archivada lo
-- dejaría sin una sola sesión y `OP-PLN-028` ya se niega a llegar ahí.
select (planning.replace_my_program_draft(
  '019ef000-0000-7000-8000-000000000001', :'p2_id'::uuid,
  (select planning.content_etag(content) from planning.program_drafts
    where program_id = :'p2_id'::uuid),
  format('{"title":"Sólo empuje","notes":"Sigue en pie","repeats_forever":true,"sessions":[{"position":1,"week":1,"day":2,"template_version_id":%s}]}',
    to_json(:'r1_version'::text))::jsonb,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('26', 32), 'hex'))).draft as p2d2 \gset
select (:'p2d2'::jsonb->>'etag') as p2_etag2 \gset

select lives_ok(
  format($$ select planning.publish_my_program(
    '019ef000-0000-7000-8000-000000000001', %L::uuid, %L,
    extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
    decode(repeat('27', 32), 'hex')) $$, :'p2_id', :'p2_etag2'),
  'T-PLN-REMOVE-16 and still publishes');

select ok(
  exists (
    select 1 from system.outbox_events
    where aggregate_id = :'p1_id'::uuid
      and event_type = 'planning.program_discarded.v1'),
  'T-PLN-REMOVE-17 a removal is explicable afterwards');

select ok(
  exists (
    select 1 from system.outbox_events
    where aggregate_id = :'p1_assignment'::uuid
      and event_type = 'planning.assignment_ended.v1'),
  'T-PLN-REMOVE-18 and so is the end of the assignment');

select ok(
  exists (
    select 1 from system.outbox_events
    where aggregate_id = :'r2_id'::uuid
      and event_type = 'planning.session_template_discarded.v1'),
  'T-PLN-REMOVE-19 and so is every routine that went with it');

-- Dos veces converge. Quien lo pulsa otra vez, o un reintento que llega tarde, no es
-- un error: es la misma intención llegando al mismo sitio.
select lives_ok(
  format($$ select planning.remove_my_program(
    '019ef000-0000-7000-8000-000000000001', %L::uuid, true,
    extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
    decode(repeat('52', 32), 'hex')) $$, :'p1_id'),
  'T-PLN-REMOVE-20 removing twice converges rather than failing');

select is(
  (select count(*)::integer from planning.planned_sessions
    where assignment_id = :'p1_assignment'::uuid),
  2,
  'T-PLN-REMOVE-21 and the second pass takes nothing else with it');

-- Sin la casilla no se toca ninguna rutina, ni siquiera la que nadie más usa.
select planning.remove_my_program(
  '019ef000-0000-7000-8000-000000000001', :'p3_id'::uuid, false,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('53', 32), 'hex'));

select is(
  (select status::text from planning.programs where id = :'p3_id'::uuid),
  'archived',
  'T-PLN-REMOVE-22 without the flag the programme still goes');

select isnt(
  (select status::text from planning.session_templates where id = :'r3_id'::uuid),
  'archived',
  'T-PLN-REMOVE-23 but its routine is not touched');

-- El de otra persona no se elimina. El actor es la vecina y el programa no es suyo.
select set_config('app.actor_person_id', '019ef000-0000-7000-8000-000000000002', true);
select throws_ok(
  format($$ select planning.remove_my_program(
    '019ef000-0000-7000-8000-000000000002', %L::uuid, true,
    extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
    decode(repeat('54', 32), 'hex')) $$, :'p2_id'),
  'P0002',
  'program not found',
  'T-PLN-REMOVE-24 somebody else''s programme cannot be removed');

select set_config('app.actor_person_id', '019ef000-0000-7000-8000-000000000001', true);
select isnt(
  (select status::text from planning.programs where id = :'p2_id'::uuid),
  'archived',
  'T-PLN-REMOVE-25 and the attempt leaves it exactly as it was');

-- `OP-PLN-035`. La copia existe como borrador y nada más.
select program as copy from planning.duplicate_my_program(
  '019ef000-0000-7000-8000-000000000001', :'p2_id'::uuid,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('61', 32), 'hex')) \gset
select (:'copy'::jsonb->>'id') as copy_id \gset

select is(
  (select content->>'title' from planning.program_drafts where program_id = :'copy_id'::uuid),
  'Sólo empuje - Copia',
  'T-PLN-DUP-01 duplicating leaves a copy that says it is one');

select is(
  (select status::text from planning.programs where id = :'copy_id'::uuid),
  'draft',
  'T-PLN-DUP-02 and it is a draft, not a programme somebody is training');

select is(
  (select count(*)::integer from planning.program_versions where program_id = :'copy_id'::uuid),
  0,
  'T-PLN-DUP-03 it mints no version: publishing it is the tick in the editor');

select is(
  (select count(*)::integer from planning.program_assignments as assignment
    join planning.program_versions as version on version.id = assignment.program_version_id
    where version.program_id = :'copy_id'::uuid),
  0,
  'T-PLN-DUP-04 and no assignment: a copy is not something you started');

select is(
  (select jsonb_build_object('kind', routine_cover_kind, 'icon', routine_cover_icon)
    from planning.programs where id = :'copy_id'::uuid),
  '{"kind": "icon", "icon": "strength"}'::jsonb,
  'T-PLN-DUP-05 the style is the programme''s, so the copy is recognised like its original');

select is(
  (select content->>'repeats_forever' from planning.program_drafts
    where program_id = :'copy_id'::uuid),
  'true',
  'T-PLN-DUP-06 and a programme with no end copies as a programme with no end');

-- La composición sale de la **última versión publicada**, no del borrador: duplicar no
-- publica de paso lo que alguien tuviera a medias.
select is(
  (select content->'sessions' from planning.program_drafts where program_id = :'copy_id'::uuid),
  (select coalesce(jsonb_agg(jsonb_build_object(
     'position', composition.position, 'week', composition.week, 'day', composition.day,
     'template_version_id', composition.template_version_id
   ) order by composition.position), '[]'::jsonb)
   from planning.program_version_sessions as composition
   where composition.program_version_id = (
     select id from planning.program_versions where program_id = :'p2_id'::uuid
     order by version_number desc limit 1)),
  'T-PLN-DUP-07 its composition is the one the original last published');

select is(
  (select count(*)::integer from planning.session_templates
    where owner_person_id = '019ef000-0000-7000-8000-000000000001'),
  3,
  'T-PLN-DUP-08 and not one routine is copied: the composition points at the same versions');

-- Un programa de Allfit se toma sin borrador —así nacían antes de `20260919240000`— y
-- sin borrador no se puede editar. Duplicarlo es la salida.
select planning.self_assign_program(
  '019ef000-0000-7000-8000-000000000001', '019ef000-0000-7000-8000-000000000303',
  'America/Bogota', extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('71', 32), 'hex')) as taken_assignment \gset
select version.program_id as taken_id
from planning.program_assignments as assignment
join planning.program_versions as version on version.id = assignment.program_version_id
where assignment.id = :'taken_assignment'::uuid \gset
delete from planning.program_drafts where program_id = :'taken_id'::uuid;

select program as taken_copy from planning.duplicate_my_program(
  '019ef000-0000-7000-8000-000000000001', :'taken_id'::uuid,
  extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
  decode(repeat('72', 32), 'hex')) \gset
select (:'taken_copy'::jsonb->>'id') as taken_copy_id \gset

select ok(
  exists (select 1 from planning.program_drafts where program_id = :'taken_copy_id'::uuid),
  'T-PLN-DUP-09 a programme taken from Allfit with no draft still duplicates into an editable one');

select is(
  (select jsonb_array_length(content->'sessions') from planning.program_drafts
    where program_id = :'taken_copy_id'::uuid),
  1,
  'T-PLN-DUP-10 with the composition of the version it was taken at');

-- El de otra persona tampoco se duplica: copiarlo sería llevárselo.
select set_config('app.actor_person_id', '019ef000-0000-7000-8000-000000000002', true);
select throws_ok(
  format($$ select planning.duplicate_my_program(
    '019ef000-0000-7000-8000-000000000002', %L::uuid,
    extensions.uuid_generate_v7(), extensions.uuid_generate_v7(),
    decode(repeat('73', 32), 'hex')) $$, :'p2_id'),
  'P0002',
  'program not found',
  'T-PLN-DUP-11 somebody else''s programme cannot be duplicated');

select * from finish();

rollback;
