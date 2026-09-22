-- El peso de la semana es el que se levantó, no el que pesa la persona.
--
-- Lo que tiene que valer: la cifra suma las cargas de las sesiones cerradas de esta
-- semana, canonizadas a kilogramos; las libras cuentan como kilos y no como número
-- suelto; lo anulado no cuenta; y sin carga registrada responde nulo y no cero, porque
-- un cero diría que se entrenó sin mover nada.
--
-- Escritas antes de tocar `read_week_summary` y vistas fallar: la función todavía
-- responde el peso corporal, así que la columna que estas aserciones piden no existe.
begin;

select plan(4);

insert into identity.people (id, given_name, family_name)
values ('019ed000-0000-7000-8000-000000000001', 'Quien', 'Levanta');

select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ed000-0000-7000-8000-000000000001', true);

set local role allfit_owner;

select (planning.create_my_session_template(
  '019ed000-0000-7000-8000-000000000001', 'test_strength', 'Fuerza',
  'd1111111-1111-4111-8111-111111111101', extensions.uuid_generate_v7(),
  decode(repeat('01', 32), 'hex'))).template as tpl \gset
select (:'tpl'::jsonb->>'id') as tpl_id, (:'tpl'::jsonb->'draft'->>'etag') as etag0 \gset

select (planning.replace_my_session_template_draft(
  '019ed000-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag0',
  '{"title":"Fuerza","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[{"position":1,"target":{"family":"strength","target_sets":3,"target_reps":8}}]}'::jsonb,
  'd1111111-1111-4111-8111-111111111102', extensions.uuid_generate_v7(),
  decode(repeat('02', 32), 'hex'))).draft as draft \gset
select (:'draft'::jsonb->>'etag') as etag1 \gset

select (planning.publish_my_session_template(
  '019ed000-0000-7000-8000-000000000001', :'tpl_id'::uuid, :'etag1',
  'd1111111-1111-4111-8111-111111111103', extensions.uuid_generate_v7(),
  decode(repeat('03', 32), 'hex'))).version as ver \gset
select (:'ver'::jsonb->>'id') as version_id \gset

select (planning.create_my_program(
  '019ed000-0000-7000-8000-000000000001', 'Semana',
  'd1111111-1111-4111-8111-111111111104', extensions.uuid_generate_v7(),
  decode(repeat('04', 32), 'hex'))).program as prog \gset
select (:'prog'::jsonb->>'id') as prog_id, (:'prog'::jsonb->'draft'->>'etag') as petag0 \gset

select (planning.replace_my_program_draft(
  '019ed000-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag0',
  ('{"title":"Semana","notes":null,"repeats_forever":false,"sessions":['
    || '{"position":1,"week":1,"day":1,"template_version_id":"' || :'version_id' || '"}]}')::jsonb,
  'd1111111-1111-4111-8111-111111111105', extensions.uuid_generate_v7(),
  decode(repeat('05', 32), 'hex'))).draft as pdraft \gset
select (:'pdraft'::jsonb->>'etag') as petag1 \gset

select (planning.publish_my_program(
  '019ed000-0000-7000-8000-000000000001', :'prog_id'::uuid, :'petag1',
  'd1111111-1111-4111-8111-111111111106', extensions.uuid_generate_v7(),
  decode(repeat('06', 32), 'hex'))).version as published \gset
select (:'published'::jsonb->>'id') as prog_version_id \gset

select planning.self_assign_program(
  '019ed000-0000-7000-8000-000000000001', :'prog_version_id'::uuid, 'America/Bogota',
  'd1111111-1111-4111-8111-111111111107', extensions.uuid_generate_v7(),
  decode(repeat('07', 32), 'hex')) as assignment \gset

select id as planned_id from planning.planned_sessions
where assignment_id = :'assignment'::uuid limit 1 \gset

-- Sin nada entrenado: nulo, no cero.
select is(
  (select tonnage_kg from execution.read_week_summary('019ed000-0000-7000-8000-000000000001', 'America/Bogota')),
  null::numeric,
  'T-EXE-TONNAGE-01 sin carga registrada la semana no dice cero, dice nada');

select execution.start_planned_session_attempt(
  '019ed000-0000-7000-8000-000000000001', :'planned_id'::uuid,
  clock_timestamp() - interval '40 minutes', 'America/Bogota', 'detailed', 'manual',
  'd1111111-1111-4111-8111-111111111111', '019ed000-0000-7000-8000-000000000501',
  decode(repeat('11', 32), 'hex'));

-- Dos series: 10 × 100 kg y 10 × 100 lb. Dos mil más 453,59237.
select execution.replace_execution_results(
  '019ed000-0000-7000-8000-000000000001', '019ed000-0000-7000-8000-000000000501', 0,
  '[{"family":"strength","set_order":1,"achieved_reps":10,"load_value":100,"load_unit_code":"kg"},
    {"family":"strength","set_order":2,"achieved_reps":10,"load_value":100,"load_unit_code":"lb"}]'::jsonb,
  'd1111111-1111-4111-8111-111111111112', '019ed000-0000-7000-8000-000000000502',
  decode(repeat('12', 32), 'hex'));

select execution.finalize_execution(
  '019ed000-0000-7000-8000-000000000001', '019ed000-0000-7000-8000-000000000501',
  clock_timestamp(), 'd1111111-1111-4111-8111-111111111113',
  '019ed000-0000-7000-8000-000000000503', decode(repeat('13', 32), 'hex'));

select is(
  (select round(tonnage_kg, 5) from execution.read_week_summary('019ed000-0000-7000-8000-000000000001', 'America/Bogota')),
  1453.59237::numeric,
  'T-EXE-TONNAGE-02 suma las cargas de la semana, y las libras cuentan como kilos');

select isnt(
  (select tonnage_kg from execution.read_week_summary('019ed000-0000-7000-8000-000000000001', 'America/Bogota')),
  1100::numeric,
  'T-EXE-TONNAGE-03 y no como un número suelto sin convertir');

update execution.executed_sessions
set annulled_at = clock_timestamp(), annulment_reason = 'prueba'
where id = '019ed000-0000-7000-8000-000000000501';

select is(
  (select tonnage_kg from execution.read_week_summary('019ed000-0000-7000-8000-000000000001', 'America/Bogota')),
  null::numeric,
  'T-EXE-TONNAGE-04 lo anulado no cuenta, y sin nada más vuelve a no decir nada');

select * from finish();
rollback;
