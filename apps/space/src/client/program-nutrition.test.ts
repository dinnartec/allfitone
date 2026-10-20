import { describe, expect, test } from 'bun:test'

import { programNutritionCopy } from './program-nutrition'

const nutrition = {
  goal_code: 'build_muscle' as const,
  targets: [
    {
      nutrient_code: 'energy' as const,
      mode: 'range' as const,
      minimum: 2800,
      maximum: 3100,
      exact: null,
      unit: 'kcal' as const,
    },
    {
      nutrient_code: 'protein' as const,
      mode: 'exact' as const,
      minimum: null,
      maximum: null,
      exact: 160,
      unit: 'g' as const,
    },
    {
      nutrient_code: 'carbohydrates' as const,
      mode: 'exact' as const,
      minimum: null,
      maximum: null,
      exact: 360,
      unit: 'g' as const,
    },
    {
      nutrient_code: 'fat' as const,
      mode: 'exact' as const,
      minimum: null,
      maximum: null,
      exact: 70,
      unit: 'g' as const,
    },
  ],
}

describe("the programme's nutrition, as the detail says it", () => {
  test('T-SPC-UNIT-308 energy as a range of kcal, and what the goal is for', () => {
    const copy = programNutritionCopy(nutrition, 5)
    expect(copy.energy).toBe('2.800–3.100')
    expect(copy.purpose).toBe('Para ganar músculo con 5 días por semana')
  })

  test('T-SPC-UNIT-309 the three macros in order, each with its share of the energy', () => {
    const copy = programNutritionCopy(nutrition, 5)
    expect(copy.macros.map((macro) => [macro.code, macro.value, macro.label])).toEqual([
      ['protein', '160 g', 'Proteína'],
      ['carbohydrates', '360 g', 'Carbos'],
      ['fat', '70 g', 'Grasa'],
    ])
    // 160 g × 4 kcal of the 2.950 kcal midpoint.
    expect(copy.macros[0]?.share).toBeCloseTo(640 / 2950)
  })

  test('T-SPC-UNIT-310 a goal for a race or for staying fit says so', () => {
    expect(programNutritionCopy({ ...nutrition, goal_code: 'run_a_race' }, 4).purpose).toBe(
      'Para preparar una carrera con 4 días por semana',
    )
    expect(programNutritionCopy({ ...nutrition, goal_code: 'lose_weight' }, 1).purpose).toBe(
      'Para perder grasa con 1 día por semana',
    )
  })
})
