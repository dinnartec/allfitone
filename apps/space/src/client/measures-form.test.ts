import { describe, expect, test } from 'bun:test'

import {
  CANONICAL_LENGTH,
  CANONICAL_MASS,
  canSubmitMeasure,
  declarationFor,
  displayIn,
  formatInches,
  otherUnit,
  readingFor,
  RESTING_HEIGHT_CM,
  RESTING_WEIGHT_KG,
  MARK_PITCH,
  SCALES,
  toCanonical,
  tapeOffsetFor,
  tapeValueFor,
  unitFromSaved,
  type MeasureUnit,
} from './measures-form'

/** The same numbers the unit catalogue holds. Drifting apart is the defect. */
const CATALOGUE_FACTORS: Record<MeasureUnit, number> = {
  kg: 1,
  lb: 0.45359237,
  cm: 1,
  in: 2.54,
}

describe('the factors agree with the catalogue', () => {
  test('each unit converts by the factor the database stores', () => {
    // If these ever disagree, the ruler and the stored value describe different
    // people. The database is the authority; this only draws.
    for (const [unit, factor] of Object.entries(CATALOGUE_FACTORS)) {
      expect(toCanonical(1, unit as MeasureUnit)).toBeCloseTo(factor, 10)
    }
  })

  test('the canonical units convert by one, which is what makes them canonical', () => {
    expect(toCanonical(74, CANONICAL_MASS)).toBe(74)
    expect(toCanonical(170, CANONICAL_LENGTH)).toBe(170)
  })
})

describe('the round trip, which is the whole point', () => {
  test('reading in another unit does not move the canonical value', () => {
    // The failure this exists to prevent: storing what is displayed makes
    // 74 kg → 163 lb → 73.9 kg, and somebody's weight changes on its own.
    const canonical = toCanonical(74, 'kg')

    expect(displayIn(canonical, 'lb')).toBe(163)
    expect(displayIn(canonical, 'kg')).toBe(74)
    expect(canonical).toBe(74)
  })

  test('every weight entered in pounds reads back as the same pounds', () => {
    for (let pounds = SCALES.lb.min; pounds <= SCALES.lb.max; pounds += 1) {
      expect(displayIn(toCanonical(pounds, 'lb'), 'lb')).toBe(pounds)
    }
  })

  test('every weight entered in kilos reads back as the same kilos', () => {
    for (let kilos = SCALES.kg.min; kilos <= SCALES.kg.max; kilos += 1) {
      expect(displayIn(toCanonical(kilos, 'kg'), 'kg')).toBe(kilos)
    }
  })

  test('every height entered in inches reads back as the same inches', () => {
    for (let inches = SCALES.in.min; inches <= SCALES.in.max; inches += 1) {
      expect(displayIn(toCanonical(inches, 'in'), 'in')).toBe(inches)
    }
  })

  test('every height entered in centimetres reads back as the same centimetres', () => {
    for (let cm = SCALES.cm.min; cm <= SCALES.cm.max; cm += 1) {
      expect(displayIn(toCanonical(cm, 'cm'), 'cm')).toBe(cm)
    }
  })
})

describe('displayIn', () => {
  test('clamps to the ends of the scale rather than drawing off it', () => {
    expect(displayIn(toCanonical(500, 'kg'), 'kg')).toBe(SCALES.kg.max)
    expect(displayIn(toCanonical(1, 'kg'), 'kg')).toBe(SCALES.kg.min)
  })

  test('snaps to whole units, because the ruler has no half ticks', () => {
    expect(displayIn(74.4, 'kg')).toBe(74)
    expect(displayIn(74.6, 'kg')).toBe(75)
  })
})

describe('formatInches', () => {
  test('renders total inches as feet and inches', () => {
    expect(formatInches(70)).toBe('5′ 10″')
    expect(formatInches(67)).toBe('5′ 7″')
  })

  test('renders an exact number of feet with no inches left over', () => {
    expect(formatInches(72)).toBe('6′ 0″')
  })

  test('covers the whole scale without producing twelve inches', () => {
    // Twelve inches is a foot, and printing it would be a second way to say the
    // same height — which is exactly the disagreement total inches avoids.
    for (let inches = SCALES.in.min; inches <= SCALES.in.max; inches += 1) {
      expect(formatInches(inches)).not.toContain('12″')
    }
  })
})

