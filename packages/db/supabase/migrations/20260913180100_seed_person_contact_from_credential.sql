-- The person's contact email is the credential's address — DT-016.
--
-- `create_pending_person` left contact_email and contact_email_verified_at null,
-- so a Fitness ID existed with no way to reach the person. DT-016 is explicit that
-- the contact email and the sign-in email are the same datum, and OP-SYS-002
-- filters every notification on "verified contact", which nothing could satisfy.
--
-- The address is a parameter because it is the **provider's** fact, not the
-- client's: the API fetches it by subject and passes it through. A client-supplied
-- address must never be recorded as verified, which is why the verification flag
-- is separate and only ever set from what the provider confirmed.
--
-- The signature changes, so the previous function is dropped rather than replaced.

set lock_timeout = '5s';
set statement_timeout = '60s';

drop function if exists identity.create_pending_person(uuid, uuid, text, text, text, uuid, uuid, bytea);

create or replace function identity.create_pending_person(
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
  created identity.people%rowtype;
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
    select * into created from identity.people where id = receipt.aggregate_id;
  else
    select access_account.person_id into account_person_id
    from identity.access_accounts as access_account
    where access_account.id = p_account_id
    for update;

    if not found then
      raise exception 'access account does not exist' using errcode = '42501';
    end if;
    if account_person_id is not null then
      raise exception 'access account already owns a person' using errcode = '23514';
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

    -- DT-012 and ADR-017: no person exists before adulthood is credentialed.
    select evidence.result into eligibility
    from identity.eligibility_evidence as evidence
    where evidence.onboarding_attempt_id = p_attempt_id
    order by evidence.evaluated_at desc, evidence.id desc
    limit 1;

    if eligibility is distinct from 'pass' then
      raise exception 'adult eligibility is required' using errcode = '23514';
    end if;

    normalized_email := lower(btrim(p_contact_email))::extensions.citext;

    -- The stamp is only set from what the provider confirmed. An unverified
    -- contact receives no notifications, which is the point of keeping it null.
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
    returning * into created;

    update identity.access_accounts as account
    set person_id = created.id
    where account.id = p_account_id
      and account.person_id is null;

    if not found then
      raise exception 'access account was linked concurrently' using errcode = '40001';
    end if;

    -- The attempt stays open: the Fitness ID exists, it is not active yet.
    update identity.onboarding_attempts
    set person_id = created.id
    where id = p_attempt_id;

    perform system.finish_idempotency(
      receipt.receipt_id,
      200::smallint,
      'pending-person-created',
      'person',
      created.id
    );
  end if;

  return query select
    created.id,
    created.given_name,
    created.family_name,
    created.username::text,
    created.contact_email::text,
    created.contact_email_verified_at is not null;
end
$function$;

alter function identity.create_pending_person(uuid, uuid, text, text, text, text, boolean, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.create_pending_person(uuid, uuid, text, text, text, text, boolean, uuid, uuid, bytea) from public;
grant execute on function identity.create_pending_person(uuid, uuid, text, text, text, text, boolean, uuid, uuid, bytea) to allfit_api;
