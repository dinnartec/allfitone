-- Platform authority resolution and append-only history for Backoffice access.
--
-- The base role and the duty are two independent controls. `has_platform_duty`
-- already resolved the second one inside the transaction; this migration adds
-- the first, so a policy or a closed function can require the base role alone
-- without inferring it from a duty.
--
-- It also closes the hole the tables were created with: the assignment history
-- carried no DELETE guard and no immutability guard. Without both, whoever holds
-- `manage_platform_access` could grant themselves reach, read, and then erase the
-- evidence of having done it. Revoking a grant is an UPDATE that closes the row,
-- never a DELETE and never a rewrite of how it was created.
--
-- Finally it corrects the derived actor mode of `manage_platform_commercial`.
-- The closed catalogue derives `A10`, but the governance table and the two
-- operations that consume the duty (`OP-PAY-017`, `OP-PAY-022`) both declare
-- `A11`. The mode is derived, not historical, so correcting it forward is not a
-- rewrite of a business fact.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function access_control.has_platform_role(
  p_person_id uuid,
  p_session_id uuid,
  p_platform_role text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from identity.access_sessions as session
    join identity.access_accounts as account
      on account.id = session.access_account_id
    join identity.people as person
      on person.id = account.person_id
    join support.platform_role_assignments as role_assignment
      on role_assignment.person_id = person.id
     and role_assignment.platform_role = p_platform_role
     and role_assignment.status = 'active'
    where person.id = p_person_id
      and person.status = 'active'
      and session.id = p_session_id
      and session.surface = 'backoffice'::identity.access_session_surface
      and session.assurance_level = 2
      and session.authentication_method = 'password_totp'
      and session.revoked_at is null
      and session.absolute_expires_at > clock_timestamp()
      and session.last_activity_at > clock_timestamp() - interval '15 minutes'
  )
$function$;

alter function access_control.has_platform_role(uuid, uuid, text) owner to allfit_owner;
revoke all on function access_control.has_platform_role(uuid, uuid, text) from public;
grant execute on function access_control.has_platform_role(uuid, uuid, text) to allfit_api;

-- Derived value, corrected before the constraint that will reject it exists.
update support.platform_duty_assignments
set actor_mode = 'A11'
where duty_code = 'manage_platform_commercial' and actor_mode <> 'A11';

alter table support.platform_duty_assignments
  drop constraint ck_platform_duty_assignments_actor_mode,
  add constraint ck_platform_duty_assignments_actor_mode check (
    actor_mode = case
      when duty_code in (
        'curate_global_catalog', 'verify_professional_credentials', 'manage_platform_commercial'
      ) then 'A11'
      when duty_code in (
        'manage_platform_access', 'audit_platform_access', 'approve_break_glass',
        'audit_break_glass', 'manage_privacy_requests'
      ) then 'A12'
      else 'A10'
    end
  ),
  add constraint ck_platform_duty_assignments_temporal_shape check (
    (status in ('scheduled', 'active') and suspended_at is null and revoked_at is null)
    or (status = 'suspended' and suspended_at is not null and revoked_at is null)
    or (status = 'expired' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  add constraint ck_platform_duty_assignments_actor_pairs check (
    (suspended_at is null) = (suspended_by_person_id is null)
    and (revoked_at is null) = (revoked_by_person_id is null)
    and (recertified_at is null) = (recertified_by_person_id is null)
  );

create or replace function support.preserve_platform_role_history()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if new.id <> old.id
    or new.person_id <> old.person_id
    or new.platform_role <> old.platform_role
    or new.granted_by_person_id <> old.granted_by_person_id
    or new.granted_at <> old.granted_at then
    raise exception 'platform role history is append-only' using errcode = '23514';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'a revoked platform role cannot be reopened' using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function support.preserve_platform_duty_history()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if new.id <> old.id
    or new.person_id <> old.person_id
    or new.duty_code <> old.duty_code
    or new.actor_mode <> old.actor_mode
    or new.valid_from <> old.valid_from
    or new.valid_to <> old.valid_to
    or new.required_aal <> old.required_aal
    or new.granted_by_person_id <> old.granted_by_person_id
    or new.reason_code <> old.reason_code
    or new.created_at <> old.created_at then
    raise exception 'platform duty history is append-only' using errcode = '23514';
  end if;
  -- Extending authority is a new assignment, never a longer old one, so the
  -- ninety-day bound cannot be widened after the fact.
  if old.status in ('expired', 'revoked') and new.status <> old.status then
    raise exception 'a terminal platform duty cannot be reopened' using errcode = '23514';
  end if;
  if old.status = 'suspended' and new.status not in ('suspended', 'expired', 'revoked') then
    raise exception 'a suspended platform duty is only expired or revoked' using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function support.reject_platform_access_deletion()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception 'platform access history cannot be deleted' using errcode = '23514';
end
$function$;

alter function support.preserve_platform_role_history() owner to allfit_owner;
alter function support.preserve_platform_duty_history() owner to allfit_owner;
alter function support.reject_platform_access_deletion() owner to allfit_owner;
revoke all on function support.preserve_platform_role_history() from public;
revoke all on function support.preserve_platform_duty_history() from public;
revoke all on function support.reject_platform_access_deletion() from public;

create trigger trg_platform_role_assignments_update_preserve_history
before update on support.platform_role_assignments
for each row execute function support.preserve_platform_role_history();

create trigger trg_platform_duty_assignments_update_preserve_history
before update on support.platform_duty_assignments
for each row execute function support.preserve_platform_duty_history();

-- No runtime role holds DELETE, but the guard is what proves it: a future grant,
-- a superuser session or a migration cannot quietly remove the evidence.
create trigger trg_platform_role_assignments_delete_reject
before delete on support.platform_role_assignments
for each row execute function support.reject_platform_access_deletion();

create trigger trg_platform_duty_assignments_delete_reject
before delete on support.platform_duty_assignments
for each row execute function support.reject_platform_access_deletion();
