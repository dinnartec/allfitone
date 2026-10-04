/**
 * Delivery of the client invitation a gym issues (`OP-REL-001`) and the one support
 * resends from Backoffice (`OP-IDN-051`).
 *
 * `relationship.client_invited.v1` had no consumer at all. The email was the visible
 * half of that; the other half was `support.list_operational_events` reporting every
 * client invitation ever issued as "sin enviar todavía", for good, because an
 * unclaimed event has no publication and no attempts.
 *
 * **The link is its own page, not the team one.** `/invitations` in Studio decides a
 * team invitation; a client invitation is resolved and decided through `/space/v1`, by
 * the person. Pointing this at the team page would hand someone a screen that cannot
 * answer their invitation, so it carries its own base URL and its own path.
 *
 * **Nothing about the offer travels.** The projection does not read it and this does
 * not ask: what the gym wants to see is shown behind the link, to someone holding the
 * token and signed in.
 *
 * Expiry is not repeated here, for the same reason as the ownership batch: the team
 * batch already expires every pending invitation whose moment has passed.
 */

import {
  NotificationDeliveryError,
  createInvitationToken,
  invitationTokenKey,
  renderClientInvitationEmail,
  type EmailSender,
} from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'
import type postgres from 'postgres'

import { mapWithConcurrency, trustedPublicBaseUrl } from './invitations.js'

export interface ClientInvitationDelivery {
  state: 'expired' | 'ready' | 'skipped'
  invitationId?: string
  contact?: string
  organizationName?: string
  tokenKeyVersion?: number
  expiresAt?: Date
}

export interface ClientInvitationDeliveryDatabase {
  prepare(eventId: string): Promise<ClientInvitationDelivery>
}

export interface ClientInvitationBatchResult {
  claimed: number
  delivered: number
  deadOrDelayed: number
  skipped: number
}

export function createClientInvitationDeliveryDatabase(
  sql: postgres.Sql,
): ClientInvitationDeliveryDatabase {
  return {
    async prepare(eventId) {
      return sql.begin(async (transaction) => {
        await transaction`select set_config('app.actor_kind', 'worker', true)`
        const [row] = await transaction<
          Array<{
            delivery_state: ClientInvitationDelivery['state']
            invitation_id: string | null
            contact: string | null
            organization_name: string | null
            token_key_version: number | null
            expires_at: Date | null
          }>
        >`select * from identity.prepare_client_invitation_delivery(${eventId}::uuid)`
        if (!row) throw new Error('PostgreSQL did not prepare the client invitation delivery')
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

export function createClientInvitationBatchProcessor(dependencies: {
  queue: Queue
  database: ClientInvitationDeliveryDatabase
  email: EmailSender
  publicBaseUrl: string
  environment?: NodeJS.ProcessEnv
  deliveryEnabled?: boolean
}) {
  const environment = dependencies.environment ?? process.env
  const baseUrl = trustedPublicBaseUrl(dependencies.publicBaseUrl, environment)

  return async function processClientInvitationBatch(): Promise<ClientInvitationBatchResult> {
    if (dependencies.deliveryEnabled === false) {
      return { claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 }
    }
    const messages = await dependencies.queue.claim('relationship.client_invited.v1', 25)
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
      const invitationUrl = new URL('client-invitations', baseUrl)
      invitationUrl.hash = `token=${encodeURIComponent(token)}`
      const rendered = renderClientInvitationEmail({
        organizationName: delivery.organizationName,
        invitationUrl: invitationUrl.toString(),
        brandAssetUrl: new URL('email/allfit-one-lockup-on-light.png', baseUrl).toString(),
        expiresAt: delivery.expiresAt,
      })
      await dependencies.email.send({
        to: delivery.contact,
        ...rendered,
        idempotencyKey: `client-invitation/${message.id}`,
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
