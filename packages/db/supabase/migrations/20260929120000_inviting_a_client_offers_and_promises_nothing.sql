-- OP-REL-001 — invite a person as a client.
--
-- What this creates is an invitation and an offer: the scopes asked for, the
-- level wanted and the purpose declared. It creates no person, no account, no
-- relationship, no grant and no assignment. Those come only if the person
-- accepts, and they accept each option separately.
--
-- The offer is fixed here and cannot be added to later. An organization gets
-- one chance to say what it is asking for, which is what keeps "accepting a
-- relationship" from turning into "accepting whatever comes next".
--
-- Reissuing to the same contact with the same offer reuses the pending
-- invitation rather than stacking a second one, the way team invitations
-- already do. The proposal hash covers the scopes too, so changing what is
-- asked for makes it a different proposal — as it should, since the person
-- would be answering a different question.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- How a client invitation is reported back: the contact only as a hint, and
-- the scopes by code. The offer's wording lives in the options themselves and
-- is read by the person deciding, not by the organization that sent it.
create or replace function identity.client_invitation_projection(p_invitation_id uuid)
returns table (
  invitation_id uuid,
  invitation_intent_id uuid,
  status text,
  channel text,
  contact_hint text,
  expires_at timestamptz,
  scope_codes text[]
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    invitation.id,
    intent.id,
    invitation.status::text,
    invitation.channel,
    -- First letter, then the domain. String functions rather than a
    -- backreference: a backslash escape did not survive being written into
    -- this file, and the hint silently came back as just the asterisks.
    left(invitation.contact::text, 1) || '***'
      || substring(invitation.contact::text from position('@' in invitation.contact::text)),
    invitation.expires_at,
    coalesce(
      (
        select array_agg(option.scope_code order by option.scope_code)
        from privacy.invitation_scope_options as option
        where option.invitation_intent_id = intent.id
      ),
      array[]::text[]
    )
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'service_relationship'
  where invitation.id = p_invitation_id;
$function$;

alter function identity.client_invitation_projection(uuid) owner to allfit_owner;
revoke all on function identity.client_invitation_projection(uuid) from public, allfit_api;

create or replace function identity.issue_client_invitation(
  p_person_id uuid,
  p_organization_id uuid,
  p_channel text,
  p_contact text,
  p_scope_options jsonb,
  p_token_hash bytea,
  p_token_key_version smallint,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  invitation_id uuid,
  invitation_intent_id uuid,
  status text,
  channel text,
  contact_hint text,
  expires_at timestamptz,
  scope_codes text[],
  reused boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  actor_membership_id uuid;
  organization_snapshot jsonb;
  normalized_contact text;
  computed_proposal_hash bytea;
  offered_codes text[];
  domain_reused boolean := false;
  replay_reused boolean := false;
  existing_invitation_id uuid;
  target_invitation_id uuid;
  target_intent_id uuid;
  option jsonb;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  normalized_contact := lower(btrim(p_contact));
  if p_channel <> 'email'
     or length(normalized_contact) not between 3 and 254
     or normalized_contact !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or octet_length(p_token_hash) <> 32
     or p_token_key_version <= 0
     or jsonb_typeof(p_scope_options) <> 'array'
     or jsonb_array_length(p_scope_options) = 0 then
    raise exception 'invalid client invitation' using errcode = '22023';
  end if;

  -- Every option names a published scope, a level and a purpose. Validating
  -- here rather than leaning on the insert keeps a half-written invitation
  -- from ever existing.
  for option in select value from jsonb_array_elements(p_scope_options) loop
    if jsonb_typeof(option) <> 'object'
       or coalesce(option->>'scope_code', '') = ''
       or coalesce(option->>'access_level', '') not in ('read', 'contribute')
       or btrim(coalesce(option->>'purpose', '')) = ''
       or jsonb_typeof(option->'presented_snapshot') <> 'object' then
      raise exception 'invalid client invitation scope option' using errcode = '22023';
    end if;
  end loop;

  select array_agg(value->>'scope_code' order by value->>'scope_code')
  into offered_codes
  from jsonb_array_elements(p_scope_options);

  if array_length(offered_codes, 1) <> (
    select count(distinct code) from unnest(offered_codes) as code
  ) then
    raise exception 'a scope may only be offered once' using errcode = '22023';
  end if;

  select membership.id, organization.responsible_party
  into actor_membership_id, organization_snapshot
  from organizations.organizations as organization
  join organizations.organization_memberships as membership
    on membership.organization_id = organization.id
   and membership.person_id = p_person_id
   and membership.status = 'active'
  where organization.id = p_organization_id
    and organization.status = 'active';

  if actor_membership_id is null then
    raise exception 'organization membership not found' using errcode = 'P0002';
  end if;
  if not access_control.has_capability(p_organization_id, 'invite_clients') then
    raise exception 'invite_clients capability required' using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-REL-001', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    select outcome_code = 'client-invitation-reused' into replay_reused
    from system.idempotency_keys
    where id = receipt.receipt_id;

    if receipt.aggregate_id is null then
      raise exception 'idempotent client invitation not found' using errcode = '40001';
    end if;
    return query
    select projection.*, coalesce(replay_reused, false), true
    from identity.client_invitation_projection(receipt.aggregate_id) as projection;
    return;
  end if;

  -- The offer is part of the proposal: asking for different scopes is a
  -- different question, so it must not reuse the invitation that asked the
  -- previous one.
  computed_proposal_hash := extensions.digest(
    convert_to(
      p_organization_id::text || chr(31) || p_channel || chr(31) || normalized_contact
        || chr(31) || 'service_relationship' || chr(31) || array_to_string(offered_codes, ','),
      'UTF8'
    ),
    'sha256'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(encode(computed_proposal_hash, 'hex'), 0)
  );

  update identity.invitations as invitation
  set status = 'expired'
  where invitation.organization_id = p_organization_id
    and invitation.status = 'pending'
    and invitation.expires_at <= clock_timestamp();
  update identity.invitation_intents as intent
  set status = 'expired', decided_at = clock_timestamp()
  from identity.invitations as invitation
  where intent.invitation_id = invitation.id
    and invitation.organization_id = p_organization_id
    and invitation.status = 'expired'
    and intent.status = 'pending';

  select invitation.id into existing_invitation_id
  from identity.invitations as invitation
  where invitation.organization_id = p_organization_id
    and invitation.proposal_hash = computed_proposal_hash
    and invitation.status = 'pending'
    and invitation.expires_at > clock_timestamp()
  for update;

  if existing_invitation_id is not null then
    domain_reused := true;
    target_invitation_id := existing_invitation_id;
    update identity.invitations as invitation
    set expires_at = clock_timestamp() + interval '7 days'
    where invitation.id = target_invitation_id;
    select intent.id into target_intent_id
    from identity.invitation_intents as intent
    where intent.invitation_id = target_invitation_id
      and intent.kind = 'service_relationship';
  else
    target_invitation_id := p_command_id;
    insert into identity.invitations (
      id, organization_id, issued_by_membership_id, channel, contact,
      token_hash, token_key_version, proposal_hash, responsible_party, expires_at
    ) values (
      target_invitation_id, p_organization_id, actor_membership_id, p_channel,
      normalized_contact, p_token_hash, p_token_key_version, computed_proposal_hash,
      organization_snapshot, clock_timestamp() + interval '7 days'
    );
    insert into identity.invitation_intents (invitation_id, kind)
    values (target_invitation_id, 'service_relationship')
    returning id into target_intent_id;

    insert into privacy.invitation_scope_options (
      invitation_intent_id, scope_definition_id, scope_code,
      offered_access_level, purpose, presented_snapshot
    )
    select
      target_intent_id,
      definition.id,
      offer->>'scope_code',
      (offer->>'access_level')::privacy.access_level,
      btrim(offer->>'purpose'),
      offer->'presented_snapshot'
    -- `offer`, not `option`: the loop above declares a variable of that name
    -- and PostgreSQL cannot tell which one a bare reference means.
    from jsonb_array_elements(p_scope_options) as offer
    join lateral (
      -- The newest published version of that scope, frozen onto the option so
      -- a later publication cannot change what was asked for.
      select scope.id
      from privacy.scope_definitions as scope
      where scope.scope_code = offer->>'scope_code'
        and scope.status = 'published'
      order by scope.version_number desc
      limit 1
    ) as definition on true;

    if not found then
      raise exception 'no published scope definition for the offer' using errcode = '22023';
    end if;
  end if;

  perform system.enqueue_outbox_event(
    'invitation',
    target_invitation_id,
    'relationship.client_invited.v1',
    jsonb_build_object('invitation_id', target_invitation_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id,
    case when domain_reused then 200 else 201 end::smallint,
    case when domain_reused then 'client-invitation-reused' else 'client-invitation-created' end,
    'invitation',
    target_invitation_id
  );

  return query
  select projection.*, domain_reused, false
  from identity.client_invitation_projection(target_invitation_id) as projection;
end
$function$;

alter function identity.issue_client_invitation(
  uuid, uuid, text, text, jsonb, bytea, smallint, uuid, uuid, bytea
) owner to allfit_owner;
revoke all on function identity.issue_client_invitation(
  uuid, uuid, text, text, jsonb, bytea, smallint, uuid, uuid, bytea
) from public;
grant execute on function identity.issue_client_invitation(
  uuid, uuid, text, text, jsonb, bytea, smallint, uuid, uuid, bytea
) to allfit_api;
