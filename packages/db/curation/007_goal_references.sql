-- The nutrition goal each training goal brings to a programme (PN-1), per kilo of body
-- weight. `nutrition.reference_targets` multiplies by the person's latest weight and rounds
-- energy to 50 kcal and grams to 5.
--
-- **Proposed values, for review by a nutrition professional.** They follow common sports
-- nutrition ranges: energy per kilo around maintenance (about 30–34 kcal/kg), lower to lose
-- fat and higher to gain muscle or to fuel endurance; protein 1.6–2.2 g/kg, higher in a
-- deficit to keep muscle; fat near 0.8–0.9 g/kg; carbohydrates take the rest of the energy,
-- most for endurance. Non-clinical references, not a prescription (ADR-027).
--
-- Rerunnable: each row is rewritten. Runs as the superuser, like the rest of curation.

\set ON_ERROR_STOP on

begin;

insert into nutrition.goal_references
  (goal_code, nutrient_code, mode, minimum_per_kg, maximum_per_kg, exact_per_kg)
values
  -- Ganar músculo: a gentle surplus, protein high.
  ('build_muscle', 'energy', 'range', 35, 39, null),
  ('build_muscle', 'protein', 'exact', null, null, 2.0),
  ('build_muscle', 'carbohydrates', 'exact', null, null, 4.5),
  ('build_muscle', 'fat', 'exact', null, null, 0.9),
  -- Perder grasa: a moderate deficit that keeps the muscle.
  ('lose_weight', 'energy', 'range', 24, 28, null),
  ('lose_weight', 'protein', 'exact', null, null, 2.2),
  ('lose_weight', 'carbohydrates', 'exact', null, null, 2.5),
  ('lose_weight', 'fat', 'exact', null, null, 0.8),
  -- Ponerme en forma: around maintenance.
  ('get_fit', 'energy', 'range', 30, 34, null),
  ('get_fit', 'protein', 'exact', null, null, 1.6),
  ('get_fit', 'carbohydrates', 'exact', null, null, 3.5),
  ('get_fit', 'fat', 'exact', null, null, 0.9),
  -- Mantenerme: what is spent, in balance.
  ('maintain', 'energy', 'range', 30, 34, null),
  ('maintain', 'protein', 'exact', null, null, 1.6),
  ('maintain', 'carbohydrates', 'exact', null, null, 3.5),
  ('maintain', 'fat', 'exact', null, null, 0.9),
  -- Preparar una carrera: fuel for the kilometres, most of it carbohydrate.
  ('run_a_race', 'energy', 'range', 34, 40, null),
  ('run_a_race', 'protein', 'exact', null, null, 1.6),
  ('run_a_race', 'carbohydrates', 'exact', null, null, 5.5),
  ('run_a_race', 'fat', 'exact', null, null, 0.9)
on conflict (goal_code, nutrient_code) do update
set mode = excluded.mode,
    minimum_per_kg = excluded.minimum_per_kg,
    maximum_per_kg = excluded.maximum_per_kg,
    exact_per_kg = excluded.exact_per_kg,
    updated_at = clock_timestamp();

commit;
