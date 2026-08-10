import type { AuthenticatedIdentity, SessionTokens } from '@allfitone/auth-provider'

export type RegistrationStatus = 'complete' | 'registration_incomplete'

export interface AccessAccount {
  accountId: string
  personId?: string
}

export interface StoredAccessSession {
  sessionId: string
  accountId: string
  personId?: string
  externalSubject: string
  providerSessionId: string
  tokenCiphertext: string
  accessTokenExpiresAt: Date
  tokenVersion: number
  personStatus?: 'active' | 'closed'
}

export interface ActorRegistration {
  personId?: string
  personStatus?: 'active' | 'closed'
}

export interface StudioActor {
  accountId: string
  personId?: string
}

export interface StudioAccountIdentity {
  actor: StudioActor
  identity: AuthenticatedIdentity
}

export interface OnboardingAttempt {
  id: string
  status: 'open' | 'activated' | 'expired' | 'ineligible'
  eligibilityStatus: 'pending' | 'pass' | 'fail'
  expiresAt: Date
}

export interface AdultEligibilityEvidence {
  result: 'pass' | 'fail'
  evaluatedAt: Date
}

export interface IdentityOnboardingDatabase {
  startAttempt(input: CommandContext & { accountId: string }): Promise<OnboardingAttempt>
  recordAdultEligibility(
    input: CommandContext & { accountId: string; attemptId: string; declaredAdult: boolean },
  ): Promise<AdultEligibilityEvidence>
  activatePerson(
    input: CommandContext & {
      accountId: string
      attemptId: string
      givenName: string
      familyName: string
      termsAccepted: boolean
      privacyNoticeAccepted: boolean
    },
  ): Promise<string>
}

export interface CommandContext {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

export interface IdentitySessionDatabase {
  resolveOrCreateAccount(issuer: string, subject: string): Promise<AccessAccount>
  createSession(input: {
    accountId: string
    providerSessionId: string
    tokenHash: Uint8Array
    tokenCiphertext: string
    accessTokenExpiresAt: Date
  }): Promise<string>
  loadSession(tokenHash: Uint8Array): Promise<StoredAccessSession | undefined>
  rotateSession(input: {
    sessionId: string
    expectedTokenVersion: number
    tokenCiphertext: string
    accessTokenExpiresAt: Date
  }): Promise<boolean>
  revokeSession(sessionId: string): Promise<boolean>
  resolveRegistration(accountId: string): Promise<ActorRegistration>
}

export interface SessionTokenVault {
  generateOpaqueToken(): string
  hashOpaqueToken(token: string): Uint8Array
  seal(secret: StoredSessionSecret, context: SessionCipherContext): string
  open(ciphertext: string, context: SessionCipherContext): StoredSessionSecret
}

export interface StoredSessionSecret {
  tokens: SessionTokens
  identity: AuthenticatedIdentity
}

export interface SessionCipherContext {
  accountId: string
  providerSessionId: string
  surface: 'studio'
}
