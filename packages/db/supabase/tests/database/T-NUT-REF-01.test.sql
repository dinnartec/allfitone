-- A programme of Allfit carries a nutrition goal, sized to the person (PN-1, HU-SP-100).
--
-- What must hold: the reference is per training goal and scales with the latest weight;
-- the goal the person declared wins when the programme has it; with no weight there is
-- no goal and taking the programme still works; adopting it publishes the person's own
-- goal (origin self) in the same command, superseding the one before; a retry does not
-- publish twice; not adopting leaves the goal untouched; and nobody adopts for another.
--
-- Written before the migration and watched failing: neither the table nor the functions
-- exist, and the detail has no nutrition column.
begin;

select plan(16);

insert into identity.people (id, given_name, family_name)
values ('019ef800-0000-7000-8000-000000000001', 'Quien', 'Gana'),
       ('019ef800-0000-7000-8000-000000000002', 'Sin', 'Peso'),
       ('019ef800-0000-7000-8000-000000000003', 'La', 'Vecina');

-- The references a curator would load: muscle and fat loss, per kilo.
insert into nutrition.goal_references
  (goal_code, nutrient_code, mode, minimum_per_kg, maximum_per_kg, exact_per_kg)
values
  ('build_muscle', 'energy', 'range', 35, 39, null),
  ('build_muscle', 'protein', 'exact', null, null, 2.0),
  ('build_muscle', 'carbohydrates', 'exact', null, null, 4.5),
  ('build_muscle', 'fat', 'exact', null, null, 0.9),
  ('lose_weight', 'energy', 'range', 24, 28, null),
  ('lose_weight', 'protein', 'exact', null, null, 2.2),
  ('lose_weight', 'carbohydrates', 'exact', null, null, 2.5),
  ('lose_weight', 'fat', 'exact', null, null, 0.8);

-- 74 kg two weeks ago, 80 kg today: the latest is what counts.
insert into identity.body_progress_records (id, person_id, metric_code, value_numeric, unit_code, measured_on)
values
  (extensions.uuid_generate_v7(), '019ef800-0000-7000-8000-000000000001', 'body_weight', 74, 'kg', current_date - 14),
  (extensions.uuid_generate_v7(), '019ef800-0000-7000-8000-000000000001', 'body_weight', 80, 'kg', current_date),
  (extensions.uuid_generate_v7(), '019ef800-0000-7000-8000-000000000003', 'body_weight', 60, 'kg', current_date);

-- The first person declared fat loss; the programme serves both goals.
insert into identity.fitness_profile_claims (id, person_id, attribute_code, value_text, provenance, captured_by_kind)
values (extensions.uuid_generate_v7(), '019ef800-0000-7000-8000-000000000001', 'primary_training_goal',
        'lose_weight', 'person_declared', 'person');

insert into planning.programs (id, content_scope, status)
values ('019ef800-0000-7000-8000-0000000000c1', 'global', 'published'),
       ('019ef800-0000-7000-8000-0000000000c2', 'global', 'published');
insert into planning.program_versions (id, program_id, version_number, title, status, published_at, content_hash)
values ('019ef800-0000-7000-8000-0000000000d1', '019ef800-0000-7000-8000-0000000000c1', 1,
        'Volumen', 'published', now(), decode(repeat('d1', 32), 'hex')),
       ('019ef800-0000-7000-8000-0000000000d2', '019ef800-0000-7000-8000-0000000000c2', 1,
        'Solo músculo', 'published', now(), decode(repeat('d2', 32), 'hex'));

insert into planning.session_templates (id, discipline_code, content_scope, status)
values ('019ef800-0000-7000-8000-0000000000e1', 'test_strength', 'global', 'published');
insert into planning.session_template_versions
  (id, template_id, version_number, title, discipline_code, activity_type_id, status, published_at, content_hash)
values ('019ef800-0000-7000-8000-0000000000e2', '019ef800-0000-7000-8000-0000000000e1', 1, 'Día',
        'test_strength', '019c0000-0000-7000-8000-000000000011', 'published', now(), decode(repeat('e2', 32), 'hex'));

