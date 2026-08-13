/**
 * Structured logs, metrics and traces.
 *
 * The current runtime derives counters from structured stdout. These helpers
 * expose only closed, non-identifying dimensions so callers cannot accidentally
 * attach account, person, organization, contact, or provider details.
 */

type StudioAuthCallbackFailure =
  'authentication-failed' | 'missing-code' | 'missing-state-cookie' | 'state-mismatch'

type StudioMembershipDestination = 'multiple' | 'one' | 'zero'

type StudioLogoutTrigger = 'inactivity' | 'manual' | 'recovery'
type StudioLogoutOutcome = 'already-absent' | 'partial' | 'revoked'

type BackofficeAuthOperation =
  | 'password'
  | 'enrollment'
  | 'challenge'
  | 'verification'
  | 'session'
  | 'logout'
  | 'password_reset'
  | 'rate_limited'

type BackofficeAuthOutcome =
  'succeeded' | 'failed' | 'accepted' | 'already-absent' | 'partial' | 'revoked'

export type IdentityPasswordResetWebhookOutcome =
  'account-absent' | 'failed' | 'ignored' | 'invalid' | 'processed' | 'replayed'

type StudioTeamInvitationOutcome =
  | 'created'
  | 'failed'
  | 'replayed'
  | 'reused'
  | 'resolved'
  | 'resolve-failed'
  | 'decided'
  | 'decision-replayed'
  | 'decision-failed'
  | 'listed'
  | 'list-failed'
  | 'revoked'
  | 'revocation-replayed'
  | 'revocation-failed'
  | 'rate-limited'

type StudioOrganizationQuery = 'memberships' | 'roles'
type StudioOrganizationQueryOutcome = 'empty' | 'failed' | 'listed' | 'not-modified'

export function recordStudioAuthCallback(
  outcome: 'failed' | 'succeeded',
  reason?: StudioAuthCallbackFailure,
): void {
  writeCounter('studio.auth.callback', {
    outcome,
    ...(reason ? { reason } : {}),
  })
}

export function recordStudioRegistrationIncomplete(): void {
  writeCounter('studio.registration.incomplete', {})
}

export function recordStudioMembershipDestination(destination: StudioMembershipDestination): void {
  writeCounter('studio.membership.destination', { destination })
}

export function recordStudioLogout(
  trigger: StudioLogoutTrigger,
  outcome: StudioLogoutOutcome,
): void {
  writeCounter('studio.auth.logout', { trigger, outcome })
}

export function recordBackofficeAuth(
  operation: BackofficeAuthOperation,
  outcome: BackofficeAuthOutcome,
  trigger?: StudioLogoutTrigger,
): void {
  writeCounter(`backoffice.auth.${operation}`, {
    outcome,
    ...(trigger ? { trigger } : {}),
  })
}

export function recordIdentityPasswordResetWebhook(
  outcome: IdentityPasswordResetWebhookOutcome,
): void {
  writeCounter('identity.password_reset.webhook', { outcome })
}

export function recordStudioTeamInvitation(outcome: StudioTeamInvitationOutcome): void {
  const operation = outcome.startsWith('resolve')
    ? 'resolve'
    : outcome.startsWith('decision') || outcome === 'decided'
      ? 'decision'
      : outcome.startsWith('list')
        ? 'list'
        : outcome.startsWith('revocation') || outcome === 'revoked'
          ? 'revoke'
          : outcome === 'rate-limited'
            ? 'rate_limited'
            : 'command'
  writeCounter(`studio.team_invitation.${operation}`, { outcome })
}

export function recordStudioOrganizationQuery(
  query: StudioOrganizationQuery,
  outcome: StudioOrganizationQueryOutcome,
): void {
  writeCounter(`studio.organization.${query}`, { outcome })
}

function writeCounter(name: string, dimensions: Readonly<Record<string, string>>): void {
  console.info(JSON.stringify({ kind: 'counter', name, value: 1, dimensions }))
}
