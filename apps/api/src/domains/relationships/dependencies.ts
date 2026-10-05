import {
  createClientDirectoryService,
  createHolderAssignmentService,
  createHolderReassignmentService,
  createRelationshipStateService,
  type ClientDirectoryService,
  type HolderAssignmentService,
  type HolderReassignmentService,
  type RelationshipStateService,
} from './application/index.js'
import {
  createClientDirectoryDatabase,
  createHolderAssignmentDatabase,
  createHolderReassignmentDatabase,
  createRelationshipStateDatabase,
} from './infrastructure/index.js'

let cached: ClientDirectoryService | undefined
let cachedHolders: HolderAssignmentService | undefined
let cachedStates: RelationshipStateService | undefined
let cachedReassignments: HolderReassignmentService | undefined

export function clientDirectoryService(): ClientDirectoryService {
  cached ??= createClientDirectoryService(createClientDirectoryDatabase())
  return cached
}

export function holderAssignmentService(): HolderAssignmentService {
  cachedHolders ??= createHolderAssignmentService(createHolderAssignmentDatabase())
  return cachedHolders
}

export function holderReassignmentService(): HolderReassignmentService {
  cachedReassignments ??= createHolderReassignmentService(createHolderReassignmentDatabase())
  return cachedReassignments
}

export function relationshipStateService(): RelationshipStateService {
  cachedStates ??= createRelationshipStateService(createRelationshipStateDatabase())
  return cachedStates
}
