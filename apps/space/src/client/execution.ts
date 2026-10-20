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
export type FinishedExecution = AllfitV1Schemas['SpaceFinishedExecution']
export type FinishedExercise = AllfitV1Schemas['SpaceFinishedExercise']
export type FinishedSet = AllfitV1Schemas['SpaceFinishedSet']
export type ExecutionRevision = AllfitV1Schemas['ExecutionRevision']
export type Revised = AllfitV1Schemas['ExecutionRevised']
export type Invalidated = AllfitV1Schemas['ExecutionInvalidated']
export type InvalidationPreview = AllfitV1Schemas['SpaceInvalidationPreview']
export type Repeated = AllfitV1Schemas['ExecutionRepeated']
export type FreeSession = AllfitV1Schemas['FreeSession']
export type FreeSessionCreate = AllfitV1Schemas['FreeSessionCreate']

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
  startFreeSession(command: CommandHeaders, start: FreeSessionCreate): Promise<FreeSession>
  saveResults(
    command: CommandHeaders,
    executedSessionId: string,
    revisionNumber: number,
    results: ExecutionResults,
  ): Promise<ResultsState>
  finish(command: CommandHeaders, executedSessionId: string, endedAt: string): Promise<Finalized>
  abandon(command: CommandHeaders, executedSessionId: string, endedAt: string): Promise<Abandoned>
  readFinished(executedSessionId: string, timezone: string): Promise<FinishedExecution>
  readAnnulmentPreview(executedSessionId: string, timezone: string): Promise<InvalidationPreview>
  revise(
    command: CommandHeaders,
    executedSessionId: string,
    revisionNumber: number,
    revision: ExecutionRevision,
  ): Promise<Revised>
  annul(command: CommandHeaders, executedSessionId: string): Promise<Invalidated>
  repeat(
    command: CommandHeaders,
    executedSessionId: string,
    start: { started_at: string; timezone: string },
  ): Promise<Repeated>
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
  /** Training off the plan (`OP-EXE-004`): an empty strength session; answers its id. */
  startFree(timezone: string): Promise<string>
  save(
    executedSessionId: string,
    revisionNumber: number,
    results: ExecutionResults,
  ): Promise<number>
  finish(executedSessionId: string): Promise<void>
  /** Leaves the session without finishing it. What was recorded stays. */
  abandon(executedSessionId: string): Promise<void>
  /** A finished session set by set (`OP-EXE-023`). */
  readFinished(executedSessionId: string, timezone: string): Promise<FinishedExecution>
  /** What annulling it would change, said before confirming (`OP-EXE-024`). */
  readAnnulmentPreview(executedSessionId: string, timezone: string): Promise<InvalidationPreview>
  /** Corrects a finished session; answers the new revision (`OP-EXE-007`). */
  revise(
    executedSessionId: string,
    revisionNumber: number,
    revision: ExecutionRevision,
  ): Promise<number>
  /** What Space calls deleting: it stops counting and nothing is erased (`OP-EXE-009`). */
  annul(executedSessionId: string): Promise<void>
  /** Opens another attempt with the session's exercises; answers its id (`OP-EXE-025`). */
  repeat(executedSessionId: string, timezone: string): Promise<string>
}

export function createExecutionFlow(dependencies: ExecutionFlowDependencies): ExecutionFlow {
  // Per planned session, and never renewed: a retry must answer the session already
  // started rather than open a second one against the same day.
  const starting = new Map<string, CommandHeaders>()
  // Same reason: annulling twice is harmless, opening two repeats is not.
  const annulling = new Map<string, CommandHeaders>()
  const repeating = new Map<string, CommandHeaders>()
  // The start time travels with the key: the body is hashed, so a retry must send both.
  let startingFree: { command: CommandHeaders; startedAt: string } | undefined
  const held = (keys: Map<string, CommandHeaders>, id: string) => {
    const found = keys.get(id) ?? dependencies.newCommand()
    keys.set(id, found)
    return found
  }

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

    async startFree(timezone) {
      startingFree ??= { command: dependencies.newCommand(), startedAt: new Date().toISOString() }
      const started = await dependencies.transport.startFreeSession(startingFree.command, {
        discipline_code: 'strength',
        started_at: startingFree.startedAt,
        timezone,
        requested_level: 'detailed',
        capture_source: 'manual',
      })
      startingFree = undefined
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

    readFinished: (id, timezone) => dependencies.transport.readFinished(id, timezone),
    readAnnulmentPreview: (id, timezone) =>
      dependencies.transport.readAnnulmentPreview(id, timezone),

    async revise(executedSessionId, revisionNumber, revision) {
      const revised = await dependencies.transport.revise(
        dependencies.newCommand(),
        executedSessionId,
        revisionNumber,
        revision,
      )
      return revised.revision_number
    },

    async annul(executedSessionId) {
      await dependencies.transport.annul(held(annulling, executedSessionId), executedSessionId)
      annulling.delete(executedSessionId)
    },

    async repeat(executedSessionId, timezone) {
      const repeated = await dependencies.transport.repeat(
        held(repeating, executedSessionId),
        executedSessionId,
        { started_at: new Date().toISOString(), timezone },
      )
      repeating.delete(executedSessionId)
      return repeated.id
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
