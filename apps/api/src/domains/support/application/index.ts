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
  PlatformAccessDatabase,
  PlatformCommandContext,
  PlatformCommandResult,
  PlatformDutyAssignment,
  PlatformDutyCode,
  PlatformRoleAssignment,
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
  }
}
