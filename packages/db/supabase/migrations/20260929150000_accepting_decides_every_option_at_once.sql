-- OP-IDN-009, client half — the person decides a client invitation.
--
-- One transaction produces everything or nothing: the relationship, a consent
-- event for every option presented, and a grant for each one accepted. A
-- person who says yes to training and no to health context gets exactly that,
-- and there is no moment in between where a grant exists without the decision
-- that created it.
--
-- Accepting the relationship is not accepting the scopes. Each option is
-- answered on its own, and rejecting every one still leaves a relationship —
-- the organization knows this person is their client and can read nothing of
-- theirs. That distinction is the whole design, so the tests assert it
-- directly.
--
-- The surface is Space, not Studio: `POST /space/v1/invitations/decisions`.
-- This function is what that route will call.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function identity.decide_client_invitation(
  p_person_id uuid,
  p_token_hash bytea,
  p_intent_id uuid,
  p_relationship_decision text,
  p_scope_decisions jsonb,
  p_idempotency_key uuid,
  p_command_id uuid,
  p_request_hash bytea
)
returns table (
  invitation_id uuid,
  invitation_status text,
  organization_id uuid,
  invitation_intent_id uuid,
  intent_status text,
  relationship_id uuid,
  granted_scope_codes text[],
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target record;
  receipt record;
  decision_time timestamptz := clock_timestamp();
  resolved_relationship_id uuid;
  option record;
  option_decision privacy.consent_decision;
  consent_id uuid;
  granted text[] := array[]::text[];
  replay record;
begin
  if access_control.actor_kind() <> 'person'
     or access_control.person() is distinct from p_person_id then
    raise exception 'person actor mismatch' using errcode = '42501';
  end if;
  if p_relationship_decision not in ('accepted', 'rejected')
     or octet_length(p_token_hash) <> 32
     or jsonb_typeof(p_scope_decisions) <> 'object' then
    raise exception 'invalid invitation decision' using errcode = '22023';
  end if;

  select invitation.id,
         invitation.status,
         invitation.organization_id,
         invitation.contact::text as contact,
         invitation.expires_at,
         intent.id as intent_id,
         intent.status as intent_status
  into target
  from identity.invitations as invitation
  join identity.invitation_intents as intent
    on intent.invitation_id = invitation.id
   and intent.id = p_intent_id
   and intent.kind = 'service_relationship'
  where invitation.token_hash = p_token_hash
  for update of invitation, intent;

  if target.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  -- The invitation is addressed to a contact, and only the person who proved
  -- that contact is theirs may answer it.
  if lower(target.contact) is distinct from
     lower(nullif(current_setting('app.actor_verified_email', true), '')) then
    raise exception 'verified email mismatch' using errcode = '42501';
  end if;
  select * into receipt
  from system.begin_idempotency(
    p_person_id, 'OP-IDN-009', p_idempotency_key, p_command_id, p_request_hash
  );

  if not receipt.claimed then
    select invitation.id,
           invitation.status::text as invitation_status,
           invitation.organization_id,
           intent.id as intent_id,
           intent.status::text as intent_status
    into replay
    from identity.invitations as invitation
    join identity.invitation_intents as intent on intent.invitation_id = invitation.id
    where invitation.id = receipt.aggregate_id
      and intent.id = p_intent_id;
    if replay.id is null or replay.intent_status not in ('accepted', 'rejected') then
      raise exception 'idempotent decision not found' using errcode = '40001';
    end if;
    select relationship.id into resolved_relationship_id
    from relationships.service_relationships as relationship
    where relationship.person_id = p_person_id
      and relationship.organization_id = replay.organization_id
      and relationship.status = 'active';
    select coalesce(array_agg(grant_row.scope_code order by grant_row.scope_code), array[]::text[])
    into granted
    from privacy.data_grants as grant_row
    where grant_row.relationship_id = resolved_relationship_id
      and grant_row.status = 'active';
    return query select replay.id, replay.invitation_status, replay.organization_id,
      replay.intent_id, replay.intent_status, resolved_relationship_id, granted, true;
    return;
  end if;

  -- Checked after the replay branch, not before it. A retry of a decision
  -- that already went through arrives at a closed invitation by definition,
  -- and refusing it there would turn every repeated request into an error
  -- instead of the answer it already earned.
  if target.status <> 'pending' or target.expires_at <= decision_time then
    raise exception 'invitation is no longer open' using errcode = '23514';
  end if;

  if p_relationship_decision = 'rejected' then
    update identity.invitation_intents
    set status = 'rejected', decided_at = decision_time
    where id = p_intent_id;
    -- Every option is answered too: declining the relationship declines what
    -- it was asking for, and the record says so rather than leaving them open.
    --
    -- Aliased because `invitation_intent_id` is also an output column of this
    -- function, and a bare reference is ambiguous. The linter caught it; the
    -- tests did not, because none of them declined a relationship.
    update privacy.invitation_scope_options as scope_option
    set decision = 'rejected', decided_at = decision_time
    where scope_option.invitation_intent_id = p_intent_id
      and scope_option.decision is null;
  else
    -- A person returning to the same organization gets a new relationship
    -- pointing at the one before it, never a revived row.
    insert into relationships.service_relationships (
      person_id, organization_id, status, previous_relationship_id
    )
    select
      p_person_id,
      target.organization_id,
      'active',
      (
        select previous.id
        from relationships.service_relationships as previous
        where previous.person_id = p_person_id
          and previous.organization_id = target.organization_id
          and previous.status = 'terminated'
        order by previous.ended_at desc nulls last
        limit 1
      )
    returning id into resolved_relationship_id;

    -- The intent records what it created, which is what makes the acceptance
    -- traceable back from the relationship.
    update identity.invitation_intents
    set status = 'accepted',
        decided_at = decision_time,
        materialized_relationship_id = resolved_relationship_id
    where id = p_intent_id;

    -- Every option presented gets an answer, and an option the caller did not
    -- mention counts as declined: silence is not consent.
    for option in
      select scope_option.id, scope_option.scope_definition_id, scope_option.scope_code,
             scope_option.offered_access_level, scope_option.purpose,
             scope_option.presented_snapshot
      from privacy.invitation_scope_options as scope_option
      where scope_option.invitation_intent_id = p_intent_id
        and scope_option.decision is null
      order by scope_option.scope_code
    loop
      option_decision := case
        when coalesce(p_scope_decisions->>option.scope_code, 'rejected') = 'accepted'
          then 'accepted'::privacy.consent_decision
        else 'rejected'::privacy.consent_decision
      end;

      update privacy.invitation_scope_options
      set decision = option_decision, decided_at = decision_time
      where id = option.id;

      insert into privacy.consent_events (
        person_id, relationship_id, organization_id, invitation_scope_option_id,
        scope_definition_id, scope_code, decision, presented_snapshot, decided_at
      ) values (
        p_person_id, resolved_relationship_id, target.organization_id, option.id,
        option.scope_definition_id, option.scope_code, option_decision,
        option.presented_snapshot, decision_time
      )
      returning id into consent_id;

      -- Only an acceptance becomes a grant. A rejection is recorded as
      -- evidence and grants nothing.
      if option_decision = 'accepted' then
        insert into privacy.data_grants (
          person_id, relationship_id, organization_id, scope_definition_id, scope_code,
          consent_event_id, access_level, purpose, status, granted_at
        ) values (
          p_person_id, resolved_relationship_id, target.organization_id,
          option.scope_definition_id, option.scope_code, consent_id,
          option.offered_access_level, option.purpose, 'active', decision_time
        );
        granted := granted || option.scope_code;
      end if;
    end loop;
  end if;

  -- The invitation closes once no intent is still waiting on an answer.
  update identity.invitations
  set status = 'completed'
  where id = target.id
    and not exists (
      select 1 from identity.invitation_intents as pending
      where pending.invitation_id = target.id and pending.status = 'pending'
    );

  perform system.enqueue_outbox_event(
    'invitation',
    target.id,
    'identity.invitation_intent_decided.v1',
    jsonb_build_object('invitation_id', target.id, 'invitation_intent_id', p_intent_id)
  );
  perform system.finish_idempotency(
    receipt.receipt_id,
    200::smallint,
    'client-invitation-decided',
    'invitation',
    target.id
  );

  return query
  select invitation.id,
         invitation.status::text,
         invitation.organization_id,
         intent.id,
         intent.status::text,
         resolved_relationship_id,
         granted,
         false
  from identity.invitations as invitation
  join identity.invitation_intents as intent on intent.invitation_id = invitation.id
  where invitation.id = target.id and intent.id = p_intent_id;
end
$function$;

alter function identity.decide_client_invitation(
  uuid, bytea, uuid, text, jsonb, uuid, uuid, bytea
) owner to allfit_owner;
revoke all on function identity.decide_client_invitation(
  uuid, bytea, uuid, text, jsonb, uuid, uuid, bytea
) from public;
grant execute on function identity.decide_client_invitation(
  uuid, bytea, uuid, text, jsonb, uuid, uuid, bytea
) to allfit_api;
