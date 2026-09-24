import {
  createAccessLogService,
  createErasureRequestService,
  createLegalHoldService,
  createScopeDefinitionService,
  type AccessLogService,
  type ErasureRequestService,
  type LegalHoldService,
  type ScopeDefinitionService,
} from './application/index.js'
import {
  createAccessLogDatabase,
  createErasureRequestDatabase,
  createLegalHoldDatabase,
  createScopeDefinitionDatabase,
} from './infrastructure/index.js'

let cachedScopes: ScopeDefinitionService | undefined
let cachedLog: AccessLogService | undefined
let cachedErasure: ErasureRequestService | undefined
let cachedHolds: LegalHoldService | undefined

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

export function legalHoldService(): LegalHoldService {
  cachedHolds ??= createLegalHoldService(createLegalHoldDatabase())
  return cachedHolds
}
