/** Identity persistence and token encryption. */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import type { SessionTokens } from '@allfitone/auth-provider'
import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type {
  BiologicalSex,
  FocusArea,
  IdentitySessionDatabase,
  IdentityWebhookDatabase,
  IdentityOnboardingDatabase,
  IdentityProfessionalDatabase,
  IdentityInvitationDatabase,
  BackofficeAuthenticationDatabase,
  BackofficeAttemptSecret,
  OnboardingAnswers,
  OnboardingAttempt,
  PrimaryTrainingGoal,
  ProfessionalCredential,
  ProfessionalProfile,
  StudioProfessionalContext,
  SessionCipherContext,
  SessionTokenVault,
  StoredAccessSession,
  StoredSessionSecret,
  TeamInvitationIntentStatus,
  TeamInvitationStatus,
} from '../domain/index.js'

/**
 * The `answers` object exactly as PostgreSQL builds it. Snake case because it is
 * the wire shape, not the domain one, and only the identity entry needs mapping:
 * the other two already match.
 */
type RawOnboardingAnswers = {
  identity: {
    answered: boolean
    value: { given_name: string; family_name: string; username: string } | null
  }
  biological_sex: { answered: boolean; value: BiologicalSex | null }
  primary_training_goal: { answered: boolean; value: PrimaryTrainingGoal | null }
  focus_areas: { answered: boolean; value: FocusArea[] }
}

/** No open attempt still answers the question: nothing has been answered. */
function emptyAnswers(): OnboardingAnswers {
  return {
    identity: { answered: false, value: null },
    biologicalSex: { answered: false, value: null },
    primaryTrainingGoal: { answered: false, value: null },
    focusAreas: { answered: false, value: [] },
  }
}

type InvitationRow = {
  invitation_id: string
  invitation_intent_id: string
  status: 'pending'
  channel: 'email'
  contact_hint: string
  expires_at: Date
  proposed_role_code: 'admin' | 'coach' | 'staff'
  reused: boolean
  replayed: boolean
}

type InvitationPresentationRow = {
  invitation_id: string
  status: 'pending'
  organization_id: string
  organization_display_name: string
  responsible_party: {
    party_kind: 'natural_person' | 'legal_entity'
    party_name: string
    purpose: 'studio_operations'
  }
  expires_at: Date
  invitation_intent_id: string
  proposed_role_code: 'admin' | 'coach' | 'staff'
}

type InvitationDecisionRow = {
  invitation_id: string
  invitation_status: 'completed'
  organization_id: string
  invitation_intent_id: string
  intent_status: 'accepted' | 'rejected'
  membership_id: string | null
  proposed_role_code: 'admin' | 'coach' | 'staff'
  replayed: boolean
}

type InvitationListRow = {
  invitation_id: string
  status: TeamInvitationStatus
  channel: 'email'
  contact: string
  created_at: Date
  expires_at: Date
  invitation_intent_id: string
  intent_status: TeamInvitationIntentStatus
  proposed_role_code: 'admin' | 'coach' | 'staff'
  decided_at: Date | null
}

type AccountRow = { account_id: string; person_id: string | null }
type SessionRow = {
  session_id: string
  account_id: string
  person_id: string | null
  external_subject: string
  provider_session_id: string
  token_ciphertext: string
  access_token_expires_at: Date
  token_version: number
  person_status: 'active' | 'closed' | null
}

type BackofficeAttemptRow = {
  attempt_id: string
  account_id: string
  person_id: string
  external_subject: string
  given_name: string
  family_name: string
  factor_id: string
  factor_status: 'pending' | 'active' | 'revoked' | 'superseded'
  provider_factor_id: string
  provider_session_id: string
  provider_challenge_id: string
  secret_ciphertext: string | null
  access_token_expires_at: Date
  attempt_status: 'pending_enrollment' | 'pending_challenge' | 'completed' | 'failed' | 'expired'
  invalid_code_count: number
  verification_idempotency_key: string | null
  verification_command_id: string | null
  completed_session_id: string | null
  expires_at: Date
}

type BackofficeSessionRow = {
  session_id: string
  account_id: string
  person_id: string
  external_subject: string
  provider_session_id: string
  token_ciphertext: string
  access_token_expires_at: Date
  token_version: number
  given_name: string
  family_name: string
  assurance_level: 2
  authentication_method: 'password_totp'
  assurance_verified_at: Date
  last_activity_at: Date
  absolute_expires_at: Date
}

