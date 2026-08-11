/**
 * PostgreSQL-backed queue adapter.
 *
 * Claims with `SELECT ... FOR UPDATE SKIP LOCKED`, which is what lets several
 * consumers work in parallel without colliding.
 *
 */

import type postgres from 'postgres'
import type { Queue, QueueMessage } from '../port.js'

export interface PostgresQueueConfig {
  /** How long a message may stay in flight before returning to the queue. */
  visibilityTimeoutMs: number
  /** Attempts before the message is sent for manual review. */
  maxAttempts: number
}

export function createPostgresQueue(sql: postgres.Sql, config: PostgresQueueConfig): Queue {
  if (config.visibilityTimeoutMs !== 120_000 || config.maxAttempts !== 5) {
    throw new Error('Postgres queue configuration must match the governed database policy')
  }
  return {
    async claim(topic: string, limit: number): Promise<QueueMessage[]> {
      return sql.begin(async (transaction) => {
        await setWorkerActor(transaction)
        const rows = await transaction<
          Array<{ id: string; topic: string; payload: unknown; attempt: number }>
        >`
          select * from system.claim_outbox_events(${topic}, ${limit}::integer)
        `
        return rows
      })
    },
    async ack(id: string): Promise<void> {
      await sql.begin(async (transaction) => {
        await setWorkerActor(transaction)
        await transaction`select system.ack_outbox_event(${id}::uuid)`
      })
    },
    async nack(id: string, reason: string, retryable: boolean): Promise<void> {
      await sql.begin(async (transaction) => {
        await setWorkerActor(transaction)
        await transaction`
          select system.nack_outbox_event(${id}::uuid, ${reason}, ${retryable})
        `
      })
    },
  }
}

async function setWorkerActor(transaction: postgres.TransactionSql): Promise<void> {
  await transaction`select set_config('app.actor_kind', 'worker', true)`
}
