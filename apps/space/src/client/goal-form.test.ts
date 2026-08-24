import { describe, expect, test } from 'bun:test'

import {
  bodyVariant,
  canSubmitGoal,
  CARD_GAP,
  CHROME_HEIGHT,
  goalSlots,
  heroGeometry,
  pairHeight,
  STRIP_SHARE,
  HERO_ASPECT,
  TRAINING_GOALS,
} from './goal-form'

describe('TRAINING_GOALS', () => {
  test('offers five, because improve_performance is deferred out of the initial launch', () => {
    expect(TRAINING_GOALS).toHaveLength(5)
    expect(TRAINING_GOALS).not.toContain('improve_performance' as never)
  })
})

describe('heroGeometry', () => {
  test('fills the measured row rather than the window', () => {
    // The row is what `Screen` already inset. Deriving from the window instead
    // double-counts panelInset and overflows by exactly that much.
    const { cardWidth } = heroGeometry(342, 844)

    expect(cardWidth).toBe(342)
  })

  test('takes its height from the aspect while the screen can afford it', () => {
    const { cardHeight } = heroGeometry(342, 844)

    expect(cardHeight).toBeCloseTo(342 / HERO_ASPECT, 5)
  })

  test('gives up card height rather than pushing the button off a short screen', () => {
    const short = heroGeometry(342, CHROME_HEIGHT + 40)

    expect(short.cardHeight).toBe(40)
  })

  test('never returns a negative box, so nothing renders inverted', () => {
    const tiny = heroGeometry(0, 100)

    expect(tiny.cardWidth).toBe(0)
    expect(tiny.cardHeight).toBe(0)
  })

  test('keeps the gap a constant the screen and the tests agree on', () => {
    expect(CARD_GAP).toBeGreaterThan(0)
  })
})

describe('bodyVariant', () => {
  test('brings the woman for every goal when that is what was declared', () => {
    for (const goal of TRAINING_GOALS) {
      expect(bodyVariant('female', goal)).toBe('female')
    }
  })

  test('brings the man for every goal when that is what was declared', () => {
    for (const goal of TRAINING_GOALS) {
      expect(bodyVariant('male', goal)).toBe('male')
    }
  })

  test('mixes the artwork when the question was declined', () => {
    // A screen where every goal showed one sex would be a statement, and
    // declining is the answer that asks us not to make one.
    const variants = TRAINING_GOALS.map((goal) => bodyVariant(null, goal))

    expect(new Set(variants).size).toBe(2)
  })

  test('keeps the declined mix stable, so the screen does not shuffle between visits', () => {
    expect(TRAINING_GOALS.map((goal) => bodyVariant(null, goal))).toEqual([
      'female',
      'male',
      'female',
      'male',
      'male',
    ])
  })
})

describe('canSubmitGoal', () => {
  test('refuses until something is chosen, because only one goal is principal', () => {
    expect(canSubmitGoal({ goal: undefined, submitting: false, sessionExpired: false })).toBe(false)
  })

  test('allows a chosen goal', () => {
    expect(canSubmitGoal({ goal: 'build_muscle', submitting: false, sessionExpired: false })).toBe(
      true,
    )
  })

  test('refuses while a submission is in flight', () => {
    expect(canSubmitGoal({ goal: 'build_muscle', submitting: true, sessionExpired: false })).toBe(
      false,
    )
  })

  test('refuses once the session is gone, because pressing could only fail', () => {
    expect(canSubmitGoal({ goal: 'build_muscle', submitting: false, sessionExpired: true })).toBe(
      false,
    )
  })
})

describe('goalSlots', () => {
  test('keeps the declared order whatever is chosen, so nothing jumps', () => {
    const order = (chosen: 'build_muscle' | undefined) => goalSlots(chosen).map((slot) => slot.goal)

    expect(order('build_muscle')).toEqual(order(undefined))
  })

  test('opens the card in the place of the chosen goal, not at the top', () => {
    const slots = goalSlots('run_a_race')
    const expanded = slots.findIndex((slot) => slot.expanded)

    // Fourth in the list, and it stays fourth. Pinning the card to the top moved
    // every other row on every tap.
    expect(expanded).toBe(3)
    expect(slots.filter((slot) => slot.expanded)).toHaveLength(1)
  })

  test('lists all five with none open while nothing is chosen', () => {
    const slots = goalSlots(undefined)

    expect(slots).toHaveLength(5)
    expect(slots.some((slot) => slot.expanded)).toBe(false)
  })
})

describe('pairHeight', () => {
  const STANDING = { before: 0.579, after: 0.626 }
  const RUNNING = { before: 0.84, after: 0.9 }

  test('lets a standing pair use the full card height', () => {
    const height = pairHeight(342, 147, STANDING.before, STANDING.after, 0.55, 10)

    expect(height).toBe(147)
  })

  test('shrinks a wide running pair instead of letting it overflow', () => {
    // The defect this exists to prevent: at the card height the running profile
    // spilled past the card and over the copy.
    const height = pairHeight(342, 147, RUNNING.before, RUNNING.after, 0.55, 10)

    expect(height).toBeLessThan(147)
    const width = 10 + height * (RUNNING.after * 0.55 + RUNNING.before)
    expect(width).toBeCloseTo(342 * STRIP_SHARE, 5)
  })

  test('never returns a negative height on a card too small to hold anything', () => {
    expect(pairHeight(10, 147, RUNNING.before, RUNNING.after, 0.55, 10)).toBe(0)
  })

  test('answers zero rather than dividing by zero when an aspect is missing', () => {
    expect(pairHeight(342, 147, 0, 0, 0.55, 10)).toBe(0)
  })
})
