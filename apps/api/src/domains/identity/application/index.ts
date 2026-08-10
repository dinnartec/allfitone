/** Studio session use cases. No HTTP and no direct SQL. */

import { AuthError, type AuthProvider, type SessionTokens } from '@allfitone/auth-provider'

import type {
  IdentitySessionDatabase,
  IdentityOnboardingDatabase,
  IdentityProfessionalDatabase,
  CommandContext,
  ProfessionalCredentialInput,
  ProfessionalProfileInput,
  RegistrationStatus,
  SessionCipherContext,
  SessionTokenVault,
  StoredSessionSecret,
  StoredAccessSession,
  StudioAccountIdentity,
  StudioActor,
} from '../domain/index.js'

const REFRESH_WINDOW_MS = 30_000

export type StudioSessionErrorCode = 'unauthenticated' | 'account-closed' | 'upstream-unavailable'

export class StudioSessionError extends Error {
  constructor(readonly code: StudioSessionErrorCode) {
    super(code)
    this.name = 'StudioSessionError'
  }
}

export interface StudioSessionService {
  completeCode(code: string): Promise<{ opaqueToken: string }>
  readSession(opaqueToken: string): Promise<{
    authenticated: true
    registration_status: RegistrationStatus
    identity: { given_name: string | null; family_name: string | null }
  }>
  resolveActor(opaqueToken: string): Promise<StudioActor>
  resolveAccountIdentity(opaqueToken: string): Promise<StudioAccountIdentity>
  logout(opaqueToken: string | undefined): Promise<StudioLogoutResult>
}

export type StudioLogoutOutcome = 'already-absent' | 'partial' | 'revoked'

export interface StudioLogoutResult {
  redirectUrl: string
  outcome: StudioLogoutOutcome
}

export interface StudioOnboardingService {
  startAttempt(
    actor: StudioActor,
    command: CommandContext,
  ): ReturnType<IdentityOnboardingDatabase['startAttempt']>
  recordAdultEligibility(
    actor: StudioActor,
    input: Omit<Parameters<IdentityOnboardingDatabase['recordAdultEligibility']>[0], 'accountId'>,
  ): ReturnType<IdentityOnboardingDatabase['recordAdultEligibility']>
  complete(
    actor: StudioActor,
    input: Omit<Parameters<IdentityOnboardingDatabase['activatePerson']>[0], 'accountId'>,
  ): ReturnType<IdentityOnboardingDatabase['activatePerson']>
}

export class StudioProfessionalError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'StudioProfessionalError'
  }
}

export interface StudioProfessionalService {
  getMe(actor: StudioActor, requestId: string): ReturnType<IdentityProfessionalDatabase['getMe']>
  putProfile(
    actor: StudioActor,
    input: CommandContext & ProfessionalProfileInput,
  ): ReturnType<IdentityProfessionalDatabase['putProfile']>
  declareCredential(
    actor: StudioActor,
    input: CommandContext & ProfessionalCredentialInput,
  ): ReturnType<IdentityProfessionalDatabase['declareCredential']>
  reviseCredential(
    actor: StudioActor,
    credentialId: string,
    input: CommandContext & ProfessionalCredentialInput,
  ): ReturnType<IdentityProfessionalDatabase['reviseCredential']>
  retireCredential(
    actor: StudioActor,
    credentialId: string,
    command: CommandContext,
  ): ReturnType<IdentityProfessionalDatabase['retireCredential']>
}

export interface StudioSessionDependencies {
  authProvider: AuthProvider
  database: IdentitySessionDatabase
  tokenVault: SessionTokenVault
  issuer: string
  studioWebUrl: string
  now?: () => Date
}

