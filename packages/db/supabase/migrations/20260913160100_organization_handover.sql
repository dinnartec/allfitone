-- Handing an organization Allfit created to its owner: OP-ORG-018, its resend
-- (OP-ORG-021) and its cancellation (OP-ORG-022). `HU-BO-014` and `HU-BO-015`.
--
-- **Allfit creates, the owner claims, and nobody operates in between.** The
-- organization is born `unclaimed` with no members, an optional site, and one
-- ownership invitation to an email — never to a person id. Accepting flips it to
-- `active` and makes the recipient its owner in the same transaction. In the interval
-- Allfit can only resend that invitation or cancel the creation.
--
-- **Who acted is a column, not an absence.** Organization events and invitations
-- named the acting membership, and Allfit's team has none. Both tables now also carry
-- the acting person and the duty assignment they acted under, and a check requires
-- exactly one authorship. A missing membership never stands for "Allfit did it".
--
-- **Allfit never writes a person's name.** A company is named at creation. A natural
-- person is named from their own identity when they accept, so an unclaimed
-- natural-person organization carries no responsible name until then. The check this
-- replaces let *any* organization omit that name — a missing key evaluates to null and
-- a null check passes — so the new one is stricter for everything else.
--
-- **Kinds do not cross.** An ownership intent only exists on an invitation Allfit
-- issued for an unclaimed organization, and a team intent only on one a member issued.
-- The Studio team functions already filter by kind, so an ownership token never opens
-- as a team invitation.
--
-- **Whoever hands an organization over cannot claim it.** Otherwise a team member
-- could create a gym for their own email and own it with nobody else taking part.
--
-- `OP-ORG-021` and `OP-ORG-022` are new codes: idempotency receipts only accept the
-- `OP-*` form, and the operations matrix records both.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Who is responsible
-- ---------------------------------------------------------------------------

