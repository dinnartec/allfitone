/**
 * Public interface of the payments domain.
 *
 * Today it holds only the catalogue of plans Allfit sells. Nothing outside reaches past
 * this file.
 */

export { backofficePlatformPlanRoutes } from './handlers/backoffice.js'
export { platformPlanService } from './dependencies.js'
export type { PlatformPlanService } from './application/index.js'
export type { PlatformPlan, PlatformPlanCatalogue } from './domain/index.js'
