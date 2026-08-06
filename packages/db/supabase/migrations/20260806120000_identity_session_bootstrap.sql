-- Identity and Studio session bootstrap.
-- WorkOS authenticates; PostgreSQL resolves the domain actor and stores only
-- encrypted provider tokens behind narrow SECURITY DEFINER functions.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'allfit_owner') then
    create role allfit_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'allfit_migrator') then
    create role allfit_migrator login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'allfit_api') then
    create role allfit_api login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$roles$;

grant allfit_owner to allfit_migrator;

-- Supabase CLI applies migrations through its environment-specific migration
-- login. Membership is required to assign deterministic ownership without
-- assuming that login is a superuser or hard-coding its provider-owned name.
do $migration_role$
begin
  execute format('grant allfit_owner to %I', current_user);
  execute format('grant allfit_api to %I', current_user);
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres') then
    grant allfit_api to postgres;
  end if;
end
$migration_role$;

create schema if not exists extensions;
create schema if not exists identity authorization allfit_owner;
create schema if not exists access_control authorization allfit_owner;

revoke all on schema identity from public;
revoke all on schema access_control from public;
grant usage, create on schema extensions to allfit_owner;
grant usage on schema identity, access_control, extensions to allfit_api;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create or replace function extensions.uuid_generate_v7()
returns uuid
language plpgsql
volatile
parallel safe
set search_path = pg_catalog
as $function$
declare
  unix_milliseconds bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  bytes bytea := decode(lpad(to_hex(unix_milliseconds), 12, '0'), 'hex') || extensions.gen_random_bytes(10);
begin
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
  return encode(bytes, 'hex')::uuid;
end
$function$;

create or replace function extensions.uuid_is_v7(value uuid)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $function$
  select (get_byte(uuid_send(value), 6) >> 4) = 7
    and (get_byte(uuid_send(value), 8) >> 6) = 2
$function$;

create or replace function extensions.uuid_v7_timestamp(value uuid)
returns timestamptz
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $function$
  select to_timestamp((
    get_byte(uuid_send(value), 0)::bigint * 1099511627776
    + get_byte(uuid_send(value), 1)::bigint * 4294967296
    + get_byte(uuid_send(value), 2)::bigint * 16777216
    + get_byte(uuid_send(value), 3)::bigint * 65536
    + get_byte(uuid_send(value), 4)::bigint * 256
    + get_byte(uuid_send(value), 5)::bigint
  ) / 1000.0)
$function$;

alter function extensions.uuid_generate_v7() owner to allfit_owner;
alter function extensions.uuid_is_v7(uuid) owner to allfit_owner;
alter function extensions.uuid_v7_timestamp(uuid) owner to allfit_owner;
revoke all on function extensions.uuid_generate_v7() from public;
revoke all on function extensions.uuid_is_v7(uuid) from public;
revoke all on function extensions.uuid_v7_timestamp(uuid) from public;
grant execute on function extensions.uuid_generate_v7() to allfit_api;
grant execute on function extensions.uuid_is_v7(uuid) to allfit_api;
grant execute on function extensions.uuid_v7_timestamp(uuid) to allfit_api;

create type identity.actor_kind as enum (
  'anonymous',
  'account',
  'person',
  'professional',
  'worker',
  'support'
);
create type identity.person_status as enum ('active', 'closed');
create type identity.access_session_surface as enum ('studio');

alter type identity.actor_kind owner to allfit_owner;
alter type identity.person_status owner to allfit_owner;
alter type identity.access_session_surface owner to allfit_owner;

create table identity.people (
  id uuid primary key default extensions.uuid_generate_v7(),
  given_name text not null check (btrim(given_name) <> ''),
  family_name text not null check (btrim(family_name) <> ''),
  display_name text generated always as (btrim(given_name || ' ' || family_name)) stored,
  contact_email extensions.citext,
  contact_email_verified_at timestamptz,
  contact_phone text,
  contact_phone_verified_at timestamptz,
  status identity.person_status not null default 'active',
  activated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint people_email_verification_chk check (contact_email_verified_at is null or contact_email is not null),
  constraint people_phone_verification_chk check (contact_phone_verified_at is null or contact_phone is not null)
);

create unique index people_contact_email_uidx on identity.people (contact_email) where contact_email is not null;
create unique index people_contact_phone_uidx on identity.people (contact_phone) where contact_phone is not null;

