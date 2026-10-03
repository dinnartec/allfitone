import { describe, expect, test } from 'bun:test'

import { NotificationDeliveryError } from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'

import { createReassignmentBatchProcessor } from './professional-reassignments.js'

const NOTICE = {
  relationship_id: '01991600-7000-7000-8000-000000000101',
  contact: 'ana@example.test',
  person_name: 'Ana Álvarez',
  organization_name: 'Allfit Gym',
  professional_name: 'Daniela Hoyos',
  previous_professional_name: 'Camilo Restrepo',
}

function queueWith(messages: QueueMessage[]) {
  const acked: string[] = []
  const nacked: Array<{ id: string; reason: string; retryable: boolean }> = []
  const queue: Queue = {
    claim: async () => messages,
    ack: async (id: string) => {
      acked.push(id)
    },
    nack: async (id: string, reason: string, retryable: boolean) => {
      nacked.push({ id, reason, retryable })
    },
  } as unknown as Queue
  return { queue, acked, nacked }
}

function message(payload: unknown = NOTICE): QueueMessage {
  return {
    id: '01991600-7000-7000-8000-0000000000e1',
    topic: 'relationship.professional_reassigned.v1',
    payload,
    attempt: 1,
  }
}

function emailSpy() {
  const sent: Array<Record<string, unknown>> = []
  return {
    sent,
    sender: {
      send: async (email: Record<string, unknown>) => {
        sent.push(email)
      },
    },
  }
}

describe('telling a person their professional changed', () => {
  test('sends the notice to the person, not to the gym', async () => {
    const { queue, acked } = queueWith([message()])
    const email = emailSpy()
    const process = createReassignmentBatchProcessor({
      queue,
      email: email.sender as never,
      brandAssetUrl: 'https://studio.example.test/email/lockup.png',
    })

    const result = await process()

    expect(result).toMatchObject({ claimed: 1, delivered: 1 })
    expect(acked).toHaveLength(1)
    expect(email.sent[0]?.to).toBe('ana@example.test')
  })

  /*
   * The email exists to answer the question it raises. Somebody told that a
   * different professional now reaches their data will assume their permissions
   * moved too, and they did not.
   */
  test('the notice says the permissions did not change', async () => {
    const { queue } = queueWith([message()])
    const email = emailSpy()
    await createReassignmentBatchProcessor({
      queue,
      email: email.sender as never,
      brandAssetUrl: 'https://studio.example.test/email/lockup.png',
    })()

    expect(String(email.sent[0]?.text)).toContain('Tus permisos no cambiaron')
    expect(String(email.sent[0]?.text)).toContain('Camilo Restrepo')
    expect(String(email.sent[0]?.text)).toContain('Daniela Hoyos')
  })

  // No link, deliberately: there is nothing to approve, and a button in an
  // email about who reaches somebody's data is an invitation to phish them.
  test('the notice carries nothing to click', async () => {
    const { queue } = queueWith([message()])
    const email = emailSpy()
    await createReassignmentBatchProcessor({
      queue,
      email: email.sender as never,
      brandAssetUrl: 'https://studio.example.test/email/lockup.png',
    })()

    expect(String(email.sent[0]?.html)).not.toContain('<a href')
  })

  // At-least-once delivery must not become two emails saying the coach changed.
  test('the same event sends one email however often it arrives', async () => {
    const { queue } = queueWith([message()])
    const email = emailSpy()
    await createReassignmentBatchProcessor({
      queue,
      email: email.sender as never,
      brandAssetUrl: 'https://studio.example.test/email/lockup.png',
    })()

    expect(email.sent[0]?.idempotencyKey).toBe(
      'professional-reassignment/01991600-7000-7000-8000-0000000000e1',
    )
  })

  test('a payload it cannot read is not retried', async () => {
    const { queue, nacked } = queueWith([message({ contact: '' })])
    const email = emailSpy()
    const result = await createReassignmentBatchProcessor({
      queue,
      email: email.sender as never,
      brandAssetUrl: 'https://studio.example.test/email/lockup.png',
    })()

    expect(result.deadOrDelayed).toBe(1)
    expect(email.sent).toHaveLength(0)
    expect(nacked[0]).toMatchObject({ reason: 'invalid_delivery_projection', retryable: false })
  })

  // A provider outage is temporary, so the notice stays in the queue. Dropping
  // it would make the reassignment silent after all.
  test('a delivery failure the provider says is temporary is retried', async () => {
    const { queue, nacked } = queueWith([message()])
    const process = createReassignmentBatchProcessor({
      queue,
      email: {
        send: async () => {
          throw new NotificationDeliveryError('provider_unavailable', true)
        },
      } as never,
      brandAssetUrl: 'https://studio.example.test/email/lockup.png',
    })

    const result = await process()

    expect(result.deadOrDelayed).toBe(1)
    expect(nacked[0]).toMatchObject({ reason: 'provider_unavailable', retryable: true })
  })

  test('delivery turned off claims nothing at all', async () => {
    const { queue, acked, nacked } = queueWith([message()])
    const email = emailSpy()
    const result = await createReassignmentBatchProcessor({
      queue,
      email: email.sender as never,
      brandAssetUrl: 'https://studio.example.test/email/lockup.png',
      deliveryEnabled: false,
    })()

    expect(result).toEqual({ claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 })
    expect(email.sent).toHaveLength(0)
    expect(acked).toHaveLength(0)
    expect(nacked).toHaveLength(0)
  })
})
