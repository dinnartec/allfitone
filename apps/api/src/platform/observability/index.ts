/**
 * Structured logs, metrics and traces.
 *
 * The current runtime derives counters from structured stdout. These helpers
 * expose only closed, non-identifying dimensions so callers cannot accidentally
 * attach account, person, organization, contact, or provider details.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { MiddlewareHandler } from 'hono'
import { matchedRoutes } from 'hono/route'

export type StudioRequestPhase =
  'session-db' | 'token-local' | 'workos-refresh' | 'actor-db' | 'business-db'

interface StudioRequestTimingStore {
  durations: Partial<Record<StudioRequestPhase, number>>
}

const studioRequestTimings = new AsyncLocalStorage<StudioRequestTimingStore>()
const STUDIO_SLOW_REQUEST_MS = 1_000

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

export function studioRequestTiming(): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = performance.now()
    const store: StudioRequestTimingStore = { durations: {} }

    await studioRequestTimings.run(store, async () => {
      await next()
    })

    const totalMs = performance.now() - startedAt
    const phaseEntries = Object.entries(store.durations) as Array<[StudioRequestPhase, number]>
    const timingHeader = [
      ...phaseEntries.map(([phase, duration]) => `${phase};dur=${duration.toFixed(1)}`),
      `total;dur=${totalMs.toFixed(1)}`,
    ].join(', ')
    c.header('Server-Timing', timingHeader)

    const operation =
      matchedRoutes(c)
        .toReversed()
        .find((route) => route.method === c.req.method && !route.path.includes('*'))?.path ??
      'unmatched'
    const outcome = requestOutcome(c.res.status)
    const externalDependency = store.durations['workos-refresh'] ? 'workos' : 'none'
    console.info(
      JSON.stringify({
        kind: 'distribution',
        name: 'studio.http.duration',
        value_ms: roundDuration(totalMs),
        dimensions: {
          operation,
          method: c.req.method,
          status: String(c.res.status),
          outcome,
          region: process.env.VERCEL_REGION ?? 'local',
          external_dependency: externalDependency,
        },
        phases_ms: Object.fromEntries(
          phaseEntries.map(([phase, duration]) => [phase, roundDuration(duration)]),
        ),
      }),
    )

    if (externalDependency === 'none' && totalMs > STUDIO_SLOW_REQUEST_MS) {
      console.warn(
        JSON.stringify({
          kind: 'alert',
          name: 'studio.http.slow_request',
          value_ms: roundDuration(totalMs),
          dimensions: { operation, outcome, region: process.env.VERCEL_REGION ?? 'local' },
        }),
      )
    }
  }
}

export async function measureStudioRequestPhase<T>(
  phase: StudioRequestPhase,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now()
  try {
    return await operation()
  } finally {
    const store = studioRequestTimings.getStore()
    if (store) {
      store.durations[phase] =
        (store.durations[phase] ?? 0) + Math.max(0, performance.now() - startedAt)
    }
  }
}

function requestOutcome(
  status: number,
): 'success' | 'unauthenticated' | 'forbidden' | 'unavailable' | 'error' {
  if (status < 400) return 'success'
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 503) return 'unavailable'
  return 'error'
}

function roundDuration(duration: number): number {
  return Math.round(duration * 10) / 10
}

function writeCounter(name: string, dimensions: Readonly<Record<string, string>>): void {
  console.info(JSON.stringify({ kind: 'counter', name, value: 1, dimensions }))
}
