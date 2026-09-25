import { describe, expect, test } from 'bun:test'
import { motion, semanticMotion } from '@allfitone/react-native/tokens'

import {
  cssDuration,
  durationFor,
  easingFor,
  entranceSpanMs,
  liftFor,
  LIFT_PX,
  PRESS_DURATION,
  PRESS_SCALE,
  shouldPlayEntrance,
  SPRING,
  staggerDelays,
  STAGGER_CAP_MS,
  STAGGER_STEP_MS,
} from './motion'

/** The playbook's ceiling for anything that is not a modal or a drawer. */
const UI_BUDGET_MS = 300

describe('durationFor', () => {
  test('takes the number from the design system rather than the screen', () => {
    expect(durationFor('fast', false)).toBe(motion.duration.fast)
    expect(durationFor('normal', false)).toBe(motion.duration.normal)
  })

  test('stays inside the budget for UI motion', () => {
    for (const name of ['fastest', 'fast', 'normal', 'moderate'] as const) {
      expect(durationFor(name, false)).toBeLessThanOrEqual(UI_BUDGET_MS)
    }
  })

  test('shortens under reduced motion without cutting to nothing', () => {
    // Fewer and gentler is the requirement, not none: the fade is what explains
    // that something arrived, and zeroing it removes the explanation too.
    expect(durationFor('normal', true)).toBe(motion.duration.fastest)
    expect(durationFor('normal', true)).toBeGreaterThan(0)
  })
})

describe('liftFor', () => {
  test('lifts on the way in', () => {
    expect(liftFor(false)).toBe(LIFT_PX)
  })

  test('drops the movement under reduced motion, which is the part that has to go', () => {
    expect(liftFor(true)).toBe(0)
  })
})

describe('easingFor', () => {
  test('returns the four control points a bezier needs', () => {
    expect(easingFor('emphasized')).toHaveLength(4)
  })

  test('emphasized leaves the origin fast, which is what makes an entrance feel responsive', () => {
    // The first version used `enter`, [0, 0, 0.2, 1]: it leaves linearly, so the
    // opening frames barely move and the whole thing reads as sluggish.
    const [, y1] = easingFor('emphasized')
    const [, weakY1] = easingFor('enter')

    expect(y1).toBeGreaterThan(weakY1)
    expect(y1).toBeGreaterThanOrEqual(0.9)
  })

  test('every named curve resolves, so a screen cannot reach for one that is missing', () => {
    for (const name of Object.keys(motion.easing) as Array<keyof typeof motion.easing>) {
      expect(easingFor(name).every((value) => Number.isFinite(value))).toBe(true)
    }
  })
})

describe('staggerDelays', () => {
  test('spaces items inside the 30 to 80 ms window the playbook allows', () => {
    expect(STAGGER_STEP_MS).toBeGreaterThanOrEqual(30)
    expect(STAGGER_STEP_MS).toBeLessThanOrEqual(80)
    expect(staggerDelays(3, false)).toEqual([0, STAGGER_STEP_MS, STAGGER_STEP_MS * 2])
  })

  test('caps the tail so a long list arrives instead of appearing to load', () => {
    expect(Math.max(...staggerDelays(12, false))).toBe(STAGGER_CAP_MS)
  })

  test('drops the stagger entirely under reduced motion, since it is decoration', () => {
    expect(staggerDelays(5, true)).toEqual([0, 0, 0, 0, 0])
  })

  test('answers nothing for an empty list rather than a single zero', () => {
    expect(staggerDelays(0, false)).toEqual([])
  })
})

describe('entranceSpanMs', () => {
  test('the whole entrance fits the budget, delays included', () => {
    // What the first version got wrong: 240 ms of animation behind up to 180 ms
    // of delay is 420 ms before the last row settles.
    expect(entranceSpanMs(6, false)).toBeLessThanOrEqual(UI_BUDGET_MS)
  })

  test('is shortest of all under reduced motion', () => {
    expect(entranceSpanMs(6, true)).toBeLessThan(entranceSpanMs(6, false))
  })
})

describe('shouldPlayEntrance', () => {
  test('plays on a first arrival', () => {
    expect(shouldPlayEntrance(false)).toBe(true)
  })

  test('does not play when coming back to correct an answer', () => {
    expect(shouldPlayEntrance(true)).toBe(false)
  })
})

describe('PRESS_SCALE', () => {
  test('is subtle, inside the range that reads as a press rather than a jump', () => {
    expect(PRESS_SCALE).toBeGreaterThanOrEqual(0.95)
    expect(PRESS_SCALE).toBeLessThanOrEqual(0.98)
  })
})

describe('cssDuration', () => {
  test('gives a Reanimated transition the duration in milliseconds', () => {
    expect(cssDuration('fast', false)).toBe(`${motion.duration.fast}ms`)
    expect(cssDuration('fast', true)).toBe(`${motion.duration.fastest}ms`)
  })

  test('press feedback stays inside the near-imperceptible tier', () => {
    // Row selection is touched tens of times a day, where the playbook allows
    // under 150ms or nothing at all.
    expect(durationFor(PRESS_DURATION, false)).toBeLessThanOrEqual(150)
  })
})

describe('SPRING', () => {
  test('is the feedback spring from the tokens, not numbers typed into a screen', () => {
    // Two screens open a card on this. Typed by hand in each, they drift apart the
    // first time the token moves, and nobody notices because both still animate.
    expect(SPRING).toEqual({
      damping: semanticMotion.feedback.spring.damping,
      stiffness: semanticMotion.feedback.spring.stiffness,
      mass: semanticMotion.feedback.spring.mass,
    })
  })

  test('answers a tap rather than settling on its own', () => {
    // `transition` is the slower one, for something arriving by itself.
    expect(SPRING.stiffness).toBeGreaterThan(semanticMotion.transition.spring.stiffness)
  })
})