type RawProfessionalCredential = {
  id: string
  credential_type_code: string
  credential_type_name: string
  issuer: string
  name: string
  identifier: string | null
  issued_on: string | null
  expires_on: string | null
  verification_url: string | null
  status: 'active' | 'retired'
  supersedes_credential_id: string | null
  created_at: string
  retired_at: string | null
  verification: {
    state: ProfessionalCredential['verification']['state']
    valid_from: string | null
    valid_to: string | null
    effective: boolean
  }
}

type RawProfessionalProfile = {
  id: string
  headline: string
  bio: string
  practice_started_year: number
  experience_years: number
  specialties: Array<{ code: string; name: string; description: string | null }>
  credentials: RawProfessionalCredential[]
  created_at: string
  updated_at: string
}

type RawStudioProfessionalContext = {
  profile: RawProfessionalProfile | null
  memberships: Array<{
    membership_id: string
    organization_id: string
    display_name: string
    type_code: 'professional_practice' | 'gym' | 'studio'
    status: 'active' | 'terminated'
    joined_at: string
    ended_at: string | null
    roles: Array<'owner' | 'admin' | 'coach' | 'staff'>
  }>
}

export function createIdentityOnboardingDatabase(): IdentityOnboardingDatabase {
  const sql = database()

  return {
    async startAttempt(input) {
      return sql.begin(async (transaction) => {
        await setAccountActor(transaction, input.accountId)
        const [row] = await transaction<
          {
            attempt_id: string
            status: 'open' | 'activated' | 'expired' | 'ineligible'
            eligibility_status: 'pending' | 'pass' | 'fail'
            expires_at: Date
          }[]
        >`
          select * from identity.start_onboarding_attempt(
            ${input.accountId}::uuid,
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not resolve an onboarding attempt')
        if (input.invitationTokenHash) {
          await transaction`
            select identity.associate_onboarding_invitation(
              ${input.accountId}::uuid,
              ${row.attempt_id}::uuid,
              ${input.invitationTokenHash}
            )
          `
        }
        return {
          id: row.attempt_id,
          status: row.status,
          eligibilityStatus: row.eligibility_status,
          expiresAt: new Date(row.expires_at),
        }
      })
    },

    async recordAdultEligibility(input) {
      return sql.begin(async (transaction) => {
        await setAccountActor(transaction, input.accountId)
        const [row] = await transaction<
          {
            result: 'pass' | 'fail'
            evaluated_at: Date
          }[]
        >`
          select * from identity.record_adult_eligibility(
            ${input.accountId}::uuid,
            ${input.attemptId}::uuid,
            ${input.declaredAdult},
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not record eligibility evidence')
        return { result: row.result, evaluatedAt: new Date(row.evaluated_at) }
      })
    },

    async createPendingPerson(input) {
      return sql.begin(async (transaction) => {
        await setAccountActor(transaction, input.accountId)
        // Creates the Fitness ID, or corrects it when the account already owns one.
        // A handle somebody else holds surfaces as 23505 and the handler maps it to
        // conflict, the same way its siblings do. Nothing is translated here.
        const [row] = await transaction<
          { given_name: string; family_name: string; username: string }[]
        >`
          select given_name, family_name, username
          from identity.declare_fitness_id(
            ${input.accountId}::uuid,
            ${input.attemptId}::uuid,
            ${input.givenName},
            ${input.familyName},
            ${input.username},
            ${input.contactEmail},
            ${input.contactEmailVerified},
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not create the pending Fitness ID')
        return {
          givenName: row.given_name,
          familyName: row.family_name,
          username: row.username,
        }
      })
    },

    async declareBiologicalSex(input) {
      return sql.begin(async (transaction) => {
        await setAccountActor(transaction, input.accountId)
        // A second, different declaration raises 23505 and the handler maps it to
        // conflict. Nothing is translated here.
        const [row] = await transaction<{ biological_sex: BiologicalSex | null }[]>`
          select biological_sex
          from identity.declare_biological_sex(
            ${input.accountId}::uuid,
            ${input.attemptId}::uuid,
            ${input.biologicalSex},
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not record the biological sex')
        return row.biological_sex
      })
    },

    async declareProfileClaim(input) {
      return sql.begin(async (transaction) => {
        await setAccountActor(transaction, input.accountId)
        // An unknown attribute or a value outside the catalogue raises 23514 and
        // the handler maps it to invalid-request. Nothing is validated twice here.
        const [row] = await transaction<
          {
            attribute_code: 'primary_training_goal'
            value_text: PrimaryTrainingGoal
            superseded_claim_id: string | null
          }[]
        >`
          select attribute_code, value_text, superseded_claim_id
          from identity.declare_profile_claim(
            ${input.accountId}::uuid,
            ${input.attributeCode},
            ${input.valueText},
            null,
            null,
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not record the profile claim')
        return {
          attributeCode: row.attribute_code,
          valueText: row.value_text,
          supersededClaimId: row.superseded_claim_id,
        }
      })
    },

    async declareFocusAreas(input) {
      return sql.begin(async (transaction) => {
        await setAccountActor(transaction, input.accountId)
        // The array is the shape of the command, not of the storage: one row per
        // zone, so several stay in force at once. The function answers the set it
        // left behind, which on a replay is simply the set in force.
        const [row] = await transaction<{ areas: FocusArea[] }[]>`
          select areas
          from identity.declare_focus_areas(
            ${input.accountId}::uuid,
            ${input.areas as FocusArea[]}::text[],
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not record the focus areas')
        return row.areas
      })
    },

    async readCurrentAttempt(accountId) {
      return sql.begin(async (transaction) => {
        await setAccountActor(transaction, accountId)
        // A governed read, not a join: during the onboarding the actor is an
        // account, and `people` is only visible to a person actor.
        const [row] = await transaction<
          {
            attempt_id: string
            status: OnboardingAttempt['status']
            eligibility_status: OnboardingAttempt['eligibilityStatus']
            expires_at: Date
            answers: RawOnboardingAnswers
          }[]
        >`select * from identity.read_current_onboarding(${accountId}::uuid)`

        // No open attempt is an answer, not a failure: it is also what an
        // already activated person sees.
        if (!row) return { attempt: null, answers: emptyAnswers() }
        return {
          attempt: {
            id: row.attempt_id,
            status: row.status,
            eligibilityStatus: row.eligibility_status,
            expiresAt: new Date(row.expires_at),
          },
          answers: {
            identity: {
              answered: row.answers.identity.answered,
              value: row.answers.identity.value
                ? {
                    givenName: row.answers.identity.value.given_name,
                    familyName: row.answers.identity.value.family_name,
                    username: row.answers.identity.value.username,
                  }
                : null,
            },
            biologicalSex: row.answers.biological_sex,
            primaryTrainingGoal: row.answers.primary_training_goal,
            focusAreas: row.answers.focus_areas,
          },
        }
      })
    },

    async activatePerson(input) {
      return sql.begin(async (transaction) => {
        await setAccountActor(transaction, input.accountId)
        const [row] = await transaction<{ person_id: string }[]>`
          select identity.activate_person(
            ${input.accountId}::uuid,
            ${input.attemptId}::uuid,
            ${input.givenName},
            ${input.familyName},
            ${input.termsAccepted},
            ${input.privacyNoticeAccepted},
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          ) as person_id
        `
        if (!row) throw new Error('PostgreSQL did not activate the person')
        return row.person_id
      })
    },
  }
}

export function createIdentityProfessionalDatabase(): IdentityProfessionalDatabase {
  const sql = database()

  return {
    async getMe(personId, requestId) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, personId, requestId)
        const [row] = await transaction<{ context: RawStudioProfessionalContext }[]>`
          select identity.get_my_professional_context(
            ${personId}::uuid,
            ${requestId}::uuid
          ) as context
        `
        if (!row) throw new Error('PostgreSQL did not return the professional context')
        return professionalContext(row.context)
      })
    },

    async putProfile(input) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId, input.commandId)
        const [row] = await transaction<{ profile: RawProfessionalProfile; replayed: boolean }[]>`
          select * from identity.put_professional_profile(
            ${input.personId}::uuid,
            ${input.headline},
            ${input.bio},
            ${input.practiceStartedYear}::integer,
            ${input.specialtyCodes}::text[],
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not resolve the professional profile')
        return { resource: professionalProfile(row.profile), replayed: row.replayed }
      })
    },

    async declareCredential(input) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId, input.commandId)
        const [row] = await transaction<
          { credential: RawProfessionalCredential; replayed: boolean }[]
        >`
          select * from identity.declare_professional_credential(
            ${input.personId}::uuid,
            ${input.credentialTypeCode},
            ${input.issuer},
            ${input.name},
            ${input.identifier}::text,
            ${input.issuedOn}::date,
            ${input.expiresOn}::date,
            ${input.verificationUrl}::text,
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not declare the professional credential')
        return { resource: professionalCredential(row.credential), replayed: row.replayed }
      })
    },

    async reviseCredential(input) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId, input.commandId)
        const [row] = await transaction<
          { credential: RawProfessionalCredential; replayed: boolean }[]
        >`
          select * from identity.revise_professional_credential(
            ${input.personId}::uuid,
            ${input.credentialId}::uuid,
            ${input.credentialTypeCode},
            ${input.issuer},
            ${input.name},
            ${input.identifier}::text,
            ${input.issuedOn}::date,
            ${input.expiresOn}::date,
            ${input.verificationUrl}::text,
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not revise the professional credential')
        return { resource: professionalCredential(row.credential), replayed: row.replayed }
      })
    },

    async retireCredential(input) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId, input.commandId)
        const [row] = await transaction<
          { credential: RawProfessionalCredential; replayed: boolean }[]
        >`
          select * from identity.retire_professional_credential(
            ${input.personId}::uuid,
            ${input.credentialId}::uuid,
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not retire the professional credential')
        return { resource: professionalCredential(row.credential), replayed: row.replayed }
      })
    },
  }
}

