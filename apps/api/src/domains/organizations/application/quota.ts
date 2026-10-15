/**
 * The guest quota use case.
 *
 * No authorization branch here: the commercial duty, AAL2 and which states may be sold
 * a quota are all resolved inside the command's own transaction.
 */

import type {
  GuestQuotaActor,
  GuestQuotaCommand,
  GuestQuotaCommandResult,
  OrganizationGuestQuotaDatabase,
  OrganizationGuestQuotaDecision,
} from '../domain/quota.js'

export interface OrganizationGuestQuotaService {
  set(
    actor: GuestQuotaActor,
    input: GuestQuotaCommand & {
      organizationId: string
      decision: OrganizationGuestQuotaDecision
    },
  ): Promise<GuestQuotaCommandResult>
}

export function createOrganizationGuestQuotaService(
  database: OrganizationGuestQuotaDatabase,
): OrganizationGuestQuotaService {
  return {
    set: (actor, input) => database.set({ ...actor, ...input }),
  }
}
