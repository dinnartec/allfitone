-- OP-ORG-024 / OP-ORG-025 and NEW-ORG-SUSPEND — suspending a gym (`HU-BO-016`).
--
-- The obvious way to cut a gym off is to revoke its permissions, end its
-- relationships and cancel what it had scheduled, then put it all back when it pays.
-- **It cannot be put back.** A revoked grant needs the person's consent again, a
-- terminated relationship is a new relationship with a new history, and a cancelled
-- session is gone. The payments slice settled this already for an unpaid subscription
-- and built the mechanism for an organization at the same time: a block is a *cause*,
-- every projection derives from the open causes, and lifting one removes a cause and
-- recomputes from whatever is true now. There is no snapshot, because there is nothing
-- to snapshot back.
--
-- So suspension is three things that answer three different questions, and they are
-- separate on purpose:
--
-- * **`organizations.status = 'suspended'`** answers *may this organization act*. A
--   dozen functions already ask `status = 'active'` before inviting, assigning,
--   publishing or charging, so criterion 2 holds without one of them being edited, and
--   criterion 5 falls out of the same column because `resolve_pro` reads it too.
-- * **`organizations.organization_suspensions`** answers *who did it, why, and for how
--   long*. Criterion 8 needs that to survive the gym going back to `active`, which a
--   status column cannot do.
-- * **`planning.service_access_blocks`** answers *is this person's service from this
--   gym effective*. One row per affected person, pointing at the suspension event,
--   which is the shape `planning.enforce_service_access_block_source` has been waiting
--   for since it was written: it names `organization.suspended.v1` and rejects
--   everything until that event exists.
--
-- **Reactivating closes only this suspension's blocks**, found by their event, never by
-- their person or their organization. Criterion 7 is that sentence: a subscription
-- suspended for non-payment during this period keeps denying afterwards, because its
-- cause is a different row and nothing here touches it.
--
-- **Criteria 3, 4 and 6 are structural rather than checked.** There is no statement in
-- either function that can revoke a grant, end a relationship, drop a membership or
-- delete a session. That is the guarantee, and it is worth more than a condition that
-- could be edited later.
--
-- **A suspended gym is not reachable from `unclaimed`.** Nobody has claimed it, so it
-- is not operating and there is nothing to cut. From `cancelled` or `closed` it is not
-- reachable either: those are terminal, and suspension is explicitly reversible.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- The state
-- ---------------------------------------------------------------------------

alter table organizations.organizations
  add column if not exists suspended_at timestamptz;

-- A suspended gym was claimed and is not cancelled: it is an operating gym that has
-- been stopped, which is exactly why reactivating needs no new acceptance.
alter table organizations.organizations
  drop constraint ck_organizations_lifecycle_shape,
  add constraint ck_organizations_lifecycle_shape check (
    (status = 'unclaimed' and claimed_at is null and cancelled_at is null
      and suspended_at is null)
    or (status = 'active' and claimed_at is not null and cancelled_at is null
      and suspended_at is null)
    or (status = 'suspended' and claimed_at is not null and cancelled_at is null
      and suspended_at is not null)
    or (status = 'cancelled' and claimed_at is null and cancelled_at is not null
      and suspended_at is null)
    or (status = 'closed' and cancelled_at is null and suspended_at is null)
  );

-- ---------------------------------------------------------------------------
-- Who did it, why, and for how long — criterion 8
-- ---------------------------------------------------------------------------