select set_config('app.planning_publication', 'true', true);
insert into planning.program_version_goals (program_version_id, goal_code)
values ('019ef800-0000-7000-8000-0000000000d1', 'build_muscle'),
       ('019ef800-0000-7000-8000-0000000000d1', 'lose_weight'),
       ('019ef800-0000-7000-8000-0000000000d2', 'build_muscle');
insert into planning.program_version_sessions (program_version_id, week, day, position, template_version_id)
values ('019ef800-0000-7000-8000-0000000000d1', 1, 1, 1, '019ef800-0000-7000-8000-0000000000e2'),
       ('019ef800-0000-7000-8000-0000000000d2', 1, 1, 1, '019ef800-0000-7000-8000-0000000000e2');
select set_config('app.planning_publication', '', true);

set local role allfit_owner;
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019ef800-0000-7000-8000-000000000001', true);

-- ------------------------------------------------------------------- the reference

select is(
  nutrition.reference_targets('build_muscle', 80),
  '[{"nutrient_code":"energy","mode":"range","minimum":2800,"maximum":3100,"exact":null,"unit":"kcal"},
    {"nutrient_code":"protein","mode":"exact","minimum":null,"maximum":null,"exact":160,"unit":"g"},
    {"nutrient_code":"carbohydrates","mode":"exact","minimum":null,"maximum":null,"exact":360,"unit":"g"},
    {"nutrient_code":"fat","mode":"exact","minimum":null,"maximum":null,"exact":70,"unit":"g"}]'::jsonb,
  'T-NUT-REF-01 the reference scales with the weight, energy to 50 kcal and grams to 5');

select is(
  nutrition.reference_targets('maintain', 80),
  null,
  'T-NUT-REF-02 a goal with no reference has no targets, never a guess');

-- -------------------------------------------------------------- the programme reads it

select is(
  (select detail.nutrition->>'goal_code'
   from planning.read_program_version('019ef800-0000-7000-8000-000000000001',
                                      '019ef800-0000-7000-8000-0000000000d1') as detail),
  'lose_weight',
  'T-NUT-REF-03 the goal the person declared wins when the programme serves it');

select is(
  (select detail.nutrition->'targets'->0->>'minimum'
   from planning.read_program_version('019ef800-0000-7000-8000-000000000001',
                                      '019ef800-0000-7000-8000-0000000000d1') as detail),
  '1900',
  'T-NUT-REF-04 sized to the latest weight, not an older one');

select is(
  (select detail.nutrition->>'goal_code'
   from planning.read_program_version('019ef800-0000-7000-8000-000000000001',
                                      '019ef800-0000-7000-8000-0000000000d2') as detail),
  'build_muscle',
  'T-NUT-REF-05 otherwise the programme''s own goal');

select set_config('app.actor_person_id', '019ef800-0000-7000-8000-000000000002', true);

select is(
  (select detail.nutrition
   from planning.read_program_version('019ef800-0000-7000-8000-000000000002',
                                      '019ef800-0000-7000-8000-0000000000d1') as detail),
  null,
  'T-NUT-REF-06 with no weight there is no goal to show');

select isnt(
  planning.self_assign_program(
    '019ef800-0000-7000-8000-000000000002', '019ef800-0000-7000-8000-0000000000d1', 'America/Bogota',
    'f8111111-1111-4111-8111-111111111101', '019ef800-0000-7000-8000-000000000501',
    decode(repeat('01', 32), 'hex'), true),
  null,
  'T-NUT-REF-07 and taking the programme still works, asking for its goal or not');

select is(
  (select count(*)::integer from nutrition.goal_versions where person_id = '019ef800-0000-7000-8000-000000000002'),
  0,
  'T-NUT-REF-08 without inventing one');

-- ------------------------------------------------------------------- adopting it

select set_config('app.actor_person_id', '019ef800-0000-7000-8000-000000000001', true);

select nutrition.publish_self_goal_version(
  '019ef800-0000-7000-8000-000000000001', null,
  '[{"nutrient_code":"energy","mode":"exact","exact":2500,"unit":"kcal"}]'::jsonb,
  'f8111111-1111-4111-8111-111111111102', '019ef800-0000-7000-8000-000000000502',
  decode(repeat('02', 32), 'hex'));

