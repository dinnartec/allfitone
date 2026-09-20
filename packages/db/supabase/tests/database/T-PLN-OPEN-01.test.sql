-- Un programa que no tiene fin.
--
-- Lo que tiene que valer: `repeats_forever` viaja del borrador a la versión y entra en
-- el hash, así que dos programas que sólo se diferencian en eso son dos programas;
-- tomarlo siembra **una** semana y no la composición entera; leer la agenda siembra la
-- semana que va a enseñar, una sola vez, con la semana de composición que el ciclo dice;
-- y nada de esto toca a un programa con fin, que se sigue materializando entero.
--
-- Las tres de la siembra se escribieron antes que `plant_my_open_week` y se vieron
-- fallar con la semana siguiente vacía. La trampa de esta base de datos es la contraria:
-- una función `security definer` bajo FORCE RLS sin `app.actor_person_id` recorre sus
-- bucles y no escribe nada, en silencio. Por eso el actor se fija antes de sembrar y
-- cada aserción cuenta filas, no llamadas.
--
-- La semana siguiente se simula moviendo la asignación una semana atrás —y con ella lo
-- ya sembrado—, no falseando el reloj: `clock_timestamp()` es lo que la función usa para
-- decidir qué semana está enseñando, y mentirle sería probar otra cosa.
begin;

select plan(18);

insert into identity.people (id, given_name, family_name)
values
  ('019eb000-0000-7000-8000-000000000001', 'Sin', 'Fin'),
  ('019eb000-0000-7000-8000-000000000002', 'Quien', 'Toma');

-- El contexto del actor va primero, antes de escribir un objetivo: el chequeo de
-- `IX-22` resuelve la familia con un lector `security definer`, y sin actor no ve
-- catálogo ninguno y rechaza un objetivo perfectamente válido.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019eb000-0000-7000-8000-000000000001', true);

-- Un programa de Allfit sin fecha de fin, para probar que tomarlo lo copia sin fin.
-- Se arma como `postgres` porque un programa global no es de nadie y la política lo
-- rechazaría desde `allfit_owner`.
insert into planning.session_templates (id, content_scope, discipline_code, status)
values ('019eb000-0000-7000-8000-000000000201', 'global', 'test_strength', 'published');
insert into planning.programs (id, content_scope, status)
values ('019eb000-0000-7000-8000-000000000301', 'global', 'published');

select set_config('app.planning_publication', 'true', true);
insert into planning.session_template_versions (
  id, template_id, version_number, discipline_code, activity_type_id, title, content_hash
) values ('019eb000-0000-7000-8000-000000000211', '019eb000-0000-7000-8000-000000000201', 1,
  'test_strength', '019c0000-0000-7000-8000-000000000011', 'Global', decode(repeat('b1', 32), 'hex'));
insert into planning.planned_steps (id, template_version_id, position)
values ('019eb000-0000-7000-8000-000000000221', '019eb000-0000-7000-8000-000000000211', 1);
insert into planning.strength_targets (planned_step_id, target_sets, target_reps)
values ('019eb000-0000-7000-8000-000000000221', 4, 8);
insert into planning.program_versions (id, program_id, version_number, title, content_hash, repeats_forever)
values ('019eb000-0000-7000-8000-000000000303', '019eb000-0000-7000-8000-000000000301', 1,
  'Allfit sin fin', decode(repeat('b2', 32), 'hex'), true);
insert into planning.program_version_sessions (program_version_id, template_version_id, position, week, day)
values ('019eb000-0000-7000-8000-000000000303', '019eb000-0000-7000-8000-000000000211', 1, 1, 1);
select set_config('app.planning_publication', '', true);

set local role allfit_owner;

