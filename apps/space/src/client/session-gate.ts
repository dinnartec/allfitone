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
 * answers is this module's.
 *
 * **Having a stored token is not being signed in.** An earlier version decided
 * from storage alone, which meant a credential the provider had already refused
 * still landed on the onboarding — and the person only found out after filling a
 * form and pressing a button that could never work. The caller now checks the
 * credential first and reports what came back.
 *
 * An outage is deliberately not a rejection. A refused token means the session is
 * gone and the person signs in again; a network that did not answer means we do
 * not know, and guessing "signed out" would lose their place for nothing. In that
 * case the first onboarding step is the safe landing: it is idempotent, and
 * nothing walks past eligibility on a guess.
 */

const WELCOME_ROUTE = '/welcome'
const AGE_ROUTE = '/onboarding/age'
const IDENTITY_ROUTE = '/onboarding/identity'

export type EntryRoute = typeof WELCOME_ROUTE | typeof AGE_ROUTE | typeof IDENTITY_ROUTE
export type OnboardingRoute = typeof AGE_ROUTE | typeof IDENTITY_ROUTE

/** Only the shape the decision reads, so a test needs no generated DTO. */
export interface OnboardingProgress {
  attempt: { eligibility_status: 'pending' | 'pass' | 'fail' } | null
}

export interface EntryState {
  session: { accessToken: string; refreshToken: string } | null
  /** The API refused the stored credential, after a refresh had its one try. */
  rejected?: boolean
  /** The check could not be made at all. */
  unreachable?: boolean
  /** What the API answered, when it answered. */
  onboarding?: OnboardingProgress | null
}

export function resolveEntryRoute(state: EntryState): EntryRoute {
  if (!state.session) return WELCOME_ROUTE
  if (state.rejected) return WELCOME_ROUTE
  // Unknown is not progress: land on the first step rather than assume any.
  if (state.unreachable) return AGE_ROUTE
  return resolveOnboardingRoute(state.onboarding ?? null)
}

/**
 * Which step the onboarding resumes at, given what the server already holds.
 *
 * Exported separately because the identity step needs the same answer when it is
 * entered directly, not only when the app opens.
 */
export function resolveOnboardingRoute(current: OnboardingProgress | null): OnboardingRoute {
  // No attempt, a pending one, or a refusal all belong on the age step. A `fail`
  // is not eligibility and must not be walked past.
  if (current?.attempt?.eligibility_status !== 'pass') return AGE_ROUTE
  return IDENTITY_ROUTE
}
