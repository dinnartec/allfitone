/**
 * What a gym may fill: `OP-ORG-023` (`HU-BO-034`).
 *
 * The rules — the commercial duty, which states may be sold a quota, what occupies a
 * place — live in PostgreSQL. What is repeated here is the command's shape, so a body
 * that is not a number of people is answered before it reaches the database.
 *
 * `seats` is nullable on purpose and the null is meaningful: a deal with no cap. It is
 * not the same as a missing field, which is a body that forgot to say anything.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type OrganizationGuestQuota = AllfitV1Schemas['OrganizationGuestQuota']
export type OrganizationGuestQuotaDecision = AllfitV1Schemas['OrganizationGuestQuotaDecision']

export const MAX_GUEST_QUOTA_SEATS = 1_000_000

export interface GuestQuotaActor {
  actorPersonId: string
  actorSessionId: string
}

export interface GuestQuotaCommand {
  requestId: string
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

export interface GuestQuotaCommandResult {
  resource: OrganizationGuestQuota
  replayed: boolean
}

export interface OrganizationGuestQuotaDatabase {
  set(
    input: GuestQuotaActor &
      GuestQuotaCommand & { organizationId: string; decision: OrganizationGuestQuotaDecision },
  ): Promise<GuestQuotaCommandResult>
}
