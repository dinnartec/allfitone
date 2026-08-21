/**
 * When the identity step can be submitted, and what a well-formed handle is.
 *
 * Lives here rather than in the screen so it can be tested: `app/` needs a
 * native runtime and never runs under the test runner.
 *
 * A valid form is not enough. If the stored session is gone, pressing Continue
 * can only fail — the request would be refused before it reached the command —
 * so the answer is no, and the screen offers signing in instead.
 *
 * The pattern is the same one the column constraint enforces. Checking it here
 * too is not redundancy for its own sake: a malformed handle that reaches the
 * command claims an idempotency key for a request that was never going to work.
 */

export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,29}$/

export interface IdentityFormState {
  givenName: string
  familyName: string
  username: string
  submitting: boolean
  /** The API refused the stored credential, so nothing here can be saved. */
  sessionExpired: boolean
}

export function isUsernameWellFormed(username: string): boolean {
  return USERNAME_PATTERN.test(username)
}

export function canSubmitIdentity(state: IdentityFormState): boolean {
  if (state.submitting || state.sessionExpired) return false
  if (state.givenName.trim().length === 0) return false
  if (state.familyName.trim().length === 0) return false
  return isUsernameWellFormed(state.username)
}
