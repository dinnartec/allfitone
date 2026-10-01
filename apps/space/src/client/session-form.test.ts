import { describe, expect, test } from 'bun:test'

import {
  chainedExercise,
  movedExercise,
  restAfter,
  resumesWith,
  withRest,
  unchainedExercise,
  withoutExercise,
  withTick,
  setMark,
  withSetKind,
  withSetRpe,
  canFinish,
  musclesLine,
  clockParts,
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
    exercises: [],
    ...overrides,
  }
}

type Listed = Execution['exercises'][number]

function exercise(
  position: number,
  movementId: string,
  movement: string,
  overrides: Partial<Listed> = {},
): Listed {
  return {
    position,
    movement_id: movementId,
    movement,
    planned_step_id: null,
    superset_group: null,
    rest_seconds: null,
    target: { family: 'strength', target_sets: 2, target_reps: 10 },
    previous: [],
    sets: [],
    ...overrides,
  }
}

/** Press and dips as the session lists them, chained, like the plan above. */
function listed(): Listed[] {
  return [
    exercise(1, MOVEMENT, 'Press de banca', { superset_group: 1 }),
    exercise(2, OTHER, 'Fondos', { superset_group: 1 }),
  ]
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
          sets: [{ order: 1, loadKg: '', reps: '8', done: false, previous: '—', kind: 'normal' }],
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
        { order: 1, loadKg: '80', reps: '10', done: true, previous: '—', kind: 'normal' },
        { order: 2, loadKg: '80', reps: '8', done: true, previous: '—', kind: 'normal' },
        { order: 3, loadKg: '', reps: '8', done: false, previous: '—', kind: 'normal' },
      ],
    },
    {
      position: 2,
      movementId: null,
      movement: 'Fondos',
      sets: [{ order: 4, loadKg: '', reps: '12', done: true, previous: '—', kind: 'normal' }],
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

  test('T-SPC-UNIT-147 past an hour the clock leads with hours and minutes, seconds aside', () => {
    expect(clockParts(3_725)).toEqual({ lead: '1:02', tail: ':05' })
    // Under an hour, minutes and seconds are the whole clock.
    expect(clockParts(65)).toEqual({ lead: '1:05', tail: '' })
    expect(clockParts(-4)).toEqual({ lead: '0:00', tail: '' })
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
          { order: 1, loadKg: '80', reps: '10', done: true, previous: '—', kind: 'normal' },
          { order: 2, loadKg: '80', reps: '8', done: false, previous: '—', kind: 'normal' },
        ],
      },
    ])

    // The kind always travels: the screen knows it, and the database would guess normal.
    expect(sent.strength_sets).toEqual([
      {
        order: 1,
        movement_id: MOVEMENT,
        achieved_reps: 10,
        load: { value: 80, unit: 'kg' },
        kind: 'normal',
        // Which exercise it belongs to, so the same movement twice keeps apart (ADR-034).
        exercise_position: 1,
      },
    ])
  })

  test('T-SPC-UNIT-50 declares no segmentation, because the session froze its own', () => {
    const sent = resultsFrom([
      {
        position: 1,
        movementId: null,
        movement: 'Plancha',
        sets: [{ order: 1, loadKg: '', reps: '', done: true, previous: '—', kind: 'normal' }],
      },
    ])

    expect(sent.segments).toBeUndefined()
    expect(sent.strength_sets).toEqual([{ order: 1, kind: 'normal', exercise_position: 1 }])
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

  test('T-SPC-UNIT-93 an added exercise with nothing ticked comes back from the session', () => {
    // It is in the session's own list now, so neither minimising nor a restart drops it.
    const resumed = workingStateFrom(
      execution({
        exercises: [...listed(), exercise(3, ADDED, 'Curl de bíceps', { target: null })],
      }),
    )

    expect(resumed.map((one) => one.movementId)).toEqual([MOVEMENT, OTHER, ADDED])
    expect(resumed[2]?.sets).toHaveLength(3)
  })

  test('T-SPC-UNIT-94 an added movement the library does not name still gets a label', () => {
    const resumed = workingStateFrom(
      execution({ results: [{ family: 'strength', set_order: 8, movement_id: ADDED }] }),
    )

    expect(resumed[2]?.movement).toBe('Ejercicio')
  })
})

