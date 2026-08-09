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
import type { WorkOSUserManagement } from './workos-client.js'

const CLIENT_IDS: Record<Surface, string> = {
  space: 'client_space_test',
  studio: 'client_studio_test',
  backoffice: 'client_backoffice_test',
}

/** Each Application has its own key; distinct values keep that honest. */
const CREDENTIALS = {
  space: { clientId: CLIENT_IDS.space, apiKey: 'sk_space' },
  studio: { clientId: CLIENT_IDS.studio, apiKey: 'sk_studio' },
  backoffice: { clientId: CLIENT_IDS.backoffice, apiKey: 'sk_backoffice' },
}

/**
 * What the provider actually issues, confirmed against a real token.
 *
 * Note the client_id inside is NOT any of the three above: the provider builds
 * the issuer from the environment's default Application, so it cannot be derived
 * from the Application you authenticate against.
 */
const ISSUER = 'https://api.workos.com/user_management/client_01DEFAULTAPP'

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
    credentials: CREDENTIALS,
    issuer: ISSUER,
    // Test seam: a local key set instead of fetching the remote JWKS.
    jwks: { keys: [publicJwk] },
  })
})

/**
 * Asserts the call rejects with an AuthError and returns it.
 *
 * A bare `.catch(e => e)` would quietly pass a resolved promise through as
 * undefined, so a check that stopped rejecting would fail confusingly instead of
 * saying so.
 */
async function rejection(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AuthError) return error
    throw error
  }
  throw new Error('expected the call to reject, but it resolved')
}

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

    const error = await rejection(provider.verifyAccessToken(token, 'studio'))

    const serialized = `${error.message} ${error.detail ?? ''}`
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain('user_01SECRET')
  })
})

describe('configuration', () => {
  test('refuses to construct without an expected issuer', () => {
    // An unset issuer disables the check silently, which is worse than not
    // having it: the configuration looks complete.
    expect(() => createWorkOSAuthProvider({ issuer: '', credentials: CREDENTIALS })).toThrow(
      /issuer/i,
    )
  })

  test('refuses to construct when a surface has no API key of its own', () => {
    // Sharing one key across Applications fails the code exchange with
    // `invalid_client`, and only at the moment somebody tries to sign in.
    expect(() =>
      createWorkOSAuthProvider({
        issuer: ISSUER,
        credentials: { ...CREDENTIALS, backoffice: { clientId: 'c', apiKey: '' } },
      }),
    ).toThrow(/backoffice/)
  })

  test('refuses to construct with a surface missing its client id', () => {
    expect(() =>
      createWorkOSAuthProvider({
        issuer: ISSUER,
        credentials: { ...CREDENTIALS, backoffice: { clientId: '', apiKey: 'sk' } },
      }),
    ).toThrow(/backoffice/)
  })
})

/** Minimal fake of the SDK surface declared in workos-client.ts. */
function fakeClient(overrides: Partial<WorkOSUserManagement> = {}) {
  const calls: { method: string; args: unknown }[] = []
  const record = <T>(method: string, args: unknown, result: T): T => {
    calls.push({ method, args })
    return result
  }
  const authResponse = {
    accessToken: 'at_1',
    refreshToken: 'rt_1',
    user: { id: 'user_01FAKE' },
  }
  const userManagement: WorkOSUserManagement = {
    authenticateWithCode: async (o) => record('authenticateWithCode', o, authResponse),
    authenticateWithPassword: async (o) => record('authenticateWithPassword', o, authResponse),
    authenticateWithRefreshToken: async (o) =>
      record('authenticateWithRefreshToken', o, authResponse),
    createUser: async (o) => record('createUser', o, { id: 'user_01NEW' }),
    sendVerificationEmail: async (o) => record('sendVerificationEmail', o, {}),
    authenticateWithEmailVerification: async (o) =>
      record('authenticateWithEmailVerification', o, authResponse),
    updateUser: async (o) => record('updateUser', o, {}),
    listSessions: async (id) =>
      record('listSessions', id, { data: [{ id: 's_1' }, { id: 's_2' }] }),
    revokeSession: async (o) => record('revokeSession', o, undefined),
    getJwksUrl: (clientId) => `https://api.workos.com/sso/jwks/${clientId}`,
    getAuthorizationUrl: (o) => {
      // Mirrors the real SDK's precondition. A fake more permissive than the
      // thing it stands in for is a test that lies — this one did, until a real
      // request threw.
      if (!o.provider) throw new TypeError("Incomplete arguments. Need 'provider'.")
      return record(
        'getAuthorizationUrl',
        o,
        `https://api.workos.com/user_management/authorize?client_id=${o.clientId}`,
      )
    },
    getLogoutUrl: (o) =>
      record(
        'getLogoutUrl',
        o,
        `https://api.workos.com/user_management/sessions/logout?session_id=${o.sessionId}`,
      ),
    ...overrides,
  }
  return { client: { userManagement }, calls }
}

