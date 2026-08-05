# Allfit Backoffice — web

Not scaffolded yet. Client of `/backoffice/v1`.

- **Hosted** login with mandatory MFA.
- Session independent from Studio's: signing into one does not sign you into the
  other. That is why they are separate provider Applications with distinct
  `client_id`.
- Signing in enables no operation by itself. The base role opens the door; each
  screen and action checks authority separately.
