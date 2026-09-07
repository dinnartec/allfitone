/**
 * Onboarding routes on /space/v1.
 *
 * The first authenticated surface Space has. Everything before this point exists
 * to obtain a credential; from here the token is verified and resolved to an
 * access account before any command runs, which is the mandatory filter
 * `OP-IDN-001` names.
 *
 * The command headers are read exactly as the Studio routes read them, including
 * the hash of the canonical body. That hash is what makes an idempotency key safe
 * to reuse: replaying it with a different body is a conflict rather than a silent
 * merge of two different declarations.
 *
 * Verification lives behind an injected function rather than the shared
 * middleware so the tests can exercise the routes without a provider. The
 * production wiring passes the real verifier.
 */

import { createHash } from 'node:crypto'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { Hono, type Context } from 'hono'

import { fail } from '../../../platform/http/index.js'
import type { SpaceOnboardingService } from '../application/onboarding.js'
import { spaceOnboardingService } from '../dependencies.js'
import { authProvider } from '../../../platform/auth/index.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export function spaceOnboardingRoutes(
  injectedService?: SpaceOnboardingService,
  injectedVerifier?: TokenVerifier,
): Hono {
  const onboarding = () => injectedService ?? spaceOnboardingService()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()

  routes.post('/onboarding-attempts', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const command = commandContext(c, undefined)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const attempt = await onboarding().startAttempt(token, command)
      return c.json(
        {
          id: attempt.id,
          status: attempt.status,
          eligibility_status: attempt.eligibilityStatus,
          expires_at: attempt.expiresAt.toISOString(),
        },
        200,
      )
    } catch {
      return fail(c, 'upstream-unavailable')
    }
  })

  routes.post('/onboarding-attempts/:attemptId/eligibility-evidence', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const attemptId = c.req.param('attemptId')
    if (!UUID_V7.test(attemptId)) return fail(c, 'invalid-request')

    const body = await readJson(c)
    const declaredAdult = readDeclaration(body)
    const command = commandContext(c, body)
    if (declaredAdult === undefined || !command) return fail(c, 'invalid-request')

    try {
      const evidence = await onboarding().recordAdultEligibility(token, {
        ...command,
        attemptId,
        declaredAdult,
      })
      return c.json(
        {
          result: evidence.result,
          evaluated_at: evidence.evaluatedAt.toISOString(),
          // Frozen into the response, which is HU-SP-007 criterion 5: the
          // person is told which policy they were held to, and when.
          policy: {
            code: 'adult_eligibility' as const,
            version: 1 as const,
            minimum_age: 18 as const,
            jurisdiction: 'CO' as const,
            evidence_kind: 'self_declaration' as const,
          },
        },
        200,
      )
    } catch {
      return fail(c, 'upstream-unavailable')
    }
  })

  // Placed before the parameterised route so `current` is never read as an id.
  routes.get('/onboarding-attempts/current', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const current = await onboarding().readCurrentAttempt(token)
      return c.json(
        {
          attempt: current.attempt
            ? {
                id: current.attempt.id,
                status: current.attempt.status,
                eligibility_status: current.attempt.eligibilityStatus,
                expires_at: current.attempt.expiresAt.toISOString(),
              }
            : null,
          identity: current.identity
            ? {
                given_name: current.identity.givenName,
                family_name: current.identity.familyName,
                username: current.identity.username,
              }
            : null,
        },
        200,
      )
    } catch {
      return fail(c, 'upstream-unavailable')
    }
  })

  routes.post('/onboarding-attempts/:attemptId/fitness-id', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const attemptId = c.req.param('attemptId')
    if (!UUID_V7.test(attemptId)) return fail(c, 'invalid-request')

    const body = await readJson(c)
    const identity = readIdentity(body)
    const command = commandContext(c, body)
    if (!identity || !command) return fail(c, 'invalid-request')

    try {
      const created = await onboarding().createFitnessId(token, {
        ...command,
        attemptId,
        ...identity,
      })
      return c.json(
        {
          given_name: created.givenName,
          family_name: created.familyName,
          username: created.username,
        },
        200,
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const header = c.req.header('authorization')
  const [scheme, value] = header?.split(' ') ?? []
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    // Server-side only. The client is told one thing for every cause; without
    // this, a missing header and a rejected token are indistinguishable to us.
    console.warn('[identity] space onboarding refused', { reason: 'no-bearer-header' })
    return undefined
  }
  try {
    return await verify(value)
  } catch (cause) {
    // One answer for expired, malformed and issued-for-another-surface.
    console.warn('[identity] space onboarding refused', {
      reason: 'token-rejected',
      detail: String(cause).slice(0, 160),
    })
    return undefined
  }
}

function commandContext(c: Context, body: unknown) {
  const idempotencyKey = c.req.header('idempotency-key') ?? ''
  const commandId = c.req.header('command-id') ?? ''
  if (!UUID_V4.test(idempotencyKey) || !UUID_V7.test(commandId)) return undefined
  return {
    idempotencyKey,
    commandId,
    requestHash: createHash('sha256').update(canonicalJson(body)).digest(),
  }
}

/** Strictly boolean: a truthy string would record a declaration nobody made. */
function readDeclaration(body: unknown): boolean | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'declared_adult') return undefined
  const value = (body as { declared_adult: unknown }).declared_adult
  return typeof value === 'boolean' ? value : undefined
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

/** Key order must not change the hash, or a retry would read as a new command. */
function canonicalJson(value: unknown): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const USERNAME = /^[a-z][a-z0-9_]{2,29}$/
const NAME_MAX_LENGTH = 120

/**
 * Strict, like `readDeclaration`. The username is validated here as well as in
 * the database so a malformed one never reaches a command and burns a key.
 */
function readIdentity(
  body: unknown,
): { givenName: string; familyName: string; username: string } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body).sort()
  if (keys.length !== 3 || keys[0] !== 'family_name' || keys[1] !== 'given_name') return undefined
  if (keys[2] !== 'username') return undefined

  const record = body as { given_name: unknown; family_name: unknown; username: unknown }
  const givenName = trimmedName(record.given_name)
  const familyName = trimmedName(record.family_name)
  if (!givenName || !familyName) return undefined
  if (typeof record.username !== 'string' || !USERNAME.test(record.username)) return undefined

  return { givenName, familyName, username: record.username }
}

function trimmedName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return undefined
  return name
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Same mapping the sibling handlers use: the SQLSTATE is the signal. */
function operationFailure(c: Context, error: unknown) {
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'invalid-request')
  }
  console.error('[space-onboarding] operation failed')
  return fail(c, 'upstream-unavailable')
}
