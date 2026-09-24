/**
 * PostgreSQL access for a gym's file.
 *
 * One call returns the closed projection; the access records for every member it
 * reveals are written by the same function in the same transaction, so a file whose
 * records fail is never returned.
 */

import { database } from '../../../platform/db/index.js'
import type { BackofficeOrganizationFile, OrganizationFileDatabase } from '../domain/file.js'
import { inBackofficeTransaction } from './backoffice-transaction.js'

export function createOrganizationFileDatabase(): OrganizationFileDatabase {
  const sql = database()

  return {
    read: (input) =>
      inBackofficeTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<Array<{ file: BackofficeOrganizationFile | null }>>`
          select organizations.read_backoffice_organization(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid
          ) as file
        `
        if (!row?.file) throw new Error('PostgreSQL did not read the organization file')
        return row.file
      }),
  }
}
