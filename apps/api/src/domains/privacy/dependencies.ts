import {
  createAccessLogService,
  createOfferableScopeService,
  createScopeDefinitionService,
  type AccessLogService,
  type OfferableScopeService,
  type ScopeDefinitionService,
} from './application/index.js'
import {
  createAccessLogDatabase,
  createOfferableScopeDatabase,
  createScopeDefinitionDatabase,
} from './infrastructure/index.js'

let cachedScopes: ScopeDefinitionService | undefined
let cachedLog: AccessLogService | undefined
let cachedOfferable: OfferableScopeService | undefined

export function scopeDefinitionService(): ScopeDefinitionService {
  cachedScopes ??= createScopeDefinitionService(createScopeDefinitionDatabase())
  return cachedScopes
}

export function accessLogService(): AccessLogService {
  cachedLog ??= createAccessLogService(createAccessLogDatabase())
  return cachedLog
}

export function offerableScopeService(): OfferableScopeService {
  cachedOfferable ??= createOfferableScopeService(createOfferableScopeDatabase())
  return cachedOfferable
}