-- Dos rutinas propias: la semana uno y la semana dos del ciclo usan distinta, que es lo
-- que deja ver **cuál** de las dos siembra la lectura.
select (planning.create_my_session_template(
  '019eb000-0000-7000-8000-000000000001', 'test_strength', 'Empuje',
  'b1111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as push \gset
select (:'push'::jsonb->>'id') as push_id,
       (:'push'::jsonb->'draft'->>'etag') as push_etag0 \gset

select (planning.replace_my_session_template_draft(
  '019eb000-0000-7000-8000-000000000001', :'push_id'::uuid, :'push_etag0',
  '{"title":"Empuje","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":4,"target_reps":8}}]}'::jsonb,
  'b1111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as push_draft \gset
select (:'push_draft'::jsonb->>'etag') as push_etag1 \gset

select (planning.publish_my_session_template(
  '019eb000-0000-7000-8000-000000000001', :'push_id'::uuid, :'push_etag1',
  'b1111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as push_version \gset
select (:'push_version'::jsonb->>'id') as push_version_id \gset

select (planning.create_my_session_template(
  '019eb000-0000-7000-8000-000000000001', 'test_strength', 'Tirón',
  'b1111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).template as pull \gset
select (:'pull'::jsonb->>'id') as pull_id,
       (:'pull'::jsonb->'draft'->>'etag') as pull_etag0 \gset

select (planning.replace_my_session_template_draft(
  '019eb000-0000-7000-8000-000000000001', :'pull_id'::uuid, :'pull_etag0',
  '{"title":"Tirón","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":3,"target_reps":10}}]}'::jsonb,
  'b1111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pull_draft \gset
select (:'pull_draft'::jsonb->>'etag') as pull_etag1 \gset

select (planning.publish_my_session_template(
  '019eb000-0000-7000-8000-000000000001', :'pull_id'::uuid, :'pull_etag1',
  'b1111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as pull_version \gset
select (:'pull_version'::jsonb->>'id') as pull_version_id \gset

-- «Sí» no es un booleano, y una pantalla que lo mande está diciendo otra cosa.
select ok(
  'repeats_forever' = any(planning.program_content_errors(
    ('{"title":"Sin fin","notes":null,"repeats_forever":"sí","sessions":[{"position":1,"week":1,"day":1,"template_version_id":"' || :'push_version_id' || '"}]}')::jsonb,
    null, true)),
  'T-PLN-OPEN-01 un `repeats_forever` que no es booleano se rechaza');

select (planning.create_my_program(
  '019eb000-0000-7000-8000-000000000001', 'Sin fin',
  'b1111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex'))).program as open_program \gset
select (:'open_program'::jsonb->>'id') as open_program_id,
       (:'open_program'::jsonb->'draft'->>'etag') as open_etag0 \gset

-- Un ciclo de dos semanas: empuje la primera, tirón la segunda.
select (planning.replace_my_program_draft(
  '019eb000-0000-7000-8000-000000000001', :'open_program_id'::uuid, :'open_etag0',
  ('{"title":"Sin fin","notes":null,"repeats_forever":true,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'push_version_id' || '"},'
    || '{"position":2,"week":1,"day":3,"template_version_id":"' || :'push_version_id' || '"},'
    || '{"position":3,"week":2,"day":1,"template_version_id":"' || :'pull_version_id' || '"},'
    || '{"position":4,"week":2,"day":3,"template_version_id":"' || :'pull_version_id' || '"}]}')::jsonb,
  'b1111111-1111-4111-8111-111111111108', extensions.uuid_generate_v7(),
  decode(repeat('08', 32), 'hex'))).draft as open_draft \gset
select (:'open_draft'::jsonb->>'etag') as open_etag1 \gset

select (planning.publish_my_program(
  '019eb000-0000-7000-8000-000000000001', :'open_program_id'::uuid, :'open_etag1',
  'b1111111-1111-4111-8111-111111111109', extensions.uuid_generate_v7(),
  decode(repeat('09', 32), 'hex'))).version as open_published \gset
select (:'open_published'::jsonb->>'id') as open_version_id \gset

select is(
  (select repeats_forever from planning.program_versions where id = :'open_version_id'::uuid),
  true,
  'T-PLN-OPEN-02 publicar un borrador sin fin lo guarda en la versión');

-- Mismo contenido, distinta promesa: el canónico cambia y el hash con él, así que la
-- segunda publicación acuña versión en vez de devolver la primera.
select (planning.replace_my_program_draft(
  '019eb000-0000-7000-8000-000000000001', :'open_program_id'::uuid, :'open_etag1',
  ('{"title":"Sin fin","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'push_version_id' || '"},'
    || '{"position":2,"week":1,"day":3,"template_version_id":"' || :'push_version_id' || '"},'
    || '{"position":3,"week":2,"day":1,"template_version_id":"' || :'pull_version_id' || '"},'
    || '{"position":4,"week":2,"day":3,"template_version_id":"' || :'pull_version_id' || '"}]}')::jsonb,
  'b1111111-1111-4111-8111-11111111110a', extensions.uuid_generate_v7(),
  decode(repeat('0a', 32), 'hex'))).draft as finite_draft \gset
select (:'finite_draft'::jsonb->>'etag') as finite_etag \gset

select (planning.publish_my_program(
  '019eb000-0000-7000-8000-000000000001', :'open_program_id'::uuid, :'finite_etag',
  'b1111111-1111-4111-8111-11111111110b', extensions.uuid_generate_v7(),
  decode(repeat('0b', 32), 'hex'))).version as finite_published \gset

select is(
  (select count(*)::integer from planning.program_versions
    where program_id = :'open_program_id'::uuid),
  2,
  'T-PLN-OPEN-03 dos borradores que sólo difieren en `repeats_forever` acuñan dos versiones');

select isnt(
  (select content_hash from planning.program_versions where id = :'open_version_id'::uuid),
  (select content_hash from planning.program_versions
    where program_id = :'open_program_id'::uuid and version_number = 2),
  'T-PLN-OPEN-04 porque no hashean igual');

-- Y se vuelve a lo que el programa es, para tomarlo sin fin.
select (planning.replace_my_program_draft(
  '019eb000-0000-7000-8000-000000000001', :'open_program_id'::uuid, :'finite_etag',
  ('{"title":"Sin fin","notes":null,"repeats_forever":true,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'push_version_id' || '"},'
    || '{"position":2,"week":1,"day":3,"template_version_id":"' || :'push_version_id' || '"},'
    || '{"position":3,"week":2,"day":1,"template_version_id":"' || :'pull_version_id' || '"},'
    || '{"position":4,"week":2,"day":3,"template_version_id":"' || :'pull_version_id' || '"}]}')::jsonb,
  'b1111111-1111-4111-8111-11111111110c', extensions.uuid_generate_v7(),
  decode(repeat('0c', 32), 'hex'))).draft as reopened_draft \gset
select (:'reopened_draft'::jsonb->>'etag') as reopened_etag \gset

select (planning.publish_my_program(
  '019eb000-0000-7000-8000-000000000001', :'open_program_id'::uuid, :'reopened_etag',
  'b1111111-1111-4111-8111-11111111110d', extensions.uuid_generate_v7(),
  decode(repeat('0d', 32), 'hex'))).version as reopened_published \gset
select (:'reopened_published'::jsonb->>'id') as live_version_id \gset

select planning.self_assign_program(
  '019eb000-0000-7000-8000-000000000001', :'live_version_id'::uuid, 'America/Bogota',
  'b1111111-1111-4111-8111-11111111110e', extensions.uuid_generate_v7(),
  decode(repeat('0e', 32), 'hex')) as open_assignment \gset

select is(
  (select count(distinct week_starts_on)::integer from planning.planned_sessions
    where assignment_id = :'open_assignment'::uuid),
  1,
  'T-PLN-OPEN-05 tomar un programa sin fin siembra una sola semana');

select is(
  (select array_agg(distinct template_version_id::text) from planning.planned_sessions
    where assignment_id = :'open_assignment'::uuid),
  array[:'push_version_id'],
  'T-PLN-OPEN-06 y es la semana uno de la composición, no la composición entera');

select is(
  (select weeks from planning.read_my_programs('019eb000-0000-7000-8000-000000000001')
    where program_version_id = :'live_version_id'::uuid),
  null::integer,
  'T-PLN-OPEN-07 `read_my_programs` no le pone semanas: no tiene fecha de fin');

select is(
  (select editable from planning.read_my_programs('019eb000-0000-7000-8000-000000000001')
    where program_version_id = :'live_version_id'::uuid),
  true,
  'T-PLN-OPEN-08 y se sigue pudiendo editar');

-- La semana que viene, sin tocar el reloj: la asignación y lo ya sembrado retroceden
-- siete días, que es exactamente la misma situación vista desde hoy.
update planning.program_assignments
set starts_on = starts_on - 7
where id = :'open_assignment'::uuid;
update planning.planned_sessions
set week_starts_on = week_starts_on - 7,
    scheduled_at = scheduled_at - interval '7 days'
where assignment_id = :'open_assignment'::uuid;

select is(
  (select count(*)::integer from planning.planned_sessions
    where assignment_id = :'open_assignment'::uuid
      and week_starts_on = date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))::date),
  0,
  'T-PLN-OPEN-09 la semana siguiente empieza vacía');

select count(*) as first_read from planning.read_week_plan(
  '019eb000-0000-7000-8000-000000000001', 'America/Bogota') \gset

select is(
  (select count(*)::integer from planning.planned_sessions
    where assignment_id = :'open_assignment'::uuid
      and week_starts_on = date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))::date),
  2,
  'T-PLN-OPEN-10 leer la agenda la siembra');

select is(
  (select array_agg(distinct template_version_id::text) from planning.planned_sessions
    where assignment_id = :'open_assignment'::uuid
      and week_starts_on = date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))::date),
  array[:'pull_version_id'],
  'T-PLN-OPEN-11 con la semana de composición que le toca al ciclo');

select count(*) as second_read from planning.read_week_plan(
  '019eb000-0000-7000-8000-000000000001', 'America/Bogota') \gset

select is(
  (select count(*)::integer from planning.planned_sessions
    where assignment_id = :'open_assignment'::uuid
      and week_starts_on = date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))::date),
  2,
  'T-PLN-OPEN-12 y leerla dos veces la siembra una');

-- Una vuelta más: la semana tres de un ciclo de dos vuelve a ser la primera.
update planning.program_assignments
set starts_on = starts_on - 7
where id = :'open_assignment'::uuid;
update planning.planned_sessions
set week_starts_on = week_starts_on - 7,
    scheduled_at = scheduled_at - interval '7 days'
where assignment_id = :'open_assignment'::uuid;

select count(*) as third_read from planning.read_today_session(
  '019eb000-0000-7000-8000-000000000001', 'America/Bogota') \gset

select is(
  (select array_agg(distinct template_version_id::text) from planning.planned_sessions
    where assignment_id = :'open_assignment'::uuid
      and week_starts_on = date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))::date),
  array[:'push_version_id'],
  'T-PLN-OPEN-13 el ciclo da la vuelta: la semana tres de dos es la primera otra vez');

-- Y lo que tiene fin sigue igual que siempre.
select (planning.create_my_program(
  '019eb000-0000-7000-8000-000000000001', 'Con fin',
  'b1111111-1111-4111-8111-111111111110', extensions.uuid_generate_v7(),
  decode(repeat('10', 32), 'hex'))).program as finite_program \gset
select (:'finite_program'::jsonb->>'id') as finite_program_id,
       (:'finite_program'::jsonb->'draft'->>'etag') as finite_etag0 \gset

select (planning.replace_my_program_draft(
  '019eb000-0000-7000-8000-000000000001', :'finite_program_id'::uuid, :'finite_etag0',
  ('{"title":"Con fin","notes":null,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'push_version_id' || '"},'
    || '{"position":2,"week":1,"day":3,"template_version_id":"' || :'push_version_id' || '"},'
    || '{"position":3,"week":2,"day":1,"template_version_id":"' || :'pull_version_id' || '"},'
    || '{"position":4,"week":2,"day":3,"template_version_id":"' || :'pull_version_id' || '"}]}')::jsonb,
  'b1111111-1111-4111-8111-111111111111', extensions.uuid_generate_v7(),
  decode(repeat('11', 32), 'hex'))).draft as finite_draft2 \gset
select (:'finite_draft2'::jsonb->>'etag') as finite_etag2 \gset

select (planning.publish_my_program(
  '019eb000-0000-7000-8000-000000000001', :'finite_program_id'::uuid, :'finite_etag2',
  'b1111111-1111-4111-8111-111111111112', extensions.uuid_generate_v7(),
  decode(repeat('12', 32), 'hex'))).version as finite_publication \gset
select (:'finite_publication'::jsonb->>'id') as finite_version_id \gset

select planning.self_assign_program(
  '019eb000-0000-7000-8000-000000000001', :'finite_version_id'::uuid, 'America/Bogota',
  'b1111111-1111-4111-8111-111111111113', extensions.uuid_generate_v7(),
  decode(repeat('13', 32), 'hex')) as finite_assignment \gset

select is(
  (select count(*)::integer from planning.planned_sessions
    where assignment_id = :'finite_assignment'::uuid),
  4,
  'T-PLN-OPEN-14 un programa con fin se sigue materializando entero');

select is(
  (select weeks from planning.read_my_programs('019eb000-0000-7000-8000-000000000001')
    where program_version_id = :'finite_version_id'::uuid),
  2,
  'T-PLN-OPEN-15 y sigue diciendo cuántas semanas dura');

-- Tomar lo que no acaba es quedárselo sin acabar.
select set_config('app.actor_person_id', '019eb000-0000-7000-8000-000000000002', true);

-- El catálogo filtraba por `weeks is not null` queriendo decir «tiene sesiones». Si se
-- hubiera quedado así, el programa sin fin habría desaparecido de la vitrina.
select is(
  (select weeks from planning.read_program_catalogue('019eb000-0000-7000-8000-000000000002')
    where program_version_id = '019eb000-0000-7000-8000-000000000303'),
  null::integer,
  'T-PLN-OPEN-16 un programa sin fin sigue en el catálogo, y sin semanas');

select planning.fork_program_version(
  '019eb000-0000-7000-8000-000000000002',
  '019eb000-0000-7000-8000-000000000303') as forked \gset

select is(
  (select repeats_forever from planning.program_versions where id = :'forked'::uuid),
  true,
  'T-PLN-OPEN-17 la copia de una versión sin fin tampoco tiene fin');

select is(
  (select draft.content->>'repeats_forever' from planning.program_drafts as draft
   join planning.program_versions as copy on copy.program_id = draft.program_id
   where copy.id = :'forked'::uuid),
  'true',
  'T-PLN-OPEN-18 y su borrador lo dice, o el primer guardado le pondría final');

select * from finish();
rollback;
