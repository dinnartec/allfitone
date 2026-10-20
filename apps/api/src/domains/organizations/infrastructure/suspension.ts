/**
 * PostgreSQL access for suspending and reactivating a gym.
 *
 * Both answers come back from the call that wrote the state, so the number of people
 * affected is the one the decision actually produced rather than a second read that
 * could already disagree with it.
 */

import { database } from '../../../platform/db/index.js'
import type {
  OrganizationSuspension,
  OrganizationSuspensionDatabase,
} from '../domain/suspension.js'
import { inBackofficeTransaction } from './backoffice-transaction.js'

type CommandRow = { result: OrganizationSuspension; replayed: boolean }

export function createOrganizationSuspensionDatabase(): OrganizationSuspensionDatabase {
  const sql = database()

  return {
    suspend: (input) =>
      inBackofficeTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from organizations.suspend_organization(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid, ${input.decision.reason_code},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not suspend the organization')
        return { resource: row.result, replayed: row.replayed }
      }),

    reactivate: (input) =>
      inBackofficeTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from organizations.reactivate_organization(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not reactivate the organization')
        return { resource: row.result, replayed: row.replayed }
      }),
  }
}
