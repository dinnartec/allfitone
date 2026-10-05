/**
 * What every Backoffice resend carries, whatever kind of invitation it resends.
 *
 * Team, client and ownership resends differ only in what comes back. Who is asking,
 * what makes the command idempotent and the token a reissue would be signed with are
 * the same three things, so they are declared once here rather than kept in step by
 * hand in each kind's own file.
 */

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
