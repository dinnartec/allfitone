/**
 * Public interface of the relationships domain.
 */

export { studioRelationshipRoutes } from './handlers/studio.js'
export { clientDirectoryService } from './dependencies.js'
export { RelationshipsError } from './application/index.js'
export type { ClientDirectoryService } from './application/index.js'
export type {
  ClientDirectoryDatabase,
  DirectoryClient,
  DirectoryPage,
  DirectoryQuery,
  RelationshipStatus,
} from './domain/index.js'
