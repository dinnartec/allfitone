/**
 * The decisions the closing screen makes, kept out of the screen so they can be
 * tested without rendering anything.
 *
 * Two of them look trivial and are not. Which body to show has a third case —
 * declining — and there is no neutral body to show for it, so it takes a stated
 * default rather than an accident. And what makes the button pressable is the
 * name, not the person's willingness: activation carries the name to the server,
 * and a button that fires before the attempt has been read would send an empty one.
 */

import type { OnboardingCompletion } from './onboarding'

export interface DeclaredIdentity {
  readonly given_name: string
  readonly family_name: string
}

/**
 * Declared female brings the woman; declared male and declining both bring the
 * man, which is the approved artwork for the screen and not a statement about
 * whoever declined.
 */
export function welcomeVariant(biologicalSex: 'male' | 'female' | null): 'male' | 'female' {
  return biologicalSex === 'female' ? 'female' : 'male'
}

/**
 * Both acceptances are `true` and nothing else. Declining happens by not going on,
 * so there is no path here that sends `false`.
 */
export function completionFor(identity: DeclaredIdentity): OnboardingCompletion {
  return {
    given_name: identity.given_name,
    family_name: identity.family_name,
    terms_accepted: true,
    privacy_notice_accepted: true,
  }
}

export interface ActivationState {
  /** Undefined until the attempt has been read; the name travels with the command. */
  readonly identity: DeclaredIdentity | undefined
  readonly activating: boolean
  readonly activated: boolean
  readonly sessionExpired: boolean
}

export function canActivate({
  identity,
  activating,
  activated,
  sessionExpired,
}: ActivationState): boolean {
  if (activating || activated || sessionExpired) return false
  return identity !== undefined
}
