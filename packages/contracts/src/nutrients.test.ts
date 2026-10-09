/**
 * The expected units are written out here rather than read from the code under test, so a
 * nutrient moved to the wrong unit fails instead of drifting with it. They are the units
 * of `nutrition.nutrient_definitions` (ADR-041 as amended).
 */

import { describe, expect, test } from 'bun:test'

import type { AllfitV1Schemas } from './index.js'
import { nutrientValue } from './nutrients.js'

type NutrientCode = AllfitV1Schemas['NutrientCode']

// Exhaustive by type: a nutrient added to the contract and left out here fails to compile.
const EXPECTED = {
  energy: 'kcal',
  water: 'ml',
  protein: 'g',
  carbohydrates: 'g',
  fat: 'g',
  fiber: 'g',
  saturated_fat: 'g',
  trans_fat: 'g',
  sugars: 'g',
  cholesterol: 'mg',
  sodium: 'mg',
  vitamin_c: 'mg',
  vitamin_e: 'mg',
  thiamin: 'mg',
  riboflavin: 'mg',
  niacin: 'mg',
  pantothenic_acid: 'mg',
  vitamin_b6: 'mg',
  calcium: 'mg',
  iron: 'mg',
  magnesium: 'mg',
  phosphorus: 'mg',
  potassium: 'mg',
  zinc: 'mg',
  copper: 'mg',
  vitamin_a: 'mcg',
  vitamin_d: 'mcg',
  vitamin_k: 'mcg',
  vitamin_b12: 'mcg',
  folate: 'mcg',
  selenium: 'mcg',
} satisfies Record<NutrientCode, AllfitV1Schemas['NutrientValue']['unit']>

const isCode = (code: string): code is NutrientCode => code in EXPECTED

describe('nutrientValue (IX-29)', () => {
  test('every nutrient of the contract is written in its own unit', () => {
    const codes = Object.keys(EXPECTED).filter(isCode)
    expect(codes).toHaveLength(31)
    for (const code of codes) {
      const written = nutrientValue(code, 1)
      expect([written.nutrient_code, written.value, written.unit]).toEqual([
        code,
        1,
        EXPECTED[code],
      ])
    }
  })
})
