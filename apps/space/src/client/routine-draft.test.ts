/**
 * What has to be true about a routine before it can be published.
 *
 * These are the reasons `V-G` shows. They mirror `session_content_errors`, so the
 * value here is that the wording is right and that positions are renumbered — a gap
 * in `position` is refused by the database, and a screen that removes the second of
 * three exercises must not leave one.
 */

import { describe, expect, test } from 'bun:test'

import {
  countSets,
  reasonsNotToPublish,
  reordered,
  stepsFromContent,
  stepsToContent,
  withPicked,
  withoutStep,
  type WorkingStep,
} from './routine-draft'

const step = (position: number, name: string, sets = 4, reps = 8): WorkingStep => ({
  position,
  movementId: `movement-${position}`,
  name,
  sets: Array.from({ length: sets }, () => ({ kind: 'normal' as const, reps })),
})

describe('what stops a routine from being published', () => {
  test('T-SP-ROUTINE-01 a routine with no name and no exercises is missing two things', () => {
    expect(reasonsNotToPublish('', []).map((issue) => issue.title)).toEqual([
      'La rutina no tiene nombre',
      'La rutina no tiene ejercicios',
    ])
  })

  test('T-SP-ROUTINE-02 whitespace is not a name', () => {
    expect(reasonsNotToPublish('   ', [step(1, 'Sentadilla')])).toHaveLength(1)
  })

  test('T-SP-ROUTINE-03 an exercise with no series is named in the reason', () => {
    const issues = reasonsNotToPublish('Empuje', [step(1, 'Press de banca', 0)])

    expect(issues[0]?.title).toBe('«Press de banca» no tiene ninguna serie')
  })

  test('T-SP-ROUTINE-04 a complete routine has nothing missing', () => {
    expect(reasonsNotToPublish('Empuje', [step(1, 'Press de banca')])).toEqual([])
  })

  test('T-SP-ROUTINE-05 series are counted across exercises, not per exercise', () => {
    expect(countSets([step(1, 'A', 4), step(2, 'B', 3)])).toBe(7)
  })
})

describe('the draft as the contract wants it', () => {
  const ACTIVITY = '019f0000-0000-7000-8000-000000000031'

  test('T-SP-ROUTINE-06 positions are renumbered from one, whatever they were', () => {
    const content = stepsToContent('Empuje', [step(7, 'A'), step(9, 'B')], ACTIVITY)

    expect(content.steps.map((one) => one.position)).toEqual([1, 2])
  })

  test('T-SP-ROUTINE-07 rest is sent only when somebody set it', () => {
    const content = stepsToContent(
      'Empuje',
      [{ ...step(1, 'A'), restSeconds: 90 }, step(2, 'B')],
      ACTIVITY,
    )

    expect(content.steps[0]?.target).toHaveProperty('target_rest_seconds', 90)
    expect(content.steps[1]?.target).not.toHaveProperty('target_rest_seconds')
  })

  test('T-SP-ROUTINE-08 the title is trimmed, because the database trims it too', () => {
    expect(stepsToContent('  Empuje  ', [], ACTIVITY).title).toBe('Empuje')
  })

  test('T-SP-ROUTINE-09 the activity type travels on every save, because null erases it', () => {
    // The defect: the screen sent null, which wiped the type the creation had put in
    // the draft. With no type there is no family to match, so `session_content_errors`
    // answered `target-family` for every step and the whole draft was refused — the
    // routine editor failed the moment somebody picked an exercise.
    const content = stepsToContent('Empuje', [step(1, 'A')], ACTIVITY)

    expect(content.activity_type_id).toBe(ACTIVITY)
  })

  test('T-SP-ROUTINE-10 a weight travels with its unit, or it is not a weight', () => {
    const loaded: WorkingStep = {
      ...step(1, 'A'),
      loadUnit: 'lb',
      sets: [
        { kind: 'normal', reps: 8, load: 135 },
        { kind: 'normal', reps: 8 },
      ],
    }
    const sets = stepsToContent('Empuje', [loaded], ACTIVITY).steps[0]?.target as {
      sets: Record<string, unknown>[]
    }

    expect(sets.sets[0]).toMatchObject({ target_load_value: 135, target_load_unit_code: 'lb' })
    // The column pair is what `planned_sets` checks: half of it is refused.
    expect(sets.sets[1]).not.toHaveProperty('target_load_value')
    expect(sets.sets[1]).not.toHaveProperty('target_load_unit_code')
  })

  test("T-SP-ROUTINE-11 and comes back as the exercise's unit when the draft is reopened", () => {
    const loaded: WorkingStep = {
      ...step(1, 'A'),
      loadUnit: 'lb',
      sets: [{ kind: 'normal', reps: 8, load: 135 }],
    }
    const reopened = stepsFromContent(stepsToContent('Empuje', [loaded], ACTIVITY))

    expect(reopened[0]?.loadUnit).toBe('lb')
    expect(reopened[0]?.sets[0]?.load).toBe(135)
  })

  test('T-SP-ROUTINE-12 a routine nobody weighed carries no unit either', () => {
    const reopened = stepsFromContent(stepsToContent('Empuje', [step(1, 'A')], ACTIVITY))

    expect(reopened[0]?.loadUnit).toBeUndefined()
  })
})

