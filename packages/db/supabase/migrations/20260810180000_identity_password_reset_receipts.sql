-- Idempotent local-session revocation after WorkOS completes a password reset.
-- The receipt deliberately stores neither the provider payload nor identity PII.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type identity.password_reset_receipt_result as enum (
  'processed',
  'account_absent'
);

alter type identity.password_reset_receipt_result owner to allfit_owner;

create table identity.password_reset_receipts (
  id uuid default extensions.uuid_generate_v7(),
  provider text not null,
  issuer text not null,
  provider_event_id text not null,
  occurred_at timestamptz not null,
  access_account_id uuid,
  result identity.password_reset_receipt_result,
  revoked_session_count integer not null default 0,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  constraint pk_password_reset_receipts primary key (id),
  constraint fk_password_reset_receipts_access_account foreign key (access_account_id) references identity.access_accounts(id) on delete restrict,
  constraint uq_password_reset_receipts_provider_issuer_event
    unique (provider, issuer, provider_event_id),
  constraint ck_password_reset_receipts_provider check (provider = 'workos'),
  constraint ck_password_reset_receipts_issuer check (btrim(issuer) <> ''),
  constraint ck_password_reset_receipts_provider_event_id check (btrim(provider_event_id) <> ''),
  constraint ck_password_reset_receipts_revoked_session_count check (revoked_session_count >= 0),
  constraint ck_password_reset_receipts_processing_state check (
    (result is null and processed_at is null)
    or (result is not null and processed_at is not null)
  )
);

create index idx_password_reset_receipts_access_account_id
  on identity.password_reset_receipts (access_account_id)
  where access_account_id is not null;

alter table identity.password_reset_receipts owner to allfit_owner;
alter table identity.password_reset_receipts enable row level security;
alter table identity.password_reset_receipts force row level security;

create policy password_reset_receipts_all_owner
  on identity.password_reset_receipts
  for all to allfit_owner
  using (true)
  with check (true);

revoke all on identity.password_reset_receipts from public, allfit_api;

create or replace function identity.process_password_reset_succeeded(
  p_provider text,
  p_issuer text,
  p_provider_event_id text,
  p_subject text,
  p_occurred_at timestamptz
)
returns table (
  outcome text,
  revoked_session_count integer,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_receipt_id uuid;
  v_access_account_id uuid;
  v_result identity.password_reset_receipt_result;
  v_revoked_session_count integer := 0;
begin
  if p_provider <> 'workos'
    or btrim(p_issuer) = ''
    or btrim(p_provider_event_id) = ''
    or btrim(p_subject) = ''
    or p_occurred_at is null then
    raise exception 'invalid password reset event' using errcode = '22023';
  end if;

  insert into identity.password_reset_receipts (
    provider,
    issuer,
    provider_event_id,
    occurred_at
  ) values (
    p_provider,
    p_issuer,
    p_provider_event_id,
    p_occurred_at
  )
  on conflict (provider, issuer, provider_event_id) do nothing
  returning id into v_receipt_id;

  if v_receipt_id is null then
    select receipt.result, receipt.revoked_session_count
      into v_result, v_revoked_session_count
    from identity.password_reset_receipts as receipt
    where receipt.provider = p_provider
      and receipt.issuer = p_issuer
      and receipt.provider_event_id = p_provider_event_id;

    if v_result is null then
      raise exception 'password reset receipt did not finish' using errcode = '40001';
    end if;

    return query select v_result::text, v_revoked_session_count, true;
    return;
  end if;

  select account.id
    into v_access_account_id
  from identity.access_accounts as account
  where account.provider = p_provider
    and account.issuer = p_issuer
    and account.subject = p_subject;

  if v_access_account_id is null then
    v_result := 'account_absent';
  else
    update identity.access_sessions as session
    set revoked_at = clock_timestamp()
    where session.access_account_id = v_access_account_id
      and session.revoked_at is null
      and session.created_at <= p_occurred_at;

    get diagnostics v_revoked_session_count = row_count;
    v_result := 'processed';
  end if;

  update identity.password_reset_receipts
  set access_account_id = v_access_account_id,
      result = v_result,
      revoked_session_count = v_revoked_session_count,
      processed_at = clock_timestamp()
  where id = v_receipt_id;

  return query select v_result::text, v_revoked_session_count, false;
end
$function$;

alter function identity.process_password_reset_succeeded(text, text, text, text, timestamptz)
  owner to allfit_owner;
revoke all on function identity.process_password_reset_succeeded(text, text, text, text, timestamptz)
  from public;
grant execute on function identity.process_password_reset_succeeded(text, text, text, text, timestamptz)
  to allfit_api;
