/**
 * Delivery of the account recovery support starts (`HU-BO-010`).
 *
 * The identity provider sends the email and owns the link; this job only asks for it, for
 * the address PostgreSQL hands over, and records when the link expires. The address goes
 * no further than the provider call, and the link and its token never reach this job.
 *
 * Delivery is at least once. If recording fails after the provider accepted the request,
 * the retry asks again and the person receives a second, equally valid email: the only
 * alternative is losing the record that an email left.
 *
 * An address the provider refuses fails the recovery at once. An outage retries, and on
 * the last attempt fails the recovery too, so support never watches a recovery that says
 * it has not gone out yet long after it stopped trying.
 */

import { AuthError, type AccountRecoveryDelivery } from '@allfitone/auth-provider'
import type { Queue, QueueMessage } from '@allfitone/queue'
import type postgres from 'postgres'

import { mapWithConcurrency } from './invitations.js'

export const ACCOUNT_RECOVERY_TOPIC = 'identity.account_recovery_requested.v1'

// The governed queue dead-letters a message on its fifth attempt.
const LAST_ATTEMPT = 5

export interface AccountRecoveryTarget {
  state: 'ready' | 'skipped'
  contact?: string
}

export interface AccountRecoveryDeliveryDatabase {
  prepare(eventId: string): Promise<AccountRecoveryTarget>
  record(eventId: string, expiresAt: string): Promise<void>
  fail(eventId: string): Promise<void>
}

export interface AccountRecoveryBatchResult {
  claimed: number
  delivered: number
  deadOrDelayed: number
  skipped: number
}

export function createAccountRecoveryDeliveryDatabase(
  sql: postgres.Sql,
): AccountRecoveryDeliveryDatabase {
  return {
    prepare: (eventId) =>
      asWorker(sql, async (transaction) => {
        const [row] = await transaction<
          Array<{ delivery_state: AccountRecoveryTarget['state']; contact: string | null }>
        >`select delivery_state, contact from identity.prepare_account_recovery_delivery(${eventId}::uuid)`
        if (!row) throw new Error('PostgreSQL did not prepare the account recovery delivery')
        return { state: row.delivery_state, ...(row.contact ? { contact: row.contact } : {}) }
      }),
    record: (eventId, expiresAt) =>
      asWorker(sql, async (transaction) => {
        await transaction`
          select identity.record_account_recovery_delivery(${eventId}::uuid, ${expiresAt}::timestamptz)
        `
      }),
    fail: (eventId) =>
      asWorker(sql, async (transaction) => {
        await transaction`select identity.fail_account_recovery_delivery(${eventId}::uuid)`
      }),
  }
}

export function createAccountRecoveryBatchProcessor(dependencies: {
  queue: Queue
  database: AccountRecoveryDeliveryDatabase
  provider: AccountRecoveryDelivery
  deliveryEnabled?: boolean
}) {
  return async function processAccountRecoveryBatch(): Promise<AccountRecoveryBatchResult> {
    if (dependencies.deliveryEnabled === false) {
      return { claimed: 0, delivered: 0, deadOrDelayed: 0, skipped: 0 }
    }
    const messages = await dependencies.queue.claim(ACCOUNT_RECOVERY_TOPIC, 25)
    const outcomes = await mapWithConcurrency(messages, 5, deliver)
    return {
      claimed: messages.length,
      delivered: outcomes.filter((outcome) => outcome === 'delivered').length,
      deadOrDelayed: outcomes.filter((outcome) => outcome === 'failed').length,
      skipped: outcomes.filter((outcome) => outcome === 'skipped').length,
    }
  }

  async function deliver(message: QueueMessage): Promise<'delivered' | 'failed' | 'skipped'> {
    try {
      const target = await dependencies.database.prepare(message.id)
      if (target.state === 'skipped') {
        await dependencies.queue.ack(message.id)
        return 'skipped'
      }
      if (!target.contact) {
        await dependencies.queue.nack(message.id, 'invalid_delivery_projection', false)
        return 'failed'
      }

      let expiresAt: string
      try {
        ;({ expiresAt } = await dependencies.provider.sendRecovery(target.contact))
      } catch (error) {
        const retryable = !(error instanceof AuthError) || error.retryable
        if (retryable && message.attempt < LAST_ATTEMPT) {
          await dependencies.queue.nack(message.id, 'account_recovery_unavailable', true)
          return 'failed'
        }
        await dependencies.database.fail(message.id)
        await dependencies.queue.nack(
          message.id,
          retryable ? 'account_recovery_unavailable' : 'account_recovery_rejected',
          false,
        )
        return 'failed'
      }

      await dependencies.database.record(message.id, expiresAt)
      await dependencies.queue.ack(message.id)
      return 'delivered'
    } catch {
      await dependencies.queue.nack(message.id, 'worker_error', true)
      return 'failed'
    }
  }
}

async function asWorker<T>(
  sql: postgres.Sql,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (transaction) => {
    await transaction`select set_config('app.actor_kind', 'worker', true)`
    return { value: await operation(transaction) }
  })
  return result.value
}
