import type { BrowserContext, Route } from '@playwright/test'

const BACKOFFICE_ORIGIN = 'http://127.0.0.1:3102'

export interface BackofficeFixture {
  session?: SessionFixture
  attempt?: AttemptFixture
  passwordOutcome?: 'challenge' | 'enrollment' | 'unauthenticated' | 'disabled' | 'rate-limited'
  totpOutcome?: 'success' | 'invalid' | 'network-lost-after-success' | 'rate-limited'
  invalidTotpCount?: number
  logoutFails?: boolean
  sessionUnavailable?: boolean
  requests: MockRequest[]
}

interface SessionFixture {
  authenticated: true
  assurance_level: 2
  authentication_method: 'password_totp'
  operator: { given_name: string; family_name: string }
  assurance_verified_at: string
  inactivity_expires_at: string
  absolute_expires_at: string
}

interface AttemptFixture {
  next: 'totp-challenge' | 'totp-enrollment'
  expires_at: string
  enrollment?: { qr_code: string; manual_key: string }
}

export interface MockRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
}

export function createBackofficeFixture(
  overrides: Partial<BackofficeFixture> = {},
): BackofficeFixture {
  return {
    passwordOutcome: 'challenge',
    totpOutcome: 'success',
    requests: [],
    ...overrides,
  }
}

export async function mockBackofficeApi(
  context: BrowserContext,
  fixture: BackofficeFixture,
): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem(
      'allfit.analytics-v1',
      JSON.stringify({ decision: 'denied', notice_version: 'analytics-v1' }),
    )
  })
  await context.route('http://127.0.0.1:8080/backoffice/v1/**', async (route) => {
    const request = toMockRequest(route)
    fixture.requests.push(request)

    if (request.method === 'OPTIONS') {
      await fulfill(route, 204)
      return
    }
    if (request.method === 'GET' && request.path === '/backoffice/v1/session') {
      if (fixture.sessionUnavailable) {
        await fulfill(route, 503, error('upstream-unavailable'))
        return
      }
      if (!fixture.session) {
        await fulfill(route, 401, error('unauthenticated'))
        return
      }
      await fulfill(route, 200, fixture.session)
      return
    }
    if (request.method === 'GET' && request.path === '/backoffice/v1/auth/attempt') {
      if (!fixture.attempt) {
        await fulfill(route, 401, error('unauthenticated'))
        return
      }
      await fulfill(route, 200, fixture.attempt)
      return
    }
    if (request.method === 'POST' && request.path === '/backoffice/v1/auth/password') {
      if (fixture.passwordOutcome === 'unauthenticated') {
        await fulfill(route, 401, error('unauthenticated'))
        return
      }
      if (fixture.passwordOutcome === 'disabled') {
        await fulfill(route, 503, error('service-degraded'))
        return
      }
      if (fixture.passwordOutcome === 'rate-limited') {
        await fulfill(route, 429, error('rate-limited'), { 'Retry-After': '2' })
        return
      }
      fixture.attempt =
        fixture.passwordOutcome === 'enrollment' ? enrollmentAttempt() : challengeAttempt()
      await fulfill(route, 200, fixture.attempt)
      return
    }
    if (request.method === 'POST' && request.path === '/backoffice/v1/auth/totp/verification') {
      if (fixture.totpOutcome === 'invalid') {
        fixture.invalidTotpCount = (fixture.invalidTotpCount ?? 0) + 1
        if (fixture.invalidTotpCount >= 5) fixture.attempt = undefined
        await fulfill(route, 401, error('unauthenticated'))
        return
      }
      if (fixture.totpOutcome === 'rate-limited') {
        await fulfill(route, 429, error('rate-limited'), { 'Retry-After': '2' })
        return
      }
      fixture.session = activeSession()
      fixture.attempt = undefined
      if (fixture.totpOutcome === 'network-lost-after-success') {
        fixture.totpOutcome = 'success'
        await route.abort('failed')
        return
      }
      await fulfill(route, 204)
      return
    }
    if (request.method === 'POST' && request.path === '/backoffice/v1/auth/logout') {
      if (fixture.logoutFails) {
        fixture.logoutFails = false
        await route.abort('failed')
        return
      }
      fixture.session = undefined
      await fulfill(route, 204)
      return
    }
    if (request.method === 'POST' && request.path === '/backoffice/v1/auth/password-resets') {
      await fulfill(route, 202)
      return
    }
    await fulfill(route, 404, error('not-found'))
  })
}

export function activeSession(): SessionFixture {
  const now = Date.now()
  return {
    authenticated: true,
    assurance_level: 2,
    authentication_method: 'password_totp',
    operator: { given_name: 'Ada', family_name: 'Lovelace' },
    assurance_verified_at: new Date(now).toISOString(),
    inactivity_expires_at: new Date(now + 15 * 60_000).toISOString(),
    absolute_expires_at: new Date(now + 8 * 60 * 60_000).toISOString(),
  }
}

export function challengeAttempt(): AttemptFixture {
  return {
    next: 'totp-challenge',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }
}

export function enrollmentAttempt(): AttemptFixture {
  return {
    next: 'totp-enrollment',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    enrollment: {
      qr_code:
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="180" height="180"%3E%3Crect width="180" height="180" fill="white"/%3E%3Cpath d="M20 20h45v45H20zM115 20h45v45h-45zM20 115h45v45H20zM80 80h20v20H80zM115 115h20v20h-20z" fill="%23030713"/%3E%3C/svg%3E',
      manual_key: 'JBSWY3DPEHPK3PXP',
    },
  }
}

function toMockRequest(route: Route): MockRequest {
  const request = route.request()
  return {
    method: request.method(),
    path: new URL(request.url()).pathname,
    headers: request.headers(),
    body: parseBody(request.postData()),
  }
}

function parseBody(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

async function fulfill(
  route: Route,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    status,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {
      'Access-Control-Allow-Origin': BACKOFFICE_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Command-Id',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'Retry-After',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  })
}

function error(code: string): { error: { code: string } } {
  return { error: { code } }
}
