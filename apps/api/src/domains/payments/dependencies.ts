import { createPlatformPlanService, type PlatformPlanService } from './application/index.js'
import { createSubscriptionService, type SubscriptionService } from './application/subscriptions.js'
import { createPlatformPlanDatabase } from './infrastructure/index.js'
import { createSubscriptionDatabase } from './infrastructure/subscriptions.js'

let cachedPlans: PlatformPlanService | undefined
let cachedSubscriptions: SubscriptionService | undefined

export function platformPlanService(): PlatformPlanService {
  cachedPlans ??= createPlatformPlanService(createPlatformPlanDatabase())
  return cachedPlans
}

export function subscriptionService(): SubscriptionService {
  cachedSubscriptions ??= createSubscriptionService(createSubscriptionDatabase())
  return cachedSubscriptions
}
