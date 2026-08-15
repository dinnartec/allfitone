/**
 * Structured logs, metrics and traces.
 *
 * The current runtime derives counters from structured stdout. These helpers
 * expose only closed, non-identifying dimensions so callers cannot accidentally
 * attach account, person, organization, contact, or provider details.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  TelemetryEnvironment,
  TelemetryEventFor,
  TelemetryOutcome,
  TelemetrySurface,
} from '@allfitone/telemetry'
import type { MiddlewareHandler } from 'hono'
import { matchedRoutes } from 'hono/route'
import { serverOperationalLogs, serverTelemetry } from '../telemetry/server.js'

export type RequestPhase =
  'session-db' | 'token-local' | 'workos-refresh' | 'actor-db' | 'business-db'
export type StudioRequestPhase = RequestPhase

interface RequestTimingStore {
  durations: Partial<Record<RequestPhase, number>>
}

const requestTimings = new AsyncLocalStorage<RequestTimingStore>()
const SLOW_REQUEST_MS = 1_000

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

export function requestTiming(surface: Exclude<TelemetrySurface, 'system'>): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = performance.now()
    const store: RequestTimingStore = { durations: {} }
    let requestFailed = false
    let requestError: unknown

    await requestTimings.run(store, async () => {
      try {
        await next()
      } catch (error) {
        requestFailed = true
        requestError = error
      }
    })

    const totalMs = performance.now() - startedAt
    const status = requestFailed ? 500 : c.res.status
    const phaseEntries = Object.entries(store.durations) as Array<[RequestPhase, number]>
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
    const outcome = requestOutcome(status)
    const externalDependency = store.durations['workos-refresh'] === undefined ? 'none' : 'workos'
    console.info(
      JSON.stringify({
        kind: 'distribution',
        name: `${surface}.http.duration`,
        value_ms: roundDuration(totalMs),
        dimensions: {
          operation,
          method: c.req.method,
          status: String(status),
          outcome,
          region: process.env.VERCEL_REGION ?? 'local',
          external_dependency: externalDependency,
        },
        phases_ms: Object.fromEntries(
          phaseEntries.map(([phase, duration]) => [phase, roundDuration(duration)]),
        ),
      }),
    )

    const method = telemetryMethod(c.req.method)
    if (method) {
      const event: TelemetryEventFor<'server.http_request.completed.v1'> = {
        event: 'server.http_request.completed.v1',
        properties: {
          surface,
          service: 'allfit-api',
          environment: telemetryEnvironment(),
          release: telemetryRelease(),
          platform: 'node',
          operation,
          method,
          status,
          outcome,
          duration_ms: roundDuration(totalMs),
          external_dependency: externalDependency,
          region: safeRegion(),
          ...phaseProperties(store.durations),
        },
      }
      serverTelemetry().capture(event)
      if (status >= 500) {
        serverOperationalLogs().emit('failure', event)
      } else if (externalDependency === 'none' && totalMs > SLOW_REQUEST_MS) {
        serverOperationalLogs().emit('slow-request', event)
      }
    }

    if (externalDependency === 'none' && totalMs > SLOW_REQUEST_MS) {
      console.warn(
        JSON.stringify({
          kind: 'alert',
          name: `${surface}.http.slow_request`,
          value_ms: roundDuration(totalMs),
          dimensions: { operation, outcome, region: process.env.VERCEL_REGION ?? 'local' },
        }),
      )
    }

    if (requestFailed) throw requestError
  }
}

export function studioRequestTiming(): MiddlewareHandler {
  return requestTiming('studio')
}

export async function measureStudioRequestPhase<T>(
  phase: RequestPhase,
  operation: () => Promise<T>,
): Promise<T> {
  return measureRequestPhase(phase, operation)
}

export async function measureRequestPhase<T>(
  phase: RequestPhase,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now()
  try {
    return await operation()
  } finally {
    const store = requestTimings.getStore()
    if (store) {
      store.durations[phase] =
        (store.durations[phase] ?? 0) + Math.max(0, performance.now() - startedAt)
    }
  }
}

function requestOutcome(status: number): TelemetryOutcome {
  if (status < 400) return 'success'
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate-limited'
  if (status === 503) return 'unavailable'
  return status < 500 ? 'invalid-request' : 'error'
}

function telemetryMethod(method: string): 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' | undefined {
  return ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].includes(method)
    ? (method as 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT')
    : undefined
}

function telemetryEnvironment(): TelemetryEnvironment {
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
    return 'production'
  }
  if (process.env.VERCEL_ENV === 'preview') return 'preview'
  return 'development'
}

function telemetryRelease(): string {
  const raw = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RELEASE ?? 'local'
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  return safe || 'local'
}

function safeRegion(): string {
  const raw = process.env.VERCEL_REGION ?? 'local'
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32)
  return safe || 'local'
}

function phaseProperties(
  durations: Partial<Record<RequestPhase, number>>,
): Pick<
  TelemetryEventFor<'server.http_request.completed.v1'>['properties'],
  'actor_db_ms' | 'business_db_ms' | 'session_db_ms' | 'token_local_ms' | 'workos_refresh_ms'
> {
  return {
    ...(durations['session-db'] === undefined
      ? {}
      : { session_db_ms: roundDuration(durations['session-db']) }),
    ...(durations['token-local'] === undefined
      ? {}
      : { token_local_ms: roundDuration(durations['token-local']) }),
    ...(durations['workos-refresh'] === undefined
      ? {}
      : { workos_refresh_ms: roundDuration(durations['workos-refresh']) }),
    ...(durations['actor-db'] === undefined
      ? {}
      : { actor_db_ms: roundDuration(durations['actor-db']) }),
    ...(durations['business-db'] === undefined
      ? {}
      : { business_db_ms: roundDuration(durations['business-db']) }),
  }
}

function roundDuration(duration: number): number {
  return Math.round(duration * 10) / 10
}

function writeCounter(name: string, dimensions: Readonly<Record<string, string>>): void {
  console.info(JSON.stringify({ kind: 'counter', name, value: 1, dimensions }))
}
