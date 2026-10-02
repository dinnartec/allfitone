import { describe, expect, test } from 'bun:test'

import { adjusted, countdownLabel, remaining, restFor, started, rememberRest } from './rest-timer'

const NOW = 1_000_000

describe('the countdown between sets (ADR-035)', () => {
  test('T-SPC-UNIT-123 counts from when it ends, so a phone that slept comes back right', () => {
    const rest = started(NOW, 90)

    expect(remaining(rest, NOW)).toBe(90)
    // Asleep for a minute: no ticks arrived, and the answer is still a minute less.
    expect(remaining(rest, NOW + 60_000)).toBe(30)
  })

  test('T-SPC-UNIT-124 never goes below zero', () => {
    expect(remaining(started(NOW, 30), NOW + 45_000)).toBe(0)
  })

  test('T-SPC-UNIT-125 adds and takes away fifteen seconds from what is left', () => {
    const rest = started(NOW, 60)

    expect(remaining(adjusted(rest, 15, NOW + 10_000), NOW + 10_000)).toBe(65)
    expect(remaining(adjusted(rest, -15, NOW + 10_000), NOW + 10_000)).toBe(35)
    // Taking away more than is left finishes it rather than going negative.
    expect(remaining(adjusted(rest, -15, NOW + 50_000), NOW + 50_000)).toBe(0)
  })

  test('T-SPC-UNIT-126 the total grows with it, so the bar never overflows', () => {
    const longer = adjusted(started(NOW, 60), 15, NOW)

    expect(longer.total).toBe(75)
  })

  test('T-SPC-UNIT-127 reads as minutes and seconds, rounding up so zero means done', () => {
    expect(countdownLabel(90)).toBe('1:30')
    expect(countdownLabel(5.2)).toBe('0:06')
    expect(countdownLabel(0)).toBe('0:00')
  })

  test('T-SPC-UNIT-128 survives leaving the screen: kept per session, forgotten when done', () => {
    rememberRest('session-a', started(NOW, 60))

    expect(restFor('session-a', NOW + 1_000)).toMatchObject({ total: 60 })
    expect(restFor('session-b', NOW + 1_000)).toBeUndefined()
    expect(restFor('session-a', NOW + 61_000)).toBeUndefined()
    rememberRest('session-a', undefined)
    expect(restFor('session-a', NOW)).toBeUndefined()
  })
})
