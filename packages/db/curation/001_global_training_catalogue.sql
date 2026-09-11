-- The training catalogue Allfit owns, and the script that loads it.
--
-- This is **not** `supabase/seed.sql`. That file says so itself: production does not
-- load it, and everything in it is `test_*` fixtures. The real catalogue needs to be
-- loadable into production whenever it changes, which is why it lives here and is
-- written to be run **as many times as you like**: every row carries a stable
-- identity derived from its slug, and every insert ends in `on conflict do nothing`.
-- Running it twice changes nothing the second time. That property is the whole
-- point, and it is what the test asserts.
--
-- Run it as a role that can write the catalogue — `postgres` locally and in
-- production. Row security is bypassed by that role, so nothing here loosens a
-- policy: the runtime role still has no privilege on these tables and still reaches
-- the catalogue only through `planning.read_program_catalogue`.
--
-- **How the catalogue is shaped.** Twenty-four programs: four goal families × two
-- level bands × three frequencies. The frequency is an axis and not a property of a
-- program, because somebody who is starting and can only train five days should get
-- content written for somebody starting — not the advanced split with lighter words.
-- The three frequencies of a band share their session templates, so twenty-four
-- programs cost eight families' worth of content and not twenty-four.
--
-- Loads are deliberately **not** prescribed. A curated program cannot know what
-- anybody lifts, so effort is expressed as RPE and the person brings the weight. A
-- number here would be a number somebody trusts.

\set ON_ERROR_STOP on

begin;

-- Published content is immutable, so its children are insert-only and guarded. This
-- is the same switch the publication commands set.
select set_config('app.planning_publication', 'true', true);

-- **Why an actor context in an admin script.** The content validators are
-- `security definer`, so they run as `allfit_owner` and are subject to forced row
-- security no matter who called them: without an actor they read an empty catalogue
-- and reject perfectly good content as unknown. The identifier below is a reserved
-- **context marker, not a person**: nothing is ever attributed to it, no row records
-- it, and the only rows it opens are the global published catalogue rows that every
-- authenticated person can already read. It exists because the read ritual wants an
-- actor and curation has none.
select set_config('app.actor_kind', 'person', true);
select set_config('app.actor_person_id', '019f0000-0000-7000-8000-00000000c0de', true);

-- ---------------------------------------------------------------------------
-- 1 · Catalogue foundations
-- ---------------------------------------------------------------------------

-- Distance is its own dimension, not a flavour of length: `cm` is canonical for how
-- tall somebody is, and offering kilometres there would be absurd.
insert into catalog.units (id, code, dimension, is_canonical, to_canonical_factor)
values
  ('019f0000-0000-7000-8000-000000000001', 'm',  'distance', true,  1),
  ('019f0000-0000-7000-8000-000000000002', 'km', 'distance', false, 1000),
  ('019f0000-0000-7000-8000-000000000003', 'mi', 'distance', false, 1609.344)
on conflict do nothing;

insert into catalog.disciplines (id, code, name, status)
values
  ('019f0000-0000-7000-8000-000000000011', 'strength',  'Fuerza',      'published'),
  ('019f0000-0000-7000-8000-000000000012', 'endurance', 'Resistencia', 'published'),
  ('019f0000-0000-7000-8000-000000000013', 'interval',  'Intervalos',  'published'),
  ('019f0000-0000-7000-8000-000000000014', 'mobility',  'Movilidad',   'published')
on conflict do nothing;

insert into catalog.result_contracts (
  id, contract_code, version_number, activity_family, envelope, minimums, status, published_at
) values
  ('019f0000-0000-7000-8000-000000000021', 'allfit.strength',  1, 'strength',
    '{"schema":1}', '{"target_sets":true}', 'published', clock_timestamp()),
  ('019f0000-0000-7000-8000-000000000022', 'allfit.endurance', 1, 'endurance',
    '{"schema":1}', '{"distance_or_duration":true}', 'published', clock_timestamp()),
  ('019f0000-0000-7000-8000-000000000023', 'allfit.interval',  1, 'interval',
    '{"schema":1}', '{"rounds":true}', 'published', clock_timestamp()),
  ('019f0000-0000-7000-8000-000000000024', 'allfit.mobility',  1, 'mobility',
    '{"schema":1}', '{"sequence":true}', 'published', clock_timestamp())
on conflict do nothing;

insert into catalog.activity_types (id, discipline_code, code, name, content_scope, status)
values
  ('019f0000-0000-7000-8000-000000000031', 'strength',  'strength_session',  'Sesión de fuerza',      'global', 'published'),
  ('019f0000-0000-7000-8000-000000000032', 'endurance', 'endurance_session', 'Sesión de resistencia', 'global', 'published'),
  ('019f0000-0000-7000-8000-000000000033', 'interval',  'interval_session',  'Sesión de intervalos',  'global', 'published'),
  ('019f0000-0000-7000-8000-000000000034', 'mobility',  'mobility_session',  'Sesión de movilidad',   'global', 'published')
on conflict do nothing;

