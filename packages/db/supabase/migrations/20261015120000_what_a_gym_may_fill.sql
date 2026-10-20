-- OP-ORG-023 and NEW-ORG-INVITE-QUOTA — how many people a gym may have (`HU-BO-034`).
--
-- Allfit sells a gym a number of people. This is where that number is written, and
-- `HU-STUDIO-087` is what will refuse the invitation that would exceed it.
--
-- **No quota means no limit, not zero.** Every gym that exists today was sold without
-- one, so a column that defaulted to a number would cap them all on deploy, and a
-- column that defaulted to zero would stop them inviting anybody. The founder writes
-- the number when the sale says one; until then the gym is unlimited, which is what it
-- was yesterday.
--
-- **Setting it is a commercial act, and creating a gym is not.** `HU-BO-034` asks for
-- `manage_platform_commercial`; `OP-ORG-018` asks for `manage_organization_lifecycle`.
-- Those are two duties on purpose, so the quota is its own command rather than an
-- argument of the creation. Nothing is lost by the gap: an organization nobody has
-- claimed cannot invite anyone, so there is no interval in which a gym without a quota
-- yet can fill one.
--
-- **Lowering it cannot end a relationship.** Criterion 2 is structural here rather than
-- checked: the command writes the organization row and its event, and has no statement
-- that could touch a relationship or an invitation. Below the occupancy the gym is over
-- its quota and says so; nobody is thrown out.
--
-- **What occupies a place is counted in one function.** The Backoffice shows the figure
-- and `HU-STUDIO-087` will enforce it, and two definitions of "occupied" that drifted
-- would be a quota that means something different on each screen. A live relationship
-- and an invitation still awaiting an answer each take a place; an invitation that was
-- rejected, revoked or has run out of time does not, and neither does a team
-- invitation, which is not a client.
--
-- The sum is not a count of people. An unanswered invitation names an email address,
-- not a person, so it cannot be told apart from the relationship of whoever may already
-- be behind it. `HU-STUDIO-087` criterion 3 says what occupies a place, and it says
-- both; counting them separately is what that asks for.
--
-- **Counting relationships needs a policy for this duty.** `service_relationships`
-- forces row-level security and already admits the two duties that open a gym's file.
-- Whoever sets the quota holds a third, so without a policy the occupancy would come
-- back zero at the very moment somebody is deciding a number against it — and zero
-- places taken is the one answer that makes a bad quota look safe.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- The number
-- ---------------------------------------------------------------------------

alter table organizations.organizations
  add column guest_quota_seats integer,
  -- A quota of zero is not a sale; removing the limit is `null`, which says what it
  -- means. The ceiling only keeps a typo from being stored as a commercial term.
  add constraint ck_organizations_guest_quota_seats check (
    guest_quota_seats is null or (guest_quota_seats > 0 and guest_quota_seats <= 1000000)
  );

-- ---------------------------------------------------------------------------
-- The record of the change
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The shape of the record
-- ---------------------------------------------------------------------------

-- A snapshot is checked against its contract, not merely against its key names, so
-- the number that reaches the history is a number. Everything else is unchanged.
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
    when p_event_type = 'organization.guest_quota_set.v1' then
      system.jsonb_has_exact_keys(p_payload, array['guest_quota_seats', 'revision_number'])
    else false
  end
$function$;

-- Both snapshots, always. The quota a gym had before its first one was "no limit",
-- which is a value the operator needs to read back, not an absence.
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
      'organization.guest_quota_set.v1'
    ) and before_snapshot is not null and after_snapshot is not null)
  ),
  -- Criterion 4: the actor is a named human acting under a duty, never a membership.
  -- A gym never sets its own quota.
  drop constraint ck_organization_events_platform_actor,
  add constraint ck_organization_events_platform_actor check (
    (actor_person_id is null) = (actor_duty_assignment_id is null)
    and not (actor_membership_id is not null and actor_person_id is not null)
    and (
      event_type not in (
        'organization.created_unclaimed.v1', 'organization.cancelled.v1',
        'organization.guest_quota_set.v1'
      )
      or actor_person_id is not null
    )
    and (event_type <> 'organization.claimed.v1' or actor_membership_id is not null)
  );

