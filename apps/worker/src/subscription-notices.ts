/**
 * Telling a person what happened to the plan they pay — `payments.subscription_*.v1`.
 *
 * Reads nothing from the database. Everything the message says was resolved inside the
 * transaction that caused the transition, because reading a subscription, a person or an
 * organization here would mean widening row policies written to keep the worker out of
 * all three. The payload is the contract.
 *
 * **Three kinds, one processor.** Suspension, reactivation and termination are the same
 * shape with a different template, and the person needs all three: a pause nobody was
 * told about reads as the app being broken, and a termination nobody was told about reads
 * as data having been deleted.
 *
 * `payments.subscription_started.v1` is deliberately absent. Subscribing is something the
 * person just did, with the result on the screen in front of them, and a receipt is a
 * separate decision — the amount charged is reported by the gateway, which is the next
 * slice.
 *
 * **A person with no contact is not a failure.** The gym's decision does not depend on
 * being able to reach her, so the subscription is suspended either way and the event
 * arrives with `contact: null`. There is nothing to send, so the message is acknowledged
 * and counted as skipped rather than retried forever against an address that does not
 * exist.
 */

import {
  NotificationDeliveryError,
  renderSubscriptionEndedEmail,
  renderSubscriptionReactivatedEmail,
  renderSubscriptionSuspendedEmail,
  type EmailSender,
} from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'

import { mapWithConcurrency } from './invitations.js'

export const SUBSCRIPTION_NOTICE_EVENTS = [
  'payments.subscription_suspended.v1',
  'payments.subscription_reactivated.v1',
  'payments.subscription_ended.v1',
] as const

export type SubscriptionNoticeEvent = (typeof SUBSCRIPTION_NOTICE_EVENTS)[number]

export interface SubscriptionNoticeBatchResult {
  claimed: number
  delivered: number
  deadOrDelayed: number
  skipped: number
}

export interface SubscriptionNotice {
  contact: string | null
  organization_name: string
  plan_name: string
  amount_minor: number
  currency_code: string
}

export function createSubscriptionNoticeBatchProcessor(dependencies: {
  queue: Queue
  email: EmailSender
  brandAssetUrl: string
  deliveryEnabled?: boolean
}): () => Promise<SubscriptionNoticeBatchResult> {
  return async function processSubscriptionNoticeBatch(): Promise<SubscriptionNoticeBatchResult> {
    if (dependencies.deliveryEnabled === false) {
      return { claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 }
    }

    const result: SubscriptionNoticeBatchResult = {
      claimed: 0,
      delivered: 0,
      deadOrDelayed: 0,
      skipped: 0,
    }

    for (const event of SUBSCRIPTION_NOTICE_EVENTS) {
      const messages = await dependencies.queue.claim(event, 25)
      const outcomes = await mapWithConcurrency(messages, 5, (message) => deliver(event, message))
      result.claimed += messages.length
      result.delivered += outcomes.filter((outcome) => outcome === 'delivered').length
      result.deadOrDelayed += outcomes.filter((outcome) => outcome === 'failed').length
      result.skipped += outcomes.filter((outcome) => outcome === 'skipped').length
    }

    return result
  }

  async function deliver(
    event: SubscriptionNoticeEvent,
    message: QueueMessage,
  ): Promise<'delivered' | 'failed' | 'skipped'> {
    try {
      const notice = readNotice(message.payload)
      /*
       * Not retried. The shape is written by a database function, so a wrong one is fixed
       * by a deploy and another attempt would only burn the retry budget.
       */
      if (!notice) {
        await dependencies.queue.nack(message.id, 'invalid_delivery_projection', false)
        return 'failed'
      }
      if (!notice.contact) {
        await dependencies.queue.ack(message.id)
        return 'skipped'
      }
      const rendered = render(event, notice, dependencies.brandAssetUrl)
      await dependencies.email.send({
        to: notice.contact,
        ...rendered,
        // Delivery is at-least-once, and two emails saying the plan was paused read as
        // two pauses.
        idempotencyKey: `subscription-notice/${message.id}`,
      })
      await dependencies.queue.ack(message.id)
      return 'delivered'
    } catch (error) {
      if (error instanceof NotificationDeliveryError) {
        await dependencies.queue.nack(message.id, error.code, error.retryable)
      } else {
        await dependencies.queue.nack(message.id, 'worker_error', true)
      }
      return 'failed'
    }
  }
}

function render(
  event: SubscriptionNoticeEvent,
  notice: SubscriptionNotice,
  brandAssetUrl: string,
): { subject: string; text: string; html: string } {
  if (event === 'payments.subscription_suspended.v1') {
    return renderSubscriptionSuspendedEmail({
      organizationName: notice.organization_name,
      planName: notice.plan_name,
      amountMinor: notice.amount_minor,
      currencyCode: notice.currency_code,
      brandAssetUrl,
    })
  }
  if (event === 'payments.subscription_reactivated.v1') {
    return renderSubscriptionReactivatedEmail({
      organizationName: notice.organization_name,
      planName: notice.plan_name,
      brandAssetUrl,
    })
  }
  return renderSubscriptionEndedEmail({
    organizationName: notice.organization_name,
    planName: notice.plan_name,
    brandAssetUrl,
  })
}

function readNotice(payload: unknown): SubscriptionNotice | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const candidate = payload as Record<string, unknown>

  for (const field of ['organization_name', 'plan_name', 'currency_code'] as const) {
    const value = candidate[field]
    if (typeof value !== 'string' || value.trim() === '') return undefined
  }
  /*
   * `amount_minor` is checked for being a usable number and not merely present. It is
   * formatted as money, and `NaN` would render as "$ NaN" in the one line that says what
   * somebody is being charged.
   */
  const amount = candidate.amount_minor
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return undefined

  const contact = candidate.contact
  // Absent and null are the same thing here; anything else is a malformed payload rather
  // than a person who cannot be reached.
  if (contact !== null && contact !== undefined && typeof contact !== 'string') return undefined

  return {
    contact: typeof contact === 'string' && contact.trim() !== '' ? contact : null,
    organization_name: candidate.organization_name as string,
    plan_name: candidate.plan_name as string,
    amount_minor: amount,
    currency_code: candidate.currency_code as string,
  }
}
