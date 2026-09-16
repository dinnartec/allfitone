/**
 * A person's meals: `OP-NUT-001`, `OP-NUT-002`, `OP-NUT-004`.
 *
 * The vocabularies are repeated here only so a malformed request is answered 422 before it
 * reaches the database. Which person the token belongs to, the day a meal falls on and the
 * disposition a deletion leaves behind are all decided in PostgreSQL.
 *
 * The database projects a meal once, with whether it has a photo. The owner's view turns that
 * into the contract's `photo`; support's view keeps only the flag.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type NutritionMeal = AllfitV1Schemas['NutritionMeal']
export type NutritionMealItem = AllfitV1Schemas['NutritionMealItem']
export type NutrientValue = AllfitV1Schemas['NutrientValue']
export type MealType = AllfitV1Schemas['MealType']
export type NutrientCode = AllfitV1Schemas['NutrientCode']
/** What the database returns for a meal, before either surface shapes it. */
export type MealRecord = AllfitV1Schemas['BreakGlassMeal']

/** What travels to the database: an absent note is null, never missing. */
export interface MealRecording {
  occurred_at: string
  timezone: string
  meal_type: MealType
  note: string | null
  items: NutritionMealItem[]
}

export interface MealDeletion {
  meal_id: string
  disposition_case_id: string
  status: 'deleted'
}

export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other']

/** Each nutrient is written in exactly one unit. */
export const NUTRIENT_UNITS: Readonly<Record<NutrientCode, NutrientValue['unit']>> = {
  energy: 'kcal',
  protein: 'g',
  carbohydrates: 'g',
  fat: 'g',
  fiber: 'g',
  water: 'ml',
}

export const MAX_MEAL_ITEMS = 100
export const MAX_ITEM_NAME = 160
export const MAX_QUANTITY_UNIT = 16
export const MAX_MEAL_NOTE = 1000
export const MAX_MEAL_PAGE = 100
export const DEFAULT_MEAL_PAGE = 25
/** Inclusive: `to - from` is at most thirty days. */
export const MAX_MEAL_RANGE_DAYS = 31

export interface MealCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
  requestId: string
}

export interface MealResult<T> {
  resource: T
  replayed: boolean
}

export interface MealHolder {
  issuer: string
  subject: string
}

export interface MealCursor {
  occurredAt: string
  id: string
}

export interface MealListInput {
  from: string
  to: string
  limit: number
  before?: MealCursor
}

export interface MealRecordPage {
  items: MealRecord[]
  has_more: boolean
}

export interface MealDatabase {
  list(input: MealHolder & MealListInput & { requestId: string }): Promise<MealRecordPage>
  record(
    input: MealHolder & MealCommand & { mealId: string; meal: MealRecording },
  ): Promise<MealResult<MealRecord>>
  delete(input: MealHolder & MealCommand & { mealId: string }): Promise<MealResult<MealDeletion>>
}