insert into catalog.activity_type_result_contracts (
  id, activity_type_id, result_contract_id, is_default, valid_from
) values
  ('019f0000-0000-7000-8000-000000000041', '019f0000-0000-7000-8000-000000000031', '019f0000-0000-7000-8000-000000000021', true, clock_timestamp()),
  ('019f0000-0000-7000-8000-000000000042', '019f0000-0000-7000-8000-000000000032', '019f0000-0000-7000-8000-000000000022', true, clock_timestamp()),
  ('019f0000-0000-7000-8000-000000000043', '019f0000-0000-7000-8000-000000000033', '019f0000-0000-7000-8000-000000000023', true, clock_timestamp()),
  ('019f0000-0000-7000-8000-000000000044', '019f0000-0000-7000-8000-000000000034', '019f0000-0000-7000-8000-000000000024', true, clock_timestamp())
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2 · Movements
-- ---------------------------------------------------------------------------

-- The slug is what the rest of this file refers to, and the identity is derived from
-- its ordinal so a rerun writes the same rows. Never renumber a slug that has
-- shipped: the number is the identity, and a program version points at it forever.
create temporary table curated_movement (ordinal integer, slug text, discipline text, name text) on commit drop;
insert into curated_movement (ordinal, slug, discipline, name) values
  (1,  'back_squat',        'strength',  'Sentadilla con barra'),
  (2,  'goblet_squat',      'strength',  'Sentadilla goblet'),
  (3,  'leg_press',         'strength',  'Prensa de piernas'),
  (4,  'lunge',             'strength',  'Zancada con mancuernas'),
  (5,  'deadlift',          'strength',  'Peso muerto convencional'),
  (6,  'romanian_deadlift', 'strength',  'Peso muerto rumano'),
  (7,  'hip_thrust',        'strength',  'Hip thrust'),
  (8,  'glute_bridge',      'strength',  'Puente de glúteo'),
  (9,  'leg_extension',     'strength',  'Extensión de cuádriceps'),
  (10, 'leg_curl',          'strength',  'Curl femoral'),
  (11, 'calf_raise',        'strength',  'Elevación de gemelos'),
  (12, 'bench_press',       'strength',  'Press de banca con barra'),
  (13, 'db_bench_press',    'strength',  'Press de banca con mancuernas'),
  (14, 'incline_db_press',  'strength',  'Press inclinado con mancuernas'),
  (15, 'push_up',           'strength',  'Flexiones'),
  (16, 'db_fly',            'strength',  'Aperturas con mancuernas'),
  (17, 'dip',               'strength',  'Fondos en paralelas'),
  (18, 'pull_up',           'strength',  'Dominadas'),
  (19, 'lat_pulldown',      'strength',  'Jalón al pecho'),
  (20, 'barbell_row',       'strength',  'Remo con barra'),
  (21, 'db_row',            'strength',  'Remo con mancuerna'),
  (22, 'cable_row',         'strength',  'Remo en polea baja'),
  (23, 'overhead_press',    'strength',  'Press militar con barra'),
  (24, 'db_shoulder_press', 'strength',  'Press de hombro con mancuernas'),
  (25, 'lateral_raise',     'strength',  'Elevaciones laterales'),
  (26, 'barbell_curl',      'strength',  'Curl de bíceps con barra'),
  (27, 'triceps_pushdown',  'strength',  'Extensión de tríceps en polea'),
  (28, 'plank',             'strength',  'Plancha frontal'),
  (29, 'side_plank',        'strength',  'Plancha lateral'),
  (30, 'hanging_leg_raise', 'strength',  'Elevación de piernas colgado'),
  (31, 'ab_wheel',          'strength',  'Rueda abdominal'),
  (32, 'steady_run',        'endurance', 'Carrera continua'),
  (33, 'brisk_walk',        'endurance', 'Caminata rápida'),
  (34, 'stationary_bike',   'endurance', 'Bicicleta estática'),
  (35, 'run_intervals',     'interval',  'Series de carrera'),
  (36, 'full_body_circuit', 'interval',  'Circuito de cuerpo completo'),
  (37, 'hip_mobility',      'mobility',  'Movilidad de cadera'),
  (38, 'thoracic_mobility', 'mobility',  'Movilidad torácica');

alter table curated_movement add column id uuid;
update curated_movement
set id = ('019f1000-0000-7000-8000-' || lpad(ordinal::text, 12, '0'))::uuid;

insert into catalog.movements (id, discipline_code, name, normalized_name, content_scope, status)
select id, discipline, name, lower(name), 'global', 'published' from curated_movement
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2b · What each movement trains, and what it needs
-- ---------------------------------------------------------------------------

-- The two taxonomies the exercise picker filters by. Same rules as everything else
-- here: the ordinal is the identity, so a rerun writes the same rows.
--
-- Fifteen of the nineteen muscles carry a `body_slug`, which is the part
-- `react-native-body-highlighter` already draws in Space's onboarding. `dorsales` and
-- `abductores` have no slug because the library has no part for them, and `cardio`
-- and `cuerpo completo` have none because they are not muscles — they are the honest
-- label for the seven movements that are not strength, which would carry none
-- otherwise.

