-- `suspended` joins the organization lifecycle (`HU-BO-016`).
--
-- This migration does one thing and the next one uses it. PostgreSQL refuses a new
-- enum value in the same transaction that writes it — "New enum values must be
-- committed before they can be used" — and every migration file runs in one
-- transaction, so the value and its constraints cannot share a file.
--
-- **Why the enum and not only a flag.** A dozen functions already ask
-- `status = 'active'` before letting an organization invite, assign, publish or
-- charge. Criterion 2 is "a suspended gym stops operating", and as a state those
-- functions already deny it without one of them being edited. Criterion 5 —  its
-- clients drop to the free plan — falls out of the same answer, because `resolve_pro`
-- reads that column too and `ADR-043` makes every *active* gym the one that grants Pro.
--
-- **The state is not the whole story, and the next migration says the rest.** Who
-- suspended, why and for how long lives in its own history, and what stops being
-- effective for each person lives in `planning.service_access_blocks`, which the
-- payments slice already built for exactly this with `source_kind =
-- 'organization_suspension'`. The status answers "may this organization act"; the
-- blocks answer "is this person's service from it effective". They are two questions
-- and that is why they are two places.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter type organizations.organization_status add value if not exists 'suspended' after 'active';
