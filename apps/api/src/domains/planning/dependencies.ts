import { createStudioPlanningService, type StudioPlanningService } from './application/index.js'
import { createPlanningDatabase } from './infrastructure/index.js'
import { createSpacePlanningService, type SpacePlanningService } from './application/space.js'
import { createSpacePlanningDatabase } from './infrastructure/space.js'

let cached: StudioPlanningService | undefined

export function studioPlanningService(): StudioPlanningService {
  cached ??= createStudioPlanningService(createPlanningDatabase())
  return cached
}

let cachedSpace: SpacePlanningService | undefined

export function spacePlanningService(): SpacePlanningService {
  cachedSpace ??= createSpacePlanningService(createSpacePlanningDatabase())
  return cachedSpace
}

/** Test seam. Undefined restores environment-backed construction. */
export function setSpacePlanningService(service: SpacePlanningService | undefined): void {
  cachedSpace = service
}
