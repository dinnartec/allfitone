-- NEW-IDN-RESEND / OP-IDN-051 — resending a gym's client invitation (`HU-BO-011`).
--
-- The team and ownership halves shipped with `OP-IDN-052` and `OP-ORG-021`. This is
-- the client half, which was waiting for `relationships`. The verification half is
-- still waiting for Space to be able to change a contact: nothing creates a contact
-- verification yet, so there is nothing to resend, and nothing here pretends there is.
--
-- **A client invitation is an offer, and a resend must offer the same thing.** That is
-- the one real difference from the team half. A team invitation proposes a role — one
-- column the reissue copies. A client invitation proposes a set of scopes that live in
-- `privacy.invitation_scope_options`, under a policy written for the organization that
-- asked and the person it was addressed to. Support is neither. Two things follow.
--
-- First, support is given a read of the offer, because the operator has to see what
-- they are resending and the reissue has to copy it. The offer is a request, not an
-- answer: it names no person, carries no health data, and the contact only ever
-- leaves as a hint. The duty is `diagnose_support_metadata`, the same one that
-- resends a team invitation.
--
-- Second — and this is the part that matters if the policy ever regresses — the
-- database refuses a reissued client invitation whose offer does not match the
-- original's. `proposal_hash` already covers the scope codes, so recomputing it from
-- the options actually written and comparing it to the hash the reissue inherited
-- catches a changed set **and** an empty one. A copy that silently read nothing
-- fails the checksum instead of mailing somebody an invitation that asks for
-- nothing. The levels and purposes are compared against the original as well.
--
-- Everything else is the team half's behaviour, deliberately: a live invitation is
-- redelivered and keeps its token, a lapsed one is reissued once and the lapsed one
-- stays lapsed, an accepted, declined, revoked or already-reissued one is never
-- resent, every resend is recorded, and support is held to the destination window
-- Studio consumes.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Support reads what the invitation asked for
-- ---------------------------------------------------------------------------

-- Additive: the organization's and the invited person's own reads are untouched.
create policy invitation_scope_options_select_resender
  on privacy.invitation_scope_options
  for select to allfit_owner
  using (access_control.holds_backoffice_duty('diagnose_support_metadata'));

-- ---------------------------------------------------------------------------
-- A reissued client invitation offers exactly what the original offered
-- ---------------------------------------------------------------------------

create or replace function privacy.enforce_reissued_offer_matches()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  intent_id uuid;
  invitation_id uuid;
  original_intent_id uuid;
  invitation identity.invitations%rowtype;
  written_codes text[];
  rebuilt_hash bytea;
begin
  -- Branching, not a `case` expression: that would resolve both field references
  -- against whichever `new` fired, and neither table has the other's column.
  if tg_table_name = 'invitation_intents' then
    intent_id := new.id;
  else
    intent_id := new.invitation_intent_id;
  end if;

  -- Only a client intent, and only a reissued one, has an offer to match. Everything
  -- else — a team intent, a first invitation — leaves here.
  select intent.invitation_id into invitation_id
  from identity.invitation_intents as intent
  where intent.id = intent_id
    and intent.kind = 'service_relationship';
  if invitation_id is null then
    return null;
  end if;

  select * into invitation
  from identity.invitations as candidate
  where candidate.id = invitation_id;
  if invitation.reissues_invitation_id is null then
    return null;
  end if;

  select intent.id into original_intent_id
  from identity.invitation_intents as intent
  where intent.invitation_id = invitation.reissues_invitation_id
    and intent.kind = 'service_relationship';

  select coalesce(array_agg(option.scope_code order by option.scope_code), array[]::text[])
  into written_codes
  from privacy.invitation_scope_options as option
  where option.invitation_intent_id = intent_id;

  -- The hash the reissue inherited is the checksum of the original offer, so an offer
  -- that was changed — or never copied, because nothing could read it — cannot match.
  rebuilt_hash := extensions.digest(
    convert_to(
      invitation.organization_id::text || chr(31) || invitation.channel || chr(31)
        || lower(invitation.contact::text) || chr(31) || 'service_relationship'
        || chr(31) || array_to_string(written_codes, ','),
      'UTF8'
    ),
    'sha256'
  );
  if rebuilt_hash is distinct from invitation.proposal_hash then
    raise exception 'a reissued client invitation offers exactly what the original offered'
      using errcode = '23514';
  end if;

  -- The codes are right; the level, purpose and version each was asked under must be.
  if exists (
    select scope_code, scope_definition_id, offered_access_level, purpose
    from privacy.invitation_scope_options
    where invitation_intent_id = intent_id
    except
    select scope_code, scope_definition_id, offered_access_level, purpose
    from privacy.invitation_scope_options
    where invitation_intent_id = original_intent_id
  ) or exists (
    select scope_code, scope_definition_id, offered_access_level, purpose
    from privacy.invitation_scope_options
    where invitation_intent_id = original_intent_id
    except
    select scope_code, scope_definition_id, offered_access_level, purpose
    from privacy.invitation_scope_options
    where invitation_intent_id = intent_id
  ) then
    raise exception 'a reissued client invitation offers exactly what the original offered'
      using errcode = '23514';
  end if;
  return null;
