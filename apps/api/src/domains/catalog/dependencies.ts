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
  if (cachedMovements) return cachedMovements

  // Where the demonstrations are served from. Absent, the projection would hand out
  // addresses that resolve to nothing, which is worse than refusing to start.
  const mediaBaseUrl = process.env.CATALOG_MEDIA_BASE_URL
  if (!mediaBaseUrl) throw new Error('CATALOG_MEDIA_BASE_URL is not set')

  cachedMovements = createMovementLibraryService({
    database: createMovementLibraryDatabase(),
    mediaBaseUrl,
  })
  return cachedMovements
}
