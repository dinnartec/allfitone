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
 * answers is this module's — except the order of the onboarding itself, which is
 * declared in `onboarding-steps.ts` so the progress bar cannot disagree with it.
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

import {
  resolveOnboardingRoute,
  type OnboardingProgress,
  type OnboardingRoute,
} from './onboarding-steps'

export { resolveOnboardingRoute }
export type { OnboardingProgress, OnboardingRoute }

/** The onboarding routes plus the front door, where a session that is gone lands. */
export type EntryRoute = OnboardingRoute | '/welcome'

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
  if (!state.session) return '/welcome'
  if (state.rejected) return '/welcome'
  // Unknown is not progress: land on the first step rather than assume any.
  if (state.unreachable) return '/onboarding/age'
  return resolveOnboardingRoute(state.onboarding ?? null)
}