create temporary table curated_muscle (
  ordinal integer, code text, name text, region text, body_slug text
) on commit drop;
insert into curated_muscle (ordinal, code, name, region, body_slug) values
  (1,  'chest',       'Pecho',            'upper',   'chest'),
  (2,  'upper_back',  'Espalda superior', 'upper',   'upper-back'),
  (3,  'lats',        'Dorsales',         'upper',   null),
  (4,  'lower_back',  'Espalda baja',     'upper',   'lower-back'),
  (5,  'trapezius',   'Trapecio',         'upper',   'trapezius'),
  (6,  'shoulders',   'Hombros',          'upper',   'deltoids'),
  (7,  'biceps',      'Bíceps',           'upper',   'biceps'),
  (8,  'triceps',     'Tríceps',          'upper',   'triceps'),
  (9,  'forearm',     'Antebrazo',        'upper',   'forearm'),
  (10, 'neck',        'Cuello',           'upper',   'neck'),
  (11, 'abs',         'Abdomen',          'upper',   'abs'),
  (12, 'glutes',      'Glúteos',          'lower',   'gluteal'),
  (13, 'quadriceps',  'Cuádriceps',       'lower',   'quadriceps'),
  (14, 'hamstrings',  'Isquiotibiales',   'lower',   'hamstring'),
  (15, 'adductors',   'Aductores',        'lower',   'adductors'),
  (16, 'abductors',   'Abductores',       'lower',   null),
  (17, 'calves',      'Pantorrillas',     'lower',   'calves'),
  (18, 'cardio',      'Cardio',           'general', null),
  (19, 'whole_body',  'Cuerpo completo',  'general', null);

alter table curated_muscle add column id uuid;
update curated_muscle set id = ('019f1100-0000-7000-8000-' || lpad(ordinal::text, 12, '0'))::uuid;

insert into catalog.muscles (id, code, name, region, body_slug, status, display_order)
select id, code, name, region, body_slug, 'published', ordinal from curated_muscle
on conflict do nothing;

create temporary table curated_equipment (ordinal integer, code text, name text) on commit drop;
insert into curated_equipment (ordinal, code, name) values
  (1, 'bodyweight',     'Peso corporal'),
  (2, 'barbell',        'Barra'),
  (3, 'dumbbell',       'Mancuernas'),
  (4, 'kettlebell',     'Kettlebell'),
  (5, 'machine',        'Máquina'),
  (6, 'cable',          'Polea'),
  (7, 'bench',          'Banco'),
  (8, 'pull_up_bar',    'Barra fija'),
  (9, 'cardio_machine', 'Máquina de cardio');

alter table curated_equipment add column id uuid;
update curated_equipment set id = ('019f1200-0000-7000-8000-' || lpad(ordinal::text, 12, '0'))::uuid;

insert into catalog.equipment (id, code, name, content_scope, status, display_order)
select id, code, name, 'global', 'published', ordinal from curated_equipment
on conflict do nothing;

-- The 38 movements against both taxonomies, by slug. The first muscle of each row is
-- the primary one: a squat is quadriceps before it is anything else, and the filter
-- orders by that even though it answers on any of them.
create temporary table curated_movement_muscle (movement_slug text, muscle_codes text[]) on commit drop;
insert into curated_movement_muscle (movement_slug, muscle_codes) values
  ('back_squat',        array['quadriceps','glutes','lower_back','adductors']),
  ('goblet_squat',      array['quadriceps','glutes','abs']),
  ('leg_press',         array['quadriceps','glutes','hamstrings']),
  ('lunge',             array['quadriceps','glutes','hamstrings','abductors']),
  ('deadlift',          array['hamstrings','glutes','lower_back','trapezius','forearm']),
  ('romanian_deadlift', array['hamstrings','glutes','lower_back']),
  ('hip_thrust',        array['glutes','hamstrings']),
  ('glute_bridge',      array['glutes','hamstrings']),
  ('leg_extension',     array['quadriceps']),
  ('leg_curl',          array['hamstrings']),
  ('calf_raise',        array['calves']),
  ('bench_press',       array['chest','triceps','shoulders']),
  ('db_bench_press',    array['chest','triceps','shoulders']),
  ('incline_db_press',  array['chest','shoulders','triceps']),
  ('push_up',           array['chest','triceps','abs']),
  ('db_fly',            array['chest','shoulders']),
  ('dip',               array['triceps','chest','shoulders']),
  ('pull_up',           array['lats','biceps','upper_back','forearm']),
  ('lat_pulldown',      array['lats','biceps','upper_back']),
  ('barbell_row',       array['upper_back','lats','biceps','lower_back']),
  ('db_row',            array['upper_back','lats','biceps']),
  ('cable_row',         array['upper_back','lats','biceps']),
  ('overhead_press',    array['shoulders','triceps','abs']),
  ('db_shoulder_press', array['shoulders','triceps']),
  ('lateral_raise',     array['shoulders']),
  ('barbell_curl',      array['biceps','forearm']),
  ('triceps_pushdown',  array['triceps']),
  ('plank',             array['abs','lower_back']),
  ('side_plank',        array['abs']),
  ('hanging_leg_raise', array['abs','forearm']),
  ('ab_wheel',          array['abs','lats']),
  ('steady_run',        array['cardio','quadriceps','calves']),
  ('brisk_walk',        array['cardio','calves']),
  ('stationary_bike',   array['cardio','quadriceps']),
  ('run_intervals',     array['cardio','hamstrings','calves']),
  ('full_body_circuit', array['cardio','whole_body']),
  ('hip_mobility',      array['glutes','adductors','abductors']),
  ('thoracic_mobility', array['upper_back','trapezius','neck']);

