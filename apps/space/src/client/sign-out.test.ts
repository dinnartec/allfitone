/**
 * What has to be true when somebody signs out.
 *
 * The two claims that matter are the two criteria of `HU-SP-003`, and they are the
 * ones a screen would get wrong: the phone forgets **even when everything fails**, and
 * it does **not** forget while a workout is still unsynced and nobody has been asked.
 */

import { describe, expect, test } from 'bun:test'

import { createSignOutFlow, type SignOutDependencies } from './sign-out'

const EXECUTION_ID = '019f9000-0000-7000-8000-000000000099'

function harness(overrides: Partial<SignOutDependencies> = {}) {
  const calls: string[] = []
  const flow = createSignOutFlow({
    transport: {
      revoke: async () => {
        calls.push('revoke')
      },
    },
    clearSession: async () => {
      calls.push('clear')
    },
    openExecutionId: async () => null,
    ...overrides,
  })
  return { flow, calls }
}

describe('the phone forgets, whatever else happens', () => {
  test('T-SP-SIGNOUT-01 revokes first and erases second', () => {
    // Erasing first would leave no token to revoke with.
    const { flow, calls } = harness()

    return flow.signOut().then(() => {
      expect(calls).toEqual(['revoke', 'clear'])
    })
  })

  test('T-SP-SIGNOUT-02 erases even when the revocation fails', async () => {
    const { flow, calls } = harness({
      transport: {
        revoke: async () => {
          throw new Error('offline')
        },
      },
    })

    const outcome = await flow.signOut()

    expect(outcome).toEqual({ state: 'signed-out-locally' })
    expect(calls).toEqual(['clear'])
  })

  test('T-SP-SIGNOUT-03 says so when only the device was cleared', async () => {
    // The distinction is real: the provider still holds a live refresh token.
    const { flow } = harness({
      transport: {
        revoke: async () => {
          throw new Error('offline')
        },
      },
    })

    expect((await flow.signOut()).state).toBe('signed-out-locally')
  })

  test('T-SP-SIGNOUT-04 reports a clean sign-out when both halves worked', async () => {
    expect((await harness().flow.signOut()).state).toBe('signed-out')
  })
})

describe('an unsynced workout stops it once', () => {
  const open = { openExecutionId: async () => EXECUTION_ID }

  test('T-SP-SIGNOUT-05 refuses the first time and names the workout', async () => {
    const { flow, calls } = harness(open)

    expect(await flow.signOut()).toEqual({
      state: 'unsynced-workout',
      executionId: EXECUTION_ID,
    })
    expect(calls).toEqual([])
  })

  test('T-SP-SIGNOUT-06 and goes through when somebody insists', async () => {
    const { flow, calls } = harness(open)

    expect(await flow.signOut({ force: true })).toEqual({ state: 'signed-out' })
    expect(calls).toEqual(['revoke', 'clear'])
  })

  test('T-SP-SIGNOUT-07 not knowing is not a reason to keep somebody signed in', async () => {
    const { flow, calls } = harness({
      openExecutionId: async () => {
        throw new Error('offline')
      },
    })

    expect((await flow.signOut()).state).toBe('signed-out')
    expect(calls).toEqual(['revoke', 'clear'])
  })
})