create table identity.access_accounts (
  id uuid primary key default extensions.uuid_generate_v7(),
  provider text not null check (provider = 'workos'),
  issuer text not null check (btrim(issuer) <> ''),
  subject text not null check (btrim(subject) <> ''),
  person_id uuid references identity.people(id) on delete restrict,
  linked_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint access_accounts_provider_issuer_subject_key unique (provider, issuer, subject)
);

create index access_accounts_person_id_idx on identity.access_accounts (person_id);

create table identity.access_sessions (
  id uuid primary key default extensions.uuid_generate_v7(),
  access_account_id uuid not null references identity.access_accounts(id) on delete restrict,
  provider_session_id text not null check (btrim(provider_session_id) <> ''),
  surface identity.access_session_surface not null,
  token_hash bytea not null check (octet_length(token_hash) = 32),
  token_ciphertext text not null check (token_ciphertext like 'v1.%'),
  access_token_expires_at timestamptz not null,
  token_version integer not null default 1 check (token_version > 0),
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint access_sessions_surface_provider_session_key unique (surface, provider_session_id),
  constraint access_sessions_token_hash_key unique (token_hash)
);

create index access_sessions_account_id_idx on identity.access_sessions (access_account_id);
create index access_sessions_active_idx on identity.access_sessions (access_account_id, surface) where revoked_at is null;

alter table identity.people owner to allfit_owner;
alter table identity.access_accounts owner to allfit_owner;
alter table identity.access_sessions owner to allfit_owner;

create or replace function access_control.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

alter function access_control.set_updated_at() owner to allfit_owner;
revoke all on function access_control.set_updated_at() from public;

create trigger people_set_updated_at
before update on identity.people
for each row execute function access_control.set_updated_at();

create trigger access_accounts_set_updated_at
before update on identity.access_accounts
for each row execute function access_control.set_updated_at();

create trigger access_sessions_set_updated_at
before update on identity.access_sessions
for each row execute function access_control.set_updated_at();

create or replace function access_control.actor_kind()
returns identity.actor_kind
language sql
stable
parallel safe
set search_path = pg_catalog
as $function$
  select coalesce(nullif(current_setting('app.actor_kind', true), ''), 'anonymous')::identity.actor_kind
$function$;

create or replace function access_control.account()
returns uuid
language sql
stable
parallel safe
set search_path = pg_catalog
as $function$
  select nullif(current_setting('app.actor_account_id', true), '')::uuid
$function$;

create or replace function access_control.person()
returns uuid
language sql
stable
parallel safe
set search_path = pg_catalog
as $function$
  select nullif(current_setting('app.actor_person_id', true), '')::uuid
$function$;

create or replace function access_control.is_self(target_person_id uuid)
returns boolean
language sql
stable
parallel safe
set search_path = pg_catalog
as $function$
  select target_person_id is not null and target_person_id = access_control.person()
$function$;

alter function access_control.actor_kind() owner to allfit_owner;
alter function access_control.account() owner to allfit_owner;
alter function access_control.person() owner to allfit_owner;
alter function access_control.is_self(uuid) owner to allfit_owner;
revoke all on function access_control.actor_kind() from public;
revoke all on function access_control.account() from public;
revoke all on function access_control.person() from public;
revoke all on function access_control.is_self(uuid) from public;
grant execute on function access_control.actor_kind() to allfit_api;
grant execute on function access_control.account() to allfit_api;
grant execute on function access_control.person() to allfit_api;
grant execute on function access_control.is_self(uuid) to allfit_api;

alter table identity.people enable row level security;
alter table identity.people force row level security;
alter table identity.access_accounts enable row level security;
alter table identity.access_accounts force row level security;
alter table identity.access_sessions enable row level security;
alter table identity.access_sessions force row level security;

create policy people_owner_manage on identity.people
  for all to allfit_owner using (true) with check (true);
create policy people_read_self on identity.people
  for select to allfit_api using (access_control.is_self(id));

create policy access_accounts_owner_manage on identity.access_accounts
  for all to allfit_owner using (true) with check (true);
create policy access_accounts_read_self on identity.access_accounts
  for select to allfit_api
  using (id = access_control.account() or person_id = access_control.person());

create policy access_sessions_owner_manage on identity.access_sessions
  for all to allfit_owner using (true) with check (true);

revoke all on identity.people from public, allfit_api;
revoke all on identity.access_accounts from public, allfit_api;
revoke all on identity.access_sessions from public, allfit_api;
grant select on identity.people, identity.access_accounts to allfit_api;

