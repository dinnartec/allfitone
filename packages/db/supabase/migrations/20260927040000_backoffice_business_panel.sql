-- NEW-SUP-DASHBOARD — how the business is going (`HU-BO-004`).
--
-- The founder's screen. It answers with counts and nothing else, and four decisions
-- shape what it is allowed to say.
--
-- **A figure without a period is not a figure.** Every metric carries the window it
-- was measured over — a running total, the last seven days, the current month — so
-- no number can be read as whatever the reader assumes.
--
-- **What the platform cannot compute stays empty.** Payments have no tables yet, so
-- subscriptions, billing and Premium answer `not_modelled`; Space is headless and
-- persists no session, so "people active this week" has no signal at all and says
-- so. Zero would be a claim about the business. This is a claim about the platform,
-- and the two must never be confused. The only activity that is recorded is Studio's
-- own sessions, which is professionals working, not people training.
--
-- **A count of people hides a small group.** Below `minimum_aggregate` a count of
-- people is `below_threshold` with no value, so no figure narrows the platform down
-- to somebody. An invented number, stated so it can be argued with: five. A true
-- zero is still published, because it singles nobody out. Gyms are not people and
-- are counted as they are.
--
-- **A figure leads nowhere.** No identifier, name or contact travels here, so there
-- is nothing to record an access against and none is written — the same reasoning as
-- the attention panel (`HU-BO-005`). Reaching a person still means going through the
-- door that asks for a case reference.
--
-- The whole panel is one duty, `view_platform_metrics`: unlike the attention panel
-- there is nothing here to gate notice by notice.

set lock_timeout = '5s';
set statement_timeout = '60s';

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
end
$function$;

alter function support.require_platform_metrics_reader(uuid, uuid) owner to allfit_owner;

revoke all on function support.require_platform_metrics_reader(uuid, uuid) from public;

-- One metric, with the three things it must never be published without: what it
-- counts, over what period, and whether it can be said at all.
--
-- A null `p_value` is the platform admitting it cannot compute this, and `p_reason`
-- says why. A `p_minimum` above zero withholds a small group; zero means the metric
-- counts something other than people, where hiding a small number protects nobody.
create or replace function support.business_metric(
  p_key text,
  p_value integer,
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
      when p_value is null then 'not_modelled'
      when p_value > 0 and p_value < p_minimum then 'below_threshold'
      else 'available'
    end,
    'value', case
      when p_value is null or (p_value > 0 and p_value < p_minimum) then null::jsonb
      else to_jsonb(p_value)
    end,
    'reason', p_reason,
    'period', jsonb_build_object(
      'kind', p_period_kind,
      'from', p_period_from,
      'to', p_period_to
    )
  )
$function$;

alter function support.business_metric(
  text, integer, text, timestamptz, timestamptz, integer, text
) owner to allfit_owner;

revoke all on function support.business_metric(
  text, integer, text, timestamptz, timestamptz, integer, text
) from public;

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
  studio_active integer;
  gyms integer;
  operating integer;
  unclaimed integer;
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

  -- The only activity the platform records. Space signs in through the API and keeps
  -- no session row, so this is professionals in Studio and must be labelled as such.
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

  return jsonb_build_object(
    'generated_at', now_at,
    'minimum_aggregate', minimum,
    'metrics', jsonb_build_array(
      support.business_metric('registered_people', registered, 'total', null, now_at, minimum),
      support.business_metric('new_people_this_week', arrived, 'week', week_from, now_at, minimum),
      support.business_metric(
        'active_people_this_week', null, 'week', week_from, now_at, minimum,
        'space_sessions_not_recorded'
      ),
      support.business_metric(
        'studio_active_professionals_this_week', studio_active, 'week', week_from, now_at, minimum
      ),
      support.business_metric('organizations', gyms, 'total', null, now_at),
      support.business_metric('operating_organizations', operating, 'total', null, now_at),
      support.business_metric('unclaimed_organizations', unclaimed, 'total', null, now_at),
      support.business_metric(
        'active_subscriptions', null, 'total', null, now_at, 0, 'payments_not_modelled'
      ),
      support.business_metric(
        'billed_this_month', null, 'month', month_from, now_at, 0, 'payments_not_modelled'
      ),
      support.business_metric(
        'premium_people', null, 'total', null, now_at, minimum, 'payments_not_modelled'
      )
    )
  );
end
$function$;

alter function support.read_business_panel(uuid, uuid) owner to allfit_owner;

revoke all on function support.read_business_panel(uuid, uuid) from public;

grant execute on function support.read_business_panel(uuid, uuid) to allfit_api;
