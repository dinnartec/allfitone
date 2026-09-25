-- The emphasis: the first multi-valued profile attribute.
--
-- `HU-SP-097` asks for several body zones at once, and `OP-IDN-004` cannot write
-- that. It supersedes the live claim of the same attribute before inserting, which
-- is right for the training goal — only one goal can be the main one — and wrong
-- here: three zones would leave one live and two superseded. That was demonstrated
-- against this database before deciding anything.
--
-- The shape of the data does not change, and that is the point. The dictionary
-- already left the table without a "one per attribute" unique because claims
-- coexist, and `PRE_PHASE_5_DATABASE_MODIFICATIONS.md` §7.2 already planned
-- multivalue as "several claims coexisting", one per member. So the row **is** the
-- member of the set. An array or a `jsonb` column would have been the obvious
-- guess and the modelling standard forbids it: N:M is an explicit table, never an
-- array of values.
--
-- What changes is the command. `identity.declare_focus_areas` declares the **whole
-- set** in one transaction: it seals what left, inserts what arrived, and does not
-- touch what stayed. Leaving the survivors alone is not an optimisation — a zone
-- that is still chosen keeps its original `valid_from`, which is since when it
-- mattered to the person, and the partial unique index never sees two live rows of
-- the same member, not even for an instant.
--
-- The array is the **interface of the command, never storage**, exactly as
-- `identity.put_professional_profile` does with specialties: validate cardinality,
-- reject internal nulls, reject duplicates, check every member against the
-- catalogue, and only then write. Everything is validated before touching
-- idempotency, so an invalid set cannot burn the key and leave the correct retry
-- failing.
--
-- `whole_body` is a member of the catalogue rather than the absence of the data.
-- Without it, "I want no emphasis" and "I did not answer" would both be zero rows
-- and the resume read could not tell the step was answered. It is the same device
-- §7.2 uses with `multiple` for `HU-SP-013`, and it is exclusive with the zones in
-- the database as well as on the screen: an impossible state must not depend on
-- the client behaving.
--
-- Two departures from `OP-IDN-004`, both forced by writing more than one row:
--   * The claim id is no longer the device's Command-Id. One command writes several
--     rows, so each gets its own UUIDv7 and the durable receipt carries the command
--     identity — which is where it already lived.
--   * The receipt's aggregate is the person, not the row. So a replay answers the
--     **live set** rather than a snapshot of what that command wrote. The retry does
--     not duplicate, which is what the key is for, and the test fixes the nuance so
--     nobody discovers it by accident.
--
-- The partial unique index is scoped to `focus_areas` on purpose. Generalising it
-- to every attribute would break the goal: `OP-IDN-004` inserts before sealing, so
-- the new and the old row coexist for an instant with the same value, and
-- redeclaring the goal already in force would raise `23505` where it works today.
-- Generalising it means inverting that order, and that is a separate change to a
-- function already in use.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------- catalogue

-- Las siete zonas del criterio 1 de HU-SP-097, más la forma de decir «sin énfasis».
insert into identity.profile_attributes (code, name, data_classification_code, value_kind, allowed_values)
values (
  'focus_areas',
  'Zonas de énfasis',
  'training',
  'enum',
  array['chest', 'back', 'shoulders', 'arms', 'abs', 'glutes', 'legs', 'whole_body']
);

-- ---------------------------------------------------------------- shape of the set

-- En un atributo multivaluado la fila es el miembro, así que la misma zona dos
-- veces vigente es un estado corrupto y lo impide la base, no el comando.
create unique index uidx_fitness_profile_claims_live_focus_area
  on identity.fitness_profile_claims (person_id, value_text)
  where attribute_code = 'focus_areas'
    and valid_to is null
    and provenance = 'person_declared';

-- ---------------------------------------------------------------- projection

-- Sin `security definer` a propósito: llamada desde el comando corre como dueño y
-- ve todo, y llamada por el runtime la filtra la policy de la tabla.
create or replace function identity.current_focus_areas(p_person_id uuid)
returns text[]
language sql
stable
set search_path = pg_catalog
as $function$
  select coalesce(array_agg(claim.value_text order by claim.value_text), array[]::text[])
  from identity.fitness_profile_claims as claim
  where claim.person_id = p_person_id
    and claim.attribute_code = 'focus_areas'
    and claim.valid_to is null
    and claim.provenance = 'person_declared'
$function$;

alter function identity.current_focus_areas(uuid) owner to allfit_owner;
revoke all on function identity.current_focus_areas(uuid) from public;
grant execute on function identity.current_focus_areas(uuid) to allfit_api;

-- ---------------------------------------------------------------- command

