-- Cómo fue la última vez, que es lo que cuenta el reverso de la tarjeta de Hoy.
--
-- Lo que tiene que valer: una rutina que nadie entrenó no dice nada, una entrenada dice
-- cuándo, cuánto duró, cuántas series y cuánto peso; el peso llega en kilogramos aunque
-- se registrara en libras; de dos ejecuciones gana la última; lo anulado y lo que sigue
-- abierto no cuentan; y publicar una versión nueva de la rutina no le borra el pasado,
-- porque se cuenta por plantilla y no por versión.
--
-- Escritas antes de tocar `read_week_plan` y vistas fallar: sin el campo, todas
-- responden nulo, incluida la que espera un número. Esa es la forma de saber que la
-- aserción mira el sitio correcto, y no que la lectura casualmente calla.
--
-- La última aserción inserta una sesión planificada a mano apuntando a la **segunda**
-- versión de la misma rutina. Es la única manera de separar «por plantilla» de «por
-- versión» sin montar una edición de programa entera: la composición publicada no
-- puede apuntar a dos versiones de la misma rutina en la misma semana.
begin;

select plan(9);

insert into identity.people (id, given_name, family_name)
values
  ('019ec000-0000-7000-8000-000000000001', 'Quien', 'Entrena'),
  ('019ec000-0000-7000-8000-000000000002', 'La', 'Vecina');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ec000-0000-7000-8000-000000000001', true);

set local role allfit_owner;

