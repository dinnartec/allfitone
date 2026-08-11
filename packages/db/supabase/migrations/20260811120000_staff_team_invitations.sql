-- HU-STUDIO-014: durable, capability-gated team invitations and email delivery outbox.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type identity.invitation_status as enum ('pending', 'claimed', 'revoked', 'expired');
create type identity.invitation_intent_kind as enum ('membership', 'service_relationship', 'program_assignment');
create type identity.invitation_intent_status as enum ('pending', 'accepted', 'rejected', 'expired');

alter type identity.invitation_status owner to allfit_owner;
alter type identity.invitation_intent_kind owner to allfit_owner;
alter type identity.invitation_intent_status owner to allfit_owner;

create table organizations.organization_capabilities (
  code text not null,
  name text not null,
  constraint pk_organization_capabilities primary key (code),
  constraint ck_organization_capabilities_code check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ck_organization_capabilities_name check (btrim(name) <> '')
);

create table organizations.role_capabilities (
  role_code text not null,
  capability_code text not null,
  constraint pk_role_capabilities primary key (role_code, capability_code),
  constraint fk_role_capabilities_role foreign key (role_code) references organizations.organization_roles(code) on delete restrict,
  constraint fk_role_capabilities_capability foreign key (capability_code) references organizations.organization_capabilities(code) on delete restrict
);

insert into organizations.organization_capabilities (code, name)
values ('invite', 'Invitar al equipo');

insert into organizations.role_capabilities (role_code, capability_code)
values ('owner', 'invite'), ('admin', 'invite'), ('staff', 'invite');

