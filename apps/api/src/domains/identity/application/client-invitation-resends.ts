/**
 * Client invitation resend use cases.
 *
 * No authorization branch here: the support duty and AAL2 are resolved inside the
 * command's transaction. This layer derives the token a reissue would carry from the
 * command id — the derivation the worker repeats to build the link — and hands the
 * database only its hash. A redelivery ignores it: that invitation keeps the token it
 * was first sent with, so the earlier email keeps working.
 */

import {
  activeInvitationTokenKeyVersion,
  createInvitationToken,
  hashInvitationToken,
  invitationTokenKey,
} from '@allfitone/notifications'

import type {
  BackofficeClientInvitationList,
  ClientInvitationResendDatabase,
  ClientInvitationResendResult,
} from '../domain/client-invitation-resends.js'
import type {
  InvitationResendCommand,
  InvitationResendToken,
  InvitationResender,
} from '../domain/invitation-resends.js'

export interface ClientInvitationResendService {
  list(
    resender: InvitationResender,
    input: { requestId: string; organizationId: string },
  ): Promise<BackofficeClientInvitationList>
  resend(
    resender: InvitationResender,
    input: InvitationResendCommand & { organizationId: string; invitationId: string },
  ): Promise<ClientInvitationResendResult>
}

export function createClientInvitationResendService(
  database: ClientInvitationResendDatabase,
  options: { environment?: NodeJS.ProcessEnv } = {},
): ClientInvitationResendService {
  function tokenFor(commandId: string): InvitationResendToken {
    const environment = options.environment ?? process.env
    const tokenKeyVersion = activeInvitationTokenKeyVersion(environment)
    const token = createInvitationToken(commandId, invitationTokenKey(tokenKeyVersion, environment))
    return { tokenHash: hashInvitationToken(token), tokenKeyVersion }
  }

  return {
    list: (resender, input) => database.list({ ...resender, ...input }),
    resend: (resender, input) =>
      database.resend({ ...resender, ...input, ...tokenFor(input.commandId) }),
  }
}
