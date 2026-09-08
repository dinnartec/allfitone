/**
 * Space account creation. No HTTP and no SQL — deliberately neither.
 *
 * Creating an account touches the identity provider and nothing else. HU-SP-001
 * criterion 4 defers the Fitness ID to onboarding completion, and HU-SP-007
 * forbids storing anything fitness-related before adult eligibility is
 * established, so the safest place for a half-finished registration is nowhere.
 * `identity.access_accounts` appears later, when `OP-IDN-001` derives it from a
 * verified token.
 *
 * That absence is also why there is no outbox here: with one system in play
 * there is nothing to keep consistent across two.
 */

import { AuthError, type AuthProvider } from '@allfitone/auth-provider'
import {
  analyticsIdentityForSurfaceFromEnvironment,
  type AnalyticsIdentity,
} from '@allfitone/telemetry/node'
import { measureRequestPhase } from '../../../platform/observability/index.js'

/**
 * How long the client is told a code remains valid.
 *
 * Fixed and computed locally rather than read back from the provider, because
 * the value is part of the response and must be identical whether or not an
 * account was created. Asking the provider would make the answer depend on
 * something that only exists in one of the two cases.
 *
 * The provider enforces the real expiry; this is what the person is shown.
 */
const VERIFICATION_WINDOW_MINUTES = 10

export type RegistrationErrorCode =
  'invalid-request' | 'upstream-unavailable' | 'unauthenticated' | 'weak-password'

export class RegistrationError extends Error {
  constructor(readonly code: RegistrationErrorCode) {
    super(code)
    this.name = 'RegistrationError'
  }
}

export interface RegistrationAccepted {
  expiresAt: Date
}

export interface SessionIssued {
  accessToken: string
  refreshToken: string
  expiresIn: number
  /** Optional only for injected test seams; production verification always sets it. */
  analytics?: AnalyticsIdentity
}

export interface SpaceRegistrationService {
  /**
   * Always resolves for a well-formed address, whether or not it was already
   * taken. The caller has nothing to branch on, which is the point.
   */
  register(email: string, password: string): Promise<RegistrationAccepted>
  verify(email: string, password: string, code: string): Promise<SessionIssued>
  /**
   * One answer for a wrong password, an unknown address and an unverified one.
   * HU-SP-002 criterion 2; the distinction stays inside the adapter.
   */
  signIn(email: string, password: string): Promise<SessionIssued>
  /**
   * Carries HU-SP-002 criterion 4. A rejection means signing in again, never a
   * degraded session.
   */
  refresh(refreshToken: string): Promise<SessionIssued>
  /**
   * Resolves for an unknown address too — the adapter swallows that difference,
   * because revealing it is what HU-SP-004 criterion 2 forbids.
   */
  requestPasswordReset(email: string): Promise<void>
  /**
   * `OP-IDN-048`. Revokes the provider session so the refresh dies with it.
   *
   * **Never rejects.** A token that cannot be verified, a session already gone, a
   * provider outage — all resolve. The device erases what it holds regardless, and
   * an error here would be the API telling somebody they may not leave.
   */
  signOut(accessToken: string): Promise<void>
}

export interface SpaceRegistrationDependencies {
  authProvider: AuthProvider
  issuer: string
  now?: () => Date
}

export function createSpaceRegistrationService(
  dependencies: SpaceRegistrationDependencies,
): SpaceRegistrationService {
  const now = dependencies.now ?? (() => new Date())

  return {
    async register(email, password) {
      try {
        // The outcome says whether a credential was created. It is deliberately
        // ignored: acting on it is exactly the disclosure HU-SP-001 criterion 3
        // forbids, and the port documents the flag as being for server-side
        // metrics only.
        await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.register({ email, password }),
        )
      } catch (cause) {
        throw toRegistrationError(cause)
      }

      return { expiresAt: new Date(now().getTime() + VERIFICATION_WINDOW_MINUTES * 60_000) }
    },

    async verify(email, password, code) {
      try {
        const result = await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.verifyEmail({ email, password }, code, 'space'),
        )
        return {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresIn: result.tokens.expiresIn,
          analytics: analyticsIdentityForSurfaceFromEnvironment(
            'space',
            dependencies.issuer,
            result.subject,
          ),
        }
      } catch (cause) {
        throw toRegistrationError(cause)
      }
    },

    async signIn(email, password) {
      try {
        const result = await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.authenticateWithPassword({ email, password }, 'space'),
        )
        return {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresIn: result.tokens.expiresIn,
          analytics: analyticsIdentityForSurfaceFromEnvironment(
            'space',
            dependencies.issuer,
            result.subject,
          ),
        }
      } catch (cause) {
        throw toRegistrationError(cause)
      }
    },

    async requestPasswordReset(email) {
      try {
        // Lower-cased for the provider, which treats addresses as case-sensitive
        // on lookup even though mail servers do not.
        await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.requestPasswordReset(email.trim().toLowerCase(), 'space'),
        )
      } catch (cause) {
        throw toRegistrationError(cause)
      }
    },

    async signOut(accessToken) {
      try {
        // The `sid` is the only thing revocable, and it lives in the token rather
        // than in our database: Space keeps no session row to look it up in.
        const token = await measureRequestPhase('token-local', () =>
          dependencies.authProvider.verifyAccessToken(accessToken, 'space'),
        )
        await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.revokeSession(token.sessionId, 'space'),
        )
      } catch {
        // Swallowed on purpose, and this is the whole design of the operation.
        // `OP-IDN-048` concedes signing out unconditionally.
      }
    },

    async refresh(refreshToken) {
      try {
        const tokens = await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.refresh(refreshToken, 'space'),
        )
        // No analytics identity here: refreshing returns tokens without a
        // subject, and inventing one would attribute events to the wrong person.
        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
        }
      } catch (cause) {
        throw toRegistrationError(cause)
      }
    },
  }
}

function toRegistrationError(cause: unknown): RegistrationError {
  // Server-side only. The client is told one thing for several causes on
  // purpose, which leaves nobody able to diagnose a failure from the outside —
  // including us. `detail` carries the provider's reason and never reaches a
  // response; see `fail`, which forwards only what it is handed.
  console.warn('[identity] registration failed', {
    code: cause instanceof AuthError ? cause.code : 'non-auth-error',
    detail: cause instanceof AuthError ? cause.detail : String(cause).slice(0, 200),
  })

  if (!(cause instanceof AuthError)) return new RegistrationError('upstream-unavailable')

  switch (cause.code) {
    case 'provider_unavailable':
    case 'invalid_webhook':
      return new RegistrationError('upstream-unavailable')
    case 'invalid_credentials':
    case 'invalid_token':
      // Wrong code, wrong password, unknown address and already-verified all
      // arrive here as one code and leave as one answer.
      return new RegistrationError('unauthenticated')
    case 'invalid_email':
      // Only reachable on a malformed address: the port swallows the
      // already-in-use case rather than raising it.
      return new RegistrationError('invalid-request')
    case 'weak_password':
      // The one rejection reported precisely. It concerns the secret the person
      // just chose and reveals nothing about who else is registered, so hiding
      // it would cost them a retry and buy nobody any privacy.
      return new RegistrationError('weak-password')
  }
}
