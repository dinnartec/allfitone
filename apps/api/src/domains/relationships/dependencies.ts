import {
  createClientDirectoryService,
  createHolderAssignmentService,
  type ClientDirectoryService,
  type HolderAssignmentService,
} from './application/index.js'
import {
  createClientDirectoryDatabase,
  createHolderAssignmentDatabase,
} from './infrastructure/index.js'

let cached: ClientDirectoryService | undefined
let cachedHolders: HolderAssignmentService | undefined

export function clientDirectoryService(): ClientDirectoryService {
  cached ??= createClientDirectoryService(createClientDirectoryDatabase())
  return cached
}

export function holderAssignmentService(): HolderAssignmentService {
  cachedHolders ??= createHolderAssignmentService(createHolderAssignmentDatabase())
  return cachedHolders
}
