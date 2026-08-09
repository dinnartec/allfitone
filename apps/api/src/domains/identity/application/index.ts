/** Studio session use cases. No HTTP and no direct SQL. */

import { AuthError, type AuthProvider, type SessionTokens } from '@allfitone/auth-provider'

import type {
  IdentitySessionDatabase,
  IdentityOnboardingDatabase,
  CommandContext,
  RegistrationStatus,
  SessionCipherContext,
  SessionTokenVault,
  StoredAccessSession,
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
  }>
  resolveActor(opaqueToken: string): Promise<StudioActor>
  logout(opaqueToken: string | undefined): Promise<string>
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
        tokenCiphertext: dependencies.tokenVault.seal(result.tokens, context),
        accessTokenExpiresAt: expiresAt(result.tokens, now()),
      })
      return { opaqueToken }
    },

    async readSession(opaqueToken) {
      const actor = await resolveActor(opaqueToken)
      return {
        authenticated: true,
        registration_status: actor.personId ? 'complete' : 'registration_incomplete',
      }
    },

    resolveActor,

    async logout(opaqueToken) {
      if (!opaqueToken) return dependencies.studioWebUrl
      const session = await dependencies.database.loadSession(
        dependencies.tokenVault.hashOpaqueToken(opaqueToken),
      )
      if (!session) return dependencies.studioWebUrl

      await dependencies.database.revokeSession(session.sessionId)
      return dependencies.authProvider.getLogoutUrl({
        sessionId: session.providerSessionId,
        returnTo: dependencies.studioWebUrl,
      })
    },
  }

  async function resolveActor(opaqueToken: string): Promise<StudioActor> {
    const session = await authenticatedSession(opaqueToken, true)
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
      accountId: session.accountId,
      ...(registration.personId ? { personId: registration.personId } : {}),
    }
  }

  async function authenticatedSession(
    opaqueToken: string,
    reloadAfterRace: boolean,
  ): Promise<StoredAccessSession> {
    const session = await dependencies.database.loadSession(
      dependencies.tokenVault.hashOpaqueToken(opaqueToken),
    )
    if (!session) throw new StudioSessionError('unauthenticated')

    const context = cipherContext(session.accountId, session.providerSessionId)
    let tokens: SessionTokens
    try {
      tokens = dependencies.tokenVault.open(session.tokenCiphertext, context)
    } catch {
      await dependencies.database.revokeSession(session.sessionId)
      throw new StudioSessionError('unauthenticated')
    }

    if (session.accessTokenExpiresAt.getTime() <= now().getTime() + REFRESH_WINDOW_MS) {
      let refreshed: SessionTokens
      try {
        refreshed = await dependencies.authProvider.refresh(tokens.refreshToken, 'studio')
      } catch (error) {
        if (error instanceof AuthError && error.retryable) {
          if (session.accessTokenExpiresAt.getTime() <= now().getTime()) {
            throw new StudioSessionError('upstream-unavailable')
          }
          await verify(tokens.accessToken, session)
          return session
        }
        await dependencies.database.revokeSession(session.sessionId)
        throw new StudioSessionError('unauthenticated')
      }

      await verify(refreshed.accessToken, session)
      const rotated = await dependencies.database.rotateSession({
        sessionId: session.sessionId,
        expectedTokenVersion: session.tokenVersion,
        tokenCiphertext: dependencies.tokenVault.seal(refreshed, context),
        accessTokenExpiresAt: expiresAt(refreshed, now()),
      })
      if (!rotated) {
        if (!reloadAfterRace) throw new StudioSessionError('upstream-unavailable')
        return authenticatedSession(opaqueToken, false)
      }
      return session
    }

    await verify(tokens.accessToken, session)
    return session
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

function cipherContext(accountId: string, providerSessionId: string): SessionCipherContext {
  return { accountId, providerSessionId, surface: 'studio' }
}

function expiresAt(tokens: SessionTokens, now: Date): Date {
  return new Date(now.getTime() + tokens.expiresIn * 1000)
}
