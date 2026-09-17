/**
 * `T-SP-SETS-01..08` — the sets of an exercise, their kind, their load and its unit.
 *
 * The rule with teeth is the one the database also enforces: a set to failure has no
 * repetitions. Both sides refuse it, which is deliberate — the screen should not be
 * able to compose a prescription the server will reject.
 */

import { describe, expect, test } from 'bun:test'

import {
  OPENING_SETS,
  OPENING_UNIT,
  REST_PRESETS,
  SET_KIND_NAMES,
  SET_KIND_TONES,
  loadLabel,
  otherUnit,
  restLabel,
  setsLabel,
  withKind,
  withLoad,
  withReps,
} from './set-scheme'

describe('what an exercise opens with', () => {
  test('T-SP-SETS-01 four working sets, every one of them editable', () => {
    expect(OPENING_SETS).toHaveLength(4)
    expect(OPENING_SETS.every((one) => one.kind === 'normal' && one.reps === 8)).toBe(true)
  })

  test('T-SP-SETS-02 and no weight, because nobody invents one for another person', () => {
    expect(OPENING_SETS.every((one) => one.load === undefined)).toBe(true)
  })

  test("T-SP-SETS-03 it opens in the catalogue's canonical mass", () => {
    expect(OPENING_UNIT).toBe('kg')
    expect(otherUnit(OPENING_UNIT)).toBe('lb')
    expect(otherUnit(otherUnit(OPENING_UNIT))).toBe(OPENING_UNIT)
  })

  test('T-SP-SETS-04 only the ordinary kind goes uncoloured, so the exceptions show', () => {
    expect(SET_KIND_TONES.normal).toBe('neutral')
    const exceptions = (['warmup', 'to_failure', 'drop'] as const).map(
      (kind) => SET_KIND_TONES[kind],
    )

    expect(exceptions).not.toContain('neutral')
    expect(new Set(exceptions).size).toBe(exceptions.length)
  })
})

describe('changing what a set is', () => {
  test('T-SP-SETS-05 turning a set to failure drops its repetitions', () => {
    // The pair is refused by the database rather than corrected, so composing it here
    // would mean a screen that can only fail.
    expect(withKind({ kind: 'normal', reps: 8 }, 'to_failure')).toEqual({ kind: 'to_failure' })
  })

  test('T-SP-SETS-06 and turning it back gives it a number to edit', () => {
    expect(withKind({ kind: 'to_failure' }, 'normal').reps).toBe(8)
  })

  test('T-SP-SETS-09 changing the kind keeps the weight, which the kind says nothing about', () => {
    expect(withKind({ kind: 'normal', reps: 8, load: 60 }, 'to_failure')).toEqual({
      kind: 'to_failure',
      load: 60,
    })
  })

  test('T-SP-SETS-11 clearing a number drops the key, it does not carry an undefined', () => {
    expect(withLoad({ kind: 'normal', reps: 8, load: 60 }, undefined)).toEqual({
      kind: 'normal',
      reps: 8,
    })
    expect('load' in withLoad({ kind: 'normal', reps: 8, load: 60 }, undefined)).toBe(false)
    expect(withReps({ kind: 'normal', reps: 8 }, undefined)).toEqual({ kind: 'normal' })
  })

  test('T-SP-SETS-12 zero is a weight somebody meant, so it survives', () => {
    expect(withLoad({ kind: 'normal', reps: 8 }, 0)).toEqual({ kind: 'normal', reps: 8, load: 0 })
  })

  test('T-SP-SETS-10 a set nobody has loaded says so rather than showing a zero', () => {
    expect(loadLabel(undefined, 'kg')).toBe('—')
    expect(loadLabel(0, 'kg')).toBe('0 kg')
    expect(loadLabel(60, 'lb')).toBe('60 lb')
  })
})

describe('what the row says', () => {
  test('T-SP-SETS-07 sets that agree read as a multiplication, and ones that differ do not', () => {
    expect(
      setsLabel([
        { kind: 'normal', reps: 8 },
        { kind: 'normal', reps: 8 },
      ]),
    ).toBe('2 × 8')
    expect(
      setsLabel([
        { kind: 'normal', reps: 12 },
        { kind: 'normal', reps: 8 },
      ]),
    ).toBe('2 series · varía')
    expect(setsLabel([])).toBe('Sin series')
  })

  test('T-SP-SETS-08 rest reads as a clock, and none is different from zero', () => {
    expect(restLabel(90)).toBe('1 min 30 s')
    expect(restLabel(120)).toBe('2 min')
    expect(restLabel(45)).toBe('45 s')
    // Nobody said and "no rest" are different instructions, so they read differently.
    expect(restLabel(0)).toBe('Sin descanso')
    expect(restLabel(undefined)).toBe('Sin descanso definido')
  })

  test('T-SP-SETS-09 every preset has a label somebody can read', () => {
    for (const preset of REST_PRESETS) {
      expect(restLabel(preset).length).toBeGreaterThan(0)
    }
    expect(Object.keys(SET_KIND_NAMES)).toHaveLength(4)
  })
})