create table organizations.organization_suspensions (
  id uuid not null default extensions.uuid_generate_v7(),
  organization_id uuid not null,
  reason_code text not null,
  started_at timestamptz not null default clock_timestamp(),
  started_by_person_id uuid not null,
  started_by_duty_assignment_id uuid not null,
  started_event_id uuid not null,
  ended_at timestamptz,
  ended_by_person_id uuid,
  ended_by_duty_assignment_id uuid,
  ended_event_id uuid,
  constraint pk_organization_suspensions primary key (id),
  constraint fk_organization_suspensions_organization foreign key (organization_id) references organizations.organizations (id) on delete restrict,
  constraint fk_organization_suspensions_started_by foreign key (started_by_person_id) references identity.people (id) on delete restrict,
  constraint fk_organization_suspensions_started_duty foreign key (started_by_duty_assignment_id) references support.platform_duty_assignments (id) on delete restrict,
  constraint fk_organization_suspensions_started_event foreign key (started_event_id) references organizations.organization_events (id) on delete restrict,
  constraint fk_organization_suspensions_ended_by foreign key (ended_by_person_id) references identity.people (id) on delete restrict,
  constraint fk_organization_suspensions_ended_duty foreign key (ended_by_duty_assignment_id) references support.platform_duty_assignments (id) on delete restrict,
  constraint fk_organization_suspensions_ended_event foreign key (ended_event_id) references organizations.organization_events (id) on delete restrict,
  -- Criterion 9: a closed reason, so the record cannot become free text nobody reads.
  -- Non-payment is the case the story names; the rest are the ones that would otherwise
  -- be written as non-payment because there was nowhere else to put them.
  constraint ck_organization_suspensions_reason check (
    reason_code in ('nonpayment', 'terms_breach', 'security_incident', 'legal_requirement')
  ),
  -- Ended is all four columns or none: half a closure would lose who lifted it.
  constraint ck_organization_suspensions_ended check (
    (ended_at is null and ended_by_person_id is null
      and ended_by_duty_assignment_id is null and ended_event_id is null)
    or (ended_at is not null and ended_at >= started_at and ended_by_person_id is not null
      and ended_by_duty_assignment_id is not null and ended_event_id is not null)
  )
);

-- One open period per organization, which is what makes suspending idempotent and
-- reactivating unambiguous: there is never a second row to wonder about.
create unique index uidx_organization_suspensions_open
  on organizations.organization_suspensions (organization_id)
  where ended_at is null;

create index idx_organization_suspensions_organization_started
  on organizations.organization_suspensions (organization_id, started_at desc);

alter table organizations.organization_suspensions enable row level security;
alter table organizations.organization_suspensions force row level security;

create policy organization_suspensions_all_owner
  on organizations.organization_suspensions
  for all to allfit_owner
  using (true)
  with check (true);

create or replace function organizations.prevent_organization_suspension_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'a suspension period is the evidence of a stopped gym and is never deleted'
      using errcode = '55000';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.reason_code is distinct from old.reason_code
     or new.started_at is distinct from old.started_at
     or new.started_by_person_id is distinct from old.started_by_person_id
     or new.started_by_duty_assignment_id is distinct from old.started_by_duty_assignment_id
     or new.started_event_id is distinct from old.started_event_id then
    raise exception 'a suspension period keeps why it started; a new reason is a new period'
      using errcode = '55000';
  end if;
  if old.ended_at is not null then
    raise exception 'a suspension period that ended does not reopen' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger trg_organization_suspensions_guard
before update or delete on organizations.organization_suspensions
for each row execute function organizations.prevent_organization_suspension_rewrite();

comment on table organizations.organization_suspensions is
  'Why a gym was stopped and for how long. Survives the gym going back to active.';

-- ---------------------------------------------------------------------------
-- The contract learns the new state
-- ---------------------------------------------------------------------------

-- Copied forward whole, because a function is replaced whole. The only change is the
-- list of states a snapshot may carry: without it the suspension event is refused by
-- its own audit contract, which is the correct refusal and the reason it is here.
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
        and p_payload->>'status' in (
          'unclaimed', 'active', 'suspended', 'closed', 'cancelled'
        )
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

    -- No limit is `null`, and it is the only shape that is not a number. A quota of
    -- zero would be a gym that may invite nobody, which is not something Allfit sells.
    if system.jsonb_has_exact_keys(
      p_payload,
      array['guest_quota_seats', 'revision_number']
    ) then
      return jsonb_typeof(p_payload->'guest_quota_seats') in ('number', 'null')
        and (
          jsonb_typeof(p_payload->'guest_quota_seats') = 'null'
          or (p_payload->>'guest_quota_seats' ~ '^[1-9][0-9]*$'
            and (p_payload->>'guest_quota_seats')::bigint <= 1000000)
        )
        and jsonb_typeof(p_payload->'revision_number') = 'number'
        and p_payload->>'revision_number' ~ '^(0|[1-9][0-9]*)$';
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

