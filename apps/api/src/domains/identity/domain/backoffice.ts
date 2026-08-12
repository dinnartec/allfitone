import type { AuthenticatedIdentity, SessionTokens } from '@allfitone/auth-provider'

export type BackofficeAttemptState =
  'pending_enrollment' | 'pending_challenge' | 'completed' | 'failed' | 'expired'

export interface EligibleBackofficeAccount {
  accountId: string
  personId: string
  givenName: string
  familyName: string
  factorId?: string
  providerFactorId?: string
}

export interface BackofficeAttemptSecret {
  tokens: SessionTokens
  identity: AuthenticatedIdentity
  enrollment: { qrCode: string; manualKey: string } | null
}

export interface StoredBackofficeAttempt {
  attemptId: string
  accountId: string
  personId: string
  externalSubject: string
  givenName: string
  familyName: string
  factorId: string
  factorStatus: 'pending' | 'active' | 'revoked' | 'superseded'
  providerFactorId: string
  providerSessionId: string
  providerChallengeId: string
  secretCiphertext: string | null
  accessTokenExpiresAt: Date
  status: BackofficeAttemptState
  invalidCodeCount: number
  verificationIdempotencyKey: string | null
  verificationCommandId: string | null
  completedSessionId: string | null
  expiresAt: Date
}

export interface StoredBackofficeSession {
  sessionId: string
  accountId: string
  personId: string
  externalSubject: string
  providerSessionId: string
  tokenCiphertext: string
  accessTokenExpiresAt: Date
  tokenVersion: number
  givenName: string
  familyName: string
  assuranceLevel: 2
  authenticationMethod: 'password_totp'
  assuranceVerifiedAt: Date
  lastActivityAt: Date
  absoluteExpiresAt: Date
}

export interface BackofficeAuthenticationDatabase {
  resolveEligibleAccount(
    issuer: string,
    subject: string,
  ): Promise<EligibleBackofficeAccount | undefined>
  startAttempt(input: {
    accountId: string
    providerFactorId: string
    newFactor: boolean
    providerSessionId: string
    providerChallengeId: string
    attemptTokenHash: Uint8Array
    secretCiphertext: string
    accessTokenExpiresAt: Date
    status: Extract<BackofficeAttemptState, 'pending_enrollment' | 'pending_challenge'>
    expiresAt: Date
  }): Promise<void>
  loadAttempt(attemptTokenHash: Uint8Array): Promise<StoredBackofficeAttempt | undefined>
  recordTotpFailure(
    attemptTokenHash: Uint8Array,
  ): Promise<{ remainingAttempts: number; terminal: boolean }>
  bindTotpVerification(input: {
    attemptTokenHash: Uint8Array
    idempotencyKey: string
    commandId: string
  }): Promise<void>
  completeAuthentication(input: {
    attemptTokenHash: Uint8Array
    idempotencyKey: string
    commandId: string
    sessionTokenHash: Uint8Array
    sessionTokenCiphertext: string
    accessTokenExpiresAt: Date
  }): Promise<{ sessionId: string; replayed: boolean }>
  loadSession(sessionTokenHash: Uint8Array): Promise<StoredBackofficeSession | undefined>
  rotateSession(input: {
    sessionId: string
    expectedTokenVersion: number
    tokenCiphertext: string
    accessTokenExpiresAt: Date
  }): Promise<boolean>
  logout(sessionTokenHash: Uint8Array): Promise<{
    outcome: 'already-absent' | 'revoked'
    providerSessionId: string | null
  }>
}
