import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { BackofficeAuthenticationService } from '../application/backoffice.js'
import {
  BACKOFFICE_ATTEMPT_COOKIE,
  BACKOFFICE_SESSION_COOKIE,
  backofficeIdentityRoutes,
} from './backoffice.js'

const ORIGIN = 'http://localhost:3001'
const COMMAND = '019ff263-2eba-74f0-a49d-b858bc8a96b4'
const IDEMPOTENCY = '82daa5c9-605d-457f-b989-74decf1fb12a'

function service(overrides: Partial<BackofficeAuthenticationService> = {}) {
  const implementation: BackofficeAuthenticationService = {
    startPassword: async () => ({
      attemptToken: 'attempt-secret',
      presentation: {
        next: 'totp-enrollment',
        expires_at: '2026-08-12T12:10:00.000Z',
        enrollment: { qr_code: 'otpauth://secret', manual_key: 'MANUALSECRET' },
      },
    }),
    readAttempt: async () => ({
      next: 'totp-challenge',
      expires_at: '2026-08-12T12:10:00.000Z',
    }),
    verifyTotp: async () => ({ sessionToken: 'session-secret' }),
    readSession: async () => ({
      authenticated: true,
      assurance_level: 2,
      authentication_method: 'password_totp',
      operator: { given_name: 'Ada', family_name: 'Lovelace' },
      assurance_verified_at: '2026-08-12T12:00:00.000Z',
      inactivity_expires_at: '2026-08-12T12:15:00.000Z',
      absolute_expires_at: '2026-08-12T20:00:00.000Z',
    }),
    resolveActor: async () => ({
      personId: '019a2000-0000-7000-8000-000000000001',
      sessionId: '019a2000-0000-7000-8000-000000000031',
    }),
    logout: async () => 'revoked',
    requestPasswordReset: async () => undefined,
    ...overrides,
  }
  return implementation
}

function app(injected = service()) {
  const instance = new Hono()
  instance.route('/backoffice/v1', backofficeIdentityRoutes(injected))
  return instance
}

beforeEach(() => {
  process.env.BACKOFFICE_WEB_URL = ORIGIN
  process.env.BACKOFFICE_AUTH_ENABLED = 'true'
  process.env.NODE_ENV = 'test'
})

describe('Backoffice authentication HTTP contract', () => {
  test('starts an enrollment without exposing credentials in cookies or headers', async () => {
    const response = await app().request('/backoffice/v1/auth/password', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.test', password: 'Password123' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      next: 'totp-enrollment',
      expires_at: '2026-08-12T12:10:00.000Z',
      enrollment: { qr_code: 'otpauth://secret', manual_key: 'MANUALSECRET' },
    })
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${BACKOFFICE_ATTEMPT_COOKIE}=attempt-secret`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/backoffice/v1/auth')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  test('requires the exact origin and preserves an indistinguishable password failure', async () => {
    const wrongOrigin = await app().request('/backoffice/v1/auth/password', {
      method: 'POST',
      headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.test', password: 'Password123' }),
    })
    expect(wrongOrigin.status).toBe(403)

    const rejected = await app(
      service({
        startPassword: async () => {
          const { BackofficeAuthenticationError } = await import('../application/backoffice.js')
          throw new BackofficeAuthenticationError('unauthenticated')
        },
      }),
    ).request('/backoffice/v1/auth/password', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@example.test', password: 'wrong' }),
    })
    expect(rejected.status).toBe(401)
    expect(await rejected.json()).toEqual({ error: { code: 'unauthenticated' } })
  })

  test('verifies TOTP with command headers and atomically replaces the attempt cookie', async () => {
    const response = await app().request('/backoffice/v1/auth/totp/verification', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: `${BACKOFFICE_ATTEMPT_COOKIE}=attempt-secret`,
        'Idempotency-Key': IDEMPOTENCY,
        'Command-Id': COMMAND,
      },
      body: JSON.stringify({ code: '123456' }),
    })

    expect(response.status).toBe(204)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${BACKOFFICE_SESSION_COOKIE}=session-secret`)
    expect(cookie).toContain('SameSite=Strict')
  })

  test('keeps the attempt cookie after a retryable wrong code and clears it at the terminal limit', async () => {
    const { BackofficeAuthenticationError } = await import('../application/backoffice.js')
    const request = () => ({
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: `${BACKOFFICE_ATTEMPT_COOKIE}=attempt-secret`,
        'Idempotency-Key': IDEMPOTENCY,
        'Command-Id': COMMAND,
      },
      body: JSON.stringify({ code: '000000' }),
    })

    const retryable = await app(
      service({
        verifyTotp: async () => {
          throw new BackofficeAuthenticationError('unauthenticated', false)
        },
      }),
    ).request('/backoffice/v1/auth/totp/verification', request())
    expect(retryable.status).toBe(401)
    expect(retryable.headers.get('set-cookie')).toBeNull()

    const terminal = await app(
      service({
        verifyTotp: async () => {
          throw new BackofficeAuthenticationError('unauthenticated', true)
        },
      }),
    ).request('/backoffice/v1/auth/totp/verification', request())
    expect(terminal.status).toBe(401)
    expect(terminal.headers.get('set-cookie')).toContain(`${BACKOFFICE_ATTEMPT_COOKIE}=`)
  })

  test('returns only the approved AAL2 session projection', async () => {
    const response = await app().request('/backoffice/v1/session', {
      headers: { Origin: ORIGIN, Cookie: `${BACKOFFICE_SESSION_COOKIE}=session-secret` },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.assurance_level).toBe(2)
    expect(body.authentication_method).toBe('password_totp')
    expect(JSON.stringify(body)).not.toContain('email')
    expect(JSON.stringify(body)).not.toContain('factor')
    expect(JSON.stringify(body)).not.toContain('permission')
  })

  test('keeps reset acceptance uniform and logout idempotent', async () => {
    const reset = await app(
      service({ requestPasswordReset: async () => Promise.reject(new Error('provider down')) }),
    ).request('/backoffice/v1/auth/password-resets', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.test' }),
    })
    expect(reset.status).toBe(202)
    expect(await reset.text()).toBe('')

    const logout = await app().request('/backoffice/v1/auth/logout', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'recovery' }),
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain(`${BACKOFFICE_SESSION_COOKIE}=`)
  })
})
