/**
 * Backoffice organization routes: `NEW-SUP-ORG-SEARCH`.
 *
 * `HU-BO-012`. The handler shapes and rejects; it decides nothing. The support or
 * lifecycle duty and AAL2 are resolved inside the read's own transaction.
 *
 * Every filter that cannot be read is answered 400 rather than dropped. Dropping a
 * one-letter search or an unknown state would widen the question into "show me
 * everything", and a malformed cursor silently restarting at the first page would
 * make a caller think it had reached the end.
 */

import { randomUUID } from 'node:crypto'
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
import { organizationDirectoryService } from '../dependencies.js'
import {
  ORGANIZATION_LIFECYCLE_STATUSES,
  type OrganizationDirectoryCursor,
  type OrganizationDirectoryQuery,
  type OrganizationLifecycleStatus,
} from '../domain/directory.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PAGE = 100
const DEFAULT_PAGE = 25

export function backofficeOrganizationRoutes(
  injectedDirectory?: OrganizationDirectoryService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const directory = () => injectedDirectory ?? organizationDirectoryService()
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
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    const name = record['name']
    const id = record['id']
    if (typeof name !== 'string' || name.length === 0 || name.length > 240) return undefined
    if (typeof id !== 'string' || !UUID.test(id)) return undefined
    return { name, id }
  } catch {
    return undefined
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

function operationFailure(c: Context, error: unknown) {
  if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
  const code = databaseErrorCode(error)
  if (code) return problem(c, code)
  console.error('[backoffice-organizations] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const sqlState = (error as { code?: unknown }).code
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023') return 'validation-failed'
  return undefined
}
