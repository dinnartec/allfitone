/** Password + TOTP Backoffice authentication. No session exists before AAL2. */

import {
  AuthError,
  type AuthProvider,
  type PasswordCredentials,
  type SessionTokens,
} from '@allfitone/auth-provider'
import {
  analyticsIdentityForSurfaceFromEnvironment,
  type AnalyticsIdentity,
} from '@allfitone/telemetry/node'
import { measureRequestPhase } from '../../../platform/observability/index.js'

import type {
  BackofficeAuthenticationDatabase,
  SessionCipherContext,
  SessionTokenVault,
  StoredBackofficeSession,
  StoredSessionSecret,
} from '../domain/index.js'

const ATTEMPT_TTL_MS = 10 * 60 * 1000
const REFRESH_WINDOW_MS = 30_000

export type BackofficeAuthenticationErrorCode =
  'unauthenticated' | 'upstream-unavailable' | 'conflict'

export class BackofficeAuthenticationError extends Error {
  constructor(
    readonly code: BackofficeAuthenticationErrorCode,
    readonly clearLocalCredential = code === 'unauthenticated',
  ) {
    super(code)
    this.name = 'BackofficeAuthenticationError'
  }
}

export interface BackofficeAttemptPresentation {
  next: 'totp-enrollment' | 'totp-challenge'
  expires_at: string
  enrollment?: { qr_code: string; manual_key: string }
}

export interface BackofficeSessionPresentation {
  authenticated: true
  assurance_level: 2
  authentication_method: 'password_totp'
  operator: { given_name: string; family_name: string }
  assurance_verified_at: string
  inactivity_expires_at: string
  absolute_expires_at: string
  /** Optional only for injected test seams; production session resolution always sets it. */
  analytics?: AnalyticsIdentity
}

export interface BackofficeAuthenticationService {
  startPassword(credentials: PasswordCredentials): Promise<{
    attemptToken: string
    presentation: BackofficeAttemptPresentation
  }>
  readAttempt(attemptToken: string): Promise<BackofficeAttemptPresentation>
  verifyTotp(input: {
    attemptToken: string
    code: string
    idempotencyKey: string
    commandId: string
  }): Promise<{ sessionToken: string }>
  readSession(sessionToken: string): Promise<BackofficeSessionPresentation>
  logout(sessionToken: string | undefined): Promise<'already-absent' | 'partial' | 'revoked'>
  requestPasswordReset(email: string): Promise<void>
}

