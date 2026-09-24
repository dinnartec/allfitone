/**
 * The Space execution use cases.
 *
 * Thin on purpose: the rules live in PostgreSQL, where they belong for health data,
 * and this layer's job is to hold the person's identity to every call so no caller
 * can forget it.
 */

import type { Execution, ExecutionDatabase, WeekSummary } from '../domain/index.js'

export interface SpaceExecutionService {
  startAttempt: ExecutionDatabase['startAttempt']
  replaceResults: ExecutionDatabase['replaceResults']
  finalize: ExecutionDatabase['finalize']
  abandon: ExecutionDatabase['abandon']
  readExecution: ExecutionDatabase['readExecution']
  readWeekSummary: ExecutionDatabase['readWeekSummary']
}

export type { Execution, WeekSummary }

export function createSpaceExecutionService(database: ExecutionDatabase): SpaceExecutionService {
  return {
    startAttempt: (input) => database.startAttempt(input),
    replaceResults: (input) => database.replaceResults(input),
    finalize: (input) => database.finalize(input),
    abandon: (input) => database.abandon(input),
    readExecution: (input) => database.readExecution(input),
    readWeekSummary: (input) => database.readWeekSummary(input),
  }
}
