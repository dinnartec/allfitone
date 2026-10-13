/**
 * Public interface of the payments domain.
 *
 * The catalogue of plans Allfit sells, and Allfit Pro on Space: what each plan offers, a
 * person's Pro and where it comes from, and the store purchases and notifications that
 * move it (ADR-043). Nothing outside reaches past this file.
 */

export { backofficePlatformPlanRoutes } from './handlers/backoffice.js'
export { spaceProRoutes } from './handlers/space.js'
export { storeWebhookRoutes } from './handlers/webhooks.js'
export { platformPlanService, proService } from './dependencies.js'
export type { PlatformPlanService } from './application/index.js'
export type { ProService } from './application/pro.js'
export type { PlatformPlan, PlatformPlanCatalogue } from './domain/index.js'
