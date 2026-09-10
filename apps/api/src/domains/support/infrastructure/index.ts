/**
 * PostgreSQL access for platform role and duty administration.
 *
 * The runtime role holds no privilege on `support.platform_role_assignments` or
 * `support.platform_duty_assignments`; it can only execute the five closed
 * commands and the two inventory queries. There is nothing to hide behind a
 * repository abstraction here — the functions are the contract, and the actor
 * context is transaction-local because a session-scoped setting does not survive
 * the pooler.
 *
 * Reads open a transaction for the same reason writes do: the duty has to be
 * resolved against the tables in the same transaction that returns the rows.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  SupportMetadataDatabase,
  SupportPersonMetadata,
  PlatformAccessDatabase,
  PlatformCommandResult,
  PlatformDutyAssignment,
  PlatformDutyCursor,
  PlatformPage,
  PlatformRoleAssignment,
  PlatformRoleCursor,
} from '../domain/index.js'

type CommandRow<T> = { result: T; replayed: boolean }
type RoleRow = {
  result: PlatformRoleAssignment
  cursor_rank: number
  cursor_granted_at: Date
  cursor_id: string
}
type DutyRow = {
  result: PlatformDutyAssignment
  cursor_rank: number
  cursor_valid_to: Date
  cursor_created_at: Date
  cursor_id: string
}

export function createPlatformAccessDatabase(): PlatformAccessDatabase {
  const sql = database()

  return {
    grantRole: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow<PlatformRoleAssignment>[]>`
          select * from support.assign_platform_role(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.personId}::uuid, ${input.platformRole},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'grant the platform role')
      }),

    revokeRole: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
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
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow<PlatformDutyAssignment>[]>`
          select * from support.assign_platform_duty(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.personId}::uuid, ${input.dutyCode},
            ${input.validFrom ?? null}::timestamptz, ${input.validTo}::timestamptz,
            ${input.reasonCode},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'grant the platform duty')
      }),

    suspendDuty: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow<PlatformDutyAssignment>[]>`
          select * from support.suspend_platform_duty(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.assignmentId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'suspend the platform duty')
      }),

    revokeDuty: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow<PlatformDutyAssignment>[]>`
          select * from support.revoke_platform_duty(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.assignmentId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'revoke the platform duty')
      }),

    listRoles: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        // One extra row answers "is there another page" without a second count.
        const rows = await transaction<RoleRow[]>`
          select * from support.list_platform_role_assignments(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.limit + 1}::integer,
            ${input.cursor?.rank ?? null}::integer,
            ${input.cursor?.grantedAt ?? null}::timestamptz,
            ${input.cursor?.id ?? null}::uuid
          )
        `
        return page(rows, input.limit, (row) => ({
          rank: row.cursor_rank,
          grantedAt: row.cursor_granted_at.toISOString(),
          id: row.cursor_id,
        }))
      }),

    listDuties: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<DutyRow[]>`
          select * from support.list_platform_duty_assignments(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.personId ?? null}::uuid, ${input.dutyCode ?? null}::text,
            ${input.status ?? null}::text, ${input.limit + 1}::integer,
            ${input.cursor?.rank ?? null}::integer,
            ${input.cursor?.validTo ?? null}::timestamptz,
            ${input.cursor?.createdAt ?? null}::timestamptz,
            ${input.cursor?.id ?? null}::uuid
          )
        `
        return page(rows, input.limit, (row) => ({
          rank: row.cursor_rank,
          validTo: row.cursor_valid_to.toISOString(),
          createdAt: row.cursor_created_at.toISOString(),
          id: row.cursor_id,
        }))
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

function page<Row extends { result: T }, T, Cursor extends PlatformRoleCursor | PlatformDutyCursor>(
  rows: Row[],
  limit: number,
  cursorOf: (row: Row) => Cursor,
): PlatformPage<T> {
  const hasMore = rows.length > limit
  const visible = rows.slice(0, limit)
  const last = visible.at(-1)
  return {
    items: visible.map((row) => row.result),
    hasMore,
    ...(hasMore && last
      ? { nextCursor: Buffer.from(JSON.stringify(cursorOf(last))).toString('base64url') }
      : {}),
  }
}

function required<T>(row: CommandRow<T> | undefined, operation: string): PlatformCommandResult<T> {
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return { resource: row.result, replayed: row.replayed }
}

/**
 * Both reads run as the support actor with the request identifier in transaction
 * scope, so the access record the database writes carries the same request the
 * client saw.
 */
export function createSupportMetadataDatabase(): SupportMetadataDatabase {
  const sql = database()

  return {
    search: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<{ result: SupportPersonMetadata }[]>`
          select * from support.search_people(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.caseReference}, ${input.lookupKind}, ${input.lookupValue}
          )
        `
        return rows[0]?.result
      }),

    read: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ person_metadata: SupportPersonMetadata }[]>`
          select support.person_metadata(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.caseReference}, ${input.personId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not project the operational state')
        return row.person_metadata
      }),
  }
}
