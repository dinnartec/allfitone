/**
 * Public interface of the support domain.
 *
 * Platform access administration is the root of Backoffice authorization: every
 * other operation resolves the duty this module grants. Nothing outside reaches
 * past this file.
 */

export { backofficePlatformAccessRoutes } from './handlers/backoffice.js'
export { backofficeSupportMetadataRoutes } from './handlers/backoffice-metadata.js'
export { platformAccessService, supportMetadataService } from './dependencies.js'
export type { PlatformAccessService, SupportMetadataService } from './application/index.js'
export type {
  SupportPersonMetadata,
  SupportPeopleSearch,
  PlatformDutyAssignment,
  PlatformDutyCode,
  PlatformDutyStatus,
  PlatformPage,
  PlatformRoleAssignment,
} from './domain/index.js'