insert into catalog.movement_muscles (movement_id, muscle_id, is_primary)
select movement.id, muscle.id, worked.ordinality = 1
from curated_movement_muscle as tagged
join curated_movement as movement on movement.slug = tagged.movement_slug
cross join lateral unnest(tagged.muscle_codes) with ordinality as worked(code, ordinality)
join curated_muscle as muscle on muscle.code = worked.code
on conflict do nothing;

create temporary table curated_movement_equipment (movement_slug text, equipment_codes text[]) on commit drop;
insert into curated_movement_equipment (movement_slug, equipment_codes) values
  ('back_squat',        array['barbell']),
  ('goblet_squat',      array['kettlebell','dumbbell']),
  ('leg_press',         array['machine']),
  ('lunge',             array['dumbbell']),
  ('deadlift',          array['barbell']),
  ('romanian_deadlift', array['barbell']),
  ('hip_thrust',        array['barbell','bench']),
  ('glute_bridge',      array['bodyweight']),
  ('leg_extension',     array['machine']),
  ('leg_curl',          array['machine']),
  ('calf_raise',        array['bodyweight']),
  ('bench_press',       array['barbell','bench']),
  ('db_bench_press',    array['dumbbell','bench']),
  ('incline_db_press',  array['dumbbell','bench']),
  ('push_up',           array['bodyweight']),
  ('db_fly',            array['dumbbell','bench']),
  ('dip',               array['bodyweight']),
  ('pull_up',           array['pull_up_bar','bodyweight']),
  ('lat_pulldown',      array['cable']),
  ('barbell_row',       array['barbell']),
  ('db_row',            array['dumbbell','bench']),
  ('cable_row',         array['cable']),
  ('overhead_press',    array['barbell']),
  ('db_shoulder_press', array['dumbbell']),
  ('lateral_raise',     array['dumbbell']),
  ('barbell_curl',      array['barbell']),
  ('triceps_pushdown',  array['cable']),
  ('plank',             array['bodyweight']),
  ('side_plank',        array['bodyweight']),
  ('hanging_leg_raise', array['pull_up_bar','bodyweight']),
  ('ab_wheel',          array['bodyweight']),
  ('steady_run',        array['bodyweight']),
  ('brisk_walk',        array['bodyweight']),
  ('stationary_bike',   array['cardio_machine']),
  ('run_intervals',     array['bodyweight']),
  ('full_body_circuit', array['bodyweight']),
  ('hip_mobility',      array['bodyweight']),
  ('thoracic_mobility', array['bodyweight']);

-- The first is required and the rest optional: a pull-up needs a bar, and calling
-- bodyweight "required" alongside it would say the same thing twice.
insert into catalog.movement_equipment (movement_id, equipment_id, requirement)
select movement.id, item.id,
       case when needed.ordinality = 1 then 'required' else 'optional' end
from curated_movement_equipment as tagged
join curated_movement as movement on movement.slug = tagged.movement_slug
cross join lateral unnest(tagged.equipment_codes) with ordinality as needed(code, ordinality)
join curated_equipment as item on item.code = needed.code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3 · Session templates
-- ---------------------------------------------------------------------------

