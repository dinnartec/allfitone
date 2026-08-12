import { afterEach, describe, expect, test } from 'bun:test'
import { createCipheriv } from 'node:crypto'

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
    const secret = {
      tokens: { accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresIn: 300 },
      identity: { givenName: 'Ada', familyName: 'Lovelace', verifiedEmail: 'ada@example.test' },
    }
    const ciphertext = vault.seal(secret, context)

    expect(ciphertext).not.toContain('access-secret')
    expect(ciphertext).not.toContain('refresh-secret')
    expect(ciphertext).not.toContain('Ada')
    expect(vault.open(ciphertext, context)).toEqual(secret)
    expect(() => vault.open(ciphertext, { ...context, accountId: 'account_2' })).toThrow()
  })

  test('rejects a key that is not exactly 32 bytes', () => {
    process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64')
    expect(() => createSessionTokenVaultFromEnv()).toThrow(/32 bytes/)
  })

  test('opens sessions issued before provider identity was captured', () => {
    const key = Buffer.alloc(32, 7)
    process.env.SESSION_ENCRYPTION_KEY = key.toString('base64')
    const vault = createSessionTokenVaultFromEnv()
    const context = {
      accountId: 'account_1',
      providerSessionId: 'sid_1',
      surface: 'studio' as const,
    }
    const nonce = Buffer.alloc(12, 3)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(Buffer.from('account_1\u0000studio\u0000sid_1', 'utf8'))
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 300 }),
        'utf8',
      ),
      cipher.final(),
    ])
    const ciphertext = `v1.${nonce.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`

    expect(vault.open(ciphertext, context)).toEqual({
      tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 300 },
      identity: { givenName: null, familyName: null, verifiedEmail: null },
    })
  })
})