select planning.self_assign_program(
  '019ef800-0000-7000-8000-000000000001', '019ef800-0000-7000-8000-0000000000d1', 'America/Bogota',
  'f8111111-1111-4111-8111-111111111103', '019ef800-0000-7000-8000-000000000503',
  decode(repeat('03', 32), 'hex'), true);

select is(
  (select array[origin::text, coalesce(rationale, '-')] from nutrition.goal_versions
   where person_id = '019ef800-0000-7000-8000-000000000001' and status = 'active'),
  array['self', 'Meta del programa Volumen'],
  'T-NUT-REF-09 adopting publishes the person''s own goal, saying where it came from');

select is(
  (select jsonb_agg(jsonb_build_object('code', definition.code, 'min', target.minimum_value,
                    'max', target.maximum_value, 'exact', target.exact_value) order by definition.code)
   from nutrition.goal_targets as target
   join nutrition.goal_versions as version on version.id = target.goal_version_id
   join nutrition.nutrient_definitions as definition on definition.id = target.nutrient_definition_id
   where version.person_id = '019ef800-0000-7000-8000-000000000001' and version.status = 'active'),
  '[{"code":"carbohydrates","min":null,"max":null,"exact":200},
    {"code":"energy","min":1900,"max":2250,"exact":null},
    {"code":"fat","min":null,"max":null,"exact":65},
    {"code":"protein","min":null,"max":null,"exact":175}]'::jsonb,
  'T-NUT-REF-10 with the figures the programme showed');

select is(
  (select status::text from nutrition.goal_versions where id = '019ef800-0000-7000-8000-000000000502'),
  'superseded',
  'T-NUT-REF-11 and the goal before stays as history');

select planning.self_assign_program(
  '019ef800-0000-7000-8000-000000000001', '019ef800-0000-7000-8000-0000000000d1', 'America/Bogota',
  'f8111111-1111-4111-8111-111111111103', '019ef800-0000-7000-8000-000000000503',
  decode(repeat('03', 32), 'hex'), true);

select is(
  (select count(*)::integer from nutrition.goal_versions where person_id = '019ef800-0000-7000-8000-000000000001'),
  2,
  'T-NUT-REF-12 a retry publishes nothing more');

-- ------------------------------------------------------------------- not adopting it

select planning.self_assign_program(
  '019ef800-0000-7000-8000-000000000001', '019ef800-0000-7000-8000-0000000000d2', 'America/Bogota',
  'f8111111-1111-4111-8111-111111111104', '019ef800-0000-7000-8000-000000000504',
  decode(repeat('04', 32), 'hex'), false);

select is(
  (select rationale from nutrition.goal_versions
   where person_id = '019ef800-0000-7000-8000-000000000001' and status = 'active'),
  'Meta del programa Volumen',
  'T-NUT-REF-13 taking a programme without its goal leaves the goal as it was');

select isnt(
  planning.self_assign_program(
    '019ef800-0000-7000-8000-000000000001', '019ef800-0000-7000-8000-0000000000d2', 'America/Bogota',
    'f8111111-1111-4111-8111-111111111105', '019ef800-0000-7000-8000-000000000505',
    decode(repeat('05', 32), 'hex')),
  null,
  'T-NUT-REF-14 and the old call, without the choice, still takes a programme');

-- ------------------------------------------------------------------- nobody else

select throws_ok(
  $$ select planning.self_assign_program(
       '019ef800-0000-7000-8000-000000000003', '019ef800-0000-7000-8000-0000000000d1', 'America/Bogota',
       'f8111111-1111-4111-8111-111111111106', '019ef800-0000-7000-8000-000000000506',
       decode(repeat('06', 32), 'hex'), true) $$,
  '42501', null,
  'T-NUT-REF-15 nobody takes a programme, or its goal, for somebody else');

reset role;
set local role allfit_api;

select throws_ok(
  $$ insert into nutrition.goal_references (goal_code, nutrient_code, mode, exact_per_kg)
     values ('maintain', 'energy', 'exact', 30) $$,
  '42501', null,
  'T-NUT-REF-16 and the API cannot write the references: only curation does');

select * from finish();
rollback;
