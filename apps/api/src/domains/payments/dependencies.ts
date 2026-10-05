import { createPlatformPlanService, type PlatformPlanService } from './application/index.js'
import { createPlatformPlanDatabase } from './infrastructure/index.js'

let cachedPlans: PlatformPlanService | undefined

export function platformPlanService(): PlatformPlanService {
  cachedPlans ??= createPlatformPlanService(createPlatformPlanDatabase())
  return cachedPlans
}
