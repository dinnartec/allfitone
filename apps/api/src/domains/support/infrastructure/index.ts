/**
 * PostgreSQL access for platform role and duty administration.
 *
 * The runtime role holds no privilege on `support.platform_role_assignments` or
 * `support.platform_duty_assignments`; it can only execute the four closed
 * commands. There is nothing to hide behind a repository abstraction here — the
 * functions are the contract, and the actor context is transaction-local because
 * a session-scoped setting does not survive the pooler.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  PlatformAccessDatabase,
  PlatformCommandResult,
  PlatformDutyAssignment,
  PlatformRoleAssignment,
} from '../domain/index.js'

type CommandRow<T> = { result: T; replayed: boolean }

export function createPlatformAccessDatabase(): PlatformAccessDatabase {
  const sql = database()

  return {
    grantRole: (input) =>
      command(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow<PlatformRoleAssignment>[]>`
          select * from support.grant_platform_role(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.personId}::uuid, ${input.platformRole},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'grant the platform role')
      }),

    revokeRole: (input) =>
      command(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow<PlatformRoleAssignment>[]>`
          select * from support.revoke_platform_role(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.assignmentId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'revoke the platform role')
      }),

    grantDuty: (input) =>
      command(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow<PlatformDutyAssignment>[]>`
          select * from support.grant_platform_duty(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.personId}::uuid, ${input.dutyCode},
            ${input.validFrom ?? null}::timestamptz, ${input.validTo}::timestamptz,
            ${input.reasonCode},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'grant the platform duty')
      }),

    closeDuty: (input) =>
      command(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow<PlatformDutyAssignment>[]>`
          select * from support.close_platform_duty(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.assignmentId}::uuid, ${input.targetStatus},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'close the platform duty')
      }),
  }
}

function command<T>(
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

function required<T>(row: CommandRow<T> | undefined, operation: string): PlatformCommandResult<T> {
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return { resource: row.result, replayed: row.replayed }
}
