/**
 * The global catalogue surface: `OP-CAT-007`, `OP-CAT-008` and `OP-CAT-012`.
 *
 * `/catalog/v1` is the one surface with no subject and no tenant. It serves
 * global published content that Space, Studio and Backoffice all read, so it is
 * mounted once rather than duplicated into each product surface — the same
 * reason `application/` holds the use case and the handlers only project it.
 *
 * It is still not public. The operation sheets require any authenticated
 * account, and the closed database functions refuse a caller that is not an
 * active person, so an abandoned session stops reading the moment the person is
 * closed.
 *
 * A browser that has signed into both web products sends both session cookies,
 * because both are set by this API. The `Origin` header is what decides which
 * one is the caller's, and CORS has already restricted it to the two known web
 * origins. Space is headless and will arrive with a bearer credential instead;
 * that branch does not exist yet, so a request without a known origin is
 * refused rather than silently resolved from whichever cookie happens to be
 * present.
 *
 * Every read answers `private, no-store` and never 304. Both callers today are
 * browsers reading across origins, and a 304 reached them without
 * `Access-Control-Allow-Origin` although the application sets it, so the
 * browser blocked the revalidation outright. When Space arrives with a bearer
 * credential it is not subject to CORS, and revalidation can be reconsidered
 * for that branch alone.
 */

import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  backofficeAuthenticationService,
  STUDIO_SESSION_COOKIE,
  StudioSessionError,
  studioSessionService,
  trustedBackofficeWebUrl,
  trustedStudioWebUrl,
  type BackofficeAuthenticationService,
  type StudioSessionService,
} from '../../identity/index.js'
import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import type { GlobalCatalogService } from '../application/index.js'
import { globalCatalogService } from '../dependencies.js'
import type { CatalogReader } from '../domain/index.js'

const CACHE_CONTROL = 'private, no-store'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function catalogSurfaceRoutes(
  injectedCatalog?: GlobalCatalogService,
  injectedStudioSessions?: StudioSessionService,
  injectedBackofficeSessions?: BackofficeAuthenticationService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const backofficeOrigin = new URL(trustedBackofficeWebUrl()).origin
  const catalog = () => injectedCatalog ?? globalCatalogService()
  const studioSessions = () => injectedStudioSessions ?? studioSessionService()
  const backofficeSessions = () => injectedBackofficeSessions ?? backofficeAuthenticationService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: [studioOrigin, backofficeOrigin],
      credentials: true,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'If-None-Match'],
      exposeHeaders: ['ETag', 'Server-Timing'],
      maxAge: 600,
    }),
  )
  const surfaces = {
    studioOrigin,
    backofficeOrigin,
    studioSessions,
    backofficeSessions,
  }

  routes.get('/disciplines', (c) =>
    catalogResponse(c, surfaces, (reader) => catalog().listDisciplines(reader)),
  )

  routes.get('/activity-types', (c) =>
    catalogResponse(c, surfaces, (reader) => catalog().listActivityTypes(reader)),
  )

  routes.get('/activity-types/:activityTypeId/result-contracts', (c) => {
    const activityTypeId = c.req.param('activityTypeId')
    if (!UUID.test(activityTypeId)) return problem(c, 'invalid-request')
    return catalogResponse(c, surfaces, (reader) =>
      catalog().listActivityTypeResultContracts(reader, activityTypeId),
    )
  })

  return routes
}

interface CatalogSurfaces {
  studioOrigin: string
  backofficeOrigin: string
  studioSessions: () => StudioSessionService
  backofficeSessions: () => BackofficeAuthenticationService
}

async function catalogResponse(
  c: Context,
  surfaces: CatalogSurfaces,
  load: (reader: CatalogReader) => Promise<unknown[]>,
) {
  c.header('Cache-Control', CACHE_CONTROL)
  try {
    const reader = await catalogReader(c, surfaces)
    if (reader instanceof Response) return reader
    return c.json({ items: await load(reader) })
  } catch (error) {
    return operationFailure(c, error)
  }
}

async function catalogReader(
  c: Context,
  surfaces: CatalogSurfaces,
): Promise<CatalogReader | Response> {
  const origin = c.req.header('origin')
  if (origin === surfaces.backofficeOrigin) {
    const token = getCookie(c, BACKOFFICE_SESSION_COOKIE)
    if (!token) return problem(c, 'unauthenticated', 'missing session cookie')
    try {
      const actor = await surfaces.backofficeSessions().resolveActor(token)
      return { personId: actor.personId, actorKind: 'support' }
    } catch (error) {
      if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
      throw error
    }
  }

  if (origin === surfaces.studioOrigin) {
    const token = getCookie(c, STUDIO_SESSION_COOKIE)
    if (!token) return problem(c, 'unauthenticated', 'missing session cookie')
    try {
      const actor = await surfaces.studioSessions().resolveActor(token)
      if (!actor.personId) return problem(c, 'registration-incomplete')
      return { personId: actor.personId, actorKind: 'person' }
    } catch (error) {
      if (error instanceof StudioSessionError) return problem(c, error.code)
      throw error
    }
  }

  return problem(c, 'forbidden', 'the global catalogue is read from a known product surface')
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof BackofficeAuthenticationError || error instanceof StudioSessionError) {
    return problem(c, error.code)
  }
  const code = databaseErrorCode(error)
  if (code) return problem(c, code)
  console.error('[catalog-surface] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const sqlState = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '22P02') return 'invalid-request'
  return undefined
}
