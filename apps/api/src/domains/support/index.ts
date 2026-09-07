/**
 * Public interface of the support domain.
 *
 * Platform access administration is the root of Backoffice authorization: every
 * other operation resolves the duty this module grants. Nothing outside reaches
 * past this file.
 */

export { backofficePlatformAccessRoutes } from './handlers/backoffice.js'
export { platformAccessService } from './dependencies.js'
export type { PlatformAccessService } from './application/index.js'
export type {
  PlatformDutyAssignment,
  PlatformDutyCode,
  PlatformDutyStatus,
  PlatformPage,
  PlatformRoleAssignment,
} from './domain/index.js'
