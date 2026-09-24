/** Execution module composition. */

import { createSpaceExecutionService, type SpaceExecutionService } from './application/index.js'
import { createExecutionDatabase } from './infrastructure/index.js'

let cached: SpaceExecutionService | undefined

export function spaceExecutionService(): SpaceExecutionService {
  cached ??= createSpaceExecutionService(createExecutionDatabase())
  return cached
}

/** Test seam. Undefined restores environment-backed construction. */
export function setSpaceExecutionService(service: SpaceExecutionService | undefined): void {
  cached = service
}
