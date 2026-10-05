/** Nutrition module composition. */

import { randomUUID } from 'node:crypto'

import { createMealService, type MealService } from './application/meals.js'
import { createMealDatabase } from './infrastructure/meals.js'

let cachedMeals: MealService | undefined

export function spaceMealService(): MealService {
  if (cachedMeals) return cachedMeals
  const issuer = process.env.WORKOS_ISSUER
  if (!issuer) throw new Error('WORKOS_ISSUER is not set')
  cachedMeals = createMealService({
    database: createMealDatabase(),
    issuer,
    requestId: () => randomUUID(),
  })
  return cachedMeals
}