export function createStudioSessionService(
  dependencies: StudioSessionDependencies,
): StudioSessionService {
  const now = dependencies.now ?? (() => new Date())

  return {
    async completeCode(code) {
      const result = await dependencies.authProvider.authenticateWithCode(code, 'studio')
      const verified = await dependencies.authProvider.verifyAccessToken(
        result.tokens.accessToken,
        'studio',
      )
      if (result.subject !== verified.subject) throw new StudioSessionError('unauthenticated')

      const account = await dependencies.database.resolveOrCreateAccount(
        dependencies.issuer,
        verified.subject,
      )
      const context = cipherContext(account.accountId, verified.sessionId)
      const opaqueToken = dependencies.tokenVault.generateOpaqueToken()
      await dependencies.database.createSession({
        accountId: account.accountId,
        providerSessionId: verified.sessionId,
        tokenHash: dependencies.tokenVault.hashOpaqueToken(opaqueToken),
        tokenCiphertext: dependencies.tokenVault.seal(
          { tokens: result.tokens, identity: result.identity },
          context,
        ),
        accessTokenExpiresAt: expiresAt(result.tokens, now()),
      })
      return { opaqueToken }
    },

    async readSession(opaqueToken) {
      const context = await resolveAccountIdentity(opaqueToken)
      return {
        authenticated: true,
        registration_status: context.actor.personId ? 'complete' : 'registration_incomplete',
        identity: {
          given_name: context.identity.givenName,
          family_name: context.identity.familyName,
        },
      }
    },

    async resolveActor(opaqueToken) {
      return (await resolveAccountIdentity(opaqueToken)).actor
    },

    resolveAccountIdentity,

    async logout(opaqueToken) {
      if (!opaqueToken) {
        return { redirectUrl: dependencies.studioWebUrl, outcome: 'already-absent' }
      }

      let session: StoredAccessSession | undefined
      try {
        session = await dependencies.database.loadSession(
          dependencies.tokenVault.hashOpaqueToken(opaqueToken),
        )
      } catch {
        return {
          redirectUrl: partialLogoutReturnTo(dependencies.studioWebUrl),
          outcome: 'partial',
        }
      }
      if (!session) {
        return { redirectUrl: dependencies.studioWebUrl, outcome: 'already-absent' }
      }

      try {
        const revoked = await dependencies.database.revokeSession(session.sessionId)
        return {
          redirectUrl: dependencies.authProvider.getLogoutUrl({
            sessionId: session.providerSessionId,
            returnTo: dependencies.studioWebUrl,
          }),
          outcome: revoked ? 'revoked' : 'already-absent',
        }
      } catch {
        const returnTo = partialLogoutReturnTo(dependencies.studioWebUrl)
        try {
          return {
            redirectUrl: dependencies.authProvider.getLogoutUrl({
              sessionId: session.providerSessionId,
              returnTo,
            }),
            outcome: 'partial',
          }
        } catch {
          return { redirectUrl: returnTo, outcome: 'partial' }
        }
      }
    },
  }

  async function resolveAccountIdentity(opaqueToken: string): Promise<StudioAccountIdentity> {
    const { session, secret } = await authenticatedSession(opaqueToken, true)
    const registration = await dependencies.database.resolveRegistration(session.accountId)
    if (registration.personStatus === 'closed') {
      await dependencies.database.revokeSession(session.sessionId)
      throw new StudioSessionError('account-closed')
    }
    if (registration.personId && registration.personStatus !== 'active') {
      await dependencies.database.revokeSession(session.sessionId)
      throw new StudioSessionError('unauthenticated')
    }
    return {
      actor: {
        accountId: session.accountId,
        ...(registration.personId ? { personId: registration.personId } : {}),
      },
      identity: secret.identity,
    }
  }

  async function authenticatedSession(
    opaqueToken: string,
    reloadAfterRace: boolean,
  ): Promise<{ session: StoredAccessSession; secret: StoredSessionSecret }> {
    const session = await dependencies.database.loadSession(
      dependencies.tokenVault.hashOpaqueToken(opaqueToken),
    )
    if (!session) throw new StudioSessionError('unauthenticated')

    const context = cipherContext(session.accountId, session.providerSessionId)
    let secret: StoredSessionSecret
    try {
      secret = dependencies.tokenVault.open(session.tokenCiphertext, context)
    } catch {
      await dependencies.database.revokeSession(session.sessionId)
      throw new StudioSessionError('unauthenticated')
    }

    if (session.accessTokenExpiresAt.getTime() <= now().getTime() + REFRESH_WINDOW_MS) {
      let refreshed: SessionTokens
      try {
        refreshed = await dependencies.authProvider.refresh(secret.tokens.refreshToken, 'studio')
      } catch (error) {
        if (error instanceof AuthError && error.retryable) {
          if (session.accessTokenExpiresAt.getTime() <= now().getTime()) {
            throw new StudioSessionError('upstream-unavailable')
          }
          await verify(secret.tokens.accessToken, session)
          return { session, secret }
        }
        await dependencies.database.revokeSession(session.sessionId)
        throw new StudioSessionError('unauthenticated')
      }

      await verify(refreshed.accessToken, session)
      const rotated = await dependencies.database.rotateSession({
        sessionId: session.sessionId,
        expectedTokenVersion: session.tokenVersion,
        tokenCiphertext: dependencies.tokenVault.seal(
          { tokens: refreshed, identity: secret.identity },
          context,
        ),
        accessTokenExpiresAt: expiresAt(refreshed, now()),
      })
      if (!rotated) {
        if (!reloadAfterRace) throw new StudioSessionError('upstream-unavailable')
        return authenticatedSession(opaqueToken, false)
      }
      return { session, secret: { tokens: refreshed, identity: secret.identity } }
    }

    await verify(secret.tokens.accessToken, session)
    return { session, secret }
  }

  async function verify(accessToken: string, session: StoredAccessSession): Promise<void> {
    try {
      const verified = await dependencies.authProvider.verifyAccessToken(accessToken, 'studio')
      if (
        verified.subject !== session.externalSubject ||
        verified.sessionId !== session.providerSessionId ||
        verified.surface !== 'studio'
      ) {
        await dependencies.database.revokeSession(session.sessionId)
        throw new StudioSessionError('unauthenticated')
      }
    } catch (error) {
      if (error instanceof StudioSessionError) throw error
      if (error instanceof AuthError && error.retryable) {
        throw new StudioSessionError('upstream-unavailable')
      }
      await dependencies.database.revokeSession(session.sessionId)
      throw new StudioSessionError('unauthenticated')
    }
  }
}

