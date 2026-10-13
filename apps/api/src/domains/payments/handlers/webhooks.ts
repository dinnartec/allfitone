/**
 * Store notifications: `OP-PAY-023` (ADR-043).
 *
 * Apple posts a signed payload; Google, through Pub/Sub, posts a message with an OIDC
 * bearer. Neither carries our token, so trust comes only from verifying them with the
 * store. The status code is all a store reads: 200 when the notification was taken
 * (applied, stale, ignored or a repeat), 400 when it could not be verified, and 503 when
 * it should be delivered again.
 */

import { StoreBillingError } from '@allfitone/store-billing'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import type { ProService } from '../application/pro.js'
import { proService } from '../dependencies.js'

const MAX_NOTIFICATION_BYTES = 64 * 1024

export function storeWebhookRoutes(injectedService?: ProService): Hono {
  const pro = () => injectedService ?? proService()
  const routes = new Hono()
  const limit = bodyLimit({ maxSize: MAX_NOTIFICATION_BYTES, onError: (c) => c.body(null, 413) })

  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  routes.post('/app-store', limit, async (c) => {
    let signedPayload: unknown
    try {
      signedPayload = (await c.req.json<{ signedPayload?: unknown }>()).signedPayload
    } catch {
      return c.body(null, 400)
    }
    if (typeof signedPayload !== 'string' || signedPayload.length === 0) return c.body(null, 400)
    return taken(c, () => pro().appStoreNotification(signedPayload, crypto.randomUUID()))
  })

  routes.post('/google-play', limit, async (c) => {
    let body: string
    try {
      body = await c.req.text()
    } catch {
      return c.body(null, 400)
    }
    const authorization = c.req.header('authorization')
    return taken(c, () => pro().googlePlayNotification(authorization, body, crypto.randomUUID()))
  })

  return routes
}

async function taken(c: Context, apply: () => Promise<unknown>) {
  try {
    await apply()
    return c.body(null, 200)
  } catch (error) {
    if (error instanceof StoreBillingError && error.failure === 'invalid') return c.body(null, 400)
    console.error('[store-webhook] notification not applied')
    return c.body(null, 503)
  }
}
