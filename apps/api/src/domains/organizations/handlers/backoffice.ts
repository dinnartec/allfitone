/**
 * Backoffice organization routes: `NEW-SUP-ORG-SEARCH`, `OP-ORG-018`, `OP-ORG-021`
 * and `OP-ORG-022`.
 *
 * `HU-BO-012`, `HU-BO-014`, `HU-BO-015`. The handler shapes and rejects; it decides
 * nothing. The support or lifecycle duty, AAL2, the lifecycle states and who may claim
 * are resolved inside each call's own transaction.
 *
 * Every filter that cannot be read is answered 400 rather than dropped. Dropping a
 * one-letter search or an unknown state would widen the question into "show me
 * everything", and a malformed cursor silently restarting at the first page would
 * make a caller think it had reached the end.
 *
 * The handover body has no field for a natural person's name, and a legal name sent
 * for one is refused: Allfit never writes the name of someone who has not accepted.
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
import type { OrganizationDirectoryService } from '../application/directory.js'
import type { OrganizationHandoverService } from '../application/handover.js'
import { organizationDirectoryService, organizationHandoverService } from '../dependencies.js'
import {
  ORGANIZATION_LIFECYCLE_STATUSES,
  type OrganizationDirectoryCursor,
  type OrganizationDirectoryQuery,
  type OrganizationLifecycleStatus,
} from '../domain/directory.js'
import type { OrganizationHandoverCreate } from '../domain/handover.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TYPE_CODES = new Set(['professional_practice', 'gym', 'studio'])
const MAX_PAGE = 100
const DEFAULT_PAGE = 25

export function backofficeOrganizationRoutes(
  injectedDirectory?: OrganizationDirectoryService,
  injectedSessions?: BackofficeAuthenticationService,
  injectedHandover?: OrganizationHandoverService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const directory = () => injectedDirectory ?? organizationDirectoryService()
  const handover = () => injectedHandover ?? organizationHandoverService()
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

  routes.get('/organizations', async (c) => {
    const query = directoryQuery(c)
    if (!query) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const page = await directory().list(
        { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
        query,
      )
      return c.json({
        data: page.items,
        page: { has_more: page.hasMore, next_cursor: page.nextCursor ?? null },
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations', async (c) => {
    const body = await commandBody(c, origin)
    if (body instanceof Response) return body
    const create = handoverCreate(body)
    if (!create) return problem(c, 'validation-failed')
    const command = commandContext(c, create)
    if (!command) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await handover().create(
        { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
        { ...command, handover: create },
      )
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/organizations/:organizationId/handover', async (c) => {
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId) || Object.keys(c.req.query()).length > 0) {
      return problem(c, 'invalid-request')
    }
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(
        await handover().read(
          { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
          { requestId: randomUUID(), organizationId },
        ),
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations/:organizationId/handover/resends', async (c) => {
    const organizationId = c.req.param('organizationId')
    const rejected = await emptyCommand(c, origin, organizationId)
    if (rejected) return rejected
    const command = commandContext(c, { organization_id: organizationId, action: 'resend' })
    if (!command) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await handover().resend(
        { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
        { ...command, organizationId },
      )
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations/:organizationId/cancellation', async (c) => {
    const organizationId = c.req.param('organizationId')
    const rejected = await emptyCommand(c, origin, organizationId)
    if (rejected) return rejected
    const command = commandContext(c, { organization_id: organizationId, action: 'cancel' })
    if (!command) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await handover().cancel(
        { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
        { ...command, organizationId },
      )
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

function directoryQuery(c: Context): OrganizationDirectoryQuery | undefined {
  const allowed = new Set(['q', 'status', 'limit', 'cursor'])
  const raw = c.req.query()
  if (Object.keys(raw).some((key) => !allowed.has(key))) return undefined

  const query: OrganizationDirectoryQuery = { requestId: randomUUID(), limit: DEFAULT_PAGE }

  const search = raw['q']
  if (search !== undefined) {
    const trimmed = search.trim()
    if (trimmed.length < 2 || trimmed.length > 120) return undefined
    query.query = trimmed
  }

  const status = raw['status']
  if (status !== undefined) {
    if (!ORGANIZATION_LIFECYCLE_STATUSES.includes(status as OrganizationLifecycleStatus)) {
      return undefined
    }
    query.status = status as OrganizationLifecycleStatus
  }

  const limit = raw['limit']
  if (limit !== undefined) {
    if (!/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > MAX_PAGE) return undefined
    query.limit = Number(limit)
  }

  const cursor = raw['cursor']
  if (cursor !== undefined) {
    const decoded = decodeCursor(cursor)
    if (!decoded) return undefined
    query.cursor = decoded
  }

  return query
}

/**
 * Validated here because it feeds a sort key the database trusts. A malformed one
 * is refused rather than defaulted to the first page.
 */
