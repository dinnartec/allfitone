import { describe, expect, test } from 'bun:test'
import type { VerifiedToken } from '@allfitone/auth-provider'

import type { MealDatabase, MealRecord } from '../domain/meals.js'
import { createMealService } from './meals.js'

const token = { subject: 'user_subject', sessionId: 'session_1' } as unknown as VerifiedToken

const record: MealRecord = {
  id: '019b7000-0000-7000-8000-000000000501',
  occurred_at: '2026-09-15T23:30:00+00:00',
  local_date: '2026-09-15',
  timezone: 'America/Bogota',
  meal_type: 'dinner',
  note: null,
  revision_number: 0,
  has_media: false,
  items: [],
}

const command = {
  idempotencyKey: 'a0000000-0000-4000-8000-000000000701',
  commandId: record.id,
  requestHash: new Uint8Array(32),
}

function service(records: MealRecord[]) {
  const seen: unknown[] = []
  const database: MealDatabase = {
    list: (input) => {
      seen.push(input)
      return Promise.resolve({ items: records, has_more: true })
    },
    record: (input) => {
      seen.push(input)
      return Promise.resolve({ resource: records[0] ?? record, replayed: true })
    },
    delete: () => Promise.reject(new Error('not used')),
  }
  return {
    seen,
    meals: createMealService({ database, issuer: 'https://issuer.test', requestId: () => 'req-1' }),
  }
}

describe('Space meal use cases', () => {
  test('T-NUT-UNIT-01 shows the owner a meal with its photo slot and no media flag', async () => {
    const { meals, seen } = service([record])

    const page = await meals.list(token, { from: '2026-09-01', to: '2026-09-30', limit: 25 })

    expect(page).toEqual({
      meals: [{ ...withoutMediaFlag(record), photo: null, applied_scopes: [] }],
      hasMore: true,
    })
    expect(seen[0]).toEqual({
      issuer: 'https://issuer.test',
      subject: 'user_subject',
      from: '2026-09-01',
      to: '2026-09-30',
      limit: 25,
      requestId: 'req-1',
    })
  })

  test('T-NUT-UNIT-02 keeps whether the recording was a replay', async () => {
    const { meals } = service([record])

    const result = await meals.record(token, {
      ...command,
      mealId: record.id,
      meal: {
        occurred_at: record.occurred_at,
        timezone: 'America/Bogota',
        meal_type: record.meal_type,
        note: null,
        items: [],
      },
    })

    expect(result.replayed).toBe(true)
    expect(result.resource.photo).toBeNull()
  })

  test('T-NUT-UNIT-03 refuses to serve a meal that claims a photo it cannot show', async () => {
    const { meals } = service([{ ...record, has_media: true }])

    await expect(
      meals.list(token, { from: '2026-09-01', to: '2026-09-30', limit: 25 }),
    ).rejects.toThrow('photo')
  })
})

function withoutMediaFlag(meal: MealRecord) {
  const { has_media: _hasMedia, ...rest } = meal
  return rest
}
