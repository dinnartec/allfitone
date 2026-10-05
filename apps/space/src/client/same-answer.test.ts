/**
 * A screen re-read on every visit must not redraw when nothing changed.
 *
 * Hoy asks again each time it is looked at, and each answer used to replace what was
 * held with an equal but new object, so React drew the whole screen again for nothing:
 * three draws of ~150 ms on every arrival, right while the bar and the screen moved.
 */

import { describe, expect, test } from 'bun:test'

import { keepIfSame } from './same-answer'

describe('keepIfSame', () => {
  test('T-SPC-UNIT-263 an equal answer keeps what was held, so nothing redraws', () => {
    const held = { week: [{ day: 1, title: 'Pierna' }], total: 3 }
    const again = { week: [{ day: 1, title: 'Pierna' }], total: 3 }
    expect(keepIfSame(held, again)).toBe(held)
  })

  test('T-SPC-UNIT-264 a changed answer, or a first one, is taken', () => {
    const held = { week: [{ day: 1, title: 'Pierna' }], total: 3 }
    const changed = { week: [{ day: 1, title: 'Pierna' }], total: 4 }
    expect(keepIfSame(held, changed)).toBe(changed)
    expect(keepIfSame(undefined, changed)).toBe(changed)
    expect(keepIfSame([1, 2], [1, 2, 3])).toEqual([1, 2, 3])
  })
})
