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
import type { WorkOSEvent, WorkOSUserManagement, WorkOSWebhooks } from './workos-client.js'

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
const WEBHOOK_SECRET = 'whsec_test'

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
    webhookSecret: WEBHOOK_SECRET,
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
    expect(() =>
      createWorkOSAuthProvider({
        issuer: '',
        webhookSecret: WEBHOOK_SECRET,
        credentials: CREDENTIALS,
      }),
    ).toThrow(/issuer/i)
  })

  test('refuses to construct when a surface has no API key of its own', () => {
    // Sharing one key across Applications fails the code exchange with
    // `invalid_client`, and only at the moment somebody tries to sign in.
    expect(() =>
      createWorkOSAuthProvider({
        issuer: ISSUER,
        webhookSecret: WEBHOOK_SECRET,
        credentials: { ...CREDENTIALS, backoffice: { clientId: 'c', apiKey: '' } },
      }),
    ).toThrow(/backoffice/)
  })

  test('refuses to construct with a surface missing its client id', () => {
    expect(() =>
      createWorkOSAuthProvider({
        issuer: ISSUER,
        webhookSecret: WEBHOOK_SECRET,
        credentials: { ...CREDENTIALS, backoffice: { clientId: '', apiKey: 'sk' } },
      }),
    ).toThrow(/backoffice/)
  })
})

