-- NEW-SUP-PERSON-PAYMENTS — what a person pays (`HU-BO-018`).
--
-- The read behind «me cobraron y no debían». Four decisions shape it.
--
-- **It is a billing read, and nothing else stands in for it.** `view_billing_metadata`
-- is an `A10` duty of its own: the duty that opens a person's support card does not
-- open her money. ADR-028 calls this the minimised duty for payments, and minimised
-- means this one and not the one next to it.
--
-- **Payments are not a break-glass category.** The dictionary is explicit, so this is
-- an ordinary support read: a traceable case reference, and one `privacy.access_events`
-- row written before the content travels. If the record fails, the read fails.
--
-- **Criterion 4 is honoured by having nothing to hide.** No means of payment exists in
-- this schema — the store reports a transaction id and an amount, and the gym's own
-- credential lives behind a table with no policy for anybody here. The projection is
-- closed by enumeration rather than by filtering a row.
--
-- **What Allfit does not charge, it does not know.** A person may also pay her gym,
-- and that bond is shown with its state: hiding it would leave the operator guessing
-- about the complaint in front of them. But the gym collects through its own gateway
-- and the worker that records what a provider reports is `OP-PAY-016`, which is not
-- built, so the charges of that bond are `not_modelled` and not an empty list — an
-- empty list would read as «it never charged her».

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Naming the gym that gives her Pro is half of criterion 1, and the relationship is
-- what says so. The directory policy answers the support and lifecycle duties and the
-- metrics one answers counting; neither is this. Without a policy of its own the read
-- would resolve `free` for somebody who plainly has Pro, which is worse than refusing.
create policy service_relationships_select_billing_support
  on relationships.service_relationships
  for select
  to allfit_owner
  using (access_control.holds_backoffice_duty('view_billing_metadata'));

