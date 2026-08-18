/**
 * Where the app goes when it opens.
 *
 * HU-SP-002 criterion 4 says the session survives closing the app, and criterion
 * 3 says an abandoned registration resumes where it stopped. Both are decisions
 * about a destination, so they live here as pure logic rather than inside the
 * opening screen, where they could only be checked by launching the app.
 *
 * A stored session that the API later rejects is not a session. That case is the
 * one worth guarding: treating a stale token as valid would drop somebody on a
 * screen that fails every request.
 */

import { describe, expect, test } from 'bun:test'

import { resolveEntryRoute } from './session-gate'

describe('resolveEntryRoute', () => {
  test('sends somebody with no session to the welcome screen', () => {
    expect(resolveEntryRoute({ session: null })).toBe('/welcome')
  })

  test('sends a signed-in person into the onboarding, not to welcome', () => {
    expect(resolveEntryRoute({ session: { accessToken: 'at_1', refreshToken: 'rt_1' } })).toBe(
      '/onboarding/age',
    )
  })

  test('treats a session the API refused as no session at all', () => {
    expect(
      resolveEntryRoute({ session: { accessToken: 'at_1', refreshToken: 'rt_1' }, rejected: true }),
    ).toBe('/welcome')
  })

  test('keeps a session when the check could not be made, instead of signing the person out', () => {
    // An outage is not a rejection. Sending somebody back to the welcome screen
    // because the network blinked would lose their place for no reason.
    expect(
      resolveEntryRoute({
        session: { accessToken: 'at_1', refreshToken: 'rt_1' },
        unreachable: true,
      }),
    ).toBe('/onboarding/age')
  })
})
