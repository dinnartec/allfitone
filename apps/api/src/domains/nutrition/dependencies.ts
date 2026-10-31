/** Nutrition module composition: its database, the private store, the sanitiser and the recogniser. */

import { createFoodRecognizerFromEnv } from '@allfitone/food-recognition'
import { createObjectStoreFromEnv } from '@allfitone/object-store'

import { createSpaceNutritionService, type SpaceNutritionService } from './application/index.js'
import { createNutritionDatabase } from './infrastructure/index.js'
import { createSharpSanitizer } from '../../platform/media/photo.js'

let cached: SpaceNutritionService | undefined

export function spaceNutritionService(): SpaceNutritionService {
  cached ??= createSpaceNutritionService(
    createNutritionDatabase(),
    createObjectStoreFromEnv(process.env),
    createSharpSanitizer(),
    createFoodRecognizerFromEnv(process.env),
  )
  return cached
}

/** Test seam. Undefined restores environment-backed construction. */
export function setSpaceNutritionService(service: SpaceNutritionService | undefined): void {
  cached = service
}
