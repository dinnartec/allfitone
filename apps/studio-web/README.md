# Allfit Studio — web

Not scaffolded yet. Client of `/studio/v1`.

- **Hosted** login: redirects to the provider and receives the code on callback.
- Consumes DTOs from `@allfitone/contracts` and components from `@allfitone/react`.
- The organization travels explicitly in the path under `/organizations/{orgId}`;
  it is never resolved from the token or from a stored preference.
