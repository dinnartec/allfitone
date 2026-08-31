/**
 * PostgreSQL access for the execution domain.
 *
 * The runtime role has no privilege on these tables; every call is a closed function,
 * so there is no query here that could widen what a person reads or writes.
 *
 * The four result families arrive as separate arrays, which is the contract's shape,
 * and are flattened into one discriminated list for the command. Keeping them apart in
 * the contract is what lets each carry its own required fields; flattening them here is
 * what lets the command replace a session in one pass.
 *
 * The list travels as `::text::jsonb`, and the `::text` is load-bearing. `postgres.js`
 * infers a parameter's type from the cast that follows it, so a bare `::jsonb` made it
 * serialize the already-serialized string a second time; the command then received the
 * JSON scalar `"[…]"` instead of an array and answered `22023 — cannot extract elements
 * from a scalar`. Casting through text says plainly what is being sent.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type {
  Abandoned,
  Attempt,
  Execution,
  ExecutionDatabase,
  ExecutionResultsReplace,
  Finalized,
  WeekSummary,
} from '../domain/index.js'

interface ExecutionRow {
  executed_session_id: string
  execution_status: Execution['execution_status']
  started_at: Date | string
  revision_number: string | number
  title: string | null
  discipline_code: string | null
  program_title: string | null
  week: number | null
  planned: Execution['planned']
  results: Execution['results']
}

interface AttemptRow {
  id: string
  attempt_number: number
  revision_number: string | number
  result_contract_id: string
  contract_version: number
  requested_level: Attempt['result_contract']['requested_level']
}

interface ResultsRow {
  id: string
  revision_number: string | number
  result_count: string | number
}

interface FinalizedRow {
  id: string
  revision_number: string | number
  achieved_level: Finalized['achieved_level']
  is_primary: boolean
  result_contract_id: string
  contract_version: number
}

interface WeekRow {
  trained_seconds: string | number | null
  sessions_completed: number | null
  latest_weight_value: string | number | null
  latest_weight_unit: string | null
  history: WeekSummary['history']
}

export function createExecutionDatabase(): ExecutionDatabase {
  const sql = database()

  return {
    startAttempt: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<AttemptRow[]>`
          select * from execution.start_planned_session_attempt(
            ${input.personId}::uuid, ${input.plannedSessionId}::uuid,
            ${input.startedAt}::timestamptz, ${input.timezone},
            ${input.requestedLevel}::catalog.completeness_level, ${input.captureSource},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not start the attempt')
        return attempt(row)
      }),

    replaceResults: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<ResultsRow[]>`
          select * from execution.replace_execution_results(
            ${input.personId}::uuid, ${input.executedSessionId}::uuid,
            ${input.revisionNumber}::bigint, ${JSON.stringify(flatten(input.results))}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not replace the results')
        return {
          id: row.id,
          status: 'in_progress',
          revision_number: Number(row.revision_number),
          // Space declares no segmentation, so this counts what is stored and is zero.
          segment_count: 0,
          result_count: Number(row.result_count),
        }
      }),

    finalize: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<FinalizedRow[]>`
          select * from execution.finalize_execution(
            ${input.personId}::uuid, ${input.executedSessionId}::uuid,
            ${input.endedAt}::timestamptz, ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not finalize the execution')
        return finalized(row)
      }),

    abandon: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<ResultsRow[]>`
          select * from execution.abandon_execution(
            ${input.personId}::uuid, ${input.executedSessionId}::uuid,
            ${input.endedAt}::timestamptz, ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not abandon the execution')
        return abandoned(row)
      }),

    readExecution: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<ExecutionRow[]>`
          select * from execution.read_execution(
            ${input.personId}::uuid, ${input.executedSessionId}::uuid
          )
        `
        return row ? execution(row) : null
      }),

    readWeekSummary: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<WeekRow[]>`
          select * from execution.read_week_summary(${input.personId}::uuid, ${input.timezone})
        `
        return week(row)
      }),
  }
}

/** The contract keeps the families apart; the command takes them as one list. */
function flatten(results: ExecutionResultsReplace): Record<string, unknown>[] {
  const strength = (results.strength_sets ?? []).map((entry) => ({
    family: 'strength',
    set_order: entry.order,
    movement_id: entry.movement_id ?? null,
    achieved_reps: entry.achieved_reps ?? null,
    load_value: entry.load?.value ?? null,
    load_unit_code: entry.load?.unit ?? null,
    rpe: entry.rpe ?? null,
  }))
  const endurance = (results.endurance_laps ?? []).map((entry) => ({
    family: 'endurance',
    ...entry,
  }))
  const intervals = (results.interval_results ?? []).map((entry) => ({
    family: 'interval',
    ...entry,
  }))
  const mobility = (results.mobility_results ?? []).map((entry) => ({
    family: 'mobility',
    ...entry,
  }))
  return [...strength, ...endurance, ...intervals, ...mobility]
}

function attempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    attempt_number: row.attempt_number,
    status: 'in_progress',
    revision_number: Number(row.revision_number),
    result_contract: {
      id: row.result_contract_id,
      version: row.contract_version,
      requested_level: row.requested_level,
    },
  }
}

function finalized(row: FinalizedRow): Finalized {
  return {
    id: row.id,
    status: 'completed',
    validation_status: 'valid',
    revision_number: Number(row.revision_number),
    achieved_level: row.achieved_level,
    is_primary: row.is_primary,
    contract: { id: row.result_contract_id, version: row.contract_version },
  }
}

function abandoned(row: ResultsRow): Abandoned {
  return {
    id: row.id,
    status: 'abandoned',
    revision_number: Number(row.revision_number),
    result_count: Number(row.result_count),
  }
}

function execution(row: ExecutionRow): Execution {
  return {
    executed_session_id: row.executed_session_id,
    execution_status: row.execution_status,
    started_at:
      row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
    revision_number: Number(row.revision_number),
    title: row.title,
    discipline_code: row.discipline_code,
    program_title: row.program_title,
    week: row.week === null ? null : Number(row.week),
    planned: row.planned ?? [],
    results: row.results ?? [],
  }
}

function week(row: WeekRow | undefined): WeekSummary {
  if (!row) {
    return { trained_seconds: 0, sessions_completed: 0, latest_weight: null, history: [] }
  }
  return {
    trained_seconds: Number(row.trained_seconds ?? 0),
    sessions_completed: row.sessions_completed ?? 0,
    latest_weight:
      row.latest_weight_value === null || row.latest_weight_unit === null
        ? null
        : {
            value: Number(row.latest_weight_value),
            unit: row.latest_weight_unit,
            original_unit: null,
          },
    history: row.history ?? [],
  }
}

function transact<T>(
  sql: ReturnType<typeof database>,
  personId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureStudioRequestPhase('business-db', async () => {
    const result = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'person', true),
               set_config('app.actor_person_id', ${personId}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return result.value
  })
}
