-- Personal professional profiles, governed catalogues and credential history.
-- The runtime can mutate these resources only through the closed functions below.

set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists catalog authorization allfit_owner;
create schema if not exists privacy authorization allfit_owner;

revoke all on schema catalog, privacy from public;
grant usage on schema catalog, privacy to allfit_api;

create type catalog.publication_status as enum ('draft', 'published', 'deprecated', 'archived');
alter type catalog.publication_status owner to allfit_owner;

create table catalog.professional_specialties (
  code text not null,
  name text not null,
  description text,
  status catalog.publication_status not null default 'draft',
  display_order integer not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_professional_specialties primary key (code),
  constraint ck_professional_specialties_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_professional_specialties_name check (btrim(name) <> '' and char_length(name) <= 120),
  constraint ck_professional_specialties_description check (description is null or (btrim(description) <> '' and char_length(description) <= 500)),
  constraint ck_professional_specialties_display_order check (display_order >= 0)
);

create unique index uidx_professional_specialties_display_order
  on catalog.professional_specialties (display_order);
create index idx_professional_specialties_publication
  on catalog.professional_specialties (status, display_order, code);

create table catalog.professional_credential_types (
  code text not null,
  name text not null,
  description text,
  status catalog.publication_status not null default 'draft',
  display_order integer not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_professional_credential_types primary key (code),
  constraint ck_professional_credential_types_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_professional_credential_types_name check (btrim(name) <> '' and char_length(name) <= 120),
  constraint ck_professional_credential_types_description check (description is null or (btrim(description) <> '' and char_length(description) <= 500)),
  constraint ck_professional_credential_types_display_order check (display_order >= 0)
);

create unique index uidx_professional_credential_types_display_order
  on catalog.professional_credential_types (display_order);
create index idx_professional_credential_types_publication
  on catalog.professional_credential_types (status, display_order, code);

alter table catalog.professional_specialties owner to allfit_owner;
alter table catalog.professional_credential_types owner to allfit_owner;

insert into catalog.professional_specialties (code, name, description, status, display_order)
values
  ('personal_training', 'Entrenamiento personal', null, 'published', 10),
  ('strength_conditioning', 'Fuerza y acondicionamiento', null, 'published', 20),
  ('functional_training', 'Entrenamiento funcional', null, 'published', 30),
  ('mobility_flexibility', 'Movilidad y flexibilidad', null, 'published', 40),
  ('sports_performance', 'Rendimiento deportivo', null, 'published', 50),
  ('group_training', 'Entrenamiento grupal', null, 'published', 60);

insert into catalog.professional_credential_types (code, name, description, status, display_order)
values
  ('academic_degree', 'Título académico', null, 'published', 10),
  ('professional_license', 'Licencia o matrícula profesional', null, 'published', 20),
  ('professional_certification', 'Certificación profesional', null, 'published', 30);

create trigger trg_professional_specialties_before_update_timestamp
before update on catalog.professional_specialties
for each row execute function access_control.set_updated_at();

create trigger trg_professional_credential_types_before_update_timestamp
before update on catalog.professional_credential_types
for each row execute function access_control.set_updated_at();

create table identity.professional_profiles (
  id uuid not null default extensions.uuid_generate_v7(),
  person_id uuid not null,
  headline text not null,
  bio text not null,
  practice_started_year smallint not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_professional_profiles primary key (id),
  constraint fk_professional_profiles_person foreign key (person_id) references identity.people(id) on delete restrict,
  constraint uq_professional_profiles_person unique (person_id),
  constraint ck_professional_profiles_headline check (btrim(headline) <> '' and char_length(headline) <= 120),
  constraint ck_professional_profiles_bio check (btrim(bio) <> '' and char_length(bio) <= 2000),
  constraint ck_professional_profiles_practice_year check (practice_started_year between 1900 and 2100)
);

create table identity.professional_profile_specialties (
  professional_profile_id uuid not null,
  specialty_code text not null,
  declared_at timestamptz not null default clock_timestamp(),
  constraint pk_professional_profile_specialties primary key (professional_profile_id, specialty_code),
  constraint fk_professional_profile_specialties_profile foreign key (professional_profile_id) references identity.professional_profiles(id) on delete cascade,
  constraint fk_professional_profile_specialties_specialty foreign key (specialty_code) references catalog.professional_specialties(code) on delete restrict
);

create index idx_professional_profile_specialties_specialty
  on identity.professional_profile_specialties (specialty_code, professional_profile_id);

