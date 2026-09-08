import {
  createMovementLibraryService,
  createStudioCatalogService,
  type MovementLibraryService,
  type StudioCatalogService,
} from './application/index.js'
import {
  createMovementLibraryDatabase,
  createProfessionalCatalogDatabase,
} from './infrastructure/index.js'

let cached: StudioCatalogService | undefined

export function studioCatalogService(): StudioCatalogService {
  cached ??= createStudioCatalogService(createProfessionalCatalogDatabase())
  return cached
}

let cachedMovements: MovementLibraryService | undefined

export function movementLibraryService(): MovementLibraryService {
  cachedMovements ??= createMovementLibraryService(createMovementLibraryDatabase())
  return cachedMovements
}
