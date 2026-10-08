-- The delivery projection a client invitation needs to be sent at all.
--
-- `relationship.client_invited.v1` has been written to the outbox since
-- `OP-REL-001` shipped, and nothing has ever claimed it. The consequence is not just
-- a missing email: an unclaimed event has no `published_at` and no attempts, so
-- `support.list_operational_events` reports every client invitation ever issued as
-- `pending` — "sin enviar todavía" — for good. The queue fills with work nobody is
-- doing and the technical panel reads like a malfunction.
--
-- This is the half that belongs to the database: the worker asks what to send and
-- gets back the contact, the gym and the validity, exactly as it already does for a
-- team invitation and for an ownership handover.
--
-- **It returns nothing about the offer.** Not the scope codes, not even how many there
-- are. `privacy.invitation_scope_options` admits the gym that asked and the person it
-- was addressed to, and the worker is neither; reading the count would mean widening
-- the most sensitive table in the system so an email could print a number. What the
-- gym is asking for is shown behind the link, to someone holding the token and signed
-- in — which is also the only place it belongs.
--
-- Expiry is not repeated here. `identity.expire_staff_invitations` already expires
-- every pending invitation whose moment has passed, whatever it proposes, and the
-- team batch runs it.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function identity.prepare_client_invitation_delivery(p_event_id uuid)
returns table (
  delivery_state text,
  invitation_id uuid,
  contact text,
  organization_name text,
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
    and event.event_type = 'relationship.client_invited.v1'
  for update of invitation;

  -- A resend of a live invitation enqueues the same event again, so an invitation
  -- that has since been decided, revoked or replaced is skipped rather than resent.
  if target.id is null or target.status <> 'pending' then
    return query select 'skipped'::text, null::uuid, null::text, null::text,
                        null::smallint, null::timestamptz;
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
    return query select 'expired'::text, target.id, null::text, null::text,
                        null::smallint, target.expires_at;
    return;
  end if;

  return query
  select 'ready'::text,
         target.id,
         target.contact::text,
         organization.display_name,
         target.token_key_version,
         target.expires_at
  from organizations.organizations as organization
  join identity.invitation_intents as intent
    on intent.invitation_id = target.id and intent.kind = 'service_relationship'
  where organization.id = target.organization_id;
end
$function$;
alter function identity.prepare_client_invitation_delivery(uuid) owner to allfit_owner;
revoke all on function identity.prepare_client_invitation_delivery(uuid) from public;
grant execute on function identity.prepare_client_invitation_delivery(uuid) to allfit_api;