function providerWith(overrides: Partial<WorkOSUserManagement> = {}) {
  const { client, calls } = fakeClient(overrides)
  const provider = createWorkOSAuthProvider({
    credentials: CREDENTIALS,
    issuer: ISSUER,
    jwks: { keys: [publicJwk] },
    // One client per surface, mirroring production.
    clients: { space: client, studio: client, backoffice: client },
  })
  return { provider, calls }
}

describe('authenticateWithCode', () => {
  test('returns the subject and tokens, and uses the surface client_id', async () => {
    const { provider, calls } = providerWith()

    const result = await provider.authenticateWithCode('code_abc', 'studio')

    expect(result.subject).toBe('user_01FAKE')
    expect(result.tokens.accessToken).toBe('at_1')
    expect(result.tokens.refreshToken).toBe('rt_1')
    expect(calls[0]).toEqual({
      method: 'authenticateWithCode',
      args: { code: 'code_abc', clientId: CLIENT_IDS.studio },
    })
  })

  test('sends the backoffice client_id when called for backoffice', async () => {
    const { provider, calls } = providerWith()

    await provider.authenticateWithCode('code_abc', 'backoffice')

    expect(calls[0]?.args).toMatchObject({ clientId: CLIENT_IDS.backoffice })
  })
})

describe('revokeSessions', () => {
  test('revokes every session the person has, not just one', async () => {
    const { provider, calls } = providerWith()

    await provider.revokeSessions('user_01FAKE')

    expect(calls.map((c) => c.method)).toEqual(['listSessions', 'revokeSession', 'revokeSession'])
    expect(calls[1]?.args).toEqual({ sessionId: 's_1' })
    expect(calls[2]?.args).toEqual({ sessionId: 's_2' })
  })
})

describe('error translation', () => {
  const failWith = (error: unknown) => ({
    updateUser: async () => {
      throw error
    },
  })

  test('an email already in use is indistinguishable from a malformed one', async () => {
    // The provider does distinguish them. Letting that difference through would
    // reveal whether a person already has an account.
    const inUse = Object.assign(new Error('Email already in use'), { status: 422 })
    const malformed = Object.assign(new Error('email must be a valid email'), { status: 422 })

    const a = await rejection(providerWith(failWith(inUse)).provider.updateEmail('u', 'x@y.com'))
    const b = await rejection(providerWith(failWith(malformed)).provider.updateEmail('u', 'nope'))

    expect(a.code).toBe('invalid_email')
    expect(b.code).toBe(a.code)
    expect(a.message).toBe(b.message)
  })

  test('wrong credentials are not retryable', async () => {
    const unauthorized = Object.assign(new Error('Unauthorized'), { status: 401 })

    const error = await rejection(
      providerWith({
        authenticateWithPassword: async () => {
          throw unauthorized
        },
      }).provider.authenticateWithPassword({ email: 'a@b.com', password: 'x' }, 'space'),
    )

    expect(error.code).toBe('invalid_credentials')
    // Retrying a rejected credential is how an attacker gets free attempts.
    expect(error.retryable).toBe(false)
  })

  test('a provider outage is retryable', async () => {
    const outage = Object.assign(new Error('Bad Gateway'), { status: 502 })

    const error = await rejection(
      providerWith({
        authenticateWithCode: async () => {
          throw outage
        },
      }).provider.authenticateWithCode('c', 'studio'),
    )

    expect(error.code).toBe('provider_unavailable')
    expect(error.retryable).toBe(true)
  })

  test('refuses to reach the provider when no client was configured', async () => {
    const provider = createWorkOSAuthProvider({
      credentials: CREDENTIALS,
      issuer: ISSUER,
      jwks: { keys: [publicJwk] },
    })

    await expect(provider.authenticateWithCode('c', 'studio')).rejects.toThrow(
      /client not provided/,
    )
  })
})

