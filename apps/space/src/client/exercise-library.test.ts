/**
 * `T-SP-LIB-01..04` — that the catalogue is walked once for the whole flow, and that
 * a failure does not stick to it.
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ContentFlow, Movement } from './content'
import { forgetExerciseLibrary, readExerciseLibrary } from './exercise-library'

const MOVEMENT: Movement = {
  id: 'm-1',
  discipline_code: 'strength',
  name: 'Sentadilla con barra',
  muscles: ['quadriceps'],
  equipment: ['barbell'],
} as Movement

function flowThatCounts(fail = false) {
  const calls = { movements: 0, muscles: 0, equipment: 0 }
  const flow = {
    searchMovements: () => {
      calls.movements += 1
      return fail ? Promise.reject(new Error('sin señal')) : Promise.resolve([MOVEMENT])
    },
    readMuscles: () => {
      calls.muscles += 1
      return Promise.resolve([])
    },
    readEquipment: () => {
      calls.equipment += 1
      return Promise.resolve([])
    },
  } as unknown as ContentFlow
  return { flow, calls }
}

describe('the catalogue behind the picking flow', () => {
  beforeEach(() => {
    forgetExerciseLibrary()
  })

  test('T-SP-LIB-01 three screens asking is one walk of the cursor', async () => {
    const { flow, calls } = flowThatCounts()

    const library = await readExerciseLibrary(flow)
    await readExerciseLibrary(flow)
    await readExerciseLibrary(flow)

    expect(calls).toEqual({ movements: 1, muscles: 1, equipment: 1 })
    expect(library.movements).toEqual([MOVEMENT])
  })

  test('T-SP-LIB-02 two screens mounting at once share the one in flight', async () => {
    const { flow, calls } = flowThatCounts()

    await Promise.all([readExerciseLibrary(flow), readExerciseLibrary(flow)])

    expect(calls.movements).toBe(1)
  })

  test('T-SP-LIB-03 a failure is not remembered, or one bad moment stays broken', async () => {
    const failing = flowThatCounts(true)
    await expect(readExerciseLibrary(failing.flow)).rejects.toThrow('sin señal')

    const working = flowThatCounts()
    await readExerciseLibrary(working.flow)

    expect(working.calls.movements).toBe(1)
  })

  test('T-SP-LIB-04 forgetting it sends the next read out again', async () => {
    const { flow, calls } = flowThatCounts()
    await readExerciseLibrary(flow)

    forgetExerciseLibrary()
    await readExerciseLibrary(flow)

    expect(calls.movements).toBe(2)
  })
})
