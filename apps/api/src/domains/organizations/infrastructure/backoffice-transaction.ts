/**
 * The transaction every Backoffice organization call runs in.
 *
 * The actor is set transaction-locally, which is also what survives the pooler in
 * transaction mode. Nothing is authorised here: each closed function checks the duty
 * and the session inside this same transaction.
 */

import type postgres from 'postgres'

import type { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'

export function inBackofficeTransaction<T>(
  sql: ReturnType<typeof database>,
  actorPersonId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureRequestPhase('business-db', async () => {
    const result = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'support', true),
               set_config('app.actor_person_id', ${actorPersonId}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return result.value
  })
}
