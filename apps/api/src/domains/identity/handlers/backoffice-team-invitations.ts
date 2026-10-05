/**
 * Backoffice team invitation routes: `NEW-IDN-RESEND` and `OP-IDN-052`.
 *
 * `HU-BO-011`. The handler shapes and rejects; it decides nothing. The support duty,
 * AAL2, what can be resent and whether it is redelivered or reissued are resolved
 * inside the transaction.
 *
 * The resend command takes no body on purpose: the contact, the role and the gym all
 * come from the invitation being resent, so there is nothing a client could send to
 * change them. A body with anything in it is refused rather than ignored.
 */

import { createHash, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../application/backoffice.js'
import type { TeamInvitationResendService } from '../application/team-invitation-resends.js'
import {
  backofficeAuthenticationService,
  teamInvitationResendService,
  trustedBackofficeWebUrl,
} from '../dependencies.js'
import type { BackofficeActor } from '../domain/index.js'
import type { InvitationResender } from '../domain/team-invitation-resends.js'
import { BACKOFFICE_SESSION_COOKIE } from './backoffice.js'

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function backofficeTeamInvitationRoutes(
  injectedResends?: TeamInvitationResendService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const resends = () => injectedResends ?? teamInvitationResendService()
  const sessions = () => injectedSessions ?? backofficeAuthenticationService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
      exposeHeaders: ['Idempotent-Replay', 'Retry-After', 'Server-Timing'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
  })

  routes.get('/organizations/:organizationId/team-invitations', async (c) => {
    const organizationId = c.req.param('organizationId')
    if (!UUID_ANY.test(organizationId) || Object.keys(c.req.query()).length > 0) {
      return problem(c, 'invalid-request')
    }
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(
        await resends().list(resenderOf(actor), { requestId: randomUUID(), organizationId }),
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post(
    '/organizations/:organizationId/team-invitations/:invitationId/resends',
    async (c) => {
      if (c.req.header('origin') !== origin) return problem(c, 'forbidden')
      const organizationId = c.req.param('organizationId')
      const invitationId = c.req.param('invitationId')
      if (!UUID_ANY.test(organizationId) || !UUID_V7.test(invitationId)) {
        return problem(c, 'invalid-request')
      }
      if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
        return problem(c, 'unsupported-media-type')
      }
      let body: unknown
      try {
        body = await c.req.json<unknown>()
      } catch {
        return problem(c, 'validation-failed')
      }
      if (!isObject(body) || Object.keys(body).length > 0) return problem(c, 'validation-failed')
      const command = commandContext(c, { organizationId, invitationId })
      if (!command) return problem(c, 'invalid-request')

      try {
        const actor = await backofficeActor(c, sessions())
        if (actor instanceof Response) return actor
        const result = await resends().resend(resenderOf(actor), {
          ...command,
          organizationId,
          invitationId,
        })
        if (result.replayed) c.header('Idempotent-Replay', 'true')
        return c.json(result.resource)
      } catch (error) {
        return operationFailure(c, error)
      }
    },
  )

  return routes
}

function resenderOf(actor: BackofficeActor): InvitationResender {
  return { actorPersonId: actor.personId, actorSessionId: actor.sessionId }
}

async function backofficeActor(c: Context, sessions: BackofficeAuthenticationService) {
  const token = getCookie(c, BACKOFFICE_SESSION_COOKIE)
  if (!token) return problem(c, 'unauthenticated', 'missing session cookie')
  try {
    return await sessions.resolveActor(token)
  } catch (error) {
    if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
    throw error
  }
}

function commandContext(c: Context, request: unknown) {
  const idempotencyKey = c.req.header('idempotency-key')
  const commandId = c.req.header('command-id')
  if (!idempotencyKey || !UUID_V4.test(idempotencyKey) || !commandId || !UUID_V7.test(commandId)) {
    return undefined
  }
  return {
    idempotencyKey,
    commandId,
    requestId: randomUUID(),
    requestHash: createHash('sha256')
      .update(
        JSON.stringify(
          canonicalJson({
            method: c.req.method.toUpperCase(),
            path: c.req.path,
            resource: request,
          }),
        ),
      )
      .digest(),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  )
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
  const code = databaseErrorCode(error)
  if (code === 'idempotency-in-progress') c.header('Retry-After', '1')
  // The same hint Studio gives when the shared window refuses an invitation.
  if (code === 'rate-limited') c.header('Retry-After', '3600')
  if (code) return problem(c, code)
  console.error('[backoffice-team-invitations] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '22P02') return 'validation-failed'
  // 55000 is the state machine: accepted, revoked, already reissued, or an equal one pending.
  if (sqlState === '55000' || sqlState === '23505' || sqlState === '23514') return 'conflict'
  // The only P0001 on these paths is the invitation rate window Studio shares.
  if (sqlState === 'P0001') return 'rate-limited'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
