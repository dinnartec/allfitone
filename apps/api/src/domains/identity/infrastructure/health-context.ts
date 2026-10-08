/**
 * PostgreSQL access for a person's health context.
 *
 * The transaction starts without a person: the functions resolve the token's subject and
 * establish the actor themselves, because the API cannot know who the subject is before
 * the database says so.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  HealthContextClaim,
  HealthContextDatabase,
  HealthContextDeletion,
  HealthContextPage,
  HealthContextResult,
} from '../domain/health-context.js'

const PROVIDER = 'workos'

type CommandRow<T> = { result: T; replayed: boolean }

export function createHealthContextDatabase(): HealthContextDatabase {
  const sql = database()

  return {
    list: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const [row] = await transaction<{ list_health_context: HealthContextPage }[]>`
          select identity.list_health_context(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.limit},
            ${input.beforeValidFrom ?? null}::timestamptz, ${input.beforeId ?? null}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the health context')
        return row.list_health_context
      }),

    declare: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow<HealthContextClaim>[]>`
          select * from identity.record_health_context(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.claimId}::uuid,
            ${input.claim.context_type}, ${input.claim.description},
            ${input.claim.body_area}::text, ${input.claim.valid_from}::timestamptz,
            ${input.claim.valid_to}::timestamptz, ${input.idempotencyKey}::uuid,
            ${input.requestHash}
          )
        `
        return result(rows, 'declare the claim')
      }),

    delete: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow<HealthContextDeletion>[]>`
          select * from identity.delete_health_context(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.claimId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'delete the claim')
      }),
  }
}

function result<T>(rows: CommandRow<T>[], operation: string): HealthContextResult<T> {
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
