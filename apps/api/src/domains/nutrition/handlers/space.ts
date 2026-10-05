/**
 * `/space/v1/nutrition`: the person's meals, their days and their goal (ADR-027).
 *
 * **A correction names the revision it read.** `If-Match` carries the strong validator
 * every read answers, `"nutrition-meal:{id}:r{n}"`; without it the request is 428, and a
 * stale one is 409 (OP-NUT-003). The validator must name the meal in the path, so a
 * header copied from another meal cannot correct this one.
 *
 * **Another person's meal is not found**, exactly as a missing one: a distinguishable
 * «forbidden» would let somebody learn which meals exist.
 *
 * Structure is checked here and answers 400; content — a nutrient in the wrong unit, a
 * range upside down, a photo that is not one — is PostgreSQL's or the sanitiser's to
 * refuse, and answers 422.
 *
 * **Recognising a photo needs consent** (ADR-041): without it the answer is 403
 * `consent-required`, and the app asks for it; a model that does not answer is 503, and
 * the app offers the search instead.
 */

import { createHash } from 'node:crypto'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { RecognitionError } from '@allfitone/food-recognition'
import { ObjectStoreError } from '@allfitone/object-store'
import { Hono, type Context } from 'hono'

import { authProvider } from '../../../platform/auth/index.js'
import { fail } from '../../../platform/http/index.js'
import {
  SpaceActorError,
  spaceActorResolver,
  type SpaceActorResolver,
} from '../../identity/index.js'
import { ConsentRequired, type SpaceNutritionService } from '../application/index.js'
import { spaceNutritionService } from '../dependencies.js'
import {
  PhotoRejected,
  type NutritionPhotoUpload,
  type NutritionMealCreate,
  type NutritionMealPatch,
  type SelfGoalCreate,
} from '../domain/index.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ETAG = /^"nutrition-meal:([0-9a-f-]{36}):r(\d+)"$/i
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'other'])
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const PATCH_KEYS = new Set([
  'occurred_at',
  'timezone',
  'meal_type',
  'note',
  'items',
  'photo',
  'remove_photo',
  'recognized_by',
])
const ORIGINS = new Set(['typed', 'catalog', 'photo'])
const MODEL_SLUG = /^[a-z0-9-]+\/[a-z0-9.-]+$/
const CONSENT_VERSION = /^\d{4}-\d{2}-\d{2}$/
const FOOD_LIMIT = { default: 20, max: 30 } as const
const MAX_PHOTO = 14_000_000
const LIST_LIMIT = { default: 50, max: 100 } as const
const MAX_DAYS = 31

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

const etagOf = (id: string, revision: number) => `"nutrition-meal:${id}:r${String(revision)}"`

