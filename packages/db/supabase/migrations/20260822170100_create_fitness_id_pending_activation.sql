-- The Fitness ID is created before it is active — HU-SP-098, OP-IDN-043.
--
-- A PERSON used to appear only at the end of the onboarding, which left every
-- answer given in between with nowhere to go: FITNESS_PROFILE_CLAIM requires a
-- person_id. Staging each answer and materialising it later would mean a second
-- write path towards the same rows, and "complete it later from my profile" would
-- be a third. Creating the person as soon as the name is known removes all of it:
-- each answer is written where it belongs the first time.
--
-- Activation stops being creation. It becomes the transition to 'active' plus the
-- activated_at stamp, and it moves no data.
--
-- Adult eligibility is still resolved before the row exists, which is what DT-012
-- and ADR-017 require. The row is created earlier; no control is.
--
-- Studio is untouched on purpose. Its completion route still passes the provider's
-- name to activate_person, which creates and activates in one call as before. What
-- is new is the middle branch: a person the account already owns in
-- pending_activation is transitioned rather than created. Space uses that path.
--
-- identity.usernames goes away with the same reasoning that created it. A separate
-- relation was justified while uniqueness had to span handles reserved by attempts
-- with no person; with the person present from the first step that population
-- cannot exist, so people.username with a partial unique index is enough and one
-- source of truth cannot race with itself.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- The handle lands on the person it belongs to.
alter table identity.people add column username extensions.citext;

-- Cast to text on purpose: citext would make the pattern case-insensitive and stop
-- it from proving that what we store is lowercased.
alter table identity.people
  add constraint ck_people_username_format check (username is null or username::text ~ '^[a-z][a-z0-9_]{2,29}$');

create unique index uidx_people_username on identity.people (username) where username is not null;

-- The stamp is the record of the transition, so it cannot exist before it happens.
-- The default stays: a pending row passes an explicit null, and the pairing below
-- catches anything that forgets to. Dropping it would only force every existing
-- fixture to set the stamp by hand for no added safety.
alter table identity.people alter column activated_at drop not null;

alter table identity.people
  add constraint ck_people_activation_state check (
    (status = 'pending_activation' and activated_at is null)
    or (status <> 'pending_activation' and activated_at is not null)
  );

-- Order matters: the function reads the table, and the table points at attempts.
drop function if exists identity.record_onboarding_identity(uuid, uuid, text, text, text, uuid, uuid, bytea);
drop table if exists identity.usernames;

alter table identity.onboarding_attempts
  drop column if exists given_name,
  drop column if exists family_name,
  drop column if exists username;

create or replace function identity.create_pending_person(
  p_account_id uuid,
  p_attempt_id uuid,
  p_given_name text,
  p_family_name text,
  p_username text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (person_id uuid, given_name text, family_name text, username text)
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
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;
  if btrim(p_given_name) = '' or btrim(p_family_name) = '' then
    raise exception 'given name and family name are required' using errcode = '22023';
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

    insert into identity.people (given_name, family_name, username, status, activated_at)
    values (
      btrim(p_given_name),
      btrim(p_family_name),
      lower(btrim(p_username))::extensions.citext,
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

  return query select created.id, created.given_name, created.family_name, created.username::text;
end
$function$;

-- Replaced to activate instead of only creating. The signature is unchanged, so
-- Studio keeps working: it still arrives with no person and takes the first branch.
create or replace function identity.activate_person(
  p_account_id uuid,
  p_attempt_id uuid,
  p_given_name text,
  p_family_name text,
  p_terms_accepted boolean,
  p_privacy_notice_accepted boolean,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  account_person_id uuid;
  person_status identity.person_status;
  attempt identity.onboarding_attempts%rowtype;
  result_person_id uuid;
  eligibility identity.eligibility_result;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;
  if not p_terms_accepted or not p_privacy_notice_accepted then
    raise exception 'legal acceptances are required' using errcode = '23514';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_account_id,
    'OP-IDN-003',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    return receipt.aggregate_id;
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

  if account_person_id is not null then
    if attempt.person_id is not null and attempt.person_id <> account_person_id then
      raise exception 'access account is linked to a different person' using errcode = '23514';
    end if;

    select people.status into person_status
    from identity.people as people
    where people.id = account_person_id
    for update;

    result_person_id := account_person_id;

    -- Already active: idempotent, and activated_at is never re-stamped.
    if person_status = 'pending_activation' then
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

      update identity.people
      set status = 'active',
          activated_at = clock_timestamp()
      where id = result_person_id;

      update identity.onboarding_attempts
      set status = 'activated',
          terms_version = 'platform_terms_v1',
          terms_accepted_at = clock_timestamp(),
          privacy_notice_version = 'privacy_notice_v1',
          privacy_notice_accepted_at = clock_timestamp()
      where id = p_attempt_id;
    end if;
  else
    -- Studio: the provider brought the name and there is no person yet, so this
    -- call both creates and activates, exactly as it did before.
    if btrim(p_given_name) = '' or btrim(p_family_name) = '' then
      raise exception 'given name and family name are required' using errcode = '22023';
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

    insert into identity.people (given_name, family_name, status, activated_at)
    values (btrim(p_given_name), btrim(p_family_name), 'active', clock_timestamp())
    returning id into result_person_id;

    update identity.access_accounts
    set person_id = result_person_id
    where id = p_account_id
      and person_id is null;

    if not found then
      raise exception 'access account was linked concurrently' using errcode = '40001';
    end if;

    update identity.onboarding_attempts
    set person_id = result_person_id,
        status = 'activated',
        terms_version = 'platform_terms_v1',
        terms_accepted_at = clock_timestamp(),
        privacy_notice_version = 'privacy_notice_v1',
        privacy_notice_accepted_at = clock_timestamp()
    where id = p_attempt_id;
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'person-activated',
    'person',
    result_person_id
  );
  return result_person_id;
end
$function$;

-- Reading the onboarding needs a governed function, not a join.
--
-- During the onboarding the actor is an account, and the only SELECT policy on
-- `people` is `access_control.is_self(id)`, which compares against
-- `app.actor_person_id`. That is unset for an account actor, so a plain join
-- returned no row and the API silently concluded the Fitness ID did not exist —
-- and would have offered to create a second one. Caught by running it against a
-- real database; no stubbed test could have seen it.
--
-- Same shape as `load_access_session`, which already reads `person.status` for an
-- account: the account-scoped read is a SECURITY DEFINER function that returns
-- only that account's own rows.
create or replace function identity.read_current_onboarding(p_account_id uuid)
returns table (
  attempt_id uuid,
  status text,
  eligibility_status text,
  expires_at timestamptz,
  given_name text,
  family_name text,
  username text
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
         person.username::text
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

alter function identity.create_pending_person(uuid, uuid, text, text, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.create_pending_person(uuid, uuid, text, text, text, uuid, uuid, bytea) from public;
grant execute on function identity.create_pending_person(uuid, uuid, text, text, text, uuid, uuid, bytea) to allfit_api;
