-- Record a verifier's read as a staff read.
--
-- `20260913120000` wrote both verification reads into `privacy.access_events`
-- with `access_mode = 'live'`, and its header claimed the enum had no platform
-- value. That was wrong: `20260910130000` added `support_metadata` for exactly
-- this distinction. `live` means a read made under a permission the person granted,
-- so the access log (`HU-BO-030`) would have told an auditor that a verifier read
-- somebody's credential with that person's consent.
--
-- Both functions are replaced verbatim except for the mode; ownership and grants
-- survive `create or replace`. The branch that introduced the queue has not been
-- merged, so the only rows carrying the wrong mode are in development databases.
-- The log is append-only and they are not rewritten.

set lock_timeout = '5s';
set statement_timeout = '60s';

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
      'support_metadata'::privacy.access_mode
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
      'support_metadata'::privacy.access_mode
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
