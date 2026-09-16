import { createResendEmailSender, constantTimeBearerMatches } from '@allfitone/notifications'
import { createBackofficeAuthMaintenanceFromEnv } from '@allfitone/auth-provider'
import { createPostgresQueue } from '@allfitone/queue'
import type { TelemetryEventFor } from '@allfitone/telemetry'
import { telemetryEnvironmentFromRuntime } from '@allfitone/telemetry/node'
import type { ServerTelemetryAdapter } from '@allfitone/telemetry/posthog-node'
import type { OperationalLogAdapter } from '@allfitone/telemetry/posthog-otlp-logs'
import { Hono, type Context } from 'hono'
import postgres from 'postgres'

import {
  createInvitationBatchProcessor,
  createInvitationDeliveryDatabase,
  type InvitationBatchResult,
} from './invitations.js'
import {
  createOwnershipInvitationBatchProcessor,
  createOwnershipInvitationDeliveryDatabase,
} from './ownership-invitations.js'
import {
  createBackofficeAuthBatchProcessor,
  createBackofficeAuthCleanupDatabase,
  type BackofficeAuthBatchResult,
} from './backoffice-auth.js'
import { workerOperationalLogs, workerTelemetry } from './telemetry.js'

export interface WorkerJobProcessors {
  invitationDelivery(): Promise<InvitationBatchResult>
  backofficeAuthCleanup(): Promise<BackofficeAuthBatchResult>
}

export interface WorkerBatchResult {
  invitations: InvitationBatchResult
  backofficeAuthentication: BackofficeAuthBatchResult
}

let cachedProcessors: WorkerJobProcessors | undefined

export function createWorkerApp(
  injectedProcessors?: WorkerJobProcessors,
  injectedTelemetry?: ServerTelemetryAdapter,
  injectedLogs?: OperationalLogAdapter,
): Hono {
  const app = new Hono()
  const cron = async (c: Context) => {
    c.header('Cache-Control', 'no-store')
    const secret = process.env.CRON_SECRET
    if (!secret || !constantTimeBearerMatches(c.req.header('authorization'), secret)) {
      return c.json({ error: { code: 'unauthenticated' } }, 401)
    }
    const telemetry = injectedTelemetry ?? workerTelemetry()
    const logs = injectedLogs ?? workerOperationalLogs()
    const processors = injectedProcessors ?? processorsFromEnvironment()
    const batchStartedAt = performance.now()
    let invitations: InvitationBatchResult
    let backofficeAuthentication: BackofficeAuthBatchResult
    try {
      const invitationStartedAt = performance.now()
      try {
        invitations = await processors.invitationDelivery()
        captureJob(
          telemetry,
          logs,
          'invitation_delivery',
          outcomeForResult(invitations),
          invitationStartedAt,
          invitations.claimed,
        )
      } catch {
        captureJob(telemetry, logs, 'invitation_delivery', 'failed', invitationStartedAt)
        throw new Error('invitation_delivery_failed')
      }

      const backofficeStartedAt = performance.now()
      try {
        backofficeAuthentication = await processors.backofficeAuthCleanup()
        captureJob(
          telemetry,
          logs,
          'backoffice_auth_cleanup',
          outcomeForResult(backofficeAuthentication),
          backofficeStartedAt,
          backofficeAuthentication.claimed,
        )
      } catch {
        captureJob(telemetry, logs, 'backoffice_auth_cleanup', 'failed', backofficeStartedAt)
        throw new Error('backoffice_auth_cleanup_failed')
      }

      const result: WorkerBatchResult = { invitations, backofficeAuthentication }
      const aggregateOutcome =
        invitations.deadOrDelayed > 0 || backofficeAuthentication.deadOrDelayed > 0
          ? 'retrying'
          : 'completed'
      captureJob(
        telemetry,
        logs,
        'outbox_batch',
        aggregateOutcome,
        batchStartedAt,
        invitations.claimed + backofficeAuthentication.claimed,
      )
      console.info(
        JSON.stringify({
          kind: 'counter',
          name: 'worker.outbox.batch',
          value: 1,
          dimensions: { outcome: aggregateOutcome },
        }),
      )
      return c.json(result)
    } catch {
      captureJob(telemetry, logs, 'outbox_batch', 'failed', batchStartedAt)
      console.error('[worker-outbox] batch failed')
      return c.json({ error: { code: 'upstream-unavailable' } }, 503)
    }
  }
  app.get('/cron/outbox', cron)
  app.get('/api/cron/outbox', cron)
  return app
}

