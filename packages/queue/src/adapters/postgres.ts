/**
 * PostgreSQL-backed queue adapter.
 *
 * Claims with `SELECT ... FOR UPDATE SKIP LOCKED`, which is what lets several
 * consumers work in parallel without colliding.
 *
 * STATUS: skeleton. Implemented once `system.outbox_events` exists in
 * packages/db. The port shape is already settled.
 */

import type { Queue, QueueMessage } from '../port.js'

export interface PostgresQueueConfig {
  /** How long a message may stay in flight before returning to the queue. */
  visibilityTimeoutMs: number
  /** Attempts before the message is sent for manual review. */
  maxAttempts: number
}

export function createPostgresQueue(_config: PostgresQueueConfig): Queue {
  const pending = (method: string): never => {
    throw new Error(`postgresQueue.${method} not implemented: requires system.outbox_events`)
  }

  return {
    async publish(_topic: string, _payload: unknown): Promise<void> {
      return pending('publish')
    },
    async claim(_topic: string, _limit: number): Promise<QueueMessage[]> {
      return pending('claim')
    },
    async ack(_id: string): Promise<void> {
      return pending('ack')
    },
    async nack(_id: string, _reason: string): Promise<void> {
      return pending('nack')
    },
  }
}
