-- Prepare the invitation lifecycle vocabulary for Studio recipient operations.

set lock_timeout = '5s';
set statement_timeout = '30s';

alter type identity.invitation_status rename value 'claimed' to 'completed';
alter type identity.invitation_intent_status add value if not exists 'revoked' after 'rejected';
