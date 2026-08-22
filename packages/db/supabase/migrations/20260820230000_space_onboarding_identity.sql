-- Space onboarding identity — HU-SP-098, OP-IDN-043.
--
-- Activating a Fitness ID requires a given name and a family name, and in Space
-- there is nowhere for them to come from: the login is headless, so the identity
-- provider only ever knew an email and a password. They are declared during the
-- onboarding, which means they have to rest somewhere before a PERSON exists.
--
-- That somewhere is the attempt. Space makes activation the last step, so every
-- answer collected before it belongs to the ONBOARDING_ATTEMPT and OP-IDN-003
-- reads them from there. Studio keeps passing the provider's name and leaves
-- these columns null; the operation stays one operation on both surfaces, and
-- what differs is where the name came from.
--
-- The handle needs its own relation. Uniqueness has to cover both activated
-- people and attempts that have reserved a handle but never activated, and two
-- unique indexes over two tables cannot do that without racing. One primary key
-- over one column can, and activation moves the row from the attempt to the
-- person inside the transaction that creates it.
--
-- There is deliberately no way to ask whether a handle is free. "Already in use"
-- reveals that somebody exists, which is the guarantee that shaped the whole
-- registration flow. What makes a collision tolerable here is that a handle is
-- not an identifier that exists outside the platform, the way an email address
-- is — so it does not confirm that a particular known person has an account. It
-- is still only ever learned by attempting a write, under an authenticated
-- command, and the rate limit that this endpoint needs does not exist yet.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table identity.onboarding_attempts
  add column given_name text,
  add column family_name text,
  add column username extensions.citext;

alter table identity.onboarding_attempts
  add constraint ck_onboarding_attempts_given_name check (given_name is null or btrim(given_name) <> ''),
  add constraint ck_onboarding_attempts_family_name check (family_name is null or btrim(family_name) <> '');

create table identity.usernames (
  username extensions.citext not null,
  person_id uuid,
  onboarding_attempt_id uuid,
  reserved_at timestamptz not null default clock_timestamp(),
  constraint pk_usernames primary key (username),
  constraint fk_usernames_person foreign key (person_id) references identity.people(id) on delete restrict,
  -- Cascade on purpose: purging an abandoned attempt frees its handle.
  constraint fk_usernames_onboarding_attempt foreign key (onboarding_attempt_id) references identity.onboarding_attempts(id) on delete cascade,
  -- A handle belongs to a person or to an attempt, never to both and never to
  -- neither: activation moves ownership, it does not add a second owner.
  constraint ck_usernames_owner check (num_nonnulls(person_id, onboarding_attempt_id) = 1),
  -- Cast to text on purpose: citext would make the pattern case-insensitive and
  -- stop it from proving that what we store is lowercased.
  constraint ck_usernames_format check (username::text ~ '^[a-z][a-z0-9_]{2,29}$')
);

create unique index uidx_usernames_person on identity.usernames (person_id)
  where person_id is not null;
create unique index uidx_usernames_onboarding_attempt on identity.usernames (onboarding_attempt_id)
  where onboarding_attempt_id is not null;

alter table identity.usernames owner to allfit_owner;

alter table identity.usernames enable row level security;
alter table identity.usernames force row level security;

create policy usernames_all_owner on identity.usernames
  for all to allfit_owner using (true) with check (true);
-- No condition here lets an actor read somebody else's row, and that absence is
-- what stops the table from becoming a handle directory.
create policy usernames_select_own on identity.usernames
  for select to allfit_api using (
    access_control.is_self(person_id)
    or exists (
      select 1
      from identity.onboarding_attempts as attempt
      where attempt.id = identity.usernames.onboarding_attempt_id
        and attempt.account_id = access_control.account()
    )
  );

-- Read only, and even that is narrowed by policy. Reserving and moving a handle
-- go through SECURITY DEFINER functions, so uniqueness and the transfer of
-- ownership rest on privileges rather than on discipline.
revoke all on identity.usernames from public, allfit_api;
grant select on identity.usernames to allfit_api;

create or replace function identity.record_onboarding_identity(
  p_account_id uuid,
  p_attempt_id uuid,
  p_given_name text,
  p_family_name text,
  p_username text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (given_name text, family_name text, username text)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  attempt identity.onboarding_attempts%rowtype;
  normalized_username extensions.citext;
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
    select * into attempt
    from identity.onboarding_attempts as onboarding_attempt
    where onboarding_attempt.id = receipt.aggregate_id;
  else
    select * into attempt
    from identity.onboarding_attempts as onboarding_attempt
    where onboarding_attempt.id = p_attempt_id
      and onboarding_attempt.account_id = p_account_id
    for update;

    if attempt.id is null then
      raise exception 'onboarding attempt is not owned by the account' using errcode = '42501';
    end if;
    if attempt.status <> 'open' or attempt.expires_at <= clock_timestamp() then
      raise exception 'onboarding attempt is not open' using errcode = '23514';
    end if;

    normalized_username := lower(btrim(p_username))::extensions.citext;

    -- Correcting the handle has to release the previous one. Without the delete
    -- somebody could hoard handles by retyping the field.
    delete from identity.usernames
    where onboarding_attempt_id = p_attempt_id;

    insert into identity.usernames (username, onboarding_attempt_id)
    values (normalized_username, p_attempt_id);

    update identity.onboarding_attempts
    set given_name = btrim(p_given_name),
        family_name = btrim(p_family_name),
        username = normalized_username
    where id = p_attempt_id
    returning * into attempt;

    perform system.finish_idempotency(
      receipt.receipt_id,
      200::smallint,
      'onboarding-identity-declared',
      'onboarding_attempt',
      attempt.id
    );
  end if;

  return query select attempt.given_name, attempt.family_name, attempt.username::text;
end
$function$;

-- Replaced to carry the handle across. Everything else is unchanged, and Studio
-- keeps working because an attempt with no reservation makes the move a no-op.
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
  attempt identity.onboarding_attempts%rowtype;
  result_person_id uuid;
  eligibility identity.eligibility_result;
begin
  if access_control.actor_kind() <> 'account' or access_control.account() <> p_account_id then
    raise exception 'onboarding account does not match the authenticated actor' using errcode = '42501';
  end if;
  if btrim(p_given_name) = '' or btrim(p_family_name) = '' then
    raise exception 'given name and family name are required' using errcode = '22023';
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

  select person_id into account_person_id
  from identity.access_accounts
  where id = p_account_id
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
    result_person_id := account_person_id;
  else
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

    insert into identity.people (given_name, family_name)
    values (btrim(p_given_name), btrim(p_family_name))
    returning id into result_person_id;

    update identity.access_accounts
    set person_id = result_person_id
    where id = p_account_id
      and person_id is null;

    if not found then
      raise exception 'access account was linked concurrently' using errcode = '40001';
    end if;

    -- Ownership moves; it is never duplicated. The handle is not free for an
    -- instant, because this is the same transaction that creates the person.
    update identity.usernames
    set person_id = result_person_id,
        onboarding_attempt_id = null
    where onboarding_attempt_id = p_attempt_id;

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

alter function identity.record_onboarding_identity(uuid, uuid, text, text, text, uuid, uuid, bytea) owner to allfit_owner;
revoke all on function identity.record_onboarding_identity(uuid, uuid, text, text, text, uuid, uuid, bytea) from public;
grant execute on function identity.record_onboarding_identity(uuid, uuid, text, text, text, uuid, uuid, bytea) to allfit_api;
