-- The training experience: a member of the catalogue, not a migration of structure.
--
-- `HU-SP-012` criterion 2 asks how much experience someone has, in simple terms. A
-- single global level is one value, which is exactly what
-- `identity.declare_profile_claim` already writes, so nothing about the shape has to
-- change — this is the case the attribute catalogue was built for, and adding the
-- member is an `insert`. `OP-IDN-004` keeps failing closed on an unknown attribute,
-- and that is what makes growing the catalogue by data safe.
--
-- Three values and no fourth. Not `beginner`, `intermediate`, `advanced`: the story
-- asks for simple terms and the reason is behavioural rather than stylistic —
-- "advanced" makes people underrate themselves, pick below their real level, and get
-- a plan that bores them. The order is communicated by the screen, which draws one,
-- two or three bars; the vocabulary carries no rank of its own.
--
-- **A global level, not one per discipline.** The criterion read "in each one", and
-- that was amended on 24 August 2026 because it is not buildable: `catalog.disciplines`
-- holds only synthetic `test_*` rows from `seed.sql` — which states that production
-- does not load it and requires approved curation — and its single policy is
-- `to allfit_owner` with no grant for the runtime role, so Space cannot read the list
-- at all. There is nothing to hang a per-discipline level on. If that catalogue ever
-- becomes readable, a per-discipline level is a **new** attribute — a member carrying
-- its own value, which is a shape neither this nor `focus_areas` provides — and not a
-- widening of this one.
--
-- Requalifying does not edit. Declaring again seals the previous claim and stamps
-- `superseded_by_id`, so the level someone signed up with stays readable and the fact
-- that they moved is on the record. That behaviour is already in the function and is
-- not reimplemented here.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Los tres términos simples del criterio 2 de HU-SP-012, de menos a más.
insert into identity.profile_attributes (code, name, data_classification_code, value_kind, allowed_values)
values (
  'training_experience',
  'Experiencia de entrenamiento',
  'training',
  'enum',
  array['starting', 'some_practice', 'experienced']
);

-- ---------------------------------------------------------------- resume read

-- Un paso más en el mismo objeto. Sin drop y sin 42P13: la firma no cambia.
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
  left join lateral (
    select identity.current_focus_areas(person.id) as areas
  ) as focus on true
  -- Solo la vigente. `valid_to is null` es lo que la hace actual, y la procedencia
  -- impide leer la observación de un profesional como respuesta de la persona.
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
  where attempt.account_id = p_account_id
    and attempt.status = 'open'
    and attempt.expires_at > clock_timestamp()
    and access_control.actor_kind() = 'account'
    and access_control.account() = p_account_id
$function$;

alter function identity.read_current_onboarding(uuid) owner to allfit_owner;
revoke all on function identity.read_current_onboarding(uuid) from public;
grant execute on function identity.read_current_onboarding(uuid) to allfit_api;
