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

import type {
  BiologicalSex,
  BodyProgressDeclaration,
  FocusArea,
  LengthUnit,
  MassUnit,
  PrimaryTrainingGoal,
  ProfileClaimDeclaration,
  TrainingDiscipline,
  TrainingExperience,
} from '../domain/index.js'
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
            training_discipline: current.answers.trainingDiscipline,
            training_experience: current.answers.trainingExperience,
            focus_areas: current.answers.focusAreas,
            body_measures: {
              answered: current.answers.bodyMeasures.answered,
              value: current.answers.bodyMeasures.value
                ? {
                    weight: side(current.answers.bodyMeasures.value.weight),
                    height: side(current.answers.bodyMeasures.value.height),
                  }
                : null,
            },
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
      const claim = await onboarding().declareProfileClaim(token, { ...command, ...declaration })
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

  // One measurement per call: OP-IDN-006 fixes the record's id as the Command-Id, so
  // weight and height are two commands. They are independent measurements anyway.
  routes.post('/body-progress', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const body = await readJson(c)
    const declaration = readBodyProgress(body)
    const command = commandContext(c, body)
    if (!declaration || !command) return fail(c, 'invalid-request')

    try {
      const record = await onboarding().recordBodyProgress(token, { ...command, ...declaration })
      return c.json(
        {
          id: record.id,
          metric_code: record.metricCode,
          value: record.value,
          unit: record.unit,
          original_value: record.originalValue,
          original_unit: record.originalUnit,
        },
        200,
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  // The only route that takes a Fitness ID to `active`. It does not create the person:
  // the row has been in `pending_activation` since the name was given.
  routes.post('/onboarding-attempts/:attemptId/completion', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const attemptId = c.req.param('attemptId')
    if (!UUID_V7.test(attemptId)) return fail(c, 'invalid-request')

    const body = await readJson(c)
    const completion = readCompletion(body)
    const command = commandContext(c, body)
    if (!completion || !command) return fail(c, 'invalid-request')

    try {
      const personId = await onboarding().complete(token, { ...command, attemptId, ...completion })
      return c.json({ person_id: personId }, 200)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  // Skipping carries no idempotency headers: the record's primary key is the whole
  // guarantee, and there is no body a replay could contradict.
  routes.post('/onboarding-attempts/:attemptId/skips', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const attemptId = c.req.param('attemptId')
    if (!UUID_V7.test(attemptId)) return fail(c, 'invalid-request')

    const stepCode = readSkip(await readJson(c))
    if (!stepCode) return fail(c, 'invalid-request')

    try {
      await onboarding().skipStep(token, { attemptId, stepCode })
      return c.body(null, 204)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

/** The answer shape the wire uses, which differs only in the key casing. */
function side(
  measure: { value: number; unit: string; originalUnit: string | null } | null,
): { value: number; unit: string; original_unit: string | null } | null {
  if (!measure) return null
  return { value: measure.value, unit: measure.unit, original_unit: measure.originalUnit }
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

const TRAINING_EXPERIENCE: readonly TrainingExperience[] = [
  'starting',
  'some_practice',
  'experienced',
]

/**
 * The catalogue holds six disciplines and only this one is ready, so the other five
 * arrive as invalid-request — the same shape of decision as `improve_performance`.
 * They are drawn in the onboarding and cannot be chosen, which is why refusing them
 * here is the honest answer rather than a gap.
 */
const TRAINING_DISCIPLINES: readonly TrainingDiscipline[] = ['strength']

/**
 * One variant per member of the attribute catalogue, and the pairing is checked
 * rather than assumed: a goal code carrying an experience value is refused here as
 * well as by the database, which is what makes it a `400` instead of a constraint
 * violation.
 */
function readProfileClaim(body: unknown): ProfileClaimDeclaration | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body).sort()
  if (keys.length !== 2 || keys[0] !== 'attribute_code' || keys[1] !== 'value_text')
    return undefined

  const { attribute_code: code, value_text: value } = body as {
    attribute_code: unknown
    value_text: unknown
  }
  if (typeof value !== 'string') return undefined

  if (code === 'primary_training_goal') {
    return TRAINING_GOALS.includes(value as PrimaryTrainingGoal)
      ? { attributeCode: code, valueText: value as PrimaryTrainingGoal }
      : undefined
  }
  if (code === 'training_experience') {
    return TRAINING_EXPERIENCE.includes(value as TrainingExperience)
      ? { attributeCode: code, valueText: value as TrainingExperience }
      : undefined
  }
  if (code === 'training_discipline') {
    return TRAINING_DISCIPLINES.includes(value as TrainingDiscipline)
      ? { attributeCode: code, valueText: value as TrainingDiscipline }
      : undefined
  }
  return undefined
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

/**
 * The acceptances have to be `true`. A `false` is not a way to decline here — that
 * happens at the terms step, by not going on — it is an attempt to activate without
 * accepting, and the database refuses it anyway.
 */
function readCompletion(body: unknown):
  | {
      givenName: string
      familyName: string
      termsAccepted: boolean
      privacyNoticeAccepted: boolean
    }
  | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body).sort()
  if (keys.length !== 4) return undefined
  if (keys[0] !== 'family_name' || keys[1] !== 'given_name') return undefined
  if (keys[2] !== 'privacy_notice_accepted' || keys[3] !== 'terms_accepted') return undefined

  const {
    given_name: given,
    family_name: family,
    terms_accepted: terms,
    privacy_notice_accepted: privacy,
  } = body as {
    given_name: unknown
    family_name: unknown
    terms_accepted: unknown
    privacy_notice_accepted: unknown
  }

  const givenName = trimmedName(given)
  const familyName = trimmedName(family)
  if (!givenName || !familyName) return undefined
  if (terms !== true || privacy !== true) return undefined
  return { givenName, familyName, termsAccepted: true, privacyNoticeAccepted: true }
}

const MASS_UNITS: readonly MassUnit[] = ['kg', 'lb']
const LENGTH_UNITS: readonly LengthUnit[] = ['cm', 'in']

/** Steps `HU-SP-015` allows skipping. Never the age, the name or the terms. */
const SKIPPABLE_STEPS: readonly string[] = ['body_measures']

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * One variant per metric, and the unit has to belong to the metric's dimension. The
 * database refuses a weight in centimetres too; refusing it here is what makes it a
 * `400` rather than a constraint violation.
 */
function readBodyProgress(body: unknown): BodyProgressDeclaration | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body).sort()
  if (keys.length !== 4) return undefined
  if (keys[0] !== 'measured_on' || keys[1] !== 'metric_code') return undefined
  if (keys[2] !== 'unit' || keys[3] !== 'value') return undefined

  const {
    metric_code: metric,
    value,
    unit,
    measured_on: measuredOn,
  } = body as { metric_code: unknown; value: unknown; unit: unknown; measured_on: unknown }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  if (typeof unit !== 'string') return undefined
  if (typeof measuredOn !== 'string' || !ISO_DATE.test(measuredOn)) return undefined
  if (Number.isNaN(Date.parse(measuredOn))) return undefined

  if (metric === 'body_weight') {
    return MASS_UNITS.includes(unit as MassUnit)
      ? { metricCode: metric, value, unit: unit as MassUnit, measuredOn }
      : undefined
  }
  if (metric === 'body_height') {
    return LENGTH_UNITS.includes(unit as LengthUnit)
      ? { metricCode: metric, value, unit: unit as LengthUnit, measuredOn }
      : undefined
  }
  return undefined
}

function readSkip(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'step_code') return undefined
  const { step_code: step } = body as { step_code: unknown }
  return typeof step === 'string' && SKIPPABLE_STEPS.includes(step) ? step : undefined
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
