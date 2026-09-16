-- OP-IDN-011 + NEW-IDN-VERIFY-REQUEST — verifying a professional credential.
--
-- `HU-BO-021`. A verification is what lets a declared credential count, and for
-- nutrition it is the predicate ADR-027 depends on. So the shape here is mostly
-- about what must never become `verified`.
--
-- **The queue fills itself.** Declaring a credential opens a pending request for
-- that exact version, and retiring one withdraws its pending request. A revision
-- is a new version plus the retirement of the old one, so criterion 7 — a revised
-- credential gets a review of its own and the earlier verification stays intact —
-- falls out of the same two triggers instead of being a third rule. Nobody has to
-- remember to ask, and nobody has to remember to cancel.
--
-- **The request carries no outcome.** PRE_PHASE_5 §6.2 sketched the request with
-- `verified`, `rejected` and `unverifiable` among its statuses. That would store
-- the result twice, once here and once on the verification, and two copies drift.
-- A request is `pending`, `resolved` or `cancelled`; what was decided lives only on
-- the verification row, which now points back at the request it resolved.
--
-- **Nothing is verified by omission.** There is no default result. The policy is
-- derived from the method rather than accepted, and the validity is derived from
-- the decision time, the source's own expiry and the credential's expiry rather
-- than accepted — so it cannot exceed twelve months, and a source that says the
-- credential has lapsed cannot produce `verified` at all.
--
-- **Conflicts are checked against the data.** ADR-026 §2.4 lists five. The subject
-- and a shared active membership are checked here. Having declared or revised the
-- credential is the same person as the subject in V1, because only the holder can
-- declare. A professional relationship cannot be checked because `relationships`
-- does not exist — which also means no such relationship can exist yet — and
-- appeals are not built. When either lands, its check belongs in
-- `credential_verification_conflict`.
--
-- **Reading the queue is an access.** It shows the holder's name, the registry
-- number and where to look it up, which is exactly what a verifier needs and
-- exactly what a person may later ask about. Every row read writes an access record
-- against the holder before it is returned.
--
-- One invented number, stated so it can be argued with: a verified credential
-- enters the renewal list thirty days before its validity ends. No normative
-- source fixes that window.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

create table identity.credential_verification_requests (
  id uuid not null default extensions.uuid_generate_v7(),
  professional_credential_id uuid not null,
  requested_by_person_id uuid not null,
  kind text not null default 'initial',
  status text not null default 'pending',
  supersedes_request_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  cancelled_at timestamptz,
  constraint pk_credential_verification_requests primary key (id),
  -- The carrier key a decision references, so a verification cannot resolve a
  -- request that belongs to a different credential.
  constraint uq_credential_verification_requests_carrier unique (id, professional_credential_id),
  constraint fk_credential_verification_requests_credential foreign key (professional_credential_id) references identity.professional_credentials (id) on delete restrict,
  constraint fk_credential_verification_requests_requester foreign key (requested_by_person_id) references identity.people (id) on delete restrict,
  constraint fk_credential_verification_requests_supersedes foreign key (supersedes_request_id) references identity.credential_verification_requests (id) on delete restrict,
  constraint ck_credential_verification_requests_kind check (kind in ('initial', 'renewal')),
  constraint ck_credential_verification_requests_status check (
    (status = 'pending' and resolved_at is null and cancelled_at is null)
    or (status = 'resolved' and resolved_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and resolved_at is null)
  ),
  constraint ck_credential_verification_requests_not_self_superseding check (
    supersedes_request_id is null or supersedes_request_id <> id
  )
);

-- One review in progress per exact version (§6.3). Also what makes two verifiers
-- opening the same renewal at once produce one request rather than two.
create unique index uidx_credential_verification_requests_pending
  on identity.credential_verification_requests (professional_credential_id)
  where status = 'pending';
create index idx_credential_verification_requests_queue
  on identity.credential_verification_requests (status, created_at, id);

alter table identity.professional_credential_verifications
  add column request_id uuid,
  add constraint fk_professional_credential_verifications_request foreign key (request_id, professional_credential_id) references identity.credential_verification_requests (id, professional_credential_id) on delete restrict;

-- A request is resolved by exactly one decision. Verifications recorded before the
-- queue existed keep a null request.
create unique index uidx_professional_credential_verifications_request
  on identity.professional_credential_verifications (request_id)
  where request_id is not null;

-- ---------------------------------------------------------------------------
-- History does not move
-- ---------------------------------------------------------------------------

