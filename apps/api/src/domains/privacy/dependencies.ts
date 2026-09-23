import {
  createAccessLogService,
  createErasureRequestService,
  createScopeDefinitionService,
  type AccessLogService,
  type ErasureRequestService,
  type ScopeDefinitionService,
} from './application/index.js'
import {
  createAccessLogDatabase,
  createErasureRequestDatabase,
  createScopeDefinitionDatabase,
} from './infrastructure/index.js'

let cachedScopes: ScopeDefinitionService | undefined
let cachedLog: AccessLogService | undefined
let cachedErasure: ErasureRequestService | undefined

export function scopeDefinitionService(): ScopeDefinitionService {
  cachedScopes ??= createScopeDefinitionService(createScopeDefinitionDatabase())
  return cachedScopes
}

export function accessLogService(): AccessLogService {
  cachedLog ??= createAccessLogService(createAccessLogDatabase())
  return cachedLog
}

export function erasureRequestService(): ErasureRequestService {
  cachedErasure ??= createErasureRequestService(createErasureRequestDatabase())
  return cachedErasure
}
