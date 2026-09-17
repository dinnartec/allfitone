/**
 * A person's own sessions: `OP-EXE-004`, `OP-EXE-005`, `OP-EXE-006`, `OP-EXE-014`, `OP-EXE-015`.
 *
 * The vocabularies are repeated here only so a malformed request is answered 422 before it
 * reaches the database. Which person the token belongs to, which contract a session freezes,
 * whether a revision is still current and which family a result belongs to are all decided in
 * PostgreSQL.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type FreeExecutionCreate = AllfitV1Schemas['FreeExecutionCreate']
export type FreeExecutionStarted = AllfitV1Schemas['FreeExecutionStarted']
export type ExecutionResultsReplace = AllfitV1Schemas['ExecutionResultsReplace']
export type ExecutionResultsState = AllfitV1Schemas['ExecutionResultsState']
export type ExecutionFinalized = AllfitV1Schemas['ExecutionFinalized']
export type ExecutionSummary = AllfitV1Schemas['ExecutionSummary']
export type ExecutionDetail = AllfitV1Schemas['ExecutionDetail']
export type CompletenessLevel = AllfitV1Schemas['CompletenessLevel']
export type StrengthSet = AllfitV1Schemas['StrengthSet']
export type EnduranceLap = AllfitV1Schemas['EnduranceLap']

export const COMPLETENESS_LEVELS: readonly CompletenessLevel[] = [
  'partial',
  'summary',
  'detailed',
  'sensor_enriched',
]

export const CAPTURE_SOURCES: readonly string[] = ['manual', 'device']
export const LOAD_UNITS: readonly string[] = ['kg', 'lb']
export const DISTANCE_UNITS: readonly string[] = ['m', 'km', 'mi']

export const MAX_SEGMENTS = 100
export const MAX_RESULTS = 1000
export const MAX_REPETITIONS = 10000
export const MAX_LAP_SECONDS = 604800
export const MAX_EXECUTION_PAGE = 100
export const DEFAULT_EXECUTION_PAGE = 25

export interface ExecutionCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
  requestId: string
}

export interface ExecutionResult<T> {
  resource: T
  replayed: boolean
}

export interface ExecutionHolder {
  issuer: string
  subject: string
}

export interface ExecutionCursor {
  startedAt: string
  id: string
}

export interface ExecutionListInput {
  limit: number
  before?: ExecutionCursor
}

export interface ExecutionPage {
  items: ExecutionSummary[]
  hasMore: boolean
}

interface ExecutionPageRow {
  items: ExecutionSummary[]
  has_more: boolean
}

export interface ExecutionDatabase {
  start(
    input: ExecutionHolder & ExecutionCommand & { sessionId: string; session: FreeExecutionCreate },
  ): Promise<ExecutionResult<FreeExecutionStarted>>
  replaceResults(
    input: ExecutionHolder &
      ExecutionCommand & {
        sessionId: string
        expectedRevision: number
        results: ExecutionResultsReplace
      },
  ): Promise<ExecutionResult<ExecutionResultsState>>
  finalize(
    input: ExecutionHolder &
      ExecutionCommand & { sessionId: string; expectedRevision: number; endedAt: string },
  ): Promise<ExecutionResult<ExecutionFinalized>>
  list(
    input: ExecutionHolder & ExecutionListInput & { requestId: string },
  ): Promise<ExecutionPageRow>
  detail(
    input: ExecutionHolder & { sessionId: string; requestId: string },
  ): Promise<ExecutionDetail>
}