export function createBackofficeAuthenticationService(dependencies: {
  authProvider: AuthProvider
  database: BackofficeAuthenticationDatabase
  tokenVault: SessionTokenVault
  issuer: string
  now?: () => Date
}): BackofficeAuthenticationService {
  const now = dependencies.now ?? (() => new Date())

  return {
    async startPassword(credentials) {
      let authenticated
      try {
        authenticated = await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.authenticateWithPassword(credentials, 'backoffice'),
        )
      } catch (error) {
        throw authenticationFailure(error)
      }

      let verified
      try {
        verified = await measureRequestPhase('token-local', () =>
          dependencies.authProvider.verifyAccessToken(
            authenticated.tokens.accessToken,
            'backoffice',
          ),
        )
      } catch (error) {
        throw authenticationFailure(error)
      }
      if (verified.subject !== authenticated.subject || !authenticated.identity.verifiedEmail) {
        await safeRevoke(verified.sessionId)
        throw new BackofficeAuthenticationError('unauthenticated')
      }
      const verifiedEmail = authenticated.identity.verifiedEmail

      const account = await measureRequestPhase('actor-db', () =>
        dependencies.database.resolveEligibleAccount(dependencies.issuer, verified.subject),
      )
      if (!account) {
        await safeRevoke(verified.sessionId)
        throw new BackofficeAuthenticationError('unauthenticated')
      }

      let providerFactorId = account.providerFactorId
      let enrollment: { qrCode: string; manualKey: string } | null = null
      let newFactor = false
      try {
        if (!providerFactorId) {
          const created = await measureRequestPhase('workos-refresh', () =>
            dependencies.authProvider.enrollTotp(verifiedEmail, 'backoffice'),
          )
          providerFactorId = created.factorId
          enrollment = { qrCode: created.qrCode, manualKey: created.manualKey }
          newFactor = true
        }
        const activeProviderFactorId = providerFactorId
        if (!activeProviderFactorId) {
          throw new BackofficeAuthenticationError('upstream-unavailable')
        }
        const challenge = await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.challengeTotp(activeProviderFactorId, 'backoffice'),
        )
        const attemptToken = dependencies.tokenVault.generateOpaqueToken()
        const expiresAt = new Date(now().getTime() + ATTEMPT_TTL_MS)
        const context = cipherContext(account.accountId, verified.sessionId)
        await measureRequestPhase('business-db', () =>
          dependencies.database.startAttempt({
            accountId: account.accountId,
            providerFactorId: activeProviderFactorId,
            newFactor,
            providerSessionId: verified.sessionId,
            providerChallengeId: challenge.challengeId,
            attemptTokenHash: dependencies.tokenVault.hashOpaqueToken(attemptToken),
            secretCiphertext: dependencies.tokenVault.sealBackofficeAttempt(
              { tokens: authenticated.tokens, identity: authenticated.identity, enrollment },
              context,
            ),
            accessTokenExpiresAt: expiresAtFor(authenticated.tokens, now()),
            status: newFactor ? 'pending_enrollment' : 'pending_challenge',
            expiresAt,
          }),
        )
        return { attemptToken, presentation: attemptPresentation(expiresAt, enrollment) }
      } catch (error) {
        await safeRevoke(verified.sessionId)
        if (newFactor && providerFactorId) {
          await dependencies.authProvider
            .deleteAuthenticationFactor(providerFactorId, 'backoffice')
            .catch(() => undefined)
        }
        throw authenticationFailure(error)
      }
    },

    async readAttempt(attemptToken) {
      const attempt = await measureRequestPhase('session-db', () =>
        dependencies.database.loadAttempt(dependencies.tokenVault.hashOpaqueToken(attemptToken)),
      )
      if (!attempt || attempt.status === 'completed' || !attempt.secretCiphertext) {
        throw new BackofficeAuthenticationError('unauthenticated')
      }
      try {
        const secret = dependencies.tokenVault.openBackofficeAttempt(
          attempt.secretCiphertext,
          cipherContext(attempt.accountId, attempt.providerSessionId),
        )
        return attemptPresentation(attempt.expiresAt, secret.enrollment)
      } catch {
        throw new BackofficeAuthenticationError('unauthenticated')
      }
    },

    async verifyTotp(input) {
      const attemptHash = dependencies.tokenVault.hashOpaqueToken(input.attemptToken)
      const attempt = await measureRequestPhase('session-db', () =>
        dependencies.database.loadAttempt(attemptHash),
      )
      if (!attempt) throw new BackofficeAuthenticationError('unauthenticated')

      const sessionToken = dependencies.tokenVault.deriveOpaqueToken(
        input.attemptToken,
        'backoffice-session',
      )
      if (attempt.status === 'completed') {
        if (
          attempt.verificationIdempotencyKey !== input.idempotencyKey ||
          attempt.verificationCommandId !== input.commandId
        ) {
          throw new BackofficeAuthenticationError('conflict')
        }
        return { sessionToken }
      }
      if (!attempt.secretCiphertext || !['pending', 'active'].includes(attempt.factorStatus)) {
        throw new BackofficeAuthenticationError('unauthenticated')
      }

      try {
        await measureRequestPhase('business-db', () =>
          dependencies.database.bindTotpVerification({
            attemptTokenHash: attemptHash,
            idempotencyKey: input.idempotencyKey,
            commandId: input.commandId,
          }),
        )
      } catch {
        throw new BackofficeAuthenticationError('conflict')
      }

      let verification
      try {
        verification = await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.verifyTotp(
            attempt.providerChallengeId,
            input.code,
            'backoffice',
          ),
        )
      } catch (error) {
        if (error instanceof AuthError && error.retryable) {
          throw new BackofficeAuthenticationError('upstream-unavailable')
        }
        const failure = await measureRequestPhase('business-db', () =>
          dependencies.database.recordTotpFailure(attemptHash),
        )
        throw new BackofficeAuthenticationError('unauthenticated', failure.terminal)
      }
      if (!verification.valid) {
        const failure = await measureRequestPhase('business-db', () =>
          dependencies.database.recordTotpFailure(attemptHash),
        )
        throw new BackofficeAuthenticationError('unauthenticated', failure.terminal)
      }

      let secret
      try {
        secret = dependencies.tokenVault.openBackofficeAttempt(
          attempt.secretCiphertext,
          cipherContext(attempt.accountId, attempt.providerSessionId),
        )
      } catch {
        throw new BackofficeAuthenticationError('unauthenticated')
      }
      await measureRequestPhase('business-db', () =>
        dependencies.database.completeAuthentication({
          attemptTokenHash: attemptHash,
          idempotencyKey: input.idempotencyKey,
          commandId: input.commandId,
          sessionTokenHash: dependencies.tokenVault.hashOpaqueToken(sessionToken),
          sessionTokenCiphertext: dependencies.tokenVault.seal(
            { tokens: secret.tokens, identity: secret.identity },
            cipherContext(attempt.accountId, attempt.providerSessionId),
          ),
          accessTokenExpiresAt: attempt.accessTokenExpiresAt,
        }),
      )
      return { sessionToken }
    },

    async readSession(sessionToken) {
      const hash = dependencies.tokenVault.hashOpaqueToken(sessionToken)
      const resolved = await authenticatedSession(hash, true)
      return {
        authenticated: true,
        assurance_level: 2,
        authentication_method: 'password_totp',
        operator: {
          given_name: resolved.session.givenName,
          family_name: resolved.session.familyName,
        },
        assurance_verified_at: resolved.session.assuranceVerifiedAt.toISOString(),
        inactivity_expires_at: new Date(
          resolved.session.lastActivityAt.getTime() + 15 * 60 * 1000,
        ).toISOString(),
        absolute_expires_at: resolved.session.absoluteExpiresAt.toISOString(),
        analytics: analyticsIdentityForSurfaceFromEnvironment(
          'backoffice',
          dependencies.issuer,
          resolved.session.externalSubject,
        ),
      }
    },

    async logout(sessionToken) {
      if (!sessionToken) return 'already-absent'
      let result
      try {
        result = await measureRequestPhase('session-db', () =>
          dependencies.database.logout(dependencies.tokenVault.hashOpaqueToken(sessionToken)),
        )
      } catch {
        return 'partial'
      }
      if (!result.providerSessionId) return result.outcome
      const providerSessionId = result.providerSessionId
      try {
        await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.revokeSession(providerSessionId, 'backoffice'),
        )
        return result.outcome
      } catch {
        return 'partial'
      }
    },

    async requestPasswordReset(email) {
      try {
        await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.requestPasswordReset(email.trim().toLowerCase(), 'backoffice'),
        )
      } catch (error) {
        throw authenticationFailure(error)
      }
    },
  }

  async function authenticatedSession(
    tokenHash: Uint8Array,
    reloadAfterRace: boolean,
  ): Promise<{ session: StoredBackofficeSession; secret: StoredSessionSecret }> {
    const session = await measureRequestPhase('session-db', () =>
      dependencies.database.loadSession(tokenHash),
    )
    if (!session) throw new BackofficeAuthenticationError('unauthenticated')
    const context = cipherContext(session.accountId, session.providerSessionId)
    let secret: StoredSessionSecret
    try {
      secret = dependencies.tokenVault.open(session.tokenCiphertext, context)
    } catch {
      await dependencies.database.logout(tokenHash)
      throw new BackofficeAuthenticationError('unauthenticated')
    }

    if (session.accessTokenExpiresAt.getTime() <= now().getTime() + REFRESH_WINDOW_MS) {
      let refreshed: SessionTokens
      try {
        refreshed = await measureRequestPhase('workos-refresh', () =>
          dependencies.authProvider.refresh(secret.tokens.refreshToken, 'backoffice'),
        )
      } catch (error) {
        if (error instanceof AuthError && error.retryable) {
          if (session.accessTokenExpiresAt.getTime() <= now().getTime()) {
            throw new BackofficeAuthenticationError('upstream-unavailable')
          }
          await verifyAccessToken(secret.tokens.accessToken, session, tokenHash)
          return { session, secret }
        }
        await dependencies.database.logout(tokenHash)
        throw new BackofficeAuthenticationError('unauthenticated')
      }
      await verifyAccessToken(refreshed.accessToken, session, tokenHash)
      const rotated = await measureRequestPhase('session-db', () =>
        dependencies.database.rotateSession({
          sessionId: session.sessionId,
          expectedTokenVersion: session.tokenVersion,
          tokenCiphertext: dependencies.tokenVault.seal(
            { tokens: refreshed, identity: secret.identity },
            context,
          ),
          accessTokenExpiresAt: expiresAtFor(refreshed, now()),
        }),
      )
      if (!rotated) {
        if (!reloadAfterRace) throw new BackofficeAuthenticationError('upstream-unavailable')
        return authenticatedSession(tokenHash, false)
      }
      return { session, secret: { tokens: refreshed, identity: secret.identity } }
    }
    await verifyAccessToken(secret.tokens.accessToken, session, tokenHash)
    return { session, secret }
  }

  async function verifyAccessToken(
    accessToken: string,
    session: StoredBackofficeSession,
    tokenHash: Uint8Array,
  ): Promise<void> {
    try {
      const verified = await measureRequestPhase('token-local', () =>
        dependencies.authProvider.verifyAccessToken(accessToken, 'backoffice'),
      )
      if (
        verified.subject !== session.externalSubject ||
        verified.sessionId !== session.providerSessionId ||
        verified.surface !== 'backoffice'
      ) {
        throw new BackofficeAuthenticationError('unauthenticated')
      }
    } catch (error) {
      if (error instanceof BackofficeAuthenticationError) {
        await dependencies.database.logout(tokenHash)
        throw error
      }
      if (error instanceof AuthError && error.retryable) {
        throw new BackofficeAuthenticationError('upstream-unavailable')
      }
      await dependencies.database.logout(tokenHash)
      throw new BackofficeAuthenticationError('unauthenticated')
    }
  }

  async function safeRevoke(sessionId: string): Promise<void> {
    await measureRequestPhase('workos-refresh', () =>
      dependencies.authProvider.revokeSession(sessionId, 'backoffice'),
    ).catch(() => undefined)
  }
}

function cipherContext(accountId: string, providerSessionId: string): SessionCipherContext {
  return { accountId, providerSessionId, surface: 'backoffice' }
}

function attemptPresentation(
  expiresAt: Date,
  enrollment: { qrCode: string; manualKey: string } | null,
): BackofficeAttemptPresentation {
  return {
    next: enrollment ? 'totp-enrollment' : 'totp-challenge',
    expires_at: expiresAt.toISOString(),
    ...(enrollment
      ? { enrollment: { qr_code: enrollment.qrCode, manual_key: enrollment.manualKey } }
      : {}),
  }
}

function expiresAtFor(tokens: SessionTokens, now: Date): Date {
  return new Date(now.getTime() + tokens.expiresIn * 1000)
}

function authenticationFailure(error: unknown): BackofficeAuthenticationError {
  if (error instanceof BackofficeAuthenticationError) return error
  if (error instanceof AuthError) {
    return new BackofficeAuthenticationError(
      error.retryable ? 'upstream-unavailable' : 'unauthenticated',
    )
  }
  return new BackofficeAuthenticationError('upstream-unavailable')
}