-- ---------------------------------------------------------------------------
-- The two events
-- ---------------------------------------------------------------------------

-- Both carry the ordinary organization snapshot, so the contract gains two names and
-- no new shape. What changed is the status, and both sides of it are readable.
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
      'organization.created_unclaimed.v1', 'organization.cancelled.v1',
      'organization.suspended.v1', 'organization.reactivated.v1'
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
    when p_event_type = 'organization.guest_quota_set.v1' then
      system.jsonb_has_exact_keys(p_payload, array['guest_quota_seats', 'revision_number'])
    else false
  end
$function$;

alter table organizations.organization_events
  drop constraint ck_organization_events_snapshot_pair,
  add constraint ck_organization_events_snapshot_pair check (
    (event_type in (
      'organization.created.v1', 'organization.created_unclaimed.v1',
      'organization.site_created.v1', 'organization.ownership_transferred.v1',
      'organization.claimed.v1'
    ) and before_snapshot is null and after_snapshot is not null)
    or (event_type in (
      'organization.updated.v1', 'organization.site_updated.v1', 'organization.cancelled.v1',
      'organization.guest_quota_set.v1', 'organization.suspended.v1',
      'organization.reactivated.v1'
    ) and before_snapshot is not null and after_snapshot is not null)
  ),
  -- Allfit stops a gym; a gym never stops itself. Both events are platform acts, so
  -- both demand a named person acting under a duty rather than a membership.
  drop constraint ck_organization_events_platform_actor,
  add constraint ck_organization_events_platform_actor check (
    (actor_person_id is null) = (actor_duty_assignment_id is null)
    and not (actor_membership_id is not null and actor_person_id is not null)
    and (
      event_type not in (
        'organization.created_unclaimed.v1', 'organization.cancelled.v1',
        'organization.guest_quota_set.v1', 'organization.suspended.v1',
        'organization.reactivated.v1'
      )
      or actor_person_id is not null
    )
    and (event_type <> 'organization.claimed.v1' or actor_membership_id is not null)
  );

-- ---------------------------------------------------------------------------
-- Who may read the blocks a suspension opened
-- ---------------------------------------------------------------------------

/*
 * `service_access_blocks` forces row-level security and answered only the person and
 * her gym's billing administration. Allfit is neither, so the Backoffice would have
 * counted **zero people affected** right after stopping a gym — and zero affected is
 * the one figure that makes a suspension look like it did nothing. Read-only, and only
 * for the duty that suspends.
 */
create policy service_access_blocks_select_lifecycle
  on planning.service_access_blocks
  for select to allfit_owner
  using (
    source_kind = 'organization_suspension'
    and access_control.actor_kind() = 'support'
    and access_control.has_platform_duty(
      access_control.person(),
      nullif(current_setting('app.actor_session_id', true), '')::uuid,
      'manage_organization_lifecycle'
    )
  );

-- ---------------------------------------------------------------------------
-- What the Backoffice reads back
-- ---------------------------------------------------------------------------

