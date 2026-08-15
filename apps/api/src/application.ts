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
import { studioRequestTiming } from './platform/observability/index.js'

export function createApp(app: Hono = new Hono()): Hono {
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.route('/webhooks', workosWebhookRoutes())
  app.use('/studio/v1/*', studioRequestTiming())

  mountSurfaces(app)

  return app
}
