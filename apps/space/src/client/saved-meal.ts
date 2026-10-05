/**
 * The meal just saved, handed from the capture to the diary once (R-F5, R-A5).
 *
 * The diary shows «Cena guardada · 582 kcal · Deshacer» when it comes back into view; a
 * route parameter would replay it on every visit, so the hand-off is taken, not read.
 */

export interface SavedMeal {
  readonly id: string
  readonly label: string
  readonly kcal: number | null
}

let pending: SavedMeal | null = null

export function handOverSavedMeal(meal: SavedMeal): void {
  pending = meal
}

export function takeSavedMeal(): SavedMeal | null {
  const meal = pending
  pending = null
  return meal
}
