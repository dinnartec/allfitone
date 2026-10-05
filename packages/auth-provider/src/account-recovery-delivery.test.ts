/**
 * The recovery the worker asks for (`HU-BO-010`).
 *
 * What matters is what does not come back: the provider answers with a token and a URL
 * that open the person's account, and only the expiry may leave this package.
 */

import { describe, expect, test } from 'bun:test'

import { createAccountRecoveryDelivery, createAccountRecoveryDeliveryFromEnv } from './factory.js'

describe('createAccountRecoveryDelivery', () => {
  test('returns only when the link expires, never its token or URL', async () => {
    const calls: unknown[] = []
    const delivery = createAccountRecoveryDelivery({
      createPasswordReset: async (options) => {
        calls.push(options)
        return {
          id: 'password_reset_private',
          passwordResetToken: 'must-not-escape',
          passwordResetUrl: 'https://example.test/must-not-escape',
          expiresAt: '2026-09-15T05:15:00.000Z',
        }
      },
    })

    await expect(delivery.sendRecovery('person@example.test')).resolves.toEqual({
      expiresAt: '2026-09-15T05:15:00.000Z',
    })
    expect(calls).toEqual([{ email: 'person@example.test' }])
  })

  test('tells a refused address apart from an outage', async () => {
    const failing = (status: number) =>
      createAccountRecoveryDelivery({
        createPasswordReset: async () =>
          Promise.reject(Object.assign(new Error('provider said no'), { status })),
      })

    await expect(failing(404).sendRecovery('person@example.test')).rejects.toMatchObject({
      code: 'invalid_email',
    })
    await expect(failing(503).sendRecovery('person@example.test')).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  test('never trusts a reset that does not say when it expires', async () => {
    const delivery = createAccountRecoveryDelivery({ createPasswordReset: async () => ({}) })

    await expect(delivery.sendRecovery('person@example.test')).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  test('names the Space key it needs rather than failing vaguely', () => {
    expect(() => createAccountRecoveryDeliveryFromEnv({})).toThrow('WORKOS_API_KEY_SPACE')
  })
})
