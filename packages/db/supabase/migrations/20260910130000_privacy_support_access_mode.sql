-- `support_metadata` joins `privacy.access_mode`.
--
-- Staff reading a person's minimised operational state is not the same path as
-- the person or their professional reading current data, and `HU-BO-030` has to
-- be able to tell them apart. Recording it as `live` would leave that question
-- answerable only by joining two other columns, which is the kind of thing that
-- reads fine now and fails the first time someone asks "when did staff touch
-- this person's data".
--
-- Additive and non-breaking: no policy branches on the mode, and the only
-- constraint that mentions it (`ck_access_events_organization_context`) governs
-- the organisation case alone. It ships on its own because a new enum value
-- cannot be used in the transaction that adds it.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter type privacy.access_mode add value if not exists 'support_metadata';
