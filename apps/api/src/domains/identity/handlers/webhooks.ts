/** Operational WorkOS webhooks shared by every product surface. */

import { AuthError } from '@allfitone/auth-provider'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { recordIdentityPasswordResetWebhook } from '../../../platform/observability/index.js'
import type { IdentityWebhookService } from '../application/webhooks.js'
import { identityWebhookService } from '../dependencies.js'

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024

export function workosWebhookRoutes(injectedService?: IdentityWebhookService): Hono {
  const service = () => injectedService ?? identityWebhookService()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  routes.post(
    '/workos',
    bodyLimit({
      maxSize: MAX_WEBHOOK_BODY_BYTES,
      onError: (c) => {
        recordIdentityPasswordResetWebhook('invalid')
        return c.body(null, 413)
      },
    }),
    async (c) => {
      const signature = c.req.header('workos-signature')
      if (!signature) {
        recordIdentityPasswordResetWebhook('invalid')
        return c.body(null, 400)
      }

      let rawPayload: string
      try {
        rawPayload = await c.req.text()
      } catch {
        recordIdentityPasswordResetWebhook('invalid')
        return c.body(null, 400)
      }

      try {
        const outcome = await service().process(rawPayload, signature)
        recordIdentityPasswordResetWebhook(outcome)
        return c.body(null, 200)
      } catch (error) {
        if (error instanceof AuthError && error.code === 'invalid_webhook') {
          recordIdentityPasswordResetWebhook('invalid')
          return c.body(null, 400)
        }
        recordIdentityPasswordResetWebhook('failed')
        return c.body(null, 503)
      }
    },
  )

  return routes
}
