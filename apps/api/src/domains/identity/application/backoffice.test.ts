import { describe, expect, test } from 'bun:test'
import type { AuthProvider, AuthenticatedIdentity, SessionTokens } from '@allfitone/auth-provider'

import type {
  BackofficeAttemptSecret,
  BackofficeAuthenticationDatabase,
  SessionTokenVault,
  StoredBackofficeAttempt,
} from '../domain/index.js'
import {
  BackofficeAuthenticationError,
  createBackofficeAuthenticationService,
} from './backoffice.js'

const NOW = new Date('2026-08-12T12:00:00.000Z')
const TOKENS: SessionTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 3600,
}
const IDENTITY: AuthenticatedIdentity = {
  givenName: 'Ada',
  familyName: 'Lovelace',
  verifiedEmail: 'ada@example.test',
}

function provider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    getAuthorizationUrl: () => 'https://auth.example.test',
    register: async () => ({ created: true }),
    verifyEmail: async () => ({ subject: 'workos-user', identity: IDENTITY, tokens: TOKENS }),
    getLogoutUrl: () => 'https://auth.example.test/logout',
    authenticateWithPassword: async () => ({
      subject: 'workos-user',
      identity: IDENTITY,
      tokens: TOKENS,
    }),
    enrollTotp: async () => ({
      factorId: 'factor-new',
      qrCode: 'otpauth://totp/Allfit',
      manualKey: 'MANUALSECRET',
    }),
    challengeTotp: async () => ({ challengeId: 'challenge-1', expiresAt: null }),
    verifyTotp: async () => ({ valid: true, alreadyVerified: false }),
    deleteAuthenticationFactor: async () => undefined,
    requestPasswordReset: async () => undefined,
    revokeSession: async () => undefined,
    authenticateWithCode: async () => ({
      subject: 'workos-user',
      identity: IDENTITY,
      tokens: TOKENS,
    }),
    refresh: async () => TOKENS,
    verifyAccessToken: async () => ({
      subject: 'workos-user',
      sessionId: 'provider-session',
      surface: 'backoffice',
    }),
    verifyWebhookEvent: async () => null,
    updateEmail: async () => undefined,
    revokeSessions: async () => undefined,
    ...overrides,
  }
}

function harness(
  options: {
    existingFactor?: boolean
    verifiedEmail?: string | null
    verificationValid?: boolean
    failureTerminal?: boolean
  } = {},
) {
  const calls = {
    started: [] as Array<{ newFactor: boolean; status: string }>,
    bound: 0,
    completed: 0,
    failures: 0,
    revoked: [] as string[],
  }
  const identity = {
    ...IDENTITY,
    verifiedEmail: Object.hasOwn(options, 'verifiedEmail')
      ? (options.verifiedEmail ?? null)
      : IDENTITY.verifiedEmail,
  }
  let attempt: StoredBackofficeAttempt | undefined
  let attemptSecret: BackofficeAttemptSecret = { tokens: TOKENS, identity, enrollment: null }

  const database: BackofficeAuthenticationDatabase = {
    resolveEligibleAccount: async () => ({
      accountId: 'account-1',
      personId: 'person-1',
      givenName: 'Ada',
      familyName: 'Lovelace',
      ...(options.existingFactor
        ? { factorId: 'factor-local', providerFactorId: 'factor-existing' }
        : {}),
    }),
    startAttempt: async (input) => {
      calls.started.push({ newFactor: input.newFactor, status: input.status })
      attempt = {
        attemptId: 'attempt-1',
        accountId: input.accountId,
        personId: 'person-1',
        externalSubject: 'workos-user',
        givenName: 'Ada',
        familyName: 'Lovelace',
        factorId: 'factor-local',
        factorStatus: input.newFactor ? 'pending' : 'active',
        providerFactorId: input.providerFactorId,
        providerSessionId: input.providerSessionId,
        providerChallengeId: input.providerChallengeId,
        secretCiphertext: input.secretCiphertext,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        status: input.status,
        invalidCodeCount: 0,
        verificationIdempotencyKey: null,
        verificationCommandId: null,
        completedSessionId: null,
        expiresAt: input.expiresAt,
      }
    },
    loadAttempt: async () => attempt,
    recordTotpFailure: async () => {
      calls.failures += 1
      return {
        remainingAttempts: options.failureTerminal ? 0 : 4,
        terminal: options.failureTerminal ?? false,
      }
    },
    bindTotpVerification: async (input) => {
      calls.bound += 1
      if (attempt) {
        attempt.verificationIdempotencyKey = input.idempotencyKey
        attempt.verificationCommandId = input.commandId
      }
    },
    completeAuthentication: async () => {
      calls.completed += 1
      if (attempt) attempt.status = 'completed'
      return { sessionId: 'session-1', replayed: false }
    },
    loadSession: async () => undefined,
    rotateSession: async () => true,
    logout: async () => ({ outcome: 'revoked', providerSessionId: 'provider-session' }),
  }
  const tokenVault: SessionTokenVault = {
    generateOpaqueToken: () => 'attempt-token',
    deriveOpaqueToken: () => 'derived-session-token',
    hashOpaqueToken: (value) => new TextEncoder().encode(value),
    seal: () => 'sealed-session',
    open: () => ({ tokens: TOKENS, identity }),
    sealBackofficeAttempt: (secret) => {
      attemptSecret = secret
      return 'sealed-attempt'
    },
    openBackofficeAttempt: () => attemptSecret,
  }
  const authProvider = provider({
    authenticateWithPassword: async () => ({
      subject: 'workos-user',
      identity,
      tokens: TOKENS,
    }),
    verifyTotp: async () => ({
      valid: options.verificationValid ?? true,
      alreadyVerified: false,
    }),
    revokeSession: async (sessionId) => {
      calls.revoked.push(sessionId)
    },
  })
  const service = createBackofficeAuthenticationService({
    authProvider,
    database,
    tokenVault,
    issuer: 'https://api.workos.test',
    now: () => NOW,
  })
  return { service, calls }
}

