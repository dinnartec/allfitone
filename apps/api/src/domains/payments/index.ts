/**
 * Public interface of the payments domain.
 *
 * Three things live here. The catalogue of plans Allfit sells. Allfit Pro on Space: what
 * each plan offers, a person's Pro and where it comes from, and the store purchases and
 * notifications that move it (ADR-043). And the paying bond between a person and an
 * organization, which is a price the gym sets and charges through its own gateway, with
 * no card data and no store in the middle. Nothing outside reaches past this file.
 */

export { backofficePlatformPlanRoutes } from './handlers/backoffice.js'
export { spaceProRoutes } from './handlers/space.js'
export { spacePaymentRoutes } from './handlers/space-subscriptions.js'
export { studioPaymentRoutes } from './handlers/studio.js'
export { storeWebhookRoutes } from './handlers/webhooks.js'
export { platformPlanService, proService, subscriptionService } from './dependencies.js'
export type { PlatformPlanService } from './application/index.js'
export type { ProService } from './application/pro.js'
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