-- Eight band-families of five days each. The three frequencies of a band share
-- these: the three-day program uses A to C, the four-day adds D, the five-day adds E.
-- That is why twenty-four programs cost forty templates and not a hundred and twenty.
create temporary table curated_template (ordinal integer, slug text, discipline text, title text) on commit drop;
insert into curated_template (ordinal, slug, discipline, title) values
  (1,  'me_a', 'strength',  'Cuerpo completo A'),
  (2,  'me_b', 'strength',  'Cuerpo completo B'),
  (3,  'me_c', 'strength',  'Cuerpo completo C'),
  (4,  'me_d', 'strength',  'Empuje inicial'),
  (5,  'me_e', 'strength',  'Tirón inicial'),
  (6,  'mp_a', 'strength',  'Empuje'),
  (7,  'mp_b', 'strength',  'Tirón'),
  (8,  'mp_c', 'strength',  'Pierna'),
  (9,  'mp_d', 'strength',  'Torso'),
  (10, 'mp_e', 'strength',  'Pierna y core'),
  (11, 'be_a', 'strength',  'Fuerza ligera A'),
  (12, 'be_b', 'endurance', 'Caminata larga'),
  (13, 'be_c', 'strength',  'Fuerza ligera B'),
  (14, 'be_d', 'endurance', 'Cardio suave'),
  (15, 'be_e', 'endurance', 'Caminata corta'),
  (16, 'bp_a', 'strength',  'Fuerza metabólica A'),
  (17, 'bp_b', 'interval',  'Intervalos de circuito'),
  (18, 'bp_c', 'strength',  'Fuerza metabólica B'),
  (19, 'bp_d', 'endurance', 'Carrera continua'),
  (20, 'bp_e', 'interval',  'Circuito largo'),
  (21, 'fe_a', 'strength',  'Fuerza general A'),
  (22, 'fe_b', 'mobility',  'Movilidad'),
  (23, 'fe_c', 'strength',  'Fuerza general B'),
  (24, 'fe_d', 'endurance', 'Cardio ligero'),
  (25, 'fe_e', 'strength',  'Cuerpo completo suave'),
  (26, 'fp_a', 'strength',  'Fuerza general'),
  (27, 'fp_b', 'endurance', 'Rodaje continuo'),
  (28, 'fp_c', 'strength',  'Torso y core'),
  (29, 'fp_d', 'interval',  'Intervalos cortos'),
  (30, 'fp_e', 'mobility',  'Movilidad y core'),
  (31, 'ce_a', 'endurance', 'Rodaje suave'),
  (32, 'ce_b', 'endurance', 'Caminata y carrera'),
  (33, 'ce_c', 'endurance', 'Rodaje largo inicial'),
  (34, 'ce_d', 'strength',  'Fuerza para correr'),
  (35, 'ce_e', 'mobility',  'Movilidad de carrera'),
  (36, 'cp_a', 'endurance', 'Rodaje'),
  (37, 'cp_b', 'interval',  'Series'),
  (38, 'cp_c', 'endurance', 'Rodaje largo'),
  (39, 'cp_d', 'strength',  'Fuerza para correr avanzada'),
  (40, 'cp_e', 'endurance', 'Rodaje de recuperación');

alter table curated_template add column id uuid;
update curated_template set id = ('019f2000-0000-7000-8000-' || lpad(ordinal::text, 12, '0'))::uuid;

-- Effort is RPE and never a load. A curated program cannot know what anybody lifts,
-- and a kilo written here is a kilo somebody trusts.
create temporary table curated_strength_step (tpl text, pos integer, mv text, sets integer, reps integer, rpe numeric) on commit drop;
insert into curated_strength_step (tpl, pos, mv, sets, reps, rpe) values
  ('me_a', 1, 'goblet_squat', 3, 10, 6), ('me_a', 2, 'db_bench_press', 3, 10, 6),
  ('me_a', 3, 'db_row', 3, 10, 6), ('me_a', 4, 'plank', 3, null, 6),
  ('me_b', 1, 'romanian_deadlift', 3, 10, 6), ('me_b', 2, 'db_shoulder_press', 3, 10, 6),
  ('me_b', 3, 'lat_pulldown', 3, 10, 6), ('me_b', 4, 'glute_bridge', 3, 12, 6),
  ('me_c', 1, 'leg_press', 3, 12, 6), ('me_c', 2, 'push_up', 3, 8, 6),
  ('me_c', 3, 'cable_row', 3, 12, 6), ('me_c', 4, 'side_plank', 3, null, 6),
  ('me_d', 1, 'db_bench_press', 3, 10, 6), ('me_d', 2, 'db_shoulder_press', 3, 10, 6),
  ('me_d', 3, 'lateral_raise', 3, 12, 6), ('me_d', 4, 'triceps_pushdown', 3, 12, 6),
  ('me_e', 1, 'lat_pulldown', 3, 10, 6), ('me_e', 2, 'db_row', 3, 10, 6),
  ('me_e', 3, 'barbell_curl', 3, 12, 6), ('me_e', 4, 'plank', 3, null, 6),
  ('mp_a', 1, 'bench_press', 4, 8, 7), ('mp_a', 2, 'incline_db_press', 3, 10, 7),
  ('mp_a', 3, 'dip', 3, 8, 7), ('mp_a', 4, 'lateral_raise', 3, 12, 7),
  ('mp_a', 5, 'triceps_pushdown', 3, 12, 7),
  ('mp_b', 1, 'pull_up', 4, 6, 7), ('mp_b', 2, 'barbell_row', 4, 8, 7),
  ('mp_b', 3, 'cable_row', 3, 10, 7), ('mp_b', 4, 'barbell_curl', 3, 10, 7),
  ('mp_c', 1, 'back_squat', 4, 6, 7), ('mp_c', 2, 'romanian_deadlift', 3, 8, 7),
  ('mp_c', 3, 'leg_press', 3, 10, 7), ('mp_c', 4, 'leg_curl', 3, 12, 7),
  ('mp_c', 5, 'calf_raise', 4, 15, 7),
  ('mp_d', 1, 'bench_press', 4, 8, 7), ('mp_d', 2, 'barbell_row', 4, 8, 7),
  ('mp_d', 3, 'overhead_press', 3, 8, 7), ('mp_d', 4, 'lat_pulldown', 3, 10, 7),
  ('mp_e', 1, 'deadlift', 4, 5, 7), ('mp_e', 2, 'lunge', 3, 10, 7),
  ('mp_e', 3, 'hip_thrust', 4, 10, 7), ('mp_e', 4, 'ab_wheel', 3, 10, 7),
  ('be_a', 1, 'goblet_squat', 2, 12, 5), ('be_a', 2, 'push_up', 2, 8, 5),
  ('be_a', 3, 'db_row', 2, 12, 5), ('be_a', 4, 'plank', 2, null, 5),
  ('be_c', 1, 'leg_press', 2, 12, 5), ('be_c', 2, 'db_shoulder_press', 2, 12, 5),
  ('be_c', 3, 'lat_pulldown', 2, 12, 5), ('be_c', 4, 'glute_bridge', 2, 15, 5),
  ('bp_a', 1, 'back_squat', 3, 8, 7), ('bp_a', 2, 'bench_press', 3, 8, 7),
  ('bp_a', 3, 'barbell_row', 3, 8, 7), ('bp_a', 4, 'hip_thrust', 3, 12, 7),
  ('bp_c', 1, 'romanian_deadlift', 3, 8, 7), ('bp_c', 2, 'pull_up', 3, 6, 7),
  ('bp_c', 3, 'overhead_press', 3, 8, 7), ('bp_c', 4, 'lunge', 3, 12, 7),
  ('fe_a', 1, 'goblet_squat', 3, 10, 6), ('fe_a', 2, 'push_up', 3, 8, 6),
  ('fe_a', 3, 'cable_row', 3, 12, 6),
  ('fe_c', 1, 'romanian_deadlift', 3, 10, 6), ('fe_c', 2, 'db_shoulder_press', 3, 10, 6),
  ('fe_c', 3, 'lat_pulldown', 3, 12, 6),
  ('fe_e', 1, 'leg_press', 2, 12, 5), ('fe_e', 2, 'db_bench_press', 2, 12, 5),
  ('fe_e', 3, 'db_row', 2, 12, 5), ('fe_e', 4, 'plank', 2, null, 5),
  ('fp_a', 1, 'back_squat', 3, 8, 7), ('fp_a', 2, 'bench_press', 3, 8, 7),
  ('fp_a', 3, 'barbell_row', 3, 8, 7), ('fp_a', 4, 'calf_raise', 3, 15, 7),
  ('fp_c', 1, 'overhead_press', 3, 8, 7), ('fp_c', 2, 'pull_up', 3, 6, 7),
  ('fp_c', 3, 'hanging_leg_raise', 3, 10, 7), ('fp_c', 4, 'side_plank', 3, null, 7),
  ('ce_d', 1, 'lunge', 3, 10, 6), ('ce_d', 2, 'glute_bridge', 3, 12, 6),
  ('ce_d', 3, 'calf_raise', 3, 15, 6), ('ce_d', 4, 'plank', 3, null, 6),
  ('cp_d', 1, 'back_squat', 3, 6, 7), ('cp_d', 2, 'romanian_deadlift', 3, 8, 7),
  ('cp_d', 3, 'hip_thrust', 3, 10, 7), ('cp_d', 4, 'ab_wheel', 3, 10, 7);

