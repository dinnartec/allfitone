/**
 * Identity routes on /space/v1.
 *
 * Space uses headless login: its own native screens, and the app never talks to
 * the provider. It sends credentials here and the API makes the call with the API
 * key, which exists only on the server.
 *
 * Both routes are unauthenticated by definition — they exist to obtain a
 * credential — which makes them the most exposed surface in the API. Two
 * consequences run through the code below: nothing in a response may vary with
 * whether an account exists, and every answer is `no-store`.
 */

import { Hono } from 'hono'

import { fail } from '../../../platform/http/index.js'
import { RegistrationError, type SpaceRegistrationService } from '../application/registration.js'
import { spaceRegistrationService } from '../dependencies.js'

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 256
/**
 * Product decision: eight characters with a lowercase letter, an uppercase
 * letter and a digit.
 *
 * Enforced on registration only. Verification takes the password again to mint
 * the provider's pending token, and re-checking composition there would lock out
 * any account created under an earlier policy.
 */
const PASSWORD_COMPOSITION = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])/
/** RFC 5321 caps the whole address here. */
const MAX_EMAIL_LENGTH = 254
const VERIFICATION_CODE = /^[0-9]{6}$/

export function spaceIdentityRoutes(injectedService?: SpaceRegistrationService): Hono {
  const registrations = () => injectedService ?? spaceRegistrationService()
  const routes = new Hono()

  routes.post('/auth/registrations', async (c) => {
    c.header('Cache-Control', 'no-store')

    const body = await readJson(c.req.raw)
    const email = readEmail(body)
    const password = readPassword(body)
    if (!email || !password || !PASSWORD_COMPOSITION.test(password)) {
      return fail(c, 'invalid-request')
    }

    try {
      const accepted = await registrations().register(email, password)
      // 202, not 201: a created resource would be a claim about what happened,
      // and the whole point is that the caller cannot tell.
      return c.json({ expiresAt: accepted.expiresAt.toISOString() }, 202)
    } catch (cause) {
      return failRegistration(c, cause)
    }
  })

  routes.post('/auth/registrations/verification', async (c) => {
    c.header('Cache-Control', 'no-store')

    const body = await readJson(c.req.raw)
    const email = readEmail(body)
    const password = readPassword(body)
    const code = readCode(body)
    if (!email || !password || !code) return fail(c, 'invalid-request')

    try {
      const session = await registrations().verify(email, password, code)
      return c.json(session, 200)
    } catch (cause) {
      return failRegistration(c, cause)
    }
  })

  return routes
}

function failRegistration(c: Parameters<typeof fail>[0], cause: unknown) {
  const code = cause instanceof RegistrationError ? cause.code : 'upstream-unavailable'
  // No detail is passed on either branch. `fail` forwards what it is given, and
  // anything describing why this failed would separate "no such address" from
  // "wrong code".
  return fail(c, code)
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Shape only. Whether the address can actually receive mail is the provider's
 * business, and asking it here would mean a round trip whose timing differs
 * between a valid and an invalid address.
 */
function readEmail(body: Record<string, unknown>): string | undefined {
  const value = body.email
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return undefined
  if (!trimmed.includes('@') || trimmed.includes(' ')) return undefined
  return trimmed
}

/**
 * Length only. Composition is checked at the registration route, because
 * verification must accept whatever the account was created with.
 *
 * Never trimmed — leading and trailing spaces are legitimate characters.
 */
function readPassword(body: Record<string, unknown>): string | undefined {
  const value = body.password
  if (typeof value !== 'string') return undefined
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) return undefined
  return value
}

function readCode(body: Record<string, unknown>): string | undefined {
  const value = body.code
  if (typeof value !== 'string' || !VERIFICATION_CODE.test(value)) return undefined
  return value
}
