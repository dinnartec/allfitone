import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import type { AuthProvider } from '@allfitone/auth-provider'

import { setAuthProvider } from '../../../platform/auth/index.js'
import { StudioSessionError, type StudioSessionService } from '../application/index.js'
import { studioIdentityRoutes } from './studio.js'

const AUTHORIZE_URL = 'https://api.workos.com/user_management/authorize?client_id=client_studio'
const LOGOUT_URL = 'https://api.workos.com/user_management/sessions/logout?session_id=sid'
const LEGACY_STATE_COOKIE = 'allfit_oauth_state'
const STATE_COOKIE_PREFIX = `${LEGACY_STATE_COOKIE}_`

function fakeProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    getAuthorizationUrl: () => AUTHORIZE_URL,
    getLogoutUrl: () => LOGOUT_URL,
    authenticateWithCode: async () => ({
      subject: 'user_01ABC',
      identity: { givenName: 'Ada', familyName: 'Lovelace', verifiedEmail: 'ada@example.test' },
      tokens: { accessToken: 'at', refreshToken: 'rt', expiresIn: 300 },
    }),
    verifyAccessToken: async () => ({
      subject: 'user_01ABC',
      sessionId: 'session_01XYZ',
      surface: 'studio',
    }),
    verifyWebhookEvent: async () => null,
    authenticateWithPassword: async () => {
      throw new Error('not used')
    },
    refresh: async () => {
      throw new Error('not used')
    },
    register: async () => {
      throw new Error('not used')
    },
    verifyEmail: async () => {
      throw new Error('not used')
    },
    updateEmail: async () => undefined,
    enrollTotp: async () => {
      throw new Error('not used')
    },
    challengeTotp: async () => {
      throw new Error('not used')
    },
    verifyTotp: async () => {
      throw new Error('not used')
    },
    deleteAuthenticationFactor: async () => undefined,
    requestPasswordReset: async () => undefined,
    revokeSession: async () => undefined,
    revokeSessions: async () => undefined,
    ...overrides,
  }
}

function fakeSessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque-session' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    }),
    resolveActor: async () => ({ accountId: 'account_1', personId: 'person_1' }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: 'account_1', personId: 'person_1' },
      identity: { givenName: 'Ada', familyName: 'Lovelace', verifiedEmail: 'ada@example.test' },
    }),
    logout: async () => ({ redirectUrl: LOGOUT_URL, outcome: 'revoked' }),
    ...overrides,
  }
}

function app(
  provider: AuthProvider = fakeProvider(),
  sessions: StudioSessionService = fakeSessions(),
) {
  setAuthProvider(provider)
  const instance = new Hono()
  instance.route('/studio/v1', studioIdentityRoutes(sessions))
  return instance
}

function stateCookieFrom(response: Response): { name: string; state: string; value: string } {
  const cookie = response.headers.get('set-cookie') ?? ''
  const match = new RegExp(`(${STATE_COOKIE_PREFIX}([A-Za-z0-9_-]{43}))=([^;]+)`).exec(cookie)
  return {
    name: match?.[1] ?? '',
    state: match?.[2] ?? '',
    value: match?.[3] ?? '',
  }
}

beforeEach(() => {
  process.env.API_PUBLIC_URL = 'http://localhost:8080'
  process.env.STUDIO_WEB_URL = 'http://localhost:3000'
})

afterEach(() => setAuthProvider(undefined))

describe('GET /auth/start', () => {
  test('redirects to WorkOS with a 256-bit state cookie', async () => {
    const response = await app().request('/studio/v1/auth/start')
    const cookie = stateCookieFrom(response)
    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('location')).toBe(AUTHORIZE_URL)
    expect(Buffer.from(cookie.state, 'base64url')).toHaveLength(32)
    expect(cookie.value).toBe(cookie.state)
  })

  test('protects and scopes the state cookie', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const cookie = (await app().request('/studio/v1/auth/start')).headers.get('set-cookie') ?? ''
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/studio/v1/auth')
    expect(cookie).toContain('Max-Age=600')
  })
})

