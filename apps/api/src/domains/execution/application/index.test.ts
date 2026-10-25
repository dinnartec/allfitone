import { describe, expect, test } from 'bun:test'

import type { ExecutionDatabase, HistoryRowPage, SummaryRow } from '../domain/index.js'
import { createSpaceExecutionService } from './index.js'

const row: SummaryRow = {
  executed_session_id: '019e4000-0000-7000-8000-000000000201',
  started_at: '2026-09-29T12:00:00.000Z',
  ended_at: '2026-09-29T12:48:12.000Z',
  duration_seconds: 2892,
  title: 'Tirón',
  work_sets: 12,
  exercise_count: 4,
  total_volume_kg: 3840,
  exercises: [],
  records: [],
  streak_weeks: 8,
  session_number: 14,
  given_name: 'Walberto',
  username: 'walberto',
  cover_object_key: 'routines/back.webp',
  algorithm_version: 1,
}

function serviceWith(found: SummaryRow | null) {
  const database = { readSummary: async () => found } as unknown as ExecutionDatabase
  return createSpaceExecutionService(database, 'https://media.example/')
}

describe('the summary as Space sees it', () => {
  test('T-EXE-API-SUM-02 the photograph is an address, never a storage key', async () => {
    const summary = await serviceWith(row).readSummary({
      personId: 'p',
      executedSessionId: row.executed_session_id,
      timezone: 'America/Bogota',
      requestId: 'r',
    })

    expect(summary?.cover_url).toBe('https://media.example/routines/back.webp')
    expect(summary).not.toHaveProperty('cover_object_key')
  })

  test('T-EXE-API-SUM-03 no photograph is no address, and no session is no summary', async () => {
    const none = await serviceWith({ ...row, cover_object_key: null }).readSummary({
      personId: 'p',
      executedSessionId: row.executed_session_id,
      timezone: 'America/Bogota',
      requestId: 'r',
    })
    const missing = await serviceWith(null).readSummary({
      personId: 'p',
      executedSessionId: row.executed_session_id,
      timezone: 'America/Bogota',
      requestId: 'r',
    })

    expect(none?.cover_url).toBeNull()
    expect(missing).toBeNull()
  })
})

describe('the history as Space sees it', () => {
  const page: HistoryRowPage = {
    data: [
      {
        executed_session_id: '019e4000-0000-7000-8000-000000000201',
        status: 'completed',
        started_at: '2026-09-29T12:00:00.000Z',
        trained_on: '2026-09-29',
        title: 'Tirón',
        is_free: false,
        discipline_code: 'strength',
        duration_seconds: 2892,
        work_sets: 12,
        total_volume_kg: 3840,
        record_count: 2,
        thumbnail_object_key: 'movements/pull-up/demo.webp',
      },
      {
        executed_session_id: '019e4000-0000-7000-8000-000000000202',
        status: 'completed',
        started_at: '2026-09-27T12:00:00.000Z',
        trained_on: '2026-09-27',
        title: null,
        is_free: true,
        discipline_code: 'strength',
        duration_seconds: 2100,
        work_sets: 0,
        total_volume_kg: null,
        record_count: 0,
        thumbnail_object_key: null,
      },
    ],
    window: { visible_from: null, has_hidden: false },
    page: { next_cursor: null, has_more: false },
  }

  test('T-EXE-API-HIST-08 a thumbnail is an address, and none stays none', async () => {
    const database = { listHistory: async () => page } as unknown as ExecutionDatabase
    const listed = await createSpaceExecutionService(
      database,
      'https://media.example/',
    ).listHistory({
      personId: 'p',
      timezone: 'America/Bogota',
      month: null,
      discipline: null,
      withRecord: null,
      free: null,
      query: null,
      cursor: null,
      limit: 20,
      day: null,
      requestId: 'r',
    })

    expect(listed.data.map((item) => item.thumbnail_url)).toEqual([
      'https://media.example/movements/pull-up/demo.webp',
      null,
    ])
    expect(listed.data[0]).not.toHaveProperty('thumbnail_object_key')
  })
})
