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
import type { DirectoryEntry, DirectoryGroup } from '../domain/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DIRECTORY_GROUPS = new Set<DirectoryGroup>(['active', 'invited', 'terminated'])

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
      statusValue && DIRECTORY_GROUPS.has(statusValue as DirectoryGroup)
        ? (statusValue as DirectoryGroup)
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
        data: page.items.map(presentEntry),
        page: {
          has_more: page.hasMore,
          next_cursor:
            page.hasMore && last
              ? encodeClientCursor(last.sortGroup, last.sortName, last.sortId, status)
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
 * An invitation entry carries no person and no name: until somebody accepts,
 * neither exists. Presenting it with empty strings would invite a client to
 * render a blank name where there is nothing to render.
 */
function presentEntry(entry: DirectoryEntry): Record<string, unknown> {
  if (entry.kind === 'invitation') {
    return {
      kind: 'invitation',
      invitation_id: entry.invitationId,
      contact_hint: entry.contactHint,
      invitation_status: entry.invitationStatus,
      invited_at: entry.invitedAt.toISOString(),
    }
  }
  return {
    kind: 'relationship',
    relationship_id: entry.relationshipId,
    person_id: entry.personId,
    display_name: entry.displayName,
    relationship_status: entry.relationshipStatus,
    invitation_status: entry.invitationStatus,
    started_at: entry.startedAt.toISOString(),
    ended_at: entry.endedAt?.toISOString() ?? null,
  }
}

/**
 * The cursor carries the filter it was issued under. Changing `status` between
 * pages would otherwise resume a different query from an offset that means
 * nothing in it, which reads as rows skipped rather than as a bad request.
 */
function parseClientCursor(
  value: string | undefined,
  filterStatus: DirectoryGroup | undefined,
):
  | {
      cursorGroup: DirectoryGroup
      cursorName: string
      cursorId: string
    }
  | undefined
  | null {
  if (!value) return undefined
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !isObject(parsed) ||
      parsed.v !== 2 ||
      parsed.filter_status !== (filterStatus ?? null) ||
      typeof parsed.group !== 'string' ||
      !DIRECTORY_GROUPS.has(parsed.group as DirectoryGroup) ||
      (filterStatus !== undefined && parsed.group !== filterStatus) ||
      typeof parsed.name !== 'string' ||
      parsed.name.length === 0 ||
      parsed.name.length > 254 ||
      typeof parsed.id !== 'string' ||
      !UUID.test(parsed.id)
    ) {
      return null
    }
    return {
      cursorGroup: parsed.group as DirectoryGroup,
      cursorName: parsed.name,
      cursorId: parsed.id,
    }
  } catch {
    return null
  }
}

function encodeClientCursor(
  group: DirectoryGroup,
  name: string,
  id: string,
  filterStatus: DirectoryGroup | undefined,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 2,
      filter_status: filterStatus ?? null,
      group,
      name,
      id,
    }),
    'utf8',
  ).toString('base64url')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
