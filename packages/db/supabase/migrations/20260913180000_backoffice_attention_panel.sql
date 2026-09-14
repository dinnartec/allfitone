-- NEW-SUP-ATTENTION — what needs attention (`HU-BO-005`).
--
-- The panel is the first screen an operator reads, which is exactly why it must not
-- become a way around every other door. Three decisions shape it.
--
-- **A counter is shown only to whoever resolves it.** Each notice is gated by the
-- duty of the screen it leads to: verifications by `verify_professional_credentials`,
-- unclaimed gyms by the directory's own duties, repeated errors by
-- `diagnose_support_metadata`. A notice the operator could not act on is `withheld`,
-- never zero — zero would say nothing is pending. An operator whose duties resolve
-- no notice is refused the panel: the base role authorizes nothing by itself. The
-- destinations check their duty again on every read (criterion 6); this gate is
-- least privilege, not a substitute for theirs.
--
-- **Counters reveal nobody.** No name, contact, organization, aggregate identifier
-- or payload leaves through here, so there is no person to record an access against
-- and none is written — the same reasoning as the diagnosis feed (`HU-BO-031`).
--
-- **Repeated means repeated.** A notification or command type is a notice when it
-- has failed at least twice: every failed delivery attempt counts, and so does every
-- stranded command. Two invented numbers, stated so they can be argued with: the
-- window is 24 hours, and a group list stops at 20. A notification still retrying
-- counts whatever its age, because it is failing now; one that gave up counts only
-- inside the window. A tripped delivery circuit is listed on its own, because it
-- already is the repetition detector.
--
-- Payments and subscriptions have no tables yet, so criterion 1 is `not_modelled`.

set lock_timeout = '5s';
set statement_timeout = '60s';

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
    'billing', jsonb_build_object('availability', 'not_modelled'),
    'credential_verifications', verification_notice,
    'unclaimed_organizations', organization_notice,
    'repeated_failures', failure_notice
  );
end
$function$;

alter function support.read_attention_panel(uuid, uuid) owner to allfit_owner;

revoke all on function support.read_attention_panel(uuid, uuid) from public;

grant execute on function support.read_attention_panel(uuid, uuid) to allfit_api;