-- Una rutina de fuerza propia, publicada.
select (planning.create_my_session_template(
  '019ec000-0000-7000-8000-000000000001', 'test_strength', 'Pierna',
  'c1111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as leg \gset
select (:'leg'::jsonb->>'id') as leg_id,
       (:'leg'::jsonb->'draft'->>'etag') as leg_etag0 \gset

select (planning.replace_my_session_template_draft(
  '019ec000-0000-7000-8000-000000000001', :'leg_id'::uuid, :'leg_etag0',
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":4,"target_reps":8}}]}'::jsonb,
  'c1111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as leg_draft \gset
select (:'leg_draft'::jsonb->>'etag') as leg_etag1 \gset

select (planning.publish_my_session_template(
  '019ec000-0000-7000-8000-000000000001', :'leg_id'::uuid, :'leg_etag1',
  'c1111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as leg_version \gset
select (:'leg_version'::jsonb->>'id') as leg_version_id \gset

-- Un programa de una sola sesión, el lunes de la semana uno, para que caiga en la
-- semana que la agenda enseña.
select (planning.create_my_program(
  '019ec000-0000-7000-8000-000000000001', 'Con pierna',
  'c1111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id,
       (:'prog'::jsonb->'draft'->>'etag') as prog_etag0 \gset

select (planning.replace_my_program_draft(
  '019ec000-0000-7000-8000-000000000001', :'prog_id'::uuid, :'prog_etag0',
  ('{"title":"Con pierna","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'leg_version_id' || '"}]}')::jsonb,
  'c1111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as prog_draft \gset
select (:'prog_draft'::jsonb->>'etag') as prog_etag1 \gset

select (planning.publish_my_program(
  '019ec000-0000-7000-8000-000000000001', :'prog_id'::uuid, :'prog_etag1',
  'c1111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as prog_published \gset
select (:'prog_published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019ec000-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'c1111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment_id \gset

select id as planned_id
from planning.planned_sessions
where assignment_id = :'assignment_id'::uuid
limit 1 \gset

-- Nada entrenado todavía.
select is(
  (select (entry->'last_time')
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  'null'::jsonb,
  'T-PLN-LASTTIME-01 una rutina que nadie entrenó no cuenta ninguna última vez');

-- Un intento abierto tampoco es una última vez: todavía no ha terminado.
select execution.start_planned_session_attempt(
  '019ec000-0000-7000-8000-000000000001', :'planned_id'::uuid,
  clock_timestamp() - interval '50 minutes', 'America/Bogota', 'detailed', 'manual',
  'c1111111-1111-4111-8111-111111111111', '019ec000-0000-7000-8000-000000000501',
  decode(repeat('11', 32), 'hex'));

select is(
  (select (entry->'last_time')
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  'null'::jsonb,
  'T-PLN-LASTTIME-02 y un intento todavía abierto tampoco: la última vez es una que terminó');

-- Dos series a 100 kg por 10 repeticiones: dos toneladas exactas.
select execution.replace_execution_results(
  '019ec000-0000-7000-8000-000000000001', '019ec000-0000-7000-8000-000000000501', 0,
  '[{"family":"strength","set_order":1,"achieved_reps":10,"load_value":100,"load_unit_code":"kg"},
    {"family":"strength","set_order":2,"achieved_reps":10,"load_value":100,"load_unit_code":"kg"}]'::jsonb,
  'c1111111-1111-4111-8111-111111111112', '019ec000-0000-7000-8000-000000000502',
  decode(repeat('12', 32), 'hex'));

select execution.finalize_execution(
  '019ec000-0000-7000-8000-000000000001', '019ec000-0000-7000-8000-000000000501',
  clock_timestamp(), 'c1111111-1111-4111-8111-111111111113',
  '019ec000-0000-7000-8000-000000000503', decode(repeat('13', 32), 'hex'));

select is(
  (select (entry->'last_time'->>'trained_on')::date
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  -- **El mismo instante en que empezó, no «ahora».** La sesión arranca cincuenta
  -- minutos atrás, y en la franja entre la medianoche de Bogotá y las 00:50 los dos
  -- caen en días distintos: la aserción pasaba diecinueve horas al día y fallaba cinco.
  ((clock_timestamp() - interval '50 minutes') at time zone 'America/Bogota')::date,
  'T-PLN-LASTTIME-03 cerrada la ejecución, la última vez es el día en que se entrenó');

select is(
  (select (entry->'last_time'->>'sets')::integer
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  2,
  'T-PLN-LASTTIME-04 y cuenta las series que se registraron, no las que se planearon');

select is(
  (select (entry->'last_time'->>'tonnage_kg')::numeric
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  2000::numeric,
  'T-PLN-LASTTIME-05 el tonelaje es repeticiones por carga: dos series de diez a cien son dos mil');

select ok(
  (select (entry->'last_time'->>'seconds')::integer
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid) between 2400 and 3600,
  'T-PLN-LASTTIME-06 y la duración es lo que hay entre el comienzo y el cierre');

-- Segundo intento, en libras, y más reciente. Cien libras por diez son 453,59237 kg.
select execution.start_planned_session_attempt(
  '019ec000-0000-7000-8000-000000000001', :'planned_id'::uuid,
  clock_timestamp(), 'America/Bogota', 'detailed', 'manual',
  'c1111111-1111-4111-8111-111111111121', '019ec000-0000-7000-8000-000000000511',
  decode(repeat('21', 32), 'hex'));

select execution.replace_execution_results(
  '019ec000-0000-7000-8000-000000000001', '019ec000-0000-7000-8000-000000000511', 0,
  '[{"family":"strength","set_order":1,"achieved_reps":10,"load_value":100,"load_unit_code":"lb"}]'::jsonb,
  'c1111111-1111-4111-8111-111111111122', '019ec000-0000-7000-8000-000000000512',
  decode(repeat('22', 32), 'hex'));

select execution.finalize_execution(
  '019ec000-0000-7000-8000-000000000001', '019ec000-0000-7000-8000-000000000511',
  clock_timestamp(), 'c1111111-1111-4111-8111-111111111123',
  '019ec000-0000-7000-8000-000000000513', decode(repeat('23', 32), 'hex'));

select is(
  (select round((entry->'last_time'->>'tonnage_kg')::numeric, 5)
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  453.59237::numeric,
  'T-PLN-LASTTIME-07 de dos ejecuciones gana la última, y cien libras son 45,359237 kilos cada una');

-- Anulada la más reciente, vuelve a mandar la anterior.
update execution.executed_sessions
set annulled_at = clock_timestamp(), annulment_reason = 'prueba'
where id = '019ec000-0000-7000-8000-000000000511';

select is(
  (select (entry->'last_time'->>'tonnage_kg')::numeric
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = :'planned_id'::uuid),
  2000::numeric,
  'T-PLN-LASTTIME-08 una ejecución anulada no cuenta, y manda otra vez la que quedaba');

-- Y la misma rutina publicada de nuevo: otra versión, el mismo pasado.
select (planning.replace_my_session_template_draft(
  '019ec000-0000-7000-8000-000000000001', :'leg_id'::uuid,
  (select planning.content_etag(draft.content) from planning.session_template_drafts as draft
    where draft.template_id = :'leg_id'::uuid),
  '{"title":"Pierna","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":5,"target_reps":8}}]}'::jsonb,
  'c1111111-1111-4111-8111-111111111131', extensions.uuid_generate_v7(),
  decode(repeat('31', 32), 'hex'))).draft as leg_draft2 \gset
select (:'leg_draft2'::jsonb->>'etag') as leg_etag2 \gset

select (planning.publish_my_session_template(
  '019ec000-0000-7000-8000-000000000001', :'leg_id'::uuid, :'leg_etag2',
  'c1111111-1111-4111-8111-111111111132', extensions.uuid_generate_v7(),
  decode(repeat('32', 32), 'hex'))).version as leg_version2 \gset
select (:'leg_version2'::jsonb->>'id') as leg_version2_id \gset

insert into planning.planned_sessions (
  id, assignment_id, person_id, template_version_id, program_day, week_starts_on,
  scheduled_at, timezone
)
select '019ec000-0000-7000-8000-000000000601', :'assignment_id'::uuid,
       '019ec000-0000-7000-8000-000000000001', :'leg_version2_id'::uuid, 3,
       date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))::date,
       (date_trunc('week', (clock_timestamp() at time zone 'America/Bogota'))
         + interval '2 days') at time zone 'America/Bogota',
       'America/Bogota';

select is(
  (select (entry->'last_time'->>'tonnage_kg')::numeric
   from planning.read_week_plan('019ec000-0000-7000-8000-000000000001', 'America/Bogota') as plan,
        lateral jsonb_array_elements(plan.sessions) as entry
   where (entry->>'planned_session_id')::uuid = '019ec000-0000-7000-8000-000000000601'),
  2000::numeric,
  'T-PLN-LASTTIME-09 publicar otra versión de la rutina no le borra el pasado: se cuenta por plantilla');

select * from finish();
rollback;
