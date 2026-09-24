import type { AuthenticatedIdentity, SessionTokens } from '@allfitone/auth-provider'
import type { AnalyticsIdentity } from '@allfitone/telemetry/node'

export type {
  BackofficeActor,
  BackofficeAttemptSecret,
  BackofficeAttemptState,
  BackofficeAuthenticationDatabase,
  EligibleBackofficeAccount,
  StoredBackofficeAttempt,
  StoredBackofficeSession,
} from './backoffice.js'
export { VERIFICATION_METHODS, VERIFICATION_RESULTS } from './credential-verification.js'
export type {
  CredentialRenewalDue,
  CredentialVerificationDatabase,
  CredentialVerificationDecisionCreate,
  CredentialVerificationMethod,
  CredentialVerificationOutcome,
  CredentialVerificationRequest,
  CredentialVerificationResult,
  CredentialVerifier,
  VerificationCommandContext,
  VerificationCommandResult,
  VerificationPage,
} from './credential-verification.js'

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
  personStatus?: 'pending_activation' | 'active' | 'closed'
}

export interface ActorRegistration {
  personId?: string
  personStatus?: 'pending_activation' | 'active' | 'closed'
}

/** The access account, and the person behind it once activated. Every surface. */
export interface AccountActor {
  accountId: string
  personId?: string
}

