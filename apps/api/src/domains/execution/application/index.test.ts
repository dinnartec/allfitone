import { describe, expect, test } from 'bun:test'

import type { ExecutionDatabase, SummaryRow } from '../domain/index.js'
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
