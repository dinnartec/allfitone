-- HU-STUDIO-087 — a gym cannot invite past the guest quota Allfit sold it.
--
-- `HU-BO-034` wrote the number and the way to count what occupies it. This is the
-- refusal: an invitation that would take a place the gym does not have is refused
-- before anything is written, with the reason, in the same transaction that would have
-- created it.
--
-- **Where it is enforced.** `OP-REL-001` (a gym invites a client) and `OP-IDN-051`
-- (support reissues a lapsed client invitation) are the only two commands that raise
-- the occupancy: each inserts an invitation that was not there. Both now ask
-- `organizations.require_guest_quota_place` before inserting, and nothing else did
-- before or does now.
--
-- **Reusing is not taking.** An invitation reused by `OP-REL-001`, or redelivered by
-- `OP-IDN-051`, already occupies its place, so only the insert branch asks. A retry of
-- a command that went through is answered from its receipt before the question is
-- reached, so a gym that filled since is not refused its own earlier success.
--
-- **The organization row is the outermost lock.** Two inviters racing for the last
-- place would both count one place left and both insert. The organization row is
-- locked `for no key update` first, which conflicts with itself and with the
-- `for update` that `OP-ORG-023` and `OP-IDN-051` already take, and does not conflict
-- with the `for key share` every foreign-key insert takes. Whichever function touches
-- occupancy takes that lock before any other, so none can wait on the invitation rows
-- in the opposite order and deadlock.
--
-- **Accepting is not checked, on purpose.** `OP-IDN-009` refuses an invitation that is
-- not pending and unexpired, so one that is accepted was occupying a place, and turning
-- it into a relationship moves one place from one kind of occupant to the other: the
-- occupancy before and after is the same figure. A check there could not fire except
-- for a gym Allfit cut below what it holds, and refusing a person mid-flight for that
-- would end an offer the gym legitimately made, which criterion 6 forbids. It would
-- also need the acceptor, who has no organization context and must not, to read the
-- gym's rows. `T-REL-QUOTA-02` pins the figure so nobody breaks this silently.
--
-- **A coach has to be counted too.** A coach holds `invite_clients` and not
-- `view_directory`, so the ordinary read policy shows a coach only the relationships
-- assigned to them, and a count made as a coach would see a half-empty gym. A policy
-- keyed to a capability would fix that by giving every coach a standing read of every
-- client row, which `T-REL-RLS-01` forbids. Instead the occupancy function names one
-- organization in a transaction-local setting for the length of its own count and
-- clears it the moment the count is done; the policy admits that organization's rows
-- only while the setting names it, so the exposure is one function body.
--
-- **What a gym may learn.** `studio_guest_quota` answers the seats, what is occupied,
-- what is left and whether the gym is over. It leaves out `last_change` on purpose: that
-- carries which member of Allfit's staff set the quota, which the gym must not learn.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Counting a gym's places, and nothing wider
-- ---------------------------------------------------------------------------

