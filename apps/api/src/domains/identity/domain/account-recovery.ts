/**
 * Account recovery started by support: `NEW-IDN-ACTION`, `OP-IDN-046..048`, `HU-BO-010`.
 *
 * A command carries only the case it answers. The person, the address and the flow come
 * from PostgreSQL, so no client can use a command to point a recovery somewhere else;
 * whether recovery is possible at all, and what can be resent or cancelled, is decided
 * there too.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BackofficeAccountRecovery = AllfitV1Schemas['BackofficeAccountRecovery']
export type BackofficeAccountRecoveryRequest = AllfitV1Schemas['BackofficeAccountRecoveryRequest']

export interface RecoveryAssistant {
  actorPersonId: string
  actorSessionId: string
}

export interface RecoveryCommand {
  idempotencyKey: string
  commandId: string
  requestId: string
  requestHash: Uint8Array
  caseReference: string
}

export interface RecoveryCommandResult {
  resource: BackofficeAccountRecoveryRequest
  replayed: boolean
}

export interface AccountRecoveryDatabase {
  read(
    input: RecoveryAssistant & { requestId: string; caseReference: string; personId: string },
  ): Promise<BackofficeAccountRecovery>
  start(
    input: RecoveryAssistant & RecoveryCommand & { personId: string },
  ): Promise<RecoveryCommandResult>
  resend(
    input: RecoveryAssistant & RecoveryCommand & { personId: string; recoveryId: string },
  ): Promise<RecoveryCommandResult>
  cancel(
    input: RecoveryAssistant & RecoveryCommand & { personId: string; recoveryId: string },
  ): Promise<RecoveryCommandResult>
}
