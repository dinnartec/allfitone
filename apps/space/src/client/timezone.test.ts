import { describe, expect, test } from 'bun:test'

import { deviceTimezone, FALLBACK_TIMEZONE } from './timezone'

describe('deviceTimezone', () => {
  test('answers the zone the platform reports', () => {
    expect(deviceTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  test('answers a name the database can accept, never an empty string', () => {
    // `OP-PLN-011` refuses a timezone PostgreSQL does not know, so an empty answer
    // would fail the command rather than default to anything.
    expect(deviceTimezone()).not.toBe('')
    expect(deviceTimezone().length).toBeGreaterThan(0)
  })

  test('falls back to UTC rather than guessing a country', () => {
    // Two screens used to fall back to `America/Bogota`. A wrong zone does not fail —
    // it plants somebody's training week on the wrong days, which is worse.
    expect(FALLBACK_TIMEZONE).toBe('UTC')
  })
})
