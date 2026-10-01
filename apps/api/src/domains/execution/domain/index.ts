/**
 * What a training session is once it has happened.
 *
 * Types come from the contract, as every Space-facing shape does: this is a client of
 * the OpenAPI document, not a second place where a session is defined.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type Execution = AllfitV1Schemas['SpaceExecution']
export type Attempt = AllfitV1Schemas['Attempt']
export type ResultsState = AllfitV1Schemas['ExecutionResultsState']
export type Finalized = AllfitV1Schemas['ExecutionFinalized']
export type Abandoned = AllfitV1Schemas['ExecutionAbandoned']
export type ExecutionResultsReplace = AllfitV1Schemas['ExecutionResultsReplace']
export type WeekSummary = AllfitV1Schemas['SpaceWeekSummary']
export type ExecutionSummary = AllfitV1Schemas['SpaceExecutionSummary']

/** The summary as PostgreSQL holds it: the photograph is still a storage key. */
export type SummaryRow = Omit<ExecutionSummary, 'cover_url'> & { cover_object_key: string | null }

export interface ExecutionCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Buffer
}

export interface ExecutionDatabase {
  startAttempt(
    input: ExecutionCommand & {
      personId: string
      plannedSessionId: string
      startedAt: string
      timezone: string
      requestedLevel: string
      captureSource: string
    },
  ): Promise<Attempt>
  replaceResults(
    input: ExecutionCommand & {
      personId: string
      executedSessionId: string
      revisionNumber: number
      results: ExecutionResultsReplace
    },
  ): Promise<ResultsState>
  finalize(
    input: ExecutionCommand & { personId: string; executedSessionId: string; endedAt: string },
  ): Promise<Finalized>
  abandon(
    input: ExecutionCommand & { personId: string; executedSessionId: string; endedAt: string },
  ): Promise<Abandoned>
  /** Null when it does not exist or is not this person's — the same answer, on purpose. */
  readExecution(input: {
    personId: string
    executedSessionId: string
    requestId: string
  }): Promise<Execution | null>
  readWeekSummary(input: {
    personId: string
    timezone: string
    requestId: string
  }): Promise<WeekSummary>
  /**
   * Null when it does not exist or is not this person's. A session still open is refused
   * by PostgreSQL with SQLSTATE 55000 (ADR-036).
   */
  readSummary(input: {
    personId: string
    executedSessionId: string
    timezone: string
    requestId: string
  }): Promise<SummaryRow | null>
}
