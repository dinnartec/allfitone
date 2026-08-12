import type { BackofficeAuthMaintenance } from '@allfitone/auth-provider'
import type { Queue, QueueMessage } from '@allfitone/queue'
import type postgres from 'postgres'

const TOPICS = [
  'identity.backoffice_auth_cleanup_requested.v1',
  'identity.backoffice_session_revocation_requested.v1',
  'identity.backoffice_factor_cleanup_requested.v1',
] as const

export interface BackofficeAuthCleanup {
  state: 'ready' | 'skipped'
  providerSessionId?: string
  providerFactorId?: string
}

export interface BackofficeAuthCleanupDatabase {
  expire(limit: number): Promise<number>
  prepare(eventId: string): Promise<BackofficeAuthCleanup>
}

export interface BackofficeAuthBatchResult {
  expired: number
  claimed: number
  completed: number
  deadOrDelayed: number
  skipped: number
}

export function createBackofficeAuthCleanupDatabase(
  sql: postgres.Sql,
): BackofficeAuthCleanupDatabase {
  return {
    async expire(limit) {
      return sql.begin(async (transaction) => {
        await transaction`select set_config('app.actor_kind', 'worker', true)`
        const [row] = await transaction<Array<{ expired_count: number }>>`
          select identity.expire_backoffice_authentication_attempts(${limit}::integer) as expired_count
        `
        if (!row) throw new Error('PostgreSQL did not expire Backoffice attempts')
        return row.expired_count
      })
    },
    async prepare(eventId) {
      return sql.begin(async (transaction) => {
        await transaction`select set_config('app.actor_kind', 'worker', true)`
        const [row] = await transaction<
          Array<{
            cleanup_state: 'ready' | 'skipped'
            provider_session_id: string | null
            provider_factor_id: string | null
          }>
        >`select * from identity.prepare_backoffice_auth_cleanup(${eventId}::uuid)`
        if (!row) return { state: 'skipped' }
        return {
          state: row.cleanup_state,
          ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
          ...(row.provider_factor_id ? { providerFactorId: row.provider_factor_id } : {}),
        }
      })
    },
  }
}

export function createBackofficeAuthBatchProcessor(dependencies: {
  queue: Queue
  database: BackofficeAuthCleanupDatabase
  provider: BackofficeAuthMaintenance
}) {
  return async function processBackofficeAuthBatch(): Promise<BackofficeAuthBatchResult> {
    const expired = await dependencies.database.expire(100)
    const batches = await Promise.all(TOPICS.map((topic) => dependencies.queue.claim(topic, 25)))
    const messages = batches.flat()
    const outcomes = await mapWithConcurrency(messages, 5, cleanup)
    const result = {
      expired,
      claimed: messages.length,
      completed: outcomes.filter((outcome) => outcome === 'completed').length,
      deadOrDelayed: outcomes.filter((outcome) => outcome === 'failed').length,
      skipped: outcomes.filter((outcome) => outcome === 'skipped').length,
    }
    recordCounter('expiration', result.expired, 'completed')
    recordCounter('cleanup', result.completed, 'completed')
    recordCounter('cleanup', result.deadOrDelayed, 'retrying')
    return result
  }

  async function cleanup(message: QueueMessage): Promise<'completed' | 'failed' | 'skipped'> {
    try {
      const target = await dependencies.database.prepare(message.id)
      if (target.state === 'skipped') {
        await dependencies.queue.ack(message.id)
        return 'skipped'
      }
      if (target.providerSessionId) {
        await dependencies.provider.revokeSession(target.providerSessionId)
      }
      if (target.providerFactorId) {
        await dependencies.provider.deleteAuthenticationFactor(target.providerFactorId)
      }
      await dependencies.queue.ack(message.id)
      return 'completed'
    } catch {
      await dependencies.queue.nack(message.id, 'backoffice_auth_cleanup_failed', true)
      return 'failed'
    }
  }
}

function recordCounter(
  operation: 'cleanup' | 'expiration',
  value: number,
  outcome: 'completed' | 'retrying',
): void {
  console.info(
    JSON.stringify({
      kind: 'counter',
      name: `worker.backoffice_auth.${operation}`,
      value,
      dimensions: { outcome },
    }),
  )
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
