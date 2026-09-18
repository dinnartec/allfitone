/**
 * How a request failed, and the error that carries it.
 *
 * Apart from the transport on purpose. The failure vocabulary is what screens branch on
 * to decide what to tell somebody, and that decision is pure logic worth testing — but
 * `index.ts` reaches for `fetch`, `expo-crypto` and the stored session, none of which
 * load in the test runner. Splitting the word from the wire is what lets the wording of
 * a failure be asserted at all.
 */

export type ApiFailure =
  /** The request was malformed. Only reachable if client validation drifts. */
  | 'invalid-request'
  /** Wrong code, wrong password, unknown address — one answer, by design. */
  | 'unauthenticated'
  /** Too short for the provider's floor, or known to be breached. */
  | 'weak-password'
  /** Something else already holds what was asked for. Only a username, today. */
  | 'conflict'
  /**
   * Not there, or not yours. The API answers both the same way on purpose: a
   * distinguishable "forbidden" would make somebody else's catalogue enumerable one
   * identifier at a time.
   */
  | 'not-found'
  /** The API or the provider did not answer. Retryable; nothing else is. */
  | 'unavailable'

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure)
    this.name = 'ApiError'
  }
}
