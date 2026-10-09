/**
 * A meal captured from a photo or a search (R-F, R-A, ADR-041), before it is saved.
 *
 * **Every number on screen is the catalogue's**, scaled to the grams: a recognised item
 * only brings a name, an amount and where it sits; its nutrients are its food's per
 * 100 g. What the person types over a value is theirs — «Editado por ti» — and survives a
 * change of amount; «Volver a lo calculado» drops it. With no catalogue food, the model's
 * estimate stands in, scaled the same way and said as «Estimado con IA» (ADR-041 as
 * amended); with neither, the item shows nothing rather than zero and asks to be chosen.
 *
 * Kept free of React and fetch so the test runner can hold it to that.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import { nutrientValue } from '@allfitone/contracts/nutrients'

import { choiceFor, servingText, toGrams, type AmountMode, type UnitChoice } from './amount'
import type { MealCreate, MealType, NutrientCode } from './nutrition'

export type Food = AllfitV1Schemas['NutritionFood']
export type FrequentFood = AllfitV1Schemas['NutritionFrequentFood']
export type Recognition = AllfitV1Schemas['NutritionRecognition']
export type RecognitionConsent = AllfitV1Schemas['NutritionRecognitionConsent']
export type Values = Partial<Record<NutrientCode, number>>

export interface CaptureItem {
  readonly key: string
  readonly name: string
  readonly food: Food | null
  /** The model's values per 100 g, kept only while no catalogue food is chosen. */
  readonly estimate: Values | null
  /** A DS food icon: the food's, else the group the model saw, else the generic one. */
  readonly icon: string
  readonly grams: number
  /** How much, in which unit and written how: what the grams came from and read back as. */
  readonly amount: number
  readonly unit: UnitChoice
  readonly mode: AmountMode
  readonly origin: 'photo' | 'catalog'
  /** Asks «¿Es esto?»: unsure, unmatched, or a whole dish beside its parts. */
  readonly review: boolean
  readonly at: { readonly x: number; readonly y: number } | null
  /** What the person typed over the calculated values. */
  readonly edited: Values
}

const tenth = (value: number) => Math.round(value * 10) / 10
let sequence = 0
const nextKey = () => `item-${String((sequence += 1))}`

const capitalised = (name: string) => name.charAt(0).toLocaleUpperCase('es-CO') + name.slice(1)

/** Grams in the food's measure when they fit one, written as a fraction there, else in grams. */
function measured(food: Food | null, grams: number) {
  const { amount, unit } = choiceFor(food, grams)
  return { grams, amount, unit, mode: unit.countable ? ('fraction' as const) : ('number' as const) }
}

/** A food's values for some grams, to a tenth. */
export function calculated(food: Food | null, grams: number): Values {
  const values: Values = {}
  for (const nutrient of food?.nutrients ?? []) {
    values[nutrient.nutrient_code] = tenth((nutrient.value_per_100g * grams) / 100)
  }
  return values
}

const GENERIC_ICON = 'nutrition'

export const isEstimated = (item: CaptureItem): boolean => !item.food && item.estimate !== null

/** An item's values for its grams: from its food, else from the estimate. */
export function itemCalculated(item: CaptureItem): Values {
  if (item.food || !item.estimate) return calculated(item.food, item.grams)
  const values: Values = {}
  for (const [code, value] of Object.entries(item.estimate) as [NutrientCode, number][]) {
    values[code] = tenth((value * item.grams) / 100)
  }
  return values
}

/** What an item shows: the calculated values, with what the person typed on top. */
export const shownValues = (item: CaptureItem): Values => ({
  ...itemCalculated(item),
  ...item.edited,
})

type RecognizedItem = Recognition['items'][number]

/** The estimate the API sent for the recognised grams, brought back to 100 g. */
function estimatePer100g(item: RecognizedItem): Values | null {
  if (!item.estimated || item.nutrients.length === 0) return null
  const values: Values = {}
  for (const nutrient of item.nutrients) {
    values[nutrient.nutrient_code] = (nutrient.value * 100) / item.grams
  }
  return values
}

export function fromRecognition(recognition: Recognition): CaptureItem[] {
  return recognition.items.map((item) => ({
    key: nextKey(),
    name: item.food?.name ?? capitalised(item.name),
    food: item.food,
    estimate: item.food ? null : estimatePer100g(item),
    icon: item.food?.icon ?? item.icon ?? GENERIC_ICON,
    ...measured(item.food, item.grams),
    origin: 'photo',
    review: item.needs_review,
    at: item.at,
    edited: {},
  }))
}

