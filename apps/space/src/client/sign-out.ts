/**
 * Signing out: what has to be true before the phone forgets.
 *
 * `HU-SP-003` has two criteria and they pull in opposite directions.
 *
 * Criterion 1 — nothing of mine consultable on the phone — means the erasure **cannot
 * fail**. Not on a plane, not during a provider outage, not because the API answered
 * badly. So the local clear is unconditional and the revocation is best effort.
 *
 * Criterion 2 — warn me if a workout is unsynced — means the erasure **must not be
 * immediate** either. A session left open on this phone has results the server has not
 * seen; wiping the tokens takes them with it. So the flow asks first and only then
 * forgets. The warning is the client's job because the server cannot know what the
 * phone is holding.
 *
 * The order matters and is the opposite of what it looks like: **revoke, then erase.**
 * Erasing first would leave no token to revoke with, and the revocation is the half
 * that stops a stolen refresh token.
 */

export interface SignOutTransport {
  /** `OP-IDN-048`. Resolves whatever the answer, including an outage. */
  revoke(): Promise<void>
}

export interface SignOutDependencies {
  transport: SignOutTransport
  clearSession: () => Promise<void>
  /** The execution left open on this phone, if any. */
  openExecutionId: () => Promise<string | null>
}

export type SignOutOutcome =
  /** Gone: tokens erased, provider session revoked. */
  | { readonly state: 'signed-out' }
  /** Erased locally; the provider still holds the session and a worker will not fix it. */
  | { readonly state: 'signed-out-locally' }
  /** Nothing was touched. Ask, then call `signOut({ force: true })`. */
  | { readonly state: 'unsynced-workout'; readonly executionId: string }

export interface SignOutFlow {
  signOut(options?: { readonly force?: boolean }): Promise<SignOutOutcome>
}

export function createSignOutFlow(dependencies: SignOutDependencies): SignOutFlow {
  return {
    async signOut(options) {
      if (options?.force !== true) {
        // Swallowed: not knowing whether a workout is open is not a reason to keep
        // somebody signed in. The warning is a courtesy, the erasure is the promise.
        const open = await dependencies.openExecutionId().catch(() => null)
        if (open !== null) return { state: 'unsynced-workout', executionId: open }
      }

      let revoked = true
      try {
        await dependencies.transport.revoke()
      } catch {
        revoked = false
      }

      await dependencies.clearSession()
      return { state: revoked ? 'signed-out' : 'signed-out-locally' }
    },
  }
}
