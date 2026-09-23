/**
 * Backoffice privacy routes: `OP-PRV-011`, `OP-PRV-021` and `OP-SUP-009`.
 *
 * `HU-BO-024`, `HU-BO-030` and `HU-BO-032`. The handler shapes and rejects; it decides
 * nothing. The duty each operation needs — `curate_global_catalog` to publish,
 * `audit_platform_access` to read the log — and AAL2 are resolved inside the
 * transaction, against the tables.
 *
 * The version number is never accepted from the client — the request body has no
 * field for one — so two curators publishing at once produce two versions rather
 * than a race. And a version whose rules are all exclusions is refused before it
 * travels, because it would grant nothing while looking like a permission.
 *
 * The erasure panel reads the same disposition tables a person's own deletion
 * writes, so it lives here too. It reports what is owed and never what was erased:
 * the projection has no field for content, and the thirty days arrive as a target
 * date, because a countdown computed on the server is a countdown in the server's
 * zone.
 *
 * The access log lives here rather than in `support` because the closed queries
 * and the table are the privacy schema's, even though the operation is numbered
 * `OP-SUP`. The per-case auditor disqualification is **not** re-derived in this
 * layer: it is one predicate in the database, shared by the list and the count,
 * so the number of withheld records can never describe a different set than the
 * one that was removed.
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
import type {
  AccessLogService,
  ErasureRequestService,
  ScopeDefinitionService,
} from '../application/index.js'
import { accessLogService, erasureRequestService, scopeDefinitionService } from '../dependencies.js'
import {
  ACCESS_LEVELS,
  DATA_CLASSIFICATIONS,
  DEFAULT_ERASURE_PAGE,
  ERASURE_REQUEST_STATES,
  MAX_ERASURE_PAGE,
  SCOPE_CODES,
  type AccessEventFilters,
  type AccessLevel,
  type ErasureRequestFilters,
  type ErasureRequestState,
  type ScopeCode,
  type ScopeDefinitionPublication,
  type ScopeResourceRule,
} from '../domain/index.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RESOURCE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
const FIELD = /^[a-z][a-z0-9_]{0,63}$/
const MAX_RULES = 200

export function backofficePrivacyRoutes(
  injectedScopes?: ScopeDefinitionService,
  injectedSessions?: BackofficeAuthenticationService,
  injectedLog?: AccessLogService,
  injectedErasure?: ErasureRequestService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const scopes = () => injectedScopes ?? scopeDefinitionService()
  const sessions = () => injectedSessions ?? backofficeAuthenticationService()
  const log = () => injectedLog ?? accessLogService()
  const erasure = () => injectedErasure ?? erasureRequestService()
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

  routes.get('/scope-definitions', async (c) => {
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json({
        items: await scopes().list(
          { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
          { requestId: randomUUID() },
        ),
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/access-events', async (c) => {
    const filters = accessEventFilters(c)
    if (!filters) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(
        await log().read(
          { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
          { requestId: randomUUID(), ...filters },
        ),
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/erasure-requests', async (c) => {
    const filters = erasureRequestFilters(c)
    if (!filters) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(
        await erasure().list(
          { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
          { requestId: randomUUID(), ...filters },
        ),
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/scope-definitions', async (c) => {
    if (c.req.header('origin') !== origin) return problem(c, 'forbidden')
    if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
      return problem(c, 'unsupported-media-type')
    }

    let body: unknown
    try {
      body = await c.req.json<unknown>()
    } catch {
      return problem(c, 'validation-failed')
    }

    const publication = scopePublication(body)
    if (!publication) return problem(c, 'validation-failed')
    const command = commandContext(c, publication)
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await scopes().publish(
        { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
        { ...command, publication },
      )
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

/**
 * The shape is checked here to answer 422 instead of a database error. The
 * "includes something" rule is checked here for the same reason, and the command
 * refuses it again on its own — this is not the authority.
 */
function scopePublication(body: unknown): ScopeDefinitionPublication | undefined {
  if (!isObject(body)) return undefined
  const allowed = new Set(['scope_code', 'rules'])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined
  if (typeof body.scope_code !== 'string' || !SCOPE_CODES.includes(body.scope_code as ScopeCode)) {
    return undefined
  }
  const rules = body.rules
  if (!Array.isArray(rules) || rules.length === 0 || rules.length > MAX_RULES) return undefined

  const parsed = rules.map(scopeResourceRule)
  if (parsed.some((rule) => rule === undefined)) return undefined
  if (!parsed.some((rule) => rule?.is_excluded === false)) return undefined

  return {
    scope_code: body.scope_code as ScopeCode,
    rules: parsed as ScopeResourceRule[],
  }
}

