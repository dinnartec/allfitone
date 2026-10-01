/** Execution module composition. */

import { createSpaceExecutionService, type SpaceExecutionService } from './application/index.js'
import { createExecutionDatabase } from './infrastructure/index.js'

/** The routine's photograph is addressed like the catalogue's, from the same origin. */
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

let cached: SpaceExecutionService | undefined

export function spaceExecutionService(): SpaceExecutionService {
  cached ??= createSpaceExecutionService(
    createExecutionDatabase(),
    required('CATALOG_MEDIA_BASE_URL'),
  )
  return cached
}

/** Test seam. Undefined restores environment-backed construction. */
export function setSpaceExecutionService(service: SpaceExecutionService | undefined): void {
  cached = service
}
