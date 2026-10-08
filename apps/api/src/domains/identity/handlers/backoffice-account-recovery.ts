/**
 * Backoffice account recovery routes: `NEW-IDN-ACTION` and `OP-IDN-053..048`.
 *
 * `HU-BO-010` and the recovery resend of `HU-BO-011`. The handler shapes and rejects; it
 * decides nothing. The support duty, AAL2, whether a person can be recovered and what can
 * be resent or cancelled are resolved inside the transaction.
 *
 * Every command body is exactly `{ "case_reference": … }`, and anything else in it is
 * refused rather than ignored: the person, the address and the flow come from the
 * database, so a field a client could add is a field that could redirect a recovery. No
 * route here writes a name, an email or a phone — criterion 1 is a property of this
 * surface, not a rule a screen has to remember.
 */

import { createHash, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import type { AccountRecoveryService } from '../application/account-recovery.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../application/backoffice.js'
import {
  accountRecoveryService,
  backofficeAuthenticationService,
  trustedBackofficeWebUrl,
} from '../dependencies.js'
import type {
  RecoveryAssistant,
  RecoveryCommand,
  RecoveryCommandResult,
} from '../domain/account-recovery.js'
import type { BackofficeActor } from '../domain/index.js'
import { BACKOFFICE_SESSION_COOKIE } from './backoffice.js'

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CASE_REFERENCE = /^[A-Z][A-Z0-9_-]{2,63}$/

export function backofficeAccountRecoveryRoutes(
  injectedRecoveries?: AccountRecoveryService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const recoveries = () => injectedRecoveries ?? accountRecoveryService()
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

  routes.get('/people/:personId/account-recovery', async (c) => {
    const personId = c.req.param('personId')
    const query = c.req.query()
    const caseReference = query.case_reference
    if (
      !UUID_ANY.test(personId) ||
      Object.keys(query).length !== 1 ||
      !caseReference ||
      !CASE_REFERENCE.test(caseReference)
    ) {
      return problem(c, 'invalid-request', 'a traceable case reference is required')
    }
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(
        await recoveries().read(assistantOf(actor), {
          requestId: randomUUID(),
          caseReference,
          personId,
        }),
      )
    } catch (error) {
      return operationFailure(c, error, 'invalid-request')
    }
  })

  routes.post('/people/:personId/account-recoveries', async (c) => {
    const input = await commandInput(c, origin, c.req.param('personId'))
    if (input instanceof Response) return input
    return respond(c, sessions(), (assistant) => recoveries().start(assistant, input))
  })

  routes.post('/people/:personId/account-recoveries/:requestId/resends', async (c) => {
    const recoveryId = c.req.param('requestId')
    const input = await commandInput(c, origin, c.req.param('personId'), recoveryId)
    if (input instanceof Response) return input
    return respond(c, sessions(), (assistant) =>
      recoveries().resend(assistant, { ...input, recoveryId }),
    )
  })

  routes.post('/people/:personId/account-recoveries/:requestId/cancellation', async (c) => {
    const recoveryId = c.req.param('requestId')
    const input = await commandInput(c, origin, c.req.param('personId'), recoveryId)
    if (input instanceof Response) return input
    return respond(c, sessions(), (assistant) =>
      recoveries().cancel(assistant, { ...input, recoveryId }),
    )
  })

  return routes
}

function assistantOf(actor: BackofficeActor): RecoveryAssistant {
  return { actorPersonId: actor.personId, actorSessionId: actor.sessionId }
}

async function commandInput(
  c: Context,
  origin: string,
  personId: string,
  recoveryId?: string,
): Promise<Response | (RecoveryCommand & { personId: string })> {
  if (c.req.header('origin') !== origin) return problem(c, 'forbidden')
  if (!UUID_ANY.test(personId) || (recoveryId !== undefined && !UUID_V7.test(recoveryId))) {
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
  const caseReference = caseReferenceOf(body)
  if (!caseReference) return problem(c, 'validation-failed')

  const idempotencyKey = c.req.header('idempotency-key')
  const commandId = c.req.header('command-id')
  if (!idempotencyKey || !UUID_V4.test(idempotencyKey) || !commandId || !UUID_V7.test(commandId)) {
    return problem(c, 'invalid-request')
  }
  return {
    idempotencyKey,
    commandId,
    requestId: randomUUID(),
    caseReference,
    personId,
    requestHash: createHash('sha256')
      .update(
        JSON.stringify(
          canonicalJson({
            method: c.req.method.toUpperCase(),
            path: c.req.path,
            resource: { case_reference: caseReference },
          }),
        ),
      )
      .digest(),
  }
}

/** The case, and nothing else: an extra field is refused, never ignored. */
function caseReferenceOf(body: unknown): string | undefined {
  if (!isObject(body)) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'case_reference') return undefined
  const value = body.case_reference
  return typeof value === 'string' && CASE_REFERENCE.test(value) ? value : undefined
}

async function respond(
  c: Context,
  sessions: BackofficeAuthenticationService,
  operation: (assistant: RecoveryAssistant) => Promise<RecoveryCommandResult>,
): Promise<Response> {
  try {
    const actor = await backofficeActor(c, sessions)
    if (actor instanceof Response) return actor
    const result = await operation(assistantOf(actor))
    if (result.replayed) c.header('Idempotent-Replay', 'true')
    return c.json(result.resource)
  } catch (error) {
    return operationFailure(c, error, 'validation-failed')
  }
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

function operationFailure(
  c: Context,
  error: unknown,
  invalid: 'invalid-request' | 'validation-failed',
) {
  if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
  const code = databaseErrorCode(error, invalid)
  if (code === 'idempotency-in-progress') c.header('Retry-After', '1')
  // Three emails in a rolling day: an hour is a hint, not a promise the next one fits.
  if (code === 'rate-limited') c.header('Retry-After', '3600')
  if (code) return problem(c, code)
  console.error('[backoffice-account-recovery] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(
  error: unknown,
  invalid: 'invalid-request' | 'validation-failed',
): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '22P02') return invalid
  // 55000 is the recovery itself: unavailable, under way, no longer live, or a changed address.
  if (sqlState === '55000' || sqlState === '23505' || sqlState === '23514') return 'conflict'
  // The only P0001 on these paths is the daily recovery limit.
  if (sqlState === 'P0001') return 'rate-limited'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
