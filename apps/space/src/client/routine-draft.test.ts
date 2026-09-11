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
  stepsToContent,
  withPicked,
  withoutStep,
  type WorkingStep,
} from './routine-draft'

const step = (position: number, name: string, sets = 4, reps = 8): WorkingStep => ({
  position,
  movementId: `movement-${position}`,
  name,
  sets,
  reps,
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

  test('T-SP-ROUTINE-15 a batch starts at the defaults, which is all the editor can set today', () => {
    const [first] = withPicked([], picked.slice(0, 1))

    expect(first?.sets).toBe(4)
    expect(first?.reps).toBe(8)
  })
})
