-- The person deciding an invitation has to be able to read what they are
-- deciding.
--
-- The first version of this policy only admitted the organization that issued
-- the invitation, which is half the story and the less important half. The
-- person has no membership and no relationship yet — that is the whole point
-- of an invitation — so nothing in the previous rule matched them, and the
-- options came back empty to the one party whose answer the table exists to
-- record.
--
-- The consequence was not an error anywhere: the decision function simply
-- found no options to decide, recorded no consent and issued no grant, and
-- reported success. A person would have accepted an invitation and granted
-- nothing, with no sign that anything had gone wrong.
--
-- An invitation is addressed to a contact, and the person who proved that
-- contact is theirs is the one it is for. That is the same test the decision
-- function already applies before accepting an answer.

set lock_timeout = '5s';
set statement_timeout = '60s';

drop policy invitation_scope_options_select_actor on privacy.invitation_scope_options;

create policy invitation_scope_options_select_actor
  on privacy.invitation_scope_options
  for select to allfit_owner
  using (
    exists (
      select 1
      from identity.invitation_intents as intent
      join identity.invitations as invitation on invitation.id = intent.invitation_id
      where intent.id = invitation_scope_options.invitation_intent_id
        and (
          -- The organization that asked.
          invitation.organization_id = access_control.org()
          -- Or the person it was addressed to, identified the only way an
          -- invitation can identify someone before they have a relationship:
          -- by the contact they have proven is theirs.
          or lower(invitation.contact::text) = lower(
            nullif(current_setting('app.actor_verified_email', true), '')
          )
        )
    )
  );
