/**
 * Keeping a session alive across an expired access token.
 *
 * HU-SP-002 criterion 4 says the session survives closing the app. Storing the
 * tokens is not enough: access tokens are short-lived, so the first authenticated
 * request after a while comes back `401` and the person is told to sign in again
 * while a perfectly good refresh token sits unused. That is exactly what happened
 * on device.
 *
 * The rules worth pinning down are the ones that go wrong quietly: refresh once
 * and only once, persist the rotated pair, and never turn a failed refresh into
 * an endless retry.
 */

import { describe, expect, test } from 'bun:test'

import { withRefresh } from './with-refresh'

const SESSION = { accessToken: 'at_1', refreshToken: 'rt_1' }
const ROTATED = { accessToken: 'at_2', refreshToken: 'rt_2' }

class Unauthorized extends Error {}

function depsWith(overrides: Partial<Parameters<typeof withRefresh>[0]> = {}) {
  const persisted: Array<{ accessToken: string; refreshToken: string }> = []
  return {
    persisted,
    deps: {
      session: async () => SESSION,
      persist: async (tokens: { accessToken: string; refreshToken: string }) => {
        persisted.push(tokens)
      },
      refresh: async () => ROTATED,
      unauthorized: (error: unknown) => error instanceof Unauthorized,
      ...overrides,
    },
  }
}

describe('withRefresh', () => {
  test('sends the stored token and does not refresh when it works', async () => {
    let refreshed = 0
    const { deps, persisted } = depsWith({
      refresh: async () => {
        refreshed += 1
        return ROTATED
      },
    })
    const used: Array<string | undefined> = []

    const result = await withRefresh(deps, async (token) => {
      used.push(token)
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(used).toEqual(['at_1'])
    expect(refreshed).toBe(0)
    expect(persisted).toEqual([])
  })

  test('refreshes once on a rejected token and retries with the new one', async () => {
    const { deps, persisted } = depsWith()
    const used: Array<string | undefined> = []

    const result = await withRefresh(deps, async (token) => {
      used.push(token)
      if (token === 'at_1') throw new Unauthorized()
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(used).toEqual(['at_1', 'at_2'])
    expect(persisted).toEqual([ROTATED])
  })

  test('does not retry a second time, so a bad token cannot loop', async () => {
    const { deps } = depsWith()
    let calls = 0

    await expect(
      withRefresh(deps, async () => {
        calls += 1
        throw new Unauthorized()
      }),
    ).rejects.toBeInstanceOf(Unauthorized)

    expect(calls).toBe(2)
  })

  test('surfaces the original rejection when the refresh itself fails', async () => {
    const { deps, persisted } = depsWith({
      refresh: async () => {
        throw new Error('refresh rejected')
      },
    })

    await expect(
      withRefresh(deps, async () => {
        throw new Unauthorized()
      }),
    ).rejects.toBeInstanceOf(Unauthorized)

    expect(persisted).toEqual([])
  })

  test('does not attempt a refresh when there is no session at all', async () => {
    let refreshed = 0
    const { deps } = depsWith({
      session: async () => null,
      refresh: async () => {
        refreshed += 1
        return ROTATED
      },
    })
    const used: Array<string | undefined> = []

    await expect(
      withRefresh(deps, async (token) => {
        used.push(token)
        throw new Unauthorized()
      }),
    ).rejects.toBeInstanceOf(Unauthorized)

    expect(used).toEqual([undefined])
    expect(refreshed).toBe(0)
  })

  test('leaves an error that is not a rejection alone', async () => {
    let refreshed = 0
    const { deps } = depsWith({
      refresh: async () => {
        refreshed += 1
        return ROTATED
      },
    })

    await expect(
      withRefresh(deps, async () => {
        throw new Error('network')
      }),
    ).rejects.toThrow('network')

    expect(refreshed).toBe(0)
  })
})
