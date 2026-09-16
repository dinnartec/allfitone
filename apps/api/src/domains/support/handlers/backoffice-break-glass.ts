/**
 * Backoffice break-glass routes: `OP-SUP-001` through `OP-SUP-004`.
 *
 * The handler shapes and rejects; it decides nothing. The duty, the quorum, the
 * independence of approvers and the window are all resolved inside each command's
 * own transaction, against the tables.
 *
 * Two things here are worth reading as design rather than plumbing.
 *
 * The request body has no field for the tier, the approval count or the duration,
 * so this handler cannot pass them on even by accident. The server derives all
 * three from the categories.
 *
 * And the exercise answers 200 with a recorded outcome when the attempt is
 * denied, rather than 403. That is not leniency: the evidence of a refused
 * attempt is the point of the operation, the database already wrote it, and an
 * error status would invite a client to retry and treat the refusal as
 * transient. What a denial never carries is content.
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
import type { BreakGlassService } from '../application/index.js'
import { breakGlassService } from '../dependencies.js'
import {
  BREAK_GLASS_CATEGORIES,
  BREAK_GLASS_PURPOSES,
  BREAK_GLASS_STATUSES,
  type BreakGlassCategory,
  type BreakGlassPurpose,
  type BreakGlassRequestCreate,
  type BreakGlassStatus,
} from '../domain/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CASE_REFERENCE = /^[A-Z][A-Z0-9_-]{2,63}$/
const RESOURCE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
const MAX_PAGE = 100

export function backofficeBreakGlassRoutes(
  injectedWindows?: BreakGlassService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const windows = () => injectedWindows ?? breakGlassService()
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

  routes.get('/break-glass/requests', async (c) => {
    const limit = Number(c.req.query('limit') ?? 25)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      return problem(c, 'invalid-request')
    }
    const status = c.req.query('status')
    if (status !== undefined && !BREAK_GLASS_STATUSES.includes(status as BreakGlassStatus)) {
      return problem(c, 'invalid-request')
    }
    const mine = c.req.query('mine')
    if (mine !== undefined && mine !== 'true' && mine !== 'false') {
      return problem(c, 'invalid-request')
    }

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json({
        items: await windows().list(actor, {
          requestId: randomUUID(),
          mine: mine === 'true',
          ...(status === undefined ? {} : { status: status as BreakGlassStatus }),
          limit,
        }),
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/break-glass/requests', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const payload = await jsonPayload(c)
    if (payload instanceof Response) return payload
    const publication = breakGlassRequestCreate(payload.value)
    if (!publication) return problem(c, 'validation-failed')
    const command = commandContext(c, publication)
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await windows().request(actor, { ...command, publication })
      replay(c, result.replayed)
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/break-glass/requests/:requestId/decisions', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const breakGlassRequestId = c.req.param('requestId')
    if (!UUID_V7.test(breakGlassRequestId)) return problem(c, 'invalid-request')
    const payload = await jsonPayload(c)
    if (payload instanceof Response) return payload
    const decided = decision(payload.value)
    if (!decided) return problem(c, 'validation-failed')
    const command = commandContext(c, { breakGlassRequestId, ...decided })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await windows().decide(actor, {
        ...command,
        breakGlassRequestId,
        ...decided,
      })
      replay(c, result.replayed)
      return c.json(result.resource)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/break-glass/requests/:requestId/reads', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const breakGlassRequestId = c.req.param('requestId')
    if (!UUID_V7.test(breakGlassRequestId)) return problem(c, 'invalid-request')
    const payload = await jsonPayload(c)
    if (payload instanceof Response) return payload
    const exercise = breakGlassExercise(payload.value)
    if (!exercise) return problem(c, 'validation-failed')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      // A denial is an answer, not a failure: the evidence is already written and
      // the caller has to be told which reason was recorded.
      return c.json(
        await windows().exercise(actor, {
          breakGlassRequestId,
          requestTraceId: randomUUID(),
          ...exercise,
        }),
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/break-glass/requests/:requestId/closure', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const breakGlassRequestId = c.req.param('requestId')
    if (!UUID_V7.test(breakGlassRequestId)) return problem(c, 'invalid-request')
    const command = commandContext(c, { breakGlassRequestId })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await windows().close(actor, { ...command, breakGlassRequestId })
      replay(c, result.replayed)
      return c.json(result.resource)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

/**
 * Checked here to answer 422 instead of a database error. Note what cannot be
 * accepted: there is no branch for a tier, an approval count or a duration,
 * because the shape has no field for them.
 */
