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
    publicBaseUrl: 'https://space.example.test/',
    environment: { INVITATION_TOKEN_KEY_V1: Buffer.alloc(32, 5).toString('base64') },
  })
  await expect(process()).resolves.toEqual({
    claimed: 1,
    delivered: 1,
    deadOrDelayed: 0,
    skipped: 0,
  })
  expect(acknowledged).toEqual(['event-1'])
  expect(sent[0]?.idempotencyKey).toBe('staff-invitation/event-1')
  expect(sent[0]?.html).toContain('https://space.example.test/invitations/')
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
    database: { prepare: async () => ({ state: 'expired' }) },
    email: {
      send: async () => {
        sent = true
      },
    },
    publicBaseUrl: 'https://space.example.test/',
  })
  await process()
  expect(acknowledged).toBeTrue()
  expect(sent).toBeFalse()
})
