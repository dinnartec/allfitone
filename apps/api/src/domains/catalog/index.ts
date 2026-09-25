/**
 * Public interface of the catalog domain.
 */

export { studioCatalogRoutes } from './handlers/studio.js'
export { backofficeCatalogRoutes } from './handlers/backoffice.js'
export { backofficeGlobalCatalogueRoutes } from './handlers/backoffice-global-catalogue.js'
export { catalogSurfaceRoutes } from './handlers/catalog.js'
export { catalogMovementRoutes } from './handlers/movements.js'
export { resultContractService, globalCatalogService } from './dependencies.js'
export type { GlobalCatalogService, ResultContractService } from './application/index.js'
export type {
  ActivityTypeResultContract,
  CatalogActivityType,
  CatalogDiscipline,
  CatalogReader,
  ResultContract,
  ResultContractPublication,
} from './domain/index.js'
