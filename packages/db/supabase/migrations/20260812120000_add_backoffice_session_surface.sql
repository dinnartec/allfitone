-- Adds the Backoffice surface in its own transaction so later migrations may
-- safely use the new enum value.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter type identity.access_session_surface add value if not exists 'backoffice';