create or replace function identity.reject_credential_verification_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'a recorded verification is append-only' using errcode = '55000';
end
$function$;

-- Renewing, revoking and appealing each create another row (ADR-026 §2.5), so
-- nothing legitimate ever rewrites or removes one.
create trigger trg_professional_credential_verifications_append_only
before update or delete on identity.professional_credential_verifications
for each row execute function identity.reject_credential_verification_rewrite();

create or replace function identity.guard_credential_verification_request_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if old.status <> 'pending' then
    raise exception 'a resolved or cancelled verification request does not change'
      using errcode = '55000';
  end if;
  if new.professional_credential_id <> old.professional_credential_id
     or new.requested_by_person_id <> old.requested_by_person_id
     or new.kind <> old.kind
     or new.supersedes_request_id is distinct from old.supersedes_request_id
     or new.created_at <> old.created_at then
    raise exception 'a verification request only moves from pending to its outcome'
      using errcode = '55000';
  end if;
  return new;
end
$function$;

-- Deletion is not guarded: the runtime holds no DML on this table, and a decided
-- request cannot go anyway because its verification references it.
create trigger trg_credential_verification_requests_transition
before update on identity.credential_verification_requests
for each row execute function identity.guard_credential_verification_request_transition();

-- ---------------------------------------------------------------------------
-- The queue fills and empties itself
-- ---------------------------------------------------------------------------

create or replace function identity.open_credential_verification_request_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into identity.credential_verification_requests (
    professional_credential_id, requested_by_person_id, kind
  )
  select new.id, profile.person_id, 'initial'
  from identity.professional_profiles as profile
  where profile.id = new.professional_profile_id;
  return new;
end
$function$;

create trigger trg_professional_credentials_open_verification_request
after insert on identity.professional_credentials
for each row when (new.status = 'active')
execute function identity.open_credential_verification_request_tg();

create or replace function identity.withdraw_credential_verification_request_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update identity.credential_verification_requests as request
  set status = 'cancelled', cancelled_at = clock_timestamp()
  where request.professional_credential_id = new.id
    and request.status = 'pending';
  return new;
end
$function$;

create trigger trg_professional_credentials_withdraw_verification_request
after update of status on identity.professional_credentials
for each row when (old.status = 'active' and new.status = 'retired')
execute function identity.withdraw_credential_verification_request_tg();

-- Credentials declared before the queue existed and never decided enter it now.
-- Ones whose verification has lapsed surface through the renewal list instead.
insert into identity.credential_verification_requests (
  professional_credential_id, requested_by_person_id, kind
)
select credential.id, profile.person_id, 'initial'
from identity.professional_credentials as credential
join identity.professional_profiles as profile
  on profile.id = credential.professional_profile_id
where credential.status = 'active'
  and not exists (
    select 1
    from identity.professional_credential_verifications as verification
    where verification.professional_credential_id = credential.id
  );

-- ---------------------------------------------------------------------------
-- Authority, conflicts and the closed vocabulary
-- ---------------------------------------------------------------------------

-- `verify_professional_credentials` and nothing else. `curate_global_catalog` is a
-- separate duty and does not stand in (criterion 8, ADR-026 §2.1).
create or replace function identity.require_credential_verifier(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if not access_control.has_platform_role(
    p_actor_person_id, p_actor_session_id, 'allfit_admin'
  ) then
    raise exception 'verifying credentials requires the platform administrator role'
      using errcode = '42501';
  end if;

  if not access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'verify_professional_credentials'
  ) then
    raise exception 'verifying credentials requires an effective verification duty'
      using errcode = '42501';
  end if;
end
$function$;

