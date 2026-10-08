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
  // Suspension and revocation are separate closed functions, not one call with a
  // target state: the caller never chooses which transition it is asking for.
  suspendDuty(input: PlatformDutyClosure): Promise<PlatformCommandResult<PlatformDutyAssignment>>
  revokeDuty(input: PlatformDutyClosure): Promise<PlatformCommandResult<PlatformDutyAssignment>>
  listRoles(input: {
    actorPersonId: string
    actorSessionId: string
    requestId: string
    limit: number
    cursor?: PlatformRoleCursor
  }): Promise<PlatformPage<PlatformRoleAssignment>>
  listDuties(input: {
    actorPersonId: string
    actorSessionId: string
    requestId: string
    limit: number
    personId?: string
    dutyCode?: PlatformDutyCode
    status?: PlatformDutyStatus
    cursor?: PlatformDutyCursor
  }): Promise<PlatformPage<PlatformDutyAssignment>>
}

/**
 * The inventory is read-only evidence, never an authorization cache, so its page
 * has no revision and no ETag: a caller must not be able to reuse yesterday's
 * answer to decide anything.
 */
export interface PlatformPage<T> {
  items: T[]
  hasMore: boolean
  nextCursor?: string
}

export interface PlatformRoleCursor {
  rank: number
  grantedAt: string
  id: string
}

export interface PlatformDutyCursor {
  rank: number
  validTo: string
  createdAt: string
  id: string
}

export type PlatformDutyStatus = 'scheduled' | 'active' | 'suspended' | 'expired' | 'revoked'

export type PlatformDutyClosure = PlatformCommandContext & {
  actorPersonId: string
  actorSessionId: string
  assignmentId: string
}

/**
 * The minimised operational projection: `OP-SUP-005`.
 *
 * What makes it safe is what it cannot say. There is no name, no full contact
 * and no provider subject in the shape, so no handler can leak one by forgetting
 * to filter, and no exploratory search exists because the lookup kinds are a
 * closed set rather than a free query.
 */
export type SupportPersonMetadata = AllfitV1Schemas['SupportPersonMetadata']
export type SupportPeopleSearch = AllfitV1Schemas['SupportPeopleSearch']

export type SupportLookupKind = 'identifier' | 'email' | 'phone'

export const SUPPORT_LOOKUP_KINDS: readonly SupportLookupKind[] = ['identifier', 'email', 'phone']

/**
 * The case reference travels on every read. It is checked here to answer 400
 * rather than a database error; the CHECK in PostgreSQL stays the authority.
 */
export const SUPPORT_CASE_REFERENCE = /^[A-Z][A-Z0-9_-]{2,63}$/

export interface SupportReader {
  actorPersonId: string
  actorSessionId: string
}

export interface SupportMetadataDatabase {
  search(
    input: SupportReader & {
      requestId: string
      caseReference: string
      lookupKind: SupportLookupKind
      lookupValue: string
    },
  ): Promise<SupportPersonMetadata | undefined>
  read(
    input: SupportReader & {
      requestId: string
      caseReference: string
      personId: string
    },
  ): Promise<SupportPersonMetadata>
}

/**
 * Technical diagnosis: `HU-BO-031`.
 *
 * The states are repeated here only so a query string can be refused before it
 * reaches PostgreSQL. The derived-state logic stays in the database, where the
 * data it derives from lives.
 */
export type SupportOperation = AllfitV1Schemas['SupportOperation']
export type SupportOperationState = AllfitV1Schemas['SupportOperationState']
export type SupportOperationSourceKind = AllfitV1Schemas['SupportOperationSourceKind']
export type SupportDeliveryCircuit = AllfitV1Schemas['SupportDeliveryCircuit']

export const SUPPORT_OPERATION_SOURCES: readonly SupportOperationSourceKind[] = [
  'notification',
  'command',
]

export const SUPPORT_OPERATION_STATES: readonly SupportOperationState[] = [
  'pending',
  'retrying',
  'delivered',
  'dead_lettered',
  'processing',
  'stalled',
  'succeeded',
  'rejected_final',
]

export interface SupportOperationCursor {
  occurredAt: string
  id: string
}

