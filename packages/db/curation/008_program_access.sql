-- Which of Allfit's programmes the free plan opens (DT-018, HU-SP-084).
--
-- The free selection is one way in for each goal: upper and lower body, basic strength,
-- a whole-body routine, running from zero and getting moving again. Every other global
-- programme names `full_program_catalogue`, which Pro opens. A partner's programmes can
-- later name a function of their own and each plan decides whether it includes it.
--
-- Rerunnable: every global programme is rewritten. Runs as the superuser, like the rest
-- of curation, after 001_global_training_catalogue.sql.

\set ON_ERROR_STOP on

begin;

update planning.programs as program
set unlock_feature_code = case
  when program.id in (
    '019f3000-0000-7000-8000-000000000005', -- Torso y pierna
    '019f3000-0000-7000-8000-000000000004', -- Fuerza básica
    '019f3000-0000-7000-8000-000000000001', -- Cuerpo completo
    '019f3000-0000-7000-8000-000000000019', -- Base de carrera
    '019f3000-0000-7000-8000-000000000007'  -- Empieza a moverte
  ) then null
  else 'full_program_catalogue'
end
where program.content_scope = 'global';

commit;
