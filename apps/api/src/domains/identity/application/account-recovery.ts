/**
 * Account recovery use cases.
 *
 * Nothing is decided at this layer: the support duty, AAL2, whether the person can be
 * recovered and every state transition are resolved inside the command's transaction,
 * and the email leaves through the outbox. That is the design, not an omission — no
 * identity provider call happens in a request that also writes to PostgreSQL.
 */

import type {
  AccountRecoveryDatabase,
  BackofficeAccountRecovery,
  RecoveryAssistant,
  RecoveryCommand,
  RecoveryCommandResult,
} from '../domain/account-recovery.js'

export interface AccountRecoveryService {
  read(
    assistant: RecoveryAssistant,
    input: { requestId: string; caseReference: string; personId: string },
  ): Promise<BackofficeAccountRecovery>
  start(
    assistant: RecoveryAssistant,
    input: RecoveryCommand & { personId: string },
  ): Promise<RecoveryCommandResult>
  resend(
    assistant: RecoveryAssistant,
    input: RecoveryCommand & { personId: string; recoveryId: string },
  ): Promise<RecoveryCommandResult>
  cancel(
    assistant: RecoveryAssistant,
    input: RecoveryCommand & { personId: string; recoveryId: string },
  ): Promise<RecoveryCommandResult>
}

export function createAccountRecoveryService(
  database: AccountRecoveryDatabase,
): AccountRecoveryService {
  return {
    read: (assistant, input) => database.read({ ...assistant, ...input }),
    start: (assistant, input) => database.start({ ...assistant, ...input }),
    resend: (assistant, input) => database.resend({ ...assistant, ...input }),
    cancel: (assistant, input) => database.cancel({ ...assistant, ...input }),
  }
}