create or replace function organizations.organization_suspension_projection(
  p_organization_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'organization_id', organization.id,
    'status', organization.status,
    'suspended', organization.status = 'suspended',
    'suspended_at', organization.suspended_at,
    'current',
      case
        when open_period.id is null then null
        else jsonb_build_object(
          'suspension_id', open_period.id,
          'reason_code', open_period.reason_code,
          'started_at', open_period.started_at,
          'started_by_person_id', open_period.started_by_person_id,
          -- What the decision actually cost, counted from the causes it opened rather
          -- than from the relationships it did not touch.
          'people_blocked', (
            select count(*)::integer
            from planning.service_access_blocks as block
            where block.organization_event_id = open_period.started_event_id
              and block.ended_at is null
          )
        )
      end,
    -- Criterion 8 outliving the state: a gym back on its feet still says it was stopped.
    'history', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'suspension_id', period.id,
            'reason_code', period.reason_code,
            'started_at', period.started_at,
            'started_by_person_id', period.started_by_person_id,
            'ended_at', period.ended_at,
            'ended_by_person_id', period.ended_by_person_id
          )
          order by period.started_at desc
        )
        from organizations.organization_suspensions as period
        where period.organization_id = organization.id
      ),
      '[]'::jsonb
    )
  )
  from organizations.organizations as organization
  left join organizations.organization_suspensions as open_period
    on open_period.organization_id = organization.id and open_period.ended_at is null
  where organization.id = p_organization_id
$function$;

-- ---------------------------------------------------------------------------
-- OP-ORG-024 — stopping a gym
-- ---------------------------------------------------------------------------