create table identity.invitations (
  id uuid not null,
  organization_id uuid not null,
  issued_by_membership_id uuid not null,
  channel text not null,
  contact extensions.citext not null,
  token_hash bytea not null,
  token_key_version smallint not null,
  proposal_hash bytea not null,
  responsible_party_schema_version smallint not null default 1,
  responsible_party jsonb not null,
  status identity.invitation_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_invitations primary key (id),
  constraint fk_invitations_organization foreign key (organization_id) references organizations.organizations(id) on delete restrict,
  constraint fk_invitations_issuer_carrier foreign key (issued_by_membership_id, organization_id) references organizations.organization_memberships(id, organization_id) on delete restrict,
  constraint uq_invitations_token_hash unique (token_hash),
  constraint ck_invitations_uuid_v7 check (extensions.uuid_is_v7(id)),
  constraint ck_invitations_channel check (channel = 'email'),
  constraint ck_invitations_email check (length(contact::text) between 3 and 254 and contact::text ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  constraint ck_invitations_token_hash check (octet_length(token_hash) = 32),
  constraint ck_invitations_token_key_version check (token_key_version > 0),
  constraint ck_invitations_proposal_hash check (octet_length(proposal_hash) = 32),
  constraint ck_invitations_responsible_party_version check (responsible_party_schema_version = 1),
  constraint ck_invitations_responsible_party check (jsonb_typeof(responsible_party) = 'object'),
  constraint ck_invitations_expiry check (expires_at > created_at)
);

create unique index uidx_invitations_pending_proposal
  on identity.invitations (organization_id, proposal_hash)
  where status = 'pending';
create index idx_invitations_organization_status
  on identity.invitations (organization_id, status, expires_at desc);

create table identity.invitation_intents (
  id uuid not null default extensions.uuid_generate_v7(),
  invitation_id uuid not null,
  kind identity.invitation_intent_kind not null,
  status identity.invitation_intent_status not null default 'pending',
  proposed_role_code text,
  materialized_membership_id uuid,
  decided_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_invitation_intents primary key (id),
  constraint fk_invitation_intents_invitation foreign key (invitation_id) references identity.invitations(id) on delete cascade,
  constraint fk_invitation_intents_role foreign key (proposed_role_code) references organizations.organization_roles(code) on delete restrict,
  constraint fk_invitation_intents_membership foreign key (materialized_membership_id) references organizations.organization_memberships(id) on delete restrict,
  constraint uq_invitation_intents_kind unique (invitation_id, kind),
  constraint ck_invitation_intents_membership_role check (kind <> 'membership' or proposed_role_code is not null),
  constraint ck_invitation_intents_decision check (
    (status = 'pending' and decided_at is null and materialized_membership_id is null)
    or (status in ('rejected', 'expired') and decided_at is not null and materialized_membership_id is null)
    or (status = 'accepted' and decided_at is not null)
  )
);

create index idx_invitation_intents_invitation_status
  on identity.invitation_intents (invitation_id, status);

alter table system.outbox_events
  add column last_error_code text,
  add column dead_lettered_at timestamptz,
  add constraint ck_outbox_events_last_error_code check (
    last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  add constraint ck_outbox_events_terminal_state check (
    not (published_at is not null and dead_lettered_at is not null)
  );

create table system.outbox_delivery_circuits (
  event_type text not null,
  state text not null default 'closed',
  window_started_at timestamptz not null default clock_timestamp(),
  success_count integer not null default 0,
  failure_count integer not null default 0,
  opened_until timestamptz,
  half_open_claims integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_outbox_delivery_circuits primary key (event_type),
  constraint ck_outbox_delivery_circuits_event_type check (event_type ~ '^[a-z][a-z0-9_]+\.[a-z][a-z0-9_]+\.v[1-9][0-9]*$'),
  constraint ck_outbox_delivery_circuits_state check (state in ('closed', 'open', 'half_open')),
  constraint ck_outbox_delivery_circuits_counts check (success_count >= 0 and failure_count >= 0 and half_open_claims >= 0),
  constraint ck_outbox_delivery_circuits_opened_until check ((state = 'open') = (opened_until is not null))
);

drop index system.idx_outbox_events_pending;
create index idx_outbox_events_pending
  on system.outbox_events (event_type, available_at, occurred_at, id)
  where published_at is null and dead_lettered_at is null;

alter table organizations.organization_capabilities owner to allfit_owner;
alter table organizations.role_capabilities owner to allfit_owner;
alter table identity.invitations owner to allfit_owner;
alter table identity.invitation_intents owner to allfit_owner;
alter table system.outbox_delivery_circuits owner to allfit_owner;

create trigger trg_invitations_update_set_updated_at
before update on identity.invitations
for each row execute function access_control.set_updated_at();

create trigger trg_invitation_intents_update_set_updated_at
before update on identity.invitation_intents
for each row execute function access_control.set_updated_at();

alter table organizations.organization_capabilities enable row level security;
alter table organizations.organization_capabilities force row level security;
alter table organizations.role_capabilities enable row level security;
alter table organizations.role_capabilities force row level security;
alter table identity.invitations enable row level security;
alter table identity.invitations force row level security;
alter table identity.invitation_intents enable row level security;
alter table identity.invitation_intents force row level security;
alter table system.outbox_delivery_circuits enable row level security;
alter table system.outbox_delivery_circuits force row level security;

create policy organization_capabilities_all_owner on organizations.organization_capabilities
  for all to allfit_owner using (true) with check (true);
create policy role_capabilities_all_owner on organizations.role_capabilities
  for all to allfit_owner using (true) with check (true);
create policy invitations_all_owner on identity.invitations
  for all to allfit_owner using (true) with check (true);
create policy invitation_intents_all_owner on identity.invitation_intents
  for all to allfit_owner using (true) with check (true);
create policy outbox_delivery_circuits_all_owner on system.outbox_delivery_circuits
  for all to allfit_owner using (true) with check (true);

revoke all on organizations.organization_capabilities, organizations.role_capabilities from public, allfit_api;
revoke all on identity.invitations, identity.invitation_intents from public, allfit_api;
revoke all on system.outbox_delivery_circuits from public, allfit_api;

create or replace function access_control.has_capability(
  p_organization_id uuid,
  p_capability_code text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from organizations.organization_memberships as membership
    join organizations.membership_roles as membership_role
      on membership_role.membership_id = membership.id
     and membership_role.valid_to is null
    join organizations.role_capabilities as role_capability
      on role_capability.role_code = membership_role.role_code
     and role_capability.capability_code = p_capability_code
    where membership.organization_id = p_organization_id
      and membership.person_id = access_control.person()
      and membership.status = 'active'
  )
$function$;

create or replace function identity.team_invitation_projection(p_invitation_id uuid)
returns table (
  invitation_id uuid,
  invitation_intent_id uuid,
  status text,
  channel text,
  contact_hint text,
  expires_at timestamptz,
  proposed_role_code text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select invitation.id,
         intent.id,
         invitation.status::text,
         invitation.channel,
         left(split_part(invitation.contact::text, '@', 1), 1) || '***@' || split_part(invitation.contact::text, '@', 2),
         invitation.expires_at,
         intent.proposed_role_code
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'membership'
  where invitation.id = p_invitation_id
$function$;

create or replace function identity.issue_staff_invitation(
  p_person_id uuid,
  p_organization_id uuid,
  p_channel text,
  p_contact text,
  p_proposed_role_code text,
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
  proposed_role_code text,
  reused boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  receipt record;
  invitation_projection record;
  actor_membership_id uuid;
  normalized_contact text;
  computed_proposal_hash bytea;
  domain_reused boolean := false;
  replay_reused boolean := false;
  actor_is_staff boolean;
  actor_is_privileged boolean;
  organization_snapshot jsonb;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;

  normalized_contact := lower(btrim(p_contact));
  if p_channel <> 'email'
     or length(normalized_contact) not between 3 and 254
     or normalized_contact !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or p_proposed_role_code not in ('admin', 'coach', 'staff')
     or octet_length(p_token_hash) <> 32
     or p_token_key_version <= 0 then
    raise exception 'invalid team invitation' using errcode = '22023';
  end if;

  select membership.id,
         bool_or(membership_role.role_code = 'staff'),
         bool_or(membership_role.role_code in ('owner', 'admin')),
         organization.responsible_party
  into actor_membership_id, actor_is_staff, actor_is_privileged, organization_snapshot
  from organizations.organizations as organization
  join organizations.organization_memberships as membership
    on membership.organization_id = organization.id
   and membership.person_id = p_person_id
   and membership.status = 'active'
  join organizations.membership_roles as membership_role
    on membership_role.membership_id = membership.id
   and membership_role.valid_to is null
  where organization.id = p_organization_id
    and organization.status = 'active'
  group by membership.id, organization.responsible_party;

  if actor_membership_id is null then
    raise exception 'organization membership not found' using errcode = 'P0002';
  end if;
  if not access_control.has_capability(p_organization_id, 'invite') then
    raise exception 'invite capability required' using errcode = '42501';
  end if;
  if not actor_is_privileged and (not actor_is_staff or p_proposed_role_code <> 'staff') then
    raise exception 'staff cannot propose this role' using errcode = '42501';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-ORG-005', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    select outcome_code = 'team-invitation-reused' into replay_reused
    from system.idempotency_keys
    where id = receipt.receipt_id;

    select * into invitation_projection
    from identity.team_invitation_projection(receipt.aggregate_id);
    if invitation_projection.invitation_id is null then
      raise exception 'idempotent invitation not found' using errcode = '40001';
    end if;
    return query select
      invitation_projection.invitation_id,
      invitation_projection.invitation_intent_id,
      invitation_projection.status,
      invitation_projection.channel,
      invitation_projection.contact_hint,
      invitation_projection.expires_at,
      invitation_projection.proposed_role_code,
      coalesce(replay_reused, false),
      true;
    return;
  end if;

  computed_proposal_hash := extensions.digest(
    convert_to(
      p_organization_id::text || chr(31) || p_channel || chr(31) || normalized_contact || chr(31) || 'membership' || chr(31) || p_proposed_role_code,
      'UTF8'
    ),
    'sha256'
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(encode(computed_proposal_hash, 'hex'), 0));

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

  select * into invitation_projection
  from identity.team_invitation_projection((
    select invitation.id
    from identity.invitations as invitation
    where invitation.organization_id = p_organization_id
      and invitation.proposal_hash = computed_proposal_hash
      and invitation.status = 'pending'
      and invitation.expires_at > clock_timestamp()
    for update
  ));

  if invitation_projection.invitation_id is not null then
    domain_reused := true;
    update identity.invitations as invitation
    set expires_at = clock_timestamp() + interval '7 days'
    where invitation.id = invitation_projection.invitation_id;
  else
    insert into identity.invitations (
      id, organization_id, issued_by_membership_id, channel, contact,
      token_hash, token_key_version, proposal_hash, responsible_party, expires_at
    ) values (
      p_command_id, p_organization_id, actor_membership_id, p_channel, normalized_contact,
      p_token_hash, p_token_key_version, computed_proposal_hash, organization_snapshot,
      clock_timestamp() + interval '7 days'
    );
    insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
    values (p_command_id, 'membership', p_proposed_role_code);
    select * into invitation_projection
    from identity.team_invitation_projection(p_command_id);
  end if;

  perform system.enqueue_outbox_event(
    'invitation',
    invitation_projection.invitation_id,
    'organization.staff_invited.v1',
    jsonb_build_object('invitation_id', invitation_projection.invitation_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id,
    case when domain_reused then 200 else 201 end::smallint,
    case when domain_reused then 'team-invitation-reused' else 'team-invitation-created' end,
    'invitation',
    invitation_projection.invitation_id
  );

  select * into invitation_projection
  from identity.team_invitation_projection(invitation_projection.invitation_id);
  return query select
    invitation_projection.invitation_id,
    invitation_projection.invitation_intent_id,
    invitation_projection.status,
    invitation_projection.channel,
    invitation_projection.contact_hint,
    invitation_projection.expires_at,
    invitation_projection.proposed_role_code,
    domain_reused,
    false;
end
$function$;

create or replace function system.outbox_circuit_claim_limit(
  p_event_type text,
  p_requested_limit integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  circuit system.outbox_delivery_circuits%rowtype;
  remaining_probes integer;
begin
  if access_control.actor_kind() <> 'worker' or p_requested_limit not between 1 and 100 then
    raise exception 'worker actor required' using errcode = '42501';
  end if;
  insert into system.outbox_delivery_circuits (event_type) values (p_event_type)
  on conflict (event_type) do nothing;
  select * into circuit from system.outbox_delivery_circuits where event_type = p_event_type for update;

  if circuit.state = 'closed' and circuit.window_started_at <= clock_timestamp() - interval '30 seconds' then
    update system.outbox_delivery_circuits
    set window_started_at = clock_timestamp(), success_count = 0, failure_count = 0,
        half_open_claims = 0, updated_at = clock_timestamp()
    where event_type = p_event_type;
    return p_requested_limit;
  end if;
  if circuit.state = 'open' and circuit.opened_until > clock_timestamp() then return 0; end if;
  if circuit.state = 'open' then
    update system.outbox_delivery_circuits
    set state = 'half_open', opened_until = null, half_open_claims = 0,
        success_count = 0, failure_count = 0, updated_at = clock_timestamp()
    where event_type = p_event_type;
    circuit.state := 'half_open';
    circuit.half_open_claims := 0;
  end if;
  if circuit.state = 'half_open' then
    remaining_probes := greatest(3 - circuit.half_open_claims, 0);
    if remaining_probes = 0 then return 0; end if;
    remaining_probes := least(p_requested_limit, remaining_probes);
    update system.outbox_delivery_circuits
    set half_open_claims = half_open_claims + remaining_probes, updated_at = clock_timestamp()
    where event_type = p_event_type;
    return remaining_probes;
  end if;
  return p_requested_limit;
end
$function$;

create or replace function system.record_outbox_delivery_result(
  p_event_type text,
  p_succeeded boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  circuit system.outbox_delivery_circuits%rowtype;
  next_successes integer;
  next_failures integer;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker actor required' using errcode = '42501';
  end if;
  select * into circuit from system.outbox_delivery_circuits where event_type = p_event_type for update;
  if circuit.event_type is null then return; end if;

  if circuit.state = 'half_open' then
    if not p_succeeded then
      update system.outbox_delivery_circuits
      set state = 'open', opened_until = clock_timestamp() + interval '60 seconds',
          failure_count = failure_count + 1, updated_at = clock_timestamp()
      where event_type = p_event_type;
    else
      update system.outbox_delivery_circuits
      set success_count = success_count + 1,
          state = case when success_count + 1 >= 3 then 'closed' else state end,
          window_started_at = case when success_count + 1 >= 3 then clock_timestamp() else window_started_at end,
          half_open_claims = case when success_count + 1 >= 3 then 0 else half_open_claims end,
          updated_at = clock_timestamp()
      where event_type = p_event_type;
    end if;
    return;
  end if;
  if circuit.state <> 'closed' then return; end if;

  next_successes := circuit.success_count + case when p_succeeded then 1 else 0 end;
  next_failures := circuit.failure_count + case when p_succeeded then 0 else 1 end;
  update system.outbox_delivery_circuits
  set success_count = next_successes,
      failure_count = next_failures,
      state = case
        when next_successes + next_failures >= 20
         and next_failures::numeric / (next_successes + next_failures) >= 0.5 then 'open'
        else 'closed'
      end,
      opened_until = case
        when next_successes + next_failures >= 20
         and next_failures::numeric / (next_successes + next_failures) >= 0.5
        then clock_timestamp() + interval '60 seconds'
        else null
      end,
      updated_at = clock_timestamp()
  where event_type = p_event_type;
end
$function$;

create or replace function system.claim_outbox_events(
  p_event_type text,
  p_limit integer
)
returns table (id uuid, topic text, payload jsonb, attempt integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  permitted_limit integer;
begin
  if access_control.actor_kind() <> 'worker' or p_limit not between 1 and 100 then
    raise exception 'worker actor required' using errcode = '42501';
  end if;

  permitted_limit := system.outbox_circuit_claim_limit(p_event_type, p_limit);
  if permitted_limit = 0 then return; end if;

  return query
  with candidates as (
    select event.id
    from system.outbox_events as event
    where event.event_type = p_event_type
      and event.published_at is null
      and event.dead_lettered_at is null
      and event.available_at <= clock_timestamp()
    order by event.available_at, event.occurred_at, event.id
    for update skip locked
    limit permitted_limit
  )
  update system.outbox_events as event
  set available_at = clock_timestamp() + interval '2 minutes',
      attempt_count = event.attempt_count + 1,
      last_error_code = null
  from candidates
  where event.id = candidates.id
  returning event.id, event.event_type, event.payload, event.attempt_count;
end
$function$;

create or replace function system.ack_outbox_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_event_type text;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker actor required' using errcode = '42501';
  end if;
  select event_type into target_event_type
  from system.outbox_events where id = p_event_id for update;
  update system.outbox_events
  set published_at = clock_timestamp(), last_error_code = null
  where id = p_event_id and published_at is null and dead_lettered_at is null;
  if target_event_type is not null then
    perform system.record_outbox_delivery_result(target_event_type, true);
  end if;
end
$function$;

create or replace function system.nack_outbox_event(
  p_event_id uuid,
  p_error_code text,
  p_retryable boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  current_attempt integer;
  target_event_type text;
begin
  if access_control.actor_kind() <> 'worker'
     or p_error_code is null
     or p_error_code !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'invalid worker nack' using errcode = '42501';
  end if;
  select attempt_count, event_type into current_attempt, target_event_type
  from system.outbox_events where id = p_event_id for update;
  if current_attempt is null then return; end if;

  update system.outbox_events
  set last_error_code = p_error_code,
      dead_lettered_at = case when not p_retryable or current_attempt >= 5 then clock_timestamp() else null end,
      available_at = case
        when not p_retryable or current_attempt >= 5 then available_at
        else clock_timestamp() + make_interval(mins => power(2, greatest(current_attempt - 1, 0))::integer)
      end
  where id = p_event_id and published_at is null;
  perform system.record_outbox_delivery_result(target_event_type, false);
end
$function$;

create or replace function identity.prepare_staff_invitation_delivery(p_event_id uuid)
returns table (
  delivery_state text,
  invitation_id uuid,
  contact text,
  organization_name text,
  proposed_role_code text,
  token_key_version smallint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target identity.invitations%rowtype;
begin
  if access_control.actor_kind() <> 'worker' then
    raise exception 'worker actor required' using errcode = '42501';
  end if;

  select invitation.* into target
  from system.outbox_events as event
  join identity.invitations as invitation on invitation.id = event.aggregate_id
  where event.id = p_event_id
    and event.event_type = 'organization.staff_invited.v1'
  for update of invitation;

  if target.id is null or target.status <> 'pending' then
    return query select 'skipped'::text, null::uuid, null::text, null::text, null::text, null::smallint, null::timestamptz;
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
    return query select 'expired'::text, target.id, null::text, null::text, null::text, null::smallint, target.expires_at;
    return;
  end if;

  return query
  select 'ready'::text,
         target.id,
         target.contact::text,
         organization.display_name,
         intent.proposed_role_code,
         target.token_key_version,
         target.expires_at
  from organizations.organizations as organization
  join identity.invitation_intents as intent
    on intent.invitation_id = target.id and intent.kind = 'membership'
  where organization.id = target.organization_id;
end
$function$;

alter function access_control.has_capability(uuid, text) owner to allfit_owner;
alter function identity.team_invitation_projection(uuid) owner to allfit_owner;
alter function identity.issue_staff_invitation(uuid, uuid, text, text, text, bytea, smallint, uuid, uuid, bytea) owner to allfit_owner;
alter function system.outbox_circuit_claim_limit(text, integer) owner to allfit_owner;
alter function system.record_outbox_delivery_result(text, boolean) owner to allfit_owner;
alter function system.claim_outbox_events(text, integer) owner to allfit_owner;
alter function system.ack_outbox_event(uuid) owner to allfit_owner;
alter function system.nack_outbox_event(uuid, text, boolean) owner to allfit_owner;
alter function identity.prepare_staff_invitation_delivery(uuid) owner to allfit_owner;

revoke all on function access_control.has_capability(uuid, text) from public;
revoke all on function identity.team_invitation_projection(uuid) from public, allfit_api;
revoke all on function identity.issue_staff_invitation(uuid, uuid, text, text, text, bytea, smallint, uuid, uuid, bytea) from public;
revoke all on function system.outbox_circuit_claim_limit(text, integer) from public, allfit_api;
revoke all on function system.record_outbox_delivery_result(text, boolean) from public, allfit_api;
revoke all on function system.claim_outbox_events(text, integer) from public;
revoke all on function system.ack_outbox_event(uuid) from public;
revoke all on function system.nack_outbox_event(uuid, text, boolean) from public;
revoke all on function identity.prepare_staff_invitation_delivery(uuid) from public;

grant execute on function access_control.has_capability(uuid, text) to allfit_api;
grant execute on function identity.issue_staff_invitation(uuid, uuid, text, text, text, bytea, smallint, uuid, uuid, bytea) to allfit_api;
grant execute on function system.claim_outbox_events(text, integer) to allfit_api;
grant execute on function system.ack_outbox_event(uuid) to allfit_api;
grant execute on function system.nack_outbox_event(uuid, text, boolean) to allfit_api;
grant execute on function identity.prepare_staff_invitation_delivery(uuid) to allfit_api;
