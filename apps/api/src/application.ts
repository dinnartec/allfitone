/**
 * Application assembly. Starts nothing.
 *
 * Startup lives in `index.ts` (Vercel) and `server.ts` (container). Keeping it out
 * of here is what makes changing host a matter of one file and the pipeline
 * rather than the code.
 */

import { Hono } from 'hono'
import { mountSurfaces } from './surfaces.js'

export function createApp(app: Hono = new Hono()): Hono {
  app.get('/health', (c) => c.json({ status: 'ok' }))

  mountSurfaces(app)

  return app
}
