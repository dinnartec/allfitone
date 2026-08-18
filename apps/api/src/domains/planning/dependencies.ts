import { createStudioPlanningService, type StudioPlanningService } from './application/index.js'
import { createPlanningDatabase } from './infrastructure/index.js'

let cached: StudioPlanningService | undefined

export function studioPlanningService(): StudioPlanningService {
  cached ??= createStudioPlanningService(createPlanningDatabase())
  return cached
}
