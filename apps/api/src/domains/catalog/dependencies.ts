import {
  createResultContractService,
  createStudioCatalogService,
  type ResultContractService,
  type StudioCatalogService,
} from './application/index.js'
import {
  createProfessionalCatalogDatabase,
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
