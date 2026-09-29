-- An accepted intent has to be able to say what it created.
--
-- `identity.invitation_intents` was cut for team invitations: accepting one
-- creates a membership, and the table has a column pointing at it. The
-- `service_relationship` kind has been in the enum since the beginning, but
-- accepting one creates a *relationship*, and there was nowhere to record it —
-- the existing check demanded a membership for every acceptance, and the
-- foreign key made sure no relationship id could be smuggled into it.
--
-- So a client could be invited and never accept. The data dictionary says as
-- much in passing: the intent kind is "`membership` en el corte físico".
--
-- This adds the column that was missing and makes the rule say, per kind, what
-- an acceptance must point at. Team and ownership invitations are unchanged:
-- they still materialize a membership and are still checked for it.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table identity.invitation_intents
  add column materialized_relationship_id uuid,
  add constraint fk_invitation_intents_relationship foreign key (materialized_relationship_id) references relationships.service_relationships(id) on delete restrict;

/*
 * One destination per kind, and nothing pointing anywhere before a decision.
 *
 * `program_assignment` accepts with neither: assigning a program on acceptance
 * is not built yet, and inventing a column for it now would be a guess about a
 * table that does not exist. When it arrives it adds its own column and its
 * own branch here.
 */
alter table identity.invitation_intents
  drop constraint ck_invitation_intents_decision,
  add constraint ck_invitation_intents_decision check (
    (
      status = 'pending'
      and decided_at is null
      and materialized_membership_id is null
      and materialized_relationship_id is null
    )
    or (
      status in ('rejected', 'revoked', 'expired')
      and decided_at is not null
      and materialized_membership_id is null
      and materialized_relationship_id is null
    )
    or (
      status = 'accepted'
      and decided_at is not null
      and kind in ('membership', 'ownership')
      and materialized_membership_id is not null
      and materialized_relationship_id is null
    )
    or (
      status = 'accepted'
      and decided_at is not null
      and kind = 'service_relationship'
      and materialized_relationship_id is not null
      and materialized_membership_id is null
    )
    or (
      status = 'accepted'
      and decided_at is not null
      and kind = 'program_assignment'
      and materialized_membership_id is null
      and materialized_relationship_id is null
    )
  );

create index idx_invitation_intents_relationship
  on identity.invitation_intents (materialized_relationship_id)
  where materialized_relationship_id is not null;
