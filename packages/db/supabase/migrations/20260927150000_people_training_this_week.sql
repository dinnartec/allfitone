-- How many people were active this week (`HU-BO-004`, criterion 1).
--
-- The panel left this empty with the reason `space_sessions_not_recorded`, which was
-- true when it was written: Space signs in through the API and keeps no session row,
-- so the platform had no way to tell who had been there. It records the training
-- itself now, and the training is the better signal anyway — somebody who opened the
-- app and did nothing was not active.
--
-- Two decisions carried over from the metrics beside it. A person is counted once
-- however often they trained, and somebody who closed their account is not a person
-- of the platform any more, here or in the registered count.
--
-- Reading the table takes a policy, because `execution.executed_sessions` forces
-- row-level security and answers only for the person acting. The one granted here is
-- as narrow as a policy can be about a count: the acting person must hold an active
-- `view_platform_metrics` duty on a live AAL2 Backoffice session, which is the gate
-- `support.read_business_panel` already checks before it counts anything.
--
-- It is still wider than it wants to be. A policy filters rows; it cannot say "you
-- may count these but never read one", so while that duty is live those rows are
-- visible to any function running as `allfit_owner`. Narrowing it further means a
-- role of its own for the single function that counts, which is a bigger decision
-- than this metric deserves and is written down rather than taken quietly.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- The duty behind the business panel, without naming a session: a policy cannot see
-- the one the request arrived on, so it asks for any live session that would qualify.
create or replace function access_control.counts_platform_metrics()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from identity.people as person
    join support.platform_role_assignments as role_assignment
      on role_assignment.person_id = person.id
     and role_assignment.platform_role = 'allfit_admin'
     and role_assignment.status = 'active'
    join support.platform_duty_assignments as duty_assignment
      on duty_assignment.person_id = person.id
     and duty_assignment.duty_code = 'view_platform_metrics'
     and duty_assignment.status = 'active'
     and clock_timestamp() >= duty_assignment.valid_from
     and clock_timestamp() < duty_assignment.valid_to
    join identity.access_accounts as account
      on account.person_id = person.id
    join identity.access_sessions as session
      on session.access_account_id = account.id
     and session.surface = 'backoffice'::identity.access_session_surface
     and session.assurance_level = 2
     and session.authentication_method = 'password_totp'
     and session.revoked_at is null
     and session.absolute_expires_at > clock_timestamp()
     and session.last_activity_at > clock_timestamp() - interval '15 minutes'
     and duty_assignment.required_aal <= session.assurance_level
    where person.id = access_control.person()
      and person.status = 'active'
  )
$function$;

alter function access_control.counts_platform_metrics() owner to allfit_owner;
revoke all on function access_control.counts_platform_metrics() from public;

-- Reading only, and only the sessions: a count needs the rows, never what hangs off
-- them, and the child tables keep their own policies untouched.
create policy executed_sessions_platform_metrics
  on execution.executed_sessions
  for select
  to allfit_owner
  using (access_control.counts_platform_metrics());

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
