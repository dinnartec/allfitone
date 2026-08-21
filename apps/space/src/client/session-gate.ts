/**
 * Where the app goes when it opens.
 *
 * The opening screen used to send everybody to the welcome screen once its
 * animation finished, which meant a person who had just created an account and
 * received a session was asked to create one again. HU-SP-002 criterion 4 is the
 * rule that was missing: the session survives closing the app.
 *
 * The decision is a pure function so it can be tested without launching the app.
 * Reading storage and asking the API are the caller's job; what to do with those
 * two answers is this module's.
 *
 * An outage is deliberately not a rejection. A refused token means the session is
 * gone and the person signs in again; a network that did not answer means we do
 * not know, and guessing "signed out" would lose their place for nothing.
 */

/** A session always resumes at the first onboarding step, which is idempotent. */
const SIGNED_IN_ROUTE = '/onboarding/age'
const SIGNED_OUT_ROUTE = '/welcome'
const IDENTITY_ROUTE = '/onboarding/identity'

export type EntryRoute = typeof SIGNED_IN_ROUTE | typeof SIGNED_OUT_ROUTE
export type OnboardingRoute = typeof SIGNED_IN_ROUTE | typeof IDENTITY_ROUTE

export interface EntryState {
  session: { accessToken: string; refreshToken: string } | null
  /** The API refused the stored credential. */
  rejected?: boolean
  /** The check could not be made at all. */
  unreachable?: boolean
}

export function resolveEntryRoute(state: EntryState): EntryRoute {
  if (!state.session) return SIGNED_OUT_ROUTE
  if (state.rejected) return SIGNED_OUT_ROUTE
  return SIGNED_IN_ROUTE
}

/**
 * Which step the onboarding resumes at, given what the server already holds.
 *
 * Kept separate from `resolveEntryRoute` on purpose: that one runs on the
 * opening screen from storage alone, and adding a request there would delay the
 * splash on every launch. This one runs on the first step, which is already
 * talking to the API.
 */
export function resolveOnboardingRoute(
  current: {
    attempt: { eligibility_status: 'pending' | 'pass' | 'fail' } | null
  } | null,
): OnboardingRoute {
  // No attempt, a pending one, or a refusal all belong on the age step. A `fail`
  // is not eligibility and must not be walked past.
  if (current?.attempt?.eligibility_status !== 'pass') return SIGNED_IN_ROUTE
  return IDENTITY_ROUTE
}
