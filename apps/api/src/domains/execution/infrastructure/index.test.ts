/**
 * How the results list reaches PostgreSQL.
 *
 * `postgres.js` infers a parameter's type from the cast that follows it, so a bare
 * `::jsonb` after an already-serialized string made it serialize a second time: the
 * command received the JSON scalar `"[…]"` instead of an array and answered
 * `22023 — cannot extract elements from a scalar`. Every save on the session screen
 * failed, and nothing caught it because the handler tests mock the database and the
 * pgTAP tests call the function with a jsonb literal.
 *
 * So the binding itself is asserted: the value is the serialized list, and the cast it
 * travels through says text first.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type postgres from 'postgres'

import { setDatabase } from '../../../platform/db/index.js'
import { createExecutionDatabase } from './index.js'

interface CapturedQuery {
  strings: readonly string[]
  values: unknown[]
}

function recordingDatabase(captured: CapturedQuery[]): ReturnType<typeof postgres> {
  const client = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ strings: [...strings], values })
      return Promise.resolve([{ id: EXECUTION_ID, revision_number: 1, result_count: 1 }])
    },
    {
      begin: (operation: (transaction: unknown) => Promise<unknown>) => operation(client),
      json: (value: unknown) => ({ json: value }),
      end: () => Promise.resolve(),
    },
  )
  return client as unknown as ReturnType<typeof postgres>
}

const PERSON_ID = '019e4000-0000-7000-8000-000000000001'
const EXECUTION_ID = '019e4000-0000-7000-8000-000000000201'
const MOVEMENT_ID = '019f1000-0000-7000-8000-000000000001'

const command = {
  idempotencyKey: '51111111-1111-4111-8111-111111111111',
  commandId: '019e4000-0000-7000-8000-000000000301',
  requestHash: Buffer.alloc(32),
}

afterEach(async () => {
  await setDatabase(undefined)
})

describe('the results list binding', () => {
  test('T-EXE-IDEM-10 sends the flattened list as one serialized array', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))

    await createExecutionDatabase().replaceResults({
      personId: PERSON_ID,
      executedSessionId: EXECUTION_ID,
      revisionNumber: 0,
      results: {
        strength_sets: [{ order: 1, movement_id: MOVEMENT_ID, achieved_reps: 8 }],
      } as never,
      ...command,
    })

    const bound = captured.at(-1)?.values[3]
    expect(typeof bound).toBe('string')
    expect(JSON.parse(String(bound))).toEqual([
      {
        family: 'strength',
        set_order: 1,
        movement_id: MOVEMENT_ID,
        achieved_reps: 8,
        load_value: null,
        load_unit_code: null,
        rpe: null,
        // Null and not `normal`: the database owns the default (ADR-033).
        kind: null,
        exercise_position: null,
      },
    ])
  })

  test("T-EXE-API-KIND-01 carries each set's kind and effort to the command", async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))

    await createExecutionDatabase().replaceResults({
      personId: PERSON_ID,
      executedSessionId: EXECUTION_ID,
      revisionNumber: 0,
      results: {
        strength_sets: [{ order: 1, movement_id: MOVEMENT_ID, kind: 'warmup', rpe: 6 }],
      } as never,
      ...command,
    })

    const [sent] = JSON.parse(String(captured.at(-1)?.values[3])) as Record<string, unknown>[]
    expect(sent).toMatchObject({ kind: 'warmup', rpe: 6 })
  })

  test('T-EXE-API-EXER-01 sends the exercise list and where each set belongs', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))

    await createExecutionDatabase().replaceResults({
      personId: PERSON_ID,
      executedSessionId: EXECUTION_ID,
      revisionNumber: 0,
      results: {
        strength_sets: [{ order: 1, movement_id: MOVEMENT_ID, exercise_position: 2 }],
        exercises: [
          { position: 1, movement_id: MOVEMENT_ID, superset_group: 1, rest_seconds: 90 },
          { position: 2, movement_id: MOVEMENT_ID, planned_step_id: null, superset_group: 1 },
        ],
      } as never,
      ...command,
    })

    const values = captured.at(-1)?.values ?? []
    const [sent] = JSON.parse(String(values[3])) as Record<string, unknown>[]
    expect(sent).toMatchObject({ exercise_position: 2 })
    expect(JSON.parse(String(values[7]))).toEqual([
      {
        position: 1,
        movement_id: MOVEMENT_ID,
        planned_step_id: null,
        superset_group: 1,
        rest_seconds: 90,
      },
      // Unsaid is no rest, not a default: the database keeps it null (ADR-035).
      {
        position: 2,
        movement_id: MOVEMENT_ID,
        planned_step_id: null,
        superset_group: 1,
        rest_seconds: null,
      },
    ])
  })

  test('T-EXE-API-EXER-02 without a list it sends none, and the session keeps its own', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))

    await createExecutionDatabase().replaceResults({
      personId: PERSON_ID,
      executedSessionId: EXECUTION_ID,
      revisionNumber: 0,
      results: { strength_sets: [] } as never,
      ...command,
    })

    expect(captured.at(-1)?.values[7]).toBeNull()
  })

  test('T-EXE-IDEM-11 casts through text, so the driver does not serialize it twice', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))

    await createExecutionDatabase().replaceResults({
      personId: PERSON_ID,
      executedSessionId: EXECUTION_ID,
      revisionNumber: 0,
      results: { strength_sets: [] } as never,
      ...command,
    })

    // The fragment right after the list is what tells the driver what it is holding.
    const following = captured.at(-1)?.strings[4] ?? ''
    expect(following.startsWith('::text::jsonb')).toBe(true)
  })
})

describe('the summary read (ADR-036)', () => {
  test("T-EXE-API-SUM-01 asks for the session in the person's zone and reads numerics as numbers", async () => {
    const captured: CapturedQuery[] = []
    const client = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        captured.push({ strings: [...strings], values })
        return Promise.resolve([
          {
            executed_session_id: EXECUTION_ID,
            started_at: new Date('2026-09-29T12:00:00.000Z'),
            ended_at: new Date('2026-09-29T12:48:12.000Z'),
            duration_seconds: '2892',
            title: 'Tirón',
            work_sets: 12,
            exercise_count: 4,
            total_volume_kg: '3840.00',
            exercises: [],
            records: [],
            streak_weeks: 8,
            session_number: 14,
            given_name: 'Walberto',
            username: 'walberto',
            cover_object_key: 'routines/back.webp',
            algorithm_version: 1,
          },
        ])
      },
      {
        begin: (operation: (transaction: unknown) => Promise<unknown>) => operation(client),
        json: (value: unknown) => ({ json: value }),
        end: () => Promise.resolve(),
      },
    )
    await setDatabase(client as unknown as ReturnType<typeof postgres>)

    const summary = await createExecutionDatabase().readSummary({
      personId: PERSON_ID,
      executedSessionId: EXECUTION_ID,
      timezone: 'America/Bogota',
      requestId: 'r',
    })

    expect(captured.at(-1)?.values.slice(0, 3)).toEqual([PERSON_ID, EXECUTION_ID, 'America/Bogota'])
    expect(summary).toMatchObject({
      duration_seconds: 2892,
      total_volume_kg: 3840,
      started_at: '2026-09-29T12:00:00.000Z',
      ended_at: '2026-09-29T12:48:12.000Z',
      cover_object_key: 'routines/back.webp',
    })
  })
})

describe('the history binding', () => {
  test('T-EXE-API-HIST-09 sends every filter in the function order, a missing one as null', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))

    await createExecutionDatabase().listHistory({
      personId: PERSON_ID,
      timezone: 'America/Bogota',
      month: '2026-09-01',
      discipline: null,
      withRecord: true,
      free: null,
      query: 'press',
      cursor: null,
      limit: 20,
      day: '2026-09-30',
      requestId: 'r',
    })

    const listed = captured.find((query) => query.strings.join('').includes('list_my_executions'))
    expect(listed?.values).toEqual([
      PERSON_ID,
      'America/Bogota',
      '2026-09-01',
      null,
      true,
      null,
      'press',
      null,
      20,
      '2026-09-30',
    ])
    expect(listed?.strings.join('?')).toContain('?::date')
  })
})

describe('the finished-session bindings', () => {
  test('T-EXE-API-FIN-10 a correction sends sets, list and time in the function order', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))

    await createExecutionDatabase().revise({
      personId: PERSON_ID,
      executedSessionId: PERSON_ID,
      revisionNumber: 4,
      revision: {
        started_at: '2026-09-29T23:02:00.000Z',
        ended_at: '2026-09-29T23:50:00.000Z',
        strength_sets: [{ order: 1, exercise_position: 1, achieved_reps: 8 }],
        exercises: [{ position: 1 }],
      },
      idempotencyKey: '51111111-1111-4111-8111-111111111111',
      commandId: PERSON_ID,
      requestHash: Buffer.alloc(32),
    })

    const revised = captured.find((query) => query.strings.join('').includes('revise_execution'))
    const values = revised?.values ?? []
    expect(values.slice(0, 3)).toEqual([PERSON_ID, PERSON_ID, 4])
    expect(JSON.parse(String(values[3]))).toEqual([
      {
        family: 'strength',
        set_order: 1,
        movement_id: null,
        achieved_reps: 8,
        load_value: null,
        load_unit_code: null,
        rpe: null,
        kind: null,
        exercise_position: 1,
      },
    ])
    expect(JSON.parse(String(values[4]))).toEqual([
      {
        position: 1,
        movement_id: null,
        planned_step_id: null,
        superset_group: null,
        rest_seconds: null,
      },
    ])
    expect(values.slice(5, 7)).toEqual(['2026-09-29T23:02:00.000Z', '2026-09-29T23:50:00.000Z'])
  })
})
