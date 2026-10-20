/**
 * The suspension use cases.
 *
 * No authorization branch here: the lifecycle duty, AAL2 and which states may be
 * stopped are all resolved inside each command's own transaction.
 */

import type {
  OrganizationSuspensionDatabase,
  OrganizationSuspensionDecision,
  SuspensionActor,
  SuspensionCommand,
  SuspensionCommandResult,
} from '../domain/suspension.js'

export interface OrganizationSuspensionService {
  suspend(
    actor: SuspensionActor,
    input: SuspensionCommand & {
      organizationId: string
      decision: OrganizationSuspensionDecision
    },
  ): Promise<SuspensionCommandResult>
  reactivate(
    actor: SuspensionActor,
    input: SuspensionCommand & { organizationId: string },
  ): Promise<SuspensionCommandResult>
}

export function createOrganizationSuspensionService(
  database: OrganizationSuspensionDatabase,
): OrganizationSuspensionService {
  return {
    suspend: (actor, input) => database.suspend({ ...actor, ...input }),
    reactivate: (actor, input) => database.reactivate({ ...actor, ...input }),
  }
}
