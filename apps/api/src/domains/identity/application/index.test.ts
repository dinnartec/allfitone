import { describe, expect, test } from 'bun:test'
import { AuthError, type AuthProvider } from '@allfitone/auth-provider'

import type {
  ActorRegistration,
  IdentitySessionDatabase,
  SessionTokenVault,
  StoredAccessSession,
} from '../domain/index.js'
import { createStudioSessionService, StudioSessionError } from './index.js'

const NOW = new Date('2026-08-06T12:00:00.000Z')
const CURRENT = { accessToken: 'access-current', refreshToken: 'refresh-current', expiresIn: 300 }
const ROTATED = { accessToken: 'access-rotated', refreshToken: 'refresh-rotated', expiresIn: 300 }
const IDENTITY = {
  givenName: 'Ada',
  familyName: 'Lovelace',
  verifiedEmail: 'ada@example.test',
}

function provider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    getAuthorizationUrl: () => 'https://workos.test/authorize',
    getLogoutUrl: ({ sessionId, returnTo }) =>
      `https://workos.test/logout?sid=${sessionId}&return_to=${encodeURIComponent(returnTo)}`,
    authenticateWithCode: async () => ({ subject: 'user_1', identity: IDENTITY, tokens: CURRENT }),
    authenticateWithPassword: async () => ({
      subject: 'user_1',
      identity: IDENTITY,
      tokens: CURRENT,
    }),
    refresh: async () => ROTATED,
    verifyAccessToken: async () => ({
      subject: 'user_1',
      sessionId: 'provider_session_1',
      surface: 'studio',
    }),
    verifyWebhookEvent: async () => null,
    register: async () => {
      throw new Error('not used')
    },
    verifyEmail: async () => {
      throw new Error('not used')
    },
    updateEmail: async () => undefined,
    enrollTotp: async () => {
      throw new Error('not used')
    },
    challengeTotp: async () => {
      throw new Error('not used')
    },
    verifyTotp: async () => {
      throw new Error('not used')
    },
    deleteAuthenticationFactor: async () => undefined,
    requestPasswordReset: async () => undefined,
    revokeSession: async () => undefined,
    revokeSessions: async () => undefined,
    ...overrides,
  }
}

class MemoryDatabase implements IdentitySessionDatabase {
  session: StoredAccessSession | undefined
  registration: ActorRegistration = {}
  revoked = false
  rotations = 0
  accountResolutions = 0
  failLoad = false
  failRevoke = false

  async resolveOrCreateAccount() {
    this.accountResolutions += 1
    return { accountId: 'account_1' }
  }

  async createSession(input: {
    accountId: string
    providerSessionId: string
    tokenHash: Uint8Array
    tokenCiphertext: string
    accessTokenExpiresAt: Date
  }) {
    this.session = {
      sessionId: 'session_1',
      accountId: input.accountId,
      externalSubject: 'user_1',
      providerSessionId: input.providerSessionId,
      tokenCiphertext: input.tokenCiphertext,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      tokenVersion: 1,
    }
    return 'session_1'
  }

  async loadSession() {
    if (this.failLoad) throw new Error('database unavailable')
    return this.revoked ? undefined : this.session
  }

  async rotateSession(input: {
    sessionId: string
    expectedTokenVersion: number
    tokenCiphertext: string
    accessTokenExpiresAt: Date
  }) {
    this.rotations += 1
    if (!this.session || this.session.tokenVersion !== input.expectedTokenVersion) return false
    this.session = {
      ...this.session,
      tokenCiphertext: input.tokenCiphertext,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      tokenVersion: this.session.tokenVersion + 1,
    }
    return true
  }

  async revokeSession() {
    if (this.failRevoke) throw new Error('database unavailable')
    this.revoked = true
    return true
  }

  async resolveRegistration() {
    return this.registration
  }
}

function vault(): SessionTokenVault {
  return {
    generateOpaqueToken: () => 'opaque',
    hashOpaqueToken: () => new Uint8Array(32).fill(1),
    deriveOpaqueToken: () => 'derived',
    seal: (secret) =>
      `v1.${secret.tokens.accessToken}.${secret.identity.givenName}.${secret.identity.familyName}`,
    open: (ciphertext) => {
      const [, accessToken, givenName, familyName] = ciphertext.split('.')
      return {
        tokens: accessToken?.includes('rotated') ? ROTATED : CURRENT,
        identity: {
          givenName: givenName ?? null,
          familyName: familyName ?? null,
          verifiedEmail: 'ada@example.test',
        },
      }
    },
    sealBackofficeAttempt: () => 'not-used',
    openBackofficeAttempt: () => {
      throw new Error('not used')
    },
  }
}

function service(
  database: MemoryDatabase,
  authProvider: AuthProvider = provider(),
  tokenVault: SessionTokenVault = vault(),
) {
  return createStudioSessionService({
    authProvider,
    database,
    tokenVault,
    issuer: 'https://issuer.test',
    studioWebUrl: 'https://studio.test',
    now: () => NOW,
  })
}