/** Minimal fake of the SDK surface declared in workos-client.ts. */
function fakeClient(
  overrides: Partial<WorkOSUserManagement> = {},
  webhookOverrides: Partial<WorkOSWebhooks> = {},
) {
  const calls: { method: string; args: unknown }[] = []
  const record = <T>(method: string, args: unknown, result: T): T => {
    calls.push({ method, args })
    return result
  }
  const authResponse = {
    accessToken: 'at_1',
    refreshToken: 'rt_1',
    user: { id: 'user_01FAKE', firstName: 'Ada', lastName: 'Lovelace' },
  }
  const userManagement: WorkOSUserManagement = {
    authenticateWithCode: async (o) => record('authenticateWithCode', o, authResponse),
    authenticateWithPassword: async (o) => record('authenticateWithPassword', o, authResponse),
    authenticateWithRefreshToken: async (o) =>
      record('authenticateWithRefreshToken', o, authResponse),
    createUser: async (o) => record('createUser', o, { id: 'user_01NEW' }),
    listUsers: async (o) =>
      record('listUsers', o, { data: [{ id: 'user_01FAKE', emailVerified: false }] }),
    sendVerificationEmail: async (o) => record('sendVerificationEmail', o, {}),
    verifyEmail: async (o) => record('verifyEmail', o, {}),
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
  const webhooks: WorkOSWebhooks = {
    constructEvent: async (options) => {
      calls.push({ method: 'constructEvent', args: options })
      return webhookOverrides.constructEvent
        ? webhookOverrides.constructEvent(options)
        : {
            id: 'event_ignored',
            createdAt: '2026-08-10T12:00:00.000Z',
            event: 'user.updated',
            data: {},
          }
    },
  }
  return { client: { userManagement, webhooks }, calls }
}

function providerWith(
  overrides: Partial<WorkOSUserManagement> = {},
  webhookOverrides: Partial<WorkOSWebhooks> = {},
) {
  const { client, calls } = fakeClient(overrides, webhookOverrides)
  const provider = createWorkOSAuthProvider({
    credentials: CREDENTIALS,
    issuer: ISSUER,
    webhookSecret: WEBHOOK_SECRET,
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
    expect(result.identity).toEqual({ givenName: 'Ada', familyName: 'Lovelace' })
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
      webhookSecret: WEBHOOK_SECRET,
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

describe('verifyWebhookEvent', () => {
  const resetEvent: WorkOSEvent = {
    id: 'event_01RESET',
    createdAt: '2026-08-10T12:00:00.000Z',
    event: 'password_reset.succeeded',
    data: {
      object: 'password_reset',
      id: 'password_reset_secret',
      userId: 'user_01FAKE',
      email: 'private@example.com',
      createdAt: '2026-08-10T11:55:00.000Z',
      expiresAt: '2026-08-10T12:55:00.000Z',
    },
  }

  test('verifies the untouched payload with an explicit five-minute tolerance', async () => {
    const { provider, calls } = providerWith({}, { constructEvent: async () => resetEvent })

    await provider.verifyWebhookEvent('{ "raw": true }', 't=1,v1=signed')

    expect(calls[0]).toEqual({
      method: 'constructEvent',
      args: {
        payload: '{ "raw": true }',
        sigHeader: 't=1,v1=signed',
        secret: WEBHOOK_SECRET,
        tolerance: 300_000,
      },
    })
  })

  test('projects no email, reset id or provider context', async () => {
    const { provider } = providerWith({}, { constructEvent: async () => resetEvent })

    const event = await provider.verifyWebhookEvent('payload', 'signature')

    expect(event).toEqual({
      kind: 'password-reset-succeeded',
      eventId: 'event_01RESET',
      subject: 'user_01FAKE',
      occurredAt: '2026-08-10T12:00:00.000Z',
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('private@example.com')
    expect(serialized).not.toContain('password_reset_secret')
    expect(Object.keys(event ?? {}).sort()).toEqual(['eventId', 'kind', 'occurredAt', 'subject'])
  })

  test('returns null for a signed event that Identity does not consume', async () => {
    const { provider } = providerWith()

    await expect(provider.verifyWebhookEvent('payload', 'signature')).resolves.toBeNull()
  })

  test('fails closed without copying signature or payload into the error', async () => {
    const { provider } = providerWith(
      {},
      {
        constructEvent: async () => {
          throw new Error('bad t=secret signature containing private@example.com')
        },
      },
    )

    const error = await rejection(provider.verifyWebhookEvent('private@example.com', 't=secret'))

    expect(error.code).toBe('invalid_webhook')
    expect(`${error.message} ${error.detail ?? ''}`).not.toContain('private@example.com')
    expect(`${error.message} ${error.detail ?? ''}`).not.toContain('t=secret')
  })
})

/**
 * The provider's actual rejection for a duplicate address, captured from the
 * live API rather than imagined.
 *
 * It is a plain 400 whose message says only "Could not create user." — the
 * reason is nested. An earlier version of this test invented a 422 with the word
 * "email" in the message, which the adapter happened to classify correctly, so
 * the test passed while the real thing answered 401. A double more convenient
 * than the system it stands in for is a test that lies.
 */
function throwEmailNotAvailable(): never {
  throw Object.assign(new Error('Could not create user.'), {
    status: 400,
    code: 'user_creation_error',
    errors: [{ code: 'email_not_available', message: 'This email is not available.' }],
  })
}

describe('register', () => {
  test('creates the credential and sends the code', async () => {
    const { provider, calls } = providerWith()

    const outcome = await provider.register({ email: 'a@b.co', password: 'a-long-password' })

    expect(outcome.created).toBe(true)
    // Creating a user opens a verification but does not email it; the send is
    // what dispatches a code.
    expect(calls.map((c) => c.method)).toEqual(['createUser', 'sendVerificationEmail'])
    expect(calls.at(1)?.args).toEqual({ userId: 'user_01NEW' })
  })

  test('an address already in use is not an error', async () => {
    // The whole point of HU-SP-001 criterion 3. The provider rejects the second
    // registration; the port must not let that rejection reach the caller,
    // because a caller with something to catch has something to disclose.
    const { provider } = providerWith({ createUser: async () => throwEmailNotAvailable() })

    const outcome = await provider.register({ email: 'a@b.co', password: 'a-long-password' })

    expect(outcome.created).toBe(false)
  })

  test('a taken but unverified address gets its code sent again', async () => {
    // What the resend button relies on. Returning early here is why pressing it
    // appeared to work and delivered nothing.
    const { provider, calls } = providerWith({ createUser: async () => throwEmailNotAvailable() })

    const outcome = await provider.register({ email: 'a@b.co', password: 'a-long-password' })

    expect(outcome.resent).toBe(true)
    expect(calls.map((c) => c.method)).toContain('sendVerificationEmail')
  })

  test('a verified address is not mailed again', async () => {
    // There is no code to resend, and sending one would be a way to pester
    // somebody who already finished.
    const { provider, calls } = providerWith({
      createUser: async () => throwEmailNotAvailable(),
      listUsers: async () => ({ data: [{ id: 'user_01FAKE', emailVerified: true }] }),
    })

    const outcome = await provider.register({ email: 'a@b.co', password: 'a-long-password' })

    expect(outcome.resent).toBe(false)
    expect(calls.map((c) => c.method)).not.toContain('sendVerificationEmail')
  })

  test('a taken address and a fresh one are indistinguishable to a caller that ignores `created`', async () => {
    // Written this way on purpose: it asserts the property the endpoint above
    // relies on, rather than the branch this adapter happens to take.
    const fresh = providerWith()
    const taken = providerWith({ createUser: async () => throwEmailNotAvailable() })

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

  test("a refused API key is our fault, not the person's", async () => {
    // These calls carry no person credentials, so a 401 can only mean our key
    // was rejected. Reporting it as bad credentials tells someone to check an
    // email and password that were never the problem — which is exactly what
    // happened when a key silently stopped working.
    const { provider } = providerWith({
      createUser: async () => {
        throw Object.assign(new Error('Could not authorize the request.'), { status: 401 })
      },
    })

    await expect(
      provider.register({ email: 'a@b.co', password: 'a-long-password' }),
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true })
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
})

describe('verifyEmail', () => {
  const CREDS = { email: 'a@b.co', password: 'a-long-password' }

  test('marks the address verified, then signs in', async () => {
    const { provider, calls } = providerWith()

    const result = await provider.verifyEmail(CREDS, '481920', 'space')

    expect(result.subject).toBe('user_01FAKE')
    expect(calls.map((c) => c.method)).toEqual([
      'listUsers',
      'verifyEmail',
      'authenticateWithPassword',
    ])
  })

  test('never mints a pending token, which emailing the code would invalidate', async () => {
    // The regression this guards shipped twice. The single call that redeems a
    // code and returns a session needs a token that `sendVerificationEmail`
    // invalidates, so the two cannot both happen.
    const { provider, calls } = providerWith()

    await provider.verifyEmail(CREDS, '481920', 'space')

    expect(calls.map((c) => c.method)).not.toContain('authenticateWithEmailVerification')
  })

  test('an unknown address is rejected exactly like a wrong code', async () => {
    const unknown = providerWith({ listUsers: async () => ({ data: [] }) })
    const wrongCode = providerWith({
      // The provider's actual rejection, captured from the live API. Note the
      // word "email" in both the code and the message: read loosely, a mistyped
      // code looks like a bad address.
      verifyEmail: async () => {
        throw Object.assign(new Error('Email verification code is incorrect.'), {
          status: 400,
          code: 'email_verification_code_incorrect',
        })
      },
    })

    const [a, b] = await Promise.all([
      unknown.provider.verifyEmail(CREDS, '481920', 'space').catch((e) => e.code),
      wrongCode.provider.verifyEmail(CREDS, '000000', 'space').catch((e) => e.code),
    ])

    expect(a).toBe('invalid_credentials')
    expect(a).toBe(b)
  })

  test('uses the surface client id, so a Space code cannot mint a Studio session', async () => {
    const { provider, calls } = providerWith()

    await provider.verifyEmail(CREDS, '481920', 'space')

    expect(calls.at(-1)?.args).toMatchObject({ clientId: CREDENTIALS.space.clientId })
  })
})
