-- The person's training profile, read as itself.
--
-- The answers that decide which programs fit somebody — their goal, how much they
-- have trained, their sex and the zones they named — were only reachable through
-- `identity.read_current_onboarding`. That reader answers "where does the onboarding
-- resume", and using it to power a screen that runs long after the onboarding ended
-- would mean the Today screen breaks the day the resume question changes.
--
-- Same claims, same rule about which one is in force — the current claim, never a
-- superseded one — under a name that says what it is.

begin;

create function identity.read_training_profile(p_person_id uuid)
returns table (
  given_name text,
  primary_training_goal text,
  training_experience text,
  biological_sex text,
  focus_areas text[]
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select person.given_name,
         goal.value_text,
         experience.value_text,
         person.biological_sex::text,
         coalesce(focus.areas, array[]::text[])
  from identity.people as person
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
    select claim.value_text
    from identity.fitness_profile_claims as claim
    where claim.person_id = person.id
      and claim.attribute_code = 'training_experience'
      and claim.valid_to is null
      and claim.provenance = 'person_declared'
    order by claim.valid_from desc, claim.id desc
    limit 1
  ) as experience on true
  left join lateral (
    select identity.current_focus_areas(person.id) as areas
  ) as focus on true
  where person.id = p_person_id
    and access_control.actor_kind() = 'person'
    and access_control.person() = p_person_id
$function$;

alter function identity.read_training_profile(uuid) owner to allfit_owner;
revoke all on function identity.read_training_profile(uuid) from public;
grant execute on function identity.read_training_profile(uuid) to allfit_api;

commit;
