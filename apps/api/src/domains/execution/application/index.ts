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
  HistoryMonth,
  HistoryPage,
  HistoryQuery,
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
  listHistory(input: HistoryQuery): Promise<HistoryPage>
  readHistoryMonth: ExecutionDatabase['readHistoryMonth']
  readFinished: ExecutionDatabase['readFinished']
  revise: ExecutionDatabase['revise']
  annul: ExecutionDatabase['annul']
  readAnnulmentPreview: ExecutionDatabase['readAnnulmentPreview']
  repeat: ExecutionDatabase['repeat']
}

export type { Execution, ExecutionSummary, HistoryMonth, HistoryPage, HistoryQuery, WeekSummary }

export function createSpaceExecutionService(
  database: ExecutionDatabase,
  mediaBaseUrl: string,
): SpaceExecutionService {
  // The row keeps the key and the origin lives in configuration, as planning does (ADR-031).
  const base = mediaBaseUrl.replace(/\/+$/, '')
  const address = (key: string | null) => (key === null ? null : `${base}/${key}`)
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
        cover_url: address(cover_object_key),
      }
    },
    async listHistory(input) {
      const { data, page } = await database.listHistory(input)
      return {
        data: data.map(({ thumbnail_object_key, ...item }) => ({
          ...item,
          thumbnail_url: address(thumbnail_object_key),
        })),
        page,
      }
    },
    readHistoryMonth: (input) => database.readHistoryMonth(input),
    readFinished: (input) => database.readFinished(input),
    revise: (input) => database.revise(input),
    annul: (input) => database.annul(input),
    readAnnulmentPreview: (input) => database.readAnnulmentPreview(input),
    repeat: (input) => database.repeat(input),
  }
}
