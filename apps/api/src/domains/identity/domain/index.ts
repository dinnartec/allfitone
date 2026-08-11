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

export interface ProfessionalCatalogItem {
  code: string
  name: string
  description: string | null
}

export type ProfessionalCredentialVerificationState =
  'unverified' | 'verified' | 'expired' | 'rejected' | 'unverifiable' | 'revoked'

export interface ProfessionalCredentialVerification {
  state: ProfessionalCredentialVerificationState
  validFrom: Date | null
  validTo: Date | null
  effective: boolean
}

export interface ProfessionalCredential {
  id: string
  credentialTypeCode: string
  credentialTypeName: string
  issuer: string
  name: string
  identifier: string | null
  issuedOn: string | null
  expiresOn: string | null
  verificationUrl: string | null
  status: 'active' | 'retired'
  supersedesCredentialId: string | null
  createdAt: Date
  retiredAt: Date | null
  verification: ProfessionalCredentialVerification
}

export interface ProfessionalProfile {
  id: string
  headline: string
  bio: string
  practiceStartedYear: number
  experienceYears: number
  specialties: ProfessionalCatalogItem[]
  credentials: ProfessionalCredential[]
  createdAt: Date
  updatedAt: Date
}

export interface ProfessionalMembershipSummary {
  membershipId: string
  organizationId: string
  displayName: string
  typeCode: 'professional_practice' | 'gym' | 'studio'
  status: 'active' | 'terminated'
  joinedAt: Date
  endedAt: Date | null
  roles: Array<'owner' | 'admin' | 'coach' | 'staff'>
}

export interface StudioProfessionalContext {
  profile: ProfessionalProfile | null
  memberships: ProfessionalMembershipSummary[]
}

export interface ProfessionalProfileInput {
  headline: string
  bio: string
  practiceStartedYear: number
  specialtyCodes: string[]
}

export interface ProfessionalCredentialInput {
  credentialTypeCode: string
  issuer: string
  name: string
  identifier: string | null
  issuedOn: string | null
  expiresOn: string | null
  verificationUrl: string | null
}

export interface CommandResult<T> {
  resource: T
  replayed: boolean
}

export interface IdentityProfessionalDatabase {
  getMe(personId: string, requestId: string): Promise<StudioProfessionalContext>
  putProfile(
    input: CommandContext & ProfessionalProfileInput & { personId: string },
  ): Promise<CommandResult<ProfessionalProfile>>
  declareCredential(
    input: CommandContext & ProfessionalCredentialInput & { personId: string },
  ): Promise<CommandResult<ProfessionalCredential>>
  reviseCredential(
    input: CommandContext &
      ProfessionalCredentialInput & { personId: string; credentialId: string },
  ): Promise<CommandResult<ProfessionalCredential>>
  retireCredential(
    input: CommandContext & { personId: string; credentialId: string },
  ): Promise<CommandResult<ProfessionalCredential>>
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

export type PasswordResetDatabaseOutcome = 'account-absent' | 'processed'

export interface PasswordResetProcessingResult {
  outcome: PasswordResetDatabaseOutcome
  revokedSessionCount: number
  replayed: boolean
}

export interface IdentityWebhookDatabase {
  processPasswordResetSucceeded(input: {
    provider: 'workos'
    issuer: string
    eventId: string
    subject: string
    occurredAt: string
  }): Promise<PasswordResetProcessingResult>
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
