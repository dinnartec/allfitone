import { describe, expect, test } from 'bun:test'

import { NotificationDeliveryError } from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'

import { createSubstitutionBatchProcessor } from './substitution-proposals.js'

const NOTICE = {
  relationship_id: '01991600-7000-7000-8000-000000000101',
  organization_id: '01991600-7000-7000-8000-000000000201',
  person_id: '01991600-7000-7000-8000-000000000301',
  assignment_id: '01991600-7000-7000-8000-000000000401',
  contact: 'ana@example.test',
  person_name: 'Ana Álvarez',
  organization_name: 'Allfit Gym',
  substitute_name: 'Daniela Hoyos',
  holder_name: 'Camilo Restrepo',
  starts_on: '2026-11-02',
  ends_on: '2026-11-09',
}

const BRAND = 'https://studio.example.test/email/lockup.png'

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
    id: '01991600-7000-7000-8000-0000000000e2',
    topic: 'relationship.substitution_proposed.v1',
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

function deliver(payload: unknown = NOTICE) {
  const { queue, acked, nacked } = queueWith([message(payload)])
  const email = emailSpy()
  const run = createSubstitutionBatchProcessor({
    queue,
    email: email.sender as never,
    brandAssetUrl: BRAND,
  })
  return { run, email, acked, nacked }
}

describe('asking a person to accept a cover', () => {
  test('asks the person, not the gym', async () => {
    const { run, email, acked } = deliver()

    const result = await run()

    expect(result).toMatchObject({ claimed: 1, delivered: 1 })
    expect(acked).toHaveLength(1)
    expect(email.sent[0]?.to).toBe('ana@example.test')
  })

  /*
   * The first thing it has to say. An email announcing that somebody new will
   * be able to read your health data reads as a decision already taken unless
   * it says otherwise, and here nothing has been decided.
   */
  test('says that nothing happens until they answer', async () => {
    const { run, email } = deliver()
    await run()

    expect(String(email.sent[0]?.subject)).toContain('¿Aceptas')
    expect(String(email.sent[0]?.text)).toContain('No pasa nada hasta que respondas')
    expect(String(email.sent[0]?.text)).toContain('Daniela Hoyos no ve nada de tu información')
  })

  // The day the access ends is the whole of what they are agreeing to, so it
  // appears as a person writes it rather than as the database stores it.
  test('names the days in words, not as the database writes them', async () => {
    const { run, email } = deliver()
    await run()

    expect(String(email.sent[0]?.text)).toContain('2 de noviembre de 2026')
    expect(String(email.sent[0]?.text)).toContain('9 de noviembre de 2026')
    expect(String(email.sent[0]?.html)).toContain('9 de noviembre de 2026')
  })

  test('says the access stops by itself on the last day', async () => {
    const { run, email } = deliver()
    await run()

    expect(String(email.sent[0]?.text)).toContain(
      'Después deja de verlo sin que nadie tenga que hacer nada',
    )
  })

  // No link, for the same reason as the reassignment notice: a button in an
  // email about who reaches somebody's data is an invitation to phish them.
  test('carries nothing to click', async () => {
    const { run, email } = deliver()
    await run()

    expect(String(email.sent[0]?.html)).not.toContain('<a href')
  })

  // At-least-once delivery must not become two questions to answer.
  test('the same event asks once however often it arrives', async () => {
    const { run, email } = deliver()
    await run()

    expect(email.sent[0]?.idempotencyKey).toBe(
      'substitution-proposal/01991600-7000-7000-8000-0000000000e2',
    )
  })

  test('a payload it cannot read is not retried', async () => {
    const { run, email, nacked } = deliver({ ...NOTICE, contact: '' })

    const result = await run()

    expect(result.deadOrDelayed).toBe(1)
    expect(email.sent).toHaveLength(0)
    expect(nacked[0]).toMatchObject({ reason: 'invalid_delivery_projection', retryable: false })
  })

  /*
   * A date of the wrong shape would render as `Invalid Date` in the one line
   * that says how long somebody can read this person's data. Better unsent and
   * visible in the dead letters than sent and meaningless.
   */
  test('a date that is not a day is not sent at all', async () => {
    const { run, email, nacked } = deliver({ ...NOTICE, ends_on: 'next week' })

    const result = await run()

    expect(result.deadOrDelayed).toBe(1)
    expect(email.sent).toHaveLength(0)
    expect(nacked[0]).toMatchObject({ reason: 'invalid_delivery_projection', retryable: false })
  })

  /*
   * A provider outage is temporary, so the question stays in the queue.
   * Dropping it would leave a professional pending an answer the person was
   * never asked for.
   */
  test('a delivery failure the provider says is temporary is retried', async () => {
    const { queue, nacked } = queueWith([message()])
    const run = createSubstitutionBatchProcessor({
      queue,
      email: {
        send: async () => {
          throw new NotificationDeliveryError('provider_unavailable', true)
        },
      } as never,
      brandAssetUrl: BRAND,
    })

    const result = await run()

    expect(result.deadOrDelayed).toBe(1)
    expect(nacked[0]).toMatchObject({ reason: 'provider_unavailable', retryable: true })
  })

  test('delivery turned off claims nothing at all', async () => {
    const { queue, acked, nacked } = queueWith([message()])
    const email = emailSpy()
    const result = await createSubstitutionBatchProcessor({
      queue,
      email: email.sender as never,
      brandAssetUrl: BRAND,
      deliveryEnabled: false,
    })()

    expect(result).toEqual({ claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 })
    expect(email.sent).toHaveLength(0)
    expect(acked).toHaveLength(0)
    expect(nacked).toHaveLength(0)
  })
})