describe('completeCode', () => {
  test('creates an access account and opaque session without a person', async () => {
    const database = new MemoryDatabase()
    await expect(service(database).completeCode('code')).resolves.toEqual({ opaqueToken: 'opaque' })
    expect(database.accountResolutions).toBe(1)
    expect(database.session?.tokenCiphertext).toBe('v1.access-current.Ada.Lovelace')
    expect(database.session?.accessTokenExpiresAt.toISOString()).toBe('2026-08-06T12:05:00.000Z')
  })

  test('rejects a subject mismatch before touching PostgreSQL', async () => {
    const database = new MemoryDatabase()
    const authProvider = provider({
      verifyAccessToken: async () => ({
        subject: 'different',
        sessionId: 'provider_session_1',
        surface: 'studio',
      }),
    })
    await expect(service(database, authProvider).completeCode('code')).rejects.toEqual(
      new StudioSessionError('unauthenticated'),
    )
    expect(database.accountResolutions).toBe(0)
  })
})

describe('readSession', () => {
  test('reports registration incomplete without exposing account identifiers', async () => {
    const database = new MemoryDatabase()
    await service(database).completeCode('code')
    await expect(service(database).readSession('opaque')).resolves.toEqual({
      authenticated: true,
      registration_status: 'registration_incomplete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    })
  })

  test('reports complete only for an active linked person', async () => {
    const database = new MemoryDatabase()
    database.registration = { personId: 'person_1', personStatus: 'active' }
    await service(database).completeCode('code')
    await expect(service(database).readSession('opaque')).resolves.toMatchObject({
      registration_status: 'complete',
    })
  })

  test('revokes a session linked to a closed person', async () => {
    const database = new MemoryDatabase()
    database.registration = { personId: 'person_1', personStatus: 'closed' }
    await service(database).completeCode('code')
    await expect(service(database).readSession('opaque')).rejects.toEqual(
      new StudioSessionError('account-closed'),
    )
    expect(database.revoked).toBeTrue()
  })

  test('fails closed when a linked person cannot be resolved as active', async () => {
    const database = new MemoryDatabase()
    database.registration = { personId: 'person_1' }
    await service(database).completeCode('code')
    await expect(service(database).readSession('opaque')).rejects.toEqual(
      new StudioSessionError('unauthenticated'),
    )
    expect(database.revoked).toBeTrue()
  })

  test('rotates and persists a refresh token before returning', async () => {
    const database = new MemoryDatabase()
    await service(database).completeCode('code')
    if (database.session) database.session.accessTokenExpiresAt = new Date(NOW.getTime() + 10_000)

    await service(database).readSession('opaque')
    expect(database.rotations).toBe(1)
    expect(database.session?.tokenCiphertext).toBe('v1.access-rotated.Ada.Lovelace')
    expect(database.session?.tokenVersion).toBe(2)
  })

  test('keeps an unexpired session on a transient refresh failure', async () => {
    const database = new MemoryDatabase()
    await service(database).completeCode('code')
    if (database.session) database.session.accessTokenExpiresAt = new Date(NOW.getTime() + 10_000)
    const authProvider = provider({
      refresh: async () => {
        throw new AuthError('provider_unavailable')
      },
    })
    await expect(service(database, authProvider).readSession('opaque')).resolves.toMatchObject({
      authenticated: true,
    })
    expect(database.revoked).toBeFalse()
  })

  test('revokes on a terminal refresh failure', async () => {
    const database = new MemoryDatabase()
    await service(database).completeCode('code')
    if (database.session) database.session.accessTokenExpiresAt = new Date(NOW.getTime() - 1)
    const authProvider = provider({
      refresh: async () => {
        throw new AuthError('invalid_token')
      },
    })
    await expect(service(database, authProvider).readSession('opaque')).rejects.toEqual(
      new StudioSessionError('unauthenticated'),
    )
    expect(database.revoked).toBeTrue()
  })
})

describe('logout', () => {
  test('revokes the local session before returning hosted logout', async () => {
    const database = new MemoryDatabase()
    await service(database).completeCode('code')
    const authProvider = provider({
      getLogoutUrl: ({ sessionId, returnTo }) => {
        expect(database.revoked).toBeTrue()
        return `https://workos.test/logout?sid=${sessionId}&return_to=${encodeURIComponent(returnTo)}`
      },
    })
    const result = await service(database, authProvider).logout('opaque')
    expect(result).toEqual({
      redirectUrl:
        'https://workos.test/logout?sid=provider_session_1&return_to=https%3A%2F%2Fstudio.test',
      outcome: 'revoked',
    })
    expect(database.revoked).toBeTrue()
  })

  test('treats a missing cookie or revoked session as already absent', async () => {
    const database = new MemoryDatabase()
    await expect(service(database).logout(undefined)).resolves.toEqual({
      redirectUrl: 'https://studio.test',
      outcome: 'already-absent',
    })
    await expect(service(database).logout('opaque')).resolves.toEqual({
      redirectUrl: 'https://studio.test',
      outcome: 'already-absent',
    })
  })

  test('returns a local partial destination when the session cannot be loaded', async () => {
    const database = new MemoryDatabase()
    database.failLoad = true
    await expect(service(database).logout('opaque')).resolves.toEqual({
      redirectUrl: 'https://studio.test/?logout=partial',
      outcome: 'partial',
    })
  })

  test('still issues hosted logout with a partial return when local revocation fails', async () => {
    const database = new MemoryDatabase()
    await service(database).completeCode('code')
    database.failRevoke = true

    const result = await service(database).logout('opaque')

    expect(result.outcome).toBe('partial')
    expect(result.redirectUrl).toContain('sid=provider_session_1')
    expect(result.redirectUrl).toContain(encodeURIComponent('https://studio.test/?logout=partial'))
  })
})
