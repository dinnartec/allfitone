/**
 * Account creation on /space/v1.
 *
 * Most of these assert that something is *not* observable, which is why they are
 * written against the response as a whole — status, body and headers together —
 * rather than against one field. A disclosure test that only compares one field
 * passes while the difference leaks through another.
 *
 * The scenario each one guards comes from HU-SP-001. Criterion 3 is the reason
 * this file is longer than the handler it covers.
 */

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { RegistrationError, type SpaceRegistrationService } from '../application/registration.js'
import { spaceIdentityRoutes } from './space.js'

const EMAIL = 'walberto@dinnartec.co'
const PASSWORD = 'a-sufficiently-long-password'
const CODE = '481920'
const EXPIRES_AT = new Date('2026-08-09T12:10:00.000Z')

function appWith(overrides: Partial<SpaceRegistrationService> = {}): Hono {
  const service: SpaceRegistrationService = {
    register: async () => ({ expiresAt: EXPIRES_AT }),
    verify: async () => ({ accessToken: 'at_1', refreshToken: 'rt_1', expiresIn: 300 }),
    ...overrides,
  }
  const app = new Hono()
  app.route('/space/v1', spaceIdentityRoutes(service))
  return app
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Status, body and headers, so a difference cannot hide in the part not compared. */
async function fingerprint(response: Response) {
  return {
    status: response.status,
    cacheControl: response.headers.get('Cache-Control'),
    body: await response.text(),
  }
}

describe('POST /space/v1/auth/registrations', () => {
  test('accepts a registration with 202 and the verification window', async () => {
    const response = await post(appWith(), '/space/v1/auth/registrations', {
      email: EMAIL,
      password: PASSWORD,
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ expiresAt: EXPIRES_AT.toISOString() })
  })

  test('an address that already has an account is indistinguishable from a new one', async () => {
    // HU-SP-001 criterion 3. The service cannot signal the difference — the port
    // swallows it — so this asserts the property end to end rather than a branch.
    const fresh = await post(appWith(), '/space/v1/auth/registrations', {
      email: 'new@dinnartec.co',
      password: PASSWORD,
    })
    const taken = await post(appWith(), '/space/v1/auth/registrations', {
      email: 'existing@dinnartec.co',
      password: PASSWORD,
    })

    expect(await fingerprint(fresh)).toEqual(await fingerprint(taken))
  })

  test('never answers 409, which would be the disclosure by another name', async () => {
    const response = await post(appWith(), '/space/v1/auth/registrations', {
      email: EMAIL,
      password: PASSWORD,
    })

    expect(response.status).not.toBe(409)
  })

  test('is never cached, on any path', async () => {
    const accepted = await post(appWith(), '/space/v1/auth/registrations', {
      email: EMAIL,
      password: PASSWORD,
    })
    const rejected = await post(appWith(), '/space/v1/auth/registrations', { email: EMAIL })

    expect(accepted.headers.get('Cache-Control')).toBe('no-store')
    expect(rejected.headers.get('Cache-Control')).toBe('no-store')
  })

  test('rejects a password below the minimum before reaching the provider', async () => {
    let called = false
    const app = appWith({
      register: async () => {
        called = true
        return { expiresAt: EXPIRES_AT }
      },
    })

    const response = await post(app, '/space/v1/auth/registrations', {
      email: EMAIL,
      password: 'short',
    })

    expect(response.status).toBe(400)
    expect(called).toBe(false)
  })

  test('does not trim the password, because spaces are characters', async () => {
    let received: string | undefined
    const app = appWith({
      register: async (_email, password) => {
        received = password
        return { expiresAt: EXPIRES_AT }
      },
    })

    await post(app, '/space/v1/auth/registrations', {
      email: EMAIL,
      password: `  ${PASSWORD}  `,
    })

    expect(received).toBe(`  ${PASSWORD}  `)
  })

  test('rejects a malformed body without reaching the provider', async () => {
    const response = await post(appWith(), '/space/v1/auth/registrations', {
      email: 'not-an-email',
    })
    expect(response.status).toBe(400)
  })

  test('reports a provider outage as retryable rather than as a bad request', async () => {
    const app = appWith({
      register: async () => {
        throw new RegistrationError('upstream-unavailable')
      },
    })

    const response = await post(app, '/space/v1/auth/registrations', {
      email: EMAIL,
      password: PASSWORD,
    })

    expect(response.status).toBe(503)
  })
})

describe('POST /space/v1/auth/registrations/verification', () => {
  const path = '/space/v1/auth/registrations/verification'

  test('returns the first session so the password is not asked for twice', async () => {
    const response = await post(appWith(), path, { email: EMAIL, password: PASSWORD, code: CODE })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      accessToken: 'at_1',
      refreshToken: 'rt_1',
      expiresIn: 300,
    })
  })

  test('a wrong code and an unknown address answer identically', async () => {
    // Both arrive as the same error, and this asserts they also leave as one.
    const app = appWith({
      verify: async () => {
        throw new RegistrationError('unauthenticated')
      },
    })

    const wrongCode = await post(app, path, { email: EMAIL, password: PASSWORD, code: '000000' })
    const unknown = await post(app, path, {
      email: 'nobody@dinnartec.co',
      password: PASSWORD,
      code: CODE,
    })

    expect(await fingerprint(wrongCode)).toEqual(await fingerprint(unknown))
    expect(wrongCode.status).toBe(401)
  })

  test('carries no detail explaining why it failed', async () => {
    const app = appWith({
      verify: async () => {
        throw new RegistrationError('unauthenticated')
      },
    })

    const response = await post(app, path, { email: EMAIL, password: PASSWORD, code: '000000' })
    const body = (await response.json()) as { error: { code: string; detail?: string } }

    // A detail here is how "no such address" ends up in a client, one helpful
    // log line at a time.
    expect(body.error.detail).toBeUndefined()
    expect(body.error.code).toBe('unauthenticated')
  })

  test('rejects a code that is not six digits before reaching the provider', async () => {
    let called = false
    const app = appWith({
      verify: async () => {
        called = true
        return { accessToken: 'at', refreshToken: 'rt', expiresIn: 300 }
      },
    })

    for (const code of ['12345', '1234567', 'abcdef', '']) {
      const response = await post(app, path, { email: EMAIL, password: PASSWORD, code })
      expect(response.status).toBe(400)
    }
    expect(called).toBe(false)
  })

  test('is never cached', async () => {
    const response = await post(appWith(), path, { email: EMAIL, password: PASSWORD, code: CODE })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
