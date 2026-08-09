set lock_timeout = '5s';
set statement_timeout = '60s';

alter function system.enforce_idempotency_terminal() security definer;
alter function organizations.enforce_exactly_one_active_owner() security definer;

do $validation$
begin
  if exists (
    select 1
    from identity.onboarding_attempts as attempt
    left join lateral (
      select evidence.result, evidence.policy_version
      from identity.eligibility_evidence as evidence
      where evidence.onboarding_attempt_id = attempt.id
      order by evidence.evaluated_at desc, evidence.id desc
      limit 1
    ) as latest_evidence on true
    where attempt.status = 'activated'
      and (
        latest_evidence.result is distinct from 'pass'
        or latest_evidence.policy_version is distinct from 1
      )
  ) then
    raise exception 'cannot install onboarding eligibility invariant while invalid activated attempts exist'
      using errcode = '23514';
  end if;
end
$validation$;

create or replace function identity.enforce_activated_attempt_eligibility()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_attempt_id uuid;
  current_status identity.onboarding_status;
  latest_result identity.eligibility_result;
  latest_policy_version integer;
begin
  if tg_table_name = 'onboarding_attempts' then
    target_attempt_id := coalesce(new.id, old.id);
  else
    target_attempt_id := coalesce(new.onboarding_attempt_id, old.onboarding_attempt_id);
  end if;

  select attempt.status
  into current_status
  from identity.onboarding_attempts as attempt
  where attempt.id = target_attempt_id;

  if current_status = 'activated' then
    select evidence.result, evidence.policy_version
    into latest_result, latest_policy_version
    from identity.eligibility_evidence as evidence
    where evidence.onboarding_attempt_id = target_attempt_id
    order by evidence.evaluated_at desc, evidence.id desc
    limit 1;

    if latest_result is distinct from 'pass' or latest_policy_version is distinct from 1 then
      raise exception 'activated onboarding attempt requires version 1 passing eligibility evidence'
        using errcode = '23514';
    end if;
  end if;

  return null;
end
$function$;

alter function identity.enforce_activated_attempt_eligibility() owner to allfit_owner;
revoke all on function identity.enforce_activated_attempt_eligibility() from public;

create constraint trigger trg_onboarding_attempts_after_eligibility_invariant
after insert or update or delete on identity.onboarding_attempts
deferrable initially immediate
for each row execute function identity.enforce_activated_attempt_eligibility();

create constraint trigger trg_eligibility_evidence_after_activation_invariant
after insert or update or delete on identity.eligibility_evidence
deferrable initially immediate
for each row execute function identity.enforce_activated_attempt_eligibility();

create table organizations.membership_events (
  id uuid not null default extensions.uuid_generate_v7(),
  membership_id uuid not null,
  event_type text not null,
  snapshot_schema_version smallint not null default 1,
  "before" jsonb,
  "after" jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint pk_membership_events primary key (id),
  constraint fk_membership_events_membership foreign key (membership_id) references organizations.organization_memberships(id) on delete cascade,
  constraint ck_membership_events_type check (event_type ~ '^organization\.(membership|role)_[a-z_]+\.v1$'),
  constraint ck_membership_events_snapshot_version check (snapshot_schema_version = 1),
  constraint ck_membership_events_snapshot_presence check ("before" is not null or "after" is not null)
);

create unique index uidx_membership_events_created_once
  on organizations.membership_events (membership_id, event_type)
  where event_type = 'organization.membership_created.v1';

create index idx_membership_events_membership_created
  on organizations.membership_events (membership_id, created_at desc);

alter table organizations.membership_events owner to allfit_owner;

insert into organizations.membership_events (
  membership_id,
  event_type,
  "after"
)
select
  membership.id,
  'organization.membership_created.v1',
  jsonb_build_object(
    'organization_id', membership.organization_id,
    'person_id', membership.person_id,
    'status', membership.status,
    'joined_at', membership.joined_at
  )
from organizations.organization_memberships as membership
on conflict (membership_id, event_type)
  where event_type = 'organization.membership_created.v1'
do nothing;

create or replace function organizations.log_membership_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into organizations.membership_events (
    membership_id,
    event_type,
    "after"
  ) values (
    new.id,
    'organization.membership_created.v1',
    jsonb_build_object(
      'organization_id', new.organization_id,
      'person_id', new.person_id,
      'status', new.status,
      'joined_at', new.joined_at
    )
  );

  return new;
end
$function$;

alter function organizations.log_membership_created() owner to allfit_owner;
revoke all on function organizations.log_membership_created() from public;

create trigger trg_organization_memberships_after_insert_event
after insert on organizations.organization_memberships
for each row execute function organizations.log_membership_created();

alter table organizations.membership_events enable row level security;
alter table organizations.membership_events force row level security;

create or replace function access_control.can_read_membership_event(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    access_control.actor_kind() = 'person'
    and exists (
      select 1
      from organizations.organization_memberships as target_membership
      where target_membership.id = p_membership_id
        and (
          target_membership.person_id = access_control.person()
          or exists (
            select 1
            from organizations.organization_memberships as actor_membership
            join organizations.membership_roles as actor_role
              on actor_role.membership_id = actor_membership.id
            where actor_membership.organization_id = target_membership.organization_id
              and actor_membership.person_id = access_control.person()
              and actor_membership.status = 'active'
              and actor_role.role_code in ('owner', 'admin')
              and actor_role.valid_to is null
          )
        )
    )
$function$;

alter function access_control.can_read_membership_event(uuid) owner to allfit_owner;
revoke all on function access_control.can_read_membership_event(uuid) from public;
grant execute on function access_control.can_read_membership_event(uuid) to allfit_api;

create policy membership_events_all_owner on organizations.membership_events
  for all to allfit_owner using (true) with check (true);

create policy membership_events_select_authorized on organizations.membership_events
  for select to allfit_api using (access_control.can_read_membership_event(membership_id));

revoke all on organizations.membership_events from public, allfit_api;
grant select on organizations.membership_events to allfit_api;