create or replace function identity.declare_focus_areas(
  p_account_id uuid,
  p_areas text[],
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  areas text[],
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  attribute identity.profile_attributes%rowtype;
  subject_person_id uuid;
  requested text[];
  repeated boolean;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  select access_account.person_id into subject_person_id
  from identity.access_accounts as access_account
  where access_account.id = p_account_id;

  -- La persona es el sujeto de la afirmación. Sin ella no hay nada que afirmar.
  if subject_person_id is null then
    raise exception 'the account owns no person yet' using errcode = '42501';
  end if;

  select * into attribute
  from identity.profile_attributes
  where code = 'focus_areas';

  -- El conjunto vacío no es una respuesta: `whole_body` es cómo se dice «sin
  -- énfasis», y sin esa distinción «no contesté» sería indistinguible.
  if coalesce(cardinality(p_areas), 0) = 0
     or array_position(p_areas, null) is not null then
    raise exception 'the emphasis needs at least one area' using errcode = '23514';
  end if;

  select array_agg(area order by area), count(*) <> count(distinct area)
  into requested, repeated
  from unnest(p_areas) as incoming(area);

  if repeated then
    raise exception 'duplicate focus area' using errcode = '23514';
  end if;

  if not (requested operator(pg_catalog.<@) attribute.allowed_values) then
    raise exception 'value is not a member of the attribute catalogue' using errcode = '23514';
  end if;

  -- Todo el cuerpo significa «sin énfasis», así que no admite compañía.
  if 'whole_body' operator(pg_catalog.=) any (requested) and cardinality(requested) > 1 then
    raise exception 'whole body excludes every zone' using errcode = '23514';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-046',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    return query select identity.current_focus_areas(subject_person_id), true;
    return;
  end if;

  -- Declarar un conjunto se serializa por persona: dos comandos distintos a la vez
  -- no entrelazan sellos e inserciones, y gana el último, que es la semántica de
  -- declarar el conjunto entero.
  perform 1
  from identity.people as person
  where person.id = subject_person_id
  for no key update;

  -- Retirar una zona la cierra sin `superseded_by_id`: nada la reemplazó, y ese
  -- campo significa «fue reemplazada por esta otra», no «terminó».
  update identity.fitness_profile_claims as claim
  set valid_to = clock_timestamp()
  where claim.person_id = subject_person_id
    and claim.attribute_code = 'focus_areas'
    and claim.provenance = 'person_declared'
    and claim.valid_to is null
    and not (claim.value_text operator(pg_catalog.=) any (requested));

  -- La zona que sigue elegida no se reescribe: conserva su `valid_from`, que es
  -- desde cuándo le importa a la persona.
  insert into identity.fitness_profile_claims (
    id, person_id, attribute_code, value_text, provenance, captured_by_kind
  )
  select extensions.uuid_generate_v7(),
         subject_person_id,
         'focus_areas',
         incoming.area,
         'person_declared',
         'person'
  from unnest(requested) as incoming(area)
  where not exists (
    select 1
    from identity.fitness_profile_claims as live
    where live.person_id = subject_person_id
      and live.attribute_code = 'focus_areas'
      and live.provenance = 'person_declared'
      and live.valid_to is null
      and live.value_text = incoming.area
  );

  -- El agregado es la persona, no la fila: el comando ya no produce una sola.
  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'focus-areas-declared',
    'person',
    subject_person_id
  );

  return query select identity.current_focus_areas(subject_person_id), false;
end
$function$;

alter function identity.declare_focus_areas(uuid, text[], uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.declare_focus_areas(uuid, text[], uuid, uuid, bytea) from public;
grant execute on function identity.declare_focus_areas(uuid, text[], uuid, uuid, bytea) to allfit_api;

-- ---------------------------------------------------------------- resume read

-- Primer dividendo del refactor de `answers`: añadir un paso es `create or replace`
-- y no un drop, porque la firma no cambia.
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
           -- Multivaluado: el conjunto vigente entero, y responder es tener al
           -- menos un miembro. `whole_body` es uno de ellos.
           'focus_areas', jsonb_build_object(
             'answered', cardinality(focus.areas) > 0,
             'value', to_jsonb(focus.areas)
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
  where attempt.account_id = p_account_id
    and attempt.status = 'open'
    and attempt.expires_at > clock_timestamp()
    and access_control.actor_kind() = 'account'
    and access_control.account() = p_account_id
$function$;

alter function identity.read_current_onboarding(uuid) owner to allfit_owner;
revoke all on function identity.read_current_onboarding(uuid) from public;
grant execute on function identity.read_current_onboarding(uuid) to allfit_api;