async function setAccountActor(
  transaction: postgres.TransactionSql,
  accountId: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'account', true),
           set_config('app.actor_account_id', ${accountId}, true)
  `
}

async function setPersonActor(
  transaction: postgres.TransactionSql,
  personId: string,
  requestId: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'person', true),
           set_config('app.actor_person_id', ${personId}, true),
           set_config('app.request_id', ${requestId}, true)
  `
}

export function createIdentitySessionDatabase(): IdentitySessionDatabase {
  const sql = database()

  return {
    async resolveOrCreateAccount(issuer, subject) {
      const [row] = await sql<AccountRow[]>`
        select account_id, person_id
        from identity.resolve_or_create_access_account('workos', ${issuer}, ${subject})
      `
      if (!row) throw new Error('PostgreSQL did not resolve the access account')
      return { accountId: row.account_id, ...(row.person_id ? { personId: row.person_id } : {}) }
    },

    async createSession(input) {
      const [row] = await sql<{ session_id: string }[]>`
        select identity.create_access_session(
          ${input.accountId}::uuid,
          ${input.providerSessionId},
          'studio'::identity.access_session_surface,
          ${input.tokenHash},
          ${input.tokenCiphertext},
          ${input.accessTokenExpiresAt}
        ) as session_id
      `
      if (!row) throw new Error('PostgreSQL did not create the access session')
      return row.session_id
    },

    async loadSession(tokenHash) {
      return measureStudioRequestPhase('session-db', async () => {
        const [row] = await sql<SessionRow[]>`
          select *
          from identity.load_access_session(${tokenHash}, 'studio'::identity.access_session_surface)
        `
        return row ? storedSession(row) : undefined
      })
    },

    async rotateSession(input) {
      return measureStudioRequestPhase('session-db', async () => {
        const [row] = await sql<{ rotated: boolean }[]>`
          select identity.rotate_access_session(
            ${input.sessionId}::uuid,
            ${input.expectedTokenVersion},
            ${input.tokenCiphertext},
            ${input.accessTokenExpiresAt}
          ) as rotated
        `
        return row?.rotated ?? false
      })
    },

    async revokeSession(sessionId) {
      return measureStudioRequestPhase('session-db', async () => {
        const [row] = await sql<{ revoked: boolean }[]>`
          select identity.revoke_access_session(${sessionId}::uuid) as revoked
        `
        return row?.revoked ?? false
      })
    },

    async resolveRegistration(accountId) {
      return measureStudioRequestPhase('actor-db', async () => {
        const [row] = await sql<
          Array<{ person_id: string | null; person_status: 'active' | 'closed' | null }>
        >`
          select * from identity.resolve_actor_registration(${accountId}::uuid)
        `
        if (!row) return undefined
        return {
          ...(row.person_id ? { personId: row.person_id } : {}),
          ...(row.person_status ? { personStatus: row.person_status } : {}),
        }
      })
    },
  }
}

