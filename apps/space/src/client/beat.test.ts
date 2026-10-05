/**
 * When a clock on screen next has something new to show.
 *
 * The session's clock used to redraw the whole screen every second, ~175 ms each time
 * on a development build, and a tick on a set queued behind it. Each clock now redraws
 * only itself, on the turn of the second, so what it shows changes when the second does.
 */

import { describe, expect, test } from 'bun:test'

import { nextBeatIn } from './beat'

describe('nextBeatIn', () => {
  test('T-SPC-UNIT-266 the next beat is the turn of the next whole second', () => {
    expect(nextBeatIn(1_000_250)).toBe(750)
    expect(nextBeatIn(1_000_999)).toBe(1)
    // Exactly on a beat, the next one is a whole second away, never zero.
    expect(nextBeatIn(1_000_000)).toBe(1000)
  })
})
