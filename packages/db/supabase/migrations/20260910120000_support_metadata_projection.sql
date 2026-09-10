-- Minimised support projection for `OP-SUP-005`.
--
-- One projection serves `HU-BO-006` (find a person) and `HU-BO-007` (open their
-- operational state). It carries identifiers, states, timestamps and counters —
-- never names, never a full contact, never the identity provider's subject.
--
-- Two decisions are written into this migration and are worth reading before
-- changing it.
--
-- **Where a fruitless search is recorded.** `HU-BO-006` criterion 4 requires the
-- search to be recorded even when it finds nobody, and `privacy.access_events`
-- cannot hold that: `ck_access_events_subject_xor` demands exactly one subject
-- and a search that matched nothing has none. Rather than weaken a privacy
-- invariant to fit a row that is not an access, this adds
-- `support.metadata_queries`. `access_events` records reaching someone's data; a
-- search that found nobody reached nobody's.
--
-- **What the projection cannot say yet.** `HU-BO-007` criterion 2 asks to see
-- that relationships, plan, Premium and permissions exist. The `relationships`
-- and `payments` schemas are not created and `privacy` holds only access events,
-- so those four blocks report `not_modelled`. Criterion 5 already forbids
-- showing unknown as zero or false; this goes one step further, because the
-- worse error is letting an operator read "no relationships" as a fact about the
-- person when it is a fact about us.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Masking
-- ---------------------------------------------------------------------------

