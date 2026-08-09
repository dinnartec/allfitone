/**
 * Port errors.
 *
 * Provider errors are translated here and never leave this package. This is not
 * cosmetic: the provider distinguishes "email already registered" from "invalid
 * email", and propagating that difference would reveal whether a person has an
 * account.
 *
 * V1 operates under Law 1581. An email already in use is rejected with the same
 * error as a malformed one — same response, same timing.
 */

export type AuthErrorCode =
  /** Wrong credentials or no such account. The two are not distinguished. */
  | 'invalid_credentials'
  /** Email rejected: malformed OR already in use. Deliberately ambiguous. */
  | 'invalid_email'
  /**
   * The password itself was refused: too short, or matched a breach corpus.
   *
   * Safe to report precisely, unlike everything else here. It describes what the
   * person just typed, not whether an account exists, so being specific helps
   * them and tells an attacker nothing.
   */
  | 'weak_password'
  /** Token missing, badly signed, expired, or issued for another surface. */
  | 'invalid_token'
  /** The provider did not respond. Retryable; nothing else here is. */
  | 'provider_unavailable'

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    /** Internal logs only. Never reaches the client. */
    readonly detail?: string,
  ) {
    super(code)
    this.name = 'AuthError'
  }

  get retryable(): boolean {
    return this.code === 'provider_unavailable'
  }
}
