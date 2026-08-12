import { describe, expect, test } from 'bun:test'

import {
  BACKOFFICE_HEARTBEAT_INTERVAL_MS,
  activeSessionActivity,
  parseBackofficeSessionActivity,
  sessionDeadline,
} from './session-activity.js'

describe('Backoffice session activity', () => {
  test('limits activity heartbeats to once per minute', () => {
    expect(BACKOFFICE_HEARTBEAT_INTERVAL_MS).toBe(60_000)
  })

  test('stores only technical expiration data and chooses the earliest deadline', () => {
    const record = activeSessionActivity({
      inactivityExpiresAt: '2026-08-12T12:15:00.000Z',
      absoluteExpiresAt: '2026-08-12T20:00:00.000Z',
      verifiedAt: 100,
    })

    expect(record).toEqual({
      version: 1,
      status: 'active',
      lastVerifiedAt: 100,
      inactivityExpiresAt: Date.parse('2026-08-12T12:15:00.000Z'),
      absoluteExpiresAt: Date.parse('2026-08-12T20:00:00.000Z'),
    })
    expect(sessionDeadline(record)).toBe(Date.parse('2026-08-12T12:15:00.000Z'))
    expect(record).not.toHaveProperty('operator')
    expect(record).not.toHaveProperty('email')
    expect(record).not.toHaveProperty('token')
  })

  test('accepts versioned records and discards unknown or secret fields', () => {
    expect(
      parseBackofficeSessionActivity(
        JSON.stringify({
          version: 1,
          status: 'active',
          lastVerifiedAt: 10,
          inactivityExpiresAt: 20,
          absoluteExpiresAt: 30,
          email: 'operator@example.test',
          token: 'secret',
        }),
      ),
    ).toEqual({
      version: 1,
      status: 'active',
      lastVerifiedAt: 10,
      inactivityExpiresAt: 20,
      absoluteExpiresAt: 30,
    })
    expect(
      parseBackofficeSessionActivity(
        JSON.stringify({
          version: 1,
          status: 'ended',
          endedAt: 40,
          reason: 'manual',
          confirmedAt: 50,
        }),
      ),
    ).toEqual({ version: 1, status: 'ended', endedAt: 40, reason: 'manual', confirmedAt: 50 })
    expect(parseBackofficeSessionActivity('{broken')).toBeUndefined()
    expect(
      parseBackofficeSessionActivity(
        JSON.stringify({ version: 2, status: 'active', lastVerifiedAt: 10 }),
      ),
    ).toBeUndefined()
  })
})