function decodeCursor(value: string): OrganizationDirectoryCursor | undefined {
  if (value.length < 16 || value.length > 1024) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isObject(parsed)) return undefined
    const name = parsed['name']
    const id = parsed['id']
    if (typeof name !== 'string' || name.length === 0 || name.length > 240) return undefined
    if (typeof id !== 'string' || !UUID.test(id)) return undefined
    return { name, id }
  } catch {
    return undefined
  }
}

async function commandBody(c: Context, origin: string): Promise<unknown> {
  if (c.req.header('origin') !== origin) return problem(c, 'forbidden')
  if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
    return problem(c, 'unsupported-media-type')
  }
  try {
    return await c.req.json<unknown>()
  } catch {
    return problem(c, 'validation-failed')
  }
}

/**
 * The resend and the cancellation carry no body. One that carries anything is
 * refused, so a client cannot believe it narrowed or redirected the command.
 */
async function emptyCommand(
  c: Context,
  origin: string,
  organizationId: string,
): Promise<Response | undefined> {
  if (c.req.header('origin') !== origin) return problem(c, 'forbidden')
  if (!UUID.test(organizationId)) return problem(c, 'invalid-request')
  const text = (await c.req.text()).trim()
  if (text === '') return undefined
  if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
    return problem(c, 'unsupported-media-type')
  }
  return text === '{}' ? undefined : problem(c, 'validation-failed')
}

/**
 * The shape is checked here to answer 422 instead of a database error. The database
 * checks it again and is the authority.
 */
function handoverCreate(body: unknown): OrganizationHandoverCreate | undefined {
  if (!isObject(body)) return undefined
  const allowed = new Set([
    'display_name',
    'type_code',
    'party_kind',
    'legal_name',
    'site',
    'owner_email',
  ])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined

  // Read into locals first: narrowing an index-signature property through control
  // flow has failed on CI before.
  const displayName = boundedText(body['display_name'], 120)
  const typeCode = body['type_code']
  const partyKind = body['party_kind']
  const email = body['owner_email']
  if (!displayName) return undefined
  if (typeof typeCode !== 'string' || !TYPE_CODES.has(typeCode)) return undefined
  if (partyKind !== 'natural_person' && partyKind !== 'legal_entity') return undefined

  const rawLegalName = body['legal_name']
  const legalName =
    rawLegalName === undefined || rawLegalName === null ? null : boundedText(rawLegalName, 160)
  if (legalName === undefined) return undefined
  if ((partyKind === 'legal_entity') !== (legalName !== null)) return undefined

  const rawSite = body['site']
  let site: { name: string; address: string | null } | null = null
  if (rawSite !== undefined && rawSite !== null) {
    if (
      !isObject(rawSite) ||
      Object.keys(rawSite).some((key) => key !== 'name' && key !== 'address')
    ) {
      return undefined
    }
    const siteName = boundedText(rawSite['name'], 120)
    const rawAddress = rawSite['address']
    const address =
      rawAddress === undefined || rawAddress === null ? null : boundedText(rawAddress, 240)
    if (!siteName || address === undefined) return undefined
    site = { name: siteName, address }
  }

  if (typeof email !== 'string') return undefined
  const normalizedEmail = email.trim().toLowerCase()
  if (normalizedEmail.length < 3 || normalizedEmail.length > 254) return undefined
  if (!/^[^\s@]+@[^\s@]+$/.test(normalizedEmail)) return undefined

  return {
    display_name: displayName,
    type_code: typeCode as OrganizationHandoverCreate['type_code'],
    party_kind: partyKind,
    legal_name: legalName,
    site,
    owner_email: normalizedEmail,
  }
}

/** A trimmed, non-empty string within bounds, or `undefined` when it is not one. */
function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed !== '' && trimmed.length <= max ? trimmed : undefined
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

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function operationFailure(c: Context, error: unknown) {
  if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
  const code = databaseErrorCode(error)
  if (code === 'idempotency-in-progress') c.header('Retry-After', '1')
  if (code) return problem(c, code)
  console.error('[backoffice-organizations] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error['code'] === 'string' ? error['code'] : undefined
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '22023' || sqlState === '23514') return 'validation-failed'
  // 55000 is the lifecycle: an organization with an owner is neither resent nor cancelled.
  if (sqlState === '55000' || sqlState === '23505') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
