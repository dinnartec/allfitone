/**
 * Credential verification use cases.
 *
 * There is no authorization branch here on purpose: the verification duty, AAL2,
 * the effective assignment and the conflict rules are resolved inside each
 * operation's own transaction. This layer carries the verifier through.
 */

import type {
  CredentialRenewalDue,
  CredentialVerificationDatabase,
  CredentialVerificationDecisionCreate,
  CredentialVerificationRequest,
  CredentialVerifier,
  VerificationCommandContext,
  VerificationCommandResult,
  VerificationPage,
} from '../domain/index.js'

export interface CredentialVerificationService {
  listRequests(
    verifier: CredentialVerifier,
    input: VerificationPage,
  ): Promise<CredentialVerificationRequest[]>
  decide(
    verifier: CredentialVerifier,
    input: VerificationCommandContext & { decision: CredentialVerificationDecisionCreate },
  ): Promise<VerificationCommandResult>
  listDueRenewals(
    verifier: CredentialVerifier,
    input: VerificationPage,
  ): Promise<CredentialRenewalDue[]>
  openRenewal(
    verifier: CredentialVerifier,
    input: VerificationCommandContext & { credentialId: string },
  ): Promise<VerificationCommandResult>
}

export function createCredentialVerificationService(
  database: CredentialVerificationDatabase,
): CredentialVerificationService {
  return {
    listRequests: (verifier, input) => database.listRequests({ ...verifier, ...input }),
    decide: (verifier, input) => database.decide({ ...verifier, ...input }),
    listDueRenewals: (verifier, input) => database.listDueRenewals({ ...verifier, ...input }),
    openRenewal: (verifier, input) => database.openRenewal({ ...verifier, ...input }),
  }
}
