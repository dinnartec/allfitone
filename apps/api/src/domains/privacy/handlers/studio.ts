/** The permission vocabulary an invitation is built from, for Studio. */

import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { fail } from '../../../platform/http/index.js'
import {
  STUDIO_SESSION_COOKIE,
  StudioSessionError,
  type StudioSessionService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../../identity/index.js'
import { authorizedScopeService, offerableScopeService } from '../dependencies.js'
import type { AuthorizedScopeService, OfferableScopeService } from '../application/index.js'
import {
  DEFAULT_AUTHORIZED_SCOPE_PAGE,
  MAX_AUTHORIZED_SCOPE_PAGE,
  type AuthorizedScopeCursor,
} from '../domain/index.js'

export function studioPrivacyRoutes(
  injectedService?: OfferableScopeService,
  injectedSessions?: StudioSessionService,
  injectedAuthorized?: AuthorizedScopeService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const scopes = () => injectedService ?? offerableScopeService()
  const sessions = () => injectedSessions ?? studioSessionService()
  const authorized = () => injectedAuthorized ?? authorizedScopeService()
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
   * OP-REL-016. The catalogue carries no data about any person — it is the
   * product's own vocabulary — but it still needs a session: there is no reason
   * to publish the list of health-data categories Allfit asks for to anyone who
   * has not signed in.
   */
  routes.get('/offerable-scopes', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      if (!actor.personId) return fail(c, 'registration-incomplete')
      const items = await scopes().list({
        actorPersonId: actor.personId,
        requestId: crypto.randomUUID(),
      })
      return c.json({ items })
    } catch (error) {
      const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
      if (sqlState === '42501') return fail(c, 'forbidden')
      console.error('[studio-privacy] offerable scope read failed')
      return fail(c, 'upstream-unavailable')
    }
  })

  /*
   * OP-PRV-023. What each client authorized, across the organization. It says
   * the state of every permission and nothing the permission covers, so it
   * writes no access event — there is no personal data here to record a reading
   * of.
   *
   * Which clients a reader may count is the relationship policy's decision
   * inside the transaction, not this handler's.
   */
  routes.get('/organizations/:organizationId/authorized-scopes', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }

    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) {
      return fail(c, 'validation-failed', 'organization id is not a uuid')
    }

    const limit = parseLimit(c.req.query('limit'))
    if (limit === null) return fail(c, 'validation-failed', 'limit is out of range')

    const cursor = parseScopeCursor(c.req.query('cursor'))
    if (cursor === null) return fail(c, 'validation-failed', 'cursor is not readable')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      if (!actor.personId) return fail(c, 'registration-incomplete')

      const page = await authorized().list(actor.personId, {
        organizationId,
        limit,
        ...(cursor ? { cursor } : {}),
      })
      const last = page.items.at(-1)
      return c.json({
        data: page.items,
        page: {
          has_more: page.hasMore,
          next_cursor:
            page.hasMore && last ? encodeScopeCursor(last.display_name, last.grant_id) : null,
        },
      })
    } catch (error) {
      const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
      if (sqlState === '42501') return fail(c, 'forbidden')
      if (sqlState === '22023') return fail(c, 'validation-failed', 'page request is not valid')
      console.error('[studio-privacy] authorized scope read failed')
      return fail(c, 'upstream-unavailable')
    }
  })

  return routes
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseLimit(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_AUTHORIZED_SCOPE_PAGE
  if (!/^[0-9]{1,3}$/.test(value)) return null
  const limit = Number(value)
  return limit >= 1 && limit <= MAX_AUTHORIZED_SCOPE_PAGE ? limit : null
}

/**
 * `undefined` is no cursor, `null` is a cursor that cannot be read. Collapsing
 * the two would answer a corrupted cursor with the first page, which reads as
 * rows silently skipped.
 */
function parseScopeCursor(value: string | undefined): AuthorizedScopeCursor | undefined | null {
  if (!value) return undefined
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !isObject(parsed) ||
      parsed.v !== 1 ||
      typeof parsed.name !== 'string' ||
      parsed.name.length === 0 ||
      parsed.name.length > 254 ||
      typeof parsed.id !== 'string' ||
      !UUID.test(parsed.id)
    ) {
      return null
    }
    return { name: parsed.name, id: parsed.id }
  } catch {
    return null
  }
}

function encodeScopeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, name, id }), 'utf8').toString('base64url')
}

/*
 * Duplicated across this domain's handlers on purpose, as it is in catalog,
 * identity, organizations and relationships: boundary rule 5 forbids reaching
 * into another domain's handlers.
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
