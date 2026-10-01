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
import { offerableScopeService } from '../dependencies.js'
import type { OfferableScopeService } from '../application/index.js'

export function studioPrivacyRoutes(
  injectedService?: OfferableScopeService,
  injectedSessions?: StudioSessionService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const scopes = () => injectedService ?? offerableScopeService()
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

  return routes
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
