/**
 * PostgreSQL access for account recovery.
 *
 * Every operation runs as the support actor with the request identifier in transaction
 * scope, so the access record each one writes can be followed back to this request.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  AccountRecoveryDatabase,
  BackofficeAccountRecovery,
  BackofficeAccountRecoveryRequest,
  RecoveryCommandResult,
} from '../domain/account-recovery.js'

type ReadRow = { read_account_recovery: BackofficeAccountRecovery }
type CommandRow = { result: BackofficeAccountRecoveryRequest; replayed: boolean }

export function createAccountRecoveryDatabase(): AccountRecoveryDatabase {
  const sql = database()

  return {
    read: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<ReadRow[]>`
          select identity.read_account_recovery(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.caseReference}, ${input.personId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the account recovery')
        return row.read_account_recovery
      }),

    start: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from identity.start_account_recovery(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.caseReference}, ${input.personId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return commandResult(rows, 'start')
      }),

    resend: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from identity.resend_account_recovery(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.caseReference}, ${input.personId}::uuid, ${input.recoveryId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return commandResult(rows, 'resend')
      }),

    cancel: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from identity.cancel_account_recovery(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.caseReference}, ${input.personId}::uuid, ${input.recoveryId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return commandResult(rows, 'cancel')
      }),
  }
}

function commandResult(rows: CommandRow[], action: string): RecoveryCommandResult {
  const [row] = rows
  if (!row) throw new Error(`PostgreSQL did not ${action} the account recovery`)
  return { resource: row.result, replayed: row.replayed }
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
