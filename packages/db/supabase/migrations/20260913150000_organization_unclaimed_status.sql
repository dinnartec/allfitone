-- `unclaimed` and `cancelled` join `organizations.organization_status`.
--
-- `HU-BO-014` and `HU-BO-015` need an organization that exists without operating:
-- created by Allfit for a sale, waiting for its owner to accept, and cancellable
-- only in that state. `OP-ORG-018` already names `unclaimed`; the enum only allowed
-- `active` and `closed`.
--
-- Additive for Studio. Every Studio command already requires `status = 'active'`,
-- and nobody can read an unclaimed organization through Studio because it has no
-- members, so the Studio contract's `[active, closed]` stays true for what Studio
-- can see.
--
-- `suspended` is left out on purpose. It arrives with `HU-BO-016`, whose blocking
-- of contributions depends on planning objects that do not exist yet, and adding a
-- state nothing can reach would only be an unexplained value.
--
-- It ships alone because a new enum value cannot be used in the transaction that
-- adds it.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter type organizations.organization_status add value if not exists 'unclaimed' before 'active';
alter type organizations.organization_status add value if not exists 'cancelled' after 'closed';