describe('getAuthorizationUrl', () => {
  test('uses the client_id of the requested surface and passes state through', () => {
    const { provider, calls } = providerWith()

    const url = provider.getAuthorizationUrl({
      surface: 'studio',
      redirectUri: 'http://localhost:8080/studio/v1/auth/callback',
      state: 'state_abc',
    })

    expect(url).toContain(CLIENT_IDS.studio)
    expect(calls[0]?.args).toEqual({
      clientId: CLIENT_IDS.studio,
      redirectUri: 'http://localhost:8080/studio/v1/auth/callback',
      provider: 'authkit',
      state: 'state_abc',
    })
  })

  test('omits maxAge entirely when not requested, rather than sending undefined', () => {
    const { provider, calls } = providerWith()

    provider.getAuthorizationUrl({
      surface: 'backoffice',
      redirectUri: 'http://localhost:8080/backoffice/v1/auth/callback',
      state: 's',
    })

    expect(Object.keys(calls[0]?.args as object).sort()).toEqual([
      'clientId',
      'provider',
      'redirectUri',
      'state',
    ])
  })

  test('forwards maxAge when re-authentication is required', () => {
    const { provider, calls } = providerWith()

    provider.getAuthorizationUrl({
      surface: 'backoffice',
      redirectUri: 'http://localhost:8080/backoffice/v1/auth/callback',
      state: 's',
      maxAgeSeconds: 300,
    })

    expect(calls[0]?.args).toMatchObject({ maxAge: 300 })
  })
})

describe('getLogoutUrl', () => {
  test('delegates hosted logout by session id without exposing the SDK', () => {
    const { provider, calls } = providerWith()

    const url = provider.getLogoutUrl({
      sessionId: 'session_01XYZ',
      returnTo: 'https://studio.allfit.one',
    })

    expect(url).toContain('session_01XYZ')
    expect(calls[0]).toEqual({
      method: 'getLogoutUrl',
      args: { sessionId: 'session_01XYZ', returnTo: 'https://studio.allfit.one' },
    })
  })
})

