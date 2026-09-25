/**
 * PostgreSQL access for a person's body measurements.
 *
 * The transaction starts without a person: the functions resolve the token's subject and
 * establish the actor themselves, because the API cannot know who the subject is before
 * the database says so.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  BodyProgressDatabase,
  BodyProgressDeletion,
  BodyProgressPage,
  BodyProgressResult,
} from '../domain/body-progress.js'

const PROVIDER = 'workos'

type CommandRow<T> = { result: T; replayed: boolean }

export function createBodyProgressDatabase(): BodyProgressDatabase {
  const sql = database()

  return {
    list: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const [row] = await transaction<{ list_body_progress: BodyProgressPage }[]>`
          select identity.list_body_progress(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.limit},
            ${input.beforeMeasuredOn ?? null}::date, ${input.beforeId ?? null}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the measurements')
        return row.list_body_progress
      }),

    delete: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow<BodyProgressDeletion>[]>`
          select * from identity.delete_body_progress(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.recordId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'delete the measurement')
      }),
  }
}

function result<T>(rows: CommandRow<T>[], operation: string): BodyProgressResult<T> {
  const [row] = rows
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return { resource: row.result, replayed: row.replayed }
}

function withinRequest<T>(
  sql: ReturnType<typeof database>,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureRequestPhase('business-db', async () => {
    const outcome = await sql.begin(async (transaction) => {
      await transaction`select set_config('app.request_id', ${requestId}, true)`
      return { value: await operation(transaction) }
    })
    return outcome.value
  })
}
