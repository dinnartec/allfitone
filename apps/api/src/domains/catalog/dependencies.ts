import {
  createGlobalCatalogService,
  createResultContractService,
  createStudioCatalogService,
  type GlobalCatalogService,
  type ResultContractService,
  type StudioCatalogService,
} from './application/index.js'
import {
  createProfessionalCatalogDatabase,
  createGlobalCatalogDatabase,
  createResultContractDatabase,
} from './infrastructure/index.js'

let cached: StudioCatalogService | undefined

export function studioCatalogService(): StudioCatalogService {
  cached ??= createStudioCatalogService(createProfessionalCatalogDatabase())
  return cached
}

let cachedContracts: ResultContractService | undefined

export function resultContractService(): ResultContractService {
  cachedContracts ??= createResultContractService(createResultContractDatabase())
  return cachedContracts
}

let cachedGlobal: GlobalCatalogService | undefined

export function globalCatalogService(): GlobalCatalogService {
  cachedGlobal ??= createGlobalCatalogService(createGlobalCatalogDatabase())
  return cachedGlobal
}
