import { describe, expect, test } from 'bun:test'

import {
  addedDuring,
  canFinish,
  rememberAdded,
  elapsedLabel,
  resultsFrom,
  setsProgress,
  totalVolumeKg,
  withAddedExercises,
  withExtraSet,
  withoutSet,
  workingStateFrom,
  type Execution,
  type WorkingExercise,
} from './session-form'

const MOVEMENT = '019e4000-0000-7000-8000-000000000601'
const OTHER = '019e4000-0000-7000-8000-000000000602'

function execution(overrides: Partial<Execution> = {}): Execution {
  return {
    executed_session_id: '019e4000-0000-7000-8000-000000000501',
    execution_status: 'in_progress',
    started_at: '2026-09-01T12:00:00.000Z',
    revision_number: 0,
    title: 'Empuje',
    discipline_code: 'strength',
    program_title: 'Torso y pierna',
    week: 1,
    planned: [
      {
        position: 1,
        movement_id: MOVEMENT,
        movement: 'Press de banca',
        target: { family: 'strength', target_sets: 4, target_reps: 8 },
      },
      {
        position: 2,
        movement_id: OTHER,
        movement: 'Fondos',
        target: { family: 'strength', target_sets: 3, target_reps: 12 },
      },
    ],
    results: [],
    ...overrides,
  }
}

describe('the working state a session screen holds', () => {
  test('T-SPC-UNIT-40 opens one row per planned set, pre-filled with the target reps', () => {
    const [first] = workingStateFrom(execution())

    expect(first?.sets).toHaveLength(4)
    expect(first?.sets.every((set) => set.reps === '8')).toBe(true)
    expect(first?.sets.every((set) => set.done)).toBe(false)
  })

  test('T-SPC-UNIT-41 numbers sets across the whole session, not within each exercise', () => {
    // `execution.strength_sets` is unique on (session, set_order): one ladder, so two
    // exercises can never claim the same rung.
    const [first, second] = workingStateFrom(execution())

    expect(first?.sets.map((set) => set.order)).toEqual([1, 2, 3, 4])
    expect(second?.sets.map((set) => set.order)).toEqual([5, 6, 7])
  })

  test('T-SPC-UNIT-42 shows what was recorded over what was planned', () => {
    const resumed = workingStateFrom(
      execution({
        results: [
          {
            family: 'strength',
            set_order: 1,
            movement_id: MOVEMENT,
            achieved_reps: 6,
            load_value: 80,
          },
          {
            family: 'strength',
            set_order: 2,
            movement_id: MOVEMENT,
            achieved_reps: 5,
            load_value: 82.5,
          },
        ],
      }),
    )

    expect(resumed[0]?.sets[0]).toMatchObject({ loadKg: '80', reps: '6', done: true })
    expect(resumed[0]?.sets[1]).toMatchObject({ loadKg: '82.5', reps: '5', done: true })
    // Untouched rows keep the plan.
    expect(resumed[0]?.sets[2]).toMatchObject({ loadKg: '', reps: '8', done: false })
  })

  test('T-SPC-UNIT-62 shows what the movement weighed last time, set by set', () => {
    const withHistory = workingStateFrom(
      execution({
        planned: [
          {
            position: 1,
            movement_id: MOVEMENT,
            movement: 'Press de banca',
            target: { family: 'strength', target_sets: 3, target_reps: 8 },
            previous: [
              { load_value: 60, achieved_reps: 12 },
              { load_value: 60, achieved_reps: 11 },
            ],
          },
        ],
      }),
    )

    expect(withHistory[0]?.sets.map((set) => set.previous)).toEqual(['60 × 12', '60 × 11', '—'])
  })

  test('T-SPC-UNIT-63 keeps a set that was recorded beyond the plan', () => {
    // Somebody who did five sets of four has done five. Rebuilding from the plan
    // alone would quietly drop the fifth.
    const beyond = workingStateFrom(
      execution({
        planned: [
          {
            position: 1,
            movement_id: MOVEMENT,
            movement: 'Press de banca',
            target: { family: 'strength', target_sets: 2, target_reps: 8 },
          },
        ],
        results: [
          { family: 'strength', set_order: 1, movement_id: MOVEMENT, achieved_reps: 8 },
          { family: 'strength', set_order: 2, movement_id: MOVEMENT, achieved_reps: 8 },
          { family: 'strength', set_order: 3, movement_id: MOVEMENT, achieved_reps: 6 },
        ],
      }),
    )

    expect(beyond[0]?.sets).toHaveLength(3)
    expect(beyond[0]?.sets[2]?.done).toBe(true)
  })

  test('T-SPC-UNIT-64 matches recorded sets by movement, not by rung', () => {
    // Adding a set to the first exercise renumbers every set after it, so an
    // order-based match would hand the wrong numbers to the wrong exercise.
    const shifted = workingStateFrom(
      execution({
        results: [
          {
            family: 'strength',
            set_order: 7,
            movement_id: OTHER,
            achieved_reps: 12,
            load_value: 30,
          },
        ],
      }),
    )

    expect(shifted[0]?.sets.every((set) => !set.done)).toBe(true)
    expect(shifted[1]?.sets[0]).toMatchObject({ loadKg: '30', reps: '12', done: true })
  })

  test('T-SPC-UNIT-65 adding a set renumbers the whole ladder', () => {
    const grown = withExtraSet(workingStateFrom(execution()), 1)

    expect(grown[0]?.sets).toHaveLength(5)
    expect(grown[0]?.sets.map((set) => set.order)).toEqual([1, 2, 3, 4, 5])
    // The rungs below move up, or the database would reject two sets on one.
    expect(grown[1]?.sets.map((set) => set.order)).toEqual([6, 7, 8])
  })

  test('T-SPC-UNIT-66 removing a set renumbers the ladder too', () => {
    const trimmed = withoutSet(workingStateFrom(execution()), 1, 2)

    expect(trimmed[0]?.sets.map((set) => set.order)).toEqual([1, 2, 3])
    expect(trimmed[1]?.sets.map((set) => set.order)).toEqual([4, 5, 6])
  })

  test('T-SPC-UNIT-67 keeps the last row of an exercise', () => {
    // An exercise with no rows has nowhere to record anything, and getting one back
    // would mean reopening the session.
    const single = withExtraSet([], 1)
    const oneRow = withoutSet(
      [
        {
          position: 1,
          movementId: MOVEMENT,
          movement: 'Press de banca',
          sets: [{ order: 1, loadKg: '', reps: '8', done: false, previous: '—' }],
        },
      ],
      1,
      1,
    )

    expect(single).toEqual([])
    expect(oneRow[0]?.sets).toHaveLength(1)
  })

  test('T-SPC-UNIT-43 falls back to three rows when the target says nothing about sets', () => {
    const vague = workingStateFrom(
      execution({
        planned: [
          { position: 1, movement_id: null, movement: 'Movilidad', target: { family: 'mobility' } },
        ],
      }),
    )

    expect(vague[0]?.sets).toHaveLength(3)
  })
})

