import { expect, test } from 'bun:test'
import {
  NotificationDeliveryError,
  createInvitationToken,
  type EmailMessage,
} from '@allfitone/notifications'
import type { Queue } from '@allfitone/queue'

import { createClientInvitationBatchProcessor } from './client-invitations.js'

const KEY = Buffer.alloc(32, 7).toString('base64')
const INVITATION_ID = '019b3000-0000-7000-8000-000000000501'

function queue(acknowledged: string[], rejected: Array<[string, string, boolean]> = []): Queue {
  return {
    claim: async (topic) =>
      topic === 'relationship.client_invited.v1'
        ? [{ id: 'event-7', topic, payload: {}, attempt: 1 }]
        : [],
    ack: async (id) => {
      acknowledged.push(id)
    },
    nack: async (id, code, retryable) => {
      rejected.push([id, code, retryable])
    },
  }
}

function ready() {
  return {
    state: 'ready' as const,
    invitationId: INVITATION_ID,
    contact: 'client@example.test',
    organizationName: 'Entrena Norte',
    tokenKeyVersion: 1,
    expiresAt: new Date('2026-10-11T12:00:00.000Z'),
  }
}

test('T-WRK-CLI-01 sends the person a link carrying the token derived from the invitation', async () => {
  const acknowledged: string[] = []
  const sent: EmailMessage[] = []
  const process = createClientInvitationBatchProcessor({
    queue: queue(acknowledged),
    database: { prepare: async () => ready() },
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
  expect(acknowledged).toEqual(['event-7'])
  expect(sent[0]?.to).toBe('client@example.test')
  expect(sent[0]?.idempotencyKey).toBe('client-invitation/event-7')
  expect(sent[0]?.subject).toBe('Entrena Norte te invitó como cliente en Allfit One')
  expect(sent[0]?.html).toContain(`http://localhost:3000/client-invitations#token=${token}`)
})

test('T-WRK-CLI-02 never puts what the gym asked for in the message', async () => {
  const sent: EmailMessage[] = []
  await createClientInvitationBatchProcessor({
    queue: queue([]),
    database: { prepare: async () => ready() },
    email: {
      send: async (message) => {
        sent.push(message)
      },
    },
    publicBaseUrl: 'http://localhost:3000/',
    environment: { NODE_ENV: 'development', INVITATION_TOKEN_KEY_V1: KEY },
  })()

  // The projection cannot read the offer and the email must not imply it did.
  const message = `${sent[0]?.subject ?? ''}${sent[0]?.text ?? ''}${sent[0]?.html ?? ''}`
  for (const leak of ['body_progress', 'health_context', 'Progreso corporal', 'permisos']) {
    expect(message).not.toContain(leak)
  }
  expect(sent[0]?.text).toContain('te pide permiso para ver información sobre ti')
})

test('T-WRK-CLI-03 acknowledges an invitation that is no longer pending without sending anything', async () => {
  const acknowledged: string[] = []
  let sent = false
  const process = createClientInvitationBatchProcessor({
    queue: queue(acknowledged),
    database: { prepare: async () => ({ state: 'skipped' }) },
    email: {
      send: async () => {
        sent = true
      },
    },
    publicBaseUrl: 'https://app.example.test/',
  })

  await expect(process()).resolves.toMatchObject({ claimed: 1, skipped: 1, delivered: 0 })
  expect(acknowledged).toEqual(['event-7'])
  expect(sent).toBeFalse()
})

test('T-WRK-CLI-04 refuses a projection missing anything the email needs', async () => {
  const rejected: Array<[string, string, boolean]> = []
  await createClientInvitationBatchProcessor({
    queue: queue([], rejected),
    // Ready, but with no address to send to: the key is absent, not undefined.
    database: {
      prepare: async () => ({
        state: 'ready' as const,
        invitationId: INVITATION_ID,
        organizationName: 'Entrena Norte',
        tokenKeyVersion: 1,
        expiresAt: new Date('2026-10-11T12:00:00.000Z'),
      }),
    },
    email: { send: async () => Promise.reject(new Error('must not send')) },
    publicBaseUrl: 'http://localhost:3000/',
    environment: { NODE_ENV: 'development', INVITATION_TOKEN_KEY_V1: KEY },
  })()

  expect(rejected).toEqual([['event-7', 'invalid_delivery_projection', false]])
})

test('T-WRK-CLI-05 retries a throttled provider and never retries a rejected address', async () => {
  const rejected: Array<[string, string, boolean]> = []
  const environment = { NODE_ENV: 'development', INVITATION_TOKEN_KEY_V1: KEY }

  for (const failure of [
    new NotificationDeliveryError('provider_throttled', true),
    new NotificationDeliveryError('provider_rejected', false),
  ]) {
    await createClientInvitationBatchProcessor({
      queue: queue([], rejected),
      database: { prepare: async () => ready() },
      email: { send: async () => Promise.reject(failure) },
      publicBaseUrl: 'http://localhost:3000/',
      environment,
    })()
  }

  expect(rejected).toEqual([
    ['event-7', 'provider_throttled', true],
    ['event-7', 'provider_rejected', false],
  ])
})

test('T-WRK-CLI-06 claims nothing while delivery is switched off', async () => {
  let claimed = false
  const process = createClientInvitationBatchProcessor({
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
    publicBaseUrl: 'https://app.example.test/',
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
