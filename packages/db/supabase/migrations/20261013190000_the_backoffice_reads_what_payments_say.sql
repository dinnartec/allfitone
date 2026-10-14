-- The three Backoffice reads that answered `not_modelled` about money, answering
-- (`HU-BO-004` criteria 3 and 4, `HU-BO-005` criterion 1, `HU-BO-013` criteria 4 to 6).
--
-- Nothing here is new product. Three functions were written against a schema where
-- `payments` did not exist, said so in the only honest way available —`not_modelled`,
-- never zero— and named the day this migration would arrive. Pro (`ADR-043`) and the
-- subscription of a person to a gym both landed on 2026-10-12, so the gap closed.
--
-- **Four decisions shape it.**
--
-- **Allfit bills Pro; a gym bills its own clients.** They are both money a person
-- spends and only one of them is Allfit's revenue: the gym charges through its own
-- gateway and nothing passes through this platform. One figure mixing them would be
-- read as income that does not exist, so they are two figures and the second says so.
--
-- **Money is not a count.** A count fits in an integer and means the same to every
-- reader; an amount needs its currency and its minor unit, and 100 million pesos in
-- minor units does not fit in `integer` at all. So money has its own builder and its
-- own array in the panel, with the amounts listed per currency and never summed
-- across them.
--
-- **An amount can single somebody out as easily as a count.** Below the declared
-- minimum of paying people the amount is `below_threshold` with no value: with two
-- payers, the total is one subtraction away from what each of them pays.
--
-- **The reader has to be able to read the rows.** `allfit_owner` does not bypass
-- RLS, so a panel counting over a table with no policy for its reader returns zero
-- and calls it a figure — which is worse than the gap it replaces. The Pro tables
-- answer `allfit_owner` with `true` and need nothing; the tables that came with the
-- gym subscription are split by actor on purpose and get one named policy per screen
-- they serve. `payments.gateway_credentials` deliberately gets none.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Who may read the rows these figures are counted from
-- ---------------------------------------------------------------------------

-- Pro through a gym cannot be counted without the relationships: it is the condition
-- `payments.resolve_pro` resolves it by. The directory's policy answers the support
-- and lifecycle duties, not the metrics one, and without this the count came back
-- zero while the platform was full of people who do have Pro.
create policy service_relationships_select_platform_metrics
  on relationships.service_relationships
  for select
  to allfit_owner
  using (access_control.counts_platform_metrics());

-- The two panels: the business one counts, the attention one looks for suspensions.
create policy plan_subscriptions_select_platform_metrics
  on payments.plan_subscriptions
  for select
  to allfit_owner
  using (
    access_control.counts_platform_metrics()
    or access_control.holds_backoffice_duty('view_billing_metadata')
  );

-- And the gym's file, which states how many subscribers each published plan has.
-- Same pair the file itself accepts, because that file is where the figure appears.
create policy plan_subscriptions_select_backoffice_file
  on payments.plan_subscriptions
  for select
  to allfit_owner
  using (
    access_control.holds_backoffice_duty('diagnose_support_metadata')
    or access_control.holds_backoffice_duty('manage_organization_lifecycle')
  );

create policy organization_plans_select_backoffice_file
  on payments.organization_plans
  for select
  to allfit_owner
  using (
    access_control.holds_backoffice_duty('diagnose_support_metadata')
    or access_control.holds_backoffice_duty('manage_organization_lifecycle')
  );

create policy plan_versions_select_backoffice_file
  on payments.plan_versions
  for select
  to allfit_owner
  using (
    access_control.holds_backoffice_duty('diagnose_support_metadata')
    or access_control.holds_backoffice_duty('manage_organization_lifecycle')
  );

-- Whether the gym can be paid at all, which is `HU-BO-013` criterion 5.
--
-- `payments.gateway_credentials` gets no policy of any kind here, and that absence is
-- the criterion: «sin ver ninguna credencial». The account reference and the vault key
-- live one table along precisely so that reading the first is not reading the second,
-- and a Backoffice operator has no business with either.
create policy gateway_connections_select_backoffice_file
  on payments.gateway_connections
  for select
  to allfit_owner
  using (
    access_control.holds_backoffice_duty('diagnose_support_metadata')
    or access_control.holds_backoffice_duty('manage_organization_lifecycle')
  );

