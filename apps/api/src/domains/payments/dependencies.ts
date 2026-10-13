import { createStoreBillingFromEnv, type StoreBilling } from '@allfitone/store-billing'

import { createPlatformPlanService, type PlatformPlanService } from './application/index.js'
import { createProService, type ProService } from './application/pro.js'
import { createPlatformPlanDatabase } from './infrastructure/index.js'
import { createProDatabase } from './infrastructure/pro.js'

let cachedPlans: PlatformPlanService | undefined
let cachedPro: ProService | undefined
let cachedBilling: StoreBilling | undefined

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