create temporary table curated_other_step (tpl text, pos integer, mv text, target jsonb) on commit drop;
insert into curated_other_step (tpl, pos, mv, target) values
  ('be_b', 1, 'brisk_walk',        '{"family":"endurance","target_duration_seconds":2400}'),
  ('be_d', 1, 'stationary_bike',   '{"family":"endurance","target_duration_seconds":1800}'),
  ('be_e', 1, 'brisk_walk',        '{"family":"endurance","target_duration_seconds":1500}'),
  ('bp_b', 1, 'full_body_circuit', '{"family":"interval","rounds":8,"work_duration_seconds":40,"rest_duration_seconds":20,"target_rpe":7}'),
  ('bp_d', 1, 'steady_run',        '{"family":"endurance","target_distance_value":5,"target_distance_unit_code":"km"}'),
  ('bp_e', 1, 'full_body_circuit', '{"family":"interval","rounds":10,"work_duration_seconds":45,"rest_duration_seconds":15,"target_rpe":7}'),
  ('fe_b', 1, 'hip_mobility',      '{"family":"mobility","sequence_position":1,"hold_duration_seconds":45,"side":"bilateral"}'),
  ('fe_b', 2, 'thoracic_mobility', '{"family":"mobility","sequence_position":2,"hold_duration_seconds":45,"side":"bilateral"}'),
  ('fe_d', 1, 'brisk_walk',        '{"family":"endurance","target_duration_seconds":1800}'),
  ('fp_b', 1, 'steady_run',        '{"family":"endurance","target_duration_seconds":2400}'),
  ('fp_d', 1, 'run_intervals',     '{"family":"interval","rounds":6,"work_duration_seconds":60,"rest_duration_seconds":90,"target_rpe":8}'),
  ('fp_e', 1, 'hip_mobility',      '{"family":"mobility","sequence_position":1,"hold_duration_seconds":60,"side":"bilateral"}'),
  ('fp_e', 2, 'thoracic_mobility', '{"family":"mobility","sequence_position":2,"hold_duration_seconds":60,"side":"bilateral"}'),
  ('ce_a', 1, 'steady_run',        '{"family":"endurance","target_duration_seconds":1200}'),
  ('ce_b', 1, 'brisk_walk',        '{"family":"endurance","target_duration_seconds":1800}'),
  ('ce_c', 1, 'steady_run',        '{"family":"endurance","target_duration_seconds":2100}'),
  ('ce_e', 1, 'hip_mobility',      '{"family":"mobility","sequence_position":1,"hold_duration_seconds":45,"side":"bilateral"}'),
  ('cp_a', 1, 'steady_run',        '{"family":"endurance","target_distance_value":8,"target_distance_unit_code":"km"}'),
  ('cp_b', 1, 'run_intervals',     '{"family":"interval","rounds":6,"work_duration_seconds":180,"rest_duration_seconds":120,"target_rpe":8}'),
  ('cp_c', 1, 'steady_run',        '{"family":"endurance","target_distance_value":12,"target_distance_unit_code":"km"}'),
  ('cp_e', 1, 'steady_run',        '{"family":"endurance","target_distance_value":6,"target_distance_unit_code":"km"}');

