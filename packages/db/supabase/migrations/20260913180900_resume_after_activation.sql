-- The resume read has to survive activation.
--
-- It filtered on `status = 'open'`, so the moment somebody activated their Fitness
-- ID the read went empty — and an empty read is also what an account that never
-- started sees. The app cannot tell those apart, so a person who had just finished
-- the onboarding was sent back to the eligibility gate on their next cold start,
-- where `start_onboarding_attempt` then refused them for being already registered.
--
-- Nothing about the shape changes: `status` is already in the contract and already
-- carries `activated`. What changes is which attempt the reader picks — the open
-- one when there is one, and otherwise the one that ended the onboarding. Expired
-- and ineligible attempts stay invisible, because neither is a place to resume.
--
-- Covered by T-IDN-ACTIVATION-01.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function identity.read_current_onboarding(p_account_id uuid)
returns table (
  attempt_id uuid,
  status text,
  eligibility_status text,
  expires_at timestamptz,
  answers jsonb
)
language sql
security definer
set search_path = pg_catalog
as $function$
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

alter function identity.read_current_onboarding(uuid) owner to allfit_owner;
revoke all on function identity.read_current_onboarding(uuid) from public;
grant execute on function identity.read_current_onboarding(uuid) to allfit_api;
