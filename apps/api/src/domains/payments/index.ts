/**
 * Public interface of the payments domain.
 *
 * Two things live here: the catalogue of plans Allfit sells, and the paying bond between
 * a person and an organization. Nothing outside reaches past this file.
 */

export { backofficePlatformPlanRoutes } from './handlers/backoffice.js'
export { spacePaymentRoutes } from './handlers/space.js'
export { studioPaymentRoutes } from './handlers/studio.js'
export { platformPlanService, subscriptionService } from './dependencies.js'
export type { PlatformPlanService } from './application/index.js'
export type { SubscriptionService } from './application/subscriptions.js'
export type { PlatformPlan, PlatformPlanCatalogue } from './domain/index.js'
export type {
  OrganizationPlanOffer,
  OrganizationSubscription,
  Subscription,
  SubscriptionCheckout,
  SubscriptionStatus,
  SubscriptionTransition,
} from './domain/subscriptions.js'
