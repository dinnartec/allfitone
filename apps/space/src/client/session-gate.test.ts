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

import { introLeftMs, resolveEntryRoute, resolveOnboardingRoute } from './session-gate'

describe('resolveEntryRoute', () => {
  test('sends somebody with no session to the welcome screen', () => {
    expect(resolveEntryRoute({ session: null })).toBe('/welcome')
  })

  test('sends a signed-in person into the onboarding, not to welcome', () => {
    expect(resolveEntryRoute({ session: { accessToken: 'at_1', refreshToken: 'rt_1' } })).toBe(
      '/onboarding/age',
    )
  })

  test('resumes at the step the person had reached instead of the first one', () => {
    expect(
      resolveEntryRoute({
        session: { accessToken: 'at_1', refreshToken: 'rt_1' },
        onboarding: { attempt: { eligibility_status: 'pass' } },
      }),
    ).toBe('/onboarding/identity')
  })

  test('a refusal outranks the progress that came with it', () => {
    // The declaration passed, but the credential is gone: there is nothing to
    // resume with, and landing on a step would repeat the dead end.
    expect(
      resolveEntryRoute({
        session: { accessToken: 'at_1', refreshToken: 'rt_1' },
        rejected: true,
        onboarding: { attempt: { eligibility_status: 'pass' } },
      }),
    ).toBe('/welcome')
  })

  test('an outage lands on the first step rather than assuming progress', () => {
    expect(
      resolveEntryRoute({
        session: { accessToken: 'at_1', refreshToken: 'rt_1' },
        unreachable: true,
        onboarding: { attempt: { eligibility_status: 'pass' } },
      }),
    ).toBe('/onboarding/age')
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

describe('resolveOnboardingRoute', () => {
  test('sends a session with no attempt to the first step', () => {
    expect(resolveOnboardingRoute({ attempt: null })).toBe('/onboarding/age')
  })

  test('keeps a pending declaration on the first step', () => {
    expect(resolveOnboardingRoute({ attempt: { eligibility_status: 'pending' } })).toBe(
      '/onboarding/age',
    )
  })

  test('never walks past a refusal, because a fail is not eligibility', () => {
    expect(resolveOnboardingRoute({ attempt: { eligibility_status: 'fail' } })).toBe(
      '/onboarding/age',
    )
  })

  test('moves on once the declaration passed', () => {
    expect(resolveOnboardingRoute({ attempt: { eligibility_status: 'pass' } })).toBe(
      '/onboarding/identity',
    )
  })

  test('treats an unreadable answer as the first step rather than guessing forward', () => {
    expect(resolveOnboardingRoute(null)).toBe('/onboarding/age')
  })
})

describe('resolveOnboardingRoute past the identity step', () => {
  const PASSED = { eligibility_status: 'pass' as const }
  const answers = (
    ...steps: Array<'identity' | 'biological_sex' | 'training_discipline' | 'primary_training_goal'>
  ) => ({
    identity: { answered: steps.includes('identity') },
    biological_sex: { answered: steps.includes('biological_sex') },
    training_discipline: { answered: steps.includes('training_discipline') },
    primary_training_goal: { answered: steps.includes('primary_training_goal') },
  })

  test('asks for the biological sex once the Fitness ID exists', () => {
    expect(resolveOnboardingRoute({ attempt: PASSED, answers: answers('identity') })).toBe(
      '/onboarding/sex',
    )
  })

  test('moves past it once the question was answered', () => {
    expect(
      resolveOnboardingRoute({ attempt: PASSED, answers: answers('identity', 'biological_sex') }),
    ).toBe('/onboarding/discipline')
  })

  test('does not send a person who declined back to the same screen', () => {
    // The refusal records no value, so a decision made from the value alone would
    // ask again on every cold start and the onboarding could never advance.
    expect(
      resolveOnboardingRoute({ attempt: PASSED, answers: answers('identity', 'biological_sex') }),
    ).toBe('/onboarding/discipline')
  })
})

describe('introLeftMs', () => {
  test('T-SPC-UNIT-261 the session check runs inside the opening, not after it', () => {
    // Checked in 600 ms: the opening still ends at 2.8 s from launch, not 3.4 s.
    expect(introLeftMs(600, false)).toBe(2200)
    // A check slower than the opening leaves the moment it answers.
    expect(introLeftMs(3500, false)).toBe(0)
    expect(introLeftMs(300, true)).toBe(500)
    expect(introLeftMs(900, true)).toBe(0)
  })
})