create or replace function organizations.suspend_organization(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_organization_id uuid,
  p_reason_code text,
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
  target organizations.organizations%rowtype;
  event_id uuid;
begin
  duty_id := organizations.require_organization_lifecycle_duty(
    p_actor_person_id, p_actor_session_id
  );

  if p_reason_code not in (
    'nonpayment', 'terms_breach', 'security_incident', 'legal_requirement'
  ) then
    raise exception 'a suspension is recorded under one of the agreed reasons'
      using errcode = '22023';
  end if;

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
    'OP-ORG-024', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query
    select organizations.organization_suspension_projection(receipt.aggregate_id), true;
    return;
  end if;

  -- Converges. Already stopped is the state this command asks for, and a retry must
  -- not open a second period or a second set of causes.
  if target.status = 'suspended' then
    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'organization-suspended',
      'organization', p_organization_id
    );
    return query
    select organizations.organization_suspension_projection(p_organization_id), false;
    return;
  end if;

  if target.status <> 'active' then
    raise exception 'only a gym that is operating is suspended' using errcode = '55000';
  end if;

  update organizations.organizations
  set status = 'suspended', suspended_at = clock_timestamp()
  where id = p_organization_id;

  insert into organizations.organization_events (
    organization_id, event_type, before_snapshot, after_snapshot,
    actor_person_id, actor_duty_assignment_id
  )
  select organization.id,
         'organization.suspended.v1',
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
  where organization.id = p_organization_id
  returning id into event_id;

  insert into organizations.organization_suspensions (
    organization_id, reason_code, started_by_person_id, started_by_duty_assignment_id,
    started_event_id
  )
  values (p_organization_id, p_reason_code, p_actor_person_id, duty_id, event_id);

  /*
   * One cause per person the gym is currently serving. Nothing below revokes a grant,
   * ends a relationship or cancels a session — the rows are the only thing written,
   * and that is what makes criteria 3, 4 and 6 structural rather than promised.
   */
  insert into planning.service_access_blocks (
    person_id, organization_id, relationship_id, organization_event_id, source_kind,
    blocks_future_sessions, blocks_professional_contribution, created_by_kind
  )
  select relationship.person_id, p_organization_id, relationship.id, event_id,
         'organization_suspension', true, true, 'support'
  from relationships.service_relationships as relationship
  where relationship.organization_id = p_organization_id
    and relationship.status = 'active';

  perform system.enqueue_outbox_event(
    'organization', p_organization_id, 'organization.suspended.v1',
    jsonb_build_object(
      'organization_id', p_organization_id,
      'reason_code', p_reason_code
    )
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'organization-suspended',
    'organization', p_organization_id
  );
  return query
  select organizations.organization_suspension_projection(p_organization_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- OP-ORG-025 — letting it operate again
-- ---------------------------------------------------------------------------

/*
 * Subtractive, like `payments.reactivate_subscription`. It removes one cause and
 * nothing else: no grant returns, no relationship restarts, no cancelled session comes
 * back, and nothing that lapsed during the period is revived. Whatever else is open
 * keeps denying, which is why the blocks are closed by their event and never by their
 * organization.
 */
create or replace function organizations.reactivate_organization(
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
  target organizations.organizations%rowtype;
  period organizations.organization_suspensions%rowtype;
  event_id uuid;
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
    'OP-ORG-025', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    return query
    select organizations.organization_suspension_projection(receipt.aggregate_id), true;
    return;
  end if;

  if target.status = 'active' then
    perform system.finish_idempotency(
      receipt.receipt_id, 200::smallint, 'organization-reactivated',
      'organization', p_organization_id
    );
    return query
    select organizations.organization_suspension_projection(p_organization_id), false;
    return;
  end if;

  if target.status <> 'suspended' then
    raise exception 'only a suspended gym is reactivated' using errcode = '55000';
  end if;

  select * into period
  from organizations.organization_suspensions as suspension
  where suspension.organization_id = p_organization_id
    and suspension.ended_at is null
  for update;
  if period.id is null then
    raise exception 'a suspended gym has an open suspension period' using errcode = '40001';
  end if;

  update organizations.organizations
  set status = 'active', suspended_at = null
  where id = p_organization_id;

  insert into organizations.organization_events (
    organization_id, event_type, before_snapshot, after_snapshot,
    actor_person_id, actor_duty_assignment_id
  )
  select organization.id,
         'organization.reactivated.v1',
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
  where organization.id = p_organization_id
  returning id into event_id;

  update organizations.organization_suspensions
  set ended_at = clock_timestamp(),
      ended_by_person_id = p_actor_person_id,
      ended_by_duty_assignment_id = duty_id,
      ended_event_id = event_id
  where id = period.id;

  -- By the event, which is what makes this close *this* suspension and nothing else.
  update planning.service_access_blocks
  set ended_at = clock_timestamp()
  where organization_event_id = period.started_event_id
    and ended_at is null;

  perform system.enqueue_outbox_event(
    'organization', p_organization_id, 'organization.reactivated.v1',
    jsonb_build_object('organization_id', p_organization_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'organization-reactivated',
    'organization', p_organization_id
  );
  return query
  select organizations.organization_suspension_projection(p_organization_id), false;
end
$function$;

-- ---------------------------------------------------------------------------
-- The gym's file says whether it is stopped
-- ---------------------------------------------------------------------------

-- Copied forward whole, with one more key. The screen that stops a gym is the gym's
-- own file, so it has to open already knowing the answer rather than asking twice.
CREATE OR REPLACE FUNCTION organizations.read_backoffice_organization(p_actor_person_id uuid, p_actor_session_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target organizations.organizations%rowtype;
  type_label text;
  natural_person boolean;
  owner_entry jsonb;
  team_entries jsonb := '[]'::jsonb;
  site_entries jsonb;
  active_count integer;
  served_active integer;
  plan_entries jsonb;
  payment_method jsonb;
  connection payments.gateway_connections%rowtype;
  pro_published boolean;
  served_terminated integer;
  terminated_count integer;
  member record;
  trace uuid := coalesce(
    nullif(current_setting('app.request_id', true), '')::uuid,
    extensions.uuid_generate_v7()
  );
begin
  perform organizations.require_organization_directory_reader(p_actor_person_id, p_actor_session_id);

  select organization.* into target
  from organizations.organizations as organization
  where organization.id = p_organization_id;
  if target.id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select organization_type.name into type_label
  from organizations.organization_types as organization_type
  where organization_type.code = target.type_code;
  natural_person := target.responsible_party->>'party_kind' = 'natural_person';

  select count(*) filter (where membership.status = 'active'),
         count(*) filter (where membership.status = 'terminated')
  into active_count, terminated_count
  from organizations.organization_memberships as membership
  where membership.organization_id = p_organization_id;

  -- The people it serves, counted the way the team is. A relationship that ended is
  -- kept apart rather than dropped: criterion 3 asks for the state as well.
  select count(*) filter (where relationship.status = 'active'),
         count(*) filter (where relationship.status = 'terminated')
  into served_active, served_terminated
  from relationships.service_relationships as relationship
  where relationship.organization_id = p_organization_id;

  select jsonb_build_object(
           'person_id', membership.person_id,
           'membership_id', membership.id,
           'since', membership_role.valid_from
         )
  into owner_entry
  from organizations.organization_memberships as membership
  join organizations.membership_roles as membership_role
    on membership_role.membership_id = membership.id
   and membership_role.role_code = 'owner'
   and membership_role.valid_to is null
  where membership.organization_id = p_organization_id
    and membership.status = 'active'
  order by membership_role.valid_from desc
  limit 1;

  -- The owner is listed first, so a truncated team never leaves out the one member
  -- the file already named.
  for member in
    select listed.*
    from (
      select membership.id as membership_id,
             membership.person_id,
             membership.joined_at,
             coalesce((
               select array_agg(
                 membership_role.role_code
                 order by case membership_role.role_code
                   when 'owner' then 1
                   when 'admin' then 2
                   when 'coach' then 3
                   else 4
                 end
               )
               from organizations.membership_roles as membership_role
               where membership_role.membership_id = membership.id
                 and membership_role.valid_from <= statement_timestamp()
                 and membership_role.valid_to is null
             ), array[]::text[]) as roles
      from organizations.organization_memberships as membership
      where membership.organization_id = p_organization_id
        and membership.status = 'active'
    ) as listed
    order by ('owner' = any(listed.roles)) desc, listed.joined_at, listed.membership_id
    limit 200
  loop
    insert into privacy.access_events (
      actor_person_id, subject_person_id, resource, resource_id, purpose, result,
      request_id, access_mode
    ) values (
      p_actor_person_id, member.person_id, 'organizations.organization_memberships',
      member.membership_id, 'support_diagnosis', 'allowed', trace,
      'support_metadata'::privacy.access_mode
    );
    team_entries := team_entries || jsonb_build_array(jsonb_build_object(
      'membership_id', member.membership_id,
      'person_id', member.person_id,
      'roles', to_jsonb(member.roles),
      'joined_at', member.joined_at
    ));
  end loop;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'site_id', site.id,
               'name', site.name,
               'address', case when natural_person then null else site.address end,
               'address_withheld', natural_person and site.address is not null,
               'status', site.status
             )
             order by site.created_at, site.id
           ),
           '[]'::jsonb
         )
  into site_entries
  from organizations.organization_sites as site
  where site.organization_id = p_organization_id;

  /*
   * Criterion 4: the published plans and their subscribers. A draft is not an offer
   * and does not appear; the price shown is the live version, which is the one a new
   * subscriber would agree to, and a plan whose version was deprecated keeps the
   * subscribers it already has.
   */
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'plan_id', offer.plan_id,
               'name', offer.name,
               'version_id', offer.version_id,
               'version_number', offer.version_number,
               'amount_minor', offer.amount_minor,
               'currency_code', offer.currency_code,
               'billing_period', offer.billing_period,
               'subscribers', offer.subscribers
             )
             order by offer.name, offer.plan_id
           ),
           '[]'::jsonb
         )
  into plan_entries
  from (
    select plan.id as plan_id,
           plan.name,
           version.id as version_id,
           version.version_number,
           version.amount_minor,
           version.currency_code,
           version.billing_period,
           (
             select count(*)::integer
             from payments.plan_subscriptions as subscription
             where subscription.plan_version_id = version.id
               and subscription.status <> 'ended'
           ) as subscribers
    from payments.organization_plans as plan
    join payments.plan_versions as version
      on version.plan_id = plan.id
     and version.organization_id = plan.organization_id
    where plan.organization_id = p_organization_id
      and plan.status = 'published'
      and version.status = 'published'
      and version.deprecated_at is null
  ) as offer;

  /*
   * Criterion 5: whether it can be paid, and nothing else. The account reference and
   * the vault key are in `payments.gateway_credentials`, which has no policy for this
   * reader at all — the criterion is «sin ver ninguna credencial», and the way to
   * honour it is to be unable to read them rather than to remember not to select them.
   */
  -- No row leaves every field null, which is the whole answer: not connected.
  select * into connection
  from payments.gateway_connections as live
  where live.organization_id = p_organization_id
    and live.status = 'active';

  payment_method := jsonb_build_object(
    'connected', connection.id is not null,
    'provider', connection.provider,
    'connected_at', connection.connected_at
  );

  -- Criterion 6. By `ADR-043` there is no per-gym switch: every active gym gives Pro
  -- to the people it serves, as long as a paid Pro version is published at all. So the
  -- honest answer is derived, not stored, and it is the same condition
  -- `payments.resolve_pro` resolves by.
  select exists (
    select 1
    from payments.platform_plan_versions as version
    join payments.platform_plans as plan on plan.id = version.platform_plan_id
    where plan.code = 'pro'
      and plan.plan_kind = 'paid'
      and version.status = 'published'
  )
  into pro_published;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'organization_id', target.id,
      'display_name', target.display_name,
      'type_code', target.type_code,
      'type_name', type_label,
      'status', target.status,
      'party_kind', target.responsible_party->>'party_kind',
      'legal_name', case when natural_person then null else target.legal_name end,
      'created_at', target.created_at,
      'claimed_at', target.claimed_at,
      'cancelled_at', target.cancelled_at
    ),
    'owner', owner_entry,
    'team', team_entries,
    'team_counts', jsonb_build_object('active', active_count, 'terminated', terminated_count),
    'team_truncated', active_count > 200,
    'sites', site_entries,
    'people_served', served_active,
    'relationship_counts',
      jsonb_build_object('active', served_active, 'terminated', served_terminated),
    'plans', plan_entries,
    'payment_method', payment_method,
    'guest_quota', organizations.guest_quota_projection(p_organization_id),
    'suspension', organizations.organization_suspension_projection(p_organization_id),
    'premium', jsonb_build_object(
      'gives_pro', target.status = 'active' and pro_published,
      'reason', case
        when not pro_published then 'no_published_pro_version'
        when target.status <> 'active' then 'organization_not_active'
        else null
      end
    )
  );
