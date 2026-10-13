import { describe, expect, test } from 'bun:test'

import { NotificationDeliveryError } from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'

import {
  SUBSCRIPTION_NOTICE_EVENTS,
  createSubscriptionNoticeBatchProcessor,
  type SubscriptionNoticeEvent,
} from './subscription-notices.js'

const NOTICE = {
  subscription_id: '019c5000-0000-7000-8000-000000000601',
  person_id: '019c5000-0000-7000-8000-000000000002',
  organization_id: '019c5000-0000-7000-8000-000000000101',
  plan_version_id: '019c5000-0000-7000-8000-000000000501',
  contact: 'carla@example.test',
  person_name: 'Carla Cliente',
  organization_name: 'Gimnasio Uno',
  plan_name: 'Mensual',
  amount_minor: 12000000,
  currency_code: 'COP',
  billing_period: 'month',
}

const BRAND = 'https://studio.example.test/email/lockup.png'

function queueWith(byTopic: Partial<Record<SubscriptionNoticeEvent, QueueMessage[]>>) {
  const acked: string[] = []
  const nacked: Array<{ id: string; reason: string; retryable: boolean }> = []
  const claimed: string[] = []
  const queue: Queue = {
    claim: async (topic: string) => {
      claimed.push(topic)
      return byTopic[topic as SubscriptionNoticeEvent] ?? []
    },
    ack: async (id: string) => {
      acked.push(id)
    },
    nack: async (id: string, reason: string, retryable: boolean) => {
      nacked.push({ id, reason, retryable })
    },
  } as unknown as Queue
  return { queue, acked, nacked, claimed }
}

