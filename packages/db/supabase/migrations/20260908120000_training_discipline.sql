-- The discipline somebody trains, asked before the goal.
--
-- Space assumed everybody lifts. The product is going to cover several disciplines and
-- the onboarding has to ask which one, because `HU-SP-010`'s list of goals now depends
-- on the answer: with strength there is no point offering "run a race".
--
-- **This is data, not schema.** `identity.profile_attributes` is a catalogue and
-- `declare_profile_claim` fails closed on a code it does not hold, so a new attribute is
-- an insert plus one more key in the reader. `20260824170000_training_experience.sql` is
-- the precedent and this follows it exactly.
--
-- **All six go in the catalogue although only one can be chosen.**
-- `ck_profile_attributes_allowed_values` refuses an enum with fewer than two values, so
-- "only strength" cannot be expressed here — and it should not be: the catalogue is the
-- vocabulary of the concept, while what a person may answer today is a launch decision.
-- `primary_training_goal` already works this way, holding six values against a contract
-- that offers five.
--
-- **`catalog.disciplines` is not this.** That table holds the four activity families
-- that type a target — strength, endurance, interval, mobility — and it still has no
-- grant for the runtime role. These six are the product's taxonomy, one level above.
--
-- `identity.read_training_profile` is deliberately left alone: it would gain a column,
-- which forces a drop and recreate, and nothing reads the discipline outside the
-- onboarding while there is only one.

begin;

insert into identity.profile_attributes (code, name, data_classification_code, value_kind, allowed_values)
values (
  'training_discipline',
  'Disciplina principal de entrenamiento',
  'training',
  'enum',
  array[
    'strength',
    'high_intensity',
    'endurance_cardio',
    'combat_sports',
    'wellbeing_control',
    'rhythm_classes'
  ]
);

create or replace function identity.read_current_onboarding(p_account_id uuid)
 RETURNS TABLE(attempt_id uuid, status text, eligibility_status text, expires_at timestamp with time zone, answers jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select attempt.id,
         attempt.status::text,
         coalesce(evidence.result::text, 'pending'),
         attempt.expires_at,
         jsonb_build_object(
           'identity', jsonb_build_object(
             'answered', person.id is not null,
             'value', case
               when person.id is null then null
               else jsonb_build_object(
                 'given_name', person.given_name,
                 'family_name', person.family_name,
                 'username', person.username::text
               )
             end
           ),
           'biological_sex', jsonb_build_object(
             'answered', attempt.biological_sex_answered_at is not null,
             'value', person.biological_sex::text
           ),
           'primary_training_goal', jsonb_build_object(
             'answered', goal.value_text is not null,
             'value', goal.value_text
           ),
           'focus_areas', jsonb_build_object(
             'answered', cardinality(focus.areas) > 0,
             'value', to_jsonb(focus.areas)
           ),
           'training_discipline', jsonb_build_object(
             'answered', discipline.value_text is not null,
             'value', discipline.value_text
           ),
           'training_experience', jsonb_build_object(
             'answered', experience.value_text is not null,
             'value', experience.value_text
           ),
           'body_measures', jsonb_build_object(
             'answered', skipped.step_code is not null
               or (weight.value_numeric is not null and height.value_numeric is not null),
             'value', case
               when weight.value_numeric is null and height.value_numeric is null then null
               else jsonb_build_object(
                 'weight', case
                   when weight.value_numeric is null then null
                   else jsonb_build_object(
                     'value', weight.value_numeric,
                     'unit', weight.unit_code,
                     'original_unit', weight.original_unit_code
                   )
                 end,
                 'height', case
                   when height.value_numeric is null then null
                   else jsonb_build_object(
                     'value', height.value_numeric,
                     'unit', height.unit_code,
                     'original_unit', height.original_unit_code
                   )
                 end
               )
             end
           )
         )
  -- The open attempt when there is one, and otherwise the attempt that ended the
  -- onboarding. Reading only open attempts made an activated person look exactly
  -- like an account that never started, and the app sent them back to the gate.
  from (
    select candidate.*
    from identity.onboarding_attempts as candidate
    where candidate.account_id = p_account_id
      and (
        (candidate.status = 'open' and candidate.expires_at > clock_timestamp())
        or candidate.status = 'activated'
      )
    order by (candidate.status = 'open') desc, candidate.updated_at desc, candidate.id desc
    limit 1
  ) as attempt
  left join identity.people as person on person.id = attempt.person_id
  left join lateral (
    select evidence.result
    from identity.eligibility_evidence as evidence
    where evidence.onboarding_attempt_id = attempt.id
    order by evidence.evaluated_at desc, evidence.id desc
    limit 1
  ) as evidence on true
  left join lateral (
    select claim.value_text
    from identity.fitness_profile_claims as claim
    where claim.person_id = person.id
      and claim.attribute_code = 'primary_training_goal'
      and claim.valid_to is null
      and claim.provenance = 'person_declared'
    order by claim.valid_from desc, claim.id desc
    limit 1
  ) as goal on true
  left join lateral (
    select identity.current_focus_areas(person.id) as areas
  ) as focus on true
  left join lateral (
    select claim.value_text
    from identity.fitness_profile_claims as claim
    where claim.person_id = person.id
      and claim.attribute_code = 'training_discipline'
      and claim.valid_to is null
      and claim.provenance = 'person_declared'
    order by claim.valid_from desc, claim.id desc
    limit 1
  ) as discipline on true
  left join lateral (
    select claim.value_text
    from identity.fitness_profile_claims as claim
    where claim.person_id = person.id
      and claim.attribute_code = 'training_experience'
      and claim.valid_to is null
      and claim.provenance = 'person_declared'
    order by claim.valid_from desc, claim.id desc
    limit 1
  ) as experience on true
  -- La última de cada métrica: es una serie, así que lo vigente es lo más reciente.
  left join lateral (
    select record.value_numeric, record.unit_code, record.original_unit_code
    from identity.body_progress_records as record
    where record.person_id = person.id and record.metric_code = 'body_weight'
    order by record.measured_on desc, record.id desc
    limit 1
  ) as weight on true
  left join lateral (
    select record.value_numeric, record.unit_code, record.original_unit_code
    from identity.body_progress_records as record
    where record.person_id = person.id and record.metric_code = 'body_height'
    order by record.measured_on desc, record.id desc
    limit 1
  ) as height on true
  left join lateral (
    select skip.step_code
    from identity.onboarding_step_skips as skip
    where skip.onboarding_attempt_id = attempt.id and skip.step_code = 'body_measures'
    limit 1
  ) as skipped on true
  where access_control.actor_kind() = 'account'
    and access_control.account() = p_account_id
$function$;

commit;
