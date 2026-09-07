-- A third person state: the Fitness ID exists before it is active.
--
-- Alone in its own migration on purpose. PostgreSQL refuses to use a newly added
-- enum label in the transaction that added it — "unsafe use of new value ... New
-- enum values must be committed before they can be used" — and the migration that
-- follows needs the label in a CHECK constraint and in a function body.
--
-- Placed before 'active' so the enum sorts in lifecycle order.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter type identity.person_status add value if not exists 'pending_activation' before 'active';