-- The reason a verifier may not decide on this credential, or null. Returned
-- rather than raised so the queue can say it before a decision is attempted.
create or replace function identity.credential_verification_conflict(
  p_verifier_person_id uuid,
  p_credential_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case
    when profile.person_id = p_verifier_person_id then 'verifier_is_holder'
    when exists (
      select 1
      from organizations.organization_memberships as mine
      join organizations.organization_memberships as theirs
        on theirs.organization_id = mine.organization_id
      where mine.person_id = p_verifier_person_id
        and mine.status = 'active'
        and theirs.person_id = profile.person_id
        and theirs.status = 'active'
    ) then 'shared_active_membership'
    else null
  end
  from identity.professional_credentials as credential
  join identity.professional_profiles as profile
    on profile.id = credential.professional_profile_id
  where credential.id = p_credential_id
$function$;

-- A licence is looked up in its official registry; anything else is confirmed with
-- whoever issued it. A suggestion for the screen — the verifier chooses the method.
create or replace function identity.credential_verification_method_for(
  p_credential_type_code text
)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case p_credential_type_code
    when 'professional_license' then 'official_registry_lookup'
    else 'issuer_confirmation'
  end
$function$;

create or replace function identity.credential_verification_decision_projection(
  p_request_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  -- The outcome, never the evidence: no fingerprint and no registry reference.
  select jsonb_build_object(
    'request_id', request.id,
    'kind', request.kind,
    'status', request.status,
    'credential_id', request.professional_credential_id,
    'created_at', request.created_at,
    'resolved_at', request.resolved_at,
    'verification', case
      when verification.id is null then null
      else jsonb_build_object(
        'id', verification.id,
        'result', verification.result,
        'method', verification.method,
        'decided_at', verification.decided_at,
        'valid_from', verification.valid_from,
        'valid_to', verification.valid_to
      )
    end
  )
  from identity.credential_verification_requests as request
  left join identity.professional_credential_verifications as verification
    on verification.request_id = request.id
  where request.id = p_request_id
$function$;

-- ---------------------------------------------------------------------------
-- The queue read
-- ---------------------------------------------------------------------------

create or replace function identity.list_credential_verification_requests(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_limit integer
)
returns table (
  request_id uuid,
  kind text,
  requested_at timestamptz,
  credential_id uuid,
  credential_type_code text,
  credential_type_name text,
  issuer text,
  credential_name text,
  credential_identifier text,
  issued_on date,
  expires_on date,
  verification_url text,
  holder_person_id uuid,
  holder_given_name text,
  holder_family_name text,
  suggested_method text,
  previous_result text,
  previous_valid_to timestamptz,
  viewer_can_decide boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
#variable_conflict use_column
declare
  entry record;
  trace uuid := coalesce(
    nullif(current_setting('app.request_id', true), '')::uuid,
    extensions.uuid_generate_v7()
  );
begin
  perform identity.require_credential_verifier(p_actor_person_id, p_actor_session_id);

  for entry in
    select
      request.id as request_id,
      request.kind as kind,
      request.created_at as requested_at,
      credential.id as credential_id,
      credential.credential_type_code as credential_type_code,
      credential_type.name as credential_type_name,
      credential.issuer as issuer,
      credential.name as credential_name,
      credential.identifier as credential_identifier,
      credential.issued_on as issued_on,
      credential.expires_on as expires_on,
      credential.verification_url as verification_url,
      person.id as holder_person_id,
      person.given_name as holder_given_name,
      person.family_name as holder_family_name,
      identity.credential_verification_method_for(credential.credential_type_code)
        as suggested_method,
      previous.result as previous_result,
      previous.valid_to as previous_valid_to,
      identity.credential_verification_conflict(p_actor_person_id, credential.id) is null
        as viewer_can_decide
    from identity.credential_verification_requests as request
    join identity.professional_credentials as credential
      on credential.id = request.professional_credential_id
    join catalog.professional_credential_types as credential_type
      on credential_type.code = credential.credential_type_code
    join identity.professional_profiles as profile
      on profile.id = credential.professional_profile_id
    join identity.people as person on person.id = profile.person_id
    left join lateral (
      select verification.result, verification.valid_to
      from identity.professional_credential_verifications as verification
      where verification.professional_credential_id = credential.id
      order by verification.decided_at desc, verification.id desc
      limit 1
    ) as previous on true
    where request.status = 'pending'
    order by request.created_at, request.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  loop
    -- Recorded before the row is handed back. If the record fails, the read fails.
    insert into privacy.access_events (
      actor_person_id, subject_person_id, resource, resource_id, purpose, result,
      request_id, access_mode
    ) values (
      p_actor_person_id, entry.holder_person_id, 'identity.professional_credentials',
      entry.credential_id, 'professional_credential_verification', 'allowed', trace,
      'live'::privacy.access_mode
    );

    request_id := entry.request_id;
    kind := entry.kind;
    requested_at := entry.requested_at;
    credential_id := entry.credential_id;
    credential_type_code := entry.credential_type_code;
    credential_type_name := entry.credential_type_name;
    issuer := entry.issuer;
    credential_name := entry.credential_name;
    credential_identifier := entry.credential_identifier;
    issued_on := entry.issued_on;
    expires_on := entry.expires_on;
    verification_url := entry.verification_url;
    holder_person_id := entry.holder_person_id;
    holder_given_name := entry.holder_given_name;
    holder_family_name := entry.holder_family_name;
    suggested_method := entry.suggested_method;
    previous_result := entry.previous_result;
    previous_valid_to := entry.previous_valid_to;
    viewer_can_decide := entry.viewer_can_decide;
    return next;
  end loop;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-011 — the decision
-- ---------------------------------------------------------------------------

create or replace function identity.decide_credential_verification(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_request_id uuid,
  p_result text,
  p_method text,
  p_source_authority text,
  p_source_jurisdiction text,
  p_source_reference text,
  p_source_status text,
  p_source_checked_at timestamptz,
  p_source_valid_to timestamptz,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
#variable_conflict use_column
declare
  receipt record;
  target_request identity.credential_verification_requests%rowtype;
  target_credential identity.professional_credentials%rowtype;
  decided timestamptz := clock_timestamp();
  policy text;
  validity_end timestamptz;
  verification_id uuid;
  conflict text;
begin
  perform identity.require_credential_verifier(p_actor_person_id, p_actor_session_id);

  -- No default result, so a missing one is refused rather than read as a pass.
  if p_result is null or p_result not in ('verified', 'rejected', 'unverifiable') then
    raise exception 'a decision is verified, rejected or unverifiable' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('official_registry_lookup', 'issuer_confirmation') then
    raise exception 'a credential is checked against its official registry or its issuer'
      using errcode = '22023';
  end if;
  if coalesce(btrim(p_source_authority), '') = ''
     or coalesce(btrim(p_source_jurisdiction), '') = ''
     or coalesce(btrim(p_source_reference), '') = ''
     or coalesce(btrim(p_source_status), '') = ''
     or p_source_checked_at is null
     or p_source_checked_at > decided then
    raise exception 'a decision names the source that was consulted and when'
      using errcode = '22023';
  end if;
  if p_result = 'verified' and p_source_valid_to is not null and p_source_valid_to <= decided then
    raise exception 'a source that says the credential lapsed cannot produce verified'
      using errcode = '22023';
  end if;

  -- Derived, never accepted: the method decides which ADR-026 policy applies.
  policy := case p_method
    when 'official_registry_lookup' then 'professional_credential.registry.v1'
    else 'professional_credential.issuer.v1'
  end;

  -- Before the state checks, so replaying a decision that already resolved its
  -- request converges instead of meeting "no longer pending".
  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-IDN-011', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select identity.credential_verification_decision_projection(receipt.aggregate_id), true;
    return;
  end if;

  select request_row.* into target_request
  from identity.credential_verification_requests as request_row
  where request_row.id = p_request_id
  for update;

  if target_request.id is null then
    raise exception 'verification request not found' using errcode = 'P0002';
  end if;
  if target_request.status <> 'pending' then
    raise exception 'this verification request is no longer pending' using errcode = '55000';
  end if;

  select credential_row.* into target_credential
  from identity.professional_credentials as credential_row
  where credential_row.id = target_request.professional_credential_id;

  if target_credential.status <> 'active' then
    raise exception 'a retired credential is not verified' using errcode = '55000';
  end if;

  conflict := identity.credential_verification_conflict(p_actor_person_id, target_credential.id);
  if conflict is not null then
    raise exception 'this verifier has a conflict with the holder: %', conflict
      using errcode = '42501';
  end if;

  if p_result = 'verified' then
    validity_end := least(
      decided + interval '12 months',
      coalesce(p_source_valid_to, 'infinity'::timestamptz),
      coalesce(target_credential.expires_on::timestamptz, 'infinity'::timestamptz)
    );
    if validity_end <= decided then
      raise exception 'the credential has already expired' using errcode = '22023';
    end if;
  end if;

  insert into identity.professional_credential_verifications (
    professional_credential_id, request_id, verifier_person_id, policy_code, method,
    source_authority, source_jurisdiction, source_reference, source_status,
    source_checked_at, source_valid_to, evidence_fingerprint, result, decided_at,
    valid_from, valid_to
  ) values (
    target_credential.id, target_request.id, p_actor_person_id, policy, p_method,
    btrim(p_source_authority), btrim(p_source_jurisdiction), btrim(p_source_reference),
    btrim(p_source_status), p_source_checked_at, p_source_valid_to,
    extensions.digest(
      convert_to(
        concat_ws(
          '|', policy, p_method, btrim(p_source_authority), btrim(p_source_jurisdiction),
          btrim(p_source_reference), btrim(p_source_status), p_source_checked_at::text
        ),
        'UTF8'
      ),
      'sha256'
    ),
    p_result, decided,
    case when p_result = 'verified' then decided end,
    case when p_result = 'verified' then validity_end end
  )
  returning id into verification_id;

  update identity.credential_verification_requests as request_row
  set status = 'resolved', resolved_at = decided
  where request_row.id = target_request.id;

  if p_result = 'verified' then
    perform system.enqueue_outbox_event(
      'professional_credential', target_credential.id,
      'identity.professional_credential_verified.v1',
      jsonb_build_object(
        'professional_credential_id', target_credential.id,
        'verification_id', verification_id,
        'valid_to', validity_end
      )
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'credential-verification-decided',
    'credential_verification_request', target_request.id
  );

  return query select identity.credential_verification_decision_projection(target_request.id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Criterion 4 — a lapsed verification comes back
-- ---------------------------------------------------------------------------

create or replace function identity.list_due_credential_renewals(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_limit integer
)
returns table (
  credential_id uuid,
  credential_type_code text,
  credential_type_name text,
  credential_name text,
  issuer text,
  holder_person_id uuid,
  holder_given_name text,
  holder_family_name text,
  last_valid_to timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
#variable_conflict use_column
declare
  entry record;
  trace uuid := coalesce(
    nullif(current_setting('app.request_id', true), '')::uuid,
    extensions.uuid_generate_v7()
  );
begin
  perform identity.require_credential_verifier(p_actor_person_id, p_actor_session_id);

  -- Nobody runs at the moment a verification lapses, so lapsing cannot open a
  -- request. The list is computed instead, and a verifier opens the renewal.
  for entry in
    select
      credential.id as credential_id,
      credential.credential_type_code as credential_type_code,
      credential_type.name as credential_type_name,
      credential.name as credential_name,
      credential.issuer as issuer,
      person.id as holder_person_id,
      person.given_name as holder_given_name,
      person.family_name as holder_family_name,
      latest.valid_to as last_valid_to
    from identity.professional_credentials as credential
    join catalog.professional_credential_types as credential_type
      on credential_type.code = credential.credential_type_code
    join identity.professional_profiles as profile
      on profile.id = credential.professional_profile_id
    join identity.people as person on person.id = profile.person_id
    join lateral (
      select verification.result, verification.valid_to
      from identity.professional_credential_verifications as verification
      where verification.professional_credential_id = credential.id
      order by verification.decided_at desc, verification.id desc
      limit 1
    ) as latest on true
    where credential.status = 'active'
      and latest.result = 'verified'
      and latest.valid_to < clock_timestamp() + interval '30 days'
      and not exists (
        select 1
        from identity.credential_verification_requests as request
        where request.professional_credential_id = credential.id
          and request.status = 'pending'
      )
    order by latest.valid_to, credential.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  loop
    insert into privacy.access_events (
      actor_person_id, subject_person_id, resource, resource_id, purpose, result,
      request_id, access_mode
    ) values (
      p_actor_person_id, entry.holder_person_id, 'identity.professional_credentials',
      entry.credential_id, 'professional_credential_verification', 'allowed', trace,
      'live'::privacy.access_mode
    );

    credential_id := entry.credential_id;
    credential_type_code := entry.credential_type_code;
    credential_type_name := entry.credential_type_name;
    credential_name := entry.credential_name;
    issuer := entry.issuer;
    holder_person_id := entry.holder_person_id;
    holder_given_name := entry.holder_given_name;
    holder_family_name := entry.holder_family_name;
    last_valid_to := entry.last_valid_to;
    return next;
  end loop;
end
$function$;

-- NEW-IDN-VERIFY-REQUEST has no operation number yet, so a renewal is receipted
-- under OP-IDN-011 — the operation it exists to lead back to.
create or replace function identity.open_credential_verification_renewal(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_credential_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
#variable_conflict use_column
declare
  receipt record;
  target_credential identity.professional_credentials%rowtype;
  latest_result text;
  latest_valid_to timestamptz;
  latest_request_id uuid;
  opened_request_id uuid;
begin
  perform identity.require_credential_verifier(p_actor_person_id, p_actor_session_id);

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-IDN-011', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query select identity.credential_verification_decision_projection(receipt.aggregate_id), true;
    return;
  end if;

  select credential_row.* into target_credential
  from identity.professional_credentials as credential_row
  where credential_row.id = p_credential_id
  for update;

  if target_credential.id is null then
    raise exception 'professional credential not found' using errcode = 'P0002';
  end if;
  if target_credential.status <> 'active' then
    raise exception 'a retired credential is not renewed' using errcode = '55000';
  end if;

  select verification.result, verification.valid_to, verification.request_id
  into latest_result, latest_valid_to, latest_request_id
  from identity.professional_credential_verifications as verification
  where verification.professional_credential_id = target_credential.id
  order by verification.decided_at desc, verification.id desc
  limit 1;

  if latest_result is distinct from 'verified'
     or latest_valid_to >= clock_timestamp() + interval '30 days' then
    raise exception 'this credential has no verification due for renewal' using errcode = '55000';
  end if;

  if exists (
    select 1
    from identity.credential_verification_requests as request_row
    where request_row.professional_credential_id = target_credential.id
      and request_row.status = 'pending'
  ) then
    raise exception 'this credential already has a review in progress' using errcode = '55000';
  end if;

  -- A new request, never an extension: the lapsed verification stays as it was.
  insert into identity.credential_verification_requests (
    professional_credential_id, requested_by_person_id, kind, supersedes_request_id
  ) values (
    target_credential.id, p_actor_person_id, 'renewal', latest_request_id
  )
  returning id into opened_request_id;

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'credential-verification-renewal-opened',
    'credential_verification_request', opened_request_id
  );

  return query select identity.credential_verification_decision_projection(opened_request_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership, row security and grants
-- ---------------------------------------------------------------------------

alter table identity.credential_verification_requests owner to allfit_owner;
alter table identity.credential_verification_requests enable row level security;
alter table identity.credential_verification_requests force row level security;

create policy credential_verification_requests_all_owner
  on identity.credential_verification_requests
  for all to allfit_owner using (true) with check (true);

revoke all on identity.credential_verification_requests from public, allfit_api;

alter function identity.reject_credential_verification_rewrite() owner to allfit_owner;
alter function identity.guard_credential_verification_request_transition() owner to allfit_owner;
alter function identity.open_credential_verification_request_tg() owner to allfit_owner;
alter function identity.withdraw_credential_verification_request_tg() owner to allfit_owner;
alter function identity.require_credential_verifier(uuid, uuid) owner to allfit_owner;
alter function identity.credential_verification_conflict(uuid, uuid) owner to allfit_owner;
alter function identity.credential_verification_method_for(text) owner to allfit_owner;
alter function identity.credential_verification_decision_projection(uuid) owner to allfit_owner;
alter function identity.list_credential_verification_requests(uuid, uuid, integer) owner to allfit_owner;
alter function identity.decide_credential_verification(
  uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, uuid, uuid, bytea
) owner to allfit_owner;
alter function identity.list_due_credential_renewals(uuid, uuid, integer) owner to allfit_owner;
alter function identity.open_credential_verification_renewal(
  uuid, uuid, uuid, uuid, uuid, bytea
) owner to allfit_owner;

revoke all on function identity.reject_credential_verification_rewrite() from public, allfit_api;
revoke all on function identity.guard_credential_verification_request_transition() from public, allfit_api;
revoke all on function identity.open_credential_verification_request_tg() from public, allfit_api;
revoke all on function identity.withdraw_credential_verification_request_tg() from public, allfit_api;
revoke all on function identity.require_credential_verifier(uuid, uuid) from public, allfit_api;
revoke all on function identity.credential_verification_conflict(uuid, uuid) from public, allfit_api;
revoke all on function identity.credential_verification_method_for(text) from public, allfit_api;
revoke all on function identity.credential_verification_decision_projection(uuid) from public, allfit_api;
revoke all on function identity.list_credential_verification_requests(uuid, uuid, integer) from public;
revoke all on function identity.decide_credential_verification(
  uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, uuid, uuid, bytea
) from public;
revoke all on function identity.list_due_credential_renewals(uuid, uuid, integer) from public;
revoke all on function identity.open_credential_verification_renewal(
  uuid, uuid, uuid, uuid, uuid, bytea
) from public;

-- The runtime role runs the four operations. It never runs the guard or the
-- conflict check on their own, and it never reaches either table.
grant execute on function identity.list_credential_verification_requests(uuid, uuid, integer) to allfit_api;
grant execute on function identity.decide_credential_verification(
  uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, uuid, uuid, bytea
) to allfit_api;
grant execute on function identity.list_due_credential_renewals(uuid, uuid, integer) to allfit_api;
grant execute on function identity.open_credential_verification_renewal(
  uuid, uuid, uuid, uuid, uuid, bytea
) to allfit_api;
