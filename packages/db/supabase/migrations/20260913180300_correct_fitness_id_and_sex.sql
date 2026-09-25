-- Onboarding answers become correctable, except the one that cannot be.
--
-- Both commands refused a second write. `create_pending_person` raised 23514 once
-- the account owned a person, and `declare_biological_sex` raised 23505 on a
-- different value. That was right while the onboarding only moved forward: a second
-- write could only be a client out of the flow. It is wrong now that a person can
-- go back and change what they answered, which is what the screens offer.
--
-- **The adult declaration stays final, and it is the only one.** It is credentialed
-- evidence that gated the creation of the person; retracting it would leave a
-- Fitness ID standing on a declaration that no longer does. Nothing here touches
-- `record_adult_eligibility`.
--
-- What a correction is not: a second person. The account still owns exactly one,
-- and the handle is still unique across everybody — taking one somebody else holds
-- is 23505 from `uidx_people_username`, which is the same conflict the create path
-- always returned and the same message the screen already shows.
--
-- `create_pending_person` is renamed to `declare_fitness_id`. The old name said
-- "create" and the function no longer only creates; a name that lies about what a
-- function does is worse than the churn of renaming it.
--
-- Declining after having declared clears the value. It is a change of answer like
-- any other, and the mark on the attempt stays: the question was answered either
-- way, which is what keeps the flow from asking again.

set lock_timeout = '5s';
set statement_timeout = '60s';

drop function if exists identity.create_pending_person(uuid, uuid, text, text, text, text, boolean, uuid, uuid, bytea);

create or replace function identity.declare_fitness_id(
  p_account_id uuid,
  p_attempt_id uuid,
  p_given_name text,
  p_family_name text,
  p_username text,
  p_contact_email text,
  p_contact_email_verified boolean,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  person_id uuid,
  given_name text,
  family_name text,
  username text,
  contact_email text,
  contact_email_verified boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  attempt identity.onboarding_attempts%rowtype;
  account_person_id uuid;
  written identity.people%rowtype;
  eligibility identity.eligibility_result;
  normalized_email extensions.citext;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;
  if btrim(p_given_name) = '' or btrim(p_family_name) = '' then
    raise exception 'given name and family name are required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_contact_email, '')) = '' then
    raise exception 'contact email is required' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-043',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    select * into written from identity.people where id = receipt.aggregate_id;
    return query select written.id, written.given_name, written.family_name,
                        written.username::text, written.contact_email::text,
                        written.contact_email_verified_at is not null;
    return;
  end if;

  select access_account.person_id into account_person_id
  from identity.access_accounts as access_account
  where access_account.id = p_account_id
  for update;

  if not found then
    raise exception 'access account does not exist' using errcode = '42501';
  end if;

  select * into attempt
  from identity.onboarding_attempts
  where id = p_attempt_id
    and account_id = p_account_id
  for update;

  if attempt.id is null then
    raise exception 'onboarding attempt is not owned by the account' using errcode = '42501';
  end if;
  if attempt.status <> 'open' or attempt.expires_at <= clock_timestamp() then
    raise exception 'onboarding attempt is not open' using errcode = '23514';
  end if;

  -- DT-012 and ADR-017: no person exists before adulthood is credentialed, and a
  -- correction does not get to skip the check either.
  select evidence.result into eligibility
  from identity.eligibility_evidence as evidence
  where evidence.onboarding_attempt_id = p_attempt_id
  order by evidence.evaluated_at desc, evidence.id desc
  limit 1;

  if eligibility is distinct from 'pass' then
    raise exception 'adult eligibility is required' using errcode = '23514';
  end if;

  normalized_email := lower(btrim(p_contact_email))::extensions.citext;

  if account_person_id is null then
    insert into identity.people (
      given_name, family_name, username, contact_email, contact_email_verified_at, status, activated_at
    ) values (
      btrim(p_given_name),
      btrim(p_family_name),
      lower(btrim(p_username))::extensions.citext,
      normalized_email,
      case when p_contact_email_verified then clock_timestamp() else null end,
      'pending_activation',
      null
    )
    returning * into written;

    update identity.access_accounts as account
    set person_id = written.id
    where account.id = p_account_id
      and account.person_id is null;

    if not found then
      raise exception 'access account was linked concurrently' using errcode = '40001';
    end if;

    -- The attempt stays open: the Fitness ID exists, it is not active yet.
    update identity.onboarding_attempts
    set person_id = written.id
    where id = p_attempt_id;
  else
    -- A correction. The contact is deliberately not rewritten here: it belongs to
    -- the credential and changing it is OP-IDN-021, with its own verification.
    update identity.people as person
    set given_name = btrim(p_given_name),
        family_name = btrim(p_family_name),
        username = lower(btrim(p_username))::extensions.citext
    where person.id = account_person_id
    returning * into written;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'fitness-id-declared',
    'person',
    written.id
  );

  return query select
    written.id,
    written.given_name,
    written.family_name,
    written.username::text,
    written.contact_email::text,
    written.contact_email_verified_at is not null;
end
$function$;

alter function identity.declare_fitness_id(uuid, uuid, text, text, text, text, boolean, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.declare_fitness_id(uuid, uuid, text, text, text, text, boolean, uuid, uuid, bytea) from public;
grant execute on function identity.declare_fitness_id(uuid, uuid, text, text, text, text, boolean, uuid, uuid, bytea) to allfit_api;

-- ---------------------------------------------------------------- biological sex

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
  eligibility identity.eligibility_result;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;

  -- Null es la negativa, y es válida. Cualquier otra cosa fuera del tipo no lo es.
  if p_value is not null and not (p_value = any (enum_range(null::identity.biological_sex)::text[])) then
    raise exception 'biological sex is not a member of the enum' using errcode = '22023';
  end if;

  select access_account.person_id into person_id
  from identity.access_accounts as access_account
  where access_account.id = p_account_id;

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
    return query
      select person.biological_sex::text, true
      from identity.people as person
      where person.id = person_id;
    return;
  end if;

  -- A correction, not a conflict. Declining after having declared clears the value,
  -- which is a change of answer like any other; the mark below stays either way.
  update identity.people as person
  set biological_sex = case when p_value is null then null else p_value::identity.biological_sex end
  where person.id = person_id;

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
