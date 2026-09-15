/**
 * Resending a gym's team invitations from Backoffice: `OP-IDN-045`, `HU-BO-011`.
 *
 * A resend command carries no contact, no role and no organization of its own —
 * only which invitation — so no client can use it to change what the invitation
 * proposed. Whether it is redelivered or reissued, and whether it can be resent at
 * all, is decided in PostgreSQL.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BackofficeTeamInvitation = AllfitV1Schemas['BackofficeTeamInvitation']
export type BackofficeTeamInvitationList = AllfitV1Schemas['BackofficeTeamInvitationList']
export type BackofficeTeamInvitationResend = AllfitV1Schemas['BackofficeTeamInvitationResend']

export interface InvitationResender {
  actorPersonId: string
  actorSessionId: string
}

export interface InvitationResendCommand {
  idempotencyKey: string
  commandId: string
  requestId: string
  requestHash: Uint8Array
}

export interface InvitationResendToken {
  tokenHash: Uint8Array
  tokenKeyVersion: number
}

export interface InvitationResendResult {
  resource: BackofficeTeamInvitationResend
  replayed: boolean
}

export interface TeamInvitationResendDatabase {
  list(
    input: InvitationResender & { requestId: string; organizationId: string },
  ): Promise<BackofficeTeamInvitationList>
  resend(
    input: InvitationResender &
      InvitationResendCommand &
      InvitationResendToken & { organizationId: string; invitationId: string },
  ): Promise<InvitationResendResult>
}