export interface SupportDiagnosisDatabase {
  listOperations(
    input: SupportReader & {
      requestId: string
      limit: number
      source?: SupportOperationSourceKind
      state?: SupportOperationState
      aggregateId?: string
      cursor?: SupportOperationCursor
    },
  ): Promise<PlatformPage<SupportOperation>>
  listDeliveryCircuits(
    input: SupportReader & { requestId: string },
  ): Promise<SupportDeliveryCircuit[]>
}

/**
 * What needs attention: `HU-BO-005`.
 *
 * Counters only, each gated by the duty of the screen it leads to. Which notices an
 * operator sees, and what counts as repeated, is decided in PostgreSQL.
 */
export type SupportAttentionPanel = AllfitV1Schemas['SupportAttentionPanel']

export interface SupportAttentionDatabase {
  read(input: SupportReader & { requestId: string }): Promise<SupportAttentionPanel>
}

/**
 * How the business is going: `HU-BO-004`.
 *
 * Counts with the period they were measured over. A figure the platform cannot
 * compute is absent with a reason, and a count of people below the declared
 * minimum is withheld — neither is zero. Which is which is decided in PostgreSQL.
 */
export type SupportBusinessPanel = AllfitV1Schemas['SupportBusinessPanel']

export interface SupportBusinessDatabase {
  read(input: SupportReader & { requestId: string }): Promise<SupportBusinessPanel>
}

/**
 * Break-glass windows: `OP-SUP-001` through `OP-SUP-004`.
 *
 * The vocabularies are repeated here only so a malformed request is answered 422
 * rather than becoming a database error. Everything that makes break-glass safe —
 * the derived tier, the quorum, the independence of approvers, the immutability of
 * the file, the evidence of every attempt — lives in PostgreSQL.
 *
 * Note what is absent from `BreakGlassRequestInput`: the tier, the approval count
 * and the duration. A client cannot ask for the cheap ones because the shape has
 * nowhere to say it.
 */
export type BreakGlassRequest = AllfitV1Schemas['BreakGlassRequest']
export type BreakGlassRequestCreate = AllfitV1Schemas['BreakGlassRequestCreate']
export type BreakGlassCategory = AllfitV1Schemas['BreakGlassCategory']
export type BreakGlassPurpose = AllfitV1Schemas['BreakGlassPurpose']
export type BreakGlassStatus = AllfitV1Schemas['BreakGlassStatus']
export type BreakGlassExercise = AllfitV1Schemas['BreakGlassExercise']
export type BreakGlassExerciseOutcome = AllfitV1Schemas['BreakGlassExerciseOutcome']

export const BREAK_GLASS_CATEGORIES: readonly BreakGlassCategory[] = [
  'relationship_training',
  'prior_training_history',
  'nutrition_guidance',
  'body_progress',
  'health_context',
  'nutrition_intake',
]

export const BREAK_GLASS_PURPOSES: readonly BreakGlassPurpose[] = [
  'service_dispute',
  'legal_or_regulatory_obligation',
  'customer_support_request',
  'security_investigation',
  'authorized_quality_review',
]

export const BREAK_GLASS_STATUSES: readonly BreakGlassStatus[] = [
  'requested',
  'approved',
  'rejected',
  'closed',
  'expired',
]

export interface BreakGlassCommandResult {
  resource: BreakGlassRequest
  replayed: boolean
}

export interface BreakGlassDatabase {
  request(
    input: PlatformCommandContext & {
      actorPersonId: string
      actorSessionId: string
      publication: BreakGlassRequestCreate
    },
  ): Promise<BreakGlassCommandResult>
  decide(
    input: PlatformCommandContext & {
      actorPersonId: string
      actorSessionId: string
      breakGlassRequestId: string
      decision: 'approved' | 'rejected'
      reasonCode: string
    },
  ): Promise<BreakGlassCommandResult>
  exercise(input: {
    actorPersonId: string
    actorSessionId: string
    breakGlassRequestId: string
    category: BreakGlassCategory
    resourceType: string
    resourceId?: string
    requestTraceId: string
  }): Promise<BreakGlassExerciseOutcome>
  close(
    input: PlatformCommandContext & {
      actorPersonId: string
      actorSessionId: string
      breakGlassRequestId: string
    },
  ): Promise<BreakGlassCommandResult>
  list(input: {
    actorPersonId: string
    actorSessionId: string
    requestId: string
    mine: boolean
    status?: BreakGlassStatus
    limit: number
  }): Promise<BreakGlassRequest[]>
}
