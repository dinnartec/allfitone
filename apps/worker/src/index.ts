import { createResendEmailSender, constantTimeBearerMatches } from '@allfitone/notifications'
import { createBackofficeAuthMaintenanceFromEnv } from '@allfitone/auth-provider'
import { createPostgresQueue } from '@allfitone/queue'
import { Hono, type Context } from 'hono'
import postgres from 'postgres'

import { createInvitationBatchProcessor, createInvitationDeliveryDatabase } from './invitations.js'
import {
  createBackofficeAuthBatchProcessor,
  createBackofficeAuthCleanupDatabase,
} from './backoffice-auth.js'

let cachedProcessor: (() => Promise<unknown>) | undefined

export function createWorkerApp(injectedProcessor?: () => Promise<unknown>): Hono {
  const app = new Hono()
  const cron = async (c: Context) => {
    c.header('Cache-Control', 'no-store')
    const secret = process.env.CRON_SECRET
    if (!secret || !constantTimeBearerMatches(c.req.header('authorization'), secret)) {
      return c.json({ error: { code: 'unauthenticated' } }, 401)
    }
    try {
      const result = await (injectedProcessor ?? processorFromEnvironment())()
      console.info(
        JSON.stringify({
          kind: 'counter',
          name: 'worker.outbox.batch',
          value: 1,
          dimensions: { outcome: 'completed' },
        }),
      )
      return c.json(result)
    } catch {
      console.error('[worker-outbox] batch failed')
      return c.json({ error: { code: 'upstream-unavailable' } }, 503)
    }
  }
  app.get('/cron/outbox', cron)
  app.get('/api/cron/outbox', cron)
  return app
}

function processorFromEnvironment() {
  if (cachedProcessor) return cachedProcessor
  const databaseUrl = required('DATABASE_URL')
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  const queue = createPostgresQueue(sql, { visibilityTimeoutMs: 120_000, maxAttempts: 5 })
  const invitations = createInvitationBatchProcessor({
    queue,
    database: createInvitationDeliveryDatabase(sql),
    email:
      process.env.STAFF_INVITATION_DELIVERY_ENABLED === 'true'
        ? createResendEmailSender({
            apiKey: required('RESEND_API_KEY'),
            from: required('RESEND_FROM_EMAIL'),
          })
        : {
            send: async () => {
              throw new Error('Invitation delivery is disabled')
            },
          },
    publicBaseUrl: required('STAFF_INVITATION_PUBLIC_BASE_URL'),
    deliveryEnabled: process.env.STAFF_INVITATION_DELIVERY_ENABLED === 'true',
  })
  const backofficeAuthentication = createBackofficeAuthBatchProcessor({
    queue,
    database: createBackofficeAuthCleanupDatabase(sql),
    provider: createBackofficeAuthMaintenanceFromEnv(),
  })
  cachedProcessor = async () => ({
    invitations: await invitations(),
    backofficeAuthentication: await backofficeAuthentication(),
  })
  return cachedProcessor
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export const app = createWorkerApp()
export default app
