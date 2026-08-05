/**
 * Identity use cases. No HTTP, no direct SQL.
 *
 * First to implement:
 *   - sign in (Space: headless · Studio and Backoffice: hosted-flow code)
 *   - refresh session
 *   - request contact change  → stores pending, sends verification
 *   - verify contact change   → writes to the outbox
 *   - apply contact change    → invoked by the worker, never over HTTP
 *
 * A person starts their own registration. The platform never creates accounts on
 * anyone's behalf: it invites, it does not impersonate.
 */
export {}
