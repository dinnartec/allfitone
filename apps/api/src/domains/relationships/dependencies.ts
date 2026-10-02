import {
  createClientDirectoryService,
  createHolderAssignmentService,
  createRelationshipStateService,
  type ClientDirectoryService,
  type HolderAssignmentService,
  type RelationshipStateService,
} from './application/index.js'
import {
  createClientDirectoryDatabase,
  createHolderAssignmentDatabase,
  createRelationshipStateDatabase,
} from './infrastructure/index.js'

let cached: ClientDirectoryService | undefined
let cachedHolders: HolderAssignmentService | undefined
let cachedStates: RelationshipStateService | undefined

export function clientDirectoryService(): ClientDirectoryService {
  cached ??= createClientDirectoryService(createClientDirectoryDatabase())
  return cached
}

export function holderAssignmentService(): HolderAssignmentService {
  cachedHolders ??= createHolderAssignmentService(createHolderAssignmentDatabase())
  return cachedHolders
}

export function relationshipStateService(): RelationshipStateService {
  cachedStates ??= createRelationshipStateService(createRelationshipStateDatabase())
  return cachedStates
}
