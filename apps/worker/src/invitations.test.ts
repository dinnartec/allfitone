import { expect, test } from 'bun:test'
import type { EmailMessage, EmailSender } from '@allfitone/notifications'
import type { Queue } from '@allfitone/queue'

import { createInvitationBatchProcessor } from './invitations.js'

test('delivers a ready invitation and acknowledges the event', async () => {
  const acknowledged: string[] = []
  const sent: EmailMessage[] = []
  const queue: Queue = {
    claim: async () => [
      { id: 'event-1', topic: 'organization.staff_invited.v1', payload: {}, attempt: 1 },
    ],
    ack: async (id) => {
      acknowledged.push(id)
    },
    nack: async () => undefined,
  }
  const email: EmailSender = {
    send: async (message) => {
      sent.push(message)
    },
  }
  const process = createInvitationBatchProcessor({
    queue,
    database: {
      expire: async () => 0,
      prepare: async () => ({
        state: 'ready',
        invitationId: '0199b000-0000-7000-8000-000000000031',
        contact: 'person@example.test',
        organizationName: 'Studio Norte',
        proposedRoleCode: 'staff',
        tokenKeyVersion: 1,
        expiresAt: new Date('2026-08-18T12:00:00.000Z'),
      }),
    },
    email,
    publicBaseUrl: 'http://localhost:3000/',
    environment: {
      NODE_ENV: 'development',
      INVITATION_TOKEN_KEY_V1: Buffer.alloc(32, 5).toString('base64'),
    },
  })
  await expect(process()).resolves.toEqual({
    claimed: 1,
    delivered: 1,
    deadOrDelayed: 0,
    skipped: 0,
    expired: 0,
  })
  expect(acknowledged).toEqual(['event-1'])
  expect(sent[0]?.idempotencyKey).toBe('staff-invitation/event-1')
  expect(sent[0]?.html).toContain('http://localhost:3000/invitations#token=')
  expect(sent[0]?.html).toContain('http://localhost:3000/email/allfit-one-lockup-on-light.png')
})

test('refuses an HTTP invitation URL in production, including localhost', () => {
  expect(() =>
    createInvitationBatchProcessor({
      queue: {
        claim: async () => [],
        ack: async () => undefined,
        nack: async () => undefined,
      },
      database: {
        expire: async () => 0,
        prepare: async () => ({ state: 'skipped' }),
      },
      email: { send: async () => undefined },
      publicBaseUrl: 'http://localhost:3000/',
      environment: { NODE_ENV: 'production' },
    }),
  ).toThrow('STAFF_INVITATION_PUBLIC_BASE_URL must be a trusted HTTPS URL')
})

test('acknowledges an expired invitation without sending email', async () => {
  let sent = false
  let acknowledged = false
  const process = createInvitationBatchProcessor({
    queue: {
      claim: async () => [
        { id: 'event-2', topic: 'organization.staff_invited.v1', payload: {}, attempt: 1 },
      ],
      ack: async () => {
        acknowledged = true
      },
      nack: async () => undefined,
    },
    database: { expire: async () => 1, prepare: async () => ({ state: 'expired' }) },
    email: {
      send: async () => {
        sent = true
      },
    },
    publicBaseUrl: 'https://studio.example.test/',
  })
  await process()
  expect(acknowledged).toBeTrue()
  expect(sent).toBeFalse()
})

test('expires invitations while delivery is disabled without claiming email events', async () => {
  let claimed = false
  const process = createInvitationBatchProcessor({
    queue: {
      claim: async () => {
        claimed = true
        return []
      },
      ack: async () => undefined,
      nack: async () => undefined,
    },
    database: {
      expire: async () => 4,
      prepare: async () => Promise.reject(new Error('must not prepare delivery')),
    },
    email: { send: async () => Promise.reject(new Error('must not send')) },
    publicBaseUrl: 'https://studio.example.test/',
    deliveryEnabled: false,
  })

  await expect(process()).resolves.toEqual({
    claimed: 0,
    delivered: 0,
    deadOrDelayed: 0,
    skipped: 0,
    expired: 4,
  })
  expect(claimed).toBeFalse()
})
