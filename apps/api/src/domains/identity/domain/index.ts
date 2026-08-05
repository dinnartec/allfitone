/**
 * Identity domain.
 *
 * Person, access accounts, onboarding, profile and contact.
 *
 * `access_accounts` links an external subject to a person through
 * (provider, issuer, subject). That tuple is the seam allowing two providers to
 * coexist during a migration: no other table notices.
 *
 * Contact email and sign-in email are the same datum. Changing it updates both
 * sides or neither, and since PostgreSQL and the provider do not share a
 * transaction, the change goes through the outbox with a pending state.
 */
export {}
