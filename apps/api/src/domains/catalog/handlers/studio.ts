/** Governed professional catalogue routes for Studio. */

import { createHash } from 'node:crypto'
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
import { StudioCatalogError, type StudioCatalogService } from '../application/index.js'
import { studioCatalogService } from '../dependencies.js'
import type { ProfessionalCatalogItem } from '../domain/index.js'

const CACHE_CONTROL = 'private, max-age=0, must-revalidate'

export function studioCatalogRoutes(
  injectedCatalog?: StudioCatalogService,
  injectedSessions?: StudioSessionService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const catalog = () => injectedCatalog ?? studioCatalogService()
  const sessions = () => injectedSessions ?? studioSessionService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id', 'If-None-Match'],
      exposeHeaders: ['ETag'],
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
  })

  routes.get('/professional-specialties', async (c) =>
    catalogResponse(c, sessions(), (actor) => catalog().listSpecialties(actor)),
  )
  routes.get('/professional-credential-types', async (c) =>
    catalogResponse(c, sessions(), (actor) => catalog().listCredentialTypes(actor)),
  )

  return routes
}

async function catalogResponse(
  c: Context,
  sessions: StudioSessionService,
  load: (
    actor: Awaited<ReturnType<StudioSessionService['resolveActor']>>,
  ) => Promise<ProfessionalCatalogItem[]>,
) {
  c.header('Cache-Control', CACHE_CONTROL)
  try {
    const actor = await studioActor(c, sessions)
    if (actor instanceof Response) return actor
    const body = { items: await load(actor) }
    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`
    c.header('ETag', etag)
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)
    return c.json(body)
  } catch (error) {
    return operationFailure(c, error)
  }
}

async function studioActor(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated', 'missing session cookie')
  try {
    const actor = await sessions.resolveActor(token)
    return actor.personId ? actor : fail(c, 'registration-incomplete')
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
  }
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof StudioSessionError || error instanceof StudioCatalogError) {
    return fail(c, error.code)
  }
  console.error('[studio-catalog] operation failed')
  return fail(c, 'upstream-unavailable')
}