function message(topic: SubscriptionNoticeEvent, payload: unknown = NOTICE): QueueMessage {
  return {
    id: `019c5000-0000-7000-8000-00000000${topic.length.toString(16).padStart(4, '0')}`,
    topic,
    payload,
    attempt: 1,
  } as QueueMessage
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

function deliver(
  topic: SubscriptionNoticeEvent,
  payload: unknown = NOTICE,
  overrides: { email?: { send: (email: Record<string, unknown>) => Promise<void> } } = {},
) {
  const { queue, acked, nacked, claimed } = queueWith({ [topic]: [message(topic, payload)] })
  const spy = emailSpy()
  const run = createSubscriptionNoticeBatchProcessor({
    queue,
    email: (overrides.email ?? spy.sender) as never,
    brandAssetUrl: BRAND,
  })
  return { run, email: spy, acked, nacked, claimed }
}

describe('telling a person what happened to the plan they pay', () => {
  test('claims all three kinds, and only those three', async () => {
    const { run, claimed } = deliver('payments.subscription_suspended.v1')
    await run()
    expect(claimed).toEqual([...SUBSCRIPTION_NOTICE_EVENTS])
    // Starting is deliberately absent: she just did it, with the result on her screen.
    expect(claimed).not.toContain('payments.subscription_started.v1')
  })

  test('a suspension says what did not happen, not only what did', async () => {
    const { run, email, acked } = deliver('payments.subscription_suspended.v1')
    const result = await run()

    expect(result).toEqual({ claimed: 1, delivered: 1, deadOrDelayed: 0, skipped: 0 })
    expect(acked).toHaveLength(1)
    const sent = email.sent[0] as { to: string; text: string; subject: string }
    expect(sent.to).toBe('carla@example.test')
    expect(sent.subject).toContain('Gimnasio Uno')
    // The part nobody would guess, and the reason this email exists at all.
    expect(sent.text).toContain('no se borró nada')
    expect(sent.text).toContain('los permisos que diste siguen en pie')
  })

  test('and never carries a link or asks for a card', async () => {
    const { run, email } = deliver('payments.subscription_suspended.v1')
    await run()
    const sent = email.sent[0] as { text: string; html: string }
    // A payment link in an Allfit email is the exact shape a phishing message takes.
    expect(sent.text).not.toContain('http')
    expect(sent.html).not.toContain('afo-action')
    expect(sent.text).toContain('Nunca te vamos a pedir los datos de tu tarjeta')
  })

  test('formats the amount from the minor unit, not as the integer it is stored as', async () => {
    const { run, email } = deliver('payments.subscription_suspended.v1')
    await run()
    const sent = email.sent[0] as { html: string }
    // 12000000 minor COP is $120.000, and rendering it as 12.000.000 is a plan nobody
    // recognises as theirs.
    expect(sent.html).toContain('120.000')
    expect(sent.html).not.toContain('12.000.000')
  })

  test('a reactivation says no permission had to be granted again', async () => {
    const { run, email } = deliver('payments.subscription_reactivated.v1')
    await run()
    const sent = email.sent[0] as { text: string }
    expect(sent.text).toContain('No tuviste que volver a aceptar nada')
  })

  test('a termination says the history and the permissions are untouched', async () => {
    const { run, email } = deliver('payments.subscription_ended.v1')
    await run()
    const sent = email.sent[0] as { text: string }
    expect(sent.text).toContain('siguen siendo tuyos')
    expect(sent.text).toContain('no retira los permisos')
  })

  test('each message carries its own idempotency key, because delivery is at-least-once', async () => {
    const { run, email } = deliver('payments.subscription_suspended.v1')
    await run()
    const sent = email.sent[0] as { idempotencyKey: string }
    expect(sent.idempotencyKey).toStartWith('subscription-notice/')
  })

  /*
   * The assertion that keeps a person with no contact from becoming an outage. The gym's
   * decision does not depend on reaching her, so the event arrives with a null contact and
   * there is simply nothing to send.
   */
  test('a person with no contact is acknowledged and counted as skipped', async () => {
    const { run, email, acked, nacked } = deliver('payments.subscription_suspended.v1', {
      ...NOTICE,
      contact: null,
    })
    const result = await run()

    expect(result).toEqual({ claimed: 1, delivered: 0, deadOrDelayed: 0, skipped: 1 })
    expect(acked).toHaveLength(1)
    expect(nacked).toHaveLength(0)
    expect(email.sent).toHaveLength(0)
  })

  test('an absent contact reads the same as a null one', async () => {
    const { contact: _contact, ...withoutContact } = NOTICE
    const { run, acked, nacked } = deliver('payments.subscription_suspended.v1', withoutContact)
    const result = await run()
    expect(result.skipped).toBe(1)
    expect(acked).toHaveLength(1)
    expect(nacked).toHaveLength(0)
  })

  test('a payload missing a name dies instead of being retried forever', async () => {
    const { run, nacked } = deliver('payments.subscription_suspended.v1', {
      ...NOTICE,
      organization_name: '',
    })
    const result = await run()

    expect(result).toEqual({ claimed: 1, delivered: 0, deadOrDelayed: 1, skipped: 0 })
    expect(nacked[0]).toEqual({
      id: nacked[0]?.id ?? '',
      reason: 'invalid_delivery_projection',
      retryable: false,
    })
  })

  test('an amount that is not a usable number dies too, rather than rendering as NaN', async () => {
    const { run, nacked, email } = deliver('payments.subscription_suspended.v1', {
      ...NOTICE,
      amount_minor: 'twelve million',
    })
    await run()
    expect(nacked[0]?.retryable).toBe(false)
    expect(email.sent).toHaveLength(0)
  })

  test('a contact that is neither a string nor null is a malformed payload', async () => {
    const { run, nacked } = deliver('payments.subscription_suspended.v1', {
      ...NOTICE,
      contact: 42,
    })
    await run()
    expect(nacked[0]?.reason).toBe('invalid_delivery_projection')
  })

  test('a retryable delivery failure is retried', async () => {
    const { run, nacked } = deliver('payments.subscription_suspended.v1', NOTICE, {
      email: {
        send: async () => {
          throw new NotificationDeliveryError('provider_unavailable', true)
        },
      },
    })
    const result = await run()

    expect(result.deadOrDelayed).toBe(1)
    expect(nacked[0]).toMatchObject({ reason: 'provider_unavailable', retryable: true })
  })

  test('an unexpected failure is retried as a worker error', async () => {
    const { run, nacked } = deliver('payments.subscription_suspended.v1', NOTICE, {
      email: {
        send: async () => {
          throw new Error('socket closed')
        },
      },
    })
    await run()
    expect(nacked[0]).toMatchObject({ reason: 'worker_error', retryable: true })
  })

  test('delivery turned off claims nothing at all', async () => {
    const { queue, claimed } = queueWith({
      'payments.subscription_suspended.v1': [message('payments.subscription_suspended.v1')],
    })
    const spy = emailSpy()
    const run = createSubscriptionNoticeBatchProcessor({
      queue,
      email: spy.sender as never,
      brandAssetUrl: BRAND,
      deliveryEnabled: false,
    })

    expect(await run()).toEqual({ claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 })
    expect(claimed).toHaveLength(0)
    expect(spy.sent).toHaveLength(0)
  })
})
