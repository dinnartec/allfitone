-- Restores the owner invariant to exactly what 20260809210000 declared, after the
-- backfill in 20260913150100 has run. See 20260913150050 for why it was changed.

set lock_timeout = '5s';
set statement_timeout = '60s';

drop trigger trg_organizations_after_owner_invariant on organizations.organizations;

create constraint trigger trg_organizations_after_owner_invariant
after insert or update or delete on organizations.organizations
deferrable initially deferred
for each row execute function organizations.enforce_exactly_one_active_owner();
