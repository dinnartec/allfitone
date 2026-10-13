/**
 * Application assembly. Starts nothing.
 *
 * Startup lives in `index.ts` (Vercel) and `server.ts` (container). Keeping it out
 * of here is what makes changing host a matter of one file and the pipeline
 * rather than the code.
 */

import { Hono } from 'hono'
import { mountSurfaces } from './surfaces.js'
import { workosWebhookRoutes } from './domains/identity/index.js'
import { storeWebhookRoutes } from './domains/payments/index.js'
import { databaseReachable } from './platform/db/index.js'
import { requestTiming } from './platform/observability/index.js'

export function createApp(app: Hono = new Hono()): Hono {
  /*
   * Nothing this API returns may live in Vercel's Edge cache.
   *
   * The whole API is a single function mounted at `/`, so the Edge keys its
   * cache by that one path: a single entry shared by every route. While it held
   * anything, the Edge answered conditional requests from it — and that included
   * the `If-Match` on **writes**. Retiring a site ran, wrote the row, returned
   * `200`, and had its response replaced by a `412 Precondition Failed` carrying
   * no CORS headers, so the screen reported a failure for a change that was
   * saved.
   *
   * One `public, max-age=300` response was enough to fill it. This header makes
   * that unreachable by construction rather than by remembering: a route may
   * still tell browsers to cache through `Cache-Control`, which is what the
   * telemetry config does, but the Edge keeps nothing.
   *
   * `Vercel-CDN-Cache-Control` takes precedence over `CDN-Cache-Control` and
   * `Cache-Control` for Vercel's cache, and is never forwarded to the browser.
   * It is set before the handler so a route can still override it deliberately.
   */
  app.use('*', async (c, next) => {
    c.header('Vercel-CDN-Cache-Control', 'no-store')
    await next()
  })

  // Readiness, not a greeting: the API cannot answer a single route without PostgreSQL,
  // so a probe that only proves the process is running sends traffic into an outage.
  app.get('/health', async (c) => {
    const reachable = await databaseReachable()
    c.header('Cache-Control', 'no-store')
    return c.json(
      reachable
        ? { status: 'ok', checks: { database: 'ok' } }
        : { status: 'degraded', checks: { database: 'unreachable' } },
      reachable ? 200 : 503,
    )
  })
  app.route('/webhooks', workosWebhookRoutes())
  app.route('/webhooks', storeWebhookRoutes())
  app.use('/studio/v1/*', requestTiming('studio'))
  app.use('/space/v1/*', requestTiming('space'))
  app.use('/backoffice/v1/*', requestTiming('backoffice'))

  mountSurfaces(app)

  return app
}
