import {
  createClientDirectoryService,
  createMyRelationshipService,
  createHolderAssignmentService,
  createHolderReassignmentService,
  createRelationshipHistoryService,
  createRelationshipStateService,
  createSubstitutionProposalService,
  createSubstitutionTerminationService,
  createSubstitutionListService,
  type ClientDirectoryService,
  type MyRelationshipService,
  type HolderAssignmentService,
  type HolderReassignmentService,
  type RelationshipHistoryService,
  type RelationshipStateService,
  type SubstitutionProposalService,
  type SubstitutionTerminationService,
  type SubstitutionListService,
} from './application/index.js'
import {
  createClientDirectoryDatabase,
  createMyRelationshipDatabase,
  createHolderAssignmentDatabase,
  createHolderReassignmentDatabase,
  createRelationshipHistoryDatabase,
  createRelationshipStateDatabase,
  createSubstitutionProposalDatabase,
  createSubstitutionTerminationDatabase,
  createSubstitutionListDatabase,
} from './infrastructure/index.js'

let cached: ClientDirectoryService | undefined
let cachedMine: MyRelationshipService | undefined
let cachedHolders: HolderAssignmentService | undefined
let cachedStates: RelationshipStateService | undefined
let cachedReassignments: HolderReassignmentService | undefined
let cachedHistories: RelationshipHistoryService | undefined
let cachedSubstitutions: SubstitutionProposalService | undefined
let cachedTerminations: SubstitutionTerminationService | undefined
let cachedSubstitutionPages: SubstitutionListService | undefined

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

export function relationshipHistoryService(): RelationshipHistoryService {
  cachedHistories ??= createRelationshipHistoryService(createRelationshipHistoryDatabase())
  return cachedHistories
}

export function substitutionProposalService(): SubstitutionProposalService {
  cachedSubstitutions ??= createSubstitutionProposalService(createSubstitutionProposalDatabase())
  return cachedSubstitutions
}

export function substitutionTerminationService(): SubstitutionTerminationService {
  cachedTerminations ??= createSubstitutionTerminationService(
    createSubstitutionTerminationDatabase(),
  )
  return cachedTerminations
}

export function substitutionListService(): SubstitutionListService {
  cachedSubstitutionPages ??= createSubstitutionListService(createSubstitutionListDatabase())
  return cachedSubstitutionPages
}

export function myRelationshipService(): MyRelationshipService {
  cachedMine ??= createMyRelationshipService(createMyRelationshipDatabase())
  return cachedMine
}
