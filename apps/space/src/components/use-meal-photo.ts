/** The state of a meal's photo while it is on its way up, for whatever draws the meal. */

import { useCallback, useSyncExternalStore } from 'react'

import { mealPhotos } from '../client/meal-photos'
import type { PhotoState } from '../client/photo-uploads'

export function useMealPhoto(mealId: string): PhotoState | null {
  const read = useCallback(() => mealPhotos.stateOf(mealId), [mealId])
  return useSyncExternalStore(mealPhotos.subscribe, read)
}