create or replace function support.require_billing_reader(
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
  if not access_control.has_platform_role(p_actor_person_id, p_actor_session_id, 'allfit_admin') then
    raise exception 'reading what a person pays requires the platform administrator role'
      using errcode = '42501';
  end if;

  if not access_control.has_platform_duty(
    p_actor_person_id, p_actor_session_id, 'view_billing_metadata'
  ) then
    raise exception 'reading what a person pays requires view_billing_metadata'
      using errcode = '42501';
  end if;

  -- The gym that gives her Pro is read under the policies of the transaction's actor,
  -- not of this parameter. If they are different people it comes back empty.
  if not access_control.acting_person_is(p_actor_person_id) then
    raise exception 'this read is performed by the actor of the transaction, not for them'
      using errcode = '42501';
  end if;
end
$function$;

alter function support.require_billing_reader(uuid, uuid) owner to allfit_owner;
revoke all on function support.require_billing_reader(uuid, uuid) from public, allfit_api;

create or replace function support.person_payments(
  p_actor_person_id uuid,
  p_actor_session_id uuid,
  p_case_reference text,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  subject identity.people%rowtype;
  pro jsonb;
  subscription payments.platform_subscriptions%rowtype;
  version payments.platform_plan_versions%rowtype;
  plan_name text;
  charges jsonb;
  charge_count integer;
  bonds jsonb;
  subscription_entry jsonb;
begin
  perform support.require_billing_reader(p_actor_person_id, p_actor_session_id);

  -- The same shape the support card asks for, because it is the same obligation: a
  -- read of somebody's data is traceable to the case that justified it.
  if btrim(coalesce(p_case_reference, '')) !~ '^[A-Z][A-Z0-9_-]{2,63}$' then
    raise exception 'a billing read needs a traceable case reference' using errcode = '22023';
  end if;

  select * into subject from identity.people as person where person.id = p_person_id;
  if subject.id is null then
    raise exception 'person not found' using errcode = 'P0002';
  end if;

  -- The authority on where Pro comes from, asked about one person. Restating its rule
  -- here would be a second source of truth for the same question.
  pro := payments.resolve_pro(p_person_id);

  /*
   * Her store subscription whatever its state, newest first. `resolve_pro` only looks
   * at the live one, and a complaint is usually about one that is not: criterion 3
   * asks for the suspension and the day it started.
   */
  select * into subscription
  from payments.platform_subscriptions as live
  where live.person_id = p_person_id
  order by live.started_at desc, live.id desc
  limit 1;

  if subscription.id is not null then
    select * into version
    from payments.platform_plan_versions as published
    where published.id = subscription.platform_plan_version_id;

    select plan.name into plan_name
    from payments.platform_plans as plan
    where plan.id = version.platform_plan_id;

    subscription_entry := jsonb_build_object(
      'plan_name', plan_name,
      'version_number', version.version_number,
      'amount_minor', version.amount_minor,
      'currency_code', version.currency_code,
      'billing_period', version.billing_period,
      'store', subscription.store,
      'status', subscription.status,
      'auto_renews', subscription.auto_renews,
      'started_at', subscription.started_at,
      'current_period_end', subscription.current_period_end,
      'grace_until', subscription.grace_until,
      'suspended_at', subscription.suspended_at,
      'ended_at', subscription.ended_at,
      'ended_reason', subscription.ended_reason
    );
  end if;

  -- Every charge, the ones that failed included: criterion 2 is about the failures.
  -- Capped like the team list of a gym's file, and the cap is stated rather than
  -- silently applied.
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'occurred_at', recent.occurred_at,
          'store', recent.store,
          'result', recent.result,
          'failure_code', recent.failure_code,
          'amount_minor', recent.amount_minor,
          'currency_code', recent.currency_code
        )
        order by recent.occurred_at desc, recent.id desc
      ),
      '[]'::jsonb
    )
  into charges
  from (
    select record.*
    from payments.platform_payment_records as record
    where record.person_id = p_person_id
    order by record.occurred_at desc, record.id desc
    limit 100
  ) as recent;

  select count(*)::integer into charge_count
  from payments.platform_payment_records as record
  where record.person_id = p_person_id;

  -- What she pays her gyms. States and dates only: the amount is the gym's price and
  -- the money never passes through here.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'subscription_id', bond.id,
               'organization_id', bond.organization_id,
               'organization_name', organization.display_name,
               'status', bond.status,
               'started_at', bond.started_at,
               'suspended_at', bond.suspended_at,
               'ended_at', bond.ended_at
             )
             order by bond.started_at desc, bond.id desc
           ),
           '[]'::jsonb
         )
  into bonds
  from payments.plan_subscriptions as bond
  join organizations.organizations as organization on organization.id = bond.organization_id
  where bond.person_id = p_person_id;

  -- Recorded before the content travels, against the person it is about.
  insert into privacy.access_events (
    actor_person_id, subject_person_id, resource, resource_id, purpose, result,
    request_id, access_mode
  ) values (
    p_actor_person_id,
    p_person_id,
    'payments.person_payments',
    p_person_id,
    'billing_support',
    'allowed',
    coalesce(
      nullif(current_setting('app.request_id', true), '')::uuid,
      extensions.uuid_generate_v7()
    ),
    'support_metadata'::privacy.access_mode
  );

  return jsonb_build_object(
    'person_id', p_person_id,
    'generated_at', clock_timestamp(),
    'pro', jsonb_build_object(
      'source', pro->>'effective_source',
      'subscription', subscription_entry,
      'organizations', pro->'organizations'
    ),
    'payments', charges,
    'payments_truncated', charge_count > 100,
    'organization_subscriptions', bonds,
    'organization_charges_availability', 'not_modelled'
  );
end
$function$;

alter function support.person_payments(uuid, uuid, text, uuid) owner to allfit_owner;
revoke all on function support.person_payments(uuid, uuid, text, uuid) from public;
grant execute on function support.person_payments(uuid, uuid, text, uuid) to allfit_api;
