import { describe, expect, test } from 'bun:test'

import {
  ACCESS_TOKEN_KEY,
  EMAIL_KEY,
  REFRESH_TOKEN_KEY,
  createSessionOperations,
  type SessionStorage,
} from './session-operations'

const distinctId = `a1_${'A'.repeat(43)}`

describe('Space session operations', () => {
  test('stores product tokens before notifying analytics exactly once', async () => {
    const writes: string[] = []
    const identities: Array<string | null> = []
    const operations = createSessionOperations({
      storage: storage({ writes }),
      analyticsIdentityKey: 'analytics',
      setTelemetryIdentity(value) {
        expect(writes).toContain(ACCESS_TOKEN_KEY)
        expect(writes).toContain(REFRESH_TOKEN_KEY)
        identities.push(value)
      },
    })

    await operations.storeSession({
      accessToken: 'access',
      refreshToken: 'refresh',
      analytics: { distinct_id: distinctId },
    })

    expect(identities).toEqual([distinctId])
  })

  test('does not await analytics persistence or SDK work when storing a session', async () => {
    const never = new Promise<void>(() => undefined)
    const operations = createSessionOperations({
      storage: storage({ pendingSetKey: 'analytics' }),
      analyticsIdentityKey: 'analytics',
      setTelemetryIdentity: () => never,
    })

    await expect(
      settles(
        operations.storeSession({
          accessToken: 'access',
          refreshToken: 'refresh',
          analytics: { distinct_id: distinctId },
        }),
      ),
    ).resolves.toBe('settled')
  })

  test('reads product tokens without waiting for analytics storage', async () => {
    const operations = createSessionOperations({
      storage: storage({ pendingGetKey: 'analytics' }),
      analyticsIdentityKey: 'analytics',
      setTelemetryIdentity: () => undefined,
    })

    await expect(settles(operations.readSession())).resolves.toBe('settled')
    await expect(operations.readSession()).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      email: 'ada@example.test',
      analytics: { distinct_id: null },
    })
  })

  test('omits the address when none was stored, rather than reporting an empty one', async () => {
    const operations = createSessionOperations({
      storage: {
        ...storage({}),
        getItemAsync: async (key) => (key === EMAIL_KEY ? null : 'value'),
      },
      analyticsIdentityKey: 'analytics',
      setTelemetryIdentity: () => undefined,
    })

    await expect(operations.readSession()).resolves.toEqual({
      accessToken: 'value',
      refreshToken: 'value',
      analytics: { distinct_id: null },
    })
  })

  test('a refresh that knows no address leaves the stored one alone', async () => {
    const writes: string[] = []
    const operations = createSessionOperations({
      storage: storage({ writes }),
      analyticsIdentityKey: 'analytics',
      setTelemetryIdentity: () => undefined,
    })

    await operations.storeSession({
      accessToken: 'access',
      refreshToken: 'refresh',
      analytics: { distinct_id: null },
    })

    expect(writes).not.toContain(EMAIL_KEY)
  })

  test('deactivates immediately and does not await analytics deletion on logout', async () => {
    const identities: Array<string | null> = []
    const operations = createSessionOperations({
      storage: storage({ pendingDeleteKey: 'analytics' }),
      analyticsIdentityKey: 'analytics',
      setTelemetryIdentity(value) {
        identities.push(value)
        throw new Error('analytics unavailable')
      },
    })

    await expect(settles(operations.clearSession())).resolves.toBe('settled')
    expect(identities).toEqual([null])
  })
})

function storage(options: {
  writes?: string[]
  pendingSetKey?: string
  pendingGetKey?: string
  pendingDeleteKey?: string
}): SessionStorage {
  const never = new Promise<never>(() => undefined)
  return {
    async setItemAsync(key) {
      options.writes?.push(key)
      if (key === options.pendingSetKey) await never
    },
    async getItemAsync(key) {
      if (key === options.pendingGetKey) await never
      if (key === ACCESS_TOKEN_KEY) return 'access'
      if (key === REFRESH_TOKEN_KEY) return 'refresh'
      if (key === EMAIL_KEY) return 'ada@example.test'
      return distinctId
    },
    async deleteItemAsync(key) {
      if (key === options.pendingDeleteKey) await never
    },
  }
}

async function settles(promise: Promise<unknown>): Promise<'settled' | 'pending'> {
  return Promise.race([
    promise.then(() => 'settled' as const),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20)),
  ])
}
