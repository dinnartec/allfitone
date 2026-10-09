/**
 * What a nutrition goal adds up to (N-6d).
 *
 * The goal screen draws each macro's share of the day's energy — a ring with «26 % de
 * kcal» and a bar split by colour — and the editor heads each macro with its kilocalories.
 * Those figures come from the goal as typed, so the rules live here: a range counts at
 * its middle, a nutrient without a goal counts as nothing, and no share is invented when
 * there is no energy to take it from.
 */

import { describe, expect, test } from 'bun:test'

import type { FormTarget, GoalForm } from './nutrition'
import {
  energyOf,
  energyScale,
  fractionOf,
  valueAt,
  gramsOf,
  macroKcal,
  macroShares,
  modeCaption,
  orderedRange,
  START,
  withMode,
} from './goal-energy'

const none: FormTarget = { mode: 'none', low: null, high: null }
const form = (patch: Partial<GoalForm>): GoalForm => ({
  energy: { mode: 'exact', low: 2000, high: null },
  protein: none,
  carbohydrates: none,
  fat: none,
  fiber: none,
  water: none,
  ...patch,
})

describe('the goal in grams and kilocalories', () => {
  test('T-SPC-UNIT-267 a target counts its value, a range its middle, no goal nothing', () => {
    expect(gramsOf({ mode: 'exact', low: 150, high: null })).toBe(150)
    expect(gramsOf({ mode: 'minimum', low: 150, high: null })).toBe(150)
    expect(gramsOf({ mode: 'maximum', low: null, high: 70 })).toBe(70)
    expect(gramsOf({ mode: 'range', low: 220, high: 260 })).toBe(240)
    expect(gramsOf(none)).toBeNull()
    expect(energyOf({ mode: 'range', low: 2100, high: 2500 })).toBe(2300)
  })

  test('T-SPC-UNIT-268 a macro weighs 4, 4 or 9 kcal a gram; fibre and water none', () => {
    expect(macroKcal('protein', { mode: 'minimum', low: 150, high: null })).toBe(600)
    expect(macroKcal('carbohydrates', { mode: 'range', low: 220, high: 260 })).toBe(960)
    expect(macroKcal('fat', { mode: 'maximum', low: null, high: 70 })).toBe(630)
    expect(macroKcal('fiber', { mode: 'minimum', low: 30, high: null })).toBeNull()
    expect(macroKcal('protein', none)).toBeNull()
  })

  test('T-SPC-UNIT-269 each macro takes its share of the energy, and only a macro with a goal', () => {
    const shares = macroShares(
      form({
        energy: { mode: 'exact', low: 2300, high: null },
        protein: { mode: 'minimum', low: 150, high: null },
        carbohydrates: { mode: 'range', low: 220, high: 260 },
      }),
    )
    expect(shares.protein).toBeCloseTo(600 / 2300)
    expect(shares.carbohydrates).toBeCloseTo(960 / 2300)
    expect(shares.fat).toBeNull()
  })

  test('T-SPC-UNIT-270 no share without energy, and none past the whole', () => {
    const empty = macroShares(
      form({
        energy: none,
        protein: { mode: 'exact', low: 150, high: null },
      }),
    )
    expect(empty.protein).toBeNull()
    const over = macroShares(
      form({
        energy: { mode: 'exact', low: 500, high: null },
        fat: { mode: 'exact', low: 100, high: null },
      }),
    )
    expect(over.fat).toBe(1)
  })
})

describe('what each kind of target is called', () => {
  test('T-SPC-UNIT-271 the field says what kind of target it holds, capitalised', () => {
    expect(modeCaption('minimum', 'low')).toBe('Al menos')
    expect(modeCaption('maximum', 'high')).toBe('Como máximo')
    expect(modeCaption('exact', 'low')).toBe('Exactamente')
    expect(modeCaption('range', 'low')).toBe('Desde')
    expect(modeCaption('range', 'high')).toBe('Hasta')
  })

  test('T-SPC-UNIT-272 a target moved to another kind keeps what it can of its value', () => {
    const minimum: FormTarget = { mode: 'minimum', low: 150, high: null }
    expect(withMode('protein', minimum, 'maximum')).toEqual({
      mode: 'maximum',
      low: null,
      high: 150,
    })
    expect(withMode('protein', minimum, 'range')).toEqual({ mode: 'range', low: 150, high: 165 })
    expect(withMode('protein', minimum, 'none')).toEqual(none)
    // A range opened from nothing starts round, on the nutrient's own step: 200–240, not 198–242.
    expect(withMode('carbohydrates', none, 'range')).toEqual({ mode: 'range', low: 200, high: 240 })
    expect(withMode('protein', none, 'exact')).toEqual({
      mode: 'exact',
      low: START.protein.value,
      high: null,
    })
  })

  test('T-SPC-UNIT-273 a range typed backwards is put the right way round', () => {
    expect(orderedRange({ mode: 'range', low: 900, high: 240 })).toEqual({
      mode: 'range',
      low: 240,
      high: 900,
    })
    const fine: FormTarget = { mode: 'range', low: 200, high: 240 }
    expect(orderedRange(fine)).toBe(fine)
    const minimum: FormTarget = { mode: 'minimum', low: 150, high: null }
    expect(orderedRange(minimum)).toBe(minimum)
  })
})

describe('the energy slider', () => {
  test('T-SPC-UNIT-274 the scale stays put, and only widens to take a figure typed past it', () => {
    // The same for any goal inside it: a handle let go stays where it was let go.
    expect(energyScale(2100, 2400)).toEqual({ min: 1000, mid: 2500, max: 4000 })
    expect(energyScale(1500, 1500)).toEqual({ min: 1000, mid: 2500, max: 4000 })
    // Past an end, the end moves out to the next 500, and only that end.
    expect(energyScale(2000, 4300)).toEqual({ min: 1000, mid: 2750, max: 4500 })
    expect(energyScale(800, 2000)).toEqual({ min: 500, mid: 2250, max: 4000 })
  })

  test('T-SPC-UNIT-275 a value sits on the scale, and a place on it reads back on the step', () => {
    const scale = { min: 1000, mid: 2500, max: 4000 }
    expect(fractionOf(2500, scale)).toBe(0.5)
    expect(fractionOf(500, scale)).toBe(0)
    expect(fractionOf(9000, scale)).toBe(1)
    expect(valueAt(0.5, scale, 50)).toBe(2500)
    expect(valueAt(0.37, scale, 50)).toBe(2100)
    expect(valueAt(-1, scale, 50)).toBe(1000)
  })
})
