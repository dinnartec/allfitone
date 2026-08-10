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

function writeCounter(name: string, dimensions: Readonly<Record<string, string>>): void {
  console.info(JSON.stringify({ kind: 'counter', name, value: 1, dimensions }))
}
