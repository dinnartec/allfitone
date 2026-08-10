/** Identity persistence and token encryption. */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { SessionTokens } from '@allfitone/auth-provider'
import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import type {
  IdentitySessionDatabase,
  IdentityOnboardingDatabase,
  IdentityProfessionalDatabase,
  ProfessionalCredential,
  ProfessionalProfile,
  StudioProfessionalContext,
  SessionCipherContext,
  SessionTokenVault,
  StoredAccessSession,
  StoredSessionSecret,
} from '../domain/index.js'

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
      const [row] = await sql<SessionRow[]>`
        select *
        from identity.load_access_session(${tokenHash}, 'studio'::identity.access_session_surface)
      `
      return row ? storedSession(row) : undefined
    },

    async rotateSession(input) {
      const [row] = await sql<{ rotated: boolean }[]>`
        select identity.rotate_access_session(
          ${input.sessionId}::uuid,
          ${input.expectedTokenVersion},
          ${input.tokenCiphertext},
          ${input.accessTokenExpiresAt}
        ) as rotated
      `
      return row?.rotated ?? false
    },

    async revokeSession(sessionId) {
      const [row] = await sql<{ revoked: boolean }[]>`
        select identity.revoke_access_session(${sessionId}::uuid) as revoked
      `
      return row?.revoked ?? false
    },

    async resolveRegistration(accountId) {
      return sql.begin(async (transaction) => {
        await transaction`
          select set_config('app.actor_kind', 'account', true),
                 set_config('app.actor_account_id', ${accountId}, true)
        `
        const [account] = await transaction<{ person_id: string | null }[]>`
          select person_id from identity.access_accounts where id = ${accountId}::uuid
        `
        if (!account?.person_id) return {}

        await transaction`
          select set_config('app.actor_kind', 'person', true),
                 set_config('app.actor_person_id', ${account.person_id}, true)
        `
        const [person] = await transaction<{ status: 'active' | 'closed' }[]>`
          select status from identity.people where id = ${account.person_id}::uuid
        `
        return person
          ? { personId: account.person_id, personStatus: person.status }
          : { personId: account.person_id }
      })
    },
  }
}

export function createSessionTokenVaultFromEnv(): SessionTokenVault {
  const encodedKey = process.env.SESSION_ENCRYPTION_KEY
  if (!encodedKey) throw new Error('SESSION_ENCRYPTION_KEY is not set')
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes')

  return {
    generateOpaqueToken: () => randomBytes(32).toString('base64url'),
    hashOpaqueToken: (token) => createHash('sha256').update(token).digest(),
    seal(secret, context) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(aad(context))
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(secret), 'utf8'),
        cipher.final(),
      ])
      return `v1.${nonce.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
    },
    open(ciphertext, context) {
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
      return sessionSecret(JSON.parse(plaintext) as unknown)
    },
  }
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
      identity: { givenName: null, familyName: null },
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
    },
  }
}

function sessionIdentityName(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  throw new Error('Invalid session identity payload')
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
