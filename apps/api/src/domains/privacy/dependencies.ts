import { createScopeDefinitionService, type ScopeDefinitionService } from './application/index.js'
import { createScopeDefinitionDatabase } from './infrastructure/index.js'

let cached: ScopeDefinitionService | undefined

export function scopeDefinitionService(): ScopeDefinitionService {
  cached ??= createScopeDefinitionService(createScopeDefinitionDatabase())
  return cached
}
