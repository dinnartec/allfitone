/**
 * Public interface of the catalog domain.
 */

export { studioCatalogRoutes } from './handlers/studio.js'
export { backofficeCatalogRoutes } from './handlers/backoffice.js'
export { resultContractService } from './dependencies.js'
export type { ResultContractService } from './application/index.js'
export type { ResultContract, ResultContractPublication } from './domain/index.js'
