/**
 * Keeping a session alive without making anyone wait for it.
 *
 * HU-SP-002 criterion 4 says the session survives closing the app. The rules worth pinning
 * down are the ones that go wrong quietly: the keychain read once, not per request; a token
 * about to lapse renewed before it is sent, not after a refusal; one renewal for everyone
 * who needs it at once, since the refresh token rotates and two renewals race; a refused
 * renewal surfacing the original refusal; and never more than one retry.
 */

import { describe, expect, test } from 'bun:test'

import { createSessionKeeper, type SessionTokenPair } from './session-keeper'

const NOW = 1_800_000_000_000

/** A token whose payload says when it lapses, as the provider's JWT does. */
function token(name: string, expiresInSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: 'person', exp: Math.floor(NOW / 1000) + expiresInSeconds }),
  ).toString('base64url')
  return `header.${payload}.${name}`
}

class Unauthorized extends Error {}
const unauthorized = (error: unknown) => error instanceof Unauthorized

function keeperWith(stored: SessionTokenPair | null, rotated?: SessionTokenPair) {
  const calls = { reads: 0, refreshes: 0, persisted: [] as SessionTokenPair[] }
  const keeper = createSessionKeeper({
    read: async () => {
      calls.reads += 1
      return stored
    },
    persist: async (tokens) => {
      calls.persisted.push(tokens)
    },
    refresh: async () => {
      calls.refreshes += 1
      if (!rotated) throw new Error('refresh refused')
      return rotated
    },
    now: () => NOW,
  })
  return { keeper, calls }
}

describe('the session keeper', () => {
  test('T-SPC-UNIT-254 the keychain is read once, however many requests follow', async () => {
    const fresh = { accessToken: token('a', 3600), refreshToken: 'r1' }
    const { keeper, calls } = keeperWith(fresh)
    const sent: (string | undefined)[] = []
    await Promise.all([1, 2, 3].map(() => keeper.run(async (t) => sent.push(t), unauthorized)))
    await keeper.run(async (t) => sent.push(t), unauthorized)
    expect(calls.reads).toBe(1)
    expect(sent).toEqual([
      fresh.accessToken,
      fresh.accessToken,
      fresh.accessToken,
      fresh.accessToken,
    ])
    expect(calls.refreshes).toBe(0)
  })

  test('T-SPC-UNIT-255 a token about to lapse is renewed before it is sent, once for everyone', async () => {
    const lapsing = { accessToken: token('old', 30), refreshToken: 'r1' }
    const renewed = { accessToken: token('new', 3600), refreshToken: 'r2' }
    const { keeper, calls } = keeperWith(lapsing, renewed)
    const sent: (string | undefined)[] = []
    await Promise.all([1, 2, 3].map(() => keeper.run(async (t) => sent.push(t), unauthorized)))
    expect(calls.refreshes).toBe(1)
    expect(calls.persisted).toEqual([renewed])
    expect(sent).toEqual([renewed.accessToken, renewed.accessToken, renewed.accessToken])
  })

  test('T-SPC-UNIT-256 a refusal renews once, shared, and retries each request once', async () => {
    const stale = { accessToken: token('stale', 3600), refreshToken: 'r1' }
    const renewed = { accessToken: token('new', 3600), refreshToken: 'r2' }
    const { keeper, calls } = keeperWith(stale, renewed)
    const send = async (t: string | undefined) => {
      if (t === stale.accessToken) throw new Unauthorized()
      return t
    }
    const answers = await Promise.all([1, 2].map(() => keeper.run(send, unauthorized)))
    expect(answers).toEqual([renewed.accessToken, renewed.accessToken])
    expect(calls.refreshes).toBe(1)
  })

  test('T-SPC-UNIT-257 a refused renewal surfaces the original refusal, and nothing loops', async () => {
    const stale = { accessToken: token('stale', 3600), refreshToken: 'r1' }
    const { keeper, calls } = keeperWith(stale)
    const refusal = new Unauthorized('refused')
    await expect(
      keeper.run(async () => {
        throw refusal
      }, unauthorized),
    ).rejects.toBe(refusal)
    expect(calls.refreshes).toBe(1)

    const renewed = { accessToken: token('new', 3600), refreshToken: 'r2' }
    const second = keeperWith(stale, renewed)
    let attempts = 0
    await expect(
      second.keeper.run(async () => {
        attempts += 1
        throw new Unauthorized()
      }, unauthorized),
    ).rejects.toBeInstanceOf(Unauthorized)
    expect(attempts).toBe(2)
  })

  test('T-SPC-UNIT-258 after a sign-in or sign-out the keeper reads the keychain again', async () => {
    const fresh = { accessToken: token('a', 3600), refreshToken: 'r1' }
    const { keeper, calls } = keeperWith(fresh)
    await keeper.run(async () => undefined, unauthorized)
    keeper.forget()
    await keeper.run(async () => undefined, unauthorized)
    expect(calls.reads).toBe(2)
  })

  test('T-SPC-UNIT-259 with no session the request goes without a token; one not read as a JWT goes as it is', async () => {
    const none = keeperWith(null)
    expect(await none.keeper.run(async (t) => t, unauthorized)).toBeUndefined()

    const opaque = keeperWith({ accessToken: 'opaque', refreshToken: 'r1' })
    expect(await opaque.keeper.run(async (t) => t, unauthorized)).toBe('opaque')
    expect(opaque.calls.refreshes).toBe(0)
  })

  test('T-SPC-UNIT-260 an error that is not a refusal goes through untouched, with no renewal', async () => {
    const fresh = { accessToken: token('a', 3600), refreshToken: 'r1' }
    const { keeper, calls } = keeperWith(fresh, {
      accessToken: token('new', 3600),
      refreshToken: 'r2',
    })
    const failure = new Error('server down')
    let attempts = 0
    await expect(
      keeper.run(async () => {
        attempts += 1
        throw failure
      }, unauthorized),
    ).rejects.toBe(failure)
    expect(attempts).toBe(1)
    expect(calls.refreshes).toBe(0)
  })
})
