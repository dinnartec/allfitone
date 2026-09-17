/**
 * PostgreSQL access for a person's own sessions.
 *
 * The transaction starts without a person: the functions resolve the token's subject and
 * establish the actor themselves, because the API cannot know who the subject is before the
 * database says so.
 *
 * The working set travels as JSON documents cast through `text`: a string cast straight to
 * `jsonb` is serialized again by the driver and arrives as a JSON string.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  ExecutionDatabase,
  ExecutionDetail,
  ExecutionFinalized,
  ExecutionResult,
  ExecutionResultsState,
  ExecutionSummary,
  FreeExecutionStarted,
} from '../domain/sessions.js'

const PROVIDER = 'workos'

type CommandRow<T> = { result: T; replayed: boolean }

export function createExecutionDatabase(): ExecutionDatabase {
  const sql = database()

  return {
    start: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow<FreeExecutionStarted>[]>`
          select * from execution.start_session(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.sessionId}::uuid,
            ${input.session.activity_type_code}, ${input.session.started_at}::timestamptz,
            ${String(input.session.timezone)}, ${input.session.requested_level},
            ${input.session.capture_source}, ${input.idempotencyKey}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'start the session')
      }),

    replaceResults: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow<ExecutionResultsState>[]>`
          select * from execution.replace_session_results(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.sessionId}::uuid,
            ${input.expectedRevision}::bigint,
            ${JSON.stringify(input.results.segments)}::text::jsonb,
            ${JSON.stringify(input.results.strength_sets ?? [])}::text::jsonb,
            ${JSON.stringify(input.results.endurance_laps ?? [])}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'replace the results')
      }),

    finalize: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow<ExecutionFinalized>[]>`
          select * from execution.finalize_session(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.sessionId}::uuid,
            ${input.expectedRevision}::bigint, ${input.endedAt}::timestamptz,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'finish the session')
      }),

    list: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const [row] = await transaction<
          { list_sessions: { items: ExecutionSummary[]; has_more: boolean } }[]
        >`
          select execution.list_sessions(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.limit},
            ${input.before?.startedAt ?? null}::timestamptz, ${input.before?.id ?? null}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the sessions')
        return row.list_sessions
      }),

    detail: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const [row] = await transaction<{ session_detail: ExecutionDetail }[]>`
          select execution.session_detail(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.sessionId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the session')
        return row.session_detail
      }),
  }
}

function result<T>(rows: CommandRow<T>[], operation: string): ExecutionResult<T> {
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
