import { describe, expect, test } from 'bun:test'

import { parseStudioSessionActivity, STUDIO_IDLE_TIMEOUT_MS } from './session-activity'

describe('Studio session activity storage', () => {
  test('uses the agreed thirty-minute inactivity window', () => {
    expect(STUDIO_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000)
  })

  test('accepts only the versioned minimal active and ended records', () => {
    expect(
      parseStudioSessionActivity(
        JSON.stringify({ version: 1, status: 'active', lastActivityAt: 1234 }),
      ),
    ).toEqual({ version: 1, status: 'active', lastActivityAt: 1234 })
    expect(
      parseStudioSessionActivity(JSON.stringify({ version: 1, status: 'ended', endedAt: 5678 })),
    ).toEqual({ version: 1, status: 'ended', endedAt: 5678 })
    expect(
      parseStudioSessionActivity(
        JSON.stringify({ version: 1, status: 'ended', endedAt: 5678, confirmedAt: 6789 }),
      ),
    ).toEqual({ version: 1, status: 'ended', endedAt: 5678, confirmedAt: 6789 })
    expect(
      parseStudioSessionActivity(
        JSON.stringify({
          version: 1,
          status: 'ended',
          endedAt: 5678,
          reason: 'inactivity',
        }),
      ),
    ).toEqual({ version: 1, status: 'ended', endedAt: 5678, reason: 'inactivity' })
    expect(
      parseStudioSessionActivity(
        JSON.stringify({ version: 1, status: 'ended', endedAt: 5678, reason: 'invalid' }),
      ),
    ).toBe(undefined)
    expect(
      parseStudioSessionActivity(
        JSON.stringify({ version: 1, status: 'active', lastActivityAt: 1234, token: 'secret' }),
      ),
    ).toEqual({ version: 1, status: 'active', lastActivityAt: 1234 })
    expect(parseStudioSessionActivity(JSON.stringify({ version: 2, status: 'active' }))).toBe(
      undefined,
    )
    expect(parseStudioSessionActivity('not-json')).toBe(undefined)
  })
})
