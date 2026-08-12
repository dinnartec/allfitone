/** Backoffice password + TOTP authentication. No Hosted AuthKit login is used here. */

import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { fail } from '../../../platform/http/index.js'
import { recordBackofficeAuth } from '../../../platform/observability/index.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../application/backoffice.js'
import { backofficeAuthenticationService, trustedBackofficeWebUrl } from '../dependencies.js'

export const BACKOFFICE_ATTEMPT_COOKIE = 'allfit_backoffice_auth_attempt'
export const BACKOFFICE_SESSION_COOKIE = 'allfit_backoffice_session'

const ATTEMPT_COOKIE_PATH = '/backoffice/v1/auth'
const SESSION_COOKIE_PATH = '/backoffice/v1'
const ATTEMPT_TTL_SECONDS = 10 * 60
const SESSION_TTL_SECONDS = 8 * 60 * 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function backofficeIdentityRoutes(injectedService?: BackofficeAuthenticationService): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const service = () => injectedService ?? backofficeAuthenticationService()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Vary', 'Origin')
  })
  routes.use(
    '*',
    cors({
      origin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
    }),
  )

  routes.post('/auth/password', async (c) => {
    if (!exactOrigin(c, origin)) return fail(c, 'forbidden')
    if (process.env.BACKOFFICE_AUTH_ENABLED !== 'true') {
      return fail(c, 'service-degraded')
    }
    const input = await jsonObject(c)
    const email = typeof input?.email === 'string' ? input.email.trim() : ''
    const password = typeof input?.password === 'string' ? input.password : ''
    if (!EMAIL.test(email) || email.length > 320 || password.length < 1 || password.length > 4096) {
      return fail(c, 'invalid-request')
    }

    try {
      const result = await service().startPassword({ email, password })
      setCookie(c, BACKOFFICE_ATTEMPT_COOKIE, result.attemptToken, attemptCookieOptions())
      recordBackofficeAuth(
        result.presentation.next === 'totp-enrollment' ? 'enrollment' : 'challenge',
        'succeeded',
      )
      recordBackofficeAuth('password', 'succeeded')
      return c.json(result.presentation)
    } catch (error) {
      recordBackofficeAuth('password', 'failed')
      return authenticationFailure(c, error)
    }
  })

  routes.get('/auth/attempt', async (c) => {
    if (!exactOrigin(c, origin)) return fail(c, 'forbidden')
    const token = getCookie(c, BACKOFFICE_ATTEMPT_COOKIE)
    if (!token) return fail(c, 'unauthenticated')
    try {
      return c.json(await service().readAttempt(token))
    } catch (error) {
      if (terminalAuthenticationError(error)) clearAttempt(c)
      return authenticationFailure(c, error)
    }
  })

  routes.post('/auth/totp/verification', async (c) => {
    if (!exactOrigin(c, origin)) return fail(c, 'forbidden')
    const token = getCookie(c, BACKOFFICE_ATTEMPT_COOKIE)
    const idempotencyKey = c.req.header('idempotency-key')
    const commandId = c.req.header('command-id')
    const input = await jsonObject(c)
    const code = typeof input?.code === 'string' ? input.code.trim() : ''
    if (!token) return fail(c, 'unauthenticated')
    if (!idempotencyKey || !commandId || !UUID.test(idempotencyKey) || !UUID.test(commandId)) {
      return fail(c, 'invalid-request')
    }
    if (!/^\d{6}$/.test(code)) return fail(c, 'invalid-request')

    try {
      const result = await service().verifyTotp({
        attemptToken: token,
        code,
        idempotencyKey,
        commandId,
      })
      clearAttempt(c)
      setCookie(c, BACKOFFICE_SESSION_COOKIE, result.sessionToken, sessionCookieOptions())
      recordBackofficeAuth('verification', 'succeeded')
      return c.body(null, 204)
    } catch (error) {
      recordBackofficeAuth('verification', 'failed')
      if (terminalAuthenticationError(error)) clearAttempt(c)
      return authenticationFailure(c, error)
    }
  })

  routes.get('/session', async (c) => {
    if (!exactOrigin(c, origin)) return fail(c, 'forbidden')
    const token = getCookie(c, BACKOFFICE_SESSION_COOKIE)
    if (!token) return fail(c, 'unauthenticated')
    try {
      const result = await service().readSession(token)
      recordBackofficeAuth('session', 'succeeded')
      return c.json(result)
    } catch (error) {
      recordBackofficeAuth('session', 'failed')
      if (terminalAuthenticationError(error)) clearSession(c)
      return authenticationFailure(c, error)
    }
  })

  routes.post('/auth/logout', async (c) => {
    if (!exactOrigin(c, origin)) return fail(c, 'forbidden')
    const token = getCookie(c, BACKOFFICE_SESSION_COOKIE)
    const trigger = await logoutTrigger(c)
    clearSession(c)
    try {
      const outcome = await service().logout(token)
      recordBackofficeAuth('logout', outcome, trigger)
    } catch {
      recordBackofficeAuth('logout', 'partial', trigger)
    }
    return c.body(null, 204)
  })

  routes.post('/auth/password-resets', async (c) => {
    if (!exactOrigin(c, origin)) return fail(c, 'forbidden')
    const input = await jsonObject(c)
    const email = typeof input?.email === 'string' ? input.email.trim() : ''
    if (!EMAIL.test(email) || email.length > 320) return fail(c, 'invalid-request')
    try {
      await service().requestPasswordReset(email)
      recordBackofficeAuth('password_reset', 'accepted')
    } catch {
      // Deliberately indistinguishable: neither account existence nor provider health is public.
      recordBackofficeAuth('password_reset', 'failed')
    }
    return c.body(null, 202)
  })

  return routes
}

function exactOrigin(c: Context, allowed: string): boolean {
  return c.req.header('origin') === allowed
}

async function jsonObject(c: Context): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await c.req.json()
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

async function logoutTrigger(c: Context): Promise<'inactivity' | 'manual' | 'recovery'> {
  const contentType = c.req.header('content-type') ?? ''
  try {
    const reason = contentType.includes('application/json')
      ? (await jsonObject(c))?.reason
      : (await c.req.parseBody()).reason
    return reason === 'inactivity' || reason === 'recovery' ? reason : 'manual'
  } catch {
    return 'manual'
  }
}

function authenticationFailure(c: Context, error: unknown) {
  if (error instanceof BackofficeAuthenticationError) return fail(c, error.code)
  console.error('[backoffice-auth] operation failed')
  return fail(c, 'upstream-unavailable')
}

function terminalAuthenticationError(error: unknown): boolean {
  return error instanceof BackofficeAuthenticationError && error.clearLocalCredential
}

function clearAttempt(c: Context): void {
  deleteCookie(c, BACKOFFICE_ATTEMPT_COOKIE, { path: ATTEMPT_COOKIE_PATH })
}

function clearSession(c: Context): void {
  deleteCookie(c, BACKOFFICE_SESSION_COOKIE, { path: SESSION_COOKIE_PATH })
}

function attemptCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: ATTEMPT_COOKIE_PATH,
    maxAge: ATTEMPT_TTL_SECONDS,
  }
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: SESSION_COOKIE_PATH,
    maxAge: SESSION_TTL_SECONDS,
  }
}
