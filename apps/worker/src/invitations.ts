import {
  NotificationDeliveryError,
  createInvitationToken,
  invitationTokenKey,
  renderTeamInvitationEmail,
  type EmailSender,
} from '@allfitone/notifications'
import type { Queue, QueueMessage } from '@allfitone/queue'
import type postgres from 'postgres'

export interface InvitationDelivery {
  state: 'expired' | 'ready' | 'skipped'
  invitationId?: string
  contact?: string
  organizationName?: string
  proposedRoleCode?: 'admin' | 'coach' | 'staff'
  tokenKeyVersion?: number
  expiresAt?: Date
}

export interface InvitationDeliveryDatabase {
  prepare(eventId: string): Promise<InvitationDelivery>
}

export interface InvitationBatchResult {
  claimed: number
  delivered: number
  deadOrDelayed: number
  skipped: number
}

export function createInvitationDeliveryDatabase(sql: postgres.Sql): InvitationDeliveryDatabase {
  return {
    async prepare(eventId) {
      return sql.begin(async (transaction) => {
        await transaction`select set_config('app.actor_kind', 'worker', true)`
        const [row] = await transaction<
          Array<{
            delivery_state: InvitationDelivery['state']
            invitation_id: string | null
            contact: string | null
            organization_name: string | null
            proposed_role_code: 'admin' | 'coach' | 'staff' | null
            token_key_version: number | null
            expires_at: Date | null
          }>
        >`select * from identity.prepare_staff_invitation_delivery(${eventId}::uuid)`
        if (!row) throw new Error('PostgreSQL did not prepare the invitation delivery')
        return {
          state: row.delivery_state,
          ...(row.invitation_id ? { invitationId: row.invitation_id } : {}),
          ...(row.contact ? { contact: row.contact } : {}),
          ...(row.organization_name ? { organizationName: row.organization_name } : {}),
          ...(row.proposed_role_code ? { proposedRoleCode: row.proposed_role_code } : {}),
          ...(row.token_key_version ? { tokenKeyVersion: row.token_key_version } : {}),
          ...(row.expires_at ? { expiresAt: new Date(row.expires_at) } : {}),
        }
      })
    },
  }
}

export function createInvitationBatchProcessor(dependencies: {
  queue: Queue
  database: InvitationDeliveryDatabase
  email: EmailSender
  publicBaseUrl: string
  environment?: NodeJS.ProcessEnv
}) {
  const baseUrl = trustedPublicBaseUrl(dependencies.publicBaseUrl)
  const environment = dependencies.environment ?? process.env

  return async function processInvitationBatch(): Promise<InvitationBatchResult> {
    const messages = await dependencies.queue.claim('organization.staff_invited.v1', 25)
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
        !delivery.proposedRoleCode ||
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
      const invitationUrl = new URL(`invitations/${encodeURIComponent(token)}`, baseUrl).toString()
      const rendered = renderTeamInvitationEmail({
        organizationName: delivery.organizationName,
        proposedRoleCode: delivery.proposedRoleCode,
        invitationUrl,
        expiresAt: delivery.expiresAt,
      })
      await dependencies.email.send({
        to: delivery.contact,
        ...rendered,
        idempotencyKey: `staff-invitation/${message.id}`,
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

function trustedPublicBaseUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('INVITATION_PUBLIC_BASE_URL must be a trusted HTTPS URL')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        const item = items[index]
        if (item !== undefined) output[index] = await mapper(item)
      }
    }),
  )
  return output
}
