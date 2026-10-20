-- What Allfit still collects, and what it stopped collecting (`HU-BO-020` 1).
--
-- The panel could say how many people pay Allfit for Pro and could not say how many
-- stopped. A founder reading only the first figure reads a business that never loses
-- anybody, which is the one wrong conclusion this screen can produce on its own.
--
-- The four figures partition the subscriptions that are not closed, so the total is
-- the sum of its parts rather than a fifth count taken separately. The third state
-- exists because the store owns the status: a renewal that fails leaves the row in
-- `grace`, and when that window passes with no word from the store the subscription
-- is neither collecting nor reported as suspended. It was falling out of every count.
--
-- `suspended` keeps one meaning across the product. The billing notice of
-- `HU-BO-005` counts `status = 'suspended'` and so does this, because two panels of
-- the same platform disagreeing about a word is worse than a state without a name.

set lock_timeout = '5s';
set statement_timeout = '60s';

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
  pro_suspended integer;
  pro_lapsed integer;
  pro_open integer;
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

  /*
   * Criterion 1 of `HU-BO-020`: what Allfit still has open, by whether it is still
   * collecting on it. `uidx_platform_subscriptions_live` allows one subscription per
   * person that is not `ended`, so these are counts of people as much as of rows, and
   * the three states add up to the total exactly.
   *
   * `suspended` is the store's own word and means here what it means in the billing
   * notice of `HU-BO-005`. The third bucket is the one nobody had named: a
   * subscription whose period or grace ran out while the store has not yet said
   * whether it renewed or stopped. Only the store moves that status, so this is a
   * standing state and not a race. Folding it into `suspended` would claim the store
   * reported something it never did; leaving it out made the total disagree with its
   * own parts, which is how it went unnoticed.
   */
  with open_subscription as (
    select
      subscription.status,
      (subscription.status = 'active' and subscription.current_period_end > now_at)
        or (subscription.status = 'grace' and subscription.grace_until > now_at)
        as collecting
    from payments.platform_subscriptions as subscription
    where subscription.status <> 'ended'
  )
  select
    count(*) filter (where collecting)::integer,
    count(*) filter (where not collecting and status = 'suspended')::integer,
    count(*) filter (where not collecting and status <> 'suspended')::integer,
    count(*)::integer
  into pro_paid, pro_suspended, pro_lapsed, pro_open
  from open_subscription;

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
        'suspended_subscriptions', pro_suspended, 'total', null, now_at, minimum
      ),
      support.business_metric(
        'lapsed_subscriptions', pro_lapsed, 'total', null, now_at, minimum
      ),
      support.business_metric('open_subscriptions', pro_open, 'total', null, now_at, minimum),
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
