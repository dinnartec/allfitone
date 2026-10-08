-- NEW-IDN-RESEND / OP-IDN-045 — resending an invitation from Backoffice (`HU-BO-011`).
--
-- This is the invitation half of the story. Resending a verification or a recovery
-- needs the identity action requests PRE_PHASE_5 §5 describes, which `HU-BO-010`
-- builds; nothing here pretends to cover them.
--
-- **Only what is still pending goes out again.** A live team invitation is sent as
-- the same invitation, with its validity renewed exactly as Studio renews it when the
-- gym invites the same person twice. An expired one is replaced by a new identical
-- invitation, and the expired one stays expired. An accepted, declined or revoked one
-- is never resent, and neither is one already reissued or one with an equal
-- invitation pending: the gym's later decision wins.
--
-- **Allfit reissues; it does not impersonate.** The replacement is signed by the
-- Allfit person and the duty they acted under, and points at the invitation it
-- replaces. `HU-BO-014` refused any team invitation authored by Allfit; that refusal
-- stands for everything except a reissue, and a reissue must propose exactly what the
-- original did — same organization, channel, contact and role — or the database
-- rejects it, owner included.
--
-- **Support is held to the gym's limits.** The same destination window Studio uses
-- (three a day per organization and address) counts support's resends too, so a
-- resend cannot become a way to flood someone's inbox.
--
-- **Every resend is recorded** in `identity.invitation_resends`, append-only: what was
-- sent, whether it was redelivered or reissued, who sent it and under which duty.
-- Ownership resends (`OP-ORG-021`) now write the same record.
--
-- The duty is `diagnose_support_metadata`, decided with the product owner: resending
-- writes no personal data. Listing a gym's invitations shows masked contacts and
-- names no person, so it records no access.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- A reissue points at the invitation it replaces
-- ---------------------------------------------------------------------------

alter table identity.invitations
  add column reissues_invitation_id uuid,
  add constraint fk_invitations_reissues foreign key (reissues_invitation_id) references identity.invitations(id) on delete restrict,
  add constraint ck_invitations_reissue_author check (reissues_invitation_id is null or issued_by_person_id is not null),
  add constraint ck_invitations_reissue_not_self check (reissues_invitation_id is null or reissues_invitation_id <> id);

create index idx_invitations_reissues on identity.invitations (reissues_invitation_id)
  where reissues_invitation_id is not null;

create or replace function identity.invitation_reissue_matches_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  original identity.invitations%rowtype;
begin
  if new.reissues_invitation_id is null then
    return new;
  end if;

  select invitation.* into original
  from identity.invitations as invitation
  where invitation.id = new.reissues_invitation_id;

  if original.organization_id is distinct from new.organization_id
     or original.channel is distinct from new.channel
     or original.contact is distinct from new.contact
     or original.proposal_hash is distinct from new.proposal_hash then
    raise exception 'a reissued invitation goes to the same organization, channel and contact'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create trigger trg_invitations_before_insert_reissue
before insert on identity.invitations
for each row execute function identity.invitation_reissue_matches_tg();

-- Replaces the `HU-BO-014` version: a team or client intent signed by Allfit is
-- still refused unless it reissues one, and a reissue proposes what the original did.
create or replace function identity.invitation_intent_issuer_tg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  platform_issued boolean;
  organization_state organizations.organization_status;
  reissued_from uuid;
  original_kind identity.invitation_intent_kind;
  original_role text;
begin
  select invitation.issued_by_person_id is not null, organization.status,
         invitation.reissues_invitation_id
  into platform_issued, organization_state, reissued_from
  from identity.invitations as invitation
  join organizations.organizations as organization on organization.id = invitation.organization_id
  where invitation.id = new.invitation_id;

  if new.kind = 'ownership'
     and not (coalesce(platform_issued, false) and organization_state = 'unclaimed') then
    raise exception 'an ownership intent belongs to an invitation Allfit issued for an unclaimed organization'
      using errcode = '23514';
  end if;
  if new.kind <> 'ownership' and coalesce(platform_issued, false) and reissued_from is null then
    raise exception 'only a member issues a team or client intent; Allfit only reissues one'
      using errcode = '23514';
  end if;

  if reissued_from is not null then
    select intent.kind, intent.proposed_role_code into original_kind, original_role
    from identity.invitation_intents as intent
    where intent.invitation_id = reissued_from
    order by intent.created_at, intent.id
    limit 1;

    if original_kind is distinct from new.kind
       or original_role is distinct from new.proposed_role_code then
      raise exception 'a reissued invitation proposes exactly what the original did'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$function$;

