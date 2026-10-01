/**
 * Training that is happening, and the day it belongs to.
 *
 * Same split as the rest of the client: this holds what must be true and stays
 * loadable by the test runner; `execution-transport.ts` holds the fetch.
 *
 * Two things must be true here and neither is obvious.
 *
 * **The key for starting is held per planned session and never renewed.** A retry
 * over a dropped connection has to answer the session that was already started, not
 * open a second one against the same day — and unlike a program choice, a second
 * training session is not something a person can undo.
 *
 * **Saving carries the revision it believes it is editing.** The server refuses a
 * stale one, so two phones cannot both win, and the flow keeps the number the server
 * last answered rather than counting locally.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { CommandHeaders } from '@allfitone/contracts/commands'

import type { HistoryFilters, HistoryMonth, HistoryPage } from './history'

export type Today = AllfitV1Schemas['SpaceToday']
export type TodaySession = AllfitV1Schemas['SpaceTodaySession']
export type WeekSummary = AllfitV1Schemas['SpaceWeekSummary']
export type Execution = AllfitV1Schemas['SpaceExecution']
export type ExecutionResults = AllfitV1Schemas['ExecutionResultsReplace']
export type Attempt = AllfitV1Schemas['Attempt']
export type ResultsState = AllfitV1Schemas['ExecutionResultsState']
export type Finalized = AllfitV1Schemas['ExecutionFinalized']
export type Abandoned = AllfitV1Schemas['ExecutionAbandoned']
export type ExecutionSummary = AllfitV1Schemas['SpaceExecutionSummary']

export interface ExecutionTransport {
  readToday(timezone: string): Promise<Today>
  readExecution(executedSessionId: string): Promise<Execution>
  readSummary(executedSessionId: string, timezone: string): Promise<ExecutionSummary>
  listHistory(filters: HistoryFilters): Promise<HistoryPage>
  readHistoryMonth(month: string, timezone: string): Promise<HistoryMonth>
  startAttempt(
    command: CommandHeaders,
    plannedSessionId: string,
    start: {
      started_at: string
      timezone: string
      requested_level: string
      capture_source: string
    },
  ): Promise<Attempt>
  saveResults(
    command: CommandHeaders,
    executedSessionId: string,
    revisionNumber: number,
    results: ExecutionResults,
  ): Promise<ResultsState>
  finish(command: CommandHeaders, executedSessionId: string, endedAt: string): Promise<Finalized>
  abandon(command: CommandHeaders, executedSessionId: string, endedAt: string): Promise<Abandoned>
}

export interface ExecutionFlowDependencies {
  transport: ExecutionTransport
  newCommand: () => CommandHeaders
}

export interface ExecutionFlow {
  readToday(timezone: string): Promise<Today>
  readExecution(executedSessionId: string): Promise<Execution>
  /** What «Compártelo» says about a finished session, its weeks in the device's zone. */
  readSummary(executedSessionId: string, timezone: string): Promise<ExecutionSummary>
  /** One page of the finished sessions, newest first (`OP-EXE-014`). */
  listHistory(filters: HistoryFilters): Promise<HistoryPage>
  /** One month's totals and weeks (`OP-EXE-022`), its dates in the device's zone. */
  readHistoryMonth(month: string, timezone: string): Promise<HistoryMonth>
  start(plannedSessionId: string, timezone: string): Promise<string>
  save(
    executedSessionId: string,
    revisionNumber: number,
    results: ExecutionResults,
  ): Promise<number>
  finish(executedSessionId: string): Promise<void>
  /** Leaves the session without finishing it. What was recorded stays. */
  abandon(executedSessionId: string): Promise<void>
}

export function createExecutionFlow(dependencies: ExecutionFlowDependencies): ExecutionFlow {
  // Per planned session, and never renewed: a retry must answer the session already
  // started rather than open a second one against the same day.
  const starting = new Map<string, CommandHeaders>()

  return {
    readToday: (timezone) => dependencies.transport.readToday(timezone),
    readExecution: (id) => dependencies.transport.readExecution(id),
    readSummary: (id, timezone) => dependencies.transport.readSummary(id, timezone),
    listHistory: (filters) => dependencies.transport.listHistory(filters),
    readHistoryMonth: (month, timezone) => dependencies.transport.readHistoryMonth(month, timezone),

    async start(plannedSessionId, timezone) {
      let command = starting.get(plannedSessionId)
      if (!command) {
        command = dependencies.newCommand()
        starting.set(plannedSessionId, command)
      }
      const started = await dependencies.transport.startAttempt(command, plannedSessionId, {
        // The command's own id is the session's identity, so the moment it was issued
        // is the moment the session began.
        started_at: new Date().toISOString(),
        timezone,
        requested_level: 'detailed',
        capture_source: 'manual',
      })
      starting.delete(plannedSessionId)
      return started.id
    },

    async save(executedSessionId, revisionNumber, results) {
      // A save is a new command every time: it is not a retry of the last one, it is
      // the session as it now stands.
      const saved = await dependencies.transport.saveResults(
        dependencies.newCommand(),
        executedSessionId,
        revisionNumber,
        results,
      )
      return saved.revision_number
    },

    async finish(executedSessionId) {
      await dependencies.transport.finish(
        dependencies.newCommand(),
        executedSessionId,
        new Date().toISOString(),
      )
    },

    async abandon(executedSessionId) {
      await dependencies.transport.abandon(
        dependencies.newCommand(),
        executedSessionId,
        new Date().toISOString(),
      )
    },
  }
}
