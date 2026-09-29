-- `privacy.invitation_scope_options`: what a client invitation asks for.
--
-- When an organization invites someone as a client it names, per data
-- category, the level it wants and the purpose it declares. None of it grants
-- anything by existing — it is an offer, and the person decides each option
-- separately when they accept.
--
-- Two rules make this table worth having rather than storing the offer as a
-- blob on the intent. The options are frozen once the person has decided, so
-- what they agreed to can be proven later against the exact text they saw. And
-- there is no path to create one for an already active relationship: an
-- organization cannot come back afterwards and ask for more, which is the rule
-- that keeps "accepting a relationship" from quietly becoming "accepting
-- whatever they ask next".
--
-- DERIVED, NOT SPECIFIED: `privacy.consent_decision`'s values. The dictionary
-- names the events the decision produces — `privacy.grant_created.v1` and
-- `privacy.grant_rejected.v1` — and nothing else, so `accepted` and `rejected`
-- follow from those. Accepted by the team rather than deferred; stated here so
-- a reviewer can correct it before this reaches production.

set lock_timeout = '5s';
set statement_timeout = '60s';

create type privacy.consent_decision as enum ('accepted', 'rejected');
alter type privacy.consent_decision owner to allfit_owner;

create table privacy.invitation_scope_options (
  id uuid not null default extensions.uuid_generate_v7(),
  invitation_intent_id uuid not null,
  scope_definition_id uuid not null,
  scope_code text not null,
  offered_access_level privacy.access_level not null,
  purpose text not null,
  presented_snapshot_schema_version smallint not null default 1,
  presented_snapshot jsonb not null,
  decision privacy.consent_decision,
  decided_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pk_invitation_scope_options primary key (id),
  constraint fk_invitation_scope_options_intent foreign key (invitation_intent_id) references identity.invitation_intents(id) on delete cascade,
  -- IX-06: the option carries the exact scope version it was offered under, so
  -- it can never drift onto a later publication of the same scope.
  constraint fk_invitation_scope_options_scope foreign key (scope_definition_id, scope_code) references privacy.scope_definitions(id, scope_code) on delete restrict,
  constraint uq_invitation_scope_options_scope unique (invitation_intent_id, scope_code),
  constraint uq_invitation_scope_options_carrier unique (id, scope_definition_id, scope_code),
  constraint ck_invitation_scope_options_decision check ((decision is null) = (decided_at is null)),
  constraint ck_invitation_scope_options_purpose check (btrim(purpose) <> ''),
  constraint ck_invitation_scope_options_snapshot_version check (presented_snapshot_schema_version = 1),
  constraint ck_invitation_scope_options_snapshot check (jsonb_typeof(presented_snapshot) = 'object')
);

create index idx_invitation_scope_options_intent
  on privacy.invitation_scope_options (invitation_intent_id);

alter table privacy.invitation_scope_options owner to allfit_owner;

create trigger trg_invitation_scope_options_before_update_timestamp
before update on privacy.invitation_scope_options
for each row execute function access_control.set_updated_at();

/*
 * Three things the columns cannot say on their own.
 *
 * The parent must be a `service_relationship` intent — offering data scopes
 * alongside a staff membership would be a category error, and the row would
 * sit there looking legitimate.
 *
 * An option may not change once decided. The whole point of keeping the
 * presented snapshot is that it is evidence; evidence that can be edited after
 * the fact is not evidence.
 *
 * And the scope offered must be a published definition. An organization cannot
 * ask for a draft scope whose wording nobody has approved.
 */
create or replace function privacy.enforce_invitation_scope_option()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  intent_kind identity.invitation_intent_kind;
  scope_status catalog.publication_status;
begin
  select kind into intent_kind
  from identity.invitation_intents
  where id = new.invitation_intent_id;

  if intent_kind is distinct from 'service_relationship' then
    raise exception 'IX-06 scope options belong to a service relationship intent'
      using errcode = '23514';
  end if;

  select status into scope_status
  from privacy.scope_definitions
  where id = new.scope_definition_id;

  if scope_status is distinct from 'published' then
    raise exception 'IX-06 scope definition is not published' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.decision is not null then
    if new.scope_code is distinct from old.scope_code
       or new.scope_definition_id is distinct from old.scope_definition_id
       or new.offered_access_level is distinct from old.offered_access_level
       or new.purpose is distinct from old.purpose
       or new.presented_snapshot is distinct from old.presented_snapshot
       or new.decision is distinct from old.decision
       or new.decided_at is distinct from old.decided_at then
      raise exception 'IX-06 a decided scope option cannot change' using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

alter function privacy.enforce_invitation_scope_option() owner to allfit_owner;
revoke all on function privacy.enforce_invitation_scope_option() from public, allfit_api;

create constraint trigger enforce_invitation_scope_option_ct
after insert or update on privacy.invitation_scope_options
deferrable initially immediate
for each row execute function privacy.enforce_invitation_scope_option();

/*
 * Visibility follows the invitation the option belongs to. The person decides
 * these options, so they must be able to read them before the relationship
 * they would create exists; the organization that issued the invitation reads
 * them to show what it asked for.
 *
 * As everywhere else in this codebase the policy is written for the table
 * owner, which is the role every `security definer` function runs as, and
 * `force row level security` keeps that role inside the policy too.
 */
alter table privacy.invitation_scope_options enable row level security;
alter table privacy.invitation_scope_options force row level security;

create policy invitation_scope_options_select_actor
  on privacy.invitation_scope_options
  for select to allfit_owner
  using (
    exists (
      select 1
      from identity.invitation_intents as intent
      join identity.invitations as invitation on invitation.id = intent.invitation_id
      where intent.id = invitation_scope_options.invitation_intent_id
        and invitation.organization_id = access_control.org()
    )
  );

create policy invitation_scope_options_insert_owner
  on privacy.invitation_scope_options
  for insert to allfit_owner
  with check (access_control.actor_kind() is not null);

create policy invitation_scope_options_update_owner
  on privacy.invitation_scope_options
  for update to allfit_owner
  using (access_control.actor_kind() is not null)
  with check (access_control.actor_kind() is not null);

-- No direct DML from the runtime role: options are written by the command that
-- issues the invitation and by the one that records the person's decision.
revoke all on privacy.invitation_scope_options from public, allfit_api;
