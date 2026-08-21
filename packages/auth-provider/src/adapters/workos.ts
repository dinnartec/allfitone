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
 *
 * ON TRANSLATING ERRORS
 * The provider's structured error code is the signal; its prose is not. That
 * lesson cost four separate bugs, all the same shape: something whose message or
 * code contained the word "email" was treated as a statement about the address.
 * A duplicate registration, a mistyped verification code, a throttled attempt and
 * an unverified account each landed in the address branch, and each answered a
 * status that told a caller something the design goes to lengths to hide.
 *
 * Hence the order in `translate`. Verification codes are checked first, then any
 * outright refusal — 401 or 403 — and only after those does a code mentioning
 * "email" mean the address itself. The last of those bugs was found against the
 * live API: an unverified account is refused with 403 and a code containing
 * "email", so it answered 400 while an unknown address answered 401, which let a
 * caller tell registered addresses apart. HU-SP-002 criterion 2 forbids exactly
 * that.
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
  AuthProviderEvent,
  AuthorizationRequest,
  AuthResult,
  ExternalSubject,
  PasswordCredentials,
  RegistrationOutcome,
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

/** Five minutes in the milliseconds expected by the WorkOS SDK. */
const WEBHOOK_TOLERANCE_MILLISECONDS = 300_000

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
  /** Secret assigned to the environment's WorkOS webhook endpoint. */
  webhookSecret: string
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
      identity: {
        givenName: normalizedName(response.user.firstName),
        familyName: normalizedName(response.user.lastName),
        verifiedEmail: response.user.emailVerified
          ? response.user.email.trim().toLowerCase()
          : null,
      },
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

    async verifyWebhookEvent(
      rawPayload: string,
      signature: string,
    ): Promise<AuthProviderEvent | null> {
      let event
      try {
        event = await requireClient(ADMIN_SURFACE).webhooks.constructEvent({
          payload: rawPayload,
          sigHeader: signature,
          secret: config.webhookSecret,
          tolerance: WEBHOOK_TOLERANCE_MILLISECONDS,
        })
      } catch {
        // Deliberately omit the SDK error: verification failures can echo the
        // signature or payload and neither belongs in logs.
        throw new AuthError('invalid_webhook', 'webhook rejected')
      }

      if (event.event !== 'password_reset.succeeded') return null

      const data = event.data
      const subject = field(data, 'userId')
      const occurredAt = normalizedInstant(event.createdAt)
      if (!event.id || !subject || !occurredAt) {
        throw new AuthError('invalid_webhook', 'consumed event malformed')
      }

      // Do not spread the provider object. Password-reset email, reset id and
      // context are intentionally discarded at this boundary.
      return {
        kind: 'password-reset-succeeded',
        eventId: event.id,
        subject,
        occurredAt,
      }
    },

    async register(credentials: PasswordCredentials): Promise<RegistrationOutcome> {
      // Not surface-scoped: creating a credential acts on the directory, which
      // every Application in the environment shares.
      const c = requireClient(ADMIN_SURFACE)

      let userId: string
      try {
        const user = await c.userManagement.createUser(credentials)
        userId = user.id
      } catch (cause) {
        const error = asAdminFailure(cause)
        // An address already in use is NOT an error to this caller. The provider
        // rejects it, and `translate` has flattened that rejection into the same
        // code a malformed address produces, so the two cannot be told apart
        // here either. Reporting "not created" lets the caller answer exactly as
        // it would on success, which is what makes the endpoint above
        // indistinguishable in both cases.
        if (error.code !== 'invalid_email') throw error
        // The address already has an account. Not an error to this caller — see
        // above — but not the end of the attempt either: if it is still
        // unverified, this is someone asking for their code again, and doing
        // nothing is why the resend button appeared to work and never delivered.
        return { created: false, resent: await resendIfUnverified(c, credentials.email) }
      }

      try {
        // Creating a user opens a verification but does not email it. This is
        // the call that actually sends a code.
        await c.userManagement.sendVerificationEmail({ userId })
      } catch (cause) {
        // The credential exists but no code went out. Failing is right: the
        // person would otherwise wait for an email that never arrives, and
        // retrying is safe because the second attempt lands on the
        // already-in-use path above.
        throw asAdminFailure(cause)
      }

      return { created: true }
    },

    async verifyEmail(
      credentials: PasswordCredentials,
      code: string,
      surface: Surface,
    ): Promise<AuthResult> {
      const c = requireClient(ADMIN_SURFACE)

      // The provider offers no lookup by address other than a filtered list.
      let userId: string
      try {
        const found = await c.userManagement.listUsers({ email: credentials.email })
        const user = found.data[0]
        // No such address. Reported as bad credentials so it is answered
        // identically to a wrong code, which is what stops this from becoming a
        // way to ask whether an address is registered.
        if (!user) throw new AuthError('invalid_credentials', 'no user for address')
        userId = user.id
      } catch (cause) {
        throw cause instanceof AuthError ? cause : asAdminFailure(cause)
      }

      try {
        await c.userManagement.verifyEmail({ code, userId })
      } catch (cause) {
        throw translate(cause)
      }

      // Verified, so an ordinary sign-in now succeeds and yields the session.
      // The single call that does both at once cannot be used here: it needs a
      // pending token that emailing the code invalidates.
      return authenticate(surface, (client, clientId) =>
        client.userManagement.authenticateWithPassword({ ...credentials, clientId }),
      )
    },

    async authenticateWithPassword(
      credentials: PasswordCredentials,
      surface: Surface,
    ): Promise<AuthResult> {
      return authenticate(surface, (c, clientId) =>
        c.userManagement.authenticateWithPassword({ ...credentials, clientId }),
      )
    },

    async enrollTotp(label: string, surface: Surface) {
      try {
        const factor = await requireClient(surface).multiFactorAuth.enrollFactor({
          type: 'totp',
          issuer: 'Allfit Backoffice',
          user: label,
        })
        if (!factor.id || !factor.totp?.qrCode || !factor.totp.secret) {
          throw new AuthError('provider_unavailable', 'TOTP enrollment response was incomplete')
        }
        return {
          factorId: factor.id,
          qrCode: factor.totp.qrCode,
          manualKey: factor.totp.secret,
        }
      } catch (cause) {
        throw cause instanceof AuthError ? cause : translate(cause)
      }
    },

    async challengeTotp(factorId: string, surface: Surface) {
      try {
        const challenge = await requireClient(surface).multiFactorAuth.challengeFactor({
          authenticationFactorId: factorId,
        })
        if (!challenge.id) {
          throw new AuthError('provider_unavailable', 'TOTP challenge response was incomplete')
        }
        return { challengeId: challenge.id, expiresAt: challenge.expiresAt ?? null }
      } catch (cause) {
        throw cause instanceof AuthError ? cause : translate(cause)
      }
    },

    async verifyTotp(challengeId: string, code: string, surface: Surface) {
      try {
        const result = await requireClient(surface).multiFactorAuth.verifyChallenge({
          authenticationChallengeId: challengeId,
          code,
        })
        return { valid: result.valid, alreadyVerified: false }
      } catch (cause) {
        if (providerErrorCodes(cause).includes('authentication_challenge_previously_verified')) {
          return { valid: true, alreadyVerified: true }
        }
        throw translate(cause)
      }
    },

    async deleteAuthenticationFactor(factorId: string, surface: Surface): Promise<void> {
      try {
        await requireClient(surface).multiFactorAuth.deleteFactor(factorId)
      } catch (cause) {
        // Cleanup is idempotent: an absent provider factor is already deleted.
        if (statusOf(cause) === 404) return
        throw translate(cause)
      }
    },

    async requestPasswordReset(email: string, surface: Surface): Promise<void> {
      try {
        // The SDK returns a reset token and URL. Deliberately discard both here.
        await requireClient(surface).userManagement.createPasswordReset({ email })
      } catch (cause) {
        // Unknown and known addresses must receive the same public response.
        if (statusOf(cause) === 404) return
        throw asAdminFailure(cause)
      }
    },

    async revokeSession(sessionId: string, surface: Surface): Promise<void> {
      try {
        await requireClient(surface).userManagement.revokeSession({ sessionId })
      } catch (cause) {
        if (statusOf(cause) === 404) return
        throw translate(cause)
      }
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

function normalizedName(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function field(value: unknown, name: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = (value as Record<string, unknown>)[name]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

function normalizedInstant(value: string): string | null {
  const epoch = Date.parse(value)
  return Number.isNaN(epoch) ? null : new Date(epoch).toISOString()
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

  // Checked before status, because the provider reports an address already in
  // use as a plain 400 whose top-level message says only "Could not create
  // user." The reason lives in a nested `errors[].code`, and reading only the
  // status or the message lands this in the default branch — which is how a
  // duplicate registration answered 401 while a fresh one answered 202, in
  // direct violation of HU-SP-001 criterion 3. Verified against the live API.
  const codes = providerErrorCodes(cause)
  // Checked before the address rules, because the provider names a wrong
  // verification code `email_verification_code_incorrect` and reports it as
  // "Email verification code is incorrect." Both contain the word this file
  // otherwise treats as meaning "the address is unusable", so without this a
  // mistyped code came back as a malformed email and answered 400 instead of
  // 401 — telling the person to fix an address that was never wrong.
  if (codes.some((code) => code.includes('verification_code'))) {
    return new AuthError('invalid_credentials', trace)
  }
  // A refusal is never a statement about the shape of the address. See the
  // header note on translating errors.
  if (status === 401 || status === 403) {
    return new AuthError('invalid_credentials', trace)
  }
  if (codes.some((code) => code.includes('email'))) {
    return new AuthError('invalid_email', trace)
  }
  // Also a 400 with the reason nested. Distinguished from the address case
  // because it is the one rejection worth describing to the person: it is about
  // the secret they chose, and says nothing about who else has an account.
  if (codes.some((code) => code.includes('password'))) {
    return new AuthError('weak_password', trace)
  }
  if (status === 401 || status === 403 || text.includes('invalid credential')) {
    return new AuthError('invalid_credentials', trace)
  }
  if (text.includes('verification code')) {
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

/**
 * Sends the code again for an address that exists but is not yet verified.
 *
 * Separate from registration because the provider has no idempotent "register
 * or resend": creating the user is what fails, and this is what the failure
 * should lead to. A verified address gets nothing, which is correct — there is
 * no code to resend and mailing one would be a way to pester an account holder.
 *
 * Failures are swallowed. The caller's response must not vary with what happened
 * here, and a person who receives nothing will press the button again.
 */
async function resendIfUnverified(client: WorkOSClient, email: string): Promise<boolean> {
  try {
    const found = await client.userManagement.listUsers({ email })
    const user = found.data[0]
    if (!user || user.emailVerified) return false
    await client.userManagement.sendVerificationEmail({ userId: user.id })
    return true
  } catch {
    return false
  }
}

/**
 * Translation for calls that carry no person credentials.
 *
 * `createUser`, `listUsers` and `sendVerificationEmail` authenticate with our
 * API key alone. A 401 or 403 there can only mean **our** key was refused, and
 * routing it through the ordinary path turns a server misconfiguration into
 * "check your email and password" — which is what it did, for the whole time an
 * expired key went unnoticed.
 *
 * Reported as unavailable so the surface answers 503. Not strictly accurate —
 * the provider answered fine — but it puts the failure on our side of the line,
 * which is where it belongs and what a person can act on.
 */
function asAdminFailure(cause: unknown): AuthError {
  const error = translate(cause)
  if (error.code !== 'invalid_credentials') return error
  const status = statusOf(cause)
  if (status !== 401 && status !== 403) return error
  return new AuthError('provider_unavailable', `admin call refused: ${error.detail ?? 'no detail'}`)
}

function statusOf(cause: unknown): number | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined
  const candidate = cause as { status?: unknown; statusCode?: unknown }
  const value = candidate.status ?? candidate.statusCode
  return typeof value === 'number' ? value : undefined
}

/**
 * Every error code the provider attached, top level and nested.
 *
 * The SDK surfaces its response body on the thrown error, and the useful code is
 * usually not the outer one: a duplicate address arrives as
 * `user_creation_error` wrapping `email_not_available`. Collecting both means
 * the caller matches on the specific reason without knowing which level it
 * arrived at.
 */
function providerErrorCodes(cause: unknown): string[] {
  if (typeof cause !== 'object' || cause === null) return []
  const candidate = cause as {
    code?: unknown
    rawData?: { code?: unknown; errors?: unknown }
    errors?: unknown
  }

  const codes: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) codes.push(value.toLowerCase())
  }

  push(candidate.code)
  push(candidate.rawData?.code)

  for (const list of [candidate.errors, candidate.rawData?.errors]) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (typeof entry === 'object' && entry !== null) push((entry as { code?: unknown }).code)
    }
  }

  return codes
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
  if (!config.webhookSecret) {
    throw new Error('WorkOS webhook secret missing. Signed events cannot be verified.')
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
