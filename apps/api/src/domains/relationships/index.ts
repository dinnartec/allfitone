/**
 * Public interface of the relationships domain.
 */

export { spaceRelationshipRoutes } from './handlers/space.js'
export { studioRelationshipRoutes } from './handlers/studio.js'
export { clientDirectoryService, myRelationshipService } from './dependencies.js'
export { RelationshipsError } from './application/index.js'
export type { ClientDirectoryService, MyRelationshipService } from './application/index.js'
export type {
  ClientDirectoryDatabase,
  DirectoryEntry,
  DirectoryGroup,
  DirectoryInvitationEntry,
  DirectoryPage,
  DirectoryQuery,
  DirectoryRelationshipEntry,
  RelationshipStatus,
} from './domain/index.js'
