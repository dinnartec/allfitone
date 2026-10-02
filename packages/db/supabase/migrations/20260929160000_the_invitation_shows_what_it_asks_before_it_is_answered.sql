-- An invitation has to show what it asks for before anyone can answer it.
--
-- `decide_client_invitation` takes a decision per scope, which presumes the
-- person has already seen each scope, its purpose, the access level asked for
-- and the contract version it was offered under. Nothing returned that.
-- `client_invitation_projection` takes an invitation id, and the person holding
-- the emailed link has a token, not an id.
--
-- Team invitations resolve anonymously (`resolve_staff_invitation`): a pending
-- staff invitation reveals an organization name and a proposed role, which is
-- what the recipient already read in the email. This one does not resolve
-- anonymously. What it returns is the list of health-data categories an
-- organization wants access to, and that belongs to the person it was addressed
-- to — so it applies the same recipient test the decision applies, and refuses
-- the same way.
--
-- The scope rows are additionally filtered by
-- `invitation_scope_options_select_actor`, so a caller who somehow passed the
-- check above would still read no options. The explicit check is what makes the
-- refusal a refusal instead of an invitation with an empty offer, which would
-- still confirm the invitation exists.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function identity.resolve_client_invitation(p_token_hash bytea)
returns table (
  invitation_id uuid,
  status text,
  organization_id uuid,
  organization_display_name text,
  responsible_party jsonb,
  expires_at timestamptz,
  invitation_intent_id uuid,
  scope_options jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
begin
  if access_control.actor_kind() <> 'person' then
    raise exception 'person actor required' using errcode = '42501';
  end if;
  if octet_length(p_token_hash) <> 32 then
    raise exception 'invalid invitation token' using errcode = '22023';
  end if;

  select invitation.id,
         invitation.status::text as invitation_status,
         invitation.organization_id,
         invitation.contact::text as contact,
         invitation.expires_at,
         intent.id as intent_id
    into target
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.kind = 'service_relationship'
  where invitation.token_hash = p_token_hash;

  if not found then
    return;
  end if;

  -- The invitation is addressed to a contact, and only the person who proved
  -- that contact is theirs may read it. Same test as the decision.
  if lower(target.contact) is distinct from
     lower(nullif(current_setting('app.actor_verified_email', true), '')) then
    raise exception 'verified email mismatch' using errcode = '42501';
  end if;

  /*
   * Expiry is settled on read, as it is for team invitations: nothing else
   * runs between the deadline passing and someone arriving with the link, and
   * an invitation that reads as pending after it expired would be answered.
   */
  if target.invitation_status = 'pending' and target.expires_at <= clock_timestamp() then
    update identity.invitations as invitation
    set status = 'expired'
    where invitation.id = target.id;

    update identity.invitation_intents as intent
    set status = 'expired', decided_at = clock_timestamp()
    where intent.invitation_id = target.id
      and intent.status = 'pending';

    perform system.enqueue_outbox_event(
      'invitation',
      target.id,
      'identity.invitation_expired.v1',
      jsonb_build_object('invitation_id', target.id)
    );
    return;
  end if;

  return query
  select target.id,
         target.invitation_status,
         target.organization_id,
         organization.display_name,
         invitation.responsible_party,
         target.expires_at,
         target.intent_id,
         coalesce(
           (
             select jsonb_agg(
                      jsonb_build_object(
                        'scope_code', option.scope_code,
                        'offered_access_level', option.offered_access_level,
                        'purpose', option.purpose,
                        'presented_snapshot_schema_version', option.presented_snapshot_schema_version,
                        'presented_snapshot', option.presented_snapshot,
                        'decision', option.decision
                      )
                      order by option.scope_code
                    )
             from privacy.invitation_scope_options as option
             where option.invitation_intent_id = target.intent_id
           ),
           '[]'::jsonb
         )
  from identity.invitations as invitation
  join organizations.organizations as organization
    on organization.id = invitation.organization_id
  where invitation.id = target.id;
end;
$function$;

grant execute on function identity.resolve_client_invitation(bytea) to allfit_api;
