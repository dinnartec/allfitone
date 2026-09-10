/**
 * Public interface of the privacy domain.
 *
 * Consent management is a domain and lives here. Privacy *enforcement* — checking
 * grants and writing the access record inside a read transaction — is invoked by
 * every domain and lives in `platform/privacy`, not here.
 */

export { backofficePrivacyRoutes } from './handlers/backoffice.js'
export { scopeDefinitionService } from './dependencies.js'
export type { ScopeDefinitionService } from './application/index.js'
export type { ScopeDefinition, ScopeDefinitionPublication } from './domain/index.js'