-- ---------------------------------------------------------------------------
-- Who may set it
-- ---------------------------------------------------------------------------

-- Returns the assignment acted under, so the record names it rather than deriving it
-- later from a duty that may have lapsed since.
create or replace function organizations.require_platform_commercial_duty(
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
       p_actor_person_id, p_actor_session_id, 'manage_platform_commercial'
     ) then
    select assignment.id into assignment_id
    from support.platform_duty_assignments as assignment
    where assignment.person_id = p_actor_person_id
      and assignment.duty_code = 'manage_platform_commercial'
      and assignment.status = 'active'
      and clock_timestamp() >= assignment.valid_from
      and clock_timestamp() < assignment.valid_to
    order by assignment.valid_to desc
    limit 1;
  end if;

  if assignment_id is null then
    raise exception 'setting what a gym was sold requires an effective commercial duty'
      using errcode = '42501';
  end if;

  -- The occupancy is counted under the policies of the transaction's actor. Same
  -- reasoning as the business panel: a disagreement here would answer zero places
  -- taken, which is the one wrong figure that makes any quota look safe.
  if not access_control.acting_person_is(p_actor_person_id) then
    raise exception 'the quota is set by the actor of this transaction, not for them'
      using errcode = '42501';
  end if;
  return assignment_id;
end
$function$;

alter function organizations.require_platform_commercial_duty(uuid, uuid) owner to allfit_owner;
revoke all on function organizations.require_platform_commercial_duty(uuid, uuid)
  from public, allfit_api;

-- Reading only, and counting only. Whoever sets a quota never writes a relationship:
-- ending one belongs to the person or to the gym.
create policy service_relationships_select_guest_quota
  on relationships.service_relationships
  for select
  to allfit_owner
  using (access_control.holds_backoffice_duty('manage_platform_commercial'));

-- ---------------------------------------------------------------------------
-- What occupies a place
-- ---------------------------------------------------------------------------

create or replace function organizations.organization_guest_occupancy(p_organization_id uuid)
returns table (relationships_active integer, invitations_pending integer, occupied integer)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select live.relationships_active,
         live.invitations_pending,
         live.relationships_active + live.invitations_pending
  from (
    select
      (
        select count(*)::integer
        from relationships.service_relationships as relationship
        where relationship.organization_id = p_organization_id
          and relationship.status = 'active'
      ) as relationships_active,
      -- Still awaiting an answer: pending, and with time left. A row that has run out
      -- of time frees its place whether or not a sweep has relabelled it yet.
      (
        select count(*)::integer
        from identity.invitations as invitation
        join identity.invitation_intents as intent
          on intent.invitation_id = invitation.id
         and intent.kind = 'service_relationship'
         and intent.status = 'pending'
        where invitation.organization_id = p_organization_id
          and invitation.status = 'pending'
          and invitation.expires_at > clock_timestamp()
      ) as invitations_pending
  ) as live
$function$;

alter function organizations.organization_guest_occupancy(uuid) owner to allfit_owner;
revoke all on function organizations.organization_guest_occupancy(uuid) from public, allfit_api;

-- ---------------------------------------------------------------------------
-- How it is reported
-- ---------------------------------------------------------------------------

-- `last_change` is an object or null, so "nobody has ever set this" cannot be read as
-- "the previous quota was no limit". Both are answers, and they are not the same one.
create or replace function organizations.guest_quota_projection(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'organization_id', target.id,
    'seats', target.guest_quota_seats,
    'occupied', live.occupied,
    'relationships_active', live.relationships_active,
    'invitations_pending', live.invitations_pending,
    'places_left', case
      when target.guest_quota_seats is null then null
      else greatest(target.guest_quota_seats - live.occupied, 0)
    end,
    'over_quota', target.guest_quota_seats is not null
      and live.occupied > target.guest_quota_seats,
    'last_change', (
      select jsonb_build_object(
        'at', event.occurred_at,
        'by_person_id', event.actor_person_id,
        'by_duty_assignment_id', event.actor_duty_assignment_id,
        'previous_seats', (event.before_snapshot->'guest_quota_seats')
      )
      from organizations.organization_events as event
      where event.organization_id = target.id
        and event.event_type = 'organization.guest_quota_set.v1'
      order by event.occurred_at desc, event.id desc
      limit 1
    )
  )
  from organizations.organizations as target
  cross join lateral organizations.organization_guest_occupancy(target.id) as live
  where target.id = p_organization_id
