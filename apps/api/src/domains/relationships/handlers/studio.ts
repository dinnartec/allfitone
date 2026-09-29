/** Client directory routes for Studio. */

import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import {
  STUDIO_SESSION_COOKIE,
  StudioSessionError,
  type StudioSessionService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../../identity/index.js'
import { fail } from '../../../platform/http/index.js'
import { clientDirectoryService } from '../dependencies.js'
import { RelationshipsError, type ClientDirectoryService } from '../application/index.js'
import type { RelationshipStatus } from '../domain/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RELATIONSHIP_STATUSES = new Set<RelationshipStatus>(['active', 'terminated'])

export function studioRelationshipRoutes(
  injectedService?: ClientDirectoryService,
  injectedSessions?: StudioSessionService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const directory = () => injectedService ?? clientDirectoryService()
  const sessions = () => injectedSessions ?? studioSessionService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  )

  /*
   * OP-REL-010. The narrowing a coach gets is not here: this hands the same
   * query to PostgreSQL for every caller and the row policy decides which
   * clients come back. No access event is written — the directory carries a
   * name and the state of a link, and no fitness data of any kind.
   */
  routes.get('/organizations/:organizationId/clients', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')

    const statusValue = c.req.query('status')
    const status =
      statusValue && RELATIONSHIP_STATUSES.has(statusValue as RelationshipStatus)
        ? (statusValue as RelationshipStatus)
        : undefined
    if (statusValue && !status) return fail(c, 'validation-failed')

    const limit = parseLimit(c.req.query('limit'))
    if (!limit) return fail(c, 'validation-failed')
    const cursor = parseClientCursor(c.req.query('cursor'), status)
    if (cursor === null) return fail(c, 'validation-failed')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const page = await directory().listClients(actor, {
        organizationId,
        ...(status ? { status } : {}),
        limit,
        ...(cursor ?? {}),
      })
      const last = page.items.at(-1)
      return c.json({
        data: page.items.map((client) => ({
          relationship_id: client.relationshipId,
          person_id: client.personId,
          display_name: client.displayName,
          status: client.status,
          started_at: client.startedAt.toISOString(),
          ended_at: client.endedAt?.toISOString() ?? null,
        })),
        page: {
          has_more: page.hasMore,
          next_cursor:
            page.hasMore && last
              ? encodeClientCursor(last.status, last.sortDisplayName, last.relationshipId, status)
              : null,
        },
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  return routes
}

/*
 * Resolving the session actor is duplicated here on purpose, as it is in
 * catalog, identity and organizations. Boundary rule 5 forbids reaching into
 * another domain's handlers, and twelve lines of cookie reading is the cheaper
 * side of that trade — the alternative is a shared module that every domain
 * depends on for something none of them owns.
 */
async function studioActor(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated')
  try {
    return await sessions.resolveActor(token)
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
  }
}

function failure(c: Parameters<typeof fail>[0], error: unknown): Response {
  if (error instanceof RelationshipsError) return fail(c, error.code)
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === '22023') return fail(c, 'validation-failed')
  console.error('[studio-relationships] directory read failed')
  return fail(c, 'upstream-unavailable')
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return 50
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed <= 100 ? parsed : undefined
}

/**
 * The cursor carries the filter it was issued under. Changing `status` between
 * pages would otherwise resume a different query from an offset that means
 * nothing in it, which reads as rows skipped rather than as a bad request.
 */
function parseClientCursor(
  value: string | undefined,
  filterStatus: RelationshipStatus | undefined,
):
  | {
      cursorStatus: RelationshipStatus
      cursorDisplayName: string
      cursorRelationshipId: string
    }
  | undefined
  | null {
  if (!value) return undefined
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !isObject(parsed) ||
      parsed.v !== 1 ||
      parsed.filter_status !== (filterStatus ?? null) ||
      typeof parsed.status !== 'string' ||
      !RELATIONSHIP_STATUSES.has(parsed.status as RelationshipStatus) ||
      (filterStatus !== undefined && parsed.status !== filterStatus) ||
      typeof parsed.display_name !== 'string' ||
      parsed.display_name.length === 0 ||
      parsed.display_name.length > 240 ||
      typeof parsed.relationship_id !== 'string' ||
      !UUID.test(parsed.relationship_id)
    ) {
      return null
    }
    return {
      cursorStatus: parsed.status as RelationshipStatus,
      cursorDisplayName: parsed.display_name,
      cursorRelationshipId: parsed.relationship_id,
    }
  } catch {
    return null
  }
}

function encodeClientCursor(
  status: RelationshipStatus,
  displayName: string,
  relationshipId: string,
  filterStatus: RelationshipStatus | undefined,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      filter_status: filterStatus ?? null,
      status,
      display_name: displayName,
      relationship_id: relationshipId,
    }),
    'utf8',
  ).toString('base64url')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
