/**
 * Resending a gym's client invitations from Backoffice: `OP-IDN-051`, `HU-BO-011`.
 *
 * The command carries no contact, no organization and no offer of its own — only
 * which invitation — so nothing a client sends can change what the invitation
 * proposed. Which scopes it asked for, whether it can be resent at all, and whether
 * a resend redelivers or reissues are all decided in PostgreSQL, where a reissue
 * that offers anything other than the original's offer is refused outright.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import type {
  InvitationResendCommand,
  InvitationResendToken,
  InvitationResender,
} from './invitation-resends.js'

export type BackofficeClientInvitation = AllfitV1Schemas['BackofficeClientInvitation']
export type BackofficeClientInvitationList = AllfitV1Schemas['BackofficeClientInvitationList']
export type BackofficeClientInvitationResend = AllfitV1Schemas['BackofficeClientInvitationResend']

export interface ClientInvitationResendResult {
  resource: BackofficeClientInvitationResend
  replayed: boolean
}

export interface ClientInvitationResendDatabase {
  list(
    input: InvitationResender & { requestId: string; organizationId: string },
  ): Promise<BackofficeClientInvitationList>
  resend(
    input: InvitationResender &
      InvitationResendCommand &
      InvitationResendToken & { organizationId: string; invitationId: string },
  ): Promise<ClientInvitationResendResult>
}
