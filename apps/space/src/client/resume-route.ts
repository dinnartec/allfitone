/**
 * Where to go once a credential has just been accepted.
 *
 * Sign-in and email verification both hardcoded `/onboarding/age`, so every login
 * put the person back on the adult declaration no matter how far they had got — the
 * one step that cannot even be changed. The opening screen had the right answer all
 * along; this is that answer, in one place, so a third entry point cannot get it
 * wrong again.
 *
 * An unreadable answer lands on the gate rather than guessing forward: it is
 * idempotent, and nothing walks past eligibility on a guess.
 */

import {
  ELIGIBILITY_GATE_ROUTE,
  resolveOnboardingRoute,
  type OnboardingProgress,
  type OnboardingRoute,
} from './onboarding-steps'

export async function routeAfterAuthentication(
  read: () => Promise<OnboardingProgress>,
): Promise<OnboardingRoute> {
  try {
    return resolveOnboardingRoute(await read())
  } catch {
    return ELIGIBILITY_GATE_ROUTE
  }
}