-- ---------------------------------------------------------------------------
-- The record of every resend
-- ---------------------------------------------------------------------------

create table identity.invitation_resends (
  id uuid not null default extensions.uuid_generate_v7(),
  invitation_id uuid not null,
  delivered_invitation_id uuid not null,
  kind identity.invitation_intent_kind not null,
  outcome text not null,
  actor_person_id uuid not null,
  actor_duty_assignment_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_invitation_resends primary key (id),
  constraint fk_invitation_resends_invitation foreign key (invitation_id) references identity.invitations(id) on delete restrict,
  constraint fk_invitation_resends_delivered foreign key (delivered_invitation_id) references identity.invitations(id) on delete restrict,
  constraint fk_invitation_resends_actor foreign key (actor_person_id) references identity.people(id) on delete restrict,
  constraint fk_invitation_resends_duty foreign key (actor_duty_assignment_id) references support.platform_duty_assignments(id) on delete restrict,
  constraint ck_invitation_resends_outcome check ((outcome = 'redelivered' and delivered_invitation_id = invitation_id) or (outcome = 'reissued' and delivered_invitation_id <> invitation_id))
);

create index idx_invitation_resends_invitation
  on identity.invitation_resends (invitation_id, created_at);
create index idx_invitation_resends_delivered
  on identity.invitation_resends (delivered_invitation_id);

create or replace function identity.reject_invitation_resend_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'the resend record is append-only' using errcode = '55000';
end
$function$;

create trigger trg_invitation_resends_append_only
before update or delete on identity.invitation_resends
for each row execute function identity.reject_invitation_resend_rewrite();

alter table identity.invitation_resends enable row level security;
alter table identity.invitation_resends force row level security;

create policy invitation_resends_all_owner
  on identity.invitation_resends
  for all to allfit_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Authority and projection
-- ---------------------------------------------------------------------------

create or replace function identity.require_invitation_resender(
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
       p_actor_person_id, p_actor_session_id, 'diagnose_support_metadata'
     ) then
    select assignment.id into assignment_id
    from support.platform_duty_assignments as assignment
    where assignment.person_id = p_actor_person_id
      and assignment.duty_code = 'diagnose_support_metadata'
      and assignment.status = 'active'
      and clock_timestamp() >= assignment.valid_from
      and clock_timestamp() < assignment.valid_to
    order by assignment.valid_to desc
    limit 1;
  end if;

  if assignment_id is null then
    raise exception 'resending an invitation requires an effective support duty'
      using errcode = '42501';
  end if;
  return assignment_id;
end
$function$;

-- The contact is a hint: support needs to recognise the address, not read it back.
create or replace function identity.backoffice_team_invitation_projection(p_invitation_id uuid)
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
    'proposed_role_code', intent.proposed_role_code,
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
   and intent.kind = 'membership'
  join organizations.organizations as organization on organization.id = invitation.organization_id
  where invitation.id = p_invitation_id
$function$;

-- ---------------------------------------------------------------------------
-- NEW-IDN-RESEND — a gym's team invitations
-- ---------------------------------------------------------------------------