export interface StudioAccountIdentity {
  actor: AccountActor
  identity: AuthenticatedIdentity
  /** Optional only for injected test seams; production session resolution always sets it. */
  analytics?: AnalyticsIdentity
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

/**
 * The Fitness ID as it exists on the person while pending activation. Written
 * straight onto `identity.people`: nothing about it is staged anywhere.
 */
export interface PendingFitnessId {
  givenName: string
  familyName: string
  username: string
}

/** Only what the person can declare. Declining is the absence of a value. */
export type BiologicalSex = 'male' | 'female'

/**
 * The five goals offered in the initial V1 launch. `improve_performance` stays in
 * the database catalogue, deferred rather than deleted, and is refused here.
 */
export type PrimaryTrainingGoal =
  'lose_weight' | 'build_muscle' | 'get_fit' | 'run_a_race' | 'maintain'

/**
 * The three simple terms of HU-SP-012 criterion 2, least to most.
 *
 * Not `beginner`, `intermediate`, `advanced`. The story asks for simple terms and
 * the reason is behavioural: "advanced" makes people underrate themselves and pick
 * below their real level, and then the plan bores them. Rank is drawn by the screen,
 * not carried by the words.
 */
export type TrainingExperience = 'starting' | 'some_practice' | 'experienced'

/**
 * The discipline somebody trains, asked before the goal because the goal's list
 * depends on it.
 *
 * One value. The attribute catalogue holds all six the product will cover — its own
 * constraint refuses an enum with fewer than two — but what a person may answer today
 * is a launch decision, and this is where it belongs. `PrimaryTrainingGoal` is the
 * same shape of decision: six in the catalogue, five offered.
 */
export type TrainingDiscipline = 'strength'

/**
 * The two body metrics V1 records. The `body_` prefix is not decoration: `metric_code`
 * also names execution results, where `weight` is the load on the bar.
 */
export type BodyMetric = 'body_weight' | 'body_height'
export type MassUnit = 'kg' | 'lb'
export type LengthUnit = 'cm' | 'in'

/**
 * One measurement, and the unit is tied to the metric so a weight cannot arrive in
 * centimetres. The value is **what the person read**, not the canonical figure: the
 * conversion happens in the database, where the factor lives.
 */
export type BodyProgressDeclaration =
  | { metricCode: 'body_weight'; value: number; unit: MassUnit; measuredOn: string }
  | { metricCode: 'body_height'; value: number; unit: LengthUnit; measuredOn: string }

/** What the database recorded, in canonical units, plus what she actually read. */
export interface BodyProgressRecord {
  id: string
  metricCode: BodyMetric
  value: number
  unit: string
  /** Null when she was already using the canonical unit: nothing to preserve. */
  originalValue: number | null
  originalUnit: string | null
}

/** The latest of each metric. Either can be null on its own, mid-pair. */
export interface BodyMeasures {
  weight: { value: number; unit: string; originalUnit: string | null } | null
  height: { value: number; unit: string; originalUnit: string | null } | null
}

/**
 * The seven zones of HU-SP-097, plus `whole_body`, which is a member and not an
 * empty set: it says "no emphasis, my goal decides". Without it that answer and
 * never having answered would both be zero members.
 */
export type FocusArea =
  'chest' | 'back' | 'shoulders' | 'arms' | 'abs' | 'glutes' | 'legs' | 'whole_body'

/**
 * One entry per onboarding step, every one the same shape. `answered` is separate
 * from the value because a step can be answered without leaving one: declining the
 * sex records the refusal as an absence, and a value alone could not tell that
 * apart from never having been asked.
 */
export interface OnboardingAnswer<T> {
  answered: boolean
  value: T | null
}

export interface OnboardingAnswers {
  identity: OnboardingAnswer<PendingFitnessId>
  biologicalSex: OnboardingAnswer<BiologicalSex>
  primaryTrainingGoal: OnboardingAnswer<PrimaryTrainingGoal>
  trainingDiscipline: OnboardingAnswer<TrainingDiscipline>
  trainingExperience: OnboardingAnswer<TrainingExperience>
  /**
   * Answered when both were recorded **or** the step was skipped. A half-finished
   * pair leaves the step owed and still returns what it has, so the ruler reopens
   * where she left it — which is why this cannot be derived from presence alone.
   */
  bodyMeasures: { answered: boolean; value: BodyMeasures | null }
  /**
   * The one answer that is a set. Its value is never null — an unanswered step is
   * no members — so it does not use `OnboardingAnswer`, whose nullable value would
   * invent a third state this step does not have.
   */
  focusAreas: { answered: boolean; value: readonly FocusArea[] }
}

export interface CurrentOnboardingAttempt {
  attempt: OnboardingAttempt | null
  answers: OnboardingAnswers
}

/**
 * Which attribute is being declared, and with what. A union rather than two loose
 * strings so a goal code cannot be paired with an experience value: the database
 * would refuse it, and refusing it here means the mistake cannot be written at all.
 */
export type ProfileClaimDeclaration =
  | { attributeCode: 'primary_training_goal'; valueText: PrimaryTrainingGoal }
  | { attributeCode: 'training_experience'; valueText: TrainingExperience }
  | { attributeCode: 'training_discipline'; valueText: TrainingDiscipline }

/** What the database records for a claim, including what it displaced. */
export type ProfileClaim = ProfileClaimDeclaration & {
  /** The claim this one replaced, or null on a first declaration. */
  supersededClaimId: string | null
}

export interface IdentityOnboardingDatabase {
  startAttempt(
    input: CommandContext & { accountId: string; invitationTokenHash?: Uint8Array },
  ): Promise<OnboardingAttempt>
  recordAdultEligibility(
    input: CommandContext & { accountId: string; attemptId: string; declaredAdult: boolean },
  ): Promise<AdultEligibilityEvidence>
  createPendingPerson(
    input: CommandContext & {
      accountId: string
      attemptId: string
      givenName: string
      familyName: string
      username: string
      contactEmail: string
      contactEmailVerified: boolean
    },
  ): Promise<PendingFitnessId>
  declareBiologicalSex(
    input: CommandContext & {
      accountId: string
      attemptId: string
      /** Null declines: no value is recorded, only that the question was answered. */
      biologicalSex: BiologicalSex | null
    },
  ): Promise<BiologicalSex | null>
  declareProfileClaim(
    input: CommandContext & { accountId: string } & ProfileClaimDeclaration,
  ): Promise<ProfileClaim>
  declareFocusAreas(
    input: CommandContext & { accountId: string; areas: readonly FocusArea[] },
  ): Promise<readonly FocusArea[]>
  recordBodyProgress(
    input: CommandContext & { accountId: string } & BodyProgressDeclaration,
  ): Promise<BodyProgressRecord>
  /** No command context: the primary key of the skip is the whole idempotency. */
  skipOnboardingStep(input: {
    accountId: string
    attemptId: string
    stepCode: string
  }): Promise<void>
  readCurrentAttempt(accountId: string): Promise<CurrentOnboardingAttempt>
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
  resolveRegistration(accountId: string): Promise<ActorRegistration | undefined>
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

export type TeamInvitationRole = 'admin' | 'coach' | 'staff'

export interface TeamInvitation {
  id: string
  intentId: string
  status: 'pending'
  channel: 'email'
  contactHint: string
  expiresAt: Date
  proposedRoleCode: TeamInvitationRole
  reused: boolean
}

export type TeamInvitationStatus = 'pending' | 'completed' | 'revoked' | 'expired'
export type TeamInvitationIntentStatus = 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired'

export interface TeamInvitationPresentation {
  id: string
  status: 'pending'
  organizationId: string
  organizationDisplayName: string
  responsibleParty: {
    party_kind: 'natural_person' | 'legal_entity'
    party_name: string
    purpose: 'studio_operations'
  }
  expiresAt: Date
  intent: {
    id: string
    kind: 'membership'
    status: 'pending'
    proposedRoleCode: TeamInvitationRole
  }
}

export interface TeamInvitationDecisionResult {
  invitationId: string
  invitationStatus: 'completed'
  organizationId: string
  intentId: string
  intentStatus: 'accepted' | 'rejected'
  membershipId: string | null
  proposedRoleCode: TeamInvitationRole
}

export interface TeamInvitationListItem {
  id: string
  status: TeamInvitationStatus
  channel: 'email'
  contact: string
  createdAt: Date
  expiresAt: Date
  intent: {
    id: string
    kind: 'membership'
    status: TeamInvitationIntentStatus
    proposedRoleCode: TeamInvitationRole
    decidedAt: Date | null
  }
}

export interface TeamInvitationPage {
  items: TeamInvitationListItem[]
  hasMore: boolean
}

export interface IdentityInvitationDatabase {
  issue(
    input: CommandContext & {
      personId: string
      organizationId: string
      channel: 'email'
      contact: string
      proposedRoleCode: TeamInvitationRole
      tokenHash: Uint8Array
      tokenKeyVersion: number
    },
  ): Promise<CommandResult<TeamInvitation>>
  resolve(tokenHash: Uint8Array): Promise<TeamInvitationPresentation | undefined>
  decide(
    input: CommandContext & {
      personId: string
      verifiedEmail: string
      tokenHash: Uint8Array
      intentId: string
      decision: 'accepted' | 'rejected'
    },
  ): Promise<CommandResult<TeamInvitationDecisionResult>>
  list(input: {
    personId: string
    organizationId: string
    status?: TeamInvitationStatus
    limit: number
    cursorCreatedAt?: Date
    cursorId?: string
    requestId: string
  }): Promise<TeamInvitationPage>
  revoke(
    input: CommandContext & {
      personId: string
      organizationId: string
      invitationId: string
    },
  ): Promise<CommandResult<{ id: string; status: 'revoked' }>>
}

export interface SessionTokenVault {
  generateOpaqueToken(): string
  deriveOpaqueToken(token: string, purpose: 'backoffice-session'): string
  hashOpaqueToken(token: string): Uint8Array
  seal(secret: StoredSessionSecret, context: SessionCipherContext): string
  open(ciphertext: string, context: SessionCipherContext): StoredSessionSecret
  sealBackofficeAttempt(
    secret: import('./backoffice.js').BackofficeAttemptSecret,
    context: SessionCipherContext,
  ): string
  openBackofficeAttempt(
    ciphertext: string,
    context: SessionCipherContext,
  ): import('./backoffice.js').BackofficeAttemptSecret
}

export interface StoredSessionSecret {
  tokens: SessionTokens
  identity: AuthenticatedIdentity
}

export interface SessionCipherContext {
  accountId: string
  providerSessionId: string
  surface: 'studio' | 'backoffice'
}
