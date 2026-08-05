/**
 * WorkOS adapter.
 *
 * The ONLY file in the monorepo allowed to import the provider SDK or talk to
 * the provider. The rule is in eslint.config.js and fails CI, not code review.
 *
 * Signatures were verified against @workos-inc/node 10.9.0 type declarations —
 * see workos-client.ts for the exact dependency surface.
 *
 * ON AUTHENTICATION ASSURANCE (AAL)
 * The access token carries sid, org_id, role, roles, permissions, entitlements
 * and feature_flags. It does NOT carry an assurance level, and the SDK's
 * AuthenticationMethod union has no TOTP or MFA value either. So "this session
 * completed a second factor" cannot be read from a token.
 *
 * It has to be recorded by us, once, at authentication time, against the sid —
 * which is consistent with everything else here: the provider states a fact, and
 * PostgreSQL owns it. Backoffice authority checks then read our record inside
 * the transaction, not a claim.
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
  AuthorizationRequest,
  AuthResult,
  ExternalSubject,
  PasswordCredentials,
  SessionTokens,
  Surface,
  VerifiedToken,
} from '../port.js'
import { AuthError } from '../errors.js'
import type { WorkOSAuthenticationResponse, WorkOSClient } from './workos-client.js'

const SURFACES = ['space', 'studio', 'backoffice'] as const

/** Access tokens are short-lived; the exact value is set in the provider dashboard. */
const ASSUMED_ACCESS_TOKEN_TTL_SECONDS = 300

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
   * JWKS. Production leaves this unset.
   */
  jwks?: JSONWebKeySet
  /** Test seam: inject the SDK client. Production leaves this unset. */
  client?: WorkOSClient
}

export function createWorkOSAuthProvider(config: WorkOSConfig): AuthProvider {
  assertConfig(config)

  const client = config.client
  const requireClient = (): WorkOSClient => {
    if (!client) {
      throw new Error(
        'WorkOS client not provided. Construct the adapter with a client to reach the provider.',
      )
    }
    return client
  }

  // createRemoteJWKSet caches keys and handles rotation, so one per surface is
  // built once and reused for the process lifetime.
  const keyResolvers = new Map<Surface, JWTVerifyGetKey>()
  for (const surface of SURFACES) {
    keyResolvers.set(
      surface,
      config.jwks
        ? createLocalJWKSet(config.jwks)
        : createRemoteJWKSet(new URL(jwksUrlFor(config, surface))),
    )
  }

  const authenticate = async (
    surface: Surface,
    call: (c: WorkOSClient, clientId: string) => Promise<WorkOSAuthenticationResponse>,
  ): Promise<AuthResult> => {
    const clientId = config.clientIds[surface]
    // Resolved outside the try: a missing client is a configuration fault, and
    // translating it into a retryable provider outage would make a bad deploy
    // retry forever instead of failing loudly.
    const c = requireClient()

    let response: WorkOSAuthenticationResponse
    try {
      response = await call(c, clientId)
    } catch (cause) {
      throw translate(cause)
    }
    return {
      subject: response.user.id,
      tokens: toSessionTokens(response),
    }
  }

  return {
    getAuthorizationUrl(request: AuthorizationRequest): string {
      return requireClient().userManagement.getAuthorizationUrl({
        clientId: config.clientIds[request.surface],
        redirectUri: request.redirectUri,
        state: request.state,
        ...(request.maxAgeSeconds === undefined ? {} : { maxAge: request.maxAgeSeconds }),
      })
    },

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
      credentials: PasswordCredentials,
      surface: Surface,
    ): Promise<AuthResult> {
      return authenticate(surface, (c, clientId) =>
        c.userManagement.authenticateWithPassword({ ...credentials, clientId }),
      )
    },

    async authenticateWithCode(code: string, surface: Surface): Promise<AuthResult> {
      return authenticate(surface, (c, clientId) =>
        c.userManagement.authenticateWithCode({ code, clientId }),
      )
    },

    async refresh(refreshToken: string, surface: Surface): Promise<SessionTokens> {
      const result = await authenticate(surface, (c, clientId) =>
        c.userManagement.authenticateWithRefreshToken({ refreshToken, clientId }),
      )
      return result.tokens
    },

    async updateEmail(subject: ExternalSubject, email: string): Promise<void> {
      const c = requireClient()
      try {
        await c.userManagement.updateUser({ userId: subject, email })
      } catch (cause) {
        throw translate(cause)
      }
    },

    async revokeSessions(subject: ExternalSubject): Promise<void> {
      // The SDK revokes one session at a time, so "close every session" is list
      // then revoke each. Expressed here rather than in the domain, because the
      // domain should not know that limitation exists.
      const c = requireClient()
      try {
        const sessions = await c.userManagement.listSessions(subject)
        for (const session of sessions.data) {
          await c.userManagement.revokeSession({ sessionId: session.id })
        }
      } catch (cause) {
        throw translate(cause)
      }
    },
  }
}

function jwksUrlFor(config: WorkOSConfig, surface: Surface): string {
  const clientId = config.clientIds[surface]
  // Prefer the SDK's own URL builder when a client is available: if WorkOS moves
  // the endpoint, we follow automatically instead of pointing at a dead path.
  return config.client
    ? config.client.userManagement.getJwksUrl(clientId)
    : `https://api.workos.com/sso/jwks/${clientId}`
}

function toSessionTokens(response: WorkOSAuthenticationResponse): SessionTokens {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresIn: ASSUMED_ACCESS_TOKEN_TTL_SECONDS,
  }
}

/**
 * Provider errors become port errors here and never escape this package.
 *
 * The distinction that matters: "email already registered" collapses into the
 * same error as "malformed email". Propagating the difference would reveal
 * whether a person has an account.
 */
function translate(cause: unknown): AuthError {
  if (cause instanceof AuthError) return cause

  const status = statusOf(cause)
  const text = messageOf(cause).toLowerCase()

  if (status === 401 || status === 403 || text.includes('invalid credential')) {
    return new AuthError('invalid_credentials')
  }
  if (status === 422 || status === 409 || text.includes('email')) {
    // Deliberately ambiguous. See errors.ts.
    return new AuthError('invalid_email')
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new AuthError('provider_unavailable', `provider status ${status}`)
  }
  if (status === undefined) {
    // No status means it never reached the provider.
    return new AuthError('provider_unavailable', 'request failed')
  }
  return new AuthError('invalid_credentials')
}

function statusOf(cause: unknown): number | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined
  const candidate = cause as { status?: unknown; statusCode?: unknown }
  const value = candidate.status ?? candidate.statusCode
  return typeof value === 'number' ? value : undefined
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : ''
}

/** Network or JWKS availability, not a verdict about the token. */
function isProviderOutage(cause: unknown): boolean {
  if (cause instanceof joseErrors.JWKSTimeout) return true
  // A JWKS that cannot be reached surfaces as a plain fetch/TypeError rather
  // than a JOSE error.
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
