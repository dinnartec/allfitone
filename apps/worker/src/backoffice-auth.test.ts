import { expect, test } from 'bun:test'
import type { Queue } from '@allfitone/queue'

import { createBackofficeAuthBatchProcessor } from './backoffice-auth.js'

test('expires attempts and idempotently cleans provider sessions and pending factors', async () => {
  const acknowledged: string[] = []
  const revoked: string[] = []
  const deleted: string[] = []
  const queue: Queue = {
    claim: async (topic) =>
      topic === 'identity.backoffice_auth_cleanup_requested.v1'
        ? [{ id: 'event-1', topic, payload: {}, attempt: 1 }]
        : [],
    ack: async (id) => {
      acknowledged.push(id)
    },
    nack: async () => undefined,
  }
  const process = createBackofficeAuthBatchProcessor({
    queue,
    database: {
      expire: async () => 3,
      prepare: async () => ({
        state: 'ready',
        providerSessionId: 'session-1',
        providerFactorId: 'factor-1',
      }),
    },
    provider: {
      revokeSession: async (id) => {
        revoked.push(id)
      },
      deleteAuthenticationFactor: async (id) => {
        deleted.push(id)
      },
    },
  })

  await expect(process()).resolves.toEqual({
    expired: 3,
    claimed: 1,
    completed: 1,
    deadOrDelayed: 0,
    skipped: 0,
  })
  expect(revoked).toEqual(['session-1'])
  expect(deleted).toEqual(['factor-1'])
  expect(acknowledged).toEqual(['event-1'])
})

test('nacks cleanup failures so the queue can retry and dead-letter them', async () => {
  const nacks: Array<[string, string, boolean]> = []
  const process = createBackofficeAuthBatchProcessor({
    queue: {
      claim: async (topic) =>
        topic === 'identity.backoffice_session_revocation_requested.v1'
          ? [{ id: 'event-2', topic, payload: {}, attempt: 2 }]
          : [],
      ack: async () => undefined,
      nack: async (id, reason, retryable) => {
        nacks.push([id, reason, retryable])
      },
    },
    database: {
      expire: async () => 0,
      prepare: async () => ({ state: 'ready', providerSessionId: 'session-2' }),
    },
    provider: {
      revokeSession: async () => Promise.reject(new Error('provider unavailable')),
      deleteAuthenticationFactor: async () => undefined,
    },
  })

  const result = await process()
  expect(result.deadOrDelayed).toBe(1)
  expect(nacks).toEqual([['event-2', 'backoffice_auth_cleanup_failed', true]])
})
