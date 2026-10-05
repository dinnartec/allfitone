import { describe, expect, test } from 'bun:test'

import { unitChoices } from './amount'
import {
  captureTotals,
  creditsOpenFoodFacts,
  fromFood,
  fromRecognition,
  mealFromCapture,
  mealTypeForHour,
  placeLabels,
  portionText,
  isEstimated,
  restoreCalculated,
  shownValues,
  withEdit,
  withAmount,
  withFood,
  withGrams,
  type CaptureItem,
  type Food,
  type Recognition,
} from './capture'

const avocado: Food = {
  id: '019f1300-0000-7000-8000-000000000301',
  name: 'Aguacate',
  kind: 'ingredient',
  brand: null,
  icon: 'fruit',
  grams_per_ml: null,
  nutrients: [
    { nutrient_code: 'energy', value_per_100g: 160, unit: 'kcal' },
    { nutrient_code: 'protein', value_per_100g: 2, unit: 'g' },
    { nutrient_code: 'fat', value_per_100g: 14.66, unit: 'g' },
  ],
  portions: [
    { label: '1/4 unidad', grams: 50, is_default: true },
    { label: '1/2 unidad', grams: 100, is_default: false },
  ],
}

const recognition: Recognition = {
  dish: null,
  model: 'google/gemini-3.5-flash-lite',
  items: [
    {
      name: 'aguacate',
      units: 1,
      grams: 50,
      confidence: 0.5,
      at: { x: 0.7, y: 0.2 },
      icon: 'vegetable',
      estimated: false,
      needs_review: true,
      food: avocado,
      nutrients: [],
    },
    {
      name: 'piedra',
      units: 1,
      grams: 20,
      confidence: 0.9,
      at: null,
      icon: null,
      estimated: false,
      needs_review: true,
      food: null,
      nutrients: [],
    },
    {
      name: 'cereal de chocolate',
      units: 1,
      grams: 30,
      confidence: 0.8,
      at: null,
      icon: 'grain',
      estimated: true,
      needs_review: true,
      food: null,
      nutrients: [
        { nutrient_code: 'energy', value: 117, unit: 'kcal' },
        { nutrient_code: 'carbohydrates', value: 25.5, unit: 'g' },
      ],
    },
  ],
}