describe('register', () => {
  test('creates the credential and sends the code', async () => {
    const { provider, calls } = providerWith()

    const outcome = await provider.register({ email: 'a@b.co', password: 'a-long-password' })

    expect(outcome.created).toBe(true)
    expect(calls.map((c) => c.method)).toEqual(['createUser', 'sendVerificationEmail'])
    expect(calls[1].args).toEqual({ userId: 'user_01NEW' })
  })

  test('an address already in use is not an error', async () => {
    // The whole point of HU-SP-001 criterion 3. The provider rejects the second
    // registration; the port must not let that rejection reach the caller,
    // because a caller with something to catch has something to disclose.
    const { provider } = providerWith({
      createUser: async () => {
        throw Object.assign(new Error('email already in use'), { status: 422 })
      },
    })

    const outcome = await provider.register({ email: 'a@b.co', password: 'a-long-password' })

    expect(outcome.created).toBe(false)
  })

  test('a taken address and a fresh one are indistinguishable to a caller that ignores `created`', async () => {
    // Written this way on purpose: it asserts the property the endpoint above
    // relies on, rather than the branch this adapter happens to take.
    const fresh = providerWith()
    const taken = providerWith({
      createUser: async () => {
        throw Object.assign(new Error('email already in use'), { status: 422 })
      },
    })

    const results = await Promise.all([
      fresh.provider.register({ email: 'new@b.co', password: 'a-long-password' }).then(
        () => 'resolved',
        () => 'rejected',
      ),
      taken.provider.register({ email: 'old@b.co', password: 'a-long-password' }).then(
        () => 'resolved',
        () => 'rejected',
      ),
    ])

    expect(results[0]).toBe(results[1])
  })

  test('a provider outage still fails, because retrying is the right answer', async () => {
    const { provider } = providerWith({
      createUser: async () => {
        throw Object.assign(new Error('gateway'), { status: 503 })
      },
    })

    await expect(
      provider.register({ email: 'a@b.co', password: 'a-long-password' }),
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true })
  })

  test('a credential created but uncontactable fails rather than stranding the person', async () => {
    const { provider } = providerWith({
      sendVerificationEmail: async () => {
        throw Object.assign(new Error('gateway'), { status: 503 })
      },
    })

    await expect(
      provider.register({ email: 'a@b.co', password: 'a-long-password' }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

describe('verifyEmail', () => {
  const CREDS = { email: 'a@b.co', password: 'a-long-password' }

  /** The provider's rejection that carries the pending token. */
  const pendingVerification = () =>
    Object.assign(new Error('email verification required'), {
      code: 'email_verification_required',
      pendingAuthenticationToken: 'pat_1',
    })

  test('redeems the code for a session using the pending token', async () => {
    const { provider, calls } = providerWith({
      authenticateWithPassword: async () => {
        throw pendingVerification()
      },
    })

    const result = await provider.verifyEmail(CREDS, '481920', 'space')

    expect(result.subject).toBe('user_01FAKE')
    expect(result.tokens.accessToken).toBe('at_1')
    expect(calls.at(-1)).toMatchObject({
      method: 'authenticateWithEmailVerification',
      args: { code: '481920', pendingAuthenticationToken: 'pat_1' },
    })
  })

  test('refuses an already-verified address instead of authenticating it', async () => {
    // Sign-in succeeds here, which means no verification is pending. Returning
    // the session would make this a second way to authenticate that never
    // touches the emailed code.
    const { provider } = providerWith()

    await expect(provider.verifyEmail(CREDS, '481920', 'space')).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  test('a wrong code is rejected as bad credentials', async () => {
    const { provider } = providerWith({
      authenticateWithPassword: async () => {
        throw pendingVerification()
      },
      authenticateWithEmailVerification: async () => {
        throw Object.assign(new Error('invalid code'), { status: 401 })
      },
    })

    await expect(provider.verifyEmail(CREDS, '000000', 'space')).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  test('a wrong password and a wrong code are the same rejection', async () => {
    const wrongPassword = providerWith({
      authenticateWithPassword: async () => {
        throw Object.assign(new Error('invalid credentials'), { status: 401 })
      },
    })
    const wrongCode = providerWith({
      authenticateWithPassword: async () => {
        throw pendingVerification()
      },
      authenticateWithEmailVerification: async () => {
        throw Object.assign(new Error('invalid code'), { status: 401 })
      },
    })

    const [a, b] = await Promise.all([
      wrongPassword.provider.verifyEmail(CREDS, '481920', 'space').catch((e) => e.code),
      wrongCode.provider.verifyEmail(CREDS, '000000', 'space').catch((e) => e.code),
    ])

    expect(a).toBe(b)
  })

  test('uses the surface client id, so a Space code cannot mint a Studio session', async () => {
    const { provider, calls } = providerWith({
      authenticateWithPassword: async () => {
        throw pendingVerification()
      },
    })

    await provider.verifyEmail(CREDS, '481920', 'space')

    expect(calls.at(-1)?.args).toMatchObject({ clientId: CREDENTIALS.space.clientId })
  })
})
