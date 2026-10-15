/**
 * Platform access use cases.
 *
 * There is deliberately no authorization branch here. `manage_platform_access`,
 * AAL2 and the independence of grantor and subject are resolved inside the
 * command's transaction, against the tables, on every call. A check in this
 * layer would be a second answer that can disagree with the first, and the one
 * that matters is the database's.
 */

import type { BackofficeActor } from '../../identity/index.js'
import type {
  BreakGlassCategory,
  BreakGlassCommandResult,
  BreakGlassDatabase,
  BreakGlassExerciseOutcome,
  BreakGlassRequest,
  BreakGlassRequestCreate,
  BreakGlassStatus,
  SupportAttentionDatabase,
  SupportAttentionPanel,
  SupportBusinessDatabase,
  SupportBusinessPanel,
  SupportDeliveryCircuit,
  SupportDiagnosisDatabase,
  SupportOperation,
  SupportOperationCursor,
  SupportOperationSourceKind,
  SupportOperationState,
  SupportMetadataDatabase,
  SupportPersonPayments,
  SupportPeopleSearch,
  SupportPersonMetadata,
  SupportLookupKind,
  SupportReader,
  PlatformAccessDatabase,
  PlatformCommandContext,
  PlatformCommandResult,
  PlatformDutyAssignment,
  PlatformDutyCode,
  PlatformDutyCursor,
  PlatformDutyStatus,
  PlatformPage,
  PlatformRoleAssignment,
  PlatformRoleCursor,
} from '../domain/index.js'

export interface PlatformAccessService {
  grantRole(
    actor: BackofficeActor,
    input: PlatformCommandContext & { personId: string; platformRole: 'allfit_admin' },
  ): Promise<PlatformCommandResult<PlatformRoleAssignment>>
  revokeRole(
    actor: BackofficeActor,
    input: PlatformCommandContext & { assignmentId: string },
  ): Promise<PlatformCommandResult<PlatformRoleAssignment>>
  grantDuty(
    actor: BackofficeActor,
    input: PlatformCommandContext & {
      personId: string
      dutyCode: PlatformDutyCode
      validFrom: string | undefined
      validTo: string
      reasonCode: string
    },
  ): Promise<PlatformCommandResult<PlatformDutyAssignment>>
  suspendDuty(
    actor: BackofficeActor,
    input: PlatformCommandContext & { assignmentId: string },
  ): Promise<PlatformCommandResult<PlatformDutyAssignment>>
  revokeDuty(
    actor: BackofficeActor,
    input: PlatformCommandContext & { assignmentId: string },
  ): Promise<PlatformCommandResult<PlatformDutyAssignment>>
  listRoles(
    actor: BackofficeActor,
    input: { requestId: string; limit: number; cursor?: PlatformRoleCursor },
  ): Promise<PlatformPage<PlatformRoleAssignment>>
  listDuties(
    actor: BackofficeActor,
    input: {
      requestId: string
      limit: number
      personId?: string
      dutyCode?: PlatformDutyCode
      status?: PlatformDutyStatus
      cursor?: PlatformDutyCursor
    },
  ): Promise<PlatformPage<PlatformDutyAssignment>>
}

export function createPlatformAccessService(
  database: PlatformAccessDatabase,
): PlatformAccessService {
  const from = (actor: BackofficeActor) => ({
    actorPersonId: actor.personId,
    actorSessionId: actor.sessionId,
  })

  return {
    grantRole: (actor, input) => database.grantRole({ ...from(actor), ...input }),
    revokeRole: (actor, input) => database.revokeRole({ ...from(actor), ...input }),
    grantDuty: (actor, input) => database.grantDuty({ ...from(actor), ...input }),
    suspendDuty: (actor, input) => database.suspendDuty({ ...from(actor), ...input }),
    revokeDuty: (actor, input) => database.revokeDuty({ ...from(actor), ...input }),
    listRoles: (actor, input) => database.listRoles({ ...from(actor), ...input }),
    listDuties: (actor, input) => database.listDuties({ ...from(actor), ...input }),
  }
}

/**
 * Support metadata reads.
 *
 * There is no authorization branch here: `diagnose_support_metadata` and AAL2
 * are resolved inside the read's own transaction, against the tables. What this
 * layer does own is the shape of "found nothing", which is a rule rather than a
 * presentation choice — `HU-BO-006` criterion 3 forbids answering an
 * unexplained empty list, so the outcome is decided once here instead of in each
 * client's copy.
 */