export function createBackofficeAuthenticationDatabase(): BackofficeAuthenticationDatabase {
  const sql = database()

  return {
    async resolveEligibleAccount(issuer, subject) {
      const [row] = await sql<
        Array<{
          account_id: string
          person_id: string
          given_name: string
          family_name: string
          factor_id: string | null
          provider_factor_id: string | null
        }>
      >`select * from identity.resolve_backoffice_account('workos', ${issuer}, ${subject})`
      if (!row) return undefined
      return {
        accountId: row.account_id,
        personId: row.person_id,
        givenName: row.given_name,
        familyName: row.family_name,
        ...(row.factor_id && row.provider_factor_id
          ? { factorId: row.factor_id, providerFactorId: row.provider_factor_id }
          : {}),
      }
    },

    async startAttempt(input) {
      await sql`
        select * from identity.start_backoffice_authentication_attempt(
          ${input.accountId}::uuid,
          ${input.providerFactorId},
          ${input.newFactor},
          ${input.providerSessionId},
          ${input.providerChallengeId},
          ${input.attemptTokenHash},
          ${input.secretCiphertext},
          ${input.accessTokenExpiresAt}::timestamptz,
          ${input.status}::identity.backoffice_authentication_attempt_status,
          ${input.expiresAt}::timestamptz
        )
      `
    },

    async loadAttempt(attemptTokenHash) {
      const [row] = await sql<BackofficeAttemptRow[]>`
        select * from identity.load_backoffice_authentication_attempt(${attemptTokenHash})
      `
      if (!row) return undefined
      return {
        attemptId: row.attempt_id,
        accountId: row.account_id,
        personId: row.person_id,
        externalSubject: row.external_subject,
        givenName: row.given_name,
        familyName: row.family_name,
        factorId: row.factor_id,
        factorStatus: row.factor_status,
        providerFactorId: row.provider_factor_id,
        providerSessionId: row.provider_session_id,
        providerChallengeId: row.provider_challenge_id,
        secretCiphertext: row.secret_ciphertext,
        accessTokenExpiresAt: new Date(row.access_token_expires_at),
        status: row.attempt_status,
        invalidCodeCount: row.invalid_code_count,
        verificationIdempotencyKey: row.verification_idempotency_key,
        verificationCommandId: row.verification_command_id,
        completedSessionId: row.completed_session_id,
        expiresAt: new Date(row.expires_at),
      }
    },

    async recordTotpFailure(attemptTokenHash) {
      const [row] = await sql<Array<{ remaining_attempts: number; terminal: boolean }>>`
        select * from identity.record_backoffice_totp_failure(${attemptTokenHash})
      `
      if (!row) throw new Error('PostgreSQL did not record the TOTP failure')
      return { remainingAttempts: row.remaining_attempts, terminal: row.terminal }
    },

    async bindTotpVerification(input) {
      await sql`
        select identity.bind_backoffice_totp_verification(
          ${input.attemptTokenHash},
          ${input.idempotencyKey}::uuid,
          ${input.commandId}::uuid
        )
      `
    },

    async completeAuthentication(input) {
      const [row] = await sql<Array<{ session_id: string; replayed: boolean }>>`
        select * from identity.complete_backoffice_authentication(
          ${input.attemptTokenHash},
          ${input.idempotencyKey}::uuid,
          ${input.commandId}::uuid,
          ${input.sessionTokenHash},
          ${input.sessionTokenCiphertext},
          ${input.accessTokenExpiresAt}::timestamptz
        )
      `
      if (!row) throw new Error('PostgreSQL did not complete Backoffice authentication')
      return { sessionId: row.session_id, replayed: row.replayed }
    },

    async loadSession(sessionTokenHash) {
      const [row] = await sql<BackofficeSessionRow[]>`
        select * from identity.load_backoffice_access_session(${sessionTokenHash})
      `
      if (!row) return undefined
      return {
        sessionId: row.session_id,
        accountId: row.account_id,
        personId: row.person_id,
        externalSubject: row.external_subject,
        providerSessionId: row.provider_session_id,
        tokenCiphertext: row.token_ciphertext,
        accessTokenExpiresAt: new Date(row.access_token_expires_at),
        tokenVersion: row.token_version,
        givenName: row.given_name,
        familyName: row.family_name,
        assuranceLevel: row.assurance_level,
        authenticationMethod: row.authentication_method,
        assuranceVerifiedAt: new Date(row.assurance_verified_at),
        lastActivityAt: new Date(row.last_activity_at),
        absoluteExpiresAt: new Date(row.absolute_expires_at),
      }
    },

    async rotateSession(input) {
      const [row] = await sql<Array<{ rotated: boolean }>>`
        select identity.rotate_access_session(
          ${input.sessionId}::uuid,
          ${input.expectedTokenVersion},
          ${input.tokenCiphertext},
          ${input.accessTokenExpiresAt}::timestamptz
        ) as rotated
      `
      return row?.rotated ?? false
    },

    async logout(sessionTokenHash) {
      const [row] = await sql<
        Array<{ outcome: 'already-absent' | 'revoked'; provider_session_id: string | null }>
      >`select * from identity.logout_backoffice_access_session(${sessionTokenHash})`
      if (!row) throw new Error('PostgreSQL did not close the Backoffice session')
      return { outcome: row.outcome, providerSessionId: row.provider_session_id }
    },
  }
}

