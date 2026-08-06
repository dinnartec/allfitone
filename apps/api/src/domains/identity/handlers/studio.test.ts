/**
 * Hosted-flow round trip.
 *
 * The state checks are CSRF protection, so they are written as denials and each
 * was observed passing — the callback accepting a forged request — before the
 * check existed.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { AuthError, type AuthProvider } from '@allfitone/auth-provider'

import { setAuthProvider } from '../../../platform/auth/index.js'
import { studioIdentityRoutes } from './studio.js'

const AUTHORIZE_URL = 'https://api.workos.com/user_management/authorize?client_id=client_studio'

function fakeProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    getAuthorizationUrl: () => AUTHORIZE_URL,
    authenticateWithCode: async () => ({
      subject: 'user_01ABC',
      tokens: { accessToken: 'at', refreshToken: 'rt', expiresIn: 300 },
    }),
    verifyAccessToken: async () => ({
      subject: 'user_01ABC',
      sessionId: 'session_01XYZ',
      surface: 'studio' as const,
    }),
    authenticateWithPassword: async () => {
      throw new Error('not used')
    },
    refresh: async () => {
      throw new Error('not used')
    },
    updateEmail: async () => undefined,
    revokeSessions: async () => undefined,
    ...overrides,
  }
}

function app(provider: AuthProvider = fakeProvider()) {
  setAuthProvider(provider)
  const instance = new Hono()
  instance.route('/studio/v1', studioIdentityRoutes())
  return instance
}

/** Reads the state the server just issued, the way a browser would. */
function stateFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie') ?? ''
  return /allfit_oauth_state=([^;]+)/.exec(cookie)?.[1] ?? ''
}

beforeEach(() => {
  process.env.API_PUBLIC_URL = 'http://localhost:8080'
})

afterEach(() => {
  setAuthProvider(undefined)
})

describe('GET /auth/start', () => {
  test('redirects to the provider and issues a state cookie', async () => {
    const response = await app().request('/studio/v1/auth/start')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(AUTHORIZE_URL)
    expect(stateFrom(response)).not.toBe('')
  })

  test('the state cookie is not readable by scripts', async () => {
    const cookie = (await app().request('/studio/v1/auth/start')).headers.get('set-cookie') ?? ''

    expect(cookie.toLowerCase()).toContain('httponly')
    // Strict would withhold the cookie on the navigation back from the provider.
    expect(cookie).toContain('SameSite=Lax')
  })

  test('issues a different state on every attempt', async () => {
    const instance = app()
    const first = stateFrom(await instance.request('/studio/v1/auth/start'))
    const second = stateFrom(await instance.request('/studio/v1/auth/start'))

    expect(first).not.toBe(second)
  })

  test('refuses to assemble without the base URL, rather than failing per request', () => {
    delete process.env.API_PUBLIC_URL

    // Deriving it from the Host header instead would let a caller choose where
    // the provider sends the person back. Failing at assembly means a bad
    // deploy stops on boot instead of 500ing on the first sign-in.
    expect(() => studioIdentityRoutes()).toThrow(/API_PUBLIC_URL/)
  })
})

describe('GET /auth/callback', () => {
  const callback = (query: string, cookie?: string) =>
    app().request(`/studio/v1/auth/callback${query}`, {
      headers: cookie ? { cookie } : {},
    })

  test('completes and reports what it verified', async () => {
    const instance = app()
    const state = stateFrom(await instance.request('/studio/v1/auth/start'))

    const response = await instance.request(`/studio/v1/auth/callback?code=abc&state=${state}`, {
      headers: { cookie: `allfit_oauth_state=${state}` },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      subjectFromExchange: 'user_01ABC',
      verified: { subject: 'user_01ABC', sessionId: 'session_01XYZ', surface: 'studio' },
    })
  })

  test('reports the token issuer, which is the point of the skeleton', async () => {
    // Temporary: WORKOS_ISSUER cannot be set until a real token states the
    // value. This field is how the first real login answers that.
    const payload = Buffer.from(
      JSON.stringify({ iss: 'https://issuer.example', sub: 'u', sid: 's' }),
    ).toString('base64url')
    const instance = app(
      fakeProvider({
        authenticateWithCode: async () => ({
          subject: 'user_01ABC',
          tokens: { accessToken: `h.${payload}.sig`, refreshToken: 'rt', expiresIn: 300 },
        }),
      }),
    )
    const state = stateFrom(await instance.request('/studio/v1/auth/start'))

    const response = await instance.request(`/studio/v1/auth/callback?code=abc&state=${state}`, {
      headers: { cookie: `allfit_oauth_state=${state}` },
    })

    await expect(response.json()).resolves.toMatchObject({
      diagnostic: { tokenIssuer: 'https://issuer.example' },
    })
  })

  test('rejects a state that does not match the cookie', async () => {
    // The forgery this prevents: an attacker hands the victim a callback URL
    // carrying the attacker's code, landing the victim in the attacker's session.
    const response = await callback('?code=abc&state=attacker', 'allfit_oauth_state=victim')

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid-request' } })
  })

  test('rejects a callback with no state cookie at all', async () => {
    const response = await callback('?code=abc&state=whatever')

    expect(response.status).toBe(400)
  })

  test('rejects a callback carrying neither a state parameter nor a cookie', async () => {
    // Both absent is the dangerous case: a comparison alone would see
    // undefined === undefined and wave it through. Only an explicit presence
    // check closes it.
    const response = await callback('?code=abc')

    expect(response.status).toBe(400)
  })

  test('rejects a callback with no code', async () => {
    const response = await callback('?state=s', 'allfit_oauth_state=s')

    expect(response.status).toBe(400)
  })

  test('consumes the state even when the exchange fails, so it cannot be replayed', async () => {
    const response = await callback('?code=abc&state=x', 'allfit_oauth_state=y')

    expect(response.headers.get('set-cookie') ?? '').toContain('allfit_oauth_state=;')
  })

  test('reports an unreachable provider as retryable, not as a bad login', async () => {
    const instance = app(
      fakeProvider({
        authenticateWithCode: async () => {
          throw new AuthError('provider_unavailable')
        },
      }),
    )
    const state = stateFrom(await instance.request('/studio/v1/auth/start'))

    const response = await instance.request(`/studio/v1/auth/callback?code=abc&state=${state}`, {
      headers: { cookie: `allfit_oauth_state=${state}` },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'upstream-unavailable' },
    })
  })

  test('rejects a token that fails verification even though the exchange succeeded', async () => {
    const instance = app(
      fakeProvider({
        verifyAccessToken: async () => {
          throw new AuthError('invalid_token')
        },
      }),
    )
    const state = stateFrom(await instance.request('/studio/v1/auth/start'))

    const response = await instance.request(`/studio/v1/auth/callback?code=abc&state=${state}`, {
      headers: { cookie: `allfit_oauth_state=${state}` },
    })

    expect(response.status).toBe(401)
  })
})
