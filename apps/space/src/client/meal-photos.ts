/**
 * The app's one queue of meal photos on their way up (see `photo-uploads`).
 *
 * One for the process, so a photo keeps going after the capture that took it has
 * closed, and every screen that draws the meal sees the same state.
 */

import type { NutritionMeal } from './nutrition'
import { createSpaceNutritionFlow } from './nutrition-transport'
import { createPhotoUploads, type PendingPhoto } from './photo-uploads'

const flow = createSpaceNutritionFlow()
// The meal as saved, for the revision that attaches its photo.
const saved = new Map<string, NutritionMeal>()

export const mealPhotos = createPhotoUploads({
  upload: async (mealId, photo) => {
    const meal = saved.get(mealId)
    if (!meal) return
    await flow.reviseMeal(meal, { photo: { content_type: 'image/jpeg', content: photo.base64 } })
    saved.delete(mealId)
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})

/** Sends a saved meal's photo in the background; the caller does not wait for it. */
export function sendMealPhoto(meal: NutritionMeal, photo: PendingPhoto): void {
  saved.set(meal.id, meal)
  void mealPhotos.enqueue(meal.id, photo)
}
