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
  SupportMetadataDatabase,
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
  }
}