export interface SupportMetadataService {
  search(
    reader: SupportReader,
    input: {
      requestId: string
      caseReference: string
      lookupKind: SupportLookupKind
      lookupValue: string
    },
  ): Promise<SupportPeopleSearch>
  read(
    reader: SupportReader,
    input: { requestId: string; caseReference: string; personId: string },
  ): Promise<SupportPersonMetadata>
  /**
   * What she pays. Nothing is decided here: the duty, the case reference and what
   * the projection refuses to carry are all the database's, and a rule restated in
   * TypeScript would be a second place to get it wrong.
   */
  payments(
    reader: SupportReader,
    input: { requestId: string; caseReference: string; personId: string },
  ): Promise<SupportPersonPayments>
}

export function createSupportMetadataService(
  database: SupportMetadataDatabase,
): SupportMetadataService {
  return {
    search: async (reader, input) => {
      const found = await database.search({ ...reader, ...input })
      return found ? { outcome: 'found', items: [found] } : { outcome: 'not_found', items: [] }
    },
    read: (reader, input) => database.read({ ...reader, ...input }),
    payments: (reader, input) => database.payments({ ...reader, ...input }),
  }
}

/**
 * Technical diagnosis carries the reader through and nothing else. Every rule
 * that matters — the duty, the derived states, and above all what the projection
 * refuses to return — lives in the database.
 */
export interface SupportDiagnosisService {
  listOperations(
    reader: SupportReader,
    input: {
      requestId: string
      limit: number
      source?: SupportOperationSourceKind
      state?: SupportOperationState
      aggregateId?: string
      cursor?: SupportOperationCursor
    },
  ): Promise<PlatformPage<SupportOperation>>
  listDeliveryCircuits(
    reader: SupportReader,
    input: { requestId: string },
  ): Promise<SupportDeliveryCircuit[]>
}

export function createSupportDiagnosisService(
  database: SupportDiagnosisDatabase,
): SupportDiagnosisService {
  return {
    listOperations: (reader, input) => database.listOperations({ ...reader, ...input }),
    listDeliveryCircuits: (reader, input) => database.listDeliveryCircuits({ ...reader, ...input }),
  }
}

/**
 * The attention panel carries the reader through. Which notices this operator
 * sees is resolved from their duties inside the read's own transaction, so this
 * layer cannot show a counter the database withheld.
 */
export interface SupportAttentionService {
  read(reader: SupportReader, input: { requestId: string }): Promise<SupportAttentionPanel>
}

export function createSupportAttentionService(
  database: SupportAttentionDatabase,
): SupportAttentionService {
  return {
    read: (reader, input) => database.read({ ...reader, ...input }),
  }
}

/**
 * The business panel is one duty and one read. There is nothing to compose here:
 * whether a figure can be given at all is a decision only the database can make.
 */
export interface SupportBusinessService {
  read(reader: SupportReader, input: { requestId: string }): Promise<SupportBusinessPanel>
}

export function createSupportBusinessService(
  database: SupportBusinessDatabase,
): SupportBusinessService {
  return {
    read: (reader, input) => database.read({ ...reader, ...input }),
  }
}

/**
 * Break-glass use cases.
 *
 * No authorization branch here, as everywhere else in this module: the duty, the
 * quorum, the window and the independence of approvers are all resolved inside
 * each command's own transaction.
 *
 * One thing is worth noticing about `exercise`: it resolves rather than rejects
 * when the attempt is denied. The evidence of a refused attempt is the point of
 * the operation, and an exception would roll it back.
 */
export interface BreakGlassService {
  request(
    actor: BackofficeActor,
    input: PlatformCommandContext & { publication: BreakGlassRequestCreate },
  ): Promise<BreakGlassCommandResult>
  decide(
    actor: BackofficeActor,
    input: PlatformCommandContext & {
      breakGlassRequestId: string
      decision: 'approved' | 'rejected'
      reasonCode: string
    },
  ): Promise<BreakGlassCommandResult>
  exercise(
    actor: BackofficeActor,
    input: {
      breakGlassRequestId: string
      category: BreakGlassCategory
      resourceType: string
      resourceId?: string
      requestTraceId: string
    },
  ): Promise<BreakGlassExerciseOutcome>
  close(
    actor: BackofficeActor,
    input: PlatformCommandContext & { breakGlassRequestId: string },
  ): Promise<BreakGlassCommandResult>
  list(
    actor: BackofficeActor,
    input: { requestId: string; mine: boolean; status?: BreakGlassStatus; limit: number },
  ): Promise<BreakGlassRequest[]>
}

export function createBreakGlassService(database: BreakGlassDatabase): BreakGlassService {
  const from = (actor: BackofficeActor) => ({
    actorPersonId: actor.personId,
    actorSessionId: actor.sessionId,
  })
  return {
    request: (actor, input) => database.request({ ...from(actor), ...input }),
    decide: (actor, input) => database.decide({ ...from(actor), ...input }),
    exercise: (actor, input) => database.exercise({ ...from(actor), ...input }),
    close: (actor, input) => database.close({ ...from(actor), ...input }),
    list: (actor, input) => database.list({ ...from(actor), ...input }),
  }
}
