import { createStoreBillingFromEnv, type StoreBilling } from '@allfitone/store-billing'

import { createPlatformPlanService, type PlatformPlanService } from './application/index.js'
import { createProService, type ProService } from './application/pro.js'
import { createSubscriptionService, type SubscriptionService } from './application/subscriptions.js'
import { createPlatformPlanDatabase } from './infrastructure/index.js'
import { createProDatabase } from './infrastructure/pro.js'
import { createSubscriptionDatabase } from './infrastructure/subscriptions.js'

let cachedPlans: PlatformPlanService | undefined
let cachedPro: ProService | undefined
let cachedBilling: StoreBilling | undefined
let cachedSubscriptions: SubscriptionService | undefined

export function platformPlanService(): PlatformPlanService {
  cachedPlans ??= createPlatformPlanService(createPlatformPlanDatabase())
  return cachedPlans
}

// The stores are read from the environment on first use, so a missing credential fails
// the purchase that needs it rather than every route of the API.
export function proService(): ProService {
  cachedPro ??= createProService(createProDatabase(), () => {
    cachedBilling ??= createStoreBillingFromEnv(process.env)
    return cachedBilling
  })
  return cachedPro
}

// No store and no credential: a gym plan is charged by the gym, so this one needs
// nothing from the environment.
export function subscriptionService(): SubscriptionService {
  cachedSubscriptions ??= createSubscriptionService(createSubscriptionDatabase())
  return cachedSubscriptions
}