alter table organizations.organizations
  drop constraint ck_organizations_responsible_party,
  add constraint ck_organizations_responsible_party check (
    jsonb_typeof(responsible_party) = 'object'
    and coalesce(responsible_party->>'party_kind', '') in ('natural_person', 'legal_entity')
    and coalesce(responsible_party->>'purpose', '') = 'studio_operations'
    and (
      coalesce(btrim(responsible_party->>'party_name'), '') <> ''
      or (
        status in ('unclaimed', 'cancelled')
        and responsible_party->>'party_kind' = 'natural_person'
        and not responsible_party ? 'party_name'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Authorship
-- ---------------------------------------------------------------------------

alter table identity.invitations
  alter column issued_by_membership_id drop not null,
  add column issued_by_person_id uuid,
  add column issued_by_duty_assignment_id uuid,
  add constraint fk_invitations_platform_issuer foreign key (issued_by_person_id)
    references identity.people(id) on delete restrict,
  add constraint fk_invitations_platform_issuer_duty foreign key (issued_by_duty_assignment_id)
    references support.platform_duty_assignments(id) on delete restrict,
  add constraint ck_invitations_issuer check (
    (issued_by_membership_id is not null
      and issued_by_person_id is null
      and issued_by_duty_assignment_id is null)
    or (issued_by_membership_id is null
      and issued_by_person_id is not null
      and issued_by_duty_assignment_id is not null)
  );

alter table identity.invitation_intents
  add constraint ck_invitation_intents_ownership_role check (
    (kind = 'ownership') = (proposed_role_code is not distinct from 'owner')
  );

alter table organizations.organization_events
  add column actor_person_id uuid,
  add column actor_duty_assignment_id uuid,
  add constraint fk_organization_events_actor_person foreign key (actor_person_id)
    references identity.people(id) on delete restrict,
  add constraint fk_organization_events_actor_duty foreign key (actor_duty_assignment_id)
    references support.platform_duty_assignments(id) on delete restrict,
  add constraint ck_organization_events_platform_actor check (
    (actor_person_id is null) = (actor_duty_assignment_id is null)
    and not (actor_membership_id is not null and actor_person_id is not null)
    and (
      event_type not in ('organization.created_unclaimed.v1', 'organization.cancelled.v1')
      or actor_person_id is not null
    )
    and (event_type <> 'organization.claimed.v1' or actor_membership_id is not null)
  ),
  drop constraint ck_organization_events_snapshot_pair,
  add constraint ck_organization_events_snapshot_pair check (
    (event_type in (
      'organization.created.v1', 'organization.created_unclaimed.v1',
      'organization.site_created.v1', 'organization.ownership_transferred.v1',
      'organization.claimed.v1'
    ) and before_snapshot is null and after_snapshot is not null)
    or (event_type in (
      'organization.updated.v1', 'organization.site_updated.v1', 'organization.cancelled.v1'
    ) and before_snapshot is not null and after_snapshot is not null)
  );

-- A kind is decided by who issued the invitation and whether the organization
-- operates; neither is visible from the intent row alone.
create or replace function identity.invitation_intent_issuer_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  platform_issued boolean;
  organization_state organizations.organization_status;
begin
  select invitation.issued_by_person_id is not null, organization.status
  into platform_issued, organization_state
  from identity.invitations as invitation
  join organizations.organizations as organization on organization.id = invitation.organization_id
  where invitation.id = new.invitation_id;

  if new.kind = 'ownership'
     and not (coalesce(platform_issued, false) and organization_state = 'unclaimed') then
    raise exception 'an ownership intent belongs to an invitation Allfit issued for an unclaimed organization'
      using errcode = '23514';
  end if;
  if new.kind <> 'ownership' and coalesce(platform_issued, false) then
    raise exception 'only a member issues a team or client intent' using errcode = '23514';
  end if;
  return new;
end
$function$;

create trigger trg_invitation_intents_before_insert_issuer
before insert on identity.invitation_intents
for each row execute function identity.invitation_intent_issuer_tg();

-- ---------------------------------------------------------------------------
-- Event snapshot contracts
-- ---------------------------------------------------------------------------

create or replace function system.validate_json_contract(
  p_contract_code text,
  p_schema_version smallint,
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = pg_catalog
as $function$
declare
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  timestamp_pattern constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$';
begin
  if p_schema_version <> 1 or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  if p_contract_code = 'audit.organization_event_snapshot' then
    if system.jsonb_has_exact_keys(
      p_payload,
      array['type_code', 'legal_name', 'display_name', 'status', 'revision_number']
    ) then
      return jsonb_typeof(p_payload->'type_code') = 'string'
        and p_payload->>'type_code' in ('professional_practice', 'gym', 'studio')
        and jsonb_typeof(p_payload->'legal_name') in ('string', 'null')
        and (jsonb_typeof(p_payload->'legal_name') = 'null'
          or btrim(p_payload->>'legal_name') <> '')
        and jsonb_typeof(p_payload->'display_name') = 'string'
        and char_length(btrim(p_payload->>'display_name')) between 1 and 120
        and jsonb_typeof(p_payload->'status') = 'string'
        and p_payload->>'status' in ('unclaimed', 'active', 'closed', 'cancelled')
        and jsonb_typeof(p_payload->'revision_number') = 'number'
        and p_payload->>'revision_number' ~ '^(0|[1-9][0-9]*)$';
    end if;

    if system.jsonb_has_exact_keys(
      p_payload,
      array['site_id', 'name', 'address', 'status', 'revision_number']
    ) then
      return jsonb_typeof(p_payload->'site_id') = 'string'
        and p_payload->>'site_id' ~ uuid_pattern
        and jsonb_typeof(p_payload->'name') = 'string'
        and btrim(p_payload->>'name') <> ''
        and jsonb_typeof(p_payload->'address') in ('string', 'null')
        and (jsonb_typeof(p_payload->'address') = 'null'
          or btrim(p_payload->>'address') <> '')
        and jsonb_typeof(p_payload->'status') = 'string'
        and p_payload->>'status' in ('active', 'inactive')
        and jsonb_typeof(p_payload->'revision_number') = 'number'
        and p_payload->>'revision_number' ~ '^(0|[1-9][0-9]*)$';
    end if;

    if system.jsonb_has_exact_keys(
      p_payload,
      array['previous_owner_membership_id', 'owner_membership_id']
    ) then
      return jsonb_typeof(p_payload->'previous_owner_membership_id') = 'string'
        and p_payload->>'previous_owner_membership_id' ~ uuid_pattern
        and jsonb_typeof(p_payload->'owner_membership_id') = 'string'
        and p_payload->>'owner_membership_id' ~ uuid_pattern;
    end if;

    if system.jsonb_has_exact_keys(p_payload, array['owner_membership_id']) then
      return jsonb_typeof(p_payload->'owner_membership_id') = 'string'
        and p_payload->>'owner_membership_id' ~ uuid_pattern;
    end if;

    return false;
  end if;

  if p_contract_code = 'audit.membership_event_snapshot' then
    if system.jsonb_has_exact_keys(
      p_payload,
      array['organization_id', 'person_id', 'status']
    ) then
      return jsonb_typeof(p_payload->'organization_id') = 'string'
        and p_payload->>'organization_id' ~ uuid_pattern
        and jsonb_typeof(p_payload->'person_id') = 'string'
        and p_payload->>'person_id' ~ uuid_pattern
        and jsonb_typeof(p_payload->'status') = 'string'
        and p_payload->>'status' in ('active', 'terminated');
    end if;

    if system.jsonb_has_exact_keys(
      p_payload,
      array[
        'organization_id', 'person_id', 'status',
        'role_code', 'valid_from', 'valid_to'
      ]
    ) then
      return jsonb_typeof(p_payload->'organization_id') = 'string'
        and p_payload->>'organization_id' ~ uuid_pattern
        and jsonb_typeof(p_payload->'person_id') = 'string'
        and p_payload->>'person_id' ~ uuid_pattern
        and jsonb_typeof(p_payload->'status') = 'string'
        and p_payload->>'status' in ('active', 'terminated')
        and jsonb_typeof(p_payload->'role_code') = 'string'
        and p_payload->>'role_code' in ('owner', 'admin', 'coach', 'staff')
        and jsonb_typeof(p_payload->'valid_from') = 'string'
        and p_payload->>'valid_from' ~ timestamp_pattern
        and jsonb_typeof(p_payload->'valid_to') in ('string', 'null')
        and (jsonb_typeof(p_payload->'valid_to') = 'null'
          or p_payload->>'valid_to' ~ timestamp_pattern);
    end if;

    return false;
  end if;

  return false;
end
$function$;

create or replace function organizations.validate_organization_event_snapshot(
  p_event_type text,
  p_schema_version smallint,
  p_payload jsonb
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = pg_catalog
as $function$
  select system.validate_json_contract(
    'audit.organization_event_snapshot',
    p_schema_version,
    p_payload
  ) and case
    when p_event_type in (
      'organization.created.v1', 'organization.updated.v1',
      'organization.created_unclaimed.v1', 'organization.cancelled.v1'
    ) then
      system.jsonb_has_exact_keys(
        p_payload,
        array['type_code', 'legal_name', 'display_name', 'status', 'revision_number']
      )
    when p_event_type in ('organization.site_created.v1', 'organization.site_updated.v1') then
      system.jsonb_has_exact_keys(
        p_payload,
        array['site_id', 'name', 'address', 'status', 'revision_number']
      )
    when p_event_type = 'organization.ownership_transferred.v1' then
      system.jsonb_has_exact_keys(
        p_payload,
        array['previous_owner_membership_id', 'owner_membership_id']
      )
    when p_event_type = 'organization.claimed.v1' then
      system.jsonb_has_exact_keys(p_payload, array['owner_membership_id'])
    else false
  end
$function$;

-- ---------------------------------------------------------------------------
-- Authority and projection
-- ---------------------------------------------------------------------------

-- Returns the assignment acted under, so every record names it rather than
-- re-deriving it later from a duty that may have lapsed.
create or replace function organizations.require_organization_lifecycle_duty(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  assignment_id uuid;
begin
  if access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin')
     and access_control.has_platform_duty(
       p_actor_person_id, p_actor_session_id, 'manage_organization_lifecycle'
     ) then
    select assignment.id into assignment_id
    from support.platform_duty_assignments as assignment
    where assignment.person_id = p_actor_person_id
      and assignment.duty_code = 'manage_organization_lifecycle'
      and assignment.status = 'active'
      and clock_timestamp() >= assignment.valid_from
      and clock_timestamp() < assignment.valid_to
    order by assignment.valid_to desc
    limit 1;
  end if;

  if assignment_id is null then
    raise exception 'managing the organization lifecycle requires an effective duty'
      using errcode = '42501';
  end if;
  return assignment_id;
end
$function$;

-- The contact is shown as a hint: whoever resends needs to recognise the address,
-- not read it back.
create or replace function organizations.handover_projection(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'organization_id', organization.id,
    'display_name', organization.display_name,
    'type_code', organization.type_code,
    'type_name', organization_type.name,
    'party_kind', organization.responsible_party->>'party_kind',
    'legal_name', organization.legal_name,
    'status', organization.status,
    'created_at', organization.created_at,
    'claimed_at', organization.claimed_at,
    'cancelled_at', organization.cancelled_at,
    'site', (
      select jsonb_build_object('site_id', site.id, 'name', site.name, 'address', site.address)
      from organizations.organization_sites as site
      where site.organization_id = organization.id
      order by site.created_at, site.id
      limit 1
    ),
    'invitation', (
      select jsonb_build_object(
        'invitation_id', invitation.id,
        'status', invitation.status,
        'intent_status', intent.status,
        'contact_hint',
          left(split_part(invitation.contact::text, '@', 1), 1) || '***@'
            || split_part(invitation.contact::text, '@', 2),
        'expires_at', invitation.expires_at
      )
      from identity.invitations as invitation
      join identity.invitation_intents as intent
        on intent.invitation_id = invitation.id
       and intent.kind = 'ownership'
      where invitation.organization_id = organization.id
      order by invitation.created_at desc, invitation.id desc
      limit 1
    )
  )
  from organizations.organizations as organization
  join organizations.organization_types as organization_type
    on organization_type.code = organization.type_code
  where organization.id = p_organization_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-ORG-018 — create and hand over
-- ---------------------------------------------------------------------------

create or replace function organizations.create_unclaimed_organization(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_display_name text,
  p_type_code text,
  p_party_kind text,
  p_legal_name text,
  p_site_name text,
  p_site_address text,
  p_owner_email text,
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
  clean_display_name text := btrim(p_display_name);
  clean_legal_name text := nullif(btrim(p_legal_name), '');
  clean_site_name text := nullif(btrim(p_site_name), '');
  clean_site_address text := nullif(btrim(p_site_address), '');
  normalized_email text := lower(btrim(p_owner_email));
  party jsonb;
  created_organization_id uuid;
  created_site_id uuid;
begin
  duty_id := organizations.require_organization_lifecycle_duty(
    p_actor_person_id, p_actor_session_id
  );

  -- A natural person's name is never accepted here: it arrives with their own
  -- identity when they accept.
  if clean_display_name is null
     or char_length(clean_display_name) not between 1 and 120
     or coalesce(p_party_kind, '') not in ('natural_person', 'legal_entity')
     or (p_party_kind = 'legal_entity') is distinct from (clean_legal_name is not null)
     or (clean_site_address is not null and clean_site_name is null)
     or normalized_email is null
     or length(normalized_email) not between 3 and 254
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or p_token_hash is null
     or octet_length(p_token_hash) <> 32
     or p_token_key_version is null
     or p_token_key_version <= 0 then
    raise exception 'invalid organization handover' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from organizations.organization_types as organization_type
    where organization_type.code = p_type_code
      and organization_type.active
  ) then
    raise exception 'unsupported organization type' using errcode = '22023';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-ORG-018', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := organizations.handover_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent organization handover not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  party := jsonb_build_object('party_kind', p_party_kind, 'purpose', 'studio_operations')
    || case
      when p_party_kind = 'legal_entity' then jsonb_build_object('party_name', clean_legal_name)
      else '{}'::jsonb
    end;

  insert into organizations.organizations (
    type_code, legal_name, display_name, status, claimed_at, responsible_party
  ) values (
    p_type_code, clean_legal_name, clean_display_name, 'unclaimed', null, party
  )
  returning id into created_organization_id;

  insert into organizations.organization_events (
    organization_id, event_type, after_snapshot, actor_person_id, actor_duty_assignment_id
  )
  select organization.id,
         'organization.created_unclaimed.v1',
         jsonb_build_object(
           'type_code', organization.type_code,
           'legal_name', organization.legal_name,
           'display_name', organization.display_name,
           'status', organization.status,
           'revision_number', organization.revision_number
         ),
         p_actor_person_id,
         duty_id
  from organizations.organizations as organization
  where organization.id = created_organization_id;

  if clean_site_name is not null then
    insert into organizations.organization_sites (organization_id, name, address)
    values (created_organization_id, clean_site_name, clean_site_address)
    returning id into created_site_id;

    insert into organizations.organization_events (
      organization_id, event_type, after_snapshot, actor_person_id, actor_duty_assignment_id
    )
    select site.organization_id,
           'organization.site_created.v1',
           jsonb_build_object(
             'site_id', site.id,
             'name', site.name,
             'address', site.address,
             'status', site.status,
             'revision_number', site.revision_number
           ),
           p_actor_person_id,
           duty_id
    from organizations.organization_sites as site
    where site.id = created_site_id;
  end if;

  -- The invitation carries the command id, which is what the token is derived from.
  insert into identity.invitations (
    id, organization_id, issued_by_person_id, issued_by_duty_assignment_id, channel,
    contact, token_hash, token_key_version, proposal_hash, responsible_party, expires_at
  ) values (
    p_command_id, created_organization_id, p_actor_person_id, duty_id, 'email',
    normalized_email, p_token_hash, p_token_key_version,
    extensions.digest(
      convert_to(
        created_organization_id::text || chr(31) || 'email' || chr(31) || normalized_email
          || chr(31) || 'ownership' || chr(31) || 'owner',
        'UTF8'
      ),
      'sha256'
    ),
    party,
    clock_timestamp() + interval '7 days'
  );
  insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
  values (p_command_id, 'ownership', 'owner');

  perform system.enqueue_outbox_event(
    'organization', created_organization_id, 'organization.created_unclaimed.v1',
    jsonb_build_object('organization_id', created_organization_id, 'invitation_id', p_command_id)
  );
  perform system.enqueue_outbox_event(
    'invitation', p_command_id, 'organization.ownership_invited.v1',
    jsonb_build_object('invitation_id', p_command_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 201::smallint, 'organization-handover-created',
    'organization', created_organization_id
  );

  return query select organizations.handover_projection(created_organization_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-ORG-021 — resend the ownership invitation
-- ---------------------------------------------------------------------------

-- A live invitation is sent again as it is: its token derives from its id, so the
-- first email keeps working. A spent or lapsed one is replaced by a new invitation
-- to the same address, never to a different one.
create or replace function organizations.resend_ownership_invitation(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_organization_id uuid,
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
  latest identity.invitations%rowtype;
begin
  duty_id := organizations.require_organization_lifecycle_duty(
    p_actor_person_id, p_actor_session_id
  );
  if p_token_hash is null
     or octet_length(p_token_hash) <> 32
     or p_token_key_version is null
     or p_token_key_version <= 0 then
    raise exception 'invalid ownership invitation resend' using errcode = '22023';
  end if;

  select organization.status into organization_state
  from organizations.organizations as organization
  where organization.id = p_organization_id
  for update;
  if organization_state is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-ORG-021', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := organizations.handover_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent ownership resend not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  if organization_state <> 'unclaimed' then
    raise exception 'only an organization nobody has claimed has an invitation to resend'
      using errcode = '55000';
  end if;

  select invitation.* into latest
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'ownership'
  where invitation.organization_id = p_organization_id
  order by invitation.created_at desc, invitation.id desc
  limit 1
  for update of invitation;
  if latest.id is null then
    raise exception 'organization handover not found' using errcode = 'P0002';
  end if;

  if latest.status = 'pending' and latest.expires_at > clock_timestamp() then
    update identity.invitations as invitation
    set expires_at = clock_timestamp() + interval '7 days'
    where invitation.id = latest.id;

    perform system.enqueue_outbox_event(
      'invitation', latest.id, 'organization.ownership_invited.v1',
      jsonb_build_object('invitation_id', latest.id)
    );
  else
    if latest.status = 'pending' then
      update identity.invitations as invitation
      set status = 'expired'
      where invitation.id = latest.id;
      update identity.invitation_intents as intent
      set status = 'expired', decided_at = clock_timestamp()
      where intent.invitation_id = latest.id
        and intent.status = 'pending';
      perform system.enqueue_outbox_event(
        'invitation', latest.id, 'identity.invitation_expired.v1',
        jsonb_build_object('invitation_id', latest.id)
      );
    end if;

    insert into identity.invitations (
      id, organization_id, issued_by_person_id, issued_by_duty_assignment_id, channel,
      contact, token_hash, token_key_version, proposal_hash, responsible_party, expires_at
    )
    select p_command_id, organization.id, p_actor_person_id, duty_id, 'email',
           latest.contact, p_token_hash, p_token_key_version, latest.proposal_hash,
           organization.responsible_party, clock_timestamp() + interval '7 days'
    from organizations.organizations as organization
    where organization.id = p_organization_id;
    insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
    values (p_command_id, 'ownership', 'owner');

    perform system.enqueue_outbox_event(
      'invitation', p_command_id, 'organization.ownership_invited.v1',
      jsonb_build_object('invitation_id', p_command_id)
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'ownership-invitation-resent',
    'organization', p_organization_id
  );
  return query select organizations.handover_projection(p_organization_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-ORG-022 — cancel an organization nobody claimed
-- ---------------------------------------------------------------------------

create or replace function organizations.cancel_unclaimed_organization(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_organization_id uuid,
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
  target organizations.organizations%rowtype;
  withdrawn record;
begin
  duty_id := organizations.require_organization_lifecycle_duty(
    p_actor_person_id, p_actor_session_id
  );

  select organization.* into target
  from organizations.organizations as organization
  where organization.id = p_organization_id
  for update;
  if target.id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-ORG-022', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := organizations.handover_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent organization cancellation not found' using errcode = '40001';
    end if;
    return query select response, true;
    return;
  end if;

  -- Converges: a second cancellation records nothing new.
  if target.status = 'cancelled' then
    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'organization-handover-cancelled',
      'organization', p_organization_id
    );
    return query select organizations.handover_projection(p_organization_id), false;
    return;
  end if;
  if target.status <> 'unclaimed' then
    raise exception 'an organization with an owner is closed by its owner, not cancelled'
      using errcode = '55000';
  end if;

  update organizations.organizations as organization
  set status = 'cancelled', cancelled_at = clock_timestamp()
  where organization.id = p_organization_id;

  for withdrawn in
    update identity.invitations as invitation
    set status = 'revoked'
    where invitation.organization_id = p_organization_id
      and invitation.status = 'pending'
    returning invitation.id
  loop
    update identity.invitation_intents as intent
    set status = 'revoked', decided_at = clock_timestamp()
    where intent.invitation_id = withdrawn.id
      and intent.status = 'pending';
    perform system.enqueue_outbox_event(
      'invitation', withdrawn.id, 'identity.invitation_revoked.v1',
      jsonb_build_object('invitation_id', withdrawn.id)
    );
  end loop;

  insert into organizations.organization_events (
    organization_id, event_type, before_snapshot, after_snapshot,
    actor_person_id, actor_duty_assignment_id
  )
  select organization.id,
         'organization.cancelled.v1',
         jsonb_build_object(
           'type_code', target.type_code,
           'legal_name', target.legal_name,
           'display_name', target.display_name,
           'status', target.status,
           'revision_number', target.revision_number
         ),
         jsonb_build_object(
           'type_code', organization.type_code,
           'legal_name', organization.legal_name,
           'display_name', organization.display_name,
           'status', organization.status,
           'revision_number', organization.revision_number
         ),
         p_actor_person_id,
         duty_id
  from organizations.organizations as organization
  where organization.id = p_organization_id;

  perform system.enqueue_outbox_event(
    'organization', p_organization_id, 'organization.cancelled.v1',
    jsonb_build_object('organization_id', p_organization_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'organization-handover-cancelled',
    'organization', p_organization_id
  );
  return query select organizations.handover_projection(p_organization_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Reading a handover
-- ---------------------------------------------------------------------------

create or replace function organizations.read_organization_handover(
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
begin
  perform organizations.require_organization_lifecycle_duty(p_actor_person_id, p_actor_session_id);

  -- An organization its owner created was never handed over, so it has nothing here.
  if not exists (
    select 1
    from identity.invitations as invitation
    join identity.invitation_intents as intent
      on intent.invitation_id = invitation.id
     and intent.kind = 'ownership'
    where invitation.organization_id = p_organization_id
  ) then
    raise exception 'organization handover not found' using errcode = 'P0002';
  end if;

  return organizations.handover_projection(p_organization_id);
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-016 / OP-IDN-009 — the owner resolves and decides
-- ---------------------------------------------------------------------------

create or replace function identity.resolve_ownership_invitation(p_token_hash bytea)
returns table (
  invitation_id uuid,
  organization_id uuid,
  organization_display_name text,
  organization_type_name text,
  party_kind text,
  legal_name text,
  site_name text,
  expires_at timestamptz,
  invitation_intent_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  expired_invitation_id uuid;
begin
  if access_control.actor_kind() <> 'anonymous'
     or p_token_hash is null
     or octet_length(p_token_hash) <> 32 then
    raise exception 'anonymous invitation resolution required' using errcode = '42501';
  end if;

  update identity.invitations as invitation
  set status = 'expired'
  where invitation.token_hash = p_token_hash
    and invitation.status = 'pending'
    and invitation.expires_at <= clock_timestamp()
    and exists (
      select 1
      from identity.invitation_intents as intent
      where intent.invitation_id = invitation.id
        and intent.kind = 'ownership'
    )
  returning invitation.id into expired_invitation_id;

  if expired_invitation_id is not null then
    update identity.invitation_intents as intent
    set status = 'expired', decided_at = clock_timestamp()
    where intent.invitation_id = expired_invitation_id
      and intent.status = 'pending';
    perform system.enqueue_outbox_event(
      'invitation', expired_invitation_id, 'identity.invitation_expired.v1',
      jsonb_build_object('invitation_id', expired_invitation_id)
    );
    return;
  end if;

  return query
  select invitation.id,
         organization.id,
         organization.display_name,
         organization_type.name,
         organization.responsible_party->>'party_kind',
         organization.legal_name,
         (
           select site.name
           from organizations.organization_sites as site
           where site.organization_id = organization.id
           order by site.created_at, site.id
           limit 1
         ),
         invitation.expires_at,
         intent.id
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'ownership'
   and intent.status = 'pending'
  join organizations.organizations as organization
    on organization.id = invitation.organization_id
  join organizations.organization_types as organization_type
    on organization_type.code = organization.type_code
  where invitation.token_hash = p_token_hash
    and invitation.status = 'pending'
    and invitation.expires_at > clock_timestamp()
    and organization.status = 'unclaimed';
end
$function$;

create or replace function identity.decide_ownership_invitation(
  p_person_id uuid,
  p_token_hash bytea,
  p_intent_id uuid,
  p_decision text,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  invitation_id uuid,
  invitation_status text,
  organization_id uuid,
  invitation_intent_id uuid,
  intent_status text,
  membership_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
  receipt record;
  replay_result record;
  decision_time timestamptz := clock_timestamp();
  organization_row organizations.organizations%rowtype;
  claimer_name text;
  owner_membership_id uuid;
  owner_valid_from timestamptz;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
  if coalesce(p_decision, '') not in ('accepted', 'rejected')
     or p_token_hash is null
     or octet_length(p_token_hash) <> 32 then
    raise exception 'invalid invitation decision' using errcode = '22023';
  end if;

  select invitation.id,
         invitation.status,
         invitation.organization_id,
         invitation.contact::text as contact,
         invitation.expires_at,
         invitation.issued_by_person_id,
         intent.id as intent_id,
         intent.status as intent_status
  into target
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.id = p_intent_id
   and intent.kind = 'ownership'
  where invitation.token_hash = p_token_hash
  for update of invitation, intent;

  if target.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if lower(target.contact) is distinct from
     lower(nullif(current_setting('app.actor_verified_email', true), '')) then
    raise exception 'verified email mismatch' using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-IDN-009', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    select invitation.id,
           invitation.status::text as invitation_status,
           invitation.organization_id,
           intent.id as intent_id,
           intent.status::text as intent_status,
           intent.materialized_membership_id
    into replay_result
    from identity.invitations as invitation
    join identity.invitation_intents as intent on intent.invitation_id = invitation.id
    where invitation.id = receipt.aggregate_id
      and intent.id = p_intent_id;
    if replay_result.id is null
       or replay_result.intent_status not in ('accepted', 'rejected') then
      raise exception 'idempotent decision not found' using errcode = '40001';
    end if;
    return query select
      replay_result.id,
      replay_result.invitation_status,
      replay_result.organization_id,
      replay_result.intent_id,
      replay_result.intent_status,
      replay_result.materialized_membership_id,
      true;
    return;
  end if;

  if target.status <> 'pending'
     or target.intent_status <> 'pending'
     or target.expires_at <= decision_time then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if target.issued_by_person_id = p_person_id then
    raise exception 'whoever handed an organization over cannot claim it'
      using errcode = '42501';
  end if;

  select person.display_name into claimer_name
  from identity.people as person
  where person.id = p_person_id
    and person.status = 'active';
  if claimer_name is null then
    raise exception 'active person required' using errcode = '42501';
  end if;

  select organization.* into organization_row
  from organizations.organizations as organization
  where organization.id = target.organization_id
  for update;
  if organization_row.status is distinct from 'unclaimed' then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  if p_decision = 'accepted' then
    -- The organization operates before its owner is inserted: a member of an
    -- unclaimed organization is refused, and the owner invariant is checked at commit.
    update organizations.organizations as organization
    set status = 'active',
        claimed_at = decision_time,
        responsible_party = case
          when organization.responsible_party->>'party_kind' = 'natural_person'
            then organization.responsible_party || jsonb_build_object('party_name', claimer_name)
          else organization.responsible_party
        end
    where organization.id = target.organization_id;

    insert into organizations.organization_memberships (organization_id, person_id)
    values (target.organization_id, p_person_id)
    returning id into owner_membership_id;

    insert into organizations.membership_roles (membership_id, role_code)
    values (owner_membership_id, 'owner')
    returning valid_from into owner_valid_from;

    insert into organizations.membership_events (membership_id, event_type, "after")
    values (
      owner_membership_id,
      'organization.role_granted.v1',
      jsonb_build_object(
        'organization_id', target.organization_id,
        'person_id', p_person_id,
        'status', 'active',
        'role_code', 'owner',
        'valid_from', owner_valid_from,
        'valid_to', null
      )
    );

    update identity.invitation_intents as intent
    set status = 'accepted',
        materialized_membership_id = owner_membership_id,
        decided_at = decision_time
    where intent.id = target.intent_id;

    insert into organizations.organization_events (
      organization_id, event_type, after_snapshot, actor_membership_id
    ) values (
      target.organization_id,
      'organization.claimed.v1',
      jsonb_build_object('owner_membership_id', owner_membership_id),
      owner_membership_id
    );

    perform system.enqueue_outbox_event(
      'organization', target.organization_id, 'organization.claimed.v1',
      jsonb_build_object('organization_id', target.organization_id, 'invitation_id', target.id)
    );
  else
    update identity.invitation_intents as intent
    set status = 'rejected', decided_at = decision_time
    where intent.id = target.intent_id;
  end if;

  update identity.invitations as invitation
  set status = 'completed'
  where invitation.id = target.id;

  perform system.enqueue_outbox_event(
    'invitation', target.id, 'identity.invitation_intent_decided.v1',
    jsonb_build_object(
      'invitation_id', target.id,
      'intent_id', target.intent_id,
      'decision', p_decision
    )
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'ownership-invitation-decided', 'invitation', target.id
  );

  return query select
    target.id,
    'completed'::text,
    target.organization_id,
    target.intent_id,
    p_decision,
    owner_membership_id,
    false;
end
$function$;

-- ---------------------------------------------------------------------------
-- Delivery
-- ---------------------------------------------------------------------------

create or replace function identity.prepare_ownership_invitation_delivery(p_event_id uuid)
returns table (
  delivery_state text,
  invitation_id uuid,
  contact text,
  organization_name text,
  token_key_version smallint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.invitations%rowtype;
  organization_label text;
  organization_state organizations.organization_status;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker actor required' using errcode = '42501';
  end if;

  select invitation.* into target
  from system.outbox_events as event
  join identity.invitations as invitation on invitation.id = event.aggregate_id
  where event.id = p_event_id
    and event.event_type = 'organization.ownership_invited.v1'
  for update of invitation;

  if target.id is not null then
    select organization.display_name, organization.status
    into organization_label, organization_state
    from organizations.organizations as organization
    where organization.id = target.organization_id;
  end if;

  if target.id is null or target.status <> 'pending' or organization_state <> 'unclaimed' then
    return query select 'skipped'::text, null::uuid, null::text, null::text, null::smallint,
      null::timestamptz;
    return;
  end if;
  if target.expires_at <= clock_timestamp() then
    update identity.invitations as invitation
    set status = 'expired'
    where invitation.id = target.id;
    update identity.invitation_intents as invitation_intent
    set status = 'expired', decided_at = clock_timestamp()
    where invitation_intent.invitation_id = target.id
      and invitation_intent.status = 'pending';
    return query select 'expired'::text, target.id, null::text, null::text, null::smallint,
      target.expires_at;
    return;
  end if;

  return query select 'ready'::text, target.id, target.contact::text, organization_label,
    target.token_key_version, target.expires_at;
end
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function identity.invitation_intent_issuer_tg() owner to allfit_owner;
alter function organizations.require_organization_lifecycle_duty(uuid, uuid) owner to allfit_owner;
alter function organizations.handover_projection(uuid) owner to allfit_owner;
alter function organizations.create_unclaimed_organization(
  uuid, uuid, text, text, text, text, text, text, text, bytea, smallint, uuid, uuid, bytea
) owner to allfit_owner;
alter function organizations.resend_ownership_invitation(
  uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) owner to allfit_owner;
alter function organizations.cancel_unclaimed_organization(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;
alter function organizations.read_organization_handover(uuid, uuid, uuid) owner to allfit_owner;
alter function identity.resolve_ownership_invitation(bytea) owner to allfit_owner;
alter function identity.decide_ownership_invitation(uuid, bytea, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function identity.prepare_ownership_invitation_delivery(uuid) owner to allfit_owner;

revoke all on function identity.invitation_intent_issuer_tg() from public, allfit_api;
revoke all on function organizations.require_organization_lifecycle_duty(uuid, uuid)
  from public, allfit_api;
revoke all on function organizations.handover_projection(uuid) from public, allfit_api;
revoke all on function organizations.create_unclaimed_organization(
  uuid, uuid, text, text, text, text, text, text, text, bytea, smallint, uuid, uuid, bytea
) from public;
revoke all on function organizations.resend_ownership_invitation(
  uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) from public;
revoke all on function organizations.cancel_unclaimed_organization(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;
revoke all on function organizations.read_organization_handover(uuid, uuid, uuid) from public;
revoke all on function identity.resolve_ownership_invitation(bytea) from public;
revoke all on function identity.decide_ownership_invitation(uuid, bytea, uuid, text, uuid, uuid, bytea)
  from public;
revoke all on function identity.prepare_ownership_invitation_delivery(uuid) from public;

grant execute on function organizations.create_unclaimed_organization(
  uuid, uuid, text, text, text, text, text, text, text, bytea, smallint, uuid, uuid, bytea
) to allfit_api;
grant execute on function organizations.resend_ownership_invitation(
  uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) to allfit_api;
grant execute on function organizations.cancel_unclaimed_organization(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
grant execute on function organizations.read_organization_handover(uuid, uuid, uuid) to allfit_api;
grant execute on function identity.resolve_ownership_invitation(bytea) to allfit_api;
grant execute on function identity.decide_ownership_invitation(uuid, bytea, uuid, text, uuid, uuid, bytea)
  to allfit_api;
grant execute on function identity.prepare_ownership_invitation_delivery(uuid) to allfit_api;
