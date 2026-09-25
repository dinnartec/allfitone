-- Onboarding state as one derived column.
--
-- The resume read grew a flat column per answer, and two per question that can be
-- declined. Adding the training goal would have made it eleven, and the four
-- profile attributes still waiting behind HU-SP-011..013 and HU-SP-021 would make
-- it nineteen. Every one of those additions changes the RETURNS TABLE, which
-- PostgreSQL treats as a new return type and refuses with 42P13, so every one
-- costs a drop and a recreate.
--
-- So the shape changes once, here, and stops changing: a single `answers` object
-- with one entry per step. From now on a new step edits the body of this function,
-- which `create or replace` accepts.
--
-- Nothing is stored. Every answer is derived on read from the data that already
-- carries it — the name on the person, the mark on the attempt, the claim in
-- force. A stored progress pointer would be a second truth that drifts from the
-- first, and it could not survive what this product already allows: people going
-- back to correct an answer they already gave. A pointer would have to retreat and
-- lose everything after it; a set of answers does not have that problem.
--
-- The history of what someone signed up with needs nothing new either. Claims are
-- append-only and UPDATE is revoked from the runtime role, so a correction seals
-- the previous claim with `valid_to` and `superseded_by_id` and the original stays
-- readable forever.
--
-- Only the claim in force is reported. `valid_to is null` is what makes it the
-- current one, and `provenance = 'person_declared'` keeps a future professional
-- observation of the same attribute from being read back as the person's own
-- answer.
set lock_timeout = '5s';
set statement_timeout = '60s';

-- Last drop this function needs. The shape it gains is additive from here on.
drop function if exists identity.read_current_onboarding(uuid);

create function identity.read_current_onboarding(p_account_id uuid)
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
           )
         )
  from identity.onboarding_attempts as attempt
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
  where attempt.account_id = p_account_id
    and attempt.status = 'open'
    and attempt.expires_at > clock_timestamp()
    and access_control.actor_kind() = 'account'
    and access_control.account() = p_account_id
$function$;

alter function identity.read_current_onboarding(uuid) owner to allfit_owner;
revoke all on function identity.read_current_onboarding(uuid) from public;
grant execute on function identity.read_current_onboarding(uuid) to allfit_api;