create temporary table curated_step (tpl text, pos integer, mv text, target jsonb) on commit drop;
insert into curated_step (tpl, pos, mv, target)
select tpl, pos, mv,
       jsonb_strip_nulls(jsonb_build_object(
         'family', 'strength', 'target_sets', sets, 'target_reps', reps, 'target_rpe', rpe))
from curated_strength_step;
insert into curated_step (tpl, pos, mv, target)
select tpl, pos, mv, target from curated_other_step;

create temporary table curated_template_version (slug text, version_id uuid) on commit drop;

do $do$
declare
  template record;
begin
  for template in select * from curated_template order by ordinal loop
    insert into curated_template_version (slug, version_id)
    select template.slug, planning.publish_global_session_template(
      template.id,
      template.discipline,
      jsonb_build_object(
        'title', template.title,
        'activity_type_id', (
          select activity.id::text from catalog.activity_types as activity
          where activity.code = template.discipline || '_session' and activity.content_scope = 'global'
        ),
        'steps', (
          select jsonb_agg(jsonb_build_object(
            'position', step.pos,
            'movement_id', movement.id::text,
            'activity_type_id', null,
            'notes', null,
            'target', step.target
          ) order by step.pos)
          from curated_step as step
          join curated_movement as movement on movement.slug = step.mv
          where step.tpl = template.slug
        )
      )
    );
  end loop;
end
$do$;

-- ---------------------------------------------------------------------------
-- 4 · Programs
-- ---------------------------------------------------------------------------

-- Four goal families × two level bands × three frequencies. The frequency is an axis
-- and not a property, so somebody starting who can train five days gets content
-- written for somebody starting rather than the advanced split with gentler words.
--
-- `sex_affinity` is null on every one of them, deliberately. The column exists and
-- orders the catalogue when a program genuinely leans, and **none of these do**:
-- writing a lean here would be a claim about bodies rather than about content. What
-- actually moves a program up for one person and not another is the emphasis, which
-- is matched against the zones they declared in the onboarding.
create temporary table curated_program (
  ordinal integer, slug text, band text, frequency integer, title text, weeks integer,
  goals text[], levels text[], emphases text[]
) on commit drop;

-- What the program is, in the words somebody deciding needs. One per band-family
-- rather than per program: the three frequencies of a band are the same training
-- with more or fewer days of it, and twenty-four near-identical paragraphs would be
-- twenty-four things to keep in step.
create temporary table curated_band (band text, description text) on commit drop;
insert into curated_band (band, description) values
  ('me', 'Los patrones fundamentales con poco peso y muchas repeticiones, para que el cuerpo aprenda el movimiento antes de cargarlo.'),
  ('mp', 'Un reparto clásico de empuje, tirón y pierna. La progresión es por carga: el mismo esquema de series, más peso cuando las repeticiones salen limpias.'),
  ('be', 'Fuerza ligera y caminata, alternadas. El objetivo de estas primeras semanas es la constancia, no la intensidad.'),
  ('bp', 'Fuerza básica combinada con circuitos y carrera continua. El gasto viene del volumen, no de llegar al fallo.'),
  ('fe', 'Un poco de todo: fuerza general, movilidad y cardio suave, sin especializarte en nada todavía.'),
  ('fp', 'Fuerza, carrera e intervalos en la misma semana, para sostener una condición general amplia.'),
  ('ce', 'Rodajes suaves y caminata-carrera, con una sesión de fuerza para las piernas. Se construye la base antes que la velocidad.'),
  ('cp', 'Rodajes, series y una tirada larga, más fuerza específica. La carga sube por distancia, no por ritmo.');
