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
  BreakGlassDatabase,
  BreakGlassExerciseOutcome,
  BreakGlassRequest,
  BreakGlassReview,
  SupportAttentionDatabase,
  SupportAttentionPanel,
  SupportBusinessDatabase,
  SupportBusinessPanel,
  SupportDeliveryCircuit,
  SupportDiagnosisDatabase,
  SupportOperation,
  SupportMetadataDatabase,
  SupportPersonMetadata,
  SupportPersonPayments,
  PlatformAccessDatabase,
  PlatformCommandResult,
  PlatformDutyAssignment,
  PlatformPage,
  PlatformRoleAssignment,
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
        return page(
          rows,
          input.limit,
          (row) => row.result,
          (row) => ({
            rank: row.cursor_rank,
            grantedAt: row.cursor_granted_at.toISOString(),
            id: row.cursor_id,
          }),
        )
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
        return page(
          rows,
          input.limit,
          (row) => row.result,
          (row) => ({
            rank: row.cursor_rank,
            validTo: row.cursor_valid_to.toISOString(),
            createdAt: row.cursor_created_at.toISOString(),
            id: row.cursor_id,
          }),
        )
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

function page<Row, T, Cursor extends object>(
  rows: Row[],
  limit: number,
  project: (row: Row) => T,
  cursorOf: (row: Row) => Cursor,
): PlatformPage<T> {
  const hasMore = rows.length > limit
  const visible = rows.slice(0, limit)
  const last = visible.at(-1)
  return {
    items: visible.map(project),
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

    payments: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ person_payments: SupportPersonPayments }[]>`
          select support.person_payments(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.caseReference}, ${input.personId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not project what the person pays')
        return row.person_payments
      }),
  }
}

export function createSupportDiagnosisDatabase(): SupportDiagnosisDatabase {
  const sql = database()

  return {
    listOperations: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        // One extra row answers "is there another page" without a second count.
        const rows = await transaction<SupportOperation[]>`
          select * from support.list_operational_events(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.source ?? null}::text, ${input.state ?? null}::text,
            ${input.aggregateId ?? null}::uuid, ${input.limit + 1}::integer,
            ${input.cursor?.occurredAt ?? null}::timestamptz,
            ${input.cursor?.id ?? null}::uuid
          )
        `
        return page(
          rows,
          input.limit,
          (row) => row,
          (row) => ({
            occurredAt: new Date(row.occurred_at).toISOString(),
            id: row.reference_id,
          }),
        )
      }),

    listDeliveryCircuits: (input) =>
      inTransaction(
        sql,
        input.actorPersonId,
        input.requestId,
        (transaction) =>
          transaction<SupportDeliveryCircuit[]>`
          select * from support.list_delivery_circuits(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid
          )
        `,
      ),
  }
}

export function createSupportAttentionDatabase(): SupportAttentionDatabase {
  const sql = database()

  return {
    read: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ read_attention_panel: SupportAttentionPanel }[]>`
          select support.read_attention_panel(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the attention panel')
        return row.read_attention_panel
      }),
  }
}

export function createSupportBusinessDatabase(): SupportBusinessDatabase {
  const sql = database()

  return {
    read: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ read_business_panel: SupportBusinessPanel }[]>`
          select support.read_business_panel(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the business panel')
        return row.read_business_panel
      }),
  }
}

type BreakGlassRow = { result: BreakGlassRequest; replayed: boolean }
type BreakGlassReviewRow = { result: BreakGlassReview; replayed: boolean }

export function createBreakGlassDatabase(): BreakGlassDatabase {
  const sql = database()

  return {
    request: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<BreakGlassRow[]>`
          select * from support.request_break_glass(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.publication.subject_person_id}::uuid,
            ${input.publication.categories}::text[],
            ${input.publication.purpose}, ${input.publication.case_reference},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not open the break-glass file')
        return { resource: row.result, replayed: row.replayed }
      }),

    decide: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<BreakGlassRow[]>`
          select * from support.decide_break_glass(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.breakGlassRequestId}::uuid,
            ${input.decision}, ${input.reasonCode},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not record the break-glass decision')
        return { resource: row.result, replayed: row.replayed }
      }),

    // Resolves on a denial: the evidence of the attempt is already written, and
    // throwing here would discard the outcome the caller has to be told.
    exercise: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestTraceId, async (transaction) => {
        const [row] = await transaction<{ exercise_break_glass: BreakGlassExerciseOutcome }[]>`
          select support.exercise_break_glass(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.breakGlassRequestId}::uuid, ${input.category},
            ${input.resourceType}, ${input.resourceId ?? null}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not record the break-glass attempt')
        return row.exercise_break_glass
      }),

    close: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<BreakGlassRow[]>`
          select * from support.close_break_glass(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.breakGlassRequestId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not close the break-glass window')
        return { resource: row.result, replayed: row.replayed }
      }),

    review: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<BreakGlassReviewRow[]>`
          select * from support.review_break_glass(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.breakGlassRequestId}::uuid, ${input.outcome},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not record the break-glass review')
        return { resource: row.result, replayed: row.replayed }
      }),

    reviewQueue: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<{ result: BreakGlassReview }[]>`
          select * from support.break_glass_review_queue(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.limit}::integer
          )
        `
        return rows.map((row) => row.result)
      }),

    list: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<{ result: BreakGlassRequest }[]>`
          select * from support.list_break_glass_requests(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.mine}, ${input.status ?? null}::text, ${input.limit}::integer
          )
        `
        return rows.map((row) => row.result)
      }),
  }
}
