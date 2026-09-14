/**
 * PostgreSQL access for the organization handover.
 *
 * Every function returns the handover projection the database built, so the API
 * never assembles the organization, its site and its invitation from separate reads
 * that could disagree.
 */

import { database } from '../../../platform/db/index.js'
import type { OrganizationHandover, OrganizationHandoverDatabase } from '../domain/handover.js'
import { inBackofficeTransaction } from './backoffice-transaction.js'

type CommandRow = { result: OrganizationHandover; replayed: boolean }

export function createOrganizationHandoverDatabase(): OrganizationHandoverDatabase {
  const sql = database()

  return {
    create: (input) =>
      inBackofficeTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const handover = input.handover
        const [row] = await transaction<CommandRow[]>`
          select * from organizations.create_unclaimed_organization(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${handover.display_name}, ${handover.type_code}, ${handover.party_kind},
            ${handover.legal_name ?? null},
            ${handover.site?.name ?? null}, ${handover.site?.address ?? null},
            ${handover.owner_email},
            ${input.tokenHash}, ${input.tokenKeyVersion}::smallint,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not create the organization handover')
        return { resource: row.result, replayed: row.replayed }
      }),

    read: (input) =>
      inBackofficeTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<Array<{ handover: OrganizationHandover | null }>>`
          select organizations.read_organization_handover(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid
          ) as handover
        `
        if (!row?.handover) throw new Error('PostgreSQL did not read the organization handover')
        return row.handover
      }),

    resend: (input) =>
      inBackofficeTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from organizations.resend_ownership_invitation(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid,
            ${input.tokenHash}, ${input.tokenKeyVersion}::smallint,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not resend the ownership invitation')
        return { resource: row.result, replayed: row.replayed }
      }),

    cancel: (input) =>
      inBackofficeTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from organizations.cancel_unclaimed_organization(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not cancel the organization')
        return { resource: row.result, replayed: row.replayed }
      }),
  }
}
