import { createStudioCatalogService, type StudioCatalogService } from './application/index.js'
import { createProfessionalCatalogDatabase } from './infrastructure/index.js'

let cached: StudioCatalogService | undefined

export function studioCatalogService(): StudioCatalogService {
  cached ??= createStudioCatalogService(createProfessionalCatalogDatabase())
  return cached
}
