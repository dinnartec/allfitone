/**
 * Delivery of the ownership invitation Allfit issues when it hands over an
 * organization (`HU-BO-014`).
 *
 * The link is the same `/invitations` page a team invitation uses, and the token is
 * derived the same way, from the invitation id: Studio already keeps that token across
 * a first sign-up and asks which kind of invitation it holds. Expiry is not repeated
 * here, because the team batch expires every pending invitation, whatever it proposes.
 */

import {
  NotificationDeliveryError,
  createInvitationToken,
  invitationTokenKey,
  renderOwnershipInvitationEmail,
  type EmailSender,
} from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'
import type postgres from 'postgres'

import { mapWithConcurrency, trustedPublicBaseUrl } from './invitations.js'

export interface OwnershipInvitationDelivery {
  state: 'expired' | 'ready' | 'skipped'
  invitationId?: string
  contact?: string
  organizationName?: string
  tokenKeyVersion?: number
  expiresAt?: Date
}

export interface OwnershipInvitationDeliveryDatabase {
  prepare(eventId: string): Promise<OwnershipInvitationDelivery>
}

export interface OwnershipInvitationBatchResult {
  claimed: number
  delivered: number
  deadOrDelayed: number
  skipped: number
}

export function createOwnershipInvitationDeliveryDatabase(
  sql: postgres.Sql,
): OwnershipInvitationDeliveryDatabase {
  return {
    async prepare(eventId) {
      return sql.begin(async (transaction) => {
        await transaction`select set_config('app.actor_kind', 'worker', true)`
        const [row] = await transaction<
          Array<{
            delivery_state: OwnershipInvitationDelivery['state']
            invitation_id: string | null
            contact: string | null
            organization_name: string | null
            token_key_version: number | null
            expires_at: Date | null
          }>
        >`select * from identity.prepare_ownership_invitation_delivery(${eventId}::uuid)`
        if (!row) throw new Error('PostgreSQL did not prepare the ownership invitation delivery')
        return {
          state: row.delivery_state,
          ...(row.invitation_id ? { invitationId: row.invitation_id } : {}),
          ...(row.contact ? { contact: row.contact } : {}),
          ...(row.organization_name ? { organizationName: row.organization_name } : {}),
          ...(row.token_key_version ? { tokenKeyVersion: row.token_key_version } : {}),
          ...(row.expires_at ? { expiresAt: new Date(row.expires_at) } : {}),
        }
      })
    },
  }
}

export function createOwnershipInvitationBatchProcessor(dependencies: {
  queue: Queue
  database: OwnershipInvitationDeliveryDatabase
  email: EmailSender
  publicBaseUrl: string
  environment?: NodeJS.ProcessEnv
  deliveryEnabled?: boolean
}) {
  const environment = dependencies.environment ?? process.env
  const baseUrl = trustedPublicBaseUrl(dependencies.publicBaseUrl, environment)

  return async function processOwnershipInvitationBatch(): Promise<OwnershipInvitationBatchResult> {
    if (dependencies.deliveryEnabled === false) {
      return { claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 }
    }
    const messages = await dependencies.queue.claim('organization.ownership_invited.v1', 25)
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
      const delivery = await dependencies.database.prepare(message.id)
      if (delivery.state !== 'ready') {
        await dependencies.queue.ack(message.id)
        return 'skipped'
      }
      if (
        !delivery.invitationId ||
        !delivery.contact ||
        !delivery.organizationName ||
        !delivery.tokenKeyVersion ||
        !delivery.expiresAt
      ) {
        await dependencies.queue.nack(message.id, 'invalid_delivery_projection', false)
        return 'failed'
      }
      const token = createInvitationToken(
        delivery.invitationId,
        invitationTokenKey(delivery.tokenKeyVersion, environment),
      )
      const invitationUrl = new URL('invitations', baseUrl)
      invitationUrl.hash = `token=${encodeURIComponent(token)}`
      const rendered = renderOwnershipInvitationEmail({
        organizationName: delivery.organizationName,
        invitationUrl: invitationUrl.toString(),
        brandAssetUrl: new URL('email/allfit-one-lockup-on-light.png', baseUrl).toString(),
        expiresAt: delivery.expiresAt,
      })
      await dependencies.email.send({
        to: delivery.contact,
        ...rendered,
        idempotencyKey: `ownership-invitation/${message.id}`,
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
