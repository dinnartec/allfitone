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

import type { BiologicalSex, FocusArea, PrimaryTrainingGoal } from '../domain/index.js'
import { fail } from '../../../platform/http/index.js'
import {
  OnboardingPreconditionError,
  type SpaceOnboardingService,
} from '../application/onboarding.js'
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
          answers: {
            identity: {
              answered: current.answers.identity.answered,
              value: current.answers.identity.value
                ? {
                    given_name: current.answers.identity.value.givenName,
                    family_name: current.answers.identity.value.familyName,
                    username: current.answers.identity.value.username,
                  }
                : null,
            },
            biological_sex: current.answers.biologicalSex,
            primary_training_goal: current.answers.primaryTrainingGoal,
            focus_areas: current.answers.focusAreas,
          },
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

  routes.post('/onboarding-attempts/:attemptId/biological-sex', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const attemptId = c.req.param('attemptId')
    if (!UUID_V7.test(attemptId)) return fail(c, 'invalid-request')

    const body = await readJson(c)
    const declaration = readBiologicalSex(body)
    const command = commandContext(c, body)
    if (!declaration || !command) return fail(c, 'invalid-request')

    try {
      const declared = await onboarding().declareBiologicalSex(token, {
        ...command,
        attemptId,
        biologicalSex: declaration.biologicalSex,
      })
      return c.json({ biological_sex: declared }, 200)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  // Not under the attempt: a profile claim outlives the onboarding, and the person
  // edits it from their profile long after the attempt closed.
  routes.post('/profile/claims', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const body = await readJson(c)
    const declaration = readProfileClaim(body)
    const command = commandContext(c, body)
    if (!declaration || !command) return fail(c, 'invalid-request')

    try {
      const claim = await onboarding().declareProfileClaim(token, {
        ...command,
        attributeCode: declaration.attributeCode,
        valueText: declaration.valueText,
      })
      return c.json(
        {
          attribute_code: claim.attributeCode,
          value_text: claim.valueText,
          superseded_claim_id: claim.supersededClaimId,
        },
        200,
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  // The emphasis needs its own route because it is a set: `OP-IDN-004` seals the
  // live claim of the same attribute before inserting, so posting three zones
  // there would have kept one and lost two in silence.
  routes.post('/profile/focus-areas', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const body = await readJson(c)
    const areas = readFocusAreas(body)
    const command = commandContext(c, body)
    if (!areas || !command) return fail(c, 'invalid-request')

    try {
      const declared = await onboarding().declareFocusAreas(token, { ...command, areas })
      return c.json({ areas: declared }, 200)
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

/**
 * Declining is not a value: the client that declines never sends this request.
 * Accepting one would create a third state to tell apart from "never asked".
 */
function readBiologicalSex(body: unknown): { biologicalSex: BiologicalSex | null } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'biological_sex') return undefined

  const value = (body as { biological_sex: unknown }).biological_sex
  if (value === null) return { biologicalSex: null }
  return value === 'male' || value === 'female' ? { biologicalSex: value } : undefined
}

/**
 * `improve_performance` is in the database catalogue but deferred out of the
 * initial V1 launch, so it is absent here and arrives as invalid-request.
 */
const TRAINING_GOALS: readonly PrimaryTrainingGoal[] = [
  'lose_weight',
  'build_muscle',
  'get_fit',
  'run_a_race',
  'maintain',
]

function readProfileClaim(
  body: unknown,
): { attributeCode: 'primary_training_goal'; valueText: PrimaryTrainingGoal } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body).sort()
  if (keys.length !== 2 || keys[0] !== 'attribute_code' || keys[1] !== 'value_text')
    return undefined

  const { attribute_code: code, value_text: value } = body as {
    attribute_code: unknown
    value_text: unknown
  }
  if (code !== 'primary_training_goal') return undefined
  if (typeof value !== 'string') return undefined
  return TRAINING_GOALS.includes(value as PrimaryTrainingGoal)
    ? { attributeCode: code, valueText: value as PrimaryTrainingGoal }
    : undefined
}

const FOCUS_AREAS: readonly FocusArea[] = [
  'chest',
  'back',
  'shoulders',
  'arms',
  'abs',
  'glutes',
  'legs',
  'whole_body',
]

/**
 * The whole set, and every reason to refuse it. The empty array is refused because
 * it would be indistinguishable from an unanswered step, and `whole_body` travels
 * alone because it means "no emphasis" — a set that both says no emphasis and
 * names a zone has no meaning to record.
 *
 * The database refuses all of this too. Checking here as well is not duplication
 * for its own sake: it is what turns a constraint violation into `400`.
 */
function readFocusAreas(body: unknown): readonly FocusArea[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body).sort()
  if (keys.length !== 1 || keys[0] !== 'areas') return undefined

  const { areas } = body as { areas: unknown }
  if (!Array.isArray(areas) || areas.length === 0 || areas.length > FOCUS_AREAS.length) {
    return undefined
  }
  if (!areas.every((area): area is FocusArea => FOCUS_AREAS.includes(area as FocusArea))) {
    return undefined
  }
  if (new Set(areas).size !== areas.length) return undefined
  if (areas.includes('whole_body') && areas.length > 1) return undefined
  return areas
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
  if (error instanceof OnboardingPreconditionError) return fail(c, error.code)
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'invalid-request')
  }
  console.error('[space-onboarding] operation failed')
  return fail(c, 'upstream-unavailable')
}
