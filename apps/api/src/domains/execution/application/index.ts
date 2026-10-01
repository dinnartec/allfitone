/**
 * The Space execution use cases.
 *
 * Thin on purpose: the rules live in PostgreSQL, where they belong for health data,
 * and this layer's job is to hold the person's identity to every call so no caller
 * can forget it.
 */

import type {
  Execution,
  ExecutionDatabase,
  ExecutionSummary,
  WeekSummary,
} from '../domain/index.js'

export interface SpaceExecutionService {
  startAttempt: ExecutionDatabase['startAttempt']
  replaceResults: ExecutionDatabase['replaceResults']
  finalize: ExecutionDatabase['finalize']
  abandon: ExecutionDatabase['abandon']
  readExecution: ExecutionDatabase['readExecution']
  readWeekSummary: ExecutionDatabase['readWeekSummary']
  readSummary(
    input: Parameters<ExecutionDatabase['readSummary']>[0],
  ): Promise<ExecutionSummary | null>
}

export type { Execution, ExecutionSummary, WeekSummary }

export function createSpaceExecutionService(
  database: ExecutionDatabase,
  mediaBaseUrl: string,
): SpaceExecutionService {
  // The row keeps the key and the origin lives in configuration, as planning does (ADR-031).
  const base = mediaBaseUrl.replace(/\/+$/, '')
  return {
    startAttempt: (input) => database.startAttempt(input),
    replaceResults: (input) => database.replaceResults(input),
    finalize: (input) => database.finalize(input),
    abandon: (input) => database.abandon(input),
    readExecution: (input) => database.readExecution(input),
    readWeekSummary: (input) => database.readWeekSummary(input),
    async readSummary(input) {
      const row = await database.readSummary(input)
      if (!row) return null
      const { cover_object_key, ...rest } = row
      return {
        ...rest,
        cover_url: cover_object_key === null ? null : `${base}/${cover_object_key}`,
      }
    },
  }
}
