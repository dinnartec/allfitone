/**
 * PostgreSQL access for scope publication.
 *
 * Curation runs as the support actor: the insert policies on the privacy tables
 * require it, so a transaction that forgot the ritual writes nothing rather than
 * writing as somebody else.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  ScopeCommandResult,
  ScopeDefinition,
  ScopeDefinitionDatabase,
} from '../domain/index.js'

type CommandRow = { result: ScopeDefinition; replayed: boolean }

export function createScopeDefinitionDatabase(): ScopeDefinitionDatabase {
  const sql = database()

  return {
    publish: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from privacy.publish_scope_definition(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.publication.scope_code},
            ${JSON.stringify(input.publication.rules)}::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not publish the scope definition')
        return { resource: row.result, replayed: row.replayed } satisfies ScopeCommandResult
      }),

    list: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<{ result: ScopeDefinition }[]>`
          select * from privacy.list_scope_definitions(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid
          )
        `
        return rows.map((row) => row.result)
      }),
  }
}

function inTransaction<T>(
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
