/**
 * How nutrition reaches PostgreSQL: the meal and the patch travel as serialized text
 * cast to jsonb, the lesson execution learnt (`T-EXE-IDEM-10`), and the arguments go in
 * the functions' order.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type postgres from 'postgres'

import { setDatabase } from '../../../platform/db/index.js'
import { createNutritionDatabase } from './index.js'

interface CapturedQuery {
  strings: readonly string[]
  values: unknown[]
}

function recordingDatabase(
  captured: CapturedQuery[],
  answer: unknown,
): ReturnType<typeof postgres> {
  const client = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ strings: [...strings], values })
      return Promise.resolve([answer])
    },
    {
      begin: (operation: (transaction: unknown) => Promise<unknown>) => operation(client),
      end: () => Promise.resolve(),
    },
  )
  return client as unknown as ReturnType<typeof postgres>
}

const PERSON = '019f1000-0000-7000-8000-000000000001'
const MEAL = '019f1000-0000-7000-8000-000000000101'
const command = {
  idempotencyKey: '51111111-1111-4111-8111-111111111111',
  commandId: MEAL,
  requestHash: Buffer.alloc(32),
}

afterEach(async () => {
  await setDatabase(undefined)
})

describe('the nutrition bindings', () => {
  test('T-NUT-API-UNIT-12 a correction sends revision, patch and photo change in the function order', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured, { meal: { id: MEAL, disposed_media_ref: null } }))

    await createNutritionDatabase().reviseMeal({
      ...command,
      personId: PERSON,
      mealId: MEAL,
      revision: 3,
      patch: { note: 'Con más arroz' },
      media: { remove: true },
    })

    const revised = captured.find((query) => query.strings.join('').includes('revise_meal'))
    expect(revised?.values.slice(0, 3)).toEqual([PERSON, MEAL, 3])
    expect(JSON.parse(String(revised?.values[3]))).toEqual({ note: 'Con más arroz' })
    expect(JSON.parse(String(revised?.values[4]))).toEqual({ remove: true })
    expect(revised?.strings.join('?')).toContain('?::text::jsonb')
  })

  test('T-NUT-API-UNIT-13 the day summaries carry the zone that decides today', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured, { days: { data: [], streak_days: 0 } }))

    const page = await createNutritionDatabase().readDailySummaries({
      personId: PERSON,
      from: '2026-09-24',
      to: '2026-09-30',
      timezone: 'America/Bogota',
      requestId: 'r',
    })

    const read = captured.find((query) => query.strings.join('').includes('read_daily_summaries'))
    expect(read?.values.slice(0, 4)).toEqual([PERSON, '2026-09-24', '2026-09-30', 'America/Bogota'])
    expect(page).toEqual({ data: [], streak_days: 0 })
  })
})
