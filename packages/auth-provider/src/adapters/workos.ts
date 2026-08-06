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

/**
 * Operations that act on a person rather than a session are not surface-scoped.
 * They still need some Application's credentials, and every Application in the
 * environment reaches the same directory.
 */
const ADMIN_SURFACE: Surface = 'studio'

/** Access tokens are short-lived; the exact value is set in the provider dashboard. */
const ASSUMED_ACCESS_TOKEN_TTL_SECONDS = 300

/**
 * Credentials for one Application.
 *
 * Each Application carries its own API key, not just its own client_id. Sharing
 * one key across surfaces fails the code exchange with `invalid_client`, which
 * is how this was found.
 */
export interface SurfaceCredentials {
  clientId: string
  apiKey: string
}

export interface WorkOSConfig {
  /** One entry per Application. One environment, three Applications, one directory. */
  credentials: Record<Surface, SurfaceCredentials>
  /**
   * Expected `iss`, shared by every Application in the environment.
   *
   * Confirmed empirically: the provider derives it from the environment's
   * DEFAULT Application, not from the one you authenticate against. A token
   * carrying Studio's client_id still carries the default Application's issuer,
   * so it cannot be derived from the credentials above.
   *
   * Required rather than optional: an unset issuer would silently disable the
   * check, and a disabled security check that looks configured is worse than an
   * absent one.
   */
  issuer: string
  /**
   * Test seam: verify against a local key set instead of fetching the remote
   * JWKS. Production leaves this unset.
   */
  jwks?: JSONWebKeySet
  /**
   * Test seam: inject a client per surface, mirroring production. Production
   * leaves this unset.
   */
  clients?: Partial<Record<Surface, WorkOSClient>>
}

export function createWorkOSAuthProvider(config: WorkOSConfig): AuthProvider {
  assertConfig(config)

  const requireClient = (surface: Surface): WorkOSClient => {
    const client = config.clients?.[surface]
    if (!client) {
      throw new Error(
        `WorkOS client not provided for surface "${surface}". ` +
          'Construct the adapter with a client to reach the provider.',
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
    const clientId = config.credentials[surface].clientId
    // Resolved outside the try: a missing client is a configuration fault, and
    // translating it into a retryable provider outage would make a bad deploy
    // retry forever instead of failing loudly.
    const c = requireClient(surface)

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
      return requireClient(request.surface).userManagement.getAuthorizationUrl({
        clientId: config.credentials[request.surface].clientId,
        redirectUri: request.redirectUri,
        // The hosted login screen. Omitting it makes the SDK throw, and the
        // alternatives (connectionId / organizationId) pin the flow to a single
        // enterprise connection, which is not what a shared directory wants.
        provider: 'authkit',
        state: request.state,
        ...(request.maxAgeSeconds === undefined ? {} : { maxAge: request.maxAgeSeconds }),
      })
    },

    getLogoutUrl(request): string {
      return requireClient(ADMIN_SURFACE).userManagement.getLogoutUrl({
        sessionId: request.sessionId,
        returnTo: request.returnTo,
      })
    },

    async verifyAccessToken(token: string, surface: Surface): Promise<VerifiedToken> {
      const getKey = keyResolvers.get(surface)
      if (!getKey) throw new AuthError('invalid_token', `unknown surface: ${surface}`)

      let claims: Record<string, unknown>
      try {
        const result = await jwtVerify(token, getKey, {
          algorithms: ['RS256'],
          issuer: config.issuer,
        })
        claims = result.payload as Record<string, unknown>
      } catch (cause) {
        // Distinguish "we could not reach the provider" from "this token is
        // bad". Only the former is worth retrying; retrying the latter is how a
        // credential-stuffing attempt gets free attempts.
        if (isProviderOutage(cause)) {
          throw new AuthError('provider_unavailable', 'jwks fetch failed')
        }
        // The expected issuer goes into the detail: "claim rejected" alone
        // cannot say whether the token is wrong or the configuration is.
        throw new AuthError(
          'invalid_token',
          `${reasonFor(cause)} (expected issuer ${config.issuer})`,
        )
      }

      // A correctly signed, unexpired token issued for another surface is still
      // rejected. `wrong-surface` exists precisely for this.
      if (claims.client_id !== config.credentials[surface].clientId) {
        throw new AuthError(
          'invalid_token',
          `client_id does not match surface (expected ${config.credentials[surface].clientId})`,
        )
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
      // Not surface-scoped: it acts on the person, not on a session. Any
      // Application's credentials reach the same directory.
      const c = requireClient(ADMIN_SURFACE)
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
      const c = requireClient(ADMIN_SURFACE)
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
  const clientId = config.credentials[surface].clientId
  // Prefer the SDK's own URL builder when a client is available: if WorkOS moves
  // the endpoint, we follow automatically instead of pointing at a dead path.
  const client = config.clients?.[surface]
  return client
    ? client.userManagement.getJwksUrl(clientId)
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
  // Kept for server-side logs only. `detail` never reaches a client — see fail()
  // in platform/http, which only forwards what the caller passes it.
  const trace = `provider status ${status ?? 'none'}: ${messageOf(cause).slice(0, 200)}`

  if (status === 401 || status === 403 || text.includes('invalid credential')) {
    return new AuthError('invalid_credentials', trace)
  }
  if (status === 422 || status === 409 || text.includes('email')) {
    // Deliberately ambiguous to the caller. The trace stays server-side.
    return new AuthError('invalid_email', trace)
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new AuthError('provider_unavailable', trace)
  }
  if (status === undefined) {
    // No status means it never reached the provider.
    return new AuthError('provider_unavailable', trace)
  }
  return new AuthError('invalid_credentials', trace)
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
  if (!config.issuer) {
    throw new Error('Expected issuer missing. Verification would silently accept any issuer.')
  }
  for (const surface of SURFACES) {
    const credentials = config.credentials?.[surface]
    if (!credentials?.clientId) {
      throw new Error(`Missing client_id for surface "${surface}".`)
    }
    // Each Application has its own key. Sharing one across surfaces fails the
    // code exchange with `invalid_client`.
    if (!credentials.apiKey) {
      throw new Error(`Missing API key for surface "${surface}".`)
    }
  }
}
