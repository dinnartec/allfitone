/**
 * WorkOS adapter.
 *
 * The ONLY file in the monorepo allowed to import the provider SDK or talk to
 * the provider. The rule is in eslint.config.js and fails CI, not code review.
 *
 * `verifyAccessToken` is implemented and tested. The remaining methods throw:
 * their SDK signatures are unverified, and a method returning plausible fake
 * data is a lie discovered in production.
 *
 * Open questions for the spike:
 *   1. How the "this session satisfies AAL2" fact reaches the API. All Backoffice
 *      authorization depends on it, and it is not visible in the documented
 *      claim set.
 *   2. Refresh token rotation behaviour under concurrent requests.
 *   3. The exact `iss` value. Configurable here and unset by default, so a wrong
 *      guess cannot silently weaken verification — see `issuer` below.
 */

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose'

import type {
  AuthProvider,
  AuthResult,
  ExternalSubject,
  PasswordCredentials,
  SessionTokens,
  Surface,
  VerifiedToken,
} from '../port.js'
import { AuthError } from '../errors.js'

const SURFACES = ['space', 'studio', 'backoffice'] as const

export interface WorkOSConfig {
  apiKey: string
  /** One client_id per Application. One environment, three applications, one directory. */
  clientIds: Record<Surface, string>
  /**
   * Expected `iss`. Left unset until confirmed against a real token, because a
   * wrong value would either reject everything or, worse, be quietly removed by
   * whoever debugs it. Set it once verified — it is a real defence.
   */
  issuer?: string
  /**
   * Test seam: verify against a local key set instead of fetching the remote
   * JWKS. Production leaves this unset and fetches per surface.
   */
  jwks?: JSONWebKeySet
}

export function createWorkOSAuthProvider(config: WorkOSConfig): AuthProvider {
  assertConfig(config)

  // createRemoteJWKSet caches keys and handles rotation, so one per surface is
  // built once and reused for the process lifetime.
  const keyResolvers = new Map<Surface, JWTVerifyGetKey>()
  for (const surface of SURFACES) {
    keyResolvers.set(
      surface,
      config.jwks
        ? createLocalJWKSet(config.jwks)
        : createRemoteJWKSet(
            new URL(`https://api.workos.com/sso/jwks/${config.clientIds[surface]}`),
          ),
    )
  }

  const unimplemented = (method: string): never => {
    throw new Error(
      `workos.${method} is not implemented. Do not use it until the SDK contract is verified.`,
    )
  }

  return {
    async verifyAccessToken(token: string, surface: Surface): Promise<VerifiedToken> {
      const getKey = keyResolvers.get(surface)
      if (!getKey) throw new AuthError('invalid_token', `unknown surface: ${surface}`)

      let claims: Record<string, unknown>
      try {
        const result = await jwtVerify(token, getKey, {
          algorithms: ['RS256'],
          ...(config.issuer ? { issuer: config.issuer } : {}),
        })
        claims = result.payload as Record<string, unknown>
      } catch (cause) {
        // Distinguish "we could not reach the provider" from "this token is
        // bad". Only the former is worth retrying; retrying the latter is how a
        // credential-stuffing attempt gets free attempts.
        if (isProviderOutage(cause)) {
          throw new AuthError('provider_unavailable', 'jwks fetch failed')
        }
        throw new AuthError('invalid_token', reasonFor(cause))
      }

      // A correctly signed, unexpired token issued for another surface is still
      // rejected. `wrong-surface` exists precisely for this.
      if (claims.client_id !== config.clientIds[surface]) {
        throw new AuthError('invalid_token', 'client_id does not match surface')
      }

      const subject = claims.sub
      const sessionId = claims.sid
      if (typeof subject !== 'string' || subject.length === 0) {
        throw new AuthError('invalid_token', 'missing sub')
      }
      // Without sid there is no revocation and no audit trail, so the token is
      // unusable even when the person behind it is real.
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new AuthError('invalid_token', 'missing sid')
      }

      // Deliberately narrow. org_id, role and permissions are present in the
      // token and are NOT returned: authorization is resolved in PostgreSQL,
      // inside the transaction. Widening this creates a second source of truth.
      return { subject, sessionId, surface }
    },

    async authenticateWithPassword(
      _credentials: PasswordCredentials,
      _surface: Surface,
    ): Promise<AuthResult> {
      return unimplemented('authenticateWithPassword')
    },

    async authenticateWithCode(_code: string, _surface: Surface): Promise<AuthResult> {
      return unimplemented('authenticateWithCode')
    },

    async refresh(_refreshToken: string, _surface: Surface): Promise<SessionTokens> {
      return unimplemented('refresh')
    },

    async updateEmail(_subject: ExternalSubject, _email: string): Promise<void> {
      return unimplemented('updateEmail')
    },

    async revokeSessions(_subject: ExternalSubject): Promise<void> {
      return unimplemented('revokeSessions')
    },
  }
}

/** Network or JWKS availability, not a verdict about the token. */
function isProviderOutage(cause: unknown): boolean {
  if (cause instanceof joseErrors.JWKSTimeout) return true
  // A JWKS that cannot be parsed or reached surfaces as a plain fetch/TypeError
  // rather than a JOSE error.
  return !(cause instanceof joseErrors.JOSEError) && cause instanceof Error
}

/**
 * A short, fixed reason. Never the token, never a claim value: this string
 * reaches internal logs, and logs get shared.
 */
function reasonFor(cause: unknown): string {
  if (cause instanceof joseErrors.JWTExpired) return 'expired'
  if (cause instanceof joseErrors.JWSSignatureVerificationFailed) return 'signature rejected'
  if (cause instanceof joseErrors.JWKSNoMatchingKey) return 'no matching key'
  if (cause instanceof joseErrors.JWTClaimValidationFailed) return 'claim rejected'
  if (cause instanceof joseErrors.JWSInvalid || cause instanceof joseErrors.JWTInvalid) {
    return 'malformed'
  }
  return 'rejected'
}

function assertConfig(config: WorkOSConfig): void {
  if (!config.apiKey) {
    throw new Error('WORKOS_API_KEY missing. The API key never ships in a client bundle.')
  }
  for (const surface of SURFACES) {
    if (!config.clientIds[surface]) {
      throw new Error(`Missing client_id for surface "${surface}".`)
    }
  }
}
