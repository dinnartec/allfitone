/**
 * Organization handover use cases.
 *
 * No authorization branch here: the lifecycle duty and AAL2 are resolved inside each
 * command's transaction. This layer derives the invitation token from the command id
 * — the same derivation the worker repeats to build the link — and hands the database
 * only its hash. Without a configured token key the command fails before anything is
 * written.
 */

import {
  activeInvitationTokenKeyVersion,
  createInvitationToken,
  hashInvitationToken,
  invitationTokenKey,
} from '@allfitone/notifications'

import type {
  HandoverActor,
  HandoverCommand,
  HandoverCommandResult,
  HandoverToken,
  OrganizationHandover,
  OrganizationHandoverCreate,
  OrganizationHandoverDatabase,
} from '../domain/handover.js'

export interface OrganizationHandoverService {
  create(
    actor: HandoverActor,
    input: HandoverCommand & { handover: OrganizationHandoverCreate },
  ): Promise<HandoverCommandResult>
  read(
    actor: HandoverActor,
    input: { requestId: string; organizationId: string },
  ): Promise<OrganizationHandover>
  resend(
    actor: HandoverActor,
    input: HandoverCommand & { organizationId: string },
  ): Promise<HandoverCommandResult>
  cancel(
    actor: HandoverActor,
    input: HandoverCommand & { organizationId: string },
  ): Promise<HandoverCommandResult>
}

export function createOrganizationHandoverService(
  database: OrganizationHandoverDatabase,
  options: { environment?: NodeJS.ProcessEnv } = {},
): OrganizationHandoverService {
  function tokenFor(commandId: string): HandoverToken {
    const environment = options.environment ?? process.env
    const tokenKeyVersion = activeInvitationTokenKeyVersion(environment)
    const token = createInvitationToken(commandId, invitationTokenKey(tokenKeyVersion, environment))
    return { tokenHash: hashInvitationToken(token), tokenKeyVersion }
  }

  return {
    create: (actor, input) => database.create({ ...actor, ...input, ...tokenFor(input.commandId) }),
    read: (actor, input) => database.read({ ...actor, ...input }),
    resend: (actor, input) => database.resend({ ...actor, ...input, ...tokenFor(input.commandId) }),
    cancel: (actor, input) => database.cancel({ ...actor, ...input }),
  }
}