-- A fixed-width mask on purpose: a mask that tracked the real length would leak
-- it. What survives is only enough to confirm against what the person said in
-- their case.
create or replace function support.mask_email(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when p_value is null then null
    when position('@' in p_value) = 0 then repeat('•', 8)
    else repeat('•', 8)
      || right(split_part(p_value, '@', 1), 2)
      || '@'
      || split_part(p_value, '@', 2)
  end
$function$;

create or replace function support.mask_phone(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case when p_value is null then null else repeat('•', 6) || right(p_value, 4) end
$function$;

-- ---------------------------------------------------------------------------
-- The record of every metadata search
-- ---------------------------------------------------------------------------

-- The case reference is checked against a shape, not merely against emptiness:
-- without that the field fills up with descriptions of the problem instead of
-- something an auditor can follow back to a case.
create table support.metadata_queries (
  id uuid not null default extensions.uuid_generate_v7(),
  actor_person_id uuid not null,
  actor_session_id uuid not null,
  case_reference text not null,
  lookup_kind text not null,
  -- The looked-up value never lands here in clear. A digest still proves two
  -- searches were for the same thing, which is what an auditor needs.
  lookup_hash bytea not null,
  result_count integer not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint pk_metadata_queries primary key (id),
  constraint fk_metadata_queries_actor foreign key (actor_person_id) references identity.people (id) on delete restrict,
  constraint ck_metadata_queries_lookup_kind check (lookup_kind in ('identifier', 'email', 'phone')),
  constraint ck_metadata_queries_case_reference check (case_reference ~ '^[A-Z][A-Z0-9_-]{2,63}$'),
  constraint ck_metadata_queries_lookup_hash check (octet_length(lookup_hash) = 32),
  constraint ck_metadata_queries_result_count check (result_count >= 0)
);

create index idx_metadata_queries_actor on support.metadata_queries (actor_person_id, occurred_at desc);
create index idx_metadata_queries_case on support.metadata_queries (case_reference, occurred_at desc);

alter table support.metadata_queries enable row level security;
alter table support.metadata_queries force row level security;

-- No client reaches this table: the surface that produces a row never reads one
-- back. The audit slice that will read it is `HU-BO-030`, and it opens this
-- policy for its own duty when it lands.
create policy metadata_queries_select_none on support.metadata_queries for select using (false);

-- `force row level security` applies to the owner too, so the closed function
-- has to satisfy a policy like anyone else. That is an opportunity rather than a
-- nuisance: the row can only name an actor who actually holds the duty at the
-- moment it is written, so a forged record naming somebody else is refused by
-- the table, not only by the function that writes it.
create policy metadata_queries_insert_diagnostician on support.metadata_queries
for insert
with check (
  access_control.has_platform_duty(
    actor_person_id, actor_session_id, 'diagnose_support_metadata'
  )
);

comment on table support.metadata_queries is
  'Every OP-SUP-005 search, including the ones that found nobody. Append-only.';

create or replace function support.reject_metadata_query_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'the record of a support search is append-only' using errcode = '55000';
end
$function$;

create trigger trg_metadata_queries_immutable
before update or delete on support.metadata_queries
for each row execute function support.reject_metadata_query_mutation();

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

create or replace function support.require_support_diagnostician(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
    or not access_control.has_platform_duty(
      p_actor_person_id, p_actor_session_id, 'diagnose_support_metadata'
    ) then
    raise exception 'reading support metadata requires an effective duty'
      using errcode = '42501';
  end if;
end
$function$;

-- ---------------------------------------------------------------------------
-- The projection
-- ---------------------------------------------------------------------------

create or replace view support.v_support_metadata as
select
  person.id as person_id,
  person.status::text as account_status,
  person.created_at,
  person.activated_at,
  support.mask_email(person.contact_email::text) as contact_email_masked,
  support.mask_phone(person.contact_phone) as contact_phone_masked,
  person.contact_email_verified_at as email_verified_at,
  person.contact_phone_verified_at as phone_verified_at,
  exists (
    select 1 from identity.access_accounts as account where account.person_id = person.id
  ) as has_access_account,
  (
    select min(account.linked_at)
    from identity.access_accounts as account
    where account.person_id = person.id
  ) as access_account_linked_at,
  (
    select count(*)
    from identity.access_sessions as session
    join identity.access_accounts as account on account.id = session.access_account_id
    where account.person_id = person.id
      and session.revoked_at is null
      and session.absolute_expires_at > clock_timestamp()
  ) as active_session_count,
  (
    select max(session.last_activity_at)
    from identity.access_sessions as session
    join identity.access_accounts as account on account.id = session.access_account_id
    where account.person_id = person.id
  ) as last_seen_at,
  exists (
    select 1 from identity.professional_profiles as profile where profile.person_id = person.id
  ) as has_professional_profile,
  (
    select count(*)
    from organizations.organization_memberships as membership
    where membership.person_id = person.id
  ) as membership_count,
  (
    select count(*)
    from organizations.organization_memberships as membership
    where membership.person_id = person.id and membership.status = 'active'
  ) as active_membership_count,
  -- The four blocks `HU-BO-007` criterion 2 asks for that have no table behind
  -- them yet. They stay together here so the slice that creates each schema has
  -- one obvious place to change.
  'not_modelled'::text as relationships_availability,
  'not_modelled'::text as plan_availability,
  'not_modelled'::text as premium_availability,
  'not_modelled'::text as permissions_availability
from identity.people as person;

comment on view support.v_support_metadata is
  'OP-SUP-005 minimised projection. Never names, full contacts or provider subjects.';

-- ---------------------------------------------------------------------------
-- OP-SUP-005 — find a person
-- ---------------------------------------------------------------------------

-- Exact match only, on a value the person handed over in their own case. There
-- is no exploratory search by name, so the function does not accept one: the
-- absence is in the signature, not in a validation that could be relaxed later.
create or replace function support.search_people(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_case_reference text,
  p_lookup_kind text,
  p_lookup_value text
)
returns table (result jsonb)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  matched uuid;
  found jsonb;
begin
  perform support.require_support_diagnostician(p_actor_person_id, p_actor_session_id);

  if p_lookup_kind not in ('identifier', 'email', 'phone') then
    raise exception 'a support search is by identifier, email or phone' using errcode = '22023';
  end if;
  if p_lookup_value is null or btrim(p_lookup_value) = '' then
    raise exception 'a support search needs a value to match exactly' using errcode = '22023';
  end if;

  select person.id into matched
  from identity.people as person
  where case p_lookup_kind
    when 'identifier' then person.id::text = btrim(p_lookup_value)
    when 'email' then lower(person.contact_email::text) = lower(btrim(p_lookup_value))
    else person.contact_phone = btrim(p_lookup_value)
  end;

  -- Recorded before the answer travels, and recorded whether or not it matched:
  -- a fruitless search is exactly the one worth being able to review later.
  insert into support.metadata_queries (
    actor_person_id, actor_session_id, case_reference, lookup_kind, lookup_hash, result_count
  ) values (
    p_actor_person_id,
    p_actor_session_id,
    btrim(p_case_reference),
    p_lookup_kind,
    extensions.digest(lower(btrim(p_lookup_value)), 'sha256'),
    case when matched is null then 0 else 1 end
  );

  if matched is null then
    return;
  end if;

  select to_jsonb(metadata) into found
  from support.v_support_metadata as metadata
  where metadata.person_id = matched;

  return query select found;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-SUP-005 — open the operational state
-- ---------------------------------------------------------------------------

create or replace function support.person_metadata(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_case_reference text,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  found jsonb;
begin
  perform support.require_support_diagnostician(p_actor_person_id, p_actor_session_id);

  if btrim(coalesce(p_case_reference, '')) !~ '^[A-Z][A-Z0-9_-]{2,63}$' then
    raise exception 'a support read needs a traceable case reference' using errcode = '22023';
  end if;

  select to_jsonb(metadata) into found
  from support.v_support_metadata as metadata
  where metadata.person_id = p_person_id;

  if found is null then
    raise exception 'person not found in the support projection' using errcode = 'P0002';
  end if;

  -- The read is recorded against the person before the content is returned. The
  -- ritual is the same as everywhere else: if the record fails, the read fails.
  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, resource_id, purpose, result,
    request_id, access_mode
  ) values (
    p_actor_person_id,
    p_person_id,
    'support.v_support_metadata',
    p_person_id,
    'support_diagnosis',
    'allowed',
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    -- `live` because the read reaches current data, not a frozen copy and not a
    -- break-glass window. `privacy.access_mode` has no support-specific value
    -- and adding one changes a privacy type, so what says "why" is `purpose`.
    'live'::privacy.access_mode
  );

  return found;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function support.mask_email(text) owner to allfit_owner;
alter function support.mask_phone(text) owner to allfit_owner;
alter function support.reject_metadata_query_mutation() owner to allfit_owner;
alter function support.require_support_diagnostician(uuid, uuid) owner to allfit_owner;
alter function support.search_people(uuid, uuid, text, text, text) owner to allfit_owner;
alter function support.person_metadata(uuid, uuid, text, uuid) owner to allfit_owner;
alter table support.metadata_queries owner to allfit_owner;
alter view support.v_support_metadata owner to allfit_owner;

revoke all on function support.mask_email(text) from public;
revoke all on function support.mask_phone(text) from public;
revoke all on function support.require_support_diagnostician(uuid, uuid) from public;
revoke all on function support.search_people(uuid, uuid, text, text, text) from public;
revoke all on function support.person_metadata(uuid, uuid, text, uuid) from public;
revoke all on table support.metadata_queries from public;
revoke all on table support.v_support_metadata from public;

-- The runtime role executes the two operations and nothing else: not the guard
-- that decides whether it may, not the projection it reads from, and not the
-- record it writes.
grant execute on function support.search_people(uuid, uuid, text, text, text) to allfit_api;
grant execute on function support.person_metadata(uuid, uuid, text, uuid) to allfit_api;
