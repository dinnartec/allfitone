/**
 * What a training session is once it has happened.
 *
 * Types come from the contract, as every Space-facing shape does: this is a client of
 * the OpenAPI document, not a second place where a session is defined.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type Execution = AllfitV1Schemas['SpaceExecution']
export type Attempt = AllfitV1Schemas['Attempt']
export type FreeSession = AllfitV1Schemas['FreeSession']
export type ResultsState = AllfitV1Schemas['ExecutionResultsState']
export type Finalized = AllfitV1Schemas['ExecutionFinalized']
export type Abandoned = AllfitV1Schemas['ExecutionAbandoned']
export type ExecutionResultsReplace = AllfitV1Schemas['ExecutionResultsReplace']
export type WeekSummary = AllfitV1Schemas['SpaceWeekSummary']
export type ExecutionSummary = AllfitV1Schemas['SpaceExecutionSummary']
export type FinishedExecution = AllfitV1Schemas['SpaceFinishedExecution']
export type ExecutionRevision = AllfitV1Schemas['ExecutionRevision']
export type Revised = AllfitV1Schemas['ExecutionRevised']
export type Invalidated = AllfitV1Schemas['ExecutionInvalidated']
export type InvalidationPreview = AllfitV1Schemas['SpaceInvalidationPreview']
export type Repeated = AllfitV1Schemas['ExecutionRepeated']

/** The summary as PostgreSQL holds it: the photograph is still a storage key. */
export type SummaryRow = Omit<ExecutionSummary, 'cover_url'> & { cover_object_key: string | null }
export type HistoryItem = AllfitV1Schemas['SpaceHistoryItem']
export type HistoryPage = AllfitV1Schemas['SpaceHistoryPage']
export type HistoryMonth = AllfitV1Schemas['SpaceHistoryMonth']
export type PeriodComparison = AllfitV1Schemas['SpacePeriodComparison']
/** A history row as PostgreSQL answers it: the thumbnail's key, never its address. */
export type HistoryRow = Omit<HistoryItem, 'thumbnail_url'> & {
  thumbnail_object_key: string | null
}
export interface HistoryRowPage {
  readonly data: readonly HistoryRow[]
  readonly window: HistoryPage['window']
  readonly page: HistoryPage['page']
}
export interface HistoryQuery {
  personId: string
  timezone: string
  /** Any day of the month, in the person's zone; null for every month. */
  month: string | null
  discipline: string | null
  withRecord: boolean | null
  free: boolean | null
  query: string | null
  cursor: string | null
  limit: number
  /** A day picked on the month's calendar; null for the whole month. */
  day: string | null
  requestId: string
}

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
  /** A session with no planned session behind it; one is open at a time (55006 otherwise). */
  startFreeSession(
    input: ExecutionCommand & {
      personId: string
      disciplineCode: string
      startedAt: string
      timezone: string
      requestedLevel: string
      captureSource: string
    },
  ): Promise<FreeSession>
  readOpenFreeSession(input: { personId: string; requestId: string }): Promise<string | null>
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
  /** `OP-EXE-014`. A malformed cursor is refused by PostgreSQL with SQLSTATE 22023. */
  listHistory(input: HistoryQuery): Promise<HistoryRowPage>
  /** `OP-EXE-023`. Null when annulled, unfinished, absent or another person's. */
  readFinished(input: {
    personId: string
    executedSessionId: string
    timezone: string
    requestId: string
  }): Promise<FinishedExecution | null>
  /** `OP-EXE-007`. A stale revision is refused with SQLSTATE 40001. */
  revise(
    input: ExecutionCommand & {
      personId: string
      executedSessionId: string
      revisionNumber: number
      revision: ExecutionRevision
    },
  ): Promise<Revised>
  /** `OP-EXE-009`. Null reason is recorded as PostgreSQL's default. */
  annul(
    input: ExecutionCommand & {
      personId: string
      executedSessionId: string
      reason: string | null
    },
  ): Promise<Invalidated>
  /** `OP-EXE-024`. Null when the session cannot be annulled. */
  readAnnulmentPreview(input: {
    personId: string
    executedSessionId: string
    timezone: string
    requestId: string
  }): Promise<InvalidationPreview | null>
  /** `OP-EXE-025`. Another session open is refused with SQLSTATE 55006. */
  repeat(
    input: ExecutionCommand & {
      personId: string
      executedSessionId: string
      startedAt: string
      timezone: string
    },
  ): Promise<Repeated>
  /** `OP-EXE-022`. A month with nothing in it answers zeros, never null. */
  readHistoryMonth(input: {
    personId: string
    timezone: string
    month: string
    requestId: string
  }): Promise<HistoryMonth>
  /** `OP-EXE-026`. Pro: the database refuses with AF402 when the plan does not open it. */
  comparePeriods(input: {
    personId: string
    timezone: string
    period: PeriodComparison['period']
    count: number
    /** An assignment id, `free`, or null for everything. */
    program: string | null
    requestId: string
  }): Promise<PeriodComparison>
}