end
$function$;
alter function privacy.enforce_reissued_offer_matches() owner to allfit_owner;

-- Deferred, and on both tables: the options are written after the intent, and an
-- intent with no options at all must still be caught.
create constraint trigger trg_invitation_intents_after_reissued_offer
after insert or update on identity.invitation_intents
deferrable initially deferred
for each row execute function privacy.enforce_reissued_offer_matches();

create constraint trigger trg_invitation_scope_options_after_reissued_offer
after insert or update on privacy.invitation_scope_options
deferrable initially deferred
for each row execute function privacy.enforce_reissued_offer_matches();

-- ---------------------------------------------------------------------------
-- How a client invitation is reported to Backoffice
-- ---------------------------------------------------------------------------

-- The contact is a hint and the offer travels as codes: support recognises the
-- address and sees what was asked for, and reads neither back.
create or replace function identity.backoffice_client_invitation_projection(p_invitation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'invitation_id', invitation.id,
    'state', case
      when invitation.status::text = 'revoked' then 'revoked'
      when intent.status::text = 'accepted' then 'accepted'
      when intent.status::text = 'rejected' then 'rejected'
      when invitation.status::text = 'expired'
        or (invitation.status::text = 'pending' and invitation.expires_at <= clock_timestamp())
        then 'expired'
      else 'pending'
    end,
    'scope_codes', coalesce(
      (
        select jsonb_agg(option.scope_code order by option.scope_code)
        from privacy.invitation_scope_options as option
        where option.invitation_intent_id = intent.id
      ),
      '[]'::jsonb
    ),
    'contact_hint',
      left(split_part(invitation.contact::text, '@', 1), 1) || '***@'
        || split_part(invitation.contact::text, '@', 2),
    'created_at', invitation.created_at,
    'expires_at', invitation.expires_at,
    'issued_by', case when invitation.issued_by_person_id is null then 'member' else 'allfit' end,
    'reissues_invitation_id', invitation.reissues_invitation_id,
    'resendable', organization.status = 'active' and (
      (invitation.status::text = 'pending' and invitation.expires_at > clock_timestamp())
      or (
        (invitation.status::text = 'expired'
          or (invitation.status::text = 'pending' and invitation.expires_at <= clock_timestamp()))
        and intent.status::text in ('pending', 'expired')
        and not exists (
          select 1 from identity.invitations as reissue
          where reissue.reissues_invitation_id = invitation.id
        )
        and not exists (
          select 1 from identity.invitations as equal
          where equal.organization_id = invitation.organization_id
            and equal.proposal_hash = invitation.proposal_hash
            and equal.id <> invitation.id
            and equal.status::text = 'pending'
            and equal.expires_at > clock_timestamp()
        )
      )
    ),
    'last_resent_at', (
      select max(resend.created_at)
      from identity.invitation_resends as resend
      where resend.invitation_id = invitation.id
    )
  )
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'service_relationship'
  join organizations.organizations as organization on organization.id = invitation.organization_id
  where invitation.id = p_invitation_id
