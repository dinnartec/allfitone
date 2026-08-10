/** Stable hosted authentication and opaque Studio session routes. */

import { AuthError } from '@allfitone/auth-provider'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { authProvider } from '../../../platform/auth/index.js'
import { fail } from '../../../platform/http/index.js'
import {
  recordStudioAuthCallback,
  recordStudioRegistrationIncomplete,
} from '../../../platform/observability/index.js'
import { StudioSessionError, type StudioSessionService } from '../application/index.js'
import { studioSessionService, trustedStudioWebUrl } from '../dependencies.js'

const STATE_COOKIE = 'allfit_oauth_state'
export const STUDIO_SESSION_COOKIE = 'allfit_studio_session'
const STATE_TTL_SECONDS = 600
const STATE_COOKIE_PATH = '/studio/v1/auth'
const SESSION_COOKIE_PATH = '/studio/v1'

export function studioIdentityRoutes(injectedService?: StudioSessionService): Hono {
  const callback = callbackUrl()
  const studioWebUrl = trustedStudioWebUrl()
  const studioOrigin = new URL(studioWebUrl).origin
  const sessions = () => injectedService ?? studioSessionService()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
  })

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      // Mounted Studio handlers share one middleware chain, so this policy can answer
      // preflights for onboarding and organizations before their own policies.
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id', 'If-None-Match'],
    }),
  )

  routes.get('/auth/start', (c) => {
    c.header('Cache-Control', 'no-store')
    const state = randomBytes(32).toString('base64url')
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: STATE_COOKIE_PATH,
      maxAge: STATE_TTL_SECONDS,
    })
    return c.redirect(
      authProvider().getAuthorizationUrl({ surface: 'studio', redirectUri: callback, state }),
    )
  })

  routes.get('/auth/callback', async (c) => {
    c.header('Cache-Control', 'no-store')
    const code = c.req.query('code')
    const returnedState = c.req.query('state')
    const expectedState = getCookie(c, STATE_COOKIE)
    deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH })

    if (!code) {
      recordStudioAuthCallback('failed', 'missing-code')
      return fail(c, 'invalid-request', 'missing code')
    }
    if (!expectedState) {
      recordStudioAuthCallback('failed', 'missing-state-cookie')
      return fail(c, 'invalid-request', 'missing or expired state cookie')
    }
    if (returnedState !== expectedState) {
      recordStudioAuthCallback('failed', 'state-mismatch')
      return fail(c, 'invalid-request', 'state mismatch')
    }

    try {
      const result = await sessions().completeCode(code)
      setCookie(c, STUDIO_SESSION_COOKIE, result.opaqueToken, sessionCookieOptions())
      recordStudioAuthCallback('succeeded')
      return c.redirect(studioWebUrl, 303)
    } catch (error) {
      recordStudioAuthCallback('failed', 'authentication-failed')
      return sessionFailure(c, error, 'authentication callback failed')
    }
  })

  routes.get('/session', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const opaqueToken = getCookie(c, STUDIO_SESSION_COOKIE)
    if (!opaqueToken) return fail(c, 'unauthenticated', 'missing session cookie')

    try {
      const session = await sessions().readSession(opaqueToken)
      if (session.registration_status === 'registration_incomplete') {
        recordStudioRegistrationIncomplete()
      }
      return c.json(session)
    } catch (error) {
      if (error instanceof StudioSessionError && error.code !== 'upstream-unavailable') {
        deleteCookie(c, STUDIO_SESSION_COOKIE, { path: SESSION_COOKIE_PATH })
      }
      return sessionFailure(c, error, 'session validation failed')
    }
  })

  routes.post('/auth/logout', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }

    try {
      const logoutUrl = await sessions().logout(getCookie(c, STUDIO_SESSION_COOKIE))
      deleteCookie(c, STUDIO_SESSION_COOKIE, { path: SESSION_COOKIE_PATH })
      return c.redirect(logoutUrl, 303)
    } catch (error) {
      return sessionFailure(c, error, 'logout failed')
    }
  })

  return routes
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: SESSION_COOKIE_PATH,
  }
}

function callbackUrl(): string {
  const base = process.env.API_PUBLIC_URL
  if (!base) throw new Error('API_PUBLIC_URL is not set')
  return `${base.replace(/\/$/, '')}/studio/v1/auth/callback`
}

function sessionFailure(c: Parameters<typeof fail>[0], error: unknown, logMessage: string) {
  if (error instanceof StudioSessionError) return fail(c, error.code)
  if (error instanceof AuthError) {
    console.error(`[auth] ${logMessage}:`, error.detail ?? error.code)
    return fail(c, error.retryable ? 'upstream-unavailable' : 'unauthenticated')
  }
  console.error(`[auth] ${logMessage}`)
  return fail(c, 'upstream-unavailable')
}
