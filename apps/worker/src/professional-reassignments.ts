/**
 * Telling a person that a different professional now attends them.
 *
 * Unlike the invitation consumers, this one reads nothing from the database.
 * Everything the notice says is in the event, resolved inside the transaction
 * that made the change — because reading a relationship or a person here would
 * mean widening row policies written to keep exactly those two out of the
 * worker's reach.
 *
 * It also means the notice says what was true when the change happened, which
 * is what the person is being told about.
 */

import {
  NotificationDeliveryError,
  renderProfessionalReassignedEmail,
  type EmailSender,
} from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'

import { mapWithConcurrency } from './invitations.js'

export interface ReassignmentBatchResult {
  claimed: number
  delivered: number
  deadOrDelayed: number
  skipped: number
}

export interface ReassignmentNotice {
  contact: string
  organization_name: string
  professional_name: string
  previous_professional_name: string
}

export function createReassignmentBatchProcessor(dependencies: {
  queue: Queue
  email: EmailSender
  brandAssetUrl: string
  deliveryEnabled?: boolean
}): () => Promise<ReassignmentBatchResult> {
  return async function processReassignmentBatch(): Promise<ReassignmentBatchResult> {
    if (dependencies.deliveryEnabled === false) {
      return { claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 }
    }
    const messages = await dependencies.queue.claim('relationship.professional_reassigned.v1', 25)
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
       * A payload this consumer cannot read is not retried. Retrying would send
       * the same unreadable event every run until it dies, and the shape is
       * written by a database function — if it is wrong, a new deploy fixes it,
       * not another attempt.
       */
      if (!notice) {
        await dependencies.queue.nack(message.id, 'invalid_delivery_projection', false)
        return 'failed'
      }
      const rendered = renderProfessionalReassignedEmail({
        organizationName: notice.organization_name,
        professionalName: notice.professional_name,
        previousProfessionalName: notice.previous_professional_name,
        brandAssetUrl: dependencies.brandAssetUrl,
      })
      await dependencies.email.send({
        to: notice.contact,
        ...rendered,
        // Delivery is at-least-once, so the same event must not become two
        // emails telling somebody their coach changed twice.
        idempotencyKey: `professional-reassignment/${message.id}`,
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

function readNotice(payload: unknown): ReassignmentNotice | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const candidate = payload as Record<string, unknown>
  const fields = [
    'contact',
    'organization_name',
    'professional_name',
    'previous_professional_name',
  ] as const
  for (const field of fields) {
    const value = candidate[field]
    if (typeof value !== 'string' || value.trim() === '') return undefined
  }
  return {
    contact: candidate.contact as string,
    organization_name: candidate.organization_name as string,
    professional_name: candidate.professional_name as string,
    previous_professional_name: candidate.previous_professional_name as string,
  }
}