$function$;
alter function identity.backoffice_client_invitation_projection(uuid) owner to allfit_owner;
revoke all on function identity.backoffice_client_invitation_projection(uuid)
  from public, allfit_api;

-- ---------------------------------------------------------------------------
-- NEW-IDN-RESEND — a gym's client invitations
-- ---------------------------------------------------------------------------

create or replace function identity.list_backoffice_client_invitations(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  listed_count integer;
begin
  perform identity.require_invitation_resender(p_actor_person_id, p_actor_session_id);

  if not exists (
    select 1 from organizations.organizations as organization
    where organization.id = p_organization_id
  ) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select count(*)::integer into listed_count
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'service_relationship'
  where invitation.organization_id = p_organization_id;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'items', coalesce((
      select jsonb_agg(
        identity.backoffice_client_invitation_projection(newest.id)
        order by newest.created_at desc, newest.id desc
      )
      from (
        select invitation.id, invitation.created_at
        from identity.invitations as invitation
        join identity.invitation_intents as intent
          on intent.invitation_id = invitation.id
         and intent.kind = 'service_relationship'
        where invitation.organization_id = p_organization_id
        order by invitation.created_at desc, invitation.id desc
        limit 50
      ) as newest
    ), '[]'::jsonb),
    'truncated', listed_count > 50
  );
end
$function$;
alter function identity.list_backoffice_client_invitations(uuid, uuid, uuid) owner to allfit_owner;
revoke all on function identity.list_backoffice_client_invitations(uuid, uuid, uuid) from public;
grant execute on function identity.list_backoffice_client_invitations(uuid, uuid, uuid)
  to allfit_api;

-- ---------------------------------------------------------------------------
-- OP-IDN-051 — resend a client invitation
-- ---------------------------------------------------------------------------

