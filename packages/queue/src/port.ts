/**
 * Queue port.
 *
 * The source of truth for "what still needs publishing" is NOT the queue: it is
 * `system.outbox_events`, a table we own. The queue only transports.
 *
 * That distinction is what allows changing provider without losing an event, and
 * it is why the default adapter is Postgres — the engine we already run, with no
 * third-party primitive to dismantle later.
 */

export interface QueueMessage<T = unknown> {
  /** Identifier of the event in `system.outbox_events`. */
  id: string
  /** Versioned event name, e.g. `identity.contact_changed.v1`. */
  topic: string
  payload: T
  /** Delivery is at-least-once: consumers must be idempotent. */
  attempt: number
}

export interface Queue {
  /**
   * Claims pending messages for processing.
   *
   * Returns a batch and marks it in flight. The consumer confirms with `ack` or
   * returns it with `nack`. The shape is identical whether running as a
   * persistent process or a cron-invoked function — only the caller changes.
   */
  claim(topic: string, limit: number): Promise<QueueMessage[]>
  ack(id: string): Promise<void>
  nack(id: string, reason: string, retryable: boolean): Promise<void>
}
