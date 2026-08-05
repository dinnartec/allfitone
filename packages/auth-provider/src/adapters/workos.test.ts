/**
 * Token verification tests.
 *
 * Written before the implementation, deliberately: these assert what is
 * *forbidden*, and a denial test written afterwards can pass because the setup
 * never produced the scenario. Each rejection case below was observed failing —
 * verification allowing the token — before the check existed.
 *
 * No network. The key resolver is injected, which is the whole reason that seam
 * exists.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyObject } from 'jose'
import { createWorkOSAuthProvider } from './workos.js'
import { AuthError } from '../errors.js'
import type { AuthProvider, Surface } from '../port.js'

const CLIENT_IDS: Record<Surface, string> = {
  space: 'client_space_test',
  studio: 'client_studio_test',
  backoffice: 'client_backoffice_test',
}

const ISSUER = 'https://api.workos.com'

let privateKey: KeyObject
let publicJwk: JWK
let otherPrivateKey: KeyObject
let provider: AuthProvider

/** Mints a token. Overrides let each test bend exactly one thing. */
async function mintToken(
  overrides: {
    clientId?: string
    sub?: string | undefined
    sid?: string | undefined
    expiresIn?: string
    issuer?: string
    signWith?: KeyObject
    extraClaims?: Record<string, unknown>
  } = {},
): Promise<string> {
  const claims: Record<string, unknown> = {
    client_id: overrides.clientId ?? CLIENT_IDS.studio,
    ...overrides.extraClaims,
  }
  if (overrides.sub !== undefined) claims.sub = overrides.sub
  if (overrides.sid !== undefined) claims.sid = overrides.sid

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setExpirationTime(overrides.expiresIn ?? '5m')
    .sign(overrides.signWith ?? privateKey)
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey as KeyObject
  publicJwk = await exportJWK(pair.publicKey)

  const other = await generateKeyPair('RS256')
  otherPrivateKey = other.privateKey as KeyObject

  provider = createWorkOSAuthProvider({
    apiKey: 'sk_test_not_used_here',
    clientIds: CLIENT_IDS,
    issuer: ISSUER,
    // Test seam: a local key set instead of fetching the remote JWKS.
    jwks: { keys: [publicJwk] },
  })
})

describe('verifyAccessToken', () => {
  test('accepts a valid token and returns subject, session and surface', async () => {
    const token = await mintToken({ sub: 'user_01ABC', sid: 'session_01XYZ' })

    const verified = await provider.verifyAccessToken(token, 'studio')

    expect(verified).toEqual({
      subject: 'user_01ABC',
      sessionId: 'session_01XYZ',
      surface: 'studio',
    })
  })

  test('never exposes authorization claims, even when the token carries them', async () => {
    // The provider does issue these. Reading them would create a second source
    // of truth for authorization — the whole point of ignoring them.
    const token = await mintToken({
      sub: 'user_01ABC',
      sid: 'session_01XYZ',
      extraClaims: {
        org_id: 'org_01DEF',
        role: 'admin',
        permissions: ['posts:read', 'posts:write'],
      },
    })

    const verified = await provider.verifyAccessToken(token, 'studio')

    expect(Object.keys(verified).sort()).toEqual(['sessionId', 'subject', 'surface'])
    expect(JSON.stringify(verified)).not.toContain('admin')
    expect(JSON.stringify(verified)).not.toContain('org_01DEF')
  })

  test('rejects a token issued for another surface', async () => {
    // A real, correctly signed, unexpired Space token used against Backoffice.
    const token = await mintToken({
      clientId: CLIENT_IDS.space,
      sub: 'user_01ABC',
      sid: 'session_01XYZ',
    })

    await expect(provider.verifyAccessToken(token, 'backoffice')).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  test('rejects an expired token', async () => {
    const token = await mintToken({
      sub: 'user_01ABC',
      sid: 'session_01XYZ',
      expiresIn: '-1s',
    })

    await expect(provider.verifyAccessToken(token, 'studio')).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  test('rejects a token signed with an unknown key', async () => {
    const token = await mintToken({
      sub: 'user_01ABC',
      sid: 'session_01XYZ',
      signWith: otherPrivateKey,
    })

    await expect(provider.verifyAccessToken(token, 'studio')).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  test('rejects a token from an unexpected issuer', async () => {
    const token = await mintToken({
      sub: 'user_01ABC',
      sid: 'session_01XYZ',
      issuer: 'https://evil.example.com',
    })

    await expect(provider.verifyAccessToken(token, 'studio')).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  test('rejects a token without a subject', async () => {
    const token = await mintToken({ sid: 'session_01XYZ' })

    await expect(provider.verifyAccessToken(token, 'studio')).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  test('rejects a token without a session id', async () => {
    // sid is what makes revocation and audit possible. Without it the token is
    // unusable even if the person is real.
    const token = await mintToken({ sub: 'user_01ABC' })

    await expect(provider.verifyAccessToken(token, 'studio')).rejects.toMatchObject({
      code: 'invalid_token',
    })
  })

  test('rejects malformed input rather than throwing something unexpected', async () => {
    for (const garbage of ['', 'not-a-jwt', 'a.b.c', 'Bearer token']) {
      const error = await provider.verifyAccessToken(garbage, 'studio').catch((e) => e)
      expect(error).toBeInstanceOf(AuthError)
      expect(error.code).toBe('invalid_token')
    }
  })

  test('does not leak the token or its claims in the error', async () => {
    const token = await mintToken({
      sub: 'user_01SECRET',
      sid: 'session_01SECRET',
      expiresIn: '-1s',
    })

    const error = (await provider.verifyAccessToken(token, 'studio').catch((e) => e)) as AuthError

    const serialized = `${error.message} ${error.detail ?? ''}`
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain('user_01SECRET')
  })
})

describe('configuration', () => {
  test('refuses to construct without an API key', () => {
    expect(() =>
      createWorkOSAuthProvider({
        apiKey: '',
        clientIds: CLIENT_IDS,
      }),
    ).toThrow(/WORKOS_API_KEY/)
  })

  test('refuses to construct with a surface missing its client id', () => {
    expect(() =>
      createWorkOSAuthProvider({
        apiKey: 'sk_test',
        clientIds: { ...CLIENT_IDS, backoffice: '' },
      }),
    ).toThrow(/backoffice/)
  })
})