create table identity.professional_credentials (
  id uuid not null default extensions.uuid_generate_v7(),
  professional_profile_id uuid not null,
  credential_type_code text not null,
  issuer text not null,
  name text not null,
  identifier text,
  issued_on date,
  expires_on date,
  verification_url text,
  status text not null default 'active',
  supersedes_credential_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  constraint pk_professional_credentials primary key (id),
  constraint fk_professional_credentials_profile foreign key (professional_profile_id) references identity.professional_profiles(id) on delete restrict,
  constraint fk_professional_credentials_type foreign key (credential_type_code) references catalog.professional_credential_types(code) on delete restrict,
  constraint fk_professional_credentials_supersedes foreign key (supersedes_credential_id) references identity.professional_credentials(id) on delete restrict,
  constraint ck_professional_credentials_issuer check (btrim(issuer) <> '' and char_length(issuer) <= 200),
  constraint ck_professional_credentials_name check (btrim(name) <> '' and char_length(name) <= 200),
  constraint ck_professional_credentials_identifier check (identifier is null or (btrim(identifier) <> '' and char_length(identifier) <= 160)),
  constraint ck_professional_credentials_dates check (issued_on is null or expires_on is null or expires_on >= issued_on),
  constraint ck_professional_credentials_verification_url check (verification_url is null or (verification_url ~ '^https://' and char_length(verification_url) <= 2048)),
  constraint ck_professional_credentials_status check (status in ('active', 'retired')),
  constraint ck_professional_credentials_retirement check (
    (status = 'active' and retired_at is null)
    or (status = 'retired' and retired_at is not null)
  ),
  constraint ck_professional_credentials_not_self_superseding check (supersedes_credential_id is null or supersedes_credential_id <> id)
);

create index idx_professional_credentials_profile_status
  on identity.professional_credentials (professional_profile_id, status, created_at desc);
create unique index uidx_professional_credentials_successor
  on identity.professional_credentials (supersedes_credential_id)
  where supersedes_credential_id is not null;

create table identity.professional_credential_verifications (
  id uuid not null default extensions.uuid_generate_v7(),
  professional_credential_id uuid not null,
  verifier_person_id uuid not null,
  policy_code text not null,
  method text not null,
  source_authority text not null,
  source_jurisdiction text not null,
  source_reference text not null,
  source_status text not null,
  source_checked_at timestamptz not null,
  source_valid_to timestamptz,
  evidence_fingerprint bytea not null,
  result text not null,
  decided_at timestamptz not null default clock_timestamp(),
  valid_from timestamptz,
  valid_to timestamptz,
  supersedes_verification_id uuid,
  revoked_at timestamptz,
  constraint pk_professional_credential_verifications primary key (id),
  constraint fk_professional_credential_verifications_credential foreign key (professional_credential_id) references identity.professional_credentials(id) on delete restrict,
  constraint fk_professional_credential_verifications_verifier foreign key (verifier_person_id) references identity.people(id) on delete restrict,
  constraint fk_professional_credential_verifications_supersedes foreign key (supersedes_verification_id) references identity.professional_credential_verifications(id) on delete restrict,
  constraint ck_professional_credential_verifications_policy check (btrim(policy_code) <> ''),
  constraint ck_professional_credential_verifications_method check (method in ('official_registry_lookup', 'issuer_confirmation')),
  constraint ck_professional_credential_verifications_source check (
    btrim(source_authority) <> '' and btrim(source_jurisdiction) <> '' and btrim(source_reference) <> '' and btrim(source_status) <> ''
  ),
  constraint ck_professional_credential_verifications_fingerprint check (octet_length(evidence_fingerprint) = 32),
  constraint ck_professional_credential_verifications_result check (result in ('verified', 'rejected', 'unverifiable', 'revoked')),
  constraint ck_professional_credential_verifications_source_time check (source_checked_at <= decided_at),
  constraint ck_professional_credential_verifications_validity check (
    (result <> 'verified' and valid_from is null and valid_to is null)
    or (
      result = 'verified'
      and valid_from is not null
      and valid_to is not null
      and valid_to > valid_from
      and valid_to <= decided_at + interval '12 months'
      and (source_valid_to is null or valid_to <= source_valid_to)
    )
  ),
  constraint ck_professional_credential_verifications_revocation check ((result = 'revoked') = (revoked_at is not null))
);

create index idx_professional_credential_verifications_credential_decided
  on identity.professional_credential_verifications (professional_credential_id, decided_at desc, id desc);

alter table identity.professional_profiles owner to allfit_owner;
alter table identity.professional_profile_specialties owner to allfit_owner;
alter table identity.professional_credentials owner to allfit_owner;
alter table identity.professional_credential_verifications owner to allfit_owner;

create trigger trg_professional_profiles_before_update_timestamp
before update on identity.professional_profiles
for each row execute function access_control.set_updated_at();