describe('a meal captured by photo or search (R-F, R-A, ADR-041)', () => {
  test('T-SPC-UNIT-223 what was recognised becomes items computed from the catalogue', () => {
    const [first, second] = fromRecognition(recognition)
    expect(first).toMatchObject({
      name: 'Aguacate',
      grams: 50,
      origin: 'photo',
      food: avocado,
      review: true,
      at: { x: 0.7, y: 0.2 },
    })
    expect(shownValues(first as CaptureItem)).toEqual({ energy: 80, protein: 1, fat: 7.3 })
    expect(second).toMatchObject({ name: 'Piedra', food: null, review: true })
    expect(shownValues(second as CaptureItem)).toEqual({})
  })

  test('T-SPC-UNIT-224 changing the amount recalculates everything but what the person edited', () => {
    const item = fromFood(avocado, 50)
    const edited = withEdit(item, 'energy', 150)
    const doubled = withGrams(edited, 100)
    expect(shownValues(doubled)).toEqual({ energy: 150, protein: 2, fat: 14.7 })
    expect(doubled.edited).toEqual({ energy: 150 })
    expect(shownValues(restoreCalculated(doubled))).toEqual({ energy: 160, protein: 2, fat: 14.7 })
  })

  test('T-SPC-UNIT-225 the total of the meal is what every item shows, and missing stays missing', () => {
    const items = [fromFood(avocado, 100), withEdit(fromFood(avocado, 50), 'energy', 100)]
    expect(captureTotals(items)).toEqual({ energy: 260, protein: 3, fat: 22 })
    expect(captureTotals([])).toEqual({})
  })

  test('T-SPC-UNIT-226 an amount reads as the person would say it: in its measure, else in grams', () => {
    expect(portionText(fromFood(avocado, 50))).toBe('¼ unidad')
    expect(portionText(fromFood(avocado, 400))).toBe('2 unidades')
    expect(portionText(fromFood(avocado, 75))).toBe('75 g')
  })

  test('T-SPC-UNIT-240 an amount typed in a unit sets the grams, and a new food keeps them', () => {
    const cup = unitChoices(avocado).find((one) => one.label === 'unidad')
    if (!cup) throw new Error('an avocado comes by the unit')
    const item = withAmount(fromFood(avocado), 1.5, cup, 'fraction')
    expect(item).toMatchObject({ grams: 300, amount: 1.5 })
    expect(portionText(item)).toBe('1 ½ unidades')
    expect(portionText(withAmount(item, 1.5, cup, 'number'))).toBe('1,5 unidades')
    expect(withFood(item, { ...avocado, id: 'otro', portions: [] })).toMatchObject({
      grams: 300,
      amount: 300,
      unit: { label: 'g' },
    })
  })

  test('T-SPC-UNIT-227 the meal sent says where each item came from, its grams and what it shows', () => {
    const items = [fromRecognition(recognition)[0] as CaptureItem, fromFood(avocado, 100)]
    expect(
      mealFromCapture({
        items,
        mealType: 'dinner',
        occurredAt: '2026-10-04T20:30:00-05:00',
        timezone: 'America/Bogota',
        recognizedBy: 'google/gemini-3.5-flash-lite',
      }),
    ).toEqual({
      occurred_at: '2026-10-04T20:30:00-05:00',
      timezone: 'America/Bogota',
      meal_type: 'dinner',
      recognized_by: 'google/gemini-3.5-flash-lite',
      items: [
        {
          position: 1,
          name: 'Aguacate',
          quantity: 50,
          quantity_unit: 'g',
          serving: '¼ unidad',
          origin: 'photo',
          food_id: avocado.id,
          product_id: null,
          nutrients: [
            { nutrient_code: 'energy', value: 80, unit: 'kcal' },
            { nutrient_code: 'fat', value: 7.3, unit: 'g' },
            { nutrient_code: 'protein', value: 1, unit: 'g' },
          ],
        },
        {
          position: 2,
          name: 'Aguacate',
          quantity: 100,
          quantity_unit: 'g',
          serving: '½ unidad',
          origin: 'catalog',
          food_id: avocado.id,
          product_id: null,
          nutrients: [
            { nutrient_code: 'energy', value: 160, unit: 'kcal' },
            { nutrient_code: 'fat', value: 14.7, unit: 'g' },
            { nutrient_code: 'protein', value: 2, unit: 'g' },
          ],
        },
      ],
    })
  })

  test('T-SPC-UNIT-229 with no catalogue food the AI estimate stands in, scales and is said', () => {
    const estimated = fromRecognition(recognition)[2] as CaptureItem
    expect(estimated).toMatchObject({ name: 'Cereal de chocolate', food: null, icon: 'grain' })
    expect(isEstimated(estimated)).toBe(true)
    expect(shownValues(estimated)).toEqual({ energy: 117, carbohydrates: 25.5 })
    expect(shownValues(withGrams(estimated, 60))).toEqual({ energy: 234, carbohydrates: 51 })
    const chosen = withFood(estimated, avocado)
    expect(isEstimated(chosen)).toBe(false)
    expect(chosen).toMatchObject({ icon: 'fruit', estimate: null })
  })

  test('T-SPC-UNIT-230 each item wears its food icon, else the one seen, else the generic one', () => {
    const [matched, unknown] = fromRecognition(recognition)
    expect(matched?.icon).toBe('fruit')
    expect(unknown?.icon).toBe('nutrition')
    expect(isEstimated(unknown as CaptureItem)).toBe(false)
    expect(fromFood(avocado).icon).toBe('fruit')
  })

  test('T-SPC-UNIT-231 a packaged product is sent as a product, and its source is credited', () => {
    const milk: Food = {
      ...avocado,
      id: '019f1400-0000-7000-8000-000000000201',
      name: 'Leche entera',
      kind: 'product',
      brand: 'Alquería',
      icon: 'dairy',
    }
    const meal = mealFromCapture({
      items: [fromFood(milk, 250), fromFood(avocado, 50)],
      mealType: 'breakfast',
      occurredAt: '2026-10-05T07:00:00-05:00',
      timezone: 'America/Bogota',
      recognizedBy: null,
    })
    expect(meal.items.map(({ food_id, product_id }) => ({ food_id, product_id }))).toEqual([
      { food_id: null, product_id: milk.id },
      { food_id: avocado.id, product_id: null },
    ])
    expect(creditsOpenFoodFacts([milk, avocado])).toBe(true)
    expect(creditsOpenFoodFacts([avocado])).toBe(false)
  })

  test('T-SPC-UNIT-232 labels on the photo never sit on each other, and stay inside it', () => {
    const area = { width: 400, height: 380 }
    const size = { width: 170, height: 52 }
    // Two foods seen almost at the same spot: the lower one steps down by a label and a gap.
    expect(
      placeLabels(
        [
          { x: 0.5, y: 0.3 },
          { x: 0.52, y: 0.32 },
        ],
        area,
        size,
        8,
      ),
    ).toEqual([
      { left: 200, top: 114 },
      { left: 208, top: 174 },
    ])
    // Side by side they do not touch, so neither moves; near an edge it is pulled inside.
    expect(
      placeLabels(
        [
          { x: 0, y: 0.3 },
          { x: 0.9, y: 0.99 },
        ],
        area,
        size,
        8,
      ),
    ).toEqual([
      { left: 0, top: 114 },
      { left: 230, top: 328 },
    ])
  })

  test('T-SPC-UNIT-228 the meal is guessed by the hour, as the pill says', () => {
    expect(mealTypeForHour(7)).toBe('breakfast')
    expect(mealTypeForHour(13)).toBe('lunch')
    expect(mealTypeForHour(17)).toBe('snack')
    expect(mealTypeForHour(21)).toBe('dinner')
  })
})