export function spaceNutritionRoutes(
  injectedService?: SpaceNutritionService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
): Hono {
  const nutrition = () => injectedService ?? spaceNutritionService()
  const actors = () => injectedActors ?? spaceActorResolver()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()
  const requestId = (c: Context) => c.req.header('x-request-id') ?? ''

  // Every route but the reads is a command; this resolves the person or answers.
  const person = async (c: Context): Promise<string | Response> => {
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')
    try {
      return await actors().personFor(token.subject)
    } catch (cause) {
      return failure(c, cause)
    }
  }

  routes.post('/nutrition/meals', async (c) => {
    c.header('Cache-Control', 'no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    const body = await readJson(c)
    const meal = readMealCreate(body)
    const command = commandContext(c, body)
    if (!meal || !command) return fail(c, 'invalid-request')

    try {
      const recorded = await nutrition().recordMeal({ personId, meal, ...command })
      // A replay of a meal deleted since: what that command made no longer exists.
      if (!recorded) return fail(c, 'conflict', 'The meal this command recorded was deleted')
      c.header('ETag', etagOf(recorded.id, recorded.revision_number))
      c.header('Location', `/space/v1/nutrition/meals/${recorded.id}`)
      return c.json(recorded, 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/nutrition/meals', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    const from = c.req.query('from') ?? ''
    const to = c.req.query('to') ?? ''
    const cursor = c.req.query('cursor') ?? null
    const rawLimit = c.req.query('limit')
    const limit = rawLimit === undefined ? LIST_LIMIT.default : Number(rawLimit)
    if (!isDate(from) || !isDate(to) || to < from) return fail(c, 'invalid-request')
    if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT.max)
      return fail(c, 'invalid-request')
    if (cursor !== null && (cursor.length < 16 || cursor.length > 1024))
      return fail(c, 'invalid-request')

    try {
      return c.json(
        await nutrition().listMeals({ personId, from, to, cursor, limit, requestId: requestId(c) }),
        200,
      )
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/nutrition/meals/:mealId', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId
    const mealId = c.req.param('mealId')
    if (!UUID.test(mealId)) return fail(c, 'not-found')

    try {
      const meal = await nutrition().readMeal({ personId, mealId, requestId: requestId(c) })
      if (!meal) return fail(c, 'not-found')
      c.header('ETag', etagOf(meal.id, meal.revision_number))
      return c.json(meal, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.patch('/nutrition/meals/:mealId', async (c) => {
    c.header('Cache-Control', 'no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId
    const mealId = c.req.param('mealId')

    const ifMatch = c.req.header('if-match')
    if (!ifMatch) return fail(c, 'precondition-required')
    const matched = ETAG.exec(ifMatch)
    if (!matched || matched[1]?.toLowerCase() !== mealId.toLowerCase())
      return fail(c, 'invalid-request')
    const revision = Number(matched[2])

    const body = await readJson(c)
    const patch = readMealPatch(body)
    const command = commandContext(c, body)
    if (!UUID.test(mealId) || !patch || !command) return fail(c, 'invalid-request')

    try {
      const revised = await nutrition().reviseMeal({
        personId,
        mealId,
        revision,
        patch,
        ...command,
      })
      c.header('ETag', etagOf(revised.id, revised.revision_number))
      return c.json(revised, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.delete('/nutrition/meals/:mealId', async (c) => {
    c.header('Cache-Control', 'no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId
    const mealId = c.req.param('mealId')
    const command = commandContext(c, { meal: mealId })
    if (!UUID.test(mealId) || !command) return fail(c, 'invalid-request')

    try {
      await nutrition().deleteMeal({ personId, mealId, ...command })
      return c.body(null, 204)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/nutrition/daily-summaries', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    const from = c.req.query('from') ?? ''
    const to = c.req.query('to') ?? ''
    const timezone = (c.req.query('timezone') ?? '').trim() || null
    if (!isDate(from) || !isDate(to) || to < from || daysBetween(from, to) >= MAX_DAYS) {
      return fail(c, 'invalid-request')
    }
    if (timezone !== null && timezone.length > 64) return fail(c, 'invalid-request')

    try {
      return c.json(
        await nutrition().readDailySummaries({
          personId,
          from,
          to,
          timezone,
          requestId: requestId(c),
        }),
        200,
      )
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/nutrition/goals', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId
    try {
      return c.json(await nutrition().readGoals({ personId, requestId: requestId(c) }), 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/nutrition/goals/versions', async (c) => {
    c.header('Cache-Control', 'no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    const body = await readJson(c)
    const goal = readGoal(body)
    const command = commandContext(c, body)
    if (!goal || !command) return fail(c, 'invalid-request')

    try {
      return c.json(await nutrition().publishGoal({ personId, goal, ...command }), 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/nutrition/goal-versions/:goalVersionId/decision', async (c) => {
    c.header('Cache-Control', 'no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    const goalVersionId = c.req.param('goalVersionId')
    const body = await readJson(c)
    const decision = readDecision(body)
    const command = commandContext(c, body)
    if (!UUID.test(goalVersionId) || !decision || !command) return fail(c, 'invalid-request')

    try {
      return c.json(
        await nutrition().decideGoal({ personId, goalVersionId, decision, ...command }),
        200,
      )
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/nutrition/foods', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    const query = (c.req.query('q') ?? '').trim()
    const rawLimit = c.req.query('limit')
    const limit = rawLimit === undefined ? FOOD_LIMIT.default : Number(rawLimit)
    if (query.length < 1 || query.length > 80) return fail(c, 'invalid-request')
    if (!Number.isInteger(limit) || limit < 1 || limit > FOOD_LIMIT.max)
      return fail(c, 'invalid-request')

    try {
      return c.json(
        await nutrition().searchFoods({ personId, query, limit, requestId: requestId(c) }),
        200,
      )
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/nutrition/foods/frequent', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId
    try {
      return c.json(await nutrition().frequentFoods({ personId, requestId: requestId(c) }), 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/nutrition/recognitions', async (c) => {
    c.header('Cache-Control', 'no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    const body = await readJson(c)
    const photo =
      isObject(body) && Object.keys(body).length === 1 ? readPhoto(body.photo) : undefined
    if (!photo) return fail(c, 'invalid-request')

    try {
      return c.json(await nutrition().recognize({ personId, photo, requestId: requestId(c) }), 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/nutrition/recognition-consent', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId
    try {
      return c.json(await nutrition().readConsent({ personId, requestId: requestId(c) }), 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.put('/nutrition/recognition-consent', async (c) => {
    c.header('Cache-Control', 'no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    const body = await readJson(c)
    const version =
      isObject(body) &&
      Object.keys(body).length === 1 &&
      typeof body.version === 'string' &&
      CONSENT_VERSION.test(body.version)
        ? body.version
        : undefined
    const command = commandContext(c, body)
    if (!version || !command) return fail(c, 'invalid-request')

    try {
      return c.json(await nutrition().acceptConsent({ personId, version, ...command }), 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  return routes
}

function failure(c: Context, cause: unknown): Response {
  if (cause instanceof SpaceActorError) return fail(c, 'forbidden')
  if (cause instanceof ConsentRequired) return fail(c, 'consent-required')
  if (cause instanceof RecognitionError) {
    console.warn('[nutrition] recognition failed', { failure: cause.failure })
    return fail(c, 'upstream-unavailable', 'The photo could not be recognised')
  }
  if (cause instanceof PhotoRejected)
    return fail(c, 'validation-failed', 'The photo could not be read')
  if (cause instanceof ObjectStoreError) {
    console.warn('[nutrition] object store failed', { operation: cause.operation })
    return fail(c, 'upstream-unavailable')
  }
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code: unknown }).code
    console.warn('[nutrition] space command refused', { code, detail: String(cause).slice(0, 160) })
    if (code === '42501') return fail(c, 'not-found')
    if (code === '40001') return fail(c, 'stale-draft')
    if (code === '23505') return fail(c, 'conflict')
    if (
      code === '23514' ||
      code === '22023' ||
      code === '22P02' ||
      code === '22007' ||
      code === '22008'
    ) {
      return fail(c, 'validation-failed')
    }
  }
  console.warn('[nutrition] space request failed', { detail: String(cause).slice(0, 160) })
  return fail(c, 'upstream-unavailable')
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const header = c.req.header('authorization')
  const [scheme, value] = header?.split(' ') ?? []
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined
  try {
    return await verify(value)
  } catch {
    return undefined
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))

/** A calendar date that exists: `2026-09-31` is a shape, not a day. */
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

const isOptionalId = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && UUID.test(value))

/** Items as the contract shapes them; their content is the database's to judge. */
function readItems(value: unknown): NutritionMealCreate['items'] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return undefined
  const valid = value.every(
    (item) =>
      isObject(item) &&
      Number.isInteger(item.position) &&
      typeof item.name === 'string' &&
      (item.quantity === null || typeof item.quantity === 'number') &&
      (item.quantity_unit === null || typeof item.quantity_unit === 'string') &&
      isOptionalId(item.food_id) &&
      isOptionalId(item.product_id) &&
      (item.origin === undefined ||
        (typeof item.origin === 'string' && ORIGINS.has(item.origin))) &&
      Array.isArray(item.nutrients) &&
      item.nutrients.length <= 32 &&
      item.nutrients.every(
        (nutrient: unknown) =>
          isObject(nutrient) &&
          typeof nutrient.nutrient_code === 'string' &&
          typeof nutrient.value === 'number' &&
          typeof nutrient.unit === 'string',
      ),
  )
  return valid ? (value as NutritionMealCreate['items']) : undefined
}

function readMealCreate(body: unknown): NutritionMealCreate | undefined {
  if (!isObject(body)) return undefined
  const allowed = new Set([
    'occurred_at',
    'timezone',
    'meal_type',
    'note',
    'items',
    'recognized_by',
  ])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined
  if (!isInstant(body.occurred_at) || typeof body.timezone !== 'string') return undefined
  if (typeof body.meal_type !== 'string' || !MEAL_TYPES.has(body.meal_type)) return undefined
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string')
    return undefined
  if (!readItems(body.items)) return undefined
  if (!isModel(body.recognized_by)) return undefined
  return body as unknown as NutritionMealCreate
}

function readMealPatch(body: unknown): NutritionMealPatch | undefined {
  if (!isObject(body)) return undefined
  const keys = Object.keys(body)
  if (keys.length === 0 || keys.some((key) => !PATCH_KEYS.has(key))) return undefined
  if (
    body.meal_type !== undefined &&
    (typeof body.meal_type !== 'string' || !MEAL_TYPES.has(body.meal_type))
  ) {
    return undefined
  }
  if (body.occurred_at !== undefined && !isInstant(body.occurred_at)) return undefined
  if (body.items !== undefined && !readItems(body.items)) return undefined
  if (body.remove_photo !== undefined && typeof body.remove_photo !== 'boolean') return undefined
  if (body.photo !== undefined && body.photo !== null && !readPhoto(body.photo)) return undefined
  if (!isModel(body.recognized_by)) return undefined
  return body as unknown as NutritionMealPatch
}

const isModel = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.length <= 120 && MODEL_SLUG.test(value))

/** A photo as the contract carries it: a supported type and a bounded base64 payload. */
function readPhoto(value: unknown): NutritionPhotoUpload | undefined {
  if (
    !isObject(value) ||
    typeof value.content_type !== 'string' ||
    !PHOTO_TYPES.has(value.content_type)
  ) {
    return undefined
  }
  if (
    typeof value.content !== 'string' ||
    value.content.length === 0 ||
    value.content.length > MAX_PHOTO
  ) {
    return undefined
  }
  return value as unknown as NutritionPhotoUpload
}

function readGoal(body: unknown): SelfGoalCreate | undefined {
  if (!isObject(body) || !Array.isArray(body.targets)) return undefined
  if (body.targets.length < 1 || body.targets.length > 6) return undefined
  if (body.rationale !== undefined && body.rationale !== null && typeof body.rationale !== 'string')
    return undefined
  const valid = body.targets.every(
    (target: unknown) =>
      isObject(target) &&
      typeof target.nutrient_code === 'string' &&
      typeof target.mode === 'string' &&
      typeof target.unit === 'string' &&
      ['minimum', 'maximum', 'exact'].every(
        (field) => target[field] === null || typeof target[field] === 'number',
      ),
  )
  return valid ? (body as unknown as SelfGoalCreate) : undefined
}

function readDecision(body: unknown): 'accepted' | 'rejected' | undefined {
  if (!isObject(body) || Object.keys(body).length !== 1) return undefined
  return body.decision === 'accepted' || body.decision === 'rejected' ? body.decision : undefined
}

function commandContext(c: Context, body: unknown) {
  const idempotencyKey = c.req.header('idempotency-key') ?? ''
  const commandId = c.req.header('command-id') ?? ''
  if (!UUID_V4.test(idempotencyKey) || !UUID.test(commandId)) return undefined
  return {
    idempotencyKey,
    commandId,
    requestHash: createHash('sha256').update(canonicalJson(body)).digest(),
  }
}

/** Key order must not change the hash: the same request has to replay as the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
