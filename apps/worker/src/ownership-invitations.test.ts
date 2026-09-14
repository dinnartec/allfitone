import { expect, test } from 'bun:test'
import {
  NotificationDeliveryError,
  createInvitationToken,
  type EmailMessage,
} from '@allfitone/notifications'
import type { Queue } from '@allfitone/queue'

import { createOwnershipInvitationBatchProcessor } from './ownership-invitations.js'

const KEY = Buffer.alloc(32, 5).toString('base64')
const INVITATION_ID = '0199b000-0000-7000-8000-000000000131'

function queue(acknowledged: string[], rejected: Array<[string, string, boolean]> = []): Queue {
  return {
    claim: async (topic) =>
      topic === 'organization.ownership_invited.v1'
        ? [{ id: 'event-9', topic, payload: {}, attempt: 1 }]
        : [],
    ack: async (id) => {
      acknowledged.push(id)
    },
    nack: async (id, code, retryable) => {
      rejected.push([id, code, retryable])
    },
  }
}

test('T-WRK-OWN-01 sends the owner the link to the same invitation page, derived from the invitation', async () => {
  const acknowledged: string[] = []
  const sent: EmailMessage[] = []
  const process = createOwnershipInvitationBatchProcessor({
    queue: queue(acknowledged),
    database: {
      prepare: async () => ({
        state: 'ready',
        invitationId: INVITATION_ID,
        contact: 'owner@example.test',
        organizationName: 'Handover Norte',
        tokenKeyVersion: 1,
        expiresAt: new Date('2026-09-20T12:00:00.000Z'),
      }),
    },
    email: {
      send: async (message) => {
        sent.push(message)
      },
    },
    publicBaseUrl: 'http://localhost:3000/',
    environment: { NODE_ENV: 'development', INVITATION_TOKEN_KEY_V1: KEY },
  })

  await expect(process()).resolves.toEqual({
    claimed: 1,
    delivered: 1,
    deadOrDelayed: 0,
    skipped: 0,
  })
  const token = createInvitationToken(INVITATION_ID, KEY)
  expect(acknowledged).toEqual(['event-9'])
  expect(sent[0]?.to).toBe('owner@example.test')
  expect(sent[0]?.idempotencyKey).toBe('ownership-invitation/event-9')
  expect(sent[0]?.subject).toBe('Handover Norte te espera en Allfit One')
  expect(sent[0]?.html).toContain(`http://localhost:3000/invitations#token=${token}`)
  expect(sent[0]?.text).toContain('existe pero no opera')
})

test('T-WRK-OWN-02 acknowledges an invitation that is no longer pending without sending anything', async () => {
  const acknowledged: string[] = []
  let sent = false
  const process = createOwnershipInvitationBatchProcessor({
    queue: queue(acknowledged),
    database: { prepare: async () => ({ state: 'skipped' }) },
    email: {
      send: async () => {
        sent = true
      },
    },
    publicBaseUrl: 'https://studio.example.test/',
  })

  await expect(process()).resolves.toMatchObject({ claimed: 1, skipped: 1, delivered: 0 })
  expect(acknowledged).toEqual(['event-9'])
  expect(sent).toBeFalse()
})

test('T-WRK-OWN-03 retries a throttled provider and never retries a rejected address', async () => {
  const rejected: Array<[string, string, boolean]> = []
  const ready = async () => ({
    state: 'ready' as const,
    invitationId: INVITATION_ID,
    contact: 'owner@example.test',
    organizationName: 'Handover Norte',
    tokenKeyVersion: 1,
    expiresAt: new Date('2026-09-20T12:00:00.000Z'),
  })
  const environment = { NODE_ENV: 'development', INVITATION_TOKEN_KEY_V1: KEY }

  for (const failure of [
    new NotificationDeliveryError('provider_throttled', true),
    new NotificationDeliveryError('provider_rejected', false),
  ]) {
    await createOwnershipInvitationBatchProcessor({
      queue: queue([], rejected),
      database: { prepare: ready },
      email: { send: async () => Promise.reject(failure) },
      publicBaseUrl: 'http://localhost:3000/',
      environment,
    })()
  }

  expect(rejected).toEqual([
    ['event-9', 'provider_throttled', true],
    ['event-9', 'provider_rejected', false],
  ])
})

test('T-WRK-OWN-04 claims nothing while delivery is switched off', async () => {
  let claimed = false
  const process = createOwnershipInvitationBatchProcessor({
    queue: {
      claim: async () => {
        claimed = true
        return []
      },
      ack: async () => undefined,
      nack: async () => undefined,
    },
    database: { prepare: async () => Promise.reject(new Error('must not prepare delivery')) },
    email: { send: async () => Promise.reject(new Error('must not send')) },
    publicBaseUrl: 'https://studio.example.test/',
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