describe('readingFor', () => {
  test('gives the number and its suffix apart, so the screen formats nothing', () => {
    expect(readingFor(74, 'kg')).toEqual({ text: '74', suffix: 'kg' })
    expect(readingFor(170, 'cm')).toEqual({ text: '170', suffix: 'cm' })
  })

  test('inches carry their marks in the text and need no suffix', () => {
    expect(readingFor(toCanonical(70, 'in'), 'in')).toEqual({ text: '5′ 10″', suffix: '' })
  })
})

describe('otherUnit', () => {
  test('toggles within the dimension and never across it', () => {
    expect(otherUnit('kg')).toBe('lb')
    expect(otherUnit('lb')).toBe('kg')
    expect(otherUnit('cm')).toBe('in')
    expect(otherUnit('in')).toBe('cm')
  })
})

describe('declarationFor', () => {
  test('sends what she read, in the unit she read it in', () => {
    // Not the canonical figure: the database converts, because the factor has one
    // home and it is the catalogue.
    expect(declarationFor(toCanonical(163, 'lb'), 'lb')).toEqual({ value: 163, unit: 'lb' })
    expect(declarationFor(74, 'kg')).toEqual({ value: 74, unit: 'kg' })
  })
})

describe('unitFromSaved', () => {
  test('reopens in the unit she used last time', () => {
    expect(unitFromSaved('lb', 'kg')).toBe('lb')
    expect(unitFromSaved('in', 'cm')).toBe('in')
  })

  test('falls back to canonical when she was already using it', () => {
    // The record stores no original when the chosen unit was canonical, so null is
    // the ordinary case rather than a missing value.
    expect(unitFromSaved(null, 'kg')).toBe('kg')
    expect(unitFromSaved(undefined, 'cm')).toBe('cm')
  })

  test('falls back rather than trusting a unit it cannot draw', () => {
    expect(unitFromSaved('stone', 'kg')).toBe('kg')
  })
})

describe('canSubmitMeasure', () => {
  test('refuses until the rail has been moved', () => {
    // The rails rest at 70 and 170 because a rail has to be somewhere, and a number
    // nobody chose cannot be the first record of a progress series.
    expect(RESTING_WEIGHT_KG).toBe(70)
    expect(RESTING_HEIGHT_CM).toBe(170)
    expect(canSubmitMeasure({ touched: false, submitting: false, sessionExpired: false })).toBe(
      false,
    )
  })

  test('allows once it was moved', () => {
    expect(canSubmitMeasure({ touched: true, submitting: false, sessionExpired: false })).toBe(true)
  })

  test('refuses while a submission is in flight', () => {
    expect(canSubmitMeasure({ touched: true, submitting: true, sessionExpired: false })).toBe(false)
  })

  test('refuses once the session is gone, because pressing could only fail', () => {
    expect(canSubmitMeasure({ touched: true, submitting: false, sessionExpired: true })).toBe(false)
  })
})

describe('the weight tape', () => {
  const { min, max } = SCALES.kg

  test('places the value under the pointer, not between two marks', () => {
    // Each stroke is centred in its own cell, so the offset carries half a pitch.
    // Without it the pointer sat between the marks and looked misaligned by a hair.
    expect(tapeOffsetFor(min, min)).toBe(-MARK_PITCH / 2)
    expect(tapeOffsetFor(min + 1, min)).toBe(-MARK_PITCH - MARK_PITCH / 2)
  })

  test('reads back every value it can place', () => {
    for (let weight = min; weight <= max; weight += 1) {
      expect(tapeValueFor(tapeOffsetFor(weight, min), min, max)).toBe(weight)
    }
  })

  test('snaps to the nearest mark rather than drifting between them', () => {
    const at70 = tapeOffsetFor(70, min)

    expect(tapeValueFor(at70 + MARK_PITCH * 0.4, min, max)).toBe(70)
    expect(tapeValueFor(at70 + MARK_PITCH * 0.6, min, max)).toBe(69)
  })

  test('clamps at both ends, so dragging past the tape does not invent a weight', () => {
    expect(tapeValueFor(tapeOffsetFor(min, min) + 500, min, max)).toBe(min)
    expect(tapeValueFor(tapeOffsetFor(max, min) - 500, min, max)).toBe(max)
  })
})
