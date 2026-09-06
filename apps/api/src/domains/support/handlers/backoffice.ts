/**
 * Backoffice platform access routes: `OP-SUP-007` and `OP-SUP-010`.
 *
 * These handlers shape and reject requests; they never decide access. The actor
 * arrives from the opaque AAL2 session cookie — never from a body or a header —
 * and `manage_platform_access` is resolved inside each command's transaction.
 * A handler that answered "forbidden" on its own would be a second authority
 * that can drift from the one in PostgreSQL.
 */

import { createHash, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  backofficeAuthenticationService,
  trustedBackofficeWebUrl,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import type { PlatformAccessService } from '../application/index.js'
import { platformAccessService } from '../dependencies.js'
import {
  PLATFORM_DUTY_CODES,
  type PlatformDutyCursor,
  type PlatformDutyStatus,
  type PlatformDutyCode,
  type PlatformRoleCursor,
} from '../domain/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REASON_CODE = /^[A-Za-z0-9][A-Za-z0-9 ._:-]*$/
const DUTY_STATUSES: readonly PlatformDutyStatus[] = [
  'scheduled',
  'active',
  'suspended',
  'expired',
  'revoked',
]
const MAX_PAGE = 100

export function backofficePlatformAccessRoutes(
  injectedAccess?: PlatformAccessService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const access = () => injectedAccess ?? platformAccessService()
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
    c.header('Vary', 'Origin')
  })

  routes.get('/platform/role-assignments', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const pagination = parsePagination(c, roleCursor)
    if (!pagination) return problem(c, 'validation-failed')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await access().listRoles(actor, {
        requestId: randomUUID(),
        ...pagination,
      })
      return c.json(pageBody(result))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/platform/duty-assignments', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const pagination = parsePagination(c, dutyCursor)
    const filters = dutyFilters(c)
    if (!pagination || !filters) return problem(c, 'validation-failed')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await access().listDuties(actor, {
        requestId: randomUUID(),
        ...filters,
        ...pagination,
      })
      return c.json(pageBody(result))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/platform/role-assignments', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const payload = await jsonPayload(c)
    if (payload instanceof Response) return payload
    const body = payload.value
    if (
      !isObject(body) ||
      typeof body.person_id !== 'string' ||
      !UUID.test(body.person_id) ||
      body.platform_role !== 'allfit_admin' ||
      Object.keys(body).length !== 2
    ) {
      return problem(c, 'validation-failed')
    }
    const command = commandContext(c, body)
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await access().grantRole(actor, {
        personId: body.person_id,
        platformRole: 'allfit_admin',
        ...command,
      })
      replay(c, result.replayed)
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/platform/role-assignments/:assignmentId/revocation', async (c) => {
    return closureRoute(c, origin, sessions, async (actor, assignmentId, command) => {
      const result = await access().revokeRole(actor, { assignmentId, ...command })
      replay(c, result.replayed)
      return c.json(result.resource)
    })
  })

  routes.post('/platform/duty-assignments', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const payload = await jsonPayload(c)
    if (payload instanceof Response) return payload
    const grant = dutyGrant(payload.value)
    if (!grant) return problem(c, 'validation-failed')
    const command = commandContext(c, payload.value)
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await access().grantDuty(actor, { ...grant, ...command })
      replay(c, result.replayed)
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/platform/duty-assignments/:assignmentId/suspension', async (c) => {
    return closureRoute(c, origin, sessions, async (actor, assignmentId, command) => {
      const result = await access().suspendDuty(actor, { assignmentId, ...command })
      replay(c, result.replayed)
      return c.json(result.resource)
    })
  })

  routes.post('/platform/duty-assignments/:assignmentId/revocation', async (c) => {
    return closureRoute(c, origin, sessions, async (actor, assignmentId, command) => {
      const result = await access().revokeDuty(actor, { assignmentId, ...command })
      replay(c, result.replayed)
      return c.json(result.resource)
    })
  })

  return routes
}

function pageBody<T>(result: { items: T[]; hasMore: boolean; nextCursor?: string }) {
  return {
    data: result.items,
    page: { has_more: result.hasMore, next_cursor: result.nextCursor ?? null },
  }
}

/**
 * The cursor is opaque to the client and validated here, because it feeds a sort
 * key the database trusts. A malformed one is rejected rather than defaulted to
 * the first page, which would silently restart a caller's pagination.
 */
