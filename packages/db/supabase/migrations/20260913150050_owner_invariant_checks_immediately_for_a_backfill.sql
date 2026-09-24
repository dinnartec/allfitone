-- The next migration, 20260913150100, backfills organizations.claimed_at with an
-- UPDATE and then re-enables a trigger with ALTER TABLE, in one transaction. The
-- owner invariant on organizations is a deferred constraint trigger, so on a
-- database that holds active organizations that UPDATE leaves trigger events
-- pending, and Postgres refuses the ALTER TABLE ("pending trigger events"). An
-- empty database never shows it; production did.
--
-- That migration is in main's history and is not edited. Instead the invariant is
-- checked at the end of each statement for the length of that one migration, and
-- 20260913150150 restores it to deferred. Checking immediately is stricter, not
-- looser: it can refuse a multi-statement write, never admit a second owner.

set lock_timeout = '5s';
set statement_timeout = '60s';

drop trigger trg_organizations_after_owner_invariant on organizations.organizations;

create constraint trigger trg_organizations_after_owner_invariant
after insert or update or delete on organizations.organizations
not deferrable
for each row execute function organizations.enforce_exactly_one_active_owner();