function scopeResourceRule(value: unknown): ScopeResourceRule | undefined {
  if (!isObject(value)) return undefined
  const allowed = new Set([
    'resource',
    'field',
    'data_classification_code',
    'max_action',
    'is_excluded',
    'historical_readable',
  ])
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined
  if (typeof value.resource !== 'string' || !RESOURCE.test(value.resource)) return undefined
  if (typeof value.field !== 'string' || !(value.field === '*' || FIELD.test(value.field))) {
    return undefined
  }
  if (
    typeof value.data_classification_code !== 'string' ||
    !DATA_CLASSIFICATIONS.includes(value.data_classification_code)
  ) {
    return undefined
  }
  if (
    typeof value.max_action !== 'string' ||
    !ACCESS_LEVELS.includes(value.max_action as AccessLevel)
  ) {
    return undefined
  }

  // Declared, not inferred: reading an optional property of an index signature
  // and relying on control flow to keep it narrowed has failed on CI before.
  let isExcluded: boolean | undefined
  if (value.is_excluded !== undefined) {
    if (typeof value.is_excluded !== 'boolean') return undefined
    isExcluded = value.is_excluded
  }
  let historicalReadable: boolean | undefined
  if (value.historical_readable !== undefined) {
    if (typeof value.historical_readable !== 'boolean') return undefined
    historicalReadable = value.historical_readable
  }
  // The database CHECK says the same thing; answering here turns a 409 into a 422.
  if (historicalReadable === true && (isExcluded === true || value.max_action !== 'read')) {
    return undefined
  }

  // Both flags travel explicitly rather than by omission. The request may leave
  // them out, but what reaches the command says what it means.
  return {
    resource: value.resource,
    field: value.field,
    data_classification_code: value.data_classification_code,
    max_action: value.max_action as AccessLevel,
    is_excluded: isExcluded ?? false,
    historical_readable: historicalReadable ?? false,
  }
}

const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A malformed filter is answered 400 rather than dropped. Silently ignoring one
 * would widen the query: an auditor who mistyped a person identifier would be
 * shown the whole log instead of nothing, and would have no way to tell.
 */
function erasureRequestFilters(c: Context): ErasureRequestFilters | undefined {
  const allowed = new Set(['status', 'limit', 'cursor_at', 'cursor_id'])
  const query = c.req.query()
  if (Object.keys(query).some((key) => !allowed.has(key))) return undefined

  const status = query['status'] ?? 'open'
  if (!ERASURE_REQUEST_STATES.includes(status as ErasureRequestState)) return undefined

  let limit = DEFAULT_ERASURE_PAGE
  const asked = query['limit']
  if (asked !== undefined) {
    if (!/^[0-9]{1,3}$/.test(asked)) return undefined
    limit = Number(asked)
    if (limit < 1 || limit > MAX_ERASURE_PAGE) return undefined
  }

  const at = query['cursor_at']
  const id = query['cursor_id']
  // Half a cursor would silently page from the start, which reads as "nothing else
  // is owed" on a screen whose whole job is to say what still is.
  if ((at === undefined) !== (id === undefined)) return undefined
  if (at === undefined || id === undefined) {
    return { status: status as ErasureRequestState, limit }
  }
  const instant = Date.parse(at)
  if (Number.isNaN(instant) || !UUID_V7.test(id)) return undefined

  return {
    status: status as ErasureRequestState,
    limit,
    cursor: { at: new Date(instant).toISOString(), id },
  }
}

function accessEventFilters(c: Context): AccessEventFilters | undefined {
  const allowed = new Set(['actor_person_id', 'subject_person_id', 'from', 'to', 'limit'])
  const query = c.req.query()
  if (Object.keys(query).some((key) => !allowed.has(key))) return undefined

  const filters: AccessEventFilters = {}

  for (const [key, field] of [
    ['actor_person_id', 'filterActorPersonId'],
    ['subject_person_id', 'filterSubjectPersonId'],
  ] as const) {
    const value = query[key]
    if (value !== undefined) {
      if (!UUID_ANY.test(value)) return undefined
      filters[field] = value
    }
  }

  for (const [key, field] of [
    ['from', 'from'],
    ['to', 'to'],
  ] as const) {
    const value = query[key]
    if (value !== undefined) {
      const parsed = Date.parse(value)
      if (Number.isNaN(parsed)) return undefined
      filters[field] = new Date(parsed).toISOString()
    }
  }

  // An inverted range is a mistake, not an empty result: answering 400 says so
  // instead of letting the auditor read "no accesses" and believe it.
  if (filters.from && filters.to && filters.from >= filters.to) return undefined

  const limit = query['limit']
  if (limit !== undefined) {
    if (!/^[0-9]{1,3}$/.test(limit)) return undefined
    const parsed = Number(limit)
    if (parsed < 1 || parsed > 200) return undefined
    filters.limit = parsed
  }

  return filters
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
  if (code) return problem(c, code)
  console.error('[backoffice-privacy] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '23503') return 'validation-failed'
  // 55000 is the immutability guard: correcting means publishing the next version.
  if (sqlState === '23514' || sqlState === '23505' || sqlState === '55000') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
