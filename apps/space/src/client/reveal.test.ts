/**
 * `T-SP-REVEAL-01..07` — where the list scrolls to when an exercise opens.
 *
 * The case that decides the design is the one taller than the screen. Scrolling to its
 * bottom would put its heading off the top, so somebody would be looking at rows of
 * numbers with nothing saying which exercise they belong to. The top wins.
 *
 * The other one worth pinning is «already visible answers nothing». A list that
 * scrolls when it did not need to moves under a finger that was about to press
 * something, which is worse than not helping at all.
 */

import { describe, expect, test } from 'bun:test'

import { REVEAL_MARGIN, revealOffset } from './reveal'

const screen = { offset: 0, height: 400 }

describe('what the list does about something it just opened', () => {
  test('T-SP-REVEAL-01 something wholly on screen is left alone', () => {
    expect(revealOffset({ y: 100, height: 150 }, screen)).toBeUndefined()
  })

  test('T-SP-REVEAL-02 something hanging off the bottom scrolls up by what hangs', () => {
    // Its bottom is at 500 plus the margin; the screen ends at 400.
    expect(revealOffset({ y: 300, height: 200 }, screen)).toBe(500 + REVEAL_MARGIN - 400)
  })

  test('T-SP-REVEAL-03 something above the fold scrolls back up to it', () => {
    expect(revealOffset({ y: 120, height: 100 }, { offset: 300, height: 400 })).toBe(
      120 - REVEAL_MARGIN,
    )
  })

  test('T-SP-REVEAL-04 something taller than the screen shows its top, not its end', () => {
    // Scrolling to the bottom would leave the heading off screen, and the rows below
    // it say nothing about which exercise they belong to.
    expect(revealOffset({ y: 200, height: 900 }, screen)).toBe(200 - REVEAL_MARGIN)
  })

  test('T-SP-REVEAL-05 it never asks the list to scroll above its own beginning', () => {
    expect(revealOffset({ y: 4, height: 900 }, screen)).toBe(0)
    expect(revealOffset({ y: 0, height: 50 }, { offset: 20, height: 400 })).toBe(0)
  })

  test('T-SP-REVEAL-06 a list that has not been measured yet is not scrolled', () => {
    expect(revealOffset({ y: 300, height: 200 }, { offset: 0, height: 0 })).toBeUndefined()
  })

  test('T-SP-REVEAL-07 the margin is real air, not a rounding accident', () => {
    // Exactly flush with the bottom edge still scrolls, by the margin.
    expect(revealOffset({ y: 200, height: 200 }, screen)).toBe(REVEAL_MARGIN)
  })
})
