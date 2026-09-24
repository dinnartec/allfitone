/**
 * Verifying a professional credential: the queue, the decision and renewal.
 *
 * Nothing that makes this safe is repeated here. The duty, AAL2, the conflict
 * rules, the derived validity and the refusal of a lapsed source all live in
 * PostgreSQL, and a second answer in this layer could disagree with the one that
 * decides. What is repeated is the closed vocabulary, so a malformed request is
 * answered 422 instead of becoming a database error.
 *
 * `requestId` is the trace identifier, as it is everywhere else in the API. The
 * verification request a decision resolves travels as `decision.request_id`.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type CredentialVerificationRequest = AllfitV1Schemas['CredentialVerificationRequest']
export type CredentialVerificationOutcome = AllfitV1Schemas['CredentialVerificationOutcome']
export type CredentialVerificationDecisionCreate =
  AllfitV1Schemas['CredentialVerificationDecisionCreate']
export type CredentialVerificationMethod = AllfitV1Schemas['CredentialVerificationMethod']
export type CredentialVerificationResult = AllfitV1Schemas['CredentialVerificationResult']
export type CredentialRenewalDue = AllfitV1Schemas['CredentialRenewalDue']

export const VERIFICATION_METHODS: readonly CredentialVerificationMethod[] = [
  'official_registry_lookup',
  'issuer_confirmation',
]

/** No default and no `revoked`: revocation is another event, not a decision. */
export const VERIFICATION_RESULTS: readonly CredentialVerificationResult[] = [
  'verified',
  'rejected',
  'unverifiable',
]

export interface CredentialVerifier {
  actorPersonId: string
  actorSessionId: string
}

export interface VerificationCommandContext {
  idempotencyKey: string
  commandId: string
  requestId: string
  requestHash: Buffer
}

export interface VerificationCommandResult {
  resource: CredentialVerificationOutcome
  replayed: boolean
}

export interface VerificationPage {
  requestId: string
  limit?: number | undefined
}

export interface CredentialVerificationDatabase {
  listRequests(
    input: CredentialVerifier & VerificationPage,
  ): Promise<CredentialVerificationRequest[]>
  decide(
    input: CredentialVerifier &
      VerificationCommandContext & { decision: CredentialVerificationDecisionCreate },
  ): Promise<VerificationCommandResult>
  listDueRenewals(input: CredentialVerifier & VerificationPage): Promise<CredentialRenewalDue[]>
  openRenewal(
    input: CredentialVerifier & VerificationCommandContext & { credentialId: string },
  ): Promise<VerificationCommandResult>
}
