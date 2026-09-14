import {
  createStudioOrganizationService,
  type StudioOrganizationService,
} from './application/index.js'
import {
  createOrganizationDirectoryService,
  type OrganizationDirectoryService,
} from './application/directory.js'
import { createOrganizationFileService, type OrganizationFileService } from './application/file.js'
import {
  createOrganizationHandoverService,
  type OrganizationHandoverService,
} from './application/handover.js'
import { createOrganizationDirectoryDatabase } from './infrastructure/directory.js'
import { createOrganizationFileDatabase } from './infrastructure/file.js'
import { createOrganizationHandoverDatabase } from './infrastructure/handover.js'
import { createOrganizationDatabase } from './infrastructure/index.js'

let cached: StudioOrganizationService | undefined
let cachedDirectory: OrganizationDirectoryService | undefined
let cachedHandover: OrganizationHandoverService | undefined
let cachedFile: OrganizationFileService | undefined

export function organizationFileService(): OrganizationFileService {
  cachedFile ??= createOrganizationFileService(createOrganizationFileDatabase())
  return cachedFile
}

export function organizationHandoverService(): OrganizationHandoverService {
  cachedHandover ??= createOrganizationHandoverService(createOrganizationHandoverDatabase())
  return cachedHandover
}

export function studioOrganizationService(): StudioOrganizationService {
  cached ??= createStudioOrganizationService(createOrganizationDatabase())
  return cached
}

export function organizationDirectoryService(): OrganizationDirectoryService {
  cachedDirectory ??= createOrganizationDirectoryService(createOrganizationDirectoryDatabase())
  return cachedDirectory
}