describe('GET /auth/callback', () => {
  test('creates an opaque session and redirects without leaking tokens', async () => {
    const instance = app()
    const stateCookie = stateCookieFrom(await instance.request('/studio/v1/auth/start'))
    const response = await instance.request(
      `/studio/v1/auth/callback?code=secret&state=${stateCookie.state}`,
      {
        headers: { cookie: `${stateCookie.name}=${stateCookie.value}` },
      },
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost:3000')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${stateCookie.name}=;`)
    expect(cookie).toContain('allfit_studio_session=opaque-session')
    const sessionCookie = cookie
      .split(/,\s*/)
      .find((value) => value.startsWith('allfit_studio_session='))
    expect(sessionCookie?.toLowerCase()).toContain('httponly')
    expect(sessionCookie).toContain('Path=/studio/v1')
    expect(sessionCookie).not.toContain('Max-Age')
    expect(response.headers.get('location')).not.toContain('secret')
  })

  test('completes concurrent browser flows independently in either callback order', async () => {
    const instance = app()
    const first = stateCookieFrom(await instance.request('/studio/v1/auth/start'))
    const second = stateCookieFrom(await instance.request('/studio/v1/auth/start'))
    const browserCookies = `${first.name}=${first.value}; ${second.name}=${second.value}`

    expect(first.name).not.toBe(second.name)

    const secondCallback = await instance.request(
      `/studio/v1/auth/callback?code=second&state=${second.state}`,
      { headers: { cookie: browserCookies } },
    )
    expect(secondCallback.status).toBe(303)
    expect(secondCallback.headers.get('set-cookie')).toContain(`${second.name}=;`)
    expect(secondCallback.headers.get('set-cookie')).not.toContain(`${first.name}=;`)

    const firstCallback = await instance.request(
      `/studio/v1/auth/callback?code=first&state=${first.state}`,
      { headers: { cookie: `${first.name}=${first.value}` } },
    )
    expect(firstCallback.status).toBe(303)
    expect(firstCallback.headers.get('set-cookie')).toContain(`${first.name}=;`)
  })

  test('rejects an unknown state without consuming another active flow', async () => {
    const instance = app()
    const active = stateCookieFrom(await instance.request('/studio/v1/auth/start'))
    const unknown = active.state === 'A'.repeat(43) ? 'B'.repeat(43) : 'A'.repeat(43)
    const response = await instance.request(`/studio/v1/auth/callback?code=abc&state=${unknown}`, {
      headers: { cookie: `${active.name}=${active.value}` },
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie') ?? '').not.toContain(`${active.name}=;`)
  })

  test('rejects malformed and replayed states without consuming active flows', async () => {
    const instance = app()
    const active = stateCookieFrom(await instance.request('/studio/v1/auth/start'))
    const malformed = await instance.request('/studio/v1/auth/callback?code=abc&state=not-base64', {
      headers: { cookie: `${active.name}=${active.value}` },
    })
    expect(malformed.status).toBe(400)
    expect(malformed.headers.get('set-cookie') ?? '').not.toContain(`${active.name}=;`)

    const valid = await instance.request(
      `/studio/v1/auth/callback?code=abc&state=${active.state}`,
      {
        headers: { cookie: `${active.name}=${active.value}` },
      },
    )
    expect(valid.status).toBe(303)

    const replay = await instance.request(`/studio/v1/auth/callback?code=abc&state=${active.state}`)
    expect(replay.status).toBe(400)
  })

  test('accepts and consumes the legacy state cookie during rollout', async () => {
    const state = 'B'.repeat(43)
    const response = await app().request(`/studio/v1/auth/callback?code=abc&state=${state}`, {
      headers: { cookie: `${LEGACY_STATE_COOKIE}=${state}` },
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('set-cookie')).toContain(`${LEGACY_STATE_COOKIE}=;`)
  })

  test('rejects a missing state cookie as an expired flow', async () => {
    const response = await app().request(
      `/studio/v1/auth/callback?code=abc&state=${'C'.repeat(43)}`,
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid-request', detail: 'missing or expired state cookie' },
    })
  })
})

describe('GET /session', () => {
  test('returns the registration status without exposing identifiers', async () => {
    const response = await app().request('/studio/v1/session', {
      headers: { cookie: 'allfit_studio_session=opaque-session' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    })
  })

  test('preserves a session when WorkOS is transiently unavailable', async () => {
    const response = await app(
      fakeProvider(),
      fakeSessions({
        readSession: async () => {
          throw new StudioSessionError('upstream-unavailable')
        },
      }),
    ).request('/studio/v1/session', {
      headers: { cookie: 'allfit_studio_session=opaque-session' },
    })
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('clears a terminally invalid session', async () => {
    const response = await app(
      fakeProvider(),
      fakeSessions({
        readSession: async () => {
          throw new StudioSessionError('unauthenticated')
        },
      }),
    ).request('/studio/v1/session', {
      headers: { cookie: 'allfit_studio_session=opaque-session' },
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('allfit_studio_session=;')
  })
})

describe('POST /auth/logout', () => {
  test('requires the exact Studio origin', async () => {
    let logoutCalls = 0
    const response = await app(
      fakeProvider(),
      fakeSessions({
        logout: async () => {
          logoutCalls += 1
          return { redirectUrl: LOGOUT_URL, outcome: 'revoked' }
        },
      }),
    ).request('/studio/v1/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://attacker.test' },
    })
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(logoutCalls).toBe(0)
  })

  test('revokes locally, clears the cookie and redirects to hosted logout', async () => {
    const response = await app().request('/studio/v1/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        cookie: 'allfit_studio_session=opaque-session',
      },
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(LOGOUT_URL)
    expect(response.headers.get('set-cookie')).toContain('allfit_studio_session=;')
  })

  test('defaults the metric trigger to manual and accepts inactivity form posts', async () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)
    const response = await app().request('/studio/v1/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: 'allfit_studio_session=opaque-session',
      },
      body: 'reason=inactivity',
    })

    expect(response.status).toBe(303)
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[0]))).toEqual({
      kind: 'counter',
      name: 'studio.auth.logout',
      value: 1,
      dimensions: { trigger: 'inactivity', outcome: 'revoked' },
    })
    info.mockRestore()
  })

  test('records an explicit recovery logout without exposing session details', async () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined)
    const response = await app().request('/studio/v1/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: 'allfit_studio_session=opaque-session',
      },
      body: 'reason=recovery',
    })

    expect(response.status).toBe(303)
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[0]))).toEqual({
      kind: 'counter',
      name: 'studio.auth.logout',
      value: 1,
      dimensions: { trigger: 'recovery', outcome: 'revoked' },
    })
    info.mockRestore()
  })

  test('clears the cookie and returns to a partial notice when logout fails', async () => {
    const response = await app(
      fakeProvider(),
      fakeSessions({
        logout: async () => {
          throw new Error('database unavailable')
        },
      }),
    ).request('/studio/v1/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        cookie: 'allfit_studio_session=opaque-session',
      },
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost:3000/?logout=partial')
    expect(response.headers.get('set-cookie')).toContain('allfit_studio_session=;')
  })

  test('treats a missing session as an idempotent logout', async () => {
    const response = await app(
      fakeProvider(),
      fakeSessions({
        logout: async () => ({
          redirectUrl: 'http://localhost:3000',
          outcome: 'already-absent',
        }),
      }),
    ).request('/studio/v1/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost:3000')
    expect(response.headers.get('set-cookie')).toContain('allfit_studio_session=;')
  })
})

describe('Studio CORS', () => {
  test('allows credentials only for the exact Studio origin and varies by Origin', async () => {
    const allowed = await app().request('/studio/v1/session', {
      headers: { origin: 'http://localhost:3000' },
    })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true')
    expect(allowed.headers.get('vary')).toBe('Origin')

    const denied = await app().request('/studio/v1/session', {
      headers: { origin: 'https://attacker.test' },
    })
    expect(denied.headers.get('access-control-allow-origin')).not.toBe('https://attacker.test')
  })
})
