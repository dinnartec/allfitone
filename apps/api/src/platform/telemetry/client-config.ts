import { TELEMETRY_NOTICE_VERSION } from '@allfitone/telemetry'
import { telemetryEnvironmentFromRuntime } from '@allfitone/telemetry/node'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

type ClientSurface = 'backoffice' | 'space' | 'studio'

const ENABLED_ENVIRONMENT_VARIABLE: Record<ClientSurface, string> = {
  backoffice: 'ANALYTICS_BACKOFFICE_CLIENT_ENABLED',
  space: 'ANALYTICS_SPACE_CLIENT_ENABLED',
  studio: 'ANALYTICS_STUDIO_CLIENT_ENABLED',
}

export function clientTelemetryConfigRoutes(surface: ClientSurface, allowedOrigin?: string): Hono {
  const routes = new Hono()

  if (allowedOrigin) {
    routes.use(
      '/telemetry-config',
      cors({
        origin: allowedOrigin,
        allowMethods: ['GET', 'OPTIONS'],
        exposeHeaders: ['ETag', 'Server-Timing'],
        maxAge: 600,
      }),
    )
  }

  routes.get('/telemetry-config', (c) => {
    /*
     * The browser may keep this for five minutes; Vercel's Edge Network may not
     * keep it at all.
     *
     * The whole API is one function mounted at `/`, so the Edge cache keys
     * everything it stores under `/` — one entry for every path there is. This
     * was the only `public` response in the API, which made it the only thing
     * that ever filled that entry, and once filled, the Edge evaluated the
     * `If-Match` of unrelated **writes** against it. Retiring a site returned
     * `200` from the function, wrote the row, and was then replaced by a
     * `412 Precondition Failed` the person could not even read, because a
     * response the Edge generates carries no CORS headers.
     *
     * `Vercel-CDN-Cache-Control` wins over `Cache-Control` for Vercel's cache
     * and is never sent to the browser, so the five minutes of browser caching
     * survive while the Edge stores nothing.
     */
    c.header('Vercel-CDN-Cache-Control', 'no-store')
    c.header('Cache-Control', 'public, max-age=300')
    return c.json({
      enabled:
        telemetryEnvironmentFromRuntime() === 'production' &&
        process.env[ENABLED_ENVIRONMENT_VARIABLE[surface]] === 'true',
      notice_version: TELEMETRY_NOTICE_VERSION,
    })
  })

  return routes
}