describe('what kind each set is, and how hard it was', () => {
  const planned = execution({
    planned: [
      {
        position: 1,
        movement_id: MOVEMENT,
        movement: 'Sentadilla',
        target: { family: 'strength', target_sets: 3, target_reps: 8 },
        sets: [
          {
            set_order: 1,
            kind: 'warmup',
            target_reps: 12,
            target_load_value: null,
            target_load_unit_code: null,
          },
          {
            set_order: 2,
            kind: 'normal',
            target_reps: 8,
            target_load_value: null,
            target_load_unit_code: null,
          },
          {
            set_order: 3,
            kind: 'to_failure',
            target_reps: null,
            target_load_value: null,
            target_load_unit_code: null,
          },
        ],
      },
    ],
  })

  test('T-SPC-UNIT-96 each row opens with the kind and reps the routine asked for', () => {
    const [first] = workingStateFrom(planned)

    expect(first?.sets.map((set) => set.kind)).toEqual(['warmup', 'normal', 'to_failure'])
    // To failure has no number to aim for: the number is whatever comes.
    expect(first?.sets.map((set) => set.reps)).toEqual(['12', '8', ''])
  })

  test('T-SPC-UNIT-97 what was recorded wins over what was planned, the kind too', () => {
    const [first] = workingStateFrom({
      ...planned,
      results: [
        {
          family: 'strength',
          set_order: 1,
          movement_id: MOVEMENT,
          achieved_reps: 10,
          kind: 'normal',
          rpe: 7,
        },
      ],
    })

    expect(first?.sets[0]).toMatchObject({ kind: 'normal', reps: '10', done: true, rpe: 7 })
  })

  test("T-SPC-UNIT-98 changing one set's kind leaves the rest alone", () => {
    const next = withSetKind(workingStateFrom(planned), 1, 2, 'drop')

    expect(next[0]?.sets.map((set) => set.kind)).toEqual(['warmup', 'drop', 'to_failure'])
  })

  test('T-SPC-UNIT-99 an effort can be marked and taken back', () => {
    const marked = withSetRpe(workingStateFrom(planned), 1, 2, 8)
    expect(marked[0]?.sets[1]?.rpe).toBe(8)

    const cleared = withSetRpe(marked, 1, 2, undefined)
    expect(cleared[0]?.sets[1]?.rpe).toBeUndefined()
  })

  test('T-SPC-UNIT-100 sends the kind and the effort, and no effort when none was marked', () => {
    const ticked = workingStateFrom(planned).map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, done: true, loadKg: '100', reps: '5' })),
    }))
    const sent = resultsFrom(withSetRpe(ticked, 1, 2, 9)).strength_sets ?? []

    expect(sent.map((set) => set.kind)).toEqual(['warmup', 'normal', 'to_failure'])
    expect(sent.map((set) => set.rpe)).toEqual([undefined, 9, undefined])
  })

  test('T-SPC-UNIT-101 a warmup is not work: not in the count, not in the volume', () => {
    const ticked = workingStateFrom(planned).map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set, done: true, loadKg: '100', reps: '5' })),
    }))

    expect(setsProgress(ticked)).toEqual({ done: 2, planned: 2 })
    expect(totalVolumeKg(ticked)).toBe(2 * 100 * 5)
  })

  test('T-SPC-UNIT-102 the mark numbers the working sets and letters the rest', () => {
    const sets = withSetKind(workingStateFrom(planned), 1, 2, 'drop')[0]?.sets ?? []

    expect(sets.map((_, index) => setMark(sets, index))).toEqual(['W', 'D', 'F'])
    const plain = withSetKind(workingStateFrom(planned), 1, 2, 'normal')[0]?.sets ?? []
    expect(plain.map((_, index) => setMark(plain, index))).toEqual(['W', '1', 'F'])
  })
})

