/**
 * The unit each nutrient is written in (IX-29), as one function the API and its clients
 * share rather than each keeping a copy that drifts.
 *
 * The contract pairs every nutrient code with exactly one unit, and the database refuses
 * any other. Narrowing by group, rather than looking the unit up in a table, is what lets
 * the compiler prove each pair is one the contract allows, with no cast.
 */

import type { components } from '../generated/allfit-v1.js'

type NutrientCode = components['schemas']['NutrientCode']
type NutrientValue = components['schemas']['NutrientValue']

const IN_GRAMS = [
  'protein',
  'carbohydrates',
  'fat',
  'fiber',
  'saturated_fat',
  'trans_fat',
  'sugars',
] as const
const IN_MILLIGRAMS = [
  'cholesterol',
  'sodium',
  'vitamin_c',
  'vitamin_e',
  'thiamin',
  'riboflavin',
  'niacin',
  'pantothenic_acid',
  'vitamin_b6',
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'potassium',
  'zinc',
  'copper',
] as const

const inGrams = (code: NutrientCode): code is (typeof IN_GRAMS)[number] =>
  IN_GRAMS.some((one) => one === code)
const inMilligrams = (code: NutrientCode): code is (typeof IN_MILLIGRAMS)[number] =>
  IN_MILLIGRAMS.some((one) => one === code)

/** A nutrient's value in the one unit its code allows; micrograms for what is left. */
export function nutrientValue(code: NutrientCode, value: number): NutrientValue {
  if (code === 'energy') return { nutrient_code: code, value, unit: 'kcal' }
  if (code === 'water') return { nutrient_code: code, value, unit: 'ml' }
  if (inGrams(code)) return { nutrient_code: code, value, unit: 'g' }
  if (inMilligrams(code)) return { nutrient_code: code, value, unit: 'mg' }
  return { nutrient_code: code, value, unit: 'mcg' }
}
