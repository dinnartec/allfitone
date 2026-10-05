/**
 * Resending a gym's team invitations from Backoffice: `OP-IDN-052`, `HU-BO-011`.
 *
 * A resend command carries no contact, no role and no organization of its own —
 * only which invitation — so no client can use it to change what the invitation
 * proposed. Whether it is redelivered or reissued, and whether it can be resent at
 * all, is decided in PostgreSQL.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import type {
  InvitationResendCommand,
  InvitationResendToken,
  InvitationResender,
} from './invitation-resends.js'

export type BackofficeTeamInvitation = AllfitV1Schemas['BackofficeTeamInvitation']
export type BackofficeTeamInvitationList = AllfitV1Schemas['BackofficeTeamInvitationList']
export type BackofficeTeamInvitationResend = AllfitV1Schemas['BackofficeTeamInvitationResend']

export type { InvitationResendCommand, InvitationResendToken, InvitationResender }

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