describe('ticking a set with no weight typed', () => {
  const withHistory = execution({
    planned: [
      {
        position: 1,
        movement_id: MOVEMENT,
        movement: 'Press de banca',
        target: { family: 'strength', target_sets: 3, target_reps: 8 },
        previous: [
          { load_value: 60, achieved_reps: 8 },
          { load_value: null, achieved_reps: 8 },
        ],
      },
    ],
  })

  test('T-SPC-UNIT-103 takes the weight it lifted last time', () => {
    const next = withTick(workingStateFrom(withHistory), 1, 1)

    expect(next[0]?.sets[0]).toMatchObject({ done: true, loadKg: '60' })
  })

  test('T-SPC-UNIT-104 or, with no last time, the weight of the set above', () => {
    const first = withTick(workingStateFrom(withHistory), 1, 1)
    const next = withTick(first, 1, 2)

    expect(next[0]?.sets[1]).toMatchObject({ done: true, loadKg: '60' })
  })

  test('T-SPC-UNIT-105 a weight somebody typed is theirs and stays', () => {
    const typed = workingStateFrom(withHistory).map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => (set.order === 1 ? { ...set, loadKg: '62.5' } : set)),
    }))

    expect(withTick(typed, 1, 1)[0]?.sets[0]?.loadKg).toBe('62.5')
  })

  test('T-SPC-UNIT-106 unticking leaves the weight where it was', () => {
    const ticked = withTick(workingStateFrom(withHistory), 1, 1)
    const unticked = withTick(ticked, 1, 1)

    expect(unticked[0]?.sets[0]).toMatchObject({ done: false, loadKg: '60' })
  })

  test('T-SPC-UNIT-107 a warmup lends no weight to a working set', () => {
    const warm = withSetKind(workingStateFrom(execution()), 1, 1, 'warmup').map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => (set.order === 1 ? { ...set, loadKg: '20' } : set)),
    }))

    expect(withTick(warm, 1, 2)[0]?.sets[1]).toMatchObject({ done: true, loadKg: '' })
  })
})

describe('a set added mid-exercise', () => {
  const typed = (): readonly WorkingExercise[] =>
    workingStateFrom(execution()).map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) =>
        set.order === 4 ? { ...set, loadKg: '82.5', reps: '6' } : set,
      ),
    }))

  test('T-SPC-UNIT-108 repeats the set above: its weight, reps and kind', () => {
    const [press] = withExtraSet(withSetKind(typed(), 1, 4, 'drop'), 1)
    const added = press?.sets.at(-1)

    expect(added).toMatchObject({ loadKg: '82.5', reps: '6', kind: 'drop', done: false })
  })

  test('T-SPC-UNIT-109 after a warmup it is a working set, not another warmup', () => {
    const [press] = withExtraSet(withSetKind(typed(), 1, 4, 'warmup'), 1)

    expect(press?.sets.at(-1)?.kind).toBe('normal')
  })

  test('T-SPC-UNIT-110 it is never born ticked, whatever the set above was', () => {
    const ticked = withTick(typed(), 1, 4)
    const [press] = withExtraSet(ticked, 1)

    expect(press?.sets.at(-1)?.done).toBe(false)
    expect(press?.sets.at(-1)?.rpe).toBeUndefined()
  })
})