create or replace function identity.resend_client_invitation(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_organization_id uuid,
  p_invitation_id uuid,
  p_token_hash bytea,
  p_token_key_version smallint,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (result jsonb, replayed boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  duty_id uuid;
  receipt record;
  response jsonb;
  organization_state organizations.organization_status;
  target identity.invitations%rowtype;
  target_intent identity.invitation_intents%rowtype;
  reissued_intent_id uuid;
  lapsed boolean;
  delivered uuid;
  resend_outcome text;
begin
  duty_id := identity.require_invitation_resender(p_actor_person_id, p_actor_session_id);
  if p_token_hash is null
     or octet_length(p_token_hash) <> 32
     or p_token_key_version is null
     or p_token_key_version <= 0 then
    raise exception 'invalid client invitation resend' using errcode = '22023';
  end if;

  select organization.status into organization_state
  from organizations.organizations as organization
  where organization.id = p_organization_id
  for update;
  if organization_state is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select invitation.* into target
  from identity.invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.organization_id = p_organization_id
  for update;
  select intent.* into target_intent
  from identity.invitation_intents as intent
  where intent.invitation_id = p_invitation_id
    and intent.kind = 'service_relationship';
  if target.id is null or target_intent.id is null then
    raise exception 'client invitation not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-IDN-051', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := identity.backoffice_client_invitation_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent client invitation resend not found' using errcode = '40001';
    end if;
    return query select
      response || jsonb_build_object(
        'outcome',
        case when receipt.aggregate_id = p_invitation_id then 'redelivered' else 'reissued' end
      ),
      true;
    return;
  end if;

  if organization_state <> 'active' then
    raise exception 'only an operating organization has client invitations to resend'
      using errcode = '55000';
  end if;

  lapsed := target.status::text = 'expired'
    or (target.status::text = 'pending' and target.expires_at <= clock_timestamp());

  if target.status::text = 'pending' and not lapsed then
    resend_outcome := 'redelivered';
    delivered := target.id;
  elsif lapsed and target_intent.status::text in ('pending', 'expired') then
    if exists (
      select 1 from identity.invitations as reissue
      where reissue.reissues_invitation_id = target.id
    ) then
      raise exception 'this invitation was already reissued; resend the new one'
        using errcode = '55000';
    end if;
    if exists (
      select 1 from identity.invitations as equal
      where equal.organization_id = target.organization_id
        and equal.proposal_hash = target.proposal_hash
        and equal.id <> target.id
        and equal.status::text = 'pending'
        and equal.expires_at > clock_timestamp()
    ) then
      raise exception 'an equal invitation is already pending' using errcode = '55000';
    end if;
    resend_outcome := 'reissued';
    delivered := p_command_id;
  else
    raise exception 'only a pending or expired invitation is resent' using errcode = '55000';
  end if;

  -- The windows Studio consumes, so support's mail counts against the same limits.
  perform system.consume_invitation_rate_window(
    'actor_hour',
    extensions.digest(convert_to(p_actor_person_id::text, 'UTF8'), 'sha256'),
    interval '1 hour',
    20
  );
  perform system.consume_invitation_rate_window(
    'destination_day',
    extensions.digest(
      convert_to(target.organization_id::text || chr(31) || lower(target.contact::text), 'UTF8'),
      'sha256'
    ),
    interval '24 hours',
    3
  );

  if resend_outcome = 'redelivered' then
    update identity.invitations as invitation
    set expires_at = clock_timestamp() + interval '7 days'
    where invitation.id = target.id;

    perform system.enqueue_outbox_event(
      'invitation', target.id, 'relationship.client_invited.v1',
      jsonb_build_object('invitation_id', target.id)
    );
  else
    if target.status::text = 'pending' then
      update identity.invitations as invitation
      set status = 'expired'
      where invitation.id = target.id;
      perform system.enqueue_outbox_event(
        'invitation', target.id, 'identity.invitation_expired.v1',
        jsonb_build_object('invitation_id', target.id)
      );
    end if;
    update identity.invitation_intents as intent
    set status = 'expired', decided_at = clock_timestamp()
    where intent.invitation_id = target.id
      and intent.status = 'pending';

    insert into identity.invitations (
      id, organization_id, issued_by_person_id, issued_by_duty_assignment_id,
      reissues_invitation_id, channel, contact, token_hash, token_key_version, proposal_hash,
      responsible_party, expires_at
    )
    select p_command_id, organization.id, p_actor_person_id, duty_id,
           target.id, target.channel, target.contact, p_token_hash, p_token_key_version,
           target.proposal_hash, organization.responsible_party,
           clock_timestamp() + interval '7 days'
    from organizations.organizations as organization
    where organization.id = target.organization_id;
    insert into identity.invitation_intents (invitation_id, kind)
    values (p_command_id, 'service_relationship')
    returning id into reissued_intent_id;

    -- The offer, exactly as it was asked, under the version it was asked under. The
    -- constraint trigger rejects the transaction if this copied anything else.
    insert into privacy.invitation_scope_options (
      invitation_intent_id, scope_definition_id, scope_code,
      offered_access_level, purpose, presented_snapshot_schema_version, presented_snapshot
    )
    select reissued_intent_id, option.scope_definition_id, option.scope_code,
           option.offered_access_level, option.purpose,
           option.presented_snapshot_schema_version, option.presented_snapshot
    from privacy.invitation_scope_options as option
    where option.invitation_intent_id = target_intent.id;

    perform system.enqueue_outbox_event(
      'invitation', p_command_id, 'relationship.client_invited.v1',
      jsonb_build_object('invitation_id', p_command_id)
    );
  end if;

  insert into identity.invitation_resends (
    invitation_id, delivered_invitation_id, kind, outcome, actor_person_id,
    actor_duty_assignment_id
  ) values (
    target.id, delivered, 'service_relationship', resend_outcome, p_actor_person_id, duty_id
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'client-invitation-resent', 'invitation', delivered
  );
  return query select
    identity.backoffice_client_invitation_projection(delivered)
      || jsonb_build_object('outcome', resend_outcome),
    false;
end
$function$;
alter function identity.resend_client_invitation(
  uuid, uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) owner to allfit_owner;
revoke all on function identity.resend_client_invitation(
  uuid, uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) from public;
grant execute on function identity.resend_client_invitation(
  uuid, uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) to allfit_api;
