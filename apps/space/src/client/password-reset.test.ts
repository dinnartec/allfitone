/**
 * The rule this guards is that the sheet cannot say more than the API does.
 *
 * The endpoint answers `202` whether the address has an account, has none, or
 * the provider is down — HU-SP-004 criterion 2. So the only failure the person
 * can be shown is one where the request never arrived, and anything else must
 * read as sent. A flow that surfaced "we could not find that address" would
 * rebuild the disclosure the API goes out of its way to prevent.
 */

import { describe, expect, test } from 'bun:test'

import { createPasswordResetFlow } from './password-reset'

describe('createPasswordResetFlow', () => {
  test('reports the request as sent once the API accepts it', async () => {
    const asked: string[] = []
    const flow = createPasswordResetFlow({
      request: async (email) => {
        asked.push(email)
      },
    })

    await expect(flow.submit('walberto@dinnartec.co')).resolves.toBe('sent')
    expect(asked).toEqual(['walberto@dinnartec.co'])
  })

  test('trims the address before asking, so a stray space is not an error', async () => {
    const asked: string[] = []
    const flow = createPasswordResetFlow({
      request: async (email) => {
        asked.push(email)
      },
    })

    await flow.submit('  walberto@dinnartec.co  ')

    expect(asked).toEqual(['walberto@dinnartec.co'])
  })

  test('refuses a malformed address without asking the API', async () => {
    let asked = 0
    const flow = createPasswordResetFlow({
      request: async () => {
        asked += 1
      },
    })

    for (const value of ['', '   ', 'sin-arroba', 'con espacio@x.co']) {
      await expect(flow.submit(value)).resolves.toBe('invalid')
    }
    expect(asked).toBe(0)
  })

  test('a request that never arrived is the only failure worth showing', async () => {
    const flow = createPasswordResetFlow({
      request: async () => {
        throw new Error('network')
      },
    })

    await expect(flow.submit('walberto@dinnartec.co')).resolves.toBe('unreachable')
  })

  test('retrying after a failure sends again rather than staying stuck', async () => {
    let attempts = 0
    const flow = createPasswordResetFlow({
      request: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network')
      },
    })

    await expect(flow.submit('walberto@dinnartec.co')).resolves.toBe('unreachable')
    await expect(flow.submit('walberto@dinnartec.co')).resolves.toBe('sent')
    expect(attempts).toBe(2)
  })
})