create or replace function access_control.counting_guest_quota(p_organization_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog
as $function$
  select nullif(current_setting('app.guest_quota_organization_id', true), '')::uuid
         = p_organization_id
$function$;

alter function access_control.counting_guest_quota(uuid) owner to allfit_owner;
revoke all on function access_control.counting_guest_quota(uuid) from public, allfit_api;

-- Select only: nobody writes a relationship through the right to count them.
create policy service_relationships_select_guest_quota_count
  on relationships.service_relationships
  for select
  to allfit_owner
  using (access_control.counting_guest_quota(organization_id));

-- Same figures and same signature as before, now volatile because it sets the setting
-- the policy above reads, and counting in one statement so the two kinds of occupant
-- are counted in one snapshot.
create or replace function organizations.organization_guest_occupancy(p_organization_id uuid)
returns table (relationships_active integer, invitations_pending integer, occupied integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  active_total integer;
  pending_total integer;
begin
  perform set_config('app.guest_quota_organization_id', p_organization_id::text, true);

  -- One statement, so both kinds of occupant are counted in one snapshot. In two
  -- statements an acceptance committing in between was counted in neither: the
  -- relationship was not active yet for the first and the invitation was no longer
  -- pending for the second, and the gym invited past its quota. Reproduced.
  select
    (
      select count(*)::integer
      from relationships.service_relationships as relationship
      where relationship.organization_id = p_organization_id
        and relationship.status = 'active'
    ),
    (
      -- Still awaiting an answer: pending, and with time left. A row that has run out
      -- of time frees its place whether or not a sweep has relabelled it yet.
      select count(*)::integer
      from identity.invitations as invitation
      join identity.invitation_intents as intent
        on intent.invitation_id = invitation.id
       and intent.kind = 'service_relationship'
       and intent.status = 'pending'
      where invitation.organization_id = p_organization_id
        and invitation.status = 'pending'
        and invitation.expires_at > clock_timestamp()
    )
  into active_total, pending_total;

  perform set_config('app.guest_quota_organization_id', '', true);

  return query select active_total, pending_total, active_total + pending_total;
end
$function$;

alter function organizations.organization_guest_occupancy(uuid) owner to allfit_owner;
revoke all on function organizations.organization_guest_occupancy(uuid) from public, allfit_api;

-- The Backoffice projection reads that count, which now writes a setting while it runs.
-- A stable marker over a volatile call is a promise the function no longer keeps.
alter function organizations.guest_quota_projection(uuid) volatile;

-- ---------------------------------------------------------------------------
-- The refusal
-- ---------------------------------------------------------------------------

-- Takes the organization lock itself rather than trusting its callers to have taken
-- it. It is already held by both of them, so this waits for nobody; it is here so a
-- future caller cannot read a figure another inviter is about to change.
create or replace function organizations.require_guest_quota_place(p_organization_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  quota integer;
  taken integer;
begin
  select organization.guest_quota_seats into quota
  from organizations.organizations as organization
  where organization.id = p_organization_id
  for no key update;

  -- No quota is no limit: a gym nobody sold a number to is not capped.
  if quota is null then
    return;
  end if;

  select live.occupied into taken
  from organizations.organization_guest_occupancy(p_organization_id) as live;

  if taken >= quota then
    raise exception 'the gym has no places left in its guest quota' using errcode = '55000';
  end if;
end
$function$;

alter function organizations.require_guest_quota_place(uuid) owner to allfit_owner;
revoke all on function organizations.require_guest_quota_place(uuid) from public, allfit_api;

-- ---------------------------------------------------------------------------
-- OP-REL-001 — invite a person as a client
-- ---------------------------------------------------------------------------

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

  -- Outermost lock: a second inviter waits here, before it counts a place that is
  -- about to be taken. Every function that touches occupancy takes this one first.
  perform 1
  from organizations.organizations as locked
  where locked.id = p_organization_id
  for no key update;

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
    -- Only a new invitation takes a place; a reused one already holds its own.
    perform organizations.require_guest_quota_place(p_organization_id);

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
    -- A reissue is a new invitation and takes a place; the organization row is locked
    -- above, before any invitation row, as every occupancy writer does.
    perform organizations.require_guest_quota_place(target.organization_id);
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

-- ---------------------------------------------------------------------------
-- What Studio reads
-- ---------------------------------------------------------------------------

-- Anybody who may invite or look at the directory may see how full the gym is: a coach
-- is refused at a full gym and has to be able to be told why before trying.
create or replace function organizations.studio_guest_quota(p_organization_id uuid)
returns table (seats integer, occupied integer, places_left integer, over_quota boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
begin
  if access_control.actor_kind() is distinct from 'person'
     or access_control.person() is null then
    raise exception 'a person actor is required' using errcode = '42501';
  end if;

  if not (
    access_control.has_capability(p_organization_id, 'view_directory')
    or access_control.has_capability(p_organization_id, 'view_assigned_directory')
    or access_control.has_capability(p_organization_id, 'invite_clients')
  ) then
    raise exception 'guest quota requires a directory or invitation capability'
      using errcode = '42501';
  end if;

  return query
  select
    organization.guest_quota_seats,
    live.occupied,
    case
      when organization.guest_quota_seats is null then null
      else greatest(organization.guest_quota_seats - live.occupied, 0)
    end,
    organization.guest_quota_seats is not null
      and live.occupied > organization.guest_quota_seats
  from organizations.organizations as organization
  cross join lateral organizations.organization_guest_occupancy(organization.id) as live
  where organization.id = p_organization_id;

  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
end
$function$;

alter function organizations.studio_guest_quota(uuid) owner to allfit_owner;
revoke all on function organizations.studio_guest_quota(uuid) from public;
grant execute on function organizations.studio_guest_quota(uuid) to allfit_api;
