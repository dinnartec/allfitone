/**
 * Meal routes on /space/v1: `OP-NUT-001`, `OP-NUT-002`, `OP-NUT-004`.
 *
 * `HU-SP-067`, `HU-SP-068`, `HU-SP-070`. The token is verified here and resolved to a person
 * in the database; nothing in a request can name whose meals these are. The `Command-Id` of a
 * recording is the meal's own identifier, so a device can record offline and send it later.
 *
 * Revising a meal (`OP-NUT-003`) is not mounted: it is not built, and an absent route is more
 * honest than one that fails. A photo is not accepted either, so a body carrying one is
 * refused rather than stored without it.
 *
 * A page is a range of local days. Its cursor names the range it came from, so it cannot
 * continue a different query by accident.
 */

import { Hono, type Context } from 'hono'

import { problem } from '../../../platform/http/index.js'
import {
  UUID_V7,
  exactObject,
  isCalendarDate,
  isInstant,
  isJsonRequest,
  onlyQueryKeys,
  pageSize,
  readJson,
  spaceCommand,
  spaceFailure,
  spaceTokenVerifier,
  verifiedSpaceToken,
  type TokenVerifier,
} from '../../../platform/http/space-requests.js'
import type { MealService } from '../application/meals.js'
import { spaceMealService } from '../dependencies.js'
import {
  DEFAULT_MEAL_PAGE,
  MAX_ITEM_NAME,
  MAX_MEAL_ITEMS,
  MAX_MEAL_NOTE,
  MAX_MEAL_PAGE,
  MAX_MEAL_RANGE_DAYS,
  MAX_QUANTITY_UNIT,
  MEAL_TYPES,
  NUTRIENT_UNITS,
  type MealListInput,
  type MealRecording,
  type MealType,
  type NutrientCode,
  type NutrientValue,
  type NutritionMeal,
  type NutritionMealItem,
} from '../domain/meals.js'

const LIST_PARAMETERS = new Set(['from', 'to', 'limit', 'cursor'])
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/
const DAY_MS = 86_400_000
const OPERATION = 'space-meals'

