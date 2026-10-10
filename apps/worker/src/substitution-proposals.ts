/**
 * Asking a person whether somebody may cover for their professional.
 *
 * Like the reassignment consumer, this reads nothing from the database:
 * everything the question says was resolved inside the transaction that created
 * the proposal, because reading a relationship or a person here would mean
 * widening row policies written to keep both out of the worker's reach.
 *
 * Unlike it, what this delivers is a question rather than a notice. The cover
 * exists but grants nothing, and it never will unless the person answers — so a
 * message that fails to arrive is not a late notification, it is a cover that
 * silently never happens. That is why an unreadable payload dies loudly instead
 * of being retried forever.
 */

import {
  NotificationDeliveryError,
  renderSubstitutionProposedEmail,
  type EmailSender,
} from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'

import { mapWithConcurrency } from './invitations.js'

export interface SubstitutionBatchResult {
  claimed: number
  delivered: number
  deadOrDelayed: number
  skipped: number
}

export interface SubstitutionNotice {
  contact: string
  organization_name: string
  substitute_name: string
  holder_name: string
  starts_on: string
  ends_on: string
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

export function createSubstitutionBatchProcessor(dependencies: {
  queue: Queue
  email: EmailSender
  brandAssetUrl: string
  deliveryEnabled?: boolean
}): () => Promise<SubstitutionBatchResult> {
  return async function processSubstitutionBatch(): Promise<SubstitutionBatchResult> {
    if (dependencies.deliveryEnabled === false) {
      return { claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 }
    }
    const messages = await dependencies.queue.claim('relationship.substitution_proposed.v1', 25)
    const results = await mapWithConcurrency(messages, 5, deliver)
    return {
      claimed: messages.length,
      delivered: results.filter((outcome) => outcome === 'delivered').length,
      deadOrDelayed: results.filter((outcome) => outcome === 'failed').length,
      skipped: results.filter((outcome) => outcome === 'skipped').length,
    }
  }

  async function deliver(message: QueueMessage): Promise<'delivered' | 'failed' | 'skipped'> {
    try {
      const notice = readNotice(message.payload)
      /*
       * Not retried, for the same reason as the reassignment notice: the shape
       * is written by a database function, so if it is wrong a deploy fixes it
       * and another attempt does not.
       */
      if (!notice) {
        await dependencies.queue.nack(message.id, 'invalid_delivery_projection', false)
        return 'failed'
      }
      const rendered = renderSubstitutionProposedEmail({
        organizationName: notice.organization_name,
        substituteName: notice.substitute_name,
        holderName: notice.holder_name,
        startsOn: notice.starts_on,
        endsOn: notice.ends_on,
        brandAssetUrl: dependencies.brandAssetUrl,
      })
      await dependencies.email.send({
        to: notice.contact,
        ...rendered,
        // Delivery is at-least-once, and two emails asking the same question
        // read as two covers to answer.
        idempotencyKey: `substitution-proposal/${message.id}`,
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

function readNotice(payload: unknown): SubstitutionNotice | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const candidate = payload as Record<string, unknown>
  const names = ['contact', 'organization_name', 'substitute_name', 'holder_name'] as const
  for (const field of names) {
    const value = candidate[field]
    if (typeof value !== 'string' || value.trim() === '') return undefined
  }
  /*
   * The dates are checked for shape, not just for presence. They are formatted
   * for the person by splitting on the dashes, and anything else would render
   * as `Invalid Date` in the one line of the email that says how long somebody
   * will be able to read their health data.
   */
  const days = ['starts_on', 'ends_on'] as const
  for (const field of days) {
    const value = candidate[field]
    if (typeof value !== 'string' || !CALENDAR_DAY.test(value)) return undefined
  }
  return {
    contact: candidate.contact as string,
    organization_name: candidate.organization_name as string,
    substitute_name: candidate.substitute_name as string,
    holder_name: candidate.holder_name as string,
    starts_on: candidate.starts_on as string,
    ends_on: candidate.ends_on as string,
  }
}