create or replace function identity.enforce_professional_credential_lineage()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  parent_profile_id uuid;
begin
  if tg_op = 'UPDATE' and (
    new.professional_profile_id is distinct from old.professional_profile_id
    or new.credential_type_code is distinct from old.credential_type_code
    or new.issuer is distinct from old.issuer
    or new.name is distinct from old.name
    or new.identifier is distinct from old.identifier
    or new.issued_on is distinct from old.issued_on
    or new.expires_on is distinct from old.expires_on
    or new.verification_url is distinct from old.verification_url
    or new.supersedes_credential_id is distinct from old.supersedes_credential_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'professional credential material is immutable' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and new.supersedes_credential_id is not null then
    select credential.professional_profile_id into parent_profile_id
    from identity.professional_credentials as credential
    where credential.id = new.supersedes_credential_id;

    if parent_profile_id is null or parent_profile_id <> new.professional_profile_id then
      raise exception 'credential revisions must remain in the same professional profile' using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

alter function identity.enforce_professional_credential_lineage() owner to allfit_owner;
revoke all on function identity.enforce_professional_credential_lineage() from public;

create trigger trg_professional_credentials_before_lineage
before insert or update on identity.professional_credentials
for each row execute function identity.enforce_professional_credential_lineage();

create table system.outbox_events (
  id uuid not null default extensions.uuid_generate_v7(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload_schema_version smallint not null default 1,
  payload jsonb not null,
  occurred_at timestamptz not null default clock_timestamp(),
  available_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  attempt_count integer not null default 0,
  constraint pk_outbox_events primary key (id),
  constraint ck_outbox_events_aggregate_type check (aggregate_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_outbox_events_event_type check (event_type ~ '^[a-z][a-z0-9_]+\.[a-z][a-z0-9_]+\.v[1-9][0-9]*$'),
  constraint ck_outbox_events_payload_version check (payload_schema_version = 1),
  constraint ck_outbox_events_payload check (jsonb_typeof(payload) = 'object'),
  constraint ck_outbox_events_attempt_count check (attempt_count >= 0),
  constraint ck_outbox_events_publication check (published_at is null or published_at >= occurred_at)
);

create index idx_outbox_events_pending
  on system.outbox_events (available_at, occurred_at, id)
  where published_at is null;
create index idx_outbox_events_aggregate
  on system.outbox_events (aggregate_type, aggregate_id, occurred_at, id);

alter table system.outbox_events owner to allfit_owner;

create table privacy.access_events (
  id uuid not null default extensions.uuid_generate_v7(),
  actor_person_id uuid not null,
  target_person_id uuid not null,
  resource_type text not null,
  resource_id uuid,
  purpose text not null,
  decision text not null,
  request_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint pk_access_events primary key (occurred_at, id),
  constraint fk_access_events_actor foreign key (actor_person_id) references identity.people(id) on delete restrict,
  constraint fk_access_events_target foreign key (target_person_id) references identity.people(id) on delete restrict,
  constraint ck_access_events_resource_type check (resource_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_access_events_purpose check (purpose ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_access_events_decision check (decision in ('allowed', 'denied'))
) partition by range (occurred_at);

create table privacy.access_events_2026_08 partition of privacy.access_events
  for values from ('2026-08-01 00:00:00+00') to ('2026-09-01 00:00:00+00');
create table privacy.access_events_2026_09 partition of privacy.access_events
  for values from ('2026-09-01 00:00:00+00') to ('2026-10-01 00:00:00+00');
create table privacy.access_events_2026_10 partition of privacy.access_events
  for values from ('2026-10-01 00:00:00+00') to ('2026-11-01 00:00:00+00');
create table privacy.access_events_2026_11 partition of privacy.access_events
  for values from ('2026-11-01 00:00:00+00') to ('2026-12-01 00:00:00+00');

create index idx_access_events_actor_occurred
  on privacy.access_events (actor_person_id, occurred_at desc, id);
create index idx_access_events_target_occurred
  on privacy.access_events (target_person_id, occurred_at desc, id);
create unique index uidx_access_events_request_resource
  on privacy.access_events (occurred_at, request_id, resource_type, target_person_id);

alter table privacy.access_events owner to allfit_owner;
alter table privacy.access_events_2026_08 owner to allfit_owner;
alter table privacy.access_events_2026_09 owner to allfit_owner;
alter table privacy.access_events_2026_10 owner to allfit_owner;
alter table privacy.access_events_2026_11 owner to allfit_owner;

alter table catalog.professional_specialties enable row level security;
alter table catalog.professional_specialties force row level security;
alter table catalog.professional_credential_types enable row level security;
alter table catalog.professional_credential_types force row level security;
alter table identity.professional_profiles enable row level security;
alter table identity.professional_profiles force row level security;
alter table identity.professional_profile_specialties enable row level security;
alter table identity.professional_profile_specialties force row level security;
alter table identity.professional_credentials enable row level security;
alter table identity.professional_credentials force row level security;
alter table identity.professional_credential_verifications enable row level security;
alter table identity.professional_credential_verifications force row level security;
alter table system.outbox_events enable row level security;
alter table system.outbox_events force row level security;
alter table privacy.access_events enable row level security;
alter table privacy.access_events force row level security;
alter table privacy.access_events_2026_08 enable row level security;
alter table privacy.access_events_2026_08 force row level security;
alter table privacy.access_events_2026_09 enable row level security;
alter table privacy.access_events_2026_09 force row level security;
alter table privacy.access_events_2026_10 enable row level security;
alter table privacy.access_events_2026_10 force row level security;
alter table privacy.access_events_2026_11 enable row level security;
alter table privacy.access_events_2026_11 force row level security;

create policy professional_specialties_all_owner on catalog.professional_specialties
  for all to allfit_owner using (true) with check (true);
create policy professional_specialties_select_published on catalog.professional_specialties
  for select to allfit_api using (access_control.person() is not null and status = 'published');
create policy professional_credential_types_all_owner on catalog.professional_credential_types
  for all to allfit_owner using (true) with check (true);
create policy professional_credential_types_select_published on catalog.professional_credential_types
  for select to allfit_api using (access_control.person() is not null and status = 'published');
create policy professional_profiles_all_owner on identity.professional_profiles
  for all to allfit_owner using (true) with check (true);
create policy professional_profiles_select_self on identity.professional_profiles
  for select to allfit_api using (access_control.is_self(person_id));
create policy professional_profile_specialties_all_owner on identity.professional_profile_specialties
  for all to allfit_owner using (true) with check (true);
create policy professional_profile_specialties_select_self on identity.professional_profile_specialties
  for select to allfit_api using (
    exists (
      select 1
      from identity.professional_profiles as profile
      where profile.id = professional_profile_id
        and access_control.is_self(profile.person_id)
    )
  );
create policy professional_credentials_all_owner on identity.professional_credentials
  for all to allfit_owner using (true) with check (true);
create policy professional_credentials_select_self on identity.professional_credentials
  for select to allfit_api using (
    exists (
      select 1
      from identity.professional_profiles as profile
      where profile.id = professional_profile_id
        and access_control.is_self(profile.person_id)
    )
  );
create policy professional_credential_verifications_all_owner on identity.professional_credential_verifications
  for all to allfit_owner using (true) with check (true);
create policy outbox_events_all_owner on system.outbox_events
  for all to allfit_owner using (true) with check (true);
create policy access_events_all_owner on privacy.access_events
  for all to allfit_owner using (true) with check (true);

revoke all on catalog.professional_specialties, catalog.professional_credential_types from public, allfit_api;
revoke all on identity.professional_profiles, identity.professional_profile_specialties, identity.professional_credentials, identity.professional_credential_verifications from public, allfit_api;
revoke all on system.outbox_events, privacy.access_events from public, allfit_api;
grant select on catalog.professional_specialties, catalog.professional_credential_types to allfit_api;
grant select on identity.professional_profiles, identity.professional_profile_specialties, identity.professional_credentials to allfit_api;

create or replace function system.enqueue_outbox_event(
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_event_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  event_id uuid;
begin
  if p_aggregate_id is null
     or p_aggregate_type !~ '^[a-z][a-z0-9_]{1,63}$'
     or p_event_type !~ '^[a-z][a-z0-9_]+\.[a-z][a-z0-9_]+\.v[1-9][0-9]*$'
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload ?| array['headline', 'bio', 'issuer', 'name', 'identifier', 'verification_url'] then
    raise exception 'invalid or non-minimal outbox event' using errcode = '22023';
  end if;

  insert into system.outbox_events (aggregate_type, aggregate_id, event_type, payload)
  values (p_aggregate_type, p_aggregate_id, p_event_type, p_payload)
  returning id into event_id;

  return event_id;
end
$function$;

create or replace function privacy.log_access_event(
  p_actor_person_id uuid,
  p_target_person_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_purpose text,
  p_decision text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  access_event_id uuid;
begin
  if p_actor_person_id is null
     or p_target_person_id is null
     or p_request_id is null
     or p_resource_type !~ '^[a-z][a-z0-9_]{1,63}$'
     or p_purpose !~ '^[a-z][a-z0-9_]{1,63}$'
     or p_decision not in ('allowed', 'denied') then
    raise exception 'invalid access event' using errcode = '22023';
  end if;

  insert into privacy.access_events (
    actor_person_id,
    target_person_id,
    resource_type,
    resource_id,
    purpose,
    decision,
    request_id
  ) values (
    p_actor_person_id,
    p_target_person_id,
    p_resource_type,
    p_resource_id,
    p_purpose,
    p_decision,
    p_request_id
  )
  returning id into access_event_id;

  return access_event_id;
end
$function$;

create or replace function catalog.list_professional_specialties()
returns table (code text, name text, description text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform identity.require_professional_actor(access_control.person());
  return query
  select specialty.code, specialty.name, specialty.description
  from catalog.professional_specialties as specialty
  where specialty.status = 'published'
  order by specialty.display_order, specialty.code;
end
$function$;

create or replace function catalog.list_professional_credential_types()
returns table (code text, name text, description text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  perform identity.require_professional_actor(access_control.person());
  return query
  select credential_type.code, credential_type.name, credential_type.description
  from catalog.professional_credential_types as credential_type
  where credential_type.status = 'published'
  order by credential_type.display_order, credential_type.code;
end
$function$;

create or replace function identity.require_professional_actor(p_person_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() <> 'person' or access_control.person() <> p_person_id then
    raise exception 'professional resource actor mismatch' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from identity.people as person
    where person.id = p_person_id
      and person.status = 'active'
  ) then
    raise exception 'active person required' using errcode = '42501';
  end if;
end
$function$;

create or replace function identity.professional_credential_projection(p_credential_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  with credential_row as (
    select
      credential.*,
      credential_type.name as credential_type_name
    from identity.professional_credentials as credential
    join catalog.professional_credential_types as credential_type
      on credential_type.code = credential.credential_type_code
    where credential.id = p_credential_id
  ), latest_verification as (
    select verification.*
    from identity.professional_credential_verifications as verification
    join credential_row as credential on credential.id = verification.professional_credential_id
    order by verification.decided_at desc, verification.id desc
    limit 1
  )
  select jsonb_build_object(
    'id', credential.id,
    'credential_type_code', credential.credential_type_code,
    'credential_type_name', credential.credential_type_name,
    'issuer', credential.issuer,
    'name', credential.name,
    'identifier', credential.identifier,
    'issued_on', credential.issued_on,
    'expires_on', credential.expires_on,
    'verification_url', credential.verification_url,
    'status', credential.status,
    'supersedes_credential_id', credential.supersedes_credential_id,
    'created_at', credential.created_at,
    'retired_at', credential.retired_at,
    'verification', jsonb_build_object(
      'state', case
        when verification.id is null then 'unverified'
        when verification.result = 'verified' and (
          verification.valid_to <= current_timestamp
          or (credential.expires_on is not null and credential.expires_on < current_date)
        ) then 'expired'
        else verification.result
      end,
      'valid_from', verification.valid_from,
      'valid_to', verification.valid_to,
      'effective', coalesce(
        credential.status = 'active'
        and verification.result = 'verified'
        and verification.valid_from <= current_timestamp
        and verification.valid_to > current_timestamp
        and (credential.expires_on is null or credential.expires_on >= current_date),
        false
      )
    )
  )
  from credential_row as credential
  left join latest_verification as verification on true
$function$;

create or replace function identity.professional_profile_projection(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', profile.id,
    'headline', profile.headline,
    'bio', profile.bio,
    'practice_started_year', profile.practice_started_year,
    'experience_years', greatest(extract(year from current_date)::integer - profile.practice_started_year, 0),
    'specialties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', specialty.code,
          'name', specialty.name,
          'description', specialty.description
        ) order by specialty.display_order, specialty.code
      )
      from identity.professional_profile_specialties as declared
      join catalog.professional_specialties as specialty on specialty.code = declared.specialty_code
      where declared.professional_profile_id = profile.id
    ), '[]'::jsonb),
    'credentials', coalesce((
      select jsonb_agg(
        identity.professional_credential_projection(credential.id)
        order by case credential.status when 'active' then 0 else 1 end, credential.created_at desc, credential.id
      )
      from identity.professional_credentials as credential
      where credential.professional_profile_id = profile.id
    ), '[]'::jsonb),
    'created_at', profile.created_at,
    'updated_at', profile.updated_at
  )
  from identity.professional_profiles as profile
  where profile.id = p_profile_id
$function$;

create or replace function identity.get_my_professional_context(
  p_person_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  profile_id uuid;
  profile_body jsonb;
  membership_body jsonb;
begin
  perform identity.require_professional_actor(p_person_id);

  select profile.id into profile_id
  from identity.professional_profiles as profile
  where profile.person_id = p_person_id;

  perform privacy.log_access_event(
    p_person_id,
    p_person_id,
    'professional_profile',
    profile_id,
    'studio_self_service',
    'allowed',
    p_request_id
  );

  if profile_id is not null then
    profile_body := identity.professional_profile_projection(profile_id);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'membership_id', membership.id,
      'organization_id', organization.id,
      'display_name', organization.display_name,
      'type_code', organization.type_code,
      'status', membership.status,
      'joined_at', membership.joined_at,
      'ended_at', membership.ended_at,
      'roles', coalesce((
        select jsonb_agg(role.role_code order by role.role_code)
        from organizations.membership_roles as role
        where role.membership_id = membership.id
          and role.valid_to is null
      ), '[]'::jsonb)
    ) order by organization.display_name, membership.id
  ), '[]'::jsonb)
  into membership_body
  from organizations.organization_memberships as membership
  join organizations.organizations as organization on organization.id = membership.organization_id
  where membership.person_id = p_person_id
    and membership.status = 'active'
    and organization.status = 'active';

  return jsonb_build_object('profile', profile_body, 'memberships', membership_body);
end
$function$;

create or replace function identity.put_professional_profile(
  p_person_id uuid,
  p_headline text,
  p_bio text,
  p_practice_started_year integer,
  p_specialty_codes text[],
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (profile jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  target_profile identity.professional_profiles%rowtype;
  normalized_headline text := btrim(p_headline);
  normalized_bio text := btrim(p_bio);
  requested_codes text[];
  current_codes text[];
  content_changed boolean;
begin
  perform identity.require_professional_actor(p_person_id);

  if p_headline is null or normalized_headline = '' or char_length(normalized_headline) > 120
     or p_bio is null or normalized_bio = '' or char_length(normalized_bio) > 2000
     or p_practice_started_year is null
     or p_practice_started_year < 1900
     or p_practice_started_year > extract(year from current_date)::integer
     or coalesce(cardinality(p_specialty_codes), 0) = 0
     or array_position(p_specialty_codes, null) is not null then
    raise exception 'invalid professional profile' using errcode = '22023';
  end if;

  select array_agg(code order by code), count(*) <> count(distinct code)
  into requested_codes, content_changed
  from unnest(p_specialty_codes) as requested(code);

  if content_changed then
    raise exception 'duplicate professional specialties' using errcode = '22023';
  end if;

  if (
    select count(*)
    from catalog.professional_specialties as specialty
    where specialty.code = any(requested_codes)
      and specialty.status = 'published'
  ) <> cardinality(requested_codes) then
    raise exception 'unsupported professional specialty' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id,
    'OP-IDN-010',
    p_idempotency_key,
    p_command_id,
    p_request_hash
  );

  if not receipt.claimed then
    return query select identity.professional_profile_projection(receipt.aggregate_id), true;
    return;
  end if;

  select profile_row.* into target_profile
  from identity.professional_profiles as profile_row
  where profile_row.person_id = p_person_id
  for update;

  if target_profile.id is null then
    insert into identity.professional_profiles (person_id, headline, bio, practice_started_year)
    values (p_person_id, normalized_headline, normalized_bio, p_practice_started_year)
    returning * into target_profile;
    content_changed := true;
  else
    select array_agg(declared.specialty_code order by declared.specialty_code)
    into current_codes
    from identity.professional_profile_specialties as declared
    where declared.professional_profile_id = target_profile.id;

    content_changed := target_profile.headline is distinct from normalized_headline
      or target_profile.bio is distinct from normalized_bio
      or target_profile.practice_started_year is distinct from p_practice_started_year
      or current_codes is distinct from requested_codes;

    if content_changed then
      update identity.professional_profiles
      set headline = normalized_headline,
          bio = normalized_bio,
          practice_started_year = p_practice_started_year
      where id = target_profile.id
      returning * into target_profile;
    end if;
  end if;

  if content_changed then
    delete from identity.professional_profile_specialties
    where professional_profile_id = target_profile.id;

    insert into identity.professional_profile_specialties (professional_profile_id, specialty_code)
    select target_profile.id, requested.code
    from unnest(requested_codes) as requested(code);

    perform system.enqueue_outbox_event(
      'professional_profile',
      target_profile.id,
      'identity.professional_profile_updated.v1',
      jsonb_build_object('professional_profile_id', target_profile.id)
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    case when content_changed then 'professional-profile-updated' else 'professional-profile-unchanged' end,
    'professional_profile',
    target_profile.id
  );

  return query select identity.professional_profile_projection(target_profile.id), false;
end
$function$;

create or replace function identity.validate_professional_credential_input(
  p_credential_type_code text,
  p_issuer text,
  p_name text,
  p_identifier text,
  p_issued_on date,
  p_expires_on date,
  p_verification_url text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if p_credential_type_code is null
     or p_issuer is null or btrim(p_issuer) = '' or char_length(btrim(p_issuer)) > 200
     or p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 200
     or (p_identifier is not null and (btrim(p_identifier) = '' or char_length(btrim(p_identifier)) > 160))
     or (p_issued_on is not null and p_expires_on is not null and p_expires_on < p_issued_on)
     or (p_verification_url is not null and (p_verification_url !~ '^https://' or char_length(p_verification_url) > 2048))
     or not exists (
       select 1
       from catalog.professional_credential_types as credential_type
       where credential_type.code = p_credential_type_code
         and credential_type.status = 'published'
     ) then
    raise exception 'invalid professional credential' using errcode = '22023';
  end if;
end
$function$;

create or replace function identity.declare_professional_credential(
  p_person_id uuid,
  p_credential_type_code text,
  p_issuer text,
  p_name text,
  p_identifier text,
  p_issued_on date,
  p_expires_on date,
  p_verification_url text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (credential jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  profile_id uuid;
  credential_id uuid;
begin
  perform identity.require_professional_actor(p_person_id);
  perform identity.validate_professional_credential_input(
    p_credential_type_code, p_issuer, p_name, p_identifier, p_issued_on, p_expires_on, p_verification_url
  );

  select profile.id into profile_id
  from identity.professional_profiles as profile
  where profile.person_id = p_person_id;

  if profile_id is null then
    raise exception 'professional profile required' using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-IDN-029', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    return query select identity.professional_credential_projection(receipt.aggregate_id), true;
    return;
  end if;

  insert into identity.professional_credentials (
    professional_profile_id,
    credential_type_code,
    issuer,
    name,
    identifier,
    issued_on,
    expires_on,
    verification_url
  ) values (
    profile_id,
    p_credential_type_code,
    btrim(p_issuer),
    btrim(p_name),
    nullif(btrim(p_identifier), ''),
    p_issued_on,
    p_expires_on,
    p_verification_url
  )
  returning id into credential_id;

  perform system.enqueue_outbox_event(
    'professional_credential',
    credential_id,
    'identity.professional_credential_declared.v1',
    jsonb_build_object(
      'professional_credential_id', credential_id,
      'professional_profile_id', profile_id,
      'credential_type_code', p_credential_type_code
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'professional-credential-declared', 'professional_credential', credential_id
  );

  return query select identity.professional_credential_projection(credential_id), false;
end
$function$;

create or replace function identity.revise_professional_credential(
  p_person_id uuid,
  p_credential_id uuid,
  p_credential_type_code text,
  p_issuer text,
  p_name text,
  p_identifier text,
  p_issued_on date,
  p_expires_on date,
  p_verification_url text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (credential jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  previous_credential identity.professional_credentials%rowtype;
  successor_id uuid;
begin
  perform identity.require_professional_actor(p_person_id);
  perform identity.validate_professional_credential_input(
    p_credential_type_code, p_issuer, p_name, p_identifier, p_issued_on, p_expires_on, p_verification_url
  );

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-IDN-030', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    return query select identity.professional_credential_projection(receipt.aggregate_id), true;
    return;
  end if;

  select credential_row.* into previous_credential
  from identity.professional_credentials as credential_row
  join identity.professional_profiles as profile on profile.id = credential_row.professional_profile_id
  where credential_row.id = p_credential_id
    and profile.person_id = p_person_id
  for update of credential_row;

  if previous_credential.id is null then
    raise exception 'professional credential not found' using errcode = 'P0002';
  end if;
  if previous_credential.status <> 'active' then
    raise exception 'professional credential is not active' using errcode = '23505';
  end if;
  if previous_credential.credential_type_code = p_credential_type_code
     and previous_credential.issuer = btrim(p_issuer)
     and previous_credential.name = btrim(p_name)
     and previous_credential.identifier is not distinct from nullif(btrim(p_identifier), '')
     and previous_credential.issued_on is not distinct from p_issued_on
     and previous_credential.expires_on is not distinct from p_expires_on
     and previous_credential.verification_url is not distinct from p_verification_url then
    raise exception 'credential revision must change material content' using errcode = '23505';
  end if;

  update identity.professional_credentials
  set status = 'retired', retired_at = clock_timestamp()
  where id = previous_credential.id;

  insert into identity.professional_credentials (
    professional_profile_id,
    credential_type_code,
    issuer,
    name,
    identifier,
    issued_on,
    expires_on,
    verification_url,
    supersedes_credential_id
  ) values (
    previous_credential.professional_profile_id,
    p_credential_type_code,
    btrim(p_issuer),
    btrim(p_name),
    nullif(btrim(p_identifier), ''),
    p_issued_on,
    p_expires_on,
    p_verification_url,
    previous_credential.id
  )
  returning id into successor_id;

  perform system.enqueue_outbox_event(
    'professional_credential',
    successor_id,
    'identity.professional_credential_revised.v1',
    jsonb_build_object(
      'professional_credential_id', successor_id,
      'supersedes_credential_id', previous_credential.id,
      'professional_profile_id', previous_credential.professional_profile_id,
      'credential_type_code', p_credential_type_code
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'professional-credential-revised', 'professional_credential', successor_id
  );

  return query select identity.professional_credential_projection(successor_id), false;
end
$function$;

create or replace function identity.retire_professional_credential(
  p_person_id uuid,
  p_credential_id uuid,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (credential jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  target_credential identity.professional_credentials%rowtype;
begin
  perform identity.require_professional_actor(p_person_id);

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-IDN-031', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    return query select identity.professional_credential_projection(receipt.aggregate_id), true;
    return;
  end if;

  select credential_row.* into target_credential
  from identity.professional_credentials as credential_row
  join identity.professional_profiles as profile on profile.id = credential_row.professional_profile_id
  where credential_row.id = p_credential_id
    and profile.person_id = p_person_id
  for update of credential_row;

  if target_credential.id is null then
    raise exception 'professional credential not found' using errcode = 'P0002';
  end if;
  if target_credential.status <> 'active' then
    raise exception 'professional credential is not active' using errcode = '23505';
  end if;

  update identity.professional_credentials
  set status = 'retired', retired_at = clock_timestamp()
  where id = target_credential.id;

  perform system.enqueue_outbox_event(
    'professional_credential',
    target_credential.id,
    'identity.professional_credential_retired.v1',
    jsonb_build_object(
      'professional_credential_id', target_credential.id,
      'professional_profile_id', target_credential.professional_profile_id
    )
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'professional-credential-retired', 'professional_credential', target_credential.id
  );

  return query select identity.professional_credential_projection(target_credential.id), false;
end
$function$;

alter function system.enqueue_outbox_event(text, uuid, text, jsonb) owner to allfit_owner;
alter function privacy.log_access_event(uuid, uuid, text, uuid, text, text, uuid) owner to allfit_owner;
alter function catalog.list_professional_specialties() owner to allfit_owner;
alter function catalog.list_professional_credential_types() owner to allfit_owner;
alter function identity.require_professional_actor(uuid) owner to allfit_owner;
alter function identity.professional_credential_projection(uuid) owner to allfit_owner;
alter function identity.professional_profile_projection(uuid) owner to allfit_owner;
alter function identity.get_my_professional_context(uuid, uuid) owner to allfit_owner;
alter function identity.put_professional_profile(uuid, text, text, integer, text[], uuid, uuid, bytea) owner to allfit_owner;
alter function identity.validate_professional_credential_input(text, text, text, text, date, date, text) owner to allfit_owner;
alter function identity.declare_professional_credential(uuid, text, text, text, text, date, date, text, uuid, uuid, bytea) owner to allfit_owner;
alter function identity.revise_professional_credential(uuid, uuid, text, text, text, text, date, date, text, uuid, uuid, bytea) owner to allfit_owner;
alter function identity.retire_professional_credential(uuid, uuid, uuid, uuid, bytea) owner to allfit_owner;

revoke all on function system.enqueue_outbox_event(text, uuid, text, jsonb) from public, allfit_api;
revoke all on function privacy.log_access_event(uuid, uuid, text, uuid, text, text, uuid) from public, allfit_api;
revoke all on function catalog.list_professional_specialties() from public;
revoke all on function catalog.list_professional_credential_types() from public;
revoke all on function identity.require_professional_actor(uuid) from public, allfit_api;
revoke all on function identity.professional_credential_projection(uuid) from public, allfit_api;
revoke all on function identity.professional_profile_projection(uuid) from public, allfit_api;
revoke all on function identity.get_my_professional_context(uuid, uuid) from public;
revoke all on function identity.put_professional_profile(uuid, text, text, integer, text[], uuid, uuid, bytea) from public;
revoke all on function identity.validate_professional_credential_input(text, text, text, text, date, date, text) from public, allfit_api;
revoke all on function identity.declare_professional_credential(uuid, text, text, text, text, date, date, text, uuid, uuid, bytea) from public;
revoke all on function identity.revise_professional_credential(uuid, uuid, text, text, text, text, date, date, text, uuid, uuid, bytea) from public;
revoke all on function identity.retire_professional_credential(uuid, uuid, uuid, uuid, bytea) from public;

grant execute on function catalog.list_professional_specialties() to allfit_api;
grant execute on function catalog.list_professional_credential_types() to allfit_api;
grant execute on function identity.get_my_professional_context(uuid, uuid) to allfit_api;
grant execute on function identity.put_professional_profile(uuid, text, text, integer, text[], uuid, uuid, bytea) to allfit_api;
grant execute on function identity.declare_professional_credential(uuid, text, text, text, text, date, date, text, uuid, uuid, bytea) to allfit_api;
grant execute on function identity.revise_professional_credential(uuid, uuid, text, text, text, text, date, date, text, uuid, uuid, bytea) to allfit_api;
grant execute on function identity.retire_professional_credential(uuid, uuid, uuid, uuid, bytea) to allfit_api;

alter default privileges for role allfit_owner revoke execute on functions from public;
alter default privileges for role allfit_owner revoke all on tables from public;
