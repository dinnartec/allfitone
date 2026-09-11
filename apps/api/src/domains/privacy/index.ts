/**
 * Public interface of the privacy domain.
 *
 * Consent management is a domain and lives here. Privacy *enforcement* — checking
 * grants and writing the access record inside a read transaction — is invoked by
 * every domain and lives in `platform/privacy`, not here.
 */

export { backofficePrivacyRoutes } from './handlers/backoffice.js'
export { accessLogService, scopeDefinitionService } from './dependencies.js'
export type { AccessLogService, ScopeDefinitionService } from './application/index.js'
export type {
  AccessEvent,
  AccessEventPage,
  ScopeDefinition,
  ScopeDefinitionPublication,
} from './domain/index.js'
