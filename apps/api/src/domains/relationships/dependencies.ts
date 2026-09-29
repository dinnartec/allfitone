import { createClientDirectoryService, type ClientDirectoryService } from './application/index.js'
import { createClientDirectoryDatabase } from './infrastructure/index.js'

let cached: ClientDirectoryService | undefined

export function clientDirectoryService(): ClientDirectoryService {
  cached ??= createClientDirectoryService(createClientDirectoryDatabase())
  return cached
}