end
$function$;

alter function organizations.read_backoffice_organization(uuid, uuid, uuid) owner to allfit_owner;
revoke all on function organizations.read_backoffice_organization(uuid, uuid, uuid) from public;
grant execute on function organizations.read_backoffice_organization(uuid, uuid, uuid) to allfit_api;

alter table organizations.organization_suspensions owner to allfit_owner;
revoke all on organizations.organization_suspensions from public, allfit_api;

alter function organizations.organization_suspension_projection(uuid) owner to allfit_owner;
alter function organizations.suspend_organization(uuid, uuid, uuid, text, uuid, uuid, bytea)
  owner to allfit_owner;
alter function organizations.reactivate_organization(uuid, uuid, uuid, uuid, uuid, bytea)
  owner to allfit_owner;

revoke all on function organizations.organization_suspension_projection(uuid) from public;
revoke all on function organizations.suspend_organization(uuid, uuid, uuid, text, uuid, uuid, bytea)
  from public;
revoke all on function organizations.reactivate_organization(uuid, uuid, uuid, uuid, uuid, bytea)
  from public;

grant execute on function organizations.suspend_organization(uuid, uuid, uuid, text, uuid, uuid, bytea)
  to allfit_api;
grant execute on function organizations.reactivate_organization(uuid, uuid, uuid, uuid, uuid, bytea)
  to allfit_api;
