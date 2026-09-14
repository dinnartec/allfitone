-- `HU-BO-014`: an invitation can hand an organization to its owner.
--
-- Its own file because a new enum value cannot be used in the transaction that adds
-- it, and the handover migration uses it in checks and functions.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter type identity.invitation_intent_kind add value if not exists 'ownership';