describe('what the screen can say about a session in progress', () => {
  const exercises: readonly WorkingExercise[] = [
    {
      position: 1,
      movementId: MOVEMENT,
      movement: 'Press de banca',
      sets: [
        { order: 1, loadKg: '80', reps: '10', done: true, previous: '—' },
        { order: 2, loadKg: '80', reps: '8', done: true, previous: '—' },
        { order: 3, loadKg: '', reps: '8', done: false, previous: '—' },
      ],
    },
    {
      position: 2,
      movementId: null,
      movement: 'Fondos',
      sets: [{ order: 4, loadKg: '', reps: '12', done: true, previous: '—' }],
    },
  ]

  test('T-SPC-UNIT-44 counts the sets ticked against the sets planned', () => {
    expect(setsProgress(exercises)).toEqual({ done: 3, planned: 4 })
  })

  test('T-SPC-UNIT-45 adds up only the load that was actually moved', () => {
    // The bodyweight set is real training and not volume anybody can add up.
    expect(totalVolumeKg(exercises)).toBe(80 * 10 + 80 * 8)
  })

  test('T-SPC-UNIT-46 does not count a set nobody ticked', () => {
    const untouched = exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, done: false })),
    }))

    expect(totalVolumeKg(untouched)).toBe(0)
    expect(canFinish(untouched)).toBe(false)
  })

  test('T-SPC-UNIT-47 will not close a session with nothing in it', () => {
    // The server refuses it too: an empty session in the history is a lie.
    expect(canFinish([])).toBe(false)
    expect(canFinish(exercises)).toBe(true)
  })

  test('T-SPC-UNIT-48 reads the clock in minutes until it needs hours', () => {
    expect(elapsedLabel(0)).toBe('0:00')
    expect(elapsedLabel(65)).toBe('1:05')
    expect(elapsedLabel(3_725)).toBe('1:02:05')
    expect(elapsedLabel(-4)).toBe('0:00')
  })
})

