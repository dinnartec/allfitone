/**
 * Public interface of the nutrition domain.
 *
 * Everything outside this module reaches nutrition through here and nowhere else — the
 * boundary rules enforce it.
 */

export { spaceMealRoutes } from './handlers/space-meals.js'
export type { MealService } from './application/meals.js'