describe('the session is its own list of exercises', () => {
  const THIRD = '019e4000-0000-7000-8000-000000000604'
  const three = () =>
    execution({
      exercises: [...listed(), exercise(3, MOVEMENT, 'Press de banca', { target: null })],
      results: [
        {
          family: 'strength',
          set_order: 1,
          exercise_position: 1,
          movement_id: MOVEMENT,
          achieved_reps: 8,
        },
        {
          family: 'strength',
          set_order: 2,
          exercise_position: 3,
          movement_id: MOVEMENT,
          achieved_reps: 12,
        },
      ],
    })

  test("T-SPC-UNIT-111 opens in the session's order, with its supersets and its own sets", () => {
    const state = workingStateFrom(three())

    expect(state.map((one) => one.supersetGroup)).toEqual([1, 1, undefined])
    // The same movement twice keeps two separate sets: each set knows its exercise.
    expect(state[0]?.sets[0]).toMatchObject({ reps: '8', done: true })
    expect(state[2]?.sets[0]).toMatchObject({ reps: '12', done: true })
  })

  test('T-SPC-UNIT-112 taking one out closes the gap and dissolves a superset of one', () => {
    const next = withoutExercise(workingStateFrom(three()), 2)

    expect(next.map((one) => one.position)).toEqual([1, 2])
    expect(next[0]?.supersetGroup).toBeUndefined()
    // The ladder is one per session, so it closes too.
    expect(next.flatMap((one) => one.sets.map((set) => set.order))).toEqual([1, 2, 3, 4, 5])
  })

  test('T-SPC-UNIT-113 moving a superset moves it whole', () => {
    const next = movedExercise(workingStateFrom(three()), 3, 1)

    expect(next.map((one) => `${one.movement}${one.supersetGroup ?? ''}`)).toEqual([
      'Press de banca',
      'Press de banca1',
      'Fondos1',
    ])
  })

  test('T-SPC-UNIT-114 chaining brings the other alongside, and unchaining lets it go', () => {
    const loose = unchainedExercise(workingStateFrom(three()), 2)
    const chained = chainedExercise(loose, 3, 1)

    // The one who asked stays put and the other comes alongside, as in the editor.
    expect(chained.map((one) => one.supersetGroup !== undefined)).toEqual([false, true, true])
    expect(chained[2]?.sets[0]?.reps).toBe('12')
  })

  test('T-SPC-UNIT-115 sends the list, and where each ticked set belongs', () => {
    const sent = resultsFrom(workingStateFrom(three()))

    expect(sent.exercises).toEqual([
      {
        position: 1,
        movement_id: MOVEMENT,
        planned_step_id: null,
        superset_group: 1,
        rest_seconds: null,
      },
      {
        position: 2,
        movement_id: OTHER,
        planned_step_id: null,
        superset_group: 1,
        rest_seconds: null,
      },
      {
        position: 3,
        movement_id: MOVEMENT,
        planned_step_id: null,
        superset_group: null,
        rest_seconds: null,
      },
    ])
    expect(sent.strength_sets?.map((set) => set.exercise_position)).toEqual([1, 3])
  })

  test('T-SPC-UNIT-116 a session with no list yet reads its plan, as it always did', () => {
    expect(workingStateFrom(execution()).map((one) => one.movementId)).toEqual([MOVEMENT, OTHER])
    expect(THIRD).toBeTruthy()
  })
})

describe('the rest between sets (ADR-035)', () => {
  const CURL = '019e4000-0000-7000-8000-000000000605'
  const ROW = '019e4000-0000-7000-8000-000000000606'

  /** Press and dips chained, then a lone curl, each with a rest of its own. */
  const rested = () =>
    workingStateFrom(
      execution({
        exercises: [
          exercise(1, MOVEMENT, 'Press de banca', { superset_group: 1, rest_seconds: 60 }),
          exercise(2, OTHER, 'Fondos', { superset_group: 1, rest_seconds: 90 }),
          exercise(3, CURL, 'Curl', { rest_seconds: 120 }),
        ],
      }),
    )

  test('T-SPC-UNIT-117 each exercise opens with the rest its list carries', () => {
    expect(rested().map((one) => one.restSeconds)).toEqual([60, 90, 120])
  })

  test('T-SPC-UNIT-118 a lone exercise rests its own rest', () => {
    expect(restAfter(rested(), 3)).toBe(120)
  })

  test('T-SPC-UNIT-119 inside a chain each exercise rests its own rest too', () => {
    expect(restAfter(rested(), 1)).toBe(60)
    expect(restAfter(rested(), 2)).toBe(90)
  })

  test('T-SPC-UNIT-120 a rest of zero, «Ninguno», starts nothing', () => {
    expect(restAfter(withRest(rested(), 2, 0), 2)).toBeUndefined()
  })

  test('T-SPC-UNIT-130 a routine that says nothing about rest rests the opening minute and a half', () => {
    const unsaid = withRest(rested(), 3, undefined)

    expect(restAfter(unsaid, 3)).toBe(90)
    expect(restAfter(withRest(rested(), 2, undefined), 2)).toBe(90)
  })

  test("T-SPC-UNIT-121 changing it is today's, and travels with the list", () => {
    const sent = resultsFrom(withRest(rested(), 3, 45))

    expect(sent.exercises?.map((one) => one.rest_seconds)).toEqual([60, 90, 45])
  })

  test('T-SPC-UNIT-129 after resting comes the same exercise, or the first of its chain', () => {
    expect(resumesWith(rested(), 3)).toEqual({ movement: 'Curl', chained: false })
    expect(resumesWith(rested(), 2)).toEqual({ movement: 'Press de banca', chained: false })
  })

  test("T-SPC-UNIT-131 mid-chain, what comes next is the chain's next exercise", () => {
    expect(resumesWith(rested(), 1)).toEqual({ movement: 'Fondos', chained: true })
  })

  /** Every set of that exercise ticked, the way the last tick leaves it. */
  const finished = (exercises: ReturnType<typeof rested>, position: number) =>
    (exercises.find((one) => one.position === position)?.sets ?? []).reduce(
      (state, set) => (set.done ? state : withTick(state, position, set.order)),
      exercises,
    )

  /** A lone curl first, then press and dips chained, then a lone row. */
  const loneFirst = () =>
    workingStateFrom(
      execution({
        exercises: [
          exercise(1, CURL, 'Curl'),
          exercise(2, MOVEMENT, 'Press de banca', { superset_group: 1 }),
          exercise(3, OTHER, 'Fondos', { superset_group: 1 }),
          exercise(4, ROW, 'Remo'),
        ],
      }),
    )

  test('T-SPC-UNIT-143 the last set of an exercise leads to the next exercise, not itself', () => {
    expect(resumesWith(finished(loneFirst(), 1), 1)).toEqual({
      movement: 'Press de banca',
      chained: false,
    })
  })

  test('T-SPC-UNIT-144 a superset finished leads past the whole chain', () => {
    const done = finished(finished(loneFirst(), 2), 3)

    expect(resumesWith(done, 3)).toEqual({ movement: 'Remo', chained: false })
  })

  test('T-SPC-UNIT-145 an exercise already finished is skipped on the way', () => {
    const done = finished(finished(finished(loneFirst(), 2), 3), 1)

    expect(resumesWith(done, 1)).toEqual({ movement: 'Remo', chained: false })
  })

  test('T-SPC-UNIT-146 the last exercise finished has nothing left to name', () => {
    expect(resumesWith(finished(loneFirst(), 4), 4)).toEqual({ movement: '', chained: false })
  })

  test('T-SPC-UNIT-122 an exercise added in the session comes with no rest', () => {
    const added = withAddedExercises(rested(), [{ id: 'new-movement', name: 'Remo' }])

    expect(added.at(-1)?.restSeconds).toBeUndefined()
    expect(resultsFrom(added).exercises?.at(-1)?.rest_seconds).toBeNull()
  })
})

