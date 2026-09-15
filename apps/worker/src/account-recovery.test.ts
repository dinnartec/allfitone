import { expect, test } from 'bun:test'
import { AuthError, type AccountRecoveryDelivery } from '@allfitone/auth-provider'
import type { Queue } from '@allfitone/queue'

import {
  createAccountRecoveryBatchProcessor,
  type AccountRecoveryDeliveryDatabase,
} from './account-recovery.js'

const EXPIRES_AT = '2026-09-15T05:15:00.000Z'

interface Trace {
  acknowledged: string[]
  rejected: Array<[string, string, boolean]>
  recorded: Array<[string, string]>
  failed: string[]
  sentTo: string[]
}

function trace(): Trace {
  return { acknowledged: [], rejected: [], recorded: [], failed: [], sentTo: [] }
}

function queue(seen: Trace, attempt = 1): Queue {
  return {
    claim: async (topic) =>
      topic === 'identity.account_recovery_requested.v1'
        ? [{ id: 'event-7', topic, payload: {}, attempt }]
        : [],
    ack: async (id) => {
      seen.acknowledged.push(id)
    },
    nack: async (id, code, retryable) => {
      seen.rejected.push([id, code, retryable])
    },
  }
}

function database(
  seen: Trace,
  overrides: Partial<AccountRecoveryDeliveryDatabase> = {},
): AccountRecoveryDeliveryDatabase {
  return {
    prepare: async () => ({ state: 'ready', contact: 'person@example.test' }),
    record: async (eventId, expiresAt) => {
      seen.recorded.push([eventId, expiresAt])
    },
    fail: async (eventId) => {
      seen.failed.push(eventId)
    },
    ...overrides,
  }
}

function provider(seen: Trace, failure?: Error): AccountRecoveryDelivery {
  return {
    sendRecovery: async (email) => {
      seen.sentTo.push(email)
      if (failure) throw failure
      return { expiresAt: EXPIRES_AT }
    },
  }
}

test('T-WRK-REC-01 asks the provider for the recovery and records when its link expires', async () => {
  const seen = trace()
  const process = createAccountRecoveryBatchProcessor({
    queue: queue(seen),
    database: database(seen),
    provider: provider(seen),
  })

  await expect(process()).resolves.toEqual({
    claimed: 1,
    delivered: 1,
    deadOrDelayed: 0,
    skipped: 0,
  })
  expect(seen.sentTo).toEqual(['person@example.test'])
  expect(seen.recorded).toEqual([['event-7', EXPIRES_AT]])
  expect(seen.acknowledged).toEqual(['event-7'])
})

test('T-WRK-REC-02 acknowledges a recovery that is no longer live without calling the provider', async () => {
  const seen = trace()
  const process = createAccountRecoveryBatchProcessor({
    queue: queue(seen),
    database: database(seen, { prepare: async () => ({ state: 'skipped' }) }),
    provider: provider(seen),
  })

  await expect(process()).resolves.toMatchObject({ claimed: 1, skipped: 1, delivered: 0 })
  expect(seen.sentTo).toEqual([])
  expect(seen.acknowledged).toEqual(['event-7'])
})

test('T-WRK-REC-03 retries an outage and fails the recovery only on the last attempt', async () => {
  const outage = new AuthError('provider_unavailable')
  const early = trace()
  await createAccountRecoveryBatchProcessor({
    queue: queue(early, 1),
    database: database(early),
    provider: provider(early, outage),
  })()
  const last = trace()
  await createAccountRecoveryBatchProcessor({
    queue: queue(last, 5),
    database: database(last),
    provider: provider(last, outage),
  })()

  expect(early.rejected).toEqual([['event-7', 'account_recovery_unavailable', true]])
  expect(early.failed).toEqual([])
  expect(last.failed).toEqual(['event-7'])
  expect(last.rejected).toEqual([['event-7', 'account_recovery_unavailable', false]])
})

test('T-WRK-REC-04 fails the recovery at once when the provider refuses the address', async () => {
  const seen = trace()
  await createAccountRecoveryBatchProcessor({
    queue: queue(seen, 1),
    database: database(seen),
    provider: provider(seen, new AuthError('invalid_email')),
  })()

  expect(seen.failed).toEqual(['event-7'])
  expect(seen.rejected).toEqual([['event-7', 'account_recovery_rejected', false]])
  expect(seen.recorded).toEqual([])
})

test('T-WRK-REC-05 retries without failing the recovery when recording breaks after the provider accepted', async () => {
  const seen = trace()
  await createAccountRecoveryBatchProcessor({
    queue: queue(seen),
    database: database(seen, {
      record: async () => Promise.reject(new Error('database unavailable')),
    }),
    provider: provider(seen),
  })()

  expect(seen.failed).toEqual([])
  expect(seen.acknowledged).toEqual([])
  expect(seen.rejected).toEqual([['event-7', 'worker_error', true]])
})

test('T-WRK-REC-06 claims nothing while delivery is switched off', async () => {
  let claimed = false
  const process = createAccountRecoveryBatchProcessor({
    queue: {
      claim: async () => {
        claimed = true
        return []
      },
      ack: async () => undefined,
      nack: async () => undefined,
    },
    database: {
      prepare: async () => Promise.reject(new Error('must not prepare')),
      record: async () => Promise.reject(new Error('must not record')),
      fail: async () => Promise.reject(new Error('must not fail')),
    },
    provider: { sendRecovery: async () => Promise.reject(new Error('must not send')) },
    deliveryEnabled: false,
  })

  await expect(process()).resolves.toEqual({
    claimed: 0,
    delivered: 0,
    deadOrDelayed: 0,
    skipped: 0,
  })
  expect(claimed).toBeFalse()
})
