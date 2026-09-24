-- Biological sex on the person, not as a profile claim.
--
-- `HU-SP-096` needed somewhere to put this and nothing existed:
-- `identity.fitness_profile_claims`, `identity.profile_attributes` and
-- `privacy.data_classifications` are specified in the data dictionary but were never
-- built. Rather than build that whole slice for one datum, this lives on `people`.
--
-- The reasoning, recorded because the dictionary used to point the other way: the
-- claims catalogue exists for data that **changes** and that several sources
-- **observe** — weight, measurements, health context, each with its own provenance,
-- validity window and `superseded_by_id`. Biological sex is a single stable fact with
-- one possible source: the person. All that machinery would sit unused.
--
-- Nullable on purpose. Declining is an answer and it leaves no value: an `unknown`
-- label would force every later reader to tell "declined" apart from "never asked",
-- and no profile reader needs that.
--
-- But the onboarding does need it, or the screen that skips itself once answered
-- would ask a decliner again on every cold start and the flow could never advance.
-- So the refusal is recorded where progress belongs — on the attempt, as
-- `biological_sex_answered_at` — and never on the person. The person holds facts,
-- the attempt holds how far the person got. Declining therefore calls the same
-- operation with a null value: one route, one round trip, and no sentinel.
--
-- What this does not do: make it visible to the gym. `identity.people` has exactly
-- one read policy today, `is_self`, so no professional can read any of it. Criterion 5
-- of `HU-SP-096` needs a client projection that does not exist yet — the same shape
-- as `organizations.list_organization_memberships`, which is `security definer` and
-- projects one column. That is a separate change and it is not written here.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type identity.biological_sex as enum ('male', 'female');
alter type identity.biological_sex owner to allfit_owner;

alter table identity.people add column biological_sex identity.biological_sex;

-- Progreso, no perfil: distingue «respondió, y fue no decirlo» de «no se preguntó».
alter table identity.onboarding_attempts add column biological_sex_answered_at timestamptz;

create or replace function identity.declare_biological_sex(
  p_account_id uuid,
  p_attempt_id uuid,
  p_value text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (biological_sex text, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  attempt identity.onboarding_attempts%rowtype;
  person_id uuid;
  declared identity.biological_sex;
  eligibility identity.eligibility_result;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  -- Null es la negativa, y es válida. Cualquier otra cosa fuera del tipo no lo es.
  -- El conjunto de valores se deriva del tipo: una sola fuente de verdad.
  if p_value is not null and not (p_value = any (enum_range(null::identity.biological_sex)::text[])) then
    raise exception 'biological sex is not a member of the enum' using errcode = '22023';
  end if;

  select access_account.person_id into person_id
  from identity.access_accounts as access_account
  where access_account.id = p_account_id;

  -- La persona ya existe en `pending_activation` desde OP-IDN-043. Sin ella no hay
  -- sujeto de la afirmación, y nadie declara el sexo de otra.
  if person_id is null then
    raise exception 'the account owns no person yet' using errcode = '42501';
  end if;

  select * into attempt
  from identity.onboarding_attempts
  where id = p_attempt_id
    and account_id = p_account_id;

  if attempt.id is null then
    raise exception 'onboarding attempt is not owned by the account' using errcode = '42501';
  end if;
  if attempt.status <> 'open' or attempt.expires_at <= clock_timestamp() then
    raise exception 'onboarding attempt is not open' using errcode = '23514';
  end if;

  select evidence.result into eligibility
  from identity.eligibility_evidence as evidence
  where evidence.onboarding_attempt_id = p_attempt_id
  order by evidence.evaluated_at desc, evidence.id desc
  limit 1;

  if eligibility is distinct from 'pass' then
    raise exception 'adult eligibility is required' using errcode = '23514';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-045',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    select person.biological_sex into declared
    from identity.people as person
    where person.id = person_id;
    return query select declared::text, true;
    return;
  end if;

  select person.biological_sex into declared
  from identity.people as person
  where person.id = person_id
  for update;

  -- La pantalla se salta cuando ya hay valor, así que otro valor solo puede venir de
  -- un cliente fuera de flujo. Corregirlo será una operación de perfil. Declinar
  -- después de haber declarado tampoco borra: eso sería una corrección disfrazada.
  if declared is not null and (p_value is null or declared::text <> p_value) then
    raise exception 'biological sex was already declared' using errcode = '23505';
  end if;

  if p_value is not null then
    update identity.people as person
    set biological_sex = p_value::identity.biological_sex
    where person.id = person_id;
  end if;

  -- El sello va siempre, también al declinar: es lo que deja avanzar el onboarding.
  update identity.onboarding_attempts
  set biological_sex_answered_at = clock_timestamp()
  where id = p_attempt_id;

  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'biological-sex-declared',
    'person',
    person_id
  );

  return query select p_value, false;
end
$function$;

alter function identity.declare_biological_sex(uuid, uuid, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.declare_biological_sex(uuid, uuid, text, uuid, uuid, bytea) from public;
grant execute on function identity.declare_biological_sex(uuid, uuid, text, uuid, uuid, bytea) to allfit_api;

-- La lectura de reanudación tiene que traerlo: la pantalla se salta cuando ya hay
-- valor, y sin este campo no habría forma de saberlo sin volver a preguntar.
--
-- Se borra y se recrea, no se reemplaza: añadir una columna al RETURNS TABLE cuenta
-- como cambiar el tipo de retorno, y `create or replace` lo rechaza con 42P13.
drop function if exists identity.read_current_onboarding(uuid);

create function identity.read_current_onboarding(p_account_id uuid)
returns table (
  attempt_id uuid,
  status text,
  eligibility_status text,
  expires_at timestamptz,
  given_name text,
  family_name text,
  username text,
  biological_sex text,
  biological_sex_answered boolean
)
language sql
security definer
set search_path = pg_catalog
as $function$
  select attempt.id,
         attempt.status::text,
         coalesce(evidence.result::text, 'pending'),
         attempt.expires_at,
         person.given_name,
         person.family_name,
         person.username::text,
         person.biological_sex::text,
         attempt.biological_sex_answered_at is not null
  from identity.onboarding_attempts as attempt
  left join identity.people as person on person.id = attempt.person_id
  left join lateral (
    select evidence.result
    from identity.eligibility_evidence as evidence
    where evidence.onboarding_attempt_id = attempt.id
    order by evidence.evaluated_at desc, evidence.id desc
    limit 1
  ) as evidence on true
  where attempt.account_id = p_account_id
    and attempt.status = 'open'
    and attempt.expires_at > clock_timestamp()
    and access_control.actor_kind() = 'account'
    and access_control.account() = p_account_id
$function$;

alter function identity.read_current_onboarding(uuid) owner to allfit_owner;
revoke all on function identity.read_current_onboarding(uuid) from public;
grant execute on function identity.read_current_onboarding(uuid) to allfit_api;
