import {
  createAccessLogService,
  createScopeDefinitionService,
  type AccessLogService,
  type ScopeDefinitionService,
} from './application/index.js'
import { createAccessLogDatabase, createScopeDefinitionDatabase } from './infrastructure/index.js'

let cachedScopes: ScopeDefinitionService | undefined
let cachedLog: AccessLogService | undefined

export function scopeDefinitionService(): ScopeDefinitionService {
  cachedScopes ??= createScopeDefinitionService(createScopeDefinitionDatabase())
  return cachedScopes
}

export function accessLogService(): AccessLogService {
  cachedLog ??= createAccessLogService(createAccessLogDatabase())
  return cachedLog
}
