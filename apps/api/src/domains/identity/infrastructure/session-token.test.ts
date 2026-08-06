import { afterEach, describe, expect, test } from 'bun:test'

import { createSessionTokenVaultFromEnv } from './index.js'

afterEach(() => delete process.env.SESSION_ENCRYPTION_KEY)

describe('Studio session token vault', () => {
  test('uses a random 256-bit opaque token and SHA-256 database key', () => {
    process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    const vault = createSessionTokenVaultFromEnv()
    const token = vault.generateOpaqueToken()
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(vault.hashOpaqueToken(token)).toHaveLength(32)
  })

  test('round-trips tokens only with the same authenticated context', () => {
    process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    const vault = createSessionTokenVaultFromEnv()
    const context = {
      accountId: 'account_1',
      providerSessionId: 'sid_1',
      surface: 'studio' as const,
    }
    const tokens = { accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresIn: 300 }
    const ciphertext = vault.seal(tokens, context)

    expect(ciphertext).not.toContain('access-secret')
    expect(ciphertext).not.toContain('refresh-secret')
    expect(vault.open(ciphertext, context)).toEqual(tokens)
    expect(() => vault.open(ciphertext, { ...context, accountId: 'account_2' })).toThrow()
  })

  test('rejects a key that is not exactly 32 bytes', () => {
    process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64')
    expect(() => createSessionTokenVaultFromEnv()).toThrow(/32 bytes/)
  })
})
