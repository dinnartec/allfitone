/**
 * Identity routes on /studio/v1.
 *
 * Studio uses the hosted flow: it holds a link, the provider hosts the login
 * screen, and the code comes back here. Studio never talks to the provider — if
 * it received the code it would have to, which the boundary rules forbid.
 *
 * SCOPE: this is the walking skeleton. The callback proves the round trip and
 * reports what it verified. It does not establish a session yet, because where
 * the refresh token lives and how the subject resolves to a person both need the
 * schema.
 */

import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { AuthError } from '@allfitone/auth-provider'

import { authProvider } from '../../../platform/auth/index.js'
import { fail } from '../../../platform/http/index.js'

const STATE_COOKIE = 'allfit_oauth_state'
const STATE_TTL_SECONDS = 600

export function studioIdentityRoutes(): Hono {
  // Resolved once, at assembly. A missing base URL must stop the process at
  // boot, not surface as a 500 the first time somebody clicks "sign in".
  const callback = callbackUrl()

  const routes = new Hono()

  /**
   * Sends the person to the provider.
   *
   * `state` is generated here, stored in an httpOnly cookie, and checked on the
   * way back. Without it an attacker can hand a victim a callback URL carrying
   * the attacker's code and silently land the victim in the attacker's session.
   */
  routes.get('/auth/start', (c) => {
    const state = crypto.randomUUID()

    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      // Lax rather than Strict: the callback arrives as a top-level navigation
      // from the provider's domain, and Strict would withhold the cookie.
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: STATE_TTL_SECONDS,
    })

    return c.redirect(
      authProvider().getAuthorizationUrl({
        surface: 'studio',
        redirectUri: callback,
        state,
      }),
    )
  })

  routes.get('/auth/callback', async (c) => {
    const code = c.req.query('code')
    const returnedState = c.req.query('state')
    const expectedState = getCookie(c, STATE_COOKIE)

    // Consumed whether or not the rest succeeds, so a leaked callback URL
    // cannot be replayed.
    deleteCookie(c, STATE_COOKIE, { path: '/' })

    if (!code) return fail(c, 'invalid-request', 'missing code')
    if (!expectedState) return fail(c, 'invalid-request', 'missing or expired state cookie')
    if (returnedState !== expectedState) return fail(c, 'invalid-request', 'state mismatch')

    let subject: string
    let accessToken: string
    try {
      const result = await authProvider().authenticateWithCode(code, 'studio')
      subject = result.subject
      accessToken = result.tokens.accessToken
    } catch (error) {
      // Server-side only. The caller gets a flat answer; whoever is debugging
      // gets the provider's actual complaint.
      console.error(
        '[auth] code exchange failed:',
        error instanceof AuthError ? (error.detail ?? error.code) : error,
      )
      if (error instanceof AuthError && error.retryable) {
        return fail(c, 'upstream-unavailable', 'identity provider unreachable')
      }
      return fail(c, 'unauthenticated', 'code exchange rejected')
    }

    // Verifying our own freshly issued token is not redundant: it is the first
    // proof that JWKS verification and the surface check hold against a real
    // token rather than one we minted in a test.
    let verified
    try {
      verified = await authProvider().verifyAccessToken(accessToken, 'studio')
    } catch (error) {
      // Server-side only. A token we just received failing our own verification
      // points at configuration, not at the caller, so the reason has to be
      // visible to whoever is debugging.
      console.error(
        '[auth] verification of the issued token failed:',
        error instanceof AuthError ? (error.detail ?? error.code) : error,
        '| issuer in token:',
        issuerOf(accessToken),
        '| client_id in token:',
        claimOf(accessToken, 'client_id'),
        '| alg:',
        algorithmOf(accessToken),
      )
      return fail(c, 'unauthenticated', 'issued token failed verification')
    }

    return c.json({
      walkingSkeleton: true,
      subjectFromExchange: subject,
      verified,
      // Diagnostic, and temporary. WORKOS_ISSUER is unset because nothing
      // authoritative states the value, and guessing it would either reject
      // every login or get deleted by whoever debugs that. Read it here once,
      // set it, then delete this field along with the rest of the skeleton.
      diagnostic: { tokenIssuer: issuerOf(accessToken) },
      note: 'No session was established. That needs the schema.',
    })
  })

  return routes
}

/**
 * Reads `iss` from an already-verified token.
 *
 * No verification here and none needed: the port verified this token a moment
 * ago. Hand-decoding rather than pulling in a JWT library, because this exists
 * only to answer one open question and then goes away.
 */
function issuerOf(token: string): string {
  return claimOf(token, 'iss')
}

function claimOf(token: string, name: string): string {
  try {
    const payload = token.split('.')[1]
    if (!payload) return '(unreadable)'
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    return String(claims[name] ?? '(absent)')
  } catch {
    return '(unreadable)'
  }
}

/**
 * Reads `alg` from the token header.
 *
 * Diagnostic. The verifier pins RS256; if the provider signs with something
 * else, this is what says so.
 */
function algorithmOf(token: string): string {
  try {
    const header = token.split('.')[0]
    if (!header) return '(unreadable)'
    return (JSON.parse(Buffer.from(header, 'base64url').toString('utf8')).alg ??
      '(absent)') as string
  } catch {
    return '(unreadable)'
  }
}

/**
 * Built from configuration, never from the Host header.
 *
 * A redirect URI derived from a request header is attacker-controllable, and it
 * has to match the provider dashboard exactly anyway.
 */
function callbackUrl(): string {
  const base = process.env.API_PUBLIC_URL
  if (!base) {
    throw new Error('API_PUBLIC_URL is not set. Copy .env.example to .env.local and fill it in.')
  }
  return `${base.replace(/\/$/, '')}/studio/v1/auth/callback`
}
