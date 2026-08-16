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
  recordStudioLogout,
  recordStudioRegistrationIncomplete,
} from '../../../platform/observability/index.js'
import { StudioSessionError, type StudioSessionService } from '../application/index.js'
import { studioSessionService, trustedStudioWebUrl } from '../dependencies.js'

const LEGACY_STATE_COOKIE = 'allfit_oauth_state'
const STATE_COOKIE_PREFIX = `${LEGACY_STATE_COOKIE}_`
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/
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
      exposeHeaders: ['ETag', 'Server-Timing'],
      maxAge: 600,
    }),
  )

  routes.get('/auth/start', (c) => {
    c.header('Cache-Control', 'no-store')
    const state = randomBytes(32).toString('base64url')
    setCookie(c, stateCookieName(state), state, {
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
    const cookies = getCookie(c)
    const flowCookie =
      returnedState && STATE_PATTERN.test(returnedState)
        ? stateCookieName(returnedState)
        : undefined
    const matchingCookie =
      flowCookie && cookies[flowCookie] === returnedState
        ? flowCookie
        : returnedState && cookies[LEGACY_STATE_COOKIE] === returnedState
          ? LEGACY_STATE_COOKIE
          : undefined

    if (!code) {
      if (matchingCookie) deleteCookie(c, matchingCookie, { path: STATE_COOKIE_PATH })
      recordStudioAuthCallback('failed', 'missing-code')
      return fail(c, 'invalid-request', 'missing code')
    }
    if (!flowCookie) {
      recordStudioAuthCallback('failed', 'state-mismatch')
      return fail(c, 'invalid-request', 'state mismatch')
    }
    if (!matchingCookie) {
      const hasAnotherState = Object.keys(cookies).some(
        (name) => name === LEGACY_STATE_COOKIE || name.startsWith(STATE_COOKIE_PREFIX),
      )
      if (hasAnotherState) {
        recordStudioAuthCallback('failed', 'state-mismatch')
        return fail(c, 'invalid-request', 'state mismatch')
      }
      recordStudioAuthCallback('failed', 'missing-state-cookie')
      return fail(c, 'invalid-request', 'missing or expired state cookie')
    }
    deleteCookie(c, matchingCookie, { path: STATE_COOKIE_PATH })

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
      return c.json({ ...session, analytics: session.analytics ?? { distinct_id: null } })
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

    const opaqueToken = getCookie(c, STUDIO_SESSION_COOKIE)
    deleteCookie(c, STUDIO_SESSION_COOKIE, { path: SESSION_COOKIE_PATH })
    const trigger = await logoutTrigger(c.req.parseBody())

    try {
      const result = await sessions().logout(opaqueToken)
      recordStudioLogout(trigger, result.outcome)
      return c.redirect(result.redirectUrl, 303)
    } catch {
      recordStudioLogout(trigger, 'partial')
      return c.redirect(partialLogoutReturnTo(studioWebUrl), 303)
    }
  })

  return routes
}

function stateCookieName(state: string): string {
  return `${STATE_COOKIE_PREFIX}${state}`
}

async function logoutTrigger(
  body: Promise<Record<string, string | File>>,
): Promise<'inactivity' | 'manual' | 'recovery'> {
  try {
    const reason = (await body).reason
    if (reason === 'inactivity' || reason === 'recovery') return reason
    return 'manual'
  } catch {
    return 'manual'
  }
}

function partialLogoutReturnTo(studioWebUrl: string): string {
  const returnTo = new URL(studioWebUrl)
  returnTo.searchParams.set('logout', 'partial')
  return returnTo.toString()
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
