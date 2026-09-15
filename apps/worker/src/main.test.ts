import { beforeEach, expect, test } from 'bun:test'

import { createWorkerApp } from './main.js'
import type { TelemetryEventFor } from '@allfitone/telemetry'
import type { ServerTelemetryAdapter } from '@allfitone/telemetry/posthog-node'
import type { OperationalLogAdapter } from '@allfitone/telemetry/posthog-otlp-logs'
import type { InvitationBatchResult } from './invitations.js'
import type { BackofficeAuthBatchResult } from './backoffice-auth.js'
import type { AccountRecoveryBatchResult } from './account-recovery.js'

type WorkerEvent = TelemetryEventFor<'worker.job.completed.v1'>

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-test-secret'
})

test('rejects cron requests without the exact bearer secret', async () => {
  const response = await createWorkerApp(successfulProcessors()).request('/cron/outbox')
  expect(response.status).toBe(401)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.has('access-control-allow-origin')).toBeFalse()
})

test('runs the batch after authenticating the Vercel cron', async () => {
  const captured: unknown[] = []
  const telemetry: ServerTelemetryAdapter = {
    capture: (event) => captured.push(event),
    shutdown: async () => undefined,
  }
  const response = await createWorkerApp(
    successfulProcessors(),
    telemetry,
    operationalLogs(),
  ).request('/cron/outbox', {
    headers: { authorization: 'Bearer cron-test-secret' },
  })
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({
    invitations: invitationResult(),
    backofficeAuthentication: backofficeResult(),
    accountRecovery: recoveryResult(),
  })
  expect(captured).toHaveLength(4)
  for (const job of [
    'invitation_delivery',
    'backoffice_auth_cleanup',
    'account_recovery_delivery',
  ]) {
    expect(captured).toContainEqual(
      expect.objectContaining({
        event: 'worker.job.completed.v1',
        properties: expect.objectContaining({ job, outcome: 'completed', item_count: 0 }),
      }),
    )
  }
  expect(captured[3]).toMatchObject({
    event: 'worker.job.completed.v1',
    properties: { job: 'outbox_batch', outcome: 'completed', item_count: 0 },
  })
})

test('marks individual and aggregate jobs as retrying when work was delayed', async () => {
  const captured: WorkerEvent[] = []
  const telemetry: ServerTelemetryAdapter = {
    capture: (event) => {
      if (event.event === 'worker.job.completed.v1') captured.push(event)
    },
    shutdown: async () => undefined,
  }
  const processors = successfulProcessors()
  processors.accountRecoveryDelivery = async () => recoveryResult({ claimed: 2, deadOrDelayed: 1 })

  const response = await createWorkerApp(processors, telemetry, operationalLogs()).request(
    '/cron/outbox',
    { headers: { authorization: 'Bearer cron-test-secret' } },
  )

  expect(response.status).toBe(200)
  expect(captured.map(({ properties }) => [properties?.job, properties?.outcome])).toEqual([
    ['invitation_delivery', 'completed'],
    ['backoffice_auth_cleanup', 'completed'],
    ['account_recovery_delivery', 'retrying'],
    ['outbox_batch', 'retrying'],
  ])
  expect(captured[3]?.properties.item_count).toBe(2)
})

test('emits failed job and aggregate events without unreliable item counts', async () => {
  const captured: WorkerEvent[] = []
  const logged: unknown[] = []
  let recoveryRuns = 0
  const telemetry: ServerTelemetryAdapter = {
    capture: (event) => {
      if (event.event === 'worker.job.completed.v1') captured.push(event)
    },
    shutdown: async () => undefined,
  }
  const processors = successfulProcessors()
  processors.backofficeAuthCleanup = async () => Promise.reject(new Error('provider unavailable'))
  processors.accountRecoveryDelivery = async () => {
    recoveryRuns += 1
    return recoveryResult()
  }

  const response = await createWorkerApp(processors, telemetry, operationalLogs(logged)).request(
    '/cron/outbox',
    { headers: { authorization: 'Bearer cron-test-secret' } },
  )

  expect(response.status).toBe(503)
  expect(recoveryRuns).toBe(0)
  expect(captured.map(({ properties }) => [properties?.job, properties?.outcome])).toEqual([
    ['invitation_delivery', 'completed'],
    ['backoffice_auth_cleanup', 'failed'],
    ['outbox_batch', 'failed'],
  ])
  expect(captured[1]?.properties).not.toHaveProperty('item_count')
  expect(captured[2]?.properties).not.toHaveProperty('item_count')
  expect(logged).toHaveLength(2)
})

test('stops sequential execution when invitation delivery fails and logs both failures', async () => {
  const captured: WorkerEvent[] = []
  const logged: unknown[] = []
  let cleanupRuns = 0
  const telemetry: ServerTelemetryAdapter = {
    capture: (event) => {
      if (event.event === 'worker.job.completed.v1') captured.push(event)
    },
    shutdown: async () => undefined,
  }
  const processors = successfulProcessors()
  processors.invitationDelivery = async () => Promise.reject(new Error('queue unavailable'))
  processors.backofficeAuthCleanup = async () => {
    cleanupRuns += 1
    return backofficeResult()
  }

  const response = await createWorkerApp(processors, telemetry, operationalLogs(logged)).request(
    '/cron/outbox',
    { headers: { authorization: 'Bearer cron-test-secret' } },
  )

  expect(response.status).toBe(503)
  expect(cleanupRuns).toBe(0)
  expect(captured.map(({ properties }) => [properties?.job, properties?.outcome])).toEqual([
    ['invitation_delivery', 'failed'],
    ['outbox_batch', 'failed'],
  ])
  expect(captured.every(({ properties }) => !('item_count' in properties))).toBeTrue()
  expect(logged).toHaveLength(2)
})

function successfulProcessors() {
  return {
    invitationDelivery: async () => invitationResult(),
    backofficeAuthCleanup: async () => backofficeResult(),
    accountRecoveryDelivery: async () => recoveryResult(),
  }
}

function invitationResult(overrides: Partial<InvitationBatchResult> = {}): InvitationBatchResult {
  return { claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0, expired: 0, ...overrides }
}

function backofficeResult(
  overrides: Partial<BackofficeAuthBatchResult> = {},
): BackofficeAuthBatchResult {
  return { expired: 0, claimed: 0, completed: 0, deadOrDelayed: 0, skipped: 0, ...overrides }
}

function recoveryResult(
  overrides: Partial<AccountRecoveryBatchResult> = {},
): AccountRecoveryBatchResult {
  return { claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0, ...overrides }
}

function operationalLogs(captured: unknown[] = []): OperationalLogAdapter {
  return {
    emit: (_kind, event) => captured.push(event),
    shutdown: async () => undefined,
  }
}
