import {
  createStudioOrganizationService,
  type StudioOrganizationService,
} from './application/index.js'
import { createOrganizationDatabase } from './infrastructure/index.js'

let cached: StudioOrganizationService | undefined

export function studioOrganizationService(): StudioOrganizationService {
  cached ??= createStudioOrganizationService(createOrganizationDatabase())
  return cached
}
