/**
 * Stopping a gym without destroying it: `OP-ORG-024` and `OP-ORG-025` (`HU-BO-016`).
 *
 * The rules — the lifecycle duty, which states may be stopped, one cause per person
 * served, closing only this suspension's causes — live in PostgreSQL. What is repeated
 * here is the command's shape, so a reason the platform never agreed to is answered
 * before it reaches the database.
 *
 * Reactivation carries no body at all. It is subtractive by design: there is nothing to
 * say about it beyond which gym, because it removes one cause and recomputes from
 * whatever is true now rather than restoring anything.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type OrganizationSuspension = AllfitV1Schemas['OrganizationSuspension']
export type OrganizationSuspensionDecision = AllfitV1Schemas['OrganizationSuspensionDecision']
export type OrganizationSuspensionReason = AllfitV1Schemas['OrganizationSuspensionReason']

export const SUSPENSION_REASONS: readonly OrganizationSuspensionReason[] = [
  'nonpayment',
  'terms_breach',
  'security_incident',
  'legal_requirement',
]

export interface SuspensionActor {
  actorPersonId: string
  actorSessionId: string
}

export interface SuspensionCommand {
  requestId: string
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

export interface SuspensionCommandResult {
  resource: OrganizationSuspension
  replayed: boolean
}

export interface OrganizationSuspensionDatabase {
  suspend(
    input: SuspensionActor &
      SuspensionCommand & { organizationId: string; decision: OrganizationSuspensionDecision },
  ): Promise<SuspensionCommandResult>
  reactivate(
    input: SuspensionActor & SuspensionCommand & { organizationId: string },
  ): Promise<SuspensionCommandResult>
}
