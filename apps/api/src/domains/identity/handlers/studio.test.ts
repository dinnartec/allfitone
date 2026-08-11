import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import type { AuthProvider } from '@allfitone/auth-provider'

import { setAuthProvider } from '../../../platform/auth/index.js'
import { StudioSessionError, type StudioSessionService } from '../application/index.js'
import { studioIdentityRoutes } from './studio.js'

const AUTHORIZE_URL = 'https://api.workos.com/user_management/authorize?client_id=client_studio'
const LOGOUT_URL = 'https://api.workos.com/user_management/sessions/logout?session_id=sid'

function fakeProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    getAuthorizationUrl: () => AUTHORIZE_URL,
    getLogoutUrl: () => LOGOUT_URL,
    authenticateWithCode: async () => ({
      subject: 'user_01ABC',
      identity: { givenName: 'Ada', familyName: 'Lovelace' },
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
      identity: { givenName: 'Ada', familyName: 'Lovelace' },
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

function stateFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie') ?? ''
  return /allfit_oauth_state=([^;]+)/.exec(cookie)?.[1] ?? ''
}

beforeEach(() => {
  process.env.API_PUBLIC_URL = 'http://localhost:8080'
  process.env.STUDIO_WEB_URL = 'http://localhost:3000'
})

afterEach(() => setAuthProvider(undefined))

describe('GET /auth/start', () => {
  test('redirects to WorkOS with a 256-bit state cookie', async () => {
    const response = await app().request('/studio/v1/auth/start')
    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('location')).toBe(AUTHORIZE_URL)
    expect(Buffer.from(stateFrom(response), 'base64url')).toHaveLength(32)
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
  })
})

describe('GET /auth/callback', () => {
  test('creates an opaque session and redirects without leaking tokens', async () => {
    const instance = app()
    const state = stateFrom(await instance.request('/studio/v1/auth/start'))
    const response = await instance.request(`/studio/v1/auth/callback?code=secret&state=${state}`, {
      headers: { cookie: `allfit_oauth_state=${state}` },
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost:3000')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('allfit_studio_session=opaque-session')
    const sessionCookie = cookie
      .split(/,\s*/)
      .find((value) => value.startsWith('allfit_studio_session='))
    expect(sessionCookie?.toLowerCase()).toContain('httponly')
    expect(sessionCookie).toContain('Path=/studio/v1')
    expect(sessionCookie).not.toContain('Max-Age')
    expect(response.headers.get('location')).not.toContain('secret')
  })

  test('rejects missing or mismatched state and consumes the state cookie', async () => {
    const response = await app().request('/studio/v1/auth/callback?code=abc&state=attacker', {
      headers: { cookie: 'allfit_oauth_state=victim' },
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toContain('allfit_oauth_state=;')
  })

  test('rejects a missing state cookie as an expired flow', async () => {
    const response = await app().request('/studio/v1/auth/callback?code=abc&state=expired')
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
