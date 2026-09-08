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
  test('T-SP-ROUTINE-06 positions are renumbered from one, whatever they were', () => {
    const content = stepsToContent('Empuje', [step(7, 'A'), step(9, 'B')])

    expect(content.steps.map((one) => one.position)).toEqual([1, 2])
  })

  test('T-SP-ROUTINE-07 rest is sent only when somebody set it', () => {
    const content = stepsToContent('Empuje', [{ ...step(1, 'A'), restSeconds: 90 }, step(2, 'B')])

    expect(content.steps[0]?.target).toHaveProperty('target_rest_seconds', 90)
    expect(content.steps[1]?.target).not.toHaveProperty('target_rest_seconds')
  })

  test('T-SP-ROUTINE-08 the title is trimmed, because the database trims it too', () => {
    expect(stepsToContent('  Empuje  ', []).title).toBe('Empuje')
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
