/**
 * Platform access: the base role that lets a person into Backoffice and the
 * temporary duty that authorizes one operation.
 *
 * The two are independent controls and neither implies the other, so they are
 * modelled as two resources rather than one "permission". Every rule that makes
 * them safe — no self-assignment, never zero administrators, the closed
 * catalogue, the ninety-day bound, the append-only history — lives in
 * PostgreSQL. Nothing here re-implements it, and nothing here may be relaxed to
 * make a screen easier: this module only carries commands to the database and
 * projections back.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type PlatformRoleAssignment = AllfitV1Schemas['PlatformRoleAssignment']
export type PlatformDutyAssignment = AllfitV1Schemas['PlatformDutyAssignment']
export type PlatformDutyCode = AllfitV1Schemas['PlatformDutyCode']

/**
 * The closed catalogue, repeated here only so a request body can be checked
 * against it before reaching PostgreSQL. The database CHECK remains the
 * authority; this list exists to answer 422 instead of 409.
 */
export const PLATFORM_DUTY_CODES: readonly PlatformDutyCode[] = [
  'view_platform_metrics',
  'diagnose_support_metadata',
  'view_billing_metadata',
  'manage_organization_lifecycle',
  'request_break_glass',
  'verify_professional_credentials',
  'curate_global_catalog',
  'manage_platform_commercial',
  'manage_platform_access',
  'audit_platform_access',
  'approve_break_glass',
  'audit_break_glass',
  'manage_privacy_requests',
]

export interface PlatformCommandContext {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
  requestId: string
}

export interface PlatformCommandResult<T> {
  resource: T
  replayed: boolean
}

export interface PlatformAccessDatabase {
  grantRole(
    input: PlatformCommandContext & {
      actorPersonId: string
      actorSessionId: string
      personId: string
      platformRole: 'allfit_admin'
    },
  ): Promise<PlatformCommandResult<PlatformRoleAssignment>>
  revokeRole(
    input: PlatformCommandContext & {
      actorPersonId: string
      actorSessionId: string
      assignmentId: string
    },
  ): Promise<PlatformCommandResult<PlatformRoleAssignment>>
  grantDuty(
    input: PlatformCommandContext & {
      actorPersonId: string
      actorSessionId: string
      personId: string
      dutyCode: PlatformDutyCode
      validFrom: string | undefined
      validTo: string
      reasonCode: string
    },
  ): Promise<PlatformCommandResult<PlatformDutyAssignment>>
  closeDuty(
    input: PlatformCommandContext & {
      actorPersonId: string
      actorSessionId: string
      assignmentId: string
      targetStatus: 'suspended' | 'revoked'
    },
  ): Promise<PlatformCommandResult<PlatformDutyAssignment>>
}