describe('removing and reordering leave no gap', () => {
  test('T-SP-ROUTINE-09 removing the middle exercise renumbers the rest', () => {
    const left = withoutStep([step(1, 'A'), step(2, 'B'), step(3, 'C')], 2)

    expect(left.map((one) => [one.position, one.name])).toEqual([
      [1, 'A'],
      [2, 'C'],
    ])
  })

  test('T-SP-ROUTINE-10 reordering renumbers by the new order and keeps every exercise', () => {
    const moved = reordered([step(1, 'A'), step(2, 'B'), step(3, 'C')], [3, 1, 2])

    expect(moved.map((one) => [one.position, one.name])).toEqual([
      [1, 'C'],
      [2, 'A'],
      [3, 'B'],
    ])
  })

  test('T-SP-ROUTINE-11 an order naming something that is gone drops it rather than a hole', () => {
    expect(reordered([step(1, 'A')], [1, 99]).map((one) => one.name)).toEqual(['A'])
  })
})

describe('a whole batch of exercises arrives at once', () => {
  const picked = [
    { id: 'm-1', name: 'Sentadilla con barra' },
    { id: 'm-2', name: 'Press de banca con barra' },
    { id: 'm-3', name: 'Curl de bíceps con barra' },
  ]

  test('T-SP-ROUTINE-12 three picked are three steps, numbered without a gap', () => {
    // One batch, one save. Adding them one at a time is what the sheet did, and it
    // wrote the draft once per exercise.
    const steps = withPicked([], picked)

    expect(steps.map((one) => one.position)).toEqual([1, 2, 3])
    expect(steps.map((one) => one.movementId)).toEqual(['m-1', 'm-2', 'm-3'])
  })

  test('T-SP-ROUTINE-13 a batch lands after what was already there, renumbered from one', () => {
    const steps = withPicked([step(1, 'A')], picked.slice(0, 2))

    expect(steps.map((one) => one.position)).toEqual([1, 2, 3])
    expect(steps[0]?.name).toBe('A')
  })

  test('T-SP-ROUTINE-14 an exercise already in the routine is not added twice', () => {
    const first = withPicked([], picked)

    expect(withPicked(first, picked).length).toBe(3)
  })

  test('T-SP-ROUTINE-15 a batch opens on the first scheme, which the screen then edits', () => {
    const [first] = withPicked([], picked.slice(0, 1))

    expect(first?.sets).toEqual([
      { kind: 'normal', reps: 8 },
      { kind: 'normal', reps: 8 },
      { kind: 'normal', reps: 8 },
      { kind: 'normal', reps: 8 },
    ])
  })

  test('T-SP-ROUTINE-16 and what is sent is the sets, never the aggregate', () => {
    // The summary is derived at publication. Sending a second copy of a number is
    // sending something that can disagree with the rows it summarises.
    const content = stepsToContent('Empuje', withPicked([], picked.slice(0, 1)), 'activity')
    const target = content.steps[0]?.target as Record<string, unknown>

    expect(target.sets).toHaveLength(4)
    expect(target.target_sets).toBeUndefined()
    expect(target.target_reps).toBeUndefined()
  })

  test('T-SP-ROUTINE-17 a set to failure carries no repetitions, because the number is whatever comes out', () => {
    const failing: WorkingStep = {
      position: 1,
      movementId: 'movement-1',
      name: 'Press',
      sets: [{ kind: 'to_failure' }],
    }
    const target = stepsToContent('Empuje', [failing], 'activity').steps[0]?.target as Record<
      string,
      unknown
    >
    const [only] = target.sets as { kind: string; target_reps?: number }[]

    expect(only?.kind).toBe('to_failure')
    expect(only?.target_reps).toBeUndefined()
    expect(reasonsNotToPublish('Empuje', [failing])).toEqual([])
  })
})