export function spaceMealRoutes(
  injectedService?: MealService,
  injectedVerifier?: TokenVerifier,
): Hono {
  const meals = () => injectedService ?? spaceMealService()
  const verify = injectedVerifier ?? spaceTokenVerifier()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
  })

  routes.get('/nutrition/meals', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const query = listInput(c)
    if (!query) return problem(c, 'invalid-request')

    try {
      const page = await meals().list(token, query)
      const last = page.meals.at(-1)
      c.header('Cache-Control', 'private, no-store')
      return c.json({
        data: page.meals,
        page: {
          has_more: page.hasMore,
          next_cursor: page.hasMore && last ? encodeCursor(query, last) : null,
        },
      })
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.post('/nutrition/meals', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    if (!isJsonRequest(c)) return problem(c, 'unsupported-media-type')
    const meal = recording(await readJson(c))
    if (!meal) return problem(c, 'validation-failed')
    const command = spaceCommand(c, meal)
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await meals().record(token, { ...command, mealId: command.commandId, meal })
      const recorded = result.resource
      c.header('Location', `/space/v1/nutrition/meals/${recorded.id}`)
      c.header('ETag', `"nutrition-meal:${recorded.id}:r${recorded.revision_number}"`)
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(recorded, 201)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.delete('/nutrition/meals/:mealId', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const mealId = c.req.param('mealId')
    if (!UUID_V7.test(mealId)) return problem(c, 'invalid-request')
    const command = spaceCommand(c, { mealId })
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await meals().delete(token, { ...command, mealId })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.body(null, 204)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  return routes
}

function listInput(c: Context): MealListInput | undefined {
  if (!onlyQueryKeys(c, LIST_PARAMETERS)) return undefined
  const from = c.req.query('from')
  const to = c.req.query('to')
  if (from === undefined || to === undefined) return undefined
  if (!isCalendarDate(from) || !isCalendarDate(to)) return undefined
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
  if (span < 0 || span >= MAX_MEAL_RANGE_DAYS) return undefined
  const limit = pageSize(c.req.query('limit'), MAX_MEAL_PAGE, DEFAULT_MEAL_PAGE)
  if (limit === undefined) return undefined

  const cursor = c.req.query('cursor')
  if (cursor === undefined) return { from, to, limit }
  const before = decodeCursor(cursor, from, to)
  return before ? { from, to, limit, before } : undefined
}

function encodeCursor(query: MealListInput, last: NutritionMeal): string {
  return Buffer.from(
    JSON.stringify({ from: query.from, to: query.to, occurred_at: last.occurred_at, id: last.id }),
  ).toString('base64url')
}

function decodeCursor(value: string, from: string, to: string): MealListInput['before'] {
  if (value.length < 16 || value.length > 1024) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    const fields = exactObject(parsed, ['from', 'to', 'occurred_at', 'id'])
    if (!fields || fields.from !== from || fields.to !== to) return undefined
    const { occurred_at: occurredAt, id } = fields
    if (typeof occurredAt !== 'string' || !isInstant(occurredAt)) return undefined
    if (typeof id !== 'string' || !UUID_V7.test(id)) return undefined
    return { occurredAt, id }
  } catch {
    return undefined
  }
}

function recording(body: unknown): MealRecording | undefined {
  const fields = exactObject(body, ['occurred_at', 'timezone', 'meal_type', 'items'], ['note'])
  if (!fields) return undefined

  const { occurred_at: occurredAt, timezone, meal_type: type, items } = fields
  const note = fields.note ?? null
  if (typeof occurredAt !== 'string' || !isInstant(occurredAt)) return undefined
  if (
    typeof timezone !== 'string' ||
    timezone.length < 3 ||
    timezone.length > 100 ||
    !TIME_ZONE.test(timezone)
  ) {
    return undefined
  }
  if (!MEAL_TYPES.includes(type as MealType)) return undefined
  if (
    note !== null &&
    (typeof note !== 'string' || note.trim() === '' || note.length > MAX_MEAL_NOTE)
  ) {
    return undefined
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_MEAL_ITEMS) {
    return undefined
  }

  const parsed: NutritionMealItem[] = []
  const positions = new Set<number>()
  for (const entry of items) {
    const item = mealItem(entry)
    if (!item || positions.has(item.position)) return undefined
    positions.add(item.position)
    parsed.push(item)
  }
  return {
    occurred_at: occurredAt,
    timezone,
    meal_type: type as MealType,
    note: note as string | null,
    items: parsed,
  }
}

function mealItem(entry: unknown): NutritionMealItem | undefined {
  const fields = exactObject(entry, ['position', 'name', 'quantity', 'quantity_unit', 'nutrients'])
  if (!fields) return undefined

  const { position, name, quantity, quantity_unit: unit, nutrients } = fields
  if (typeof position !== 'number' || !Number.isInteger(position)) return undefined
  if (position < 1 || position > MAX_MEAL_ITEMS) return undefined
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_ITEM_NAME) {
    return undefined
  }
  if (!Array.isArray(nutrients)) return undefined

  const values: NutrientValue[] = []
  const codes = new Set<string>()
  for (const candidate of nutrients) {
    const value = nutrientValue(candidate)
    if (!value || codes.has(value.nutrient_code)) return undefined
    codes.add(value.nutrient_code)
    values.push(value)
  }

  if (quantity === null && unit === null) {
    return { position, name, quantity: null, quantity_unit: null, nutrients: values }
  }
  if (
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    typeof unit !== 'string' ||
    unit === '' ||
    unit.length > MAX_QUANTITY_UNIT
  ) {
    return undefined
  }
  return { position, name, quantity, quantity_unit: unit, nutrients: values }
}

function nutrientValue(candidate: unknown): NutrientValue | undefined {
  const fields = exactObject(candidate, ['nutrient_code', 'value', 'unit'])
  if (!fields) return undefined

  const { nutrient_code: code, value, unit } = fields
  if (typeof code !== 'string' || !Object.hasOwn(NUTRIENT_UNITS, code)) return undefined
  if (unit !== NUTRIENT_UNITS[code as NutrientCode]) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return { nutrient_code: code, value, unit } as NutrientValue
}