describe('what travels to the server', () => {
  test('T-SPC-UNIT-49 sends the ticked sets and nothing else', () => {
    const sent = resultsFrom([
      {
        position: 1,
        movementId: MOVEMENT,
        movement: 'Press de banca',
        sets: [
          { order: 1, loadKg: '80', reps: '10', done: true, previous: '—' },
          { order: 2, loadKg: '80', reps: '8', done: false, previous: '—' },
        ],
      },
    ])

    expect(sent.strength_sets).toEqual([
      { order: 1, movement_id: MOVEMENT, achieved_reps: 10, load: { value: 80, unit: 'kg' } },
    ])
  })

  test('T-SPC-UNIT-50 declares no segmentation, because the session froze its own', () => {
    const sent = resultsFrom([
      {
        position: 1,
        movementId: null,
        movement: 'Plancha',
        sets: [{ order: 1, loadKg: '', reps: '', done: true, previous: '—' }],
      },
    ])

    expect(sent.segments).toBeUndefined()
    expect(sent.strength_sets).toEqual([{ order: 1 }])
  })
})

describe('exercises added while the session runs', () => {
  const ADDED = '019e4000-0000-7000-8000-000000000603'

  test('T-SPC-UNIT-90 lands at the end with three empty rows on the next rungs', () => {
    const next = withAddedExercises(workingStateFrom(execution()), [
      { id: ADDED, name: 'Curl de bíceps' },
    ])

    expect(next).toHaveLength(3)
    expect(next[2]).toMatchObject({ position: 3, movementId: ADDED, movement: 'Curl de bíceps' })
    // Four and three planned rows before it, so its ladder starts at eight.
    expect(next[2]?.sets.map((set) => set.order)).toEqual([8, 9, 10])
    expect(next[2]?.sets.every((set) => !set.done && set.loadKg === '')).toBe(true)
  })

  test('T-SPC-UNIT-91 a movement already in the session is not added twice', () => {
    const next = withAddedExercises(workingStateFrom(execution()), [
      { id: MOVEMENT, name: 'Press de banca' },
    ])

    expect(next).toHaveLength(2)
  })

  test('T-SPC-UNIT-92 comes back from its recorded sets, named by the library', () => {
    const resumed = workingStateFrom(
      execution({
        results: [
          {
            family: 'strength',
            set_order: 8,
            movement_id: ADDED,
            achieved_reps: 10,
            load_value: 12,
          },
        ],
      }),
      { names: new Map([[ADDED, 'Curl de bíceps']]) },
    )

    expect(resumed).toHaveLength(3)
    expect(resumed[2]).toMatchObject({ movementId: ADDED, movement: 'Curl de bíceps' })
    expect(resumed[2]?.sets[0]).toMatchObject({ loadKg: '12', reps: '10', done: true })
    // The recorded set plus the empty rows an added exercise opens with.
    expect(resumed[2]?.sets).toHaveLength(3)
  })

  test('T-SPC-UNIT-93 keeps one added but not yet recorded, so minimising does not lose it', () => {
    const resumed = workingStateFrom(execution(), {
      added: [{ id: ADDED, name: 'Curl de bíceps' }],
    })

    expect(resumed.map((exercise) => exercise.movementId)).toEqual([MOVEMENT, OTHER, ADDED])
  })

  test('T-SPC-UNIT-94 an added movement the library does not name still gets a label', () => {
    const resumed = workingStateFrom(
      execution({ results: [{ family: 'strength', set_order: 8, movement_id: ADDED }] }),
    )

    expect(resumed[2]?.movement).toBe('Ejercicio')
  })

  test('T-SPC-UNIT-95 what was added is remembered per session, not across them', () => {
    rememberAdded('session-a', [{ id: ADDED, name: 'Curl de bíceps' }])
    rememberAdded('session-a', [{ id: OTHER, name: 'Fondos' }])

    expect(addedDuring('session-a').map((one) => one.id)).toEqual([ADDED, OTHER])
    expect(addedDuring('session-b')).toEqual([])
  })
})