function parsePagination<Cursor>(
  c: Context,
  decode: (value: unknown) => Cursor | undefined,
): { limit: number; cursor?: Cursor } | undefined {
  const rawLimit = c.req.query('limit') ?? '25'
  if (!/^[1-9][0-9]*$/.test(rawLimit)) return undefined
  const limit = Number(rawLimit)
  if (limit > MAX_PAGE) return undefined

  const rawCursor = c.req.query('cursor')
  if (!rawCursor) return { limit }
  try {
    const cursor = decode(JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')))
    return cursor ? { limit, cursor } : undefined
  } catch {
    return undefined
  }
}

function roleCursor(value: unknown): PlatformRoleCursor | undefined {
  if (!isObject(value) || !Number.isInteger(value.rank)) return undefined
  if (typeof value.grantedAt !== 'string' || !isInstant(value.grantedAt)) return undefined
  if (typeof value.id !== 'string' || !UUID.test(value.id)) return undefined
  return { rank: value.rank as number, grantedAt: value.grantedAt, id: value.id }
}

function dutyCursor(value: unknown): PlatformDutyCursor | undefined {
  if (!isObject(value) || !Number.isInteger(value.rank)) return undefined
  if (typeof value.validTo !== 'string' || !isInstant(value.validTo)) return undefined
  if (typeof value.createdAt !== 'string' || !isInstant(value.createdAt)) return undefined
  if (typeof value.id !== 'string' || !UUID.test(value.id)) return undefined
  return {
    rank: value.rank as number,
    validTo: value.validTo,
    createdAt: value.createdAt,
    id: value.id,
  }
}

function dutyFilters(
  c: Context,
): { personId?: string; dutyCode?: PlatformDutyCode; status?: PlatformDutyStatus } | undefined {
  const personId = c.req.query('person_id')
  const dutyCode = c.req.query('duty_code')
  const status = c.req.query('status')
  if (personId !== undefined && !UUID.test(personId)) return undefined
  if (dutyCode !== undefined && !PLATFORM_DUTY_CODES.includes(dutyCode as PlatformDutyCode)) {
    return undefined
  }
  if (status !== undefined && !DUTY_STATUSES.includes(status as PlatformDutyStatus)) {
    return undefined
  }
  return {
    ...(personId === undefined ? {} : { personId }),
    ...(dutyCode === undefined ? {} : { dutyCode: dutyCode as PlatformDutyCode }),
    ...(status === undefined ? {} : { status: status as PlatformDutyStatus }),
  }
}

/** Suspension and revocation differ only in the command they run. */
async function closureRoute(
  c: Context,
  origin: string,
  sessions: () => BackofficeAuthenticationService,
  run: (
    actor: Awaited<ReturnType<BackofficeAuthenticationService['resolveActor']>>,
    assignmentId: string,
    command: NonNullable<ReturnType<typeof commandContext>>,
  ) => Promise<Response>,
): Promise<Response> {
  if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
  const assignmentId = c.req.param('assignmentId')
  if (!assignmentId || !UUID_V7.test(assignmentId)) return problem(c, 'invalid-request')
  const payload = await jsonPayload(c)
  if (payload instanceof Response) return payload
  if (!isObject(payload.value) || Object.keys(payload.value).length > 0) {
    return problem(c, 'validation-failed')
  }
  const command = commandContext(c, { assignmentId })
  if (!command) return problem(c, 'invalid-request')

  try {
    const actor = await backofficeActor(c, sessions())
    if (actor instanceof Response) return actor
    return await run(actor, assignmentId, command)
  } catch (error) {
    return operationFailure(c, error)
  }
}

function dutyGrant(body: unknown):
  | {
      personId: string
      dutyCode: PlatformDutyCode
      validFrom: string | undefined
      validTo: string
      reasonCode: string
    }
  | undefined {
  if (!isObject(body)) return undefined
  const allowed = new Set(['person_id', 'duty_code', 'valid_from', 'valid_to', 'reason_code'])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined
  if (typeof body.person_id !== 'string' || !UUID.test(body.person_id)) return undefined
  if (
    typeof body.duty_code !== 'string' ||
    !PLATFORM_DUTY_CODES.includes(body.duty_code as PlatformDutyCode)
  ) {
    return undefined
  }
  if (typeof body.valid_to !== 'string' || !isInstant(body.valid_to)) return undefined
  if (
    body.valid_from !== undefined &&
    (typeof body.valid_from !== 'string' || !isInstant(body.valid_from))
  ) {
    return undefined
  }
  if (
    typeof body.reason_code !== 'string' ||
    body.reason_code.length > 120 ||
    !REASON_CODE.test(body.reason_code)
  ) {
    return undefined
  }
  return {
    personId: body.person_id,
    dutyCode: body.duty_code as PlatformDutyCode,
    validFrom: typeof body.valid_from === 'string' ? body.valid_from : undefined,
    validTo: body.valid_to,
    reasonCode: body.reason_code,
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

function exactOrigin(c: Context, allowed: string): boolean {
  return c.req.header('origin') === allowed
}

async function jsonPayload(c: Context): Promise<{ value: unknown } | Response> {
  if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
    return problem(c, 'unsupported-media-type')
  }
  try {
    return { value: await c.req.json<unknown>() }
  } catch {
    return { value: undefined }
  }
}

function replay(c: Context, replayed: boolean): void {
  if (replayed) c.header('Idempotent-Replay', 'true')
}

function isInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value)
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
  if (code) return problem(c, code)
  console.error('[backoffice-platform-access] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '23503') return 'validation-failed'
  // A check violation here is durable state, not a malformed request: the last
  // active administrator, a terminal duty, or an attempt to rewrite history.
  if (sqlState === '23514' || sqlState === '23505') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