insert into curated_program (ordinal, slug, band, frequency, title, weeks, goals, levels, emphases) values
  (1,  'me3', 'me', 3, 'Cuerpo completo',              6,  array['build_muscle'], array['starting'], array['whole_body']),
  (2,  'me4', 'me', 4, 'Fuerza inicial en cuatro',     8,  array['build_muscle'], array['starting'], array['whole_body','chest']),
  (3,  'me5', 'me', 5, 'Fuerza inicial en cinco',      8,  array['build_muscle'], array['starting'], array['whole_body','chest','back']),
  (4,  'mp3', 'mp', 3, 'Fuerza básica',                8,  array['build_muscle','maintain'], array['some_practice','experienced'], array['chest','back','legs']),
  (5,  'mp4', 'mp', 4, 'Torso y pierna',               10, array['build_muscle','maintain'], array['some_practice','experienced'], array['chest','back','legs','shoulders']),
  (6,  'mp5', 'mp', 5, 'Empuje · tirón · pierna',      12, array['build_muscle','maintain'], array['some_practice','experienced'], array['chest','back','shoulders','arms','legs','glutes','abs']),
  (7,  'be3', 'be', 3, 'Empieza a moverte',            6,  array['lose_weight'], array['starting'], array['whole_body']),
  (8,  'be4', 'be', 4, 'Fuerza y caminata',            8,  array['lose_weight'], array['starting'], array['whole_body','legs']),
  (9,  'be5', 'be', 5, 'Movimiento diario',            8,  array['lose_weight'], array['starting'], array['whole_body','legs']),
  (10, 'bp3', 'bp', 3, 'Quema y fuerza',               8,  array['lose_weight'], array['some_practice','experienced'], array['whole_body','glutes']),
  (11, 'bp4', 'bp', 4, 'Fuerza y cardio',              8,  array['lose_weight'], array['some_practice','experienced'], array['whole_body','glutes','legs']),
  (12, 'bp5', 'bp', 5, 'Circuito metabólico',          6,  array['lose_weight'], array['some_practice','experienced'], array['whole_body','glutes','legs','abs']),
  (13, 'fe3', 'fe', 3, 'Puesta a punto',               6,  array['get_fit','maintain'], array['starting'], array['whole_body']),
  (14, 'fe4', 'fe', 4, 'En forma en cuatro',           8,  array['get_fit','maintain'], array['starting'], array['whole_body','legs']),
  (15, 'fe5', 'fe', 5, 'En forma en cinco',            8,  array['get_fit','maintain'], array['starting'], array['whole_body','legs']),
  (16, 'fp3', 'fp', 3, 'En forma en tres',             8,  array['get_fit','maintain'], array['some_practice','experienced'], array['whole_body','legs']),
  (17, 'fp4', 'fp', 4, 'Fuerza y cardio mixto',        10, array['get_fit','maintain'], array['some_practice','experienced'], array['whole_body','legs','abs']),
  (18, 'fp5', 'fp', 5, 'Cinco días completos',         10, array['get_fit','maintain'], array['some_practice','experienced'], array['whole_body','legs','abs']),
  (19, 'ce3', 'ce', 3, 'Base de carrera',              8,  array['run_a_race'], array['starting'], array['legs']),
  (20, 'ce4', 'ce', 4, 'Base de carrera con fuerza',   10, array['run_a_race'], array['starting'], array['legs','glutes']),
  (21, 'ce5', 'ce', 5, 'Rodaje diario',                10, array['run_a_race'], array['starting'], array['legs','glutes']),
  (22, 'cp3', 'cp', 3, 'Diez kilómetros',              12, array['run_a_race'], array['some_practice','experienced'], array['legs']),
  (23, 'cp4', 'cp', 4, 'Diez kilómetros con fuerza',   12, array['run_a_race'], array['some_practice','experienced'], array['legs','glutes']),
  (24, 'cp5', 'cp', 5, 'Media maratón',                14, array['run_a_race'], array['some_practice','experienced'], array['legs','glutes','abs']);

alter table curated_program add column id uuid;
update curated_program set id = ('019f3000-0000-7000-8000-' || lpad(ordinal::text, 12, '0'))::uuid;

-- Which weekdays a frequency uses. Three days rest between each; four and five keep
-- the weekend free, which is the shape somebody who trains around a job can hold.
create temporary table curated_frequency_day (frequency integer, slot integer, day integer) on commit drop;
insert into curated_frequency_day (frequency, slot, day) values
  (3, 1, 1), (3, 2, 3), (3, 3, 5),
  (4, 1, 1), (4, 2, 2), (4, 3, 4), (4, 4, 5),
  (5, 1, 1), (5, 2, 2), (5, 3, 3), (5, 4, 4), (5, 5, 5);

do $do$
declare
  program record;
begin
  for program in select * from curated_program order by ordinal loop
    perform planning.publish_global_program(
      program.id,
      jsonb_build_object(
        'title', program.title,
        'notes', (select band.description from curated_band as band where band.band = program.band),
        'sessions', (
          select jsonb_agg(jsonb_build_object(
            'position', ((week.number - 1) * program.frequency + slot.slot),
            'week', week.number,
            'day', slot.day,
            'template_version_id', published.version_id::text
          ) order by week.number, slot.slot)
          from generate_series(1, program.weeks) as week(number)
          cross join curated_frequency_day as slot
          join curated_template_version as published
            on published.slug = program.band || '_' || chr(96 + slot.slot)
          where slot.frequency = program.frequency
        )
      ),
      null,
      program.goals,
      program.levels,
      program.emphases
    );
  end loop;
end
$do$;

commit;
