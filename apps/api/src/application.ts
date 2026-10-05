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
import { databaseReachable } from './platform/db/index.js'
import { requestTiming } from './platform/observability/index.js'

export function createApp(app: Hono = new Hono()): Hono {
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
  app.use('/studio/v1/*', requestTiming('studio'))
  app.use('/space/v1/*', requestTiming('space'))
  app.use('/backoffice/v1/*', requestTiming('backoffice'))

  mountSurfaces(app)

  return app
}