function partialLogoutReturnTo(studioWebUrl: string): string {
  const returnTo = new URL(studioWebUrl)
  returnTo.searchParams.set('logout', 'partial')
  return returnTo.toString()
}

export function createStudioOnboardingService(
  database: IdentityOnboardingDatabase,
): StudioOnboardingService {
  return {
    startAttempt: (actor, command) =>
      database.startAttempt({ accountId: actor.accountId, ...command }),
    recordAdultEligibility: (actor, input) =>
      database.recordAdultEligibility({ accountId: actor.accountId, ...input }),
    complete: (actor, input) => database.activatePerson({ accountId: actor.accountId, ...input }),
  }
}

export function createStudioProfessionalService(
  professionalDatabase: IdentityProfessionalDatabase,
): StudioProfessionalService {
  const personId = (actor: StudioActor) => {
    if (!actor.personId) throw new StudioProfessionalError('registration-incomplete')
    return actor.personId
  }

  return {
    getMe: (actor, requestId) => professionalDatabase.getMe(personId(actor), requestId),
    putProfile: (actor, input) =>
      professionalDatabase.putProfile({ personId: personId(actor), ...input }),
    declareCredential: (actor, input) =>
      professionalDatabase.declareCredential({ personId: personId(actor), ...input }),
    reviseCredential: (actor, credentialId, input) =>
      professionalDatabase.reviseCredential({
        personId: personId(actor),
        credentialId,
        ...input,
      }),
    retireCredential: (actor, credentialId, command) =>
      professionalDatabase.retireCredential({
        personId: personId(actor),
        credentialId,
        ...command,
      }),
  }
}

function cipherContext(accountId: string, providerSessionId: string): SessionCipherContext {
  return { accountId, providerSessionId, surface: 'studio' }
}

function expiresAt(tokens: SessionTokens, now: Date): Date {
  return new Date(now.getTime() + tokens.expiresIn * 1000)
}