describe('what the session trains, under its name', () => {
  const muscles = [
    { code: 'quads', name: 'Cuádriceps', region: 'lower' as const, body_slug: null },
    { code: 'chest', name: 'Pecho', region: 'upper' as const, body_slug: null },
    { code: 'back', name: 'Espalda', region: 'upper' as const, body_slug: null },
    { code: 'abs', name: 'Abdomen', region: 'general' as const, body_slug: null },
  ]
  const movements = [
    { id: 'squat', muscles: ['quads', 'abs'] },
    { id: 'press', muscles: ['chest'] },
    { id: 'row', muscles: ['back'] },
    { id: 'plank', muscles: ['abs'] },
    { id: 'mystery', muscles: [] },
  ]
  const sets = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      order: index + 1,
      loadKg: '',
      reps: '',
      done: false,
      previous: '—',
      kind: 'normal' as const,
    }))
  const working = (position: number, movementId: string, count: number) => ({
    position,
    movementId,
    movement: movementId,
    sets: sets(count),
  })

  test('T-SPC-UNIT-148 names the main muscle of each exercise, most worked first', () => {
    const line = musclesLine(
      [working(1, 'press', 2), working(2, 'squat', 4), working(3, 'row', 3)],
      movements,
      muscles,
    )

    expect(line).toBe('Cuádriceps · Espalda · Pecho')
  })

  test('T-SPC-UNIT-149 stops at three, and an exercise with no muscles adds nothing', () => {
    const line = musclesLine(
      [
        working(1, 'press', 1),
        working(2, 'squat', 4),
        working(3, 'row', 3),
        working(4, 'plank', 2),
        working(5, 'mystery', 9),
      ],
      movements,
      muscles,
    )

    expect(line).toBe('Cuádriceps · Espalda · Abdomen')
  })

  test('T-SPC-UNIT-150 a session with nothing curated has no line at all', () => {
    expect(musclesLine([working(1, 'mystery', 3)], movements, muscles)).toBe('')
  })
})
