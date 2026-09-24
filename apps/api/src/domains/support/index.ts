/**
 * Public interface of the support domain.
 *
 * Platform access administration is the root of Backoffice authorization: every
 * other operation resolves the duty this module grants. Nothing outside reaches
 * past this file.
 */

export { backofficePlatformAccessRoutes } from './handlers/backoffice.js'
export { backofficeSupportMetadataRoutes } from './handlers/backoffice-metadata.js'
export { backofficeBreakGlassRoutes } from './handlers/backoffice-break-glass.js'
export {
  breakGlassService,
  platformAccessService,
  supportAttentionService,
  supportDiagnosisService,
  supportMetadataService,
} from './dependencies.js'
export type {
  BreakGlassService,
  PlatformAccessService,
  SupportAttentionService,
  SupportDiagnosisService,
  SupportMetadataService,
} from './application/index.js'
export type {
  BreakGlassRequest,
  BreakGlassExerciseOutcome,
  SupportAttentionPanel,
  SupportDeliveryCircuit,
  SupportOperation,
  SupportPersonMetadata,
  SupportPeopleSearch,
  PlatformDutyAssignment,
  PlatformDutyCode,
  PlatformDutyStatus,
  PlatformPage,
  PlatformRoleAssignment,
} from './domain/index.js'