$function$;

alter function organizations.guest_quota_projection(uuid) owner to allfit_owner;
revoke all on function organizations.guest_quota_projection(uuid) from public, allfit_api;

-- ---------------------------------------------------------------------------
-- OP-ORG-023 — set what a gym may fill
-- ---------------------------------------------------------------------------

create or replace function organizations.set_organization_guest_quota(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_organization_id uuid,
  p_seats integer,
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
begin
  duty_id := organizations.require_platform_commercial_duty(
    p_actor_person_id, p_actor_session_id
  );

  if p_seats is not null and (p_seats <= 0 or p_seats > 1000000) then
    raise exception 'a quota is a number of people, or none at all' using errcode = '22023';
  end if;

  -- Locked before the state is read, so two operators deciding at once leave the
  -- second one's event with the first one's value as its previous.
  select organization.* into target
  from organizations.organizations as organization
  where organization.id = p_organization_id
  for update;
  if target.id is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if target.status in ('closed', 'cancelled') then
    raise exception 'a gym that no longer operates is not sold a quota' using errcode = '55000';
  end if;

  select * into receipt
  from system.begin_idempotency(
    p_actor_person_id, 'backoffice'::system.command_surface, 'backoffice',
    'OP-ORG-023', p_idempotency_key, p_command_id, p_request_hash
  );
  if not receipt.claimed then
    if receipt.aggregate_id is null then
      raise exception 'idempotent quota decision not found' using errcode = '40001';
    end if;
    return query select organizations.guest_quota_projection(receipt.aggregate_id), true;
    return;
  end if;

  -- The same number again is not a change, and a record of a change that did not
  -- happen would make the history unreadable.
  if target.guest_quota_seats is distinct from p_seats then
    update organizations.organizations
    set guest_quota_seats = p_seats,
        revision_number = revision_number + 1
    where id = p_organization_id;

    insert into organizations.organization_events (
      organization_id, event_type, before_snapshot, after_snapshot,
      actor_person_id, actor_duty_assignment_id
    ) values (
      p_organization_id,
      'organization.guest_quota_set.v1',
      jsonb_build_object(
        'guest_quota_seats', target.guest_quota_seats,
        'revision_number', target.revision_number
      ),
      jsonb_build_object(
        'guest_quota_seats', p_seats,
        'revision_number', target.revision_number + 1
      ),
      p_actor_person_id,
      duty_id
    );
  end if;

  perform system.finish_idempotency(
    receipt.receipt_id, 200::smallint, 'organization-guest-quota-set',
    'organization', p_organization_id
  );
  return query select organizations.guest_quota_projection(p_organization_id), false;
end
$function$;

alter function organizations.set_organization_guest_quota(
  uuid, uuid, uuid, integer, uuid, uuid, bytea
) owner to allfit_owner;
revoke all on function organizations.set_organization_guest_quota(
  uuid, uuid, uuid, integer, uuid, uuid, bytea
) from public;
grant execute on function organizations.set_organization_guest_quota(
  uuid, uuid, uuid, integer, uuid, uuid, bytea
) to allfit_api;

-- ---------------------------------------------------------------------------
-- NEW-SUP-ORG-DETAIL — the file carries the number and what is against it
-- ---------------------------------------------------------------------------

-- Whoever reads a gym's file sees the quota beside the people it serves, because a
-- number without the occupancy beside it cannot be judged. Everything else is
-- unchanged.
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