create or replace function identity.list_backoffice_team_invitations(
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
   and intent.kind = 'membership'
  where invitation.organization_id = p_organization_id;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'items', coalesce((
      select jsonb_agg(
        identity.backoffice_team_invitation_projection(newest.id)
        order by newest.created_at desc, newest.id desc
      )
      from (
        select invitation.id, invitation.created_at
        from identity.invitations as invitation
        join identity.invitation_intents as intent
          on intent.invitation_id = invitation.id
         and intent.kind = 'membership'
        where invitation.organization_id = p_organization_id
        order by invitation.created_at desc, invitation.id desc
        limit 50
      ) as newest
    ), '[]'::jsonb),
    'truncated', listed_count > 50
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-IDN-045 — resend a team invitation
-- ---------------------------------------------------------------------------

create or replace function identity.resend_team_invitation(
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
  lapsed boolean;
  delivered uuid;
  resend_outcome text;
begin
  duty_id := identity.require_invitation_resender(p_actor_person_id, p_actor_session_id);
  if p_token_hash is null
     or octet_length(p_token_hash) <> 32
     or p_token_key_version is null
     or p_token_key_version <= 0 then
    raise exception 'invalid team invitation resend' using errcode = '22023';
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
    and intent.kind = 'membership';
  if target.id is null or target_intent.id is null then
    raise exception 'team invitation not found' using errcode = 'P0002';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-IDN-045', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    response := identity.backoffice_team_invitation_projection(receipt.aggregate_id);
    if response is null then
      raise exception 'idempotent team invitation resend not found' using errcode = '40001';
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
    raise exception 'only an operating organization has team invitations to resend'
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
      'invitation', target.id, 'organization.staff_invited.v1',
      jsonb_build_object('invitation_id', target.id)
    );
  else
    if target.status::text = 'pending' then
      update identity.invitations as invitation
      set status = 'expired'
      where invitation.id = target.id;
      update identity.invitation_intents as intent
      set status = 'expired', decided_at = clock_timestamp()
      where intent.invitation_id = target.id
        and intent.status = 'pending';
      perform system.enqueue_outbox_event(
        'invitation', target.id, 'identity.invitation_expired.v1',
        jsonb_build_object('invitation_id', target.id)
      );
    end if;

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
    insert into identity.invitation_intents (invitation_id, kind, proposed_role_code)
    values (p_command_id, 'membership', target_intent.proposed_role_code);

    perform system.enqueue_outbox_event(
      'invitation', p_command_id, 'organization.staff_invited.v1',
      jsonb_build_object('invitation_id', p_command_id)
    );
  end if;

  insert into identity.invitation_resends (
    invitation_id, delivered_invitation_id, kind, outcome, actor_person_id,
    actor_duty_assignment_id
  ) values (
    target.id, delivered, 'membership', resend_outcome, p_actor_person_id, duty_id
  );

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'team-invitation-resent', 'invitation', delivered
  );
  return query select
    identity.backoffice_team_invitation_projection(delivered)
      || jsonb_build_object('outcome', resend_outcome),
    false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-ORG-021 — ownership resends write the same record
-- ---------------------------------------------------------------------------

-- The `HU-BO-014` function, unchanged except for the resend record and the link
-- from a reissued invitation to the one it replaces.
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

    insert into identity.invitation_resends (
      invitation_id, delivered_invitation_id, kind, outcome, actor_person_id,
      actor_duty_assignment_id
    ) values (
      latest.id, latest.id, 'ownership', 'redelivered', p_actor_person_id, duty_id
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
      id, organization_id, issued_by_person_id, issued_by_duty_assignment_id,
      reissues_invitation_id, channel, contact, token_hash, token_key_version, proposal_hash,
      responsible_party, expires_at
    )
    select p_command_id, organization.id, p_actor_person_id, duty_id, latest.id, 'email',
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

    insert into identity.invitation_resends (
      invitation_id, delivered_invitation_id, kind, outcome, actor_person_id,
      actor_duty_assignment_id
    ) values (
      latest.id, p_command_id, 'ownership', 'reissued', p_actor_person_id, duty_id
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
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter table identity.invitation_resends owner to allfit_owner;
alter function identity.invitation_reissue_matches_tg() owner to allfit_owner;
alter function identity.reject_invitation_resend_rewrite() owner to allfit_owner;
alter function identity.require_invitation_resender(uuid, uuid) owner to allfit_owner;
alter function identity.backoffice_team_invitation_projection(uuid) owner to allfit_owner;
alter function identity.list_backoffice_team_invitations(uuid, uuid, uuid) owner to allfit_owner;
alter function identity.resend_team_invitation(
  uuid, uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) owner to allfit_owner;

revoke all on identity.invitation_resends from public, allfit_api;
revoke all on function identity.invitation_reissue_matches_tg() from public, allfit_api;
revoke all on function identity.reject_invitation_resend_rewrite() from public, allfit_api;
revoke all on function identity.require_invitation_resender(uuid, uuid) from public, allfit_api;
revoke all on function identity.backoffice_team_invitation_projection(uuid) from public, allfit_api;
revoke all on function identity.list_backoffice_team_invitations(uuid, uuid, uuid) from public;
revoke all on function identity.resend_team_invitation(
  uuid, uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) from public;

grant execute on function identity.list_backoffice_team_invitations(uuid, uuid, uuid) to allfit_api;
grant execute on function identity.resend_team_invitation(
  uuid, uuid, uuid, uuid, bytea, smallint, uuid, uuid, bytea
) to allfit_api;