-- ---------------------------------------------------------------------------
-- The actor of the transaction and the actor being asked about are one person
-- ---------------------------------------------------------------------------

/*
 * Found by a test, and worth stating as a rule.
 *
 * These three reads take the actor as a parameter and check the duty against it. The
 * policies underneath them resolve the actor from the transaction instead, because a
 * policy cannot see a function argument. While the figures came from tables with a
 * `true` policy for `allfit_owner` the two could disagree harmlessly; now that they
 * come from tables split by actor, a disagreement means every count silently returns
 * zero — a figure the panel never counted, published as if it had.
 *
 * So the disagreement fails closed instead. The read ritual sets both from the same
 * resolved person, so this cannot fire in the API; it fires for a caller that skipped
 * step 4, and a refusal is the only honest answer to that.
 */
-- A predicate rather than a check that raises: each gate says what it is refusing, and
-- `plpgsql_check` reads a `perform` of a function as volatile, which would make three
-- read-only functions declare themselves otherwise.
create or replace function access_control.acting_person_is(p_actor_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select access_control.person() is not distinct from p_actor_person_id
$function$;

alter function access_control.acting_person_is(uuid) owner to allfit_owner;
revoke all on function access_control.acting_person_is(uuid) from public, allfit_api;

create or replace function support.require_platform_metrics_reader(
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
  -- The duty check below already requires an active administrator on this very
  -- session, so asking for the role first is defence in depth, not the gate.
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin') then
    raise exception 'reading how the business is going requires the platform administrator role'
      using errcode = '42501';
  end if;

  if not access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'view_platform_metrics'
  ) then
    raise exception 'reading how the business is going requires view_platform_metrics'
      using errcode = '42501';
  end if;

  -- The figures are counted under the policies of the transaction's actor, not of this
  -- parameter. If they are different people every count comes back zero.
  if not access_control.acting_person_is(p_actor_person_id) then
    raise exception 'the business panel is read by the actor of this transaction, not for them'
      using errcode = '42501';
  end if;
end
$function$;

alter function support.require_platform_metrics_reader(uuid, uuid) owner to allfit_owner;
revoke all on function support.require_platform_metrics_reader(uuid, uuid) from public;

create or replace function organizations.require_organization_directory_reader(
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
     or not (
       access_control.has_platform_duty(
         p_actor_person_id, p_actor_session_id, 'diagnose_support_metadata'
       )
       or access_control.has_platform_duty(
         p_actor_person_id, p_actor_session_id, 'manage_organization_lifecycle'
       )
     ) then
    raise exception 'reading the organization directory requires an effective support or lifecycle duty'
      using errcode = '42501';
  end if;

  -- The people it serves, its plans and its gateway are all read under the policies of
  -- the transaction's actor. Same reasoning as the business panel.
  if not access_control.acting_person_is(p_actor_person_id) then
    raise exception 'the directory is read by the actor of this transaction, not for them'
      using errcode = '42501';
  end if;
end
$function$;

alter function organizations.require_organization_directory_reader(uuid, uuid) owner to allfit_owner;
revoke all on function organizations.require_organization_directory_reader(uuid, uuid)
  from public, allfit_api;

-- ---------------------------------------------------------------------------
-- One amount, with the three things it must never be published without
-- ---------------------------------------------------------------------------

-- The money counterpart of `support.business_metric`. It differs in three ways that
-- all come from money not being a count: the amounts arrive per currency and are
-- never added across them, each one is a `bigint` because minor units of a peso
-- overflow `integer` within a month of modest billing, and the threshold is about the
-- number of people who paid rather than the size of the amount.
create or replace function support.business_money_metric(
  p_key text,
  p_amounts jsonb,
  p_payers integer,
  p_period_kind text,
  p_period_from timestamptz,
  p_period_to timestamptz,
  p_minimum integer default 0,
  p_reason text default null
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'key', p_key,
    'availability', case
      when p_amounts is null or p_payers is null then 'not_modelled'
      when p_payers > 0 and p_payers < p_minimum then 'below_threshold'
      else 'available'
    end,
    'amounts', case
      when p_amounts is null or p_payers is null then null::jsonb
      when p_payers > 0 and p_payers < p_minimum then null::jsonb
      else p_amounts
    end,
    'reason', p_reason,
    'period', jsonb_build_object(
      'kind', p_period_kind,
      'from', p_period_from,
      'to', p_period_to
    )
  )
$function$;

alter function support.business_money_metric(
  text, jsonb, integer, text, timestamptz, timestamptz, integer, text
) owner to allfit_owner;

revoke all on function support.business_money_metric(
  text, jsonb, integer, text, timestamptz, timestamptz, integer, text
) from public;

-- ---------------------------------------------------------------------------
-- How the business is going, with the money in it (`HU-BO-004` 3 and 4)
-- ---------------------------------------------------------------------------

create or replace function support.read_business_panel(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  minimum constant integer := 5;
  now_at timestamptz := clock_timestamp();
  week_from timestamptz;
  month_from timestamptz;
  registered integer;
  arrived integer;
  active integer;
  studio_active integer;
  gyms integer;
  operating integer;
  unclaimed integer;
  pro_published boolean;
  pro_paid integer;
  pro_by_gym integer;
  gym_subscriptions integer;
  billed jsonb;
  payers integer;
begin
  perform support.require_platform_metrics_reader(p_actor_person_id, p_actor_session_id);

  week_from := now_at - interval '7 days';
  month_from := date_trunc('month', now_at);

  -- Somebody who closed their account is not a registered person any more, in this
  -- count or in the arrivals one.
  select
    count(*) filter (where person.status <> 'closed'),
    count(*) filter (where person.status <> 'closed' and person.created_at >= week_from)
  into registered, arrived
  from identity.people as person;

  -- Training is what being active means for a person. The app being open is not.
  select count(distinct session.person_id)
  into active
  from execution.executed_sessions as session
  join identity.people as person on person.id = session.person_id
  where session.started_at >= week_from
    and person.status <> 'closed';

  -- Professionals working in Studio, which is a different question from people
  -- training and stays its own figure.
  select count(distinct account.person_id)
  into studio_active
  from identity.access_sessions as session
  join identity.access_accounts as account on account.id = session.access_account_id
  where session.surface = 'studio'
    and account.person_id is not null
    and session.last_activity_at >= week_from;

  -- Operating means somebody is actually running it: claimed, not closed, and with a
  -- live membership. An unclaimed gym exists on paper and is counted apart.
  select
    count(*),
    count(*) filter (
      where organization.status = 'active'
        and exists (
          select 1
          from organizations.organization_memberships as membership
          where membership.organization_id = organization.id
            and membership.status = 'active'
        )
    ),
    count(*) filter (where organization.status = 'unclaimed')
  into gyms, operating, unclaimed
  from organizations.organizations as organization;

  /*
   * Pro, by the route the person has it. The two conditions and their precedence come
   * from `payments.resolve_pro`, restated in set form because resolving per person
   * would mean one function call per row of the platform. `T-SUP-BIZ-01` pins the two
   * against each other, so the restatement cannot drift away from the authority.
   */
  select exists (
    select 1
    from payments.platform_plan_versions as version
    join payments.platform_plans as plan on plan.id = version.platform_plan_id
    where plan.code = 'pro'
      and plan.plan_kind = 'paid'
      and version.status = 'published'
  )
  into pro_published;

  select count(distinct live.person_id)
  into pro_paid
  from payments.platform_subscriptions as live
  where (live.status = 'active' and live.current_period_end > now_at)
     or (live.status = 'grace' and live.grace_until > now_at);

  -- The store subscription wins, so somebody who pays Allfit is never counted here
  -- as well: a person is on one route, not two.
  if pro_published then
    select count(distinct relationship.person_id)
    into pro_by_gym
    from relationships.service_relationships as relationship
    join organizations.organizations as organization
      on organization.id = relationship.organization_id
    join identity.people as person on person.id = relationship.person_id
    where relationship.status = 'active'
      and organization.status = 'active'
      and person.status <> 'closed'
      and not exists (
        select 1
        from payments.platform_subscriptions as live
        where live.person_id = relationship.person_id
          and (
            (live.status = 'active' and live.current_period_end > now_at)
            or (live.status = 'grace' and live.grace_until > now_at)
          )
      );
  else
    -- Nothing published means nobody has Pro that way. It is a figure and not a gap:
    -- the condition is known, and it is false.
    pro_by_gym := 0;
  end if;

  -- What people pay their gyms. Allfit does not bill it and never sees the money, so
  -- it is a count of bonds with no amount beside it on this panel.
  select count(*)
  into gym_subscriptions
  from payments.plan_subscriptions as subscription
  where subscription.status <> 'ended';

  -- Allfit's own billing: what the stores reported as collected this month, per
  -- currency, because each store charges each person in theirs.
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object('currency_code', billed_row.currency_code,
                           'amount_minor', billed_row.amount_minor)
        order by billed_row.currency_code
      ),
      '[]'::jsonb
    ),
    coalesce(sum(billed_row.payers), 0)::integer
  into billed, payers
  from (
    select record.currency_code,
           sum(record.amount_minor)::bigint as amount_minor,
           count(distinct record.person_id)::integer as payers
    from payments.platform_payment_records as record
    where record.result = 'succeeded'
      and record.occurred_at >= month_from
      and record.amount_minor is not null
      and record.currency_code is not null
    group by record.currency_code
  ) as billed_row;

  return jsonb_build_object(
    'generated_at', now_at,
    'minimum_aggregate', minimum,
    'metrics', jsonb_build_array(
      support.business_metric('registered_people', registered, 'total', null, now_at, minimum),
      support.business_metric('new_people_this_week', arrived, 'week', week_from, now_at, minimum),
      support.business_metric(
        'active_people_this_week', active, 'week', week_from, now_at, minimum
      ),
      support.business_metric(
        'studio_active_professionals_this_week', studio_active, 'week', week_from, now_at, minimum
      ),
      support.business_metric('organizations', gyms, 'total', null, now_at),
      support.business_metric('operating_organizations', operating, 'total', null, now_at),
      support.business_metric('unclaimed_organizations', unclaimed, 'total', null, now_at),
      -- A subscription belongs to exactly one person, so these are counts of people and
      -- the minimum applies. The placeholders passed zero because a figure that does
      -- not exist has nothing to withhold.
      support.business_metric('active_subscriptions', pro_paid, 'total', null, now_at, minimum),
      support.business_metric(
        'active_organization_subscriptions', gym_subscriptions, 'total', null, now_at, minimum
      ),
      support.business_metric(
        'pro_people_paying_allfit', pro_paid, 'total', null, now_at, minimum
      ),
      support.business_metric(
        'pro_people_through_organization', pro_by_gym, 'total', null, now_at, minimum
      ),
      support.business_metric(
        'premium_people', pro_paid + pro_by_gym, 'total', null, now_at, minimum
      )
    ),
    'money', jsonb_build_array(
      support.business_money_metric(
        'billed_this_month', billed, payers, 'month', month_from, now_at, minimum
      )
    )
  );
end
$function$;

alter function support.read_business_panel(uuid, uuid) owner to allfit_owner;
revoke all on function support.read_business_panel(uuid, uuid) from public;
grant execute on function support.read_business_panel(uuid, uuid) to allfit_api;

-- ---------------------------------------------------------------------------
-- What needs attention, including the charges (`HU-BO-005` criterion 1)
-- ---------------------------------------------------------------------------

create or replace function support.read_attention_panel(
  p_actor_person_id uuid,
  p_actor_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  now_at timestamptz := clock_timestamp();
  can_verify boolean;
  can_diagnose boolean;
  can_read_organizations boolean;
  can_bill boolean;
  billing_notice jsonb;
  verification_notice jsonb;
  organization_notice jsonb;
  failure_notice jsonb;
begin
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin') then
    raise exception 'the attention panel requires the platform administrator role'
      using errcode = '42501';
  end if;

  can_verify := access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'verify_professional_credentials'
  );
  can_diagnose := access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'diagnose_support_metadata'
  );
  -- The same pair `require_organization_directory_reader` accepts, because that
  -- directory is where the notice leads.
  can_read_organizations := can_diagnose or access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'manage_organization_lifecycle'
  );
  can_bill := access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'view_billing_metadata'
  );

  if not (can_verify or can_read_organizations or can_bill) then
    raise exception 'the attention panel requires a duty that resolves one of its notices'
      using errcode = '42501';
  end if;

  -- The billing notice counts under the policies of the transaction's actor, not of
  -- this parameter, and a disagreement would count zero of everything.
  if not access_control.acting_person_is(p_actor_person_id) then
    raise exception 'the attention panel is read by the actor of this transaction, not for them'
      using errcode = '42501';
  end if;

  /*
   * Criterion 1, which answered `not_modelled` until payments had tables. Two states
   * and one window, because that is what the platform can actually see:
   *
   * A Pro renewal the store could not collect leaves the subscription in `grace` —
   * the person keeps Pro until `grace_until` and somebody should look before it runs
   * out — and then in `suspended`. Those are the states. The window is for the
   * charges the store reported as failed, 24 hours like the rest of this panel.
   *
   * A gym charge that fails is only visible as a suspension: the gateway worker that
   * records what a provider reports is `OP-PAY-016` and is not built, so the count of
   * failed gym charges is `not_modelled` rather than zero. Zero would say the gyms
   * are collecting everything.
   */
  if can_bill then
    select jsonb_build_object(
      'availability', 'available',
      'window_hours', 24,
      'failed_platform_charges', (
        select count(*)::integer
        from payments.platform_payment_records as record
        where record.result = 'failed'
          and record.occurred_at >= now_at - interval '24 hours'
      ),
      'platform_subscriptions_in_grace', (
        select count(*)::integer
        from payments.platform_subscriptions as subscription
        where subscription.status = 'grace'
      ),
      'platform_subscriptions_suspended', (
        select count(*)::integer
        from payments.platform_subscriptions as subscription
        where subscription.status = 'suspended'
      ),
      'organization_subscriptions_suspended', (
        select count(*)::integer
        from payments.plan_subscriptions as subscription
        where subscription.status = 'suspended'
      ),
      'failed_organization_charges_availability', 'not_modelled'
    )
    into billing_notice;
  else
    billing_notice := jsonb_build_object(
      'availability', 'withheld',
      'window_hours', 24,
      'failed_platform_charges', null,
      'platform_subscriptions_in_grace', null,
      'platform_subscriptions_suspended', null,
      'organization_subscriptions_suspended', null,
      'failed_organization_charges_availability', null
    );
  end if;

  if can_verify then
    select jsonb_build_object(
      'availability', 'available',
      'pending_count', count(*)::integer,
      'oldest_requested_at', min(request.created_at),
      -- The predicate of `identity.list_due_credential_renewals`, counted rather than
      -- listed so nobody's credential is read to produce a number.
      'renewals_due_count', (
        select count(*)::integer
        from identity.professional_credentials as credential
        join lateral (
          select verification.result, verification.valid_to
          from identity.professional_credential_verifications as verification
          where verification.professional_credential_id = credential.id
          order by verification.decided_at desc, verification.id desc
          limit 1
        ) as latest on true
        where credential.status = 'active'
          and latest.result = 'verified'
          and latest.valid_to < now_at + interval '30 days'
          and not exists (
            select 1
            from identity.credential_verification_requests as open_request
            where open_request.professional_credential_id = credential.id
              and open_request.status = 'pending'
          )
      )
    )
    into verification_notice
    from identity.credential_verification_requests as request
    where request.status = 'pending';
  else
    verification_notice := jsonb_build_object(
      'availability', 'withheld',
      'pending_count', null,
      'oldest_requested_at', null,
      'renewals_due_count', null
    );
  end if;

  if can_read_organizations then
    -- Follow-up is needed once the latest ownership invitation is no longer waiting:
    -- it lapsed, was declined, or never existed.
    select jsonb_build_object(
      'availability', 'available',
      'count', count(*)::integer,
      'oldest_created_at', min(organization.created_at),
      'needs_follow_up_count', (count(*) filter (where not coalesce(latest.waiting, false)))::integer
    )
    into organization_notice
    from organizations.organizations as organization
    left join lateral (
      select invitation.status = 'pending'
        and intent.status = 'pending'
        and invitation.expires_at > now_at as waiting
      from identity.invitations as invitation
      join identity.invitation_intents as intent
        on intent.invitation_id = invitation.id
       and intent.kind = 'ownership'
      where invitation.organization_id = organization.id
      order by invitation.created_at desc, invitation.id desc
      limit 1
    ) as latest on true
    where organization.status = 'unclaimed';
  else
    organization_notice := jsonb_build_object(
      'availability', 'withheld',
      'count', null,
      'oldest_created_at', null,
      'needs_follow_up_count', null
    );
  end if;

  if can_diagnose then
    with failing as (
      select
        'notification'::text as source,
        event.event_type as label,
        event.attempt_count as failed_attempts,
        coalesce(event.dead_lettered_at, event.occurred_at) as happened_at,
        event.last_error_code as error_code
      from system.outbox_events as event
      where event.published_at is null
        and event.attempt_count > 0
        and (event.dead_lettered_at is null or event.dead_lettered_at >= now_at - interval '24 hours')

      union all

      select
        'command'::text,
        receipt.operation_code,
        1,
        receipt.created_at,
        receipt.outcome_code
      from system.idempotency_keys as receipt
      where receipt.status = 'processing'
        and receipt.created_at >= now_at - interval '24 hours'
        and support.command_state(receipt.status, receipt.created_at) = 'stalled'
    ),
    grouped as (
      select
        failing.source,
        failing.label,
        count(*)::integer as affected,
        sum(failing.failed_attempts)::integer as failures,
        max(failing.happened_at) as latest_occurred_at,
        (array_agg(failing.error_code order by failing.happened_at desc))[1] as last_error_code
      from failing
      group by failing.source, failing.label
      having sum(failing.failed_attempts) >= 2
    )
    select jsonb_build_object(
      'availability', 'available',
      'window_hours', 24,
      'groups', coalesce(
        (
          select jsonb_agg(to_jsonb(top) order by top.failures desc, top.label)
          from (
            select grouped.source, grouped.label, grouped.affected, grouped.failures,
                   grouped.latest_occurred_at, grouped.last_error_code
            from grouped
            order by grouped.failures desc, grouped.label
            limit 20
          ) as top
        ),
        '[]'::jsonb
      ),
      'groups_truncated', (select count(*) > 20 from grouped),
      'open_circuits', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'event_type', circuit.event_type,
              'state', circuit.state,
              'failure_count', circuit.failure_count,
              'opened_until', circuit.opened_until
            )
            order by circuit.failure_count desc, circuit.event_type
          )
          from system.outbox_delivery_circuits as circuit
          where circuit.state in ('open', 'half_open')
        ),
        '[]'::jsonb
      )
    )
    into failure_notice;
  else
    failure_notice := jsonb_build_object(
      'availability', 'withheld',
      'window_hours', 24,
      'groups', null,
      'groups_truncated', null,
      'open_circuits', null
    );
  end if;

  return jsonb_build_object(
    'generated_at', now_at,
    'billing', billing_notice,
    'credential_verifications', verification_notice,
    'unclaimed_organizations', organization_notice,
    'repeated_failures', failure_notice
  );
end
$function$;

alter function support.read_attention_panel(uuid, uuid) owner to allfit_owner;

revoke all on function support.read_attention_panel(uuid, uuid) from public;

grant execute on function support.read_attention_panel(uuid, uuid) to allfit_api;

-- ---------------------------------------------------------------------------
-- The gym's file: its plans, its gateway and its Pro (`HU-BO-013` 4 to 6)
-- ---------------------------------------------------------------------------

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