create or replace function identity.resolve_or_create_access_account(
  p_provider text,
  p_issuer text,
  p_subject text
)
returns table (account_id uuid, person_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if p_provider <> 'workos' or btrim(p_issuer) = '' or btrim(p_subject) = '' then
    raise exception 'invalid external identity' using errcode = '22023';
  end if;

  insert into identity.access_accounts (provider, issuer, subject)
  values (p_provider, p_issuer, p_subject)
  on conflict (provider, issuer, subject) do nothing;

  return query
  select account.id, account.person_id
  from identity.access_accounts as account
  where account.provider = p_provider
    and account.issuer = p_issuer
    and account.subject = p_subject;
end
$function$;

create or replace function identity.create_access_session(
  p_access_account_id uuid,
  p_provider_session_id text,
  p_surface identity.access_session_surface,
  p_token_hash bytea,
  p_token_ciphertext text,
  p_access_token_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  result_id uuid;
begin
  insert into identity.access_sessions (
    access_account_id,
    provider_session_id,
    surface,
    token_hash,
    token_ciphertext,
    access_token_expires_at
  ) values (
    p_access_account_id,
    p_provider_session_id,
    p_surface,
    p_token_hash,
    p_token_ciphertext,
    p_access_token_expires_at
  )
  on conflict (surface, provider_session_id) do update
  set access_account_id = excluded.access_account_id,
      token_hash = excluded.token_hash,
      token_ciphertext = excluded.token_ciphertext,
      access_token_expires_at = excluded.access_token_expires_at,
      token_version = identity.access_sessions.token_version + 1,
      revoked_at = null
  returning id into result_id;

  return result_id;
end
$function$;

create or replace function identity.load_access_session(
  p_token_hash bytea,
  p_surface identity.access_session_surface
)
returns table (
  session_id uuid,
  account_id uuid,
  person_id uuid,
  external_subject text,
  provider_session_id text,
  token_ciphertext text,
  access_token_expires_at timestamptz,
  token_version integer,
  person_status text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    session.id,
    session.access_account_id,
    account.person_id,
    account.subject,
    session.provider_session_id,
    session.token_ciphertext,
    session.access_token_expires_at,
    session.token_version,
    person.status::text
  from identity.access_sessions as session
  join identity.access_accounts as account on account.id = session.access_account_id
  left join identity.people as person on person.id = account.person_id
  where session.token_hash = p_token_hash
    and session.surface = p_surface
    and session.revoked_at is null
$function$;

create or replace function identity.rotate_access_session(
  p_session_id uuid,
  p_expected_token_version integer,
  p_token_ciphertext text,
  p_access_token_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update identity.access_sessions
  set token_ciphertext = p_token_ciphertext,
      access_token_expires_at = p_access_token_expires_at,
      token_version = token_version + 1
  where id = p_session_id
    and token_version = p_expected_token_version
    and revoked_at is null;

  return found;
end
$function$;

create or replace function identity.revoke_access_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update identity.access_sessions
  set revoked_at = coalesce(revoked_at, clock_timestamp())
  where id = p_session_id;

  return found;
end
$function$;

alter function identity.resolve_or_create_access_account(text, text, text) owner to allfit_owner;
alter function identity.create_access_session(uuid, text, identity.access_session_surface, bytea, text, timestamptz) owner to allfit_owner;
alter function identity.load_access_session(bytea, identity.access_session_surface) owner to allfit_owner;
alter function identity.rotate_access_session(uuid, integer, text, timestamptz) owner to allfit_owner;
alter function identity.revoke_access_session(uuid) owner to allfit_owner;

revoke all on function identity.resolve_or_create_access_account(text, text, text) from public;
revoke all on function identity.create_access_session(uuid, text, identity.access_session_surface, bytea, text, timestamptz) from public;
revoke all on function identity.load_access_session(bytea, identity.access_session_surface) from public;
revoke all on function identity.rotate_access_session(uuid, integer, text, timestamptz) from public;
revoke all on function identity.revoke_access_session(uuid) from public;

grant execute on function identity.resolve_or_create_access_account(text, text, text) to allfit_api;
grant execute on function identity.create_access_session(uuid, text, identity.access_session_surface, bytea, text, timestamptz) to allfit_api;
grant execute on function identity.load_access_session(bytea, identity.access_session_surface) to allfit_api;
grant execute on function identity.rotate_access_session(uuid, integer, text, timestamptz) to allfit_api;
grant execute on function identity.revoke_access_session(uuid) to allfit_api;

alter default privileges for role allfit_owner revoke execute on functions from public;
alter default privileges for role allfit_owner revoke all on tables from public;
