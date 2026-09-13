import {
  createStudioOrganizationService,
  type StudioOrganizationService,
} from './application/index.js'
import {
  createOrganizationDirectoryService,
  type OrganizationDirectoryService,
} from './application/directory.js'
import { createOrganizationDirectoryDatabase } from './infrastructure/directory.js'
import { createOrganizationDatabase } from './infrastructure/index.js'

let cached: StudioOrganizationService | undefined
let cachedDirectory: OrganizationDirectoryService | undefined

export function studioOrganizationService(): StudioOrganizationService {
  cached ??= createStudioOrganizationService(createOrganizationDatabase())
  return cached
}

export function organizationDirectoryService(): OrganizationDirectoryService {
  cachedDirectory ??= createOrganizationDirectoryService(createOrganizationDirectoryDatabase())
  return cachedDirectory
}