function breakGlassRequestCreate(body: unknown): BreakGlassRequestCreate | undefined {
  if (!isObject(body)) return undefined
  const allowed = new Set(['subject_person_id', 'categories', 'purpose', 'case_reference'])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined
  if (typeof body.subject_person_id !== 'string' || !UUID.test(body.subject_person_id)) {
    return undefined
  }
  if (
    typeof body.purpose !== 'string' ||
    !BREAK_GLASS_PURPOSES.includes(body.purpose as BreakGlassPurpose)
  ) {
    return undefined
  }
  if (typeof body.case_reference !== 'string' || !CASE_REFERENCE.test(body.case_reference)) {
    return undefined
  }
  const categories = body.categories
  if (
    !Array.isArray(categories) ||
    categories.length === 0 ||
    categories.length > BREAK_GLASS_CATEGORIES.length
  ) {
    return undefined
  }
  // A forbidden category is refused here as an unknown value, and refused again by
  // the database, which is the authority. Neither is a price: it is a no.
  if (
    categories.some(
      (category) =>
        typeof category !== 'string' ||
        !BREAK_GLASS_CATEGORIES.includes(category as BreakGlassCategory),
    )
  ) {
    return undefined
  }
  if (new Set(categories as string[]).size !== categories.length) return undefined

  return {
    subject_person_id: body.subject_person_id,
    categories: categories as BreakGlassCategory[],
    purpose: body.purpose as BreakGlassPurpose,
    case_reference: body.case_reference,
  }
}

function decision(
  body: unknown,
): { decision: 'approved' | 'rejected'; reasonCode: string } | undefined {
  if (!isObject(body)) return undefined
  const allowed = new Set(['decision', 'reason_code'])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined
  if (body.decision !== 'approved' && body.decision !== 'rejected') return undefined
  if (typeof body.reason_code !== 'string' || !CASE_REFERENCE.test(body.reason_code)) {
    return undefined
  }
  return { decision: body.decision, reasonCode: body.reason_code }
}

function breakGlassExercise(
  body: unknown,
): { category: BreakGlassCategory; resourceType: string; resourceId?: string } | undefined {
  if (!isObject(body)) return undefined
  const allowed = new Set(['category', 'resource_type', 'resource_id'])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined
  if (
    typeof body.category !== 'string' ||
    !BREAK_GLASS_CATEGORIES.includes(body.category as BreakGlassCategory)
  ) {
    return undefined
  }
  if (typeof body.resource_type !== 'string' || !RESOURCE.test(body.resource_type)) {
    return undefined
  }

  // Declared, not inferred: reading an optional property of an index signature and
  // relying on control flow to keep it narrowed has failed on CI before.
  let resourceId: string | undefined
  if (body.resource_id !== undefined && body.resource_id !== null) {
    if (typeof body.resource_id !== 'string' || !UUID.test(body.resource_id)) return undefined
    resourceId = body.resource_id
  }

  return {
    category: body.category as BreakGlassCategory,
    resourceType: body.resource_type,
    ...(resourceId === undefined ? {} : { resourceId }),
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
  console.error('[backoffice-break-glass] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  // A forbidden category and an ineffective duty both land here: the database
  // refuses them the same way, and so does the answer.
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '23503') return 'validation-failed'
  // 55000 is the state machine saying no: a rejected request cannot be approved,
  // a closed window cannot reopen. 23505 is a second decision by one approver.
  if (sqlState === '23514' || sqlState === '23505' || sqlState === '55000') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