/** A food picked from the catalogue, at its default portion unless an amount is given. */
export function fromFood(food: Food, grams?: number): CaptureItem {
  const portion = food.portions.find((one) => one.is_default) ?? food.portions[0]
  return {
    key: nextKey(),
    name: food.name,
    food,
    estimate: null,
    icon: food.icon,
    ...measured(food, grams ?? portion?.grams ?? 100),
    origin: 'catalog',
    review: false,
    at: null,
    edited: {},
  }
}

export const withGrams = (item: CaptureItem, grams: number): CaptureItem => ({
  ...item,
  ...measured(item.food, grams),
})

/** An amount typed in a unit: the grams follow, and it reads back as it was typed. */
export const withAmount = (
  item: CaptureItem,
  amount: number,
  unit: UnitChoice,
  mode: AmountMode,
): CaptureItem => ({ ...item, amount, unit, mode, grams: toGrams(amount, unit) })
export const withEdit = (item: CaptureItem, code: NutrientCode, value: number): CaptureItem => ({
  ...item,
  edited: { ...item.edited, [code]: value },
})
export const restoreCalculated = (item: CaptureItem): CaptureItem => ({ ...item, edited: {} })

/** Another food for the same item: edits and the estimate were about the old one, and go. */
export const withFood = (item: CaptureItem, food: Food): CaptureItem => ({
  ...item,
  name: food.name,
  food,
  estimate: null,
  icon: food.icon,
  ...measured(food, item.grams),
  review: false,
  edited: {},
})

/** The meal's total, of what every item shows; a nutrient nobody shows stays absent. */
export function captureTotals(items: readonly CaptureItem[]): Values {
  const totals: Values = {}
  for (const item of items) {
    for (const [code, value] of Object.entries(shownValues(item)) as [NutrientCode, number][]) {
      totals[code] = tenth((totals[code] ?? 0) + value)
    }
  }
  return totals
}

/** How the amount reads: «1 ½ tazas», «210 ml», «75 g». */
export const portionText = (item: CaptureItem): string =>
  servingText(item.amount, item.unit, item.mode)

/** The meal as `OP-NUT-001` takes it: each item with its origin, food, grams and values. */
export function mealFromCapture(input: {
  readonly items: readonly CaptureItem[]
  readonly mealType: MealType
  readonly occurredAt: string
  readonly timezone: string
  readonly recognizedBy: string | null
}): MealCreate {
  return {
    occurred_at: input.occurredAt,
    timezone: input.timezone,
    meal_type: input.mealType,
    ...(input.recognizedBy ? { recognized_by: input.recognizedBy } : {}),
    items: input.items.map((item, at) => ({
      position: at + 1,
      name: item.name,
      quantity: item.grams,
      quantity_unit: 'g',
      serving: portionText(item),
      origin: item.origin,
      food_id: item.food && item.food.kind !== 'product' ? item.food.id : null,
      product_id: item.food?.kind === 'product' ? item.food.id : null,
      nutrients: (Object.entries(shownValues(item)) as [NutrientCode, number][])
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, value]) => nutrientValue(code, value)),
    })),
  }
}

/** Open Food Facts (ODbL) is credited wherever one of its products shows. */
export const creditsOpenFoodFacts = (foods: readonly (Food | null)[]): boolean =>
  foods.some((food) => food?.kind === 'product')

interface Box {
  readonly width: number
  readonly height: number
}

/**
 * Where each label sits over the photo, in points: at what the model pointed to, pulled
 * inside the area, and stepped down below any label it would cover.
 */
export function placeLabels(
  points: readonly { readonly x: number; readonly y: number }[],
  area: Box,
  size: Box,
  gap: number,
): { left: number; top: number }[] {
  const wanted = points.map((point) => ({
    left: Math.max(0, Math.min(point.x * area.width, area.width - size.width)),
    top: Math.max(0, Math.min(point.y * area.height, area.height - size.height)),
  }))
  const order = wanted
    .map((_, at) => at)
    .sort((a, b) => (wanted[a]?.top ?? 0) - (wanted[b]?.top ?? 0))
  const placed: { left: number; top: number }[] = []
  const result = [...wanted]
  for (const at of order) {
    const spot = { ...(wanted[at] ?? { left: 0, top: 0 }) }
    const covers = (other: { left: number; top: number }) =>
      Math.abs(other.left - spot.left) < size.width &&
      Math.abs(other.top - spot.top) < size.height + gap
    for (let other = placed.find(covers); other; other = placed.find(covers)) {
      spot.top = other.top + size.height + gap
    }
    spot.top = Math.min(spot.top, area.height - size.height)
    placed.push(spot)
    result[at] = spot
  }
  return result
}

/** The meal the hour suggests: what the pill shows before anyone touches it. */
export function mealTypeForHour(hour: number): MealType {
  if (hour < 11) return 'breakfast'
  if (hour < 16) return 'lunch'
  if (hour < 19) return 'snack'
  return 'dinner'
}