export function createIdentityWebhookDatabase(): IdentityWebhookDatabase {
  const sql = database()

  return {
    async processPasswordResetSucceeded(input) {
      const [row] = await sql<
        {
          outcome: 'account_absent' | 'processed'
          revoked_session_count: number
          replayed: boolean
        }[]
      >`
        select *
        from identity.process_password_reset_succeeded(
          ${input.provider},
          ${input.issuer},
          ${input.eventId},
          ${input.subject},
          ${input.occurredAt}::timestamptz
        )
      `
      if (!row) throw new Error('PostgreSQL did not process the password reset')
      return {
        outcome: row.outcome === 'account_absent' ? 'account-absent' : 'processed',
        revokedSessionCount: row.revoked_session_count,
        replayed: row.replayed,
      }
    },
  }
}

export function createIdentityInvitationDatabase(): IdentityInvitationDatabase {
  const sql = database()

  return {
    async issue(input) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId, input.commandId)
        await transaction`
          select identity.consume_staff_invitation_rate_limit(
            ${input.personId}::uuid,
            ${input.organizationId}::uuid,
            ${input.contact}
          )
        `
        const [row] = await transaction<InvitationRow[]>`
          select *
          from identity.issue_staff_invitation(
            ${input.personId}::uuid,
            ${input.organizationId}::uuid,
            ${input.channel},
            ${input.contact},
            ${input.proposedRoleCode},
            ${input.tokenHash},
            ${input.tokenKeyVersion}::smallint,
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not issue the team invitation')
        return {
          resource: {
            id: row.invitation_id,
            intentId: row.invitation_intent_id,
            status: row.status,
            channel: row.channel,
            contactHint: row.contact_hint,
            expiresAt: new Date(row.expires_at),
            proposedRoleCode: row.proposed_role_code,
            reused: row.reused,
          },
          replayed: row.replayed,
        }
      })
    },
    async resolve(tokenHash) {
      return sql.begin(async (transaction) => {
        await transaction`select set_config('app.actor_kind', 'anonymous', true)`
        const [row] = await transaction<InvitationPresentationRow[]>`
          select * from identity.resolve_staff_invitation(${tokenHash})
        `
        if (!row) return undefined
        return {
          id: row.invitation_id,
          status: row.status,
          organizationId: row.organization_id,
          organizationDisplayName: row.organization_display_name,
          responsibleParty: row.responsible_party,
          expiresAt: new Date(row.expires_at),
          intent: {
            id: row.invitation_intent_id,
            kind: 'membership',
            status: 'pending',
            proposedRoleCode: row.proposed_role_code,
          },
        }
      })
    },
    async decide(input) {
      return sql.begin(async (transaction) => {
        await setPersonActorWithVerifiedEmail(
          transaction,
          input.personId,
          input.commandId,
          input.verifiedEmail,
        )
        const [row] = await transaction<InvitationDecisionRow[]>`
          select * from identity.decide_staff_invitation(
            ${input.personId}::uuid,
            ${input.tokenHash},
            ${input.intentId}::uuid,
            ${input.decision},
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not decide the team invitation')
        return {
          resource: {
            invitationId: row.invitation_id,
            invitationStatus: row.invitation_status,
            organizationId: row.organization_id,
            intentId: row.invitation_intent_id,
            intentStatus: row.intent_status,
            membershipId: row.membership_id,
            proposedRoleCode: row.proposed_role_code,
          },
          replayed: row.replayed,
        }
      })
    },
    async list(input) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId, input.requestId)
        const rows = await transaction<InvitationListRow[]>`
          select * from identity.list_staff_invitations(
            ${input.personId}::uuid,
            ${input.organizationId}::uuid,
            ${input.status ?? null}::text,
            ${input.limit + 1}::integer,
            ${input.cursorCreatedAt ?? null}::timestamptz,
            ${input.cursorId ?? null}::uuid
          )
        `
        const hasMore = rows.length > input.limit
        return {
          hasMore,
          items: rows.slice(0, input.limit).map((row) => ({
            id: row.invitation_id,
            status: row.status,
            channel: row.channel,
            contact: row.contact,
            createdAt: new Date(row.created_at),
            expiresAt: new Date(row.expires_at),
            intent: {
              id: row.invitation_intent_id,
              kind: 'membership',
              status: row.intent_status,
              proposedRoleCode: row.proposed_role_code,
              decidedAt: row.decided_at ? new Date(row.decided_at) : null,
            },
          })),
        }
      })
    },
    async revoke(input) {
      return sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId, input.commandId)
        const [row] = await transaction<
          Array<{ invitation_id: string; status: 'revoked'; replayed: boolean }>
        >`
          select * from identity.revoke_staff_invitation(
            ${input.personId}::uuid,
            ${input.organizationId}::uuid,
            ${input.invitationId}::uuid,
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not revoke the team invitation')
        return {
          resource: { id: row.invitation_id, status: row.status },
          replayed: row.replayed,
        }
      })
    },
  }
}

async function setPersonActorWithVerifiedEmail(
  transaction: postgres.TransactionSql,
  personId: string,
  requestId: string,
  verifiedEmail: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'person', true),
           set_config('app.actor_person_id', ${personId}, true),
           set_config('app.actor_verified_email', ${verifiedEmail.trim().toLowerCase()}, true),
           set_config('app.request_id', ${requestId}, true)
  `
}