describe('Backoffice AAL2 authentication application service', () => {
  test('enrolls a first TOTP factor but does not create a session before verification', async () => {
    const { service, calls } = harness()
    const result = await service.startPassword({
      email: 'ada@example.test',
      password: 'correct horse battery staple',
    })

    expect(result.presentation.next).toBe('totp-enrollment')
    expect(result.presentation.enrollment?.manual_key).toBe('MANUALSECRET')
    expect(calls.started).toEqual([{ newFactor: true, status: 'pending_enrollment' }])
    expect(calls.completed).toBe(0)
  })

  test('reuses an active factor and materializes exactly one AAL2 session after TOTP', async () => {
    const { service, calls } = harness({ existingFactor: true })
    await service.startPassword({ email: 'ada@example.test', password: 'secret' })
    const result = await service.verifyTotp({
      attemptToken: 'attempt-token',
      code: '123456',
      idempotencyKey: '82daa5c9-605d-457f-b989-74decf1fb12a',
      commandId: '019ff263-2eba-74f0-a49d-b858bc8a96b4',
    })

    expect(result.sessionToken).toBe('derived-session-token')
    expect(calls.started).toEqual([{ newFactor: false, status: 'pending_challenge' }])
    expect(calls.bound).toBe(1)
    expect(calls.completed).toBe(1)
  })

  test('keeps the attempt usable for wrong codes until PostgreSQL marks it terminal', async () => {
    const retryable = harness({ existingFactor: true, verificationValid: false })
    await retryable.service.startPassword({ email: 'ada@example.test', password: 'secret' })
    const firstError = await retryable.service
      .verifyTotp({
        attemptToken: 'attempt-token',
        code: '000000',
        idempotencyKey: '82daa5c9-605d-457f-b989-74decf1fb12a',
        commandId: '019ff263-2eba-74f0-a49d-b858bc8a96b4',
      })
      .catch((error: unknown) => error)
    expect(firstError).toBeInstanceOf(BackofficeAuthenticationError)
    expect((firstError as BackofficeAuthenticationError).clearLocalCredential).toBe(false)
    expect(retryable.calls.failures).toBe(1)

    const terminal = harness({
      existingFactor: true,
      verificationValid: false,
      failureTerminal: true,
    })
    await terminal.service.startPassword({ email: 'ada@example.test', password: 'secret' })
    const lastError = await terminal.service
      .verifyTotp({
        attemptToken: 'attempt-token',
        code: '000000',
        idempotencyKey: '82daa5c9-605d-457f-b989-74decf1fb12a',
        commandId: '019ff263-2eba-74f0-a49d-b858bc8a96b4',
      })
      .catch((error: unknown) => error)
    expect((lastError as BackofficeAuthenticationError).clearLocalCredential).toBe(true)
  })

  test('collapses an unverified provider identity to unauthenticated and revokes its sid', async () => {
    const { service, calls } = harness({ verifiedEmail: null })
    const error = await service
      .startPassword({ email: 'ada@example.test', password: 'secret' })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(BackofficeAuthenticationError)
    expect((error as BackofficeAuthenticationError).code).toBe('unauthenticated')
    expect(calls.revoked).toEqual(['provider-session'])
    expect(calls.started).toHaveLength(0)
  })
})
