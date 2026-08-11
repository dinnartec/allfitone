import { createResendEmailSender, constantTimeBearerMatches } from '@allfitone/notifications'
import { createPostgresQueue } from '@allfitone/queue'
import { Hono, type Context } from 'hono'
import postgres from 'postgres'

import { createInvitationBatchProcessor, createInvitationDeliveryDatabase } from './invitations.js'

let cachedProcessor: (() => Promise<unknown>) | undefined

export function createWorkerApp(injectedProcessor?: () => Promise<unknown>): Hono {
  const app = new Hono()
  const cron = async (c: Context) => {
    c.header('Cache-Control', 'no-store')
    const secret = process.env.CRON_SECRET
    if (!secret || !constantTimeBearerMatches(c.req.header('authorization'), secret)) {
      return c.json({ error: { code: 'unauthenticated' } }, 401)
    }
    if (process.env.STAFF_INVITATIONS_ENABLED !== 'true' && !injectedProcessor) {
      return c.json({ outcome: 'disabled' })
    }
    try {
      const result = await (injectedProcessor ?? processorFromEnvironment())()
      console.info(
        JSON.stringify({
          kind: 'counter',
          name: 'worker.team_invitation.batch',
          value: 1,
          dimensions: { outcome: 'completed' },
        }),
      )
      return c.json(result)
    } catch {
      console.error('[worker-invitations] batch failed')
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
  cachedProcessor = createInvitationBatchProcessor({
    queue: createPostgresQueue(sql, { visibilityTimeoutMs: 120_000, maxAttempts: 5 }),
    database: createInvitationDeliveryDatabase(sql),
    email: createResendEmailSender({
      apiKey: required('RESEND_API_KEY'),
      from: required('RESEND_FROM_EMAIL'),
    }),
    publicBaseUrl: required('INVITATION_PUBLIC_BASE_URL'),
  })
  return cachedProcessor
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export const app = createWorkerApp()
