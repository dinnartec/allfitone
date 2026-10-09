-- La región que trabaja un programa, de uno en uno y de todos a la vez.
--
-- Elegir la portada de una rutina compara su región con la de cada programa del
-- catálogo. Se calculaba programa por programa, veinticuatro veces por rutina, y cada
-- cálculo cruzaba los pasos bajo RLS: Hoy tardaba medio segundo en eso. Ahora se
-- calculan todas en una pasada, y la regla tiene que seguir siendo la misma.
--
-- La regla: mandan los músculos primarios; el recuento total desempata, y después el
-- nombre de la región. Un paso repetido cuenta las veces que está. Un programa sin
-- pasos no tiene región.
--
-- `program_regions` se escribió después de esta prueba y se la vio fallar por no
-- existir; las aserciones de la regla pasaban contra la versión anterior y siguen
-- pasando contra ésta.

begin;

select plan(6);

insert into catalog.muscles (id, code, name, region, body_slug, status, display_order)
values
  ('019ef300-0000-7000-8000-0000000000a1', 'test_chest_region', 'Pecho de región', 'upper', 'chest', 'published', 1),
  ('019ef300-0000-7000-8000-0000000000a2', 'test_quads_region', 'Cuádriceps de región', 'lower', 'quadriceps', 'published', 2);

-- Empuje: primario arriba y secundario abajo. Pierna: primario abajo. Mixto: primario
-- en las dos, para el empate completo.
insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
values
  ('019ef300-0000-7000-8000-0000000000f1', 'test_strength', 'Empuje de región', 'empuje de region', 'global', 'published'),
  ('019ef300-0000-7000-8000-0000000000f2', 'test_strength', 'Pierna de región', 'pierna de region', 'global', 'published'),
  ('019ef300-0000-7000-8000-0000000000f3', 'test_strength', 'Mixto de región', 'mixto de region', 'global', 'published');

insert into catalog.movement_muscles (movement_id, muscle_id, is_primary)
values
  ('019ef300-0000-7000-8000-0000000000f1', '019ef300-0000-7000-8000-0000000000a1', true),
  ('019ef300-0000-7000-8000-0000000000f1', '019ef300-0000-7000-8000-0000000000a2', false),
  ('019ef300-0000-7000-8000-0000000000f2', '019ef300-0000-7000-8000-0000000000a2', true),
  ('019ef300-0000-7000-8000-0000000000f3', '019ef300-0000-7000-8000-0000000000a1', true),
  ('019ef300-0000-7000-8000-0000000000f3', '019ef300-0000-7000-8000-0000000000a2', true);

-- Cuatro programas, uno por caso; cada uno con una rutina publicada de los pasos dados.
insert into planning.programs (id, content_scope, status)
values
  ('019ef300-0000-7000-8000-0000000000c1', 'global', 'published'),
  ('019ef300-0000-7000-8000-0000000000c2', 'global', 'published'),
  ('019ef300-0000-7000-8000-0000000000c3', 'global', 'published'),
  ('019ef300-0000-7000-8000-0000000000c4', 'global', 'published');

insert into planning.program_versions
  (id, program_id, version_number, title, status, published_at, content_hash)
select ('019ef300-0000-7000-8000-0000000000d' || n)::uuid,
       ('019ef300-0000-7000-8000-0000000000c' || n)::uuid,
       1, 'Programa ' || n, 'published', now(), decode(repeat('d' || n, 32), 'hex')
from generate_series(1, 4) as n;

insert into planning.session_templates (id, discipline_code, content_scope, status)
select ('019ef300-0000-7000-8000-0000000000e' || n)::uuid, 'test_strength', 'global', 'published'
from generate_series(1, 3) as n;

insert into planning.session_template_versions
  (id, template_id, version_number, title, discipline_code, activity_type_id, status,
   published_at, content_hash)
select ('019ef300-0000-7000-8000-0000000000b' || n)::uuid,
       ('019ef300-0000-7000-8000-0000000000e' || n)::uuid,
       1, 'Rutina ' || n, 'test_strength', '019c0000-0000-7000-8000-000000000011',
       'published', now(), decode(repeat('b' || n, 32), 'hex')
from generate_series(1, 3) as n;

-- 1: empuje dos veces y pierna una. Arriba gana por primarios (2 a 1) aunque abajo
--    sume más en total (3 a 2); sin contar la repetición, empatarían y ganaría abajo.
-- 2: empuje y pierna. Primarios 1 a 1; el total (abajo 2, arriba 1) desempata.
-- 3: mixto. Todo empata, y decide el nombre: «lower» antes que «upper».
insert into planning.planned_steps (template_version_id, position, movement_id)
values
  ('019ef300-0000-7000-8000-0000000000b1', 1, '019ef300-0000-7000-8000-0000000000f1'),
  ('019ef300-0000-7000-8000-0000000000b1', 2, '019ef300-0000-7000-8000-0000000000f1'),
  ('019ef300-0000-7000-8000-0000000000b1', 3, '019ef300-0000-7000-8000-0000000000f2'),
  ('019ef300-0000-7000-8000-0000000000b2', 1, '019ef300-0000-7000-8000-0000000000f1'),
  ('019ef300-0000-7000-8000-0000000000b2', 2, '019ef300-0000-7000-8000-0000000000f2'),
  ('019ef300-0000-7000-8000-0000000000b3', 1, '019ef300-0000-7000-8000-0000000000f3');

-- El cuarto programa no compone ninguna rutina.
insert into planning.program_version_sessions
  (program_version_id, week, day, position, template_version_id)
select ('019ef300-0000-7000-8000-0000000000d' || n)::uuid, 1, 1, 1,
       ('019ef300-0000-7000-8000-0000000000b' || n)::uuid
from generate_series(1, 3) as n;

insert into identity.people (id, given_name, family_name)
values ('019ef300-0000-7000-8000-000000000001', 'Quien', 'Mira');

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef300-0000-7000-8000-000000000001', true);

select is(
  planning.program_region('019ef300-0000-7000-8000-0000000000c1'), 'upper',
  'the primary muscles decide, and a repeated step counts each time it is there');

select is(
  planning.program_region('019ef300-0000-7000-8000-0000000000c2'), 'lower',
  'with the primaries tied, the total count breaks the tie');

select is(
  planning.program_region('019ef300-0000-7000-8000-0000000000c3'), 'lower',
  'with everything tied, the region name decides, so the answer is stable');

select is(
  planning.program_region('019ef300-0000-7000-8000-0000000000c4'), null,
  'a programme with no steps has no region');

select has_function(
  'planning', 'program_regions', array['uuid[]'],
  'every programme''s region can be had in one pass');

select results_eq(
  $$ select program_id, region from planning.program_regions(array[
       '019ef300-0000-7000-8000-0000000000c1', '019ef300-0000-7000-8000-0000000000c2',
       '019ef300-0000-7000-8000-0000000000c3', '019ef300-0000-7000-8000-0000000000c4'
     ]::uuid[]) order by program_id $$,
  $$ values ('019ef300-0000-7000-8000-0000000000c1'::uuid, 'upper'),
            ('019ef300-0000-7000-8000-0000000000c2'::uuid, 'lower'),
            ('019ef300-0000-7000-8000-0000000000c3'::uuid, 'lower') $$,
  'in one pass, each programme gets the same region it gets alone');

select * from finish();

rollback;
