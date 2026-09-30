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