export function createSessionTokenVaultFromEnv(): SessionTokenVault {
  const encodedKey = process.env.SESSION_ENCRYPTION_KEY
  if (!encodedKey) throw new Error('SESSION_ENCRYPTION_KEY is not set')
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes')

  return {
    generateOpaqueToken: () => randomBytes(32).toString('base64url'),
    deriveOpaqueToken: (token, purpose) =>
      createHmac('sha256', key).update(`${purpose}\u0000${token}`, 'utf8').digest('base64url'),
    hashOpaqueToken: (token) => createHash('sha256').update(token).digest(),
    seal: (secret, context) => sealPayload(secret, context, key),
    open: (ciphertext, context) => sessionSecret(openPayload(ciphertext, context, key)),
    sealBackofficeAttempt: (secret, context) => sealPayload(secret, context, key),
    openBackofficeAttempt: (ciphertext, context) =>
      backofficeAttemptSecret(openPayload(ciphertext, context, key)),
  }
}

function sealPayload(value: unknown, context: SessionCipherContext, key: Buffer): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad(context))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return `v1.${nonce.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
}

function openPayload(ciphertext: string, context: SessionCipherContext, key: Buffer): unknown {
  const [version, nonceValue, encryptedValue, tagValue] = ciphertext.split('.')
  if (version !== 'v1' || !nonceValue || !encryptedValue || !tagValue) {
    throw new Error('Unsupported session ciphertext')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceValue, 'base64url'))
  decipher.setAAD(aad(context))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(plaintext) as unknown
}

function aad(context: SessionCipherContext): Buffer {
  return Buffer.from(
    `${context.accountId}\u0000${context.surface}\u0000${context.providerSessionId}`,
    'utf8',
  )
}

function sessionTokens(value: unknown): SessionTokens {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid session token payload')
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.accessToken !== 'string' ||
    typeof candidate.refreshToken !== 'string' ||
    typeof candidate.expiresIn !== 'number'
  ) {
    throw new Error('Invalid session token payload')
  }
  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresIn: candidate.expiresIn,
  }
}

function sessionSecret(value: unknown): StoredSessionSecret {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid session secret payload')
  const candidate = value as Record<string, unknown>

  // Sessions issued before identity prefill stored the tokens as the root payload.
  if (!('tokens' in candidate)) {
    return {
      tokens: sessionTokens(value),
      identity: { givenName: null, familyName: null, verifiedEmail: null },
    }
  }

  const identity = candidate.identity
  if (typeof identity !== 'object' || identity === null) {
    throw new Error('Invalid session identity payload')
  }
  const names = identity as Record<string, unknown>
  return {
    tokens: sessionTokens(candidate.tokens),
    identity: {
      givenName: sessionIdentityName(names.givenName),
      familyName: sessionIdentityName(names.familyName),
      verifiedEmail: sessionVerifiedEmail(names.verifiedEmail),
    },
  }
}

function backofficeAttemptSecret(value: unknown): BackofficeAttemptSecret {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid Backoffice attempt secret payload')
  }
  const candidate = value as Record<string, unknown>
  const parsed = sessionSecret({ tokens: candidate.tokens, identity: candidate.identity })
  const enrollment = candidate.enrollment
  if (enrollment === null) return { ...parsed, enrollment: null }
  if (typeof enrollment !== 'object') throw new Error('Invalid TOTP enrollment payload')
  const fields = enrollment as Record<string, unknown>
  if (typeof fields.qrCode !== 'string' || typeof fields.manualKey !== 'string') {
    throw new Error('Invalid TOTP enrollment payload')
  }
  return {
    ...parsed,
    enrollment: { qrCode: fields.qrCode, manualKey: fields.manualKey },
  }
}

function sessionIdentityName(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  throw new Error('Invalid session identity payload')
}

function sessionVerifiedEmail(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value)) {
    return value.trim().toLowerCase()
  }
  throw new Error('Invalid verified session email payload')
}

function storedSession(row: SessionRow): StoredAccessSession {
  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    ...(row.person_id ? { personId: row.person_id } : {}),
    externalSubject: row.external_subject,
    providerSessionId: row.provider_session_id,
    tokenCiphertext: row.token_ciphertext,
    accessTokenExpiresAt: new Date(row.access_token_expires_at),
    tokenVersion: row.token_version,
    ...(row.person_status ? { personStatus: row.person_status } : {}),
  }
}

function professionalContext(raw: RawStudioProfessionalContext): StudioProfessionalContext {
  return {
    profile: raw.profile ? professionalProfile(raw.profile) : null,
    memberships: raw.memberships.map((membership) => ({
      membershipId: membership.membership_id,
      organizationId: membership.organization_id,
      displayName: membership.display_name,
      typeCode: membership.type_code,
      status: membership.status,
      joinedAt: new Date(membership.joined_at),
      endedAt: membership.ended_at ? new Date(membership.ended_at) : null,
      roles: membership.roles,
    })),
  }
}

function professionalProfile(raw: RawProfessionalProfile): ProfessionalProfile {
  return {
    id: raw.id,
    headline: raw.headline,
    bio: raw.bio,
    practiceStartedYear: raw.practice_started_year,
    experienceYears: raw.experience_years,
    specialties: raw.specialties,
    credentials: raw.credentials.map(professionalCredential),
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  }
}

function professionalCredential(raw: RawProfessionalCredential): ProfessionalCredential {
  return {
    id: raw.id,
    credentialTypeCode: raw.credential_type_code,
    credentialTypeName: raw.credential_type_name,
    issuer: raw.issuer,
    name: raw.name,
    identifier: raw.identifier,
    issuedOn: raw.issued_on,
    expiresOn: raw.expires_on,
    verificationUrl: raw.verification_url,
    status: raw.status,
    supersedesCredentialId: raw.supersedes_credential_id,
    createdAt: new Date(raw.created_at),
    retiredAt: raw.retired_at ? new Date(raw.retired_at) : null,
    verification: {
      state: raw.verification.state,
      validFrom: raw.verification.valid_from ? new Date(raw.verification.valid_from) : null,
      validTo: raw.verification.valid_to ? new Date(raw.verification.valid_to) : null,
      effective: raw.verification.effective,
    },
  }
}