function captureJob(
  telemetry: ServerTelemetryAdapter,
  logs: OperationalLogAdapter,
  job: 'backoffice_auth_cleanup' | 'invitation_delivery' | 'outbox_batch',
  outcome: 'completed' | 'failed' | 'retrying',
  startedAt: number,
  itemCount?: number,
): void {
  const event: TelemetryEventFor<'worker.job.completed.v1'> = {
    event: 'worker.job.completed.v1',
    properties: {
      surface: 'system',
      service: 'allfit-worker',
      environment: telemetryEnvironmentFromRuntime(),
      release: telemetryRelease(),
      platform: 'node',
      job,
      outcome,
      duration_ms: Math.round(Math.max(0, performance.now() - startedAt) * 10) / 10,
      ...(itemCount === undefined ? {} : { item_count: itemCount }),
    },
  }
  telemetry.capture(event)
  if (outcome === 'failed') logs.emit('failure', event)
}

function outcomeForResult(result: { deadOrDelayed: number }): 'completed' | 'retrying' {
  return result.deadOrDelayed > 0 ? 'retrying' : 'completed'
}

function telemetryRelease(): string {
  const raw = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RELEASE ?? 'local'
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'local'
}

function processorsFromEnvironment(): WorkerJobProcessors {
  if (cachedProcessors) return cachedProcessors
  const databaseUrl = required('DATABASE_URL')
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  const queue = createPostgresQueue(sql, { visibilityTimeoutMs: 120_000, maxAttempts: 5 })
  const deliveryEnabled = process.env.STAFF_INVITATION_DELIVERY_ENABLED === 'true'
  const email = deliveryEnabled
    ? createResendEmailSender({
        apiKey: required('RESEND_API_KEY'),
        from: required('RESEND_FROM_EMAIL'),
      })
    : {
        send: async () => {
          throw new Error('Invitation delivery is disabled')
        },
      }
  const publicBaseUrl = required('STAFF_INVITATION_PUBLIC_BASE_URL')
  const teamInvitations = createInvitationBatchProcessor({
    queue,
    database: createInvitationDeliveryDatabase(sql),
    email,
    publicBaseUrl,
    deliveryEnabled,
  })
  const ownershipInvitations = createOwnershipInvitationBatchProcessor({
    queue,
    database: createOwnershipInvitationDeliveryDatabase(sql),
    email,
    publicBaseUrl,
    deliveryEnabled,
  })
  const backofficeAuthentication = createBackofficeAuthBatchProcessor({
    queue,
    database: createBackofficeAuthCleanupDatabase(sql),
    provider: createBackofficeAuthMaintenanceFromEnv(),
  })
  cachedProcessors = {
    // One delivery job for both kinds: the same page, the same switch and the same
    // expiry, which the team batch already runs for every pending invitation.
    invitationDelivery: async () => {
      const team = await teamInvitations()
      const ownership = await ownershipInvitations()
      return {
        claimed: team.claimed + ownership.claimed,
        delivered: team.delivered + ownership.delivered,
        deadOrDelayed: team.deadOrDelayed + ownership.deadOrDelayed,
        skipped: team.skipped + ownership.skipped,
        expired: team.expired,
      }
    },
    backofficeAuthCleanup: backofficeAuthentication,
  }
  return cachedProcessors
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export const app = createWorkerApp()
export default app
