/**
 * PostgreSQL access for the guest quota.
 *
 * The projection comes back from the same call that wrote the number, so the occupancy
 * the operator reads is the one the quota was just judged against rather than a second
 * read that could already disagree with it.
 */

import { database } from '../../../platform/db/index.js'
import type { OrganizationGuestQuota, OrganizationGuestQuotaDatabase } from '../domain/quota.js'
import { inBackofficeTransaction } from './backoffice-transaction.js'

type CommandRow = { result: OrganizationGuestQuota; replayed: boolean }

export function createOrganizationGuestQuotaDatabase(): OrganizationGuestQuotaDatabase {
  const sql = database()

  return {
    set: (input) =>
      inBackofficeTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from organizations.set_organization_guest_quota(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid, ${input.decision.seats}::integer,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not set the organization guest quota')
        return { resource: row.result, replayed: row.replayed }
      }),
  }
}
