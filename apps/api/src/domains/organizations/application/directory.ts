/**
 * Organization directory use case.
 *
 * No authorization branch here: the support or lifecycle duty and AAL2 are
 * resolved inside the read's own transaction. This layer carries the reader through.
 */

import type {
  DirectoryReader,
  OrganizationDirectoryDatabase,
  OrganizationDirectoryPage,
  OrganizationDirectoryQuery,
} from '../domain/directory.js'

export interface OrganizationDirectoryService {
  list(
    reader: DirectoryReader,
    input: OrganizationDirectoryQuery,
  ): Promise<OrganizationDirectoryPage>
}

export function createOrganizationDirectoryService(
  database: OrganizationDirectoryDatabase,
): OrganizationDirectoryService {
  return {
    list: (reader, input) => database.list({ ...reader, ...input }),
  }
}
