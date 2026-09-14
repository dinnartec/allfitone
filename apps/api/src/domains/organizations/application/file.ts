/**
 * Organization file use case.
 *
 * No authorization branch here: the duty, AAL2 and the access records are resolved
 * inside the read's own transaction.
 */

import type {
  BackofficeOrganizationFile,
  OrganizationFileDatabase,
  OrganizationFileReader,
} from '../domain/file.js'

export interface OrganizationFileService {
  read(
    reader: OrganizationFileReader,
    input: { requestId: string; organizationId: string },
  ): Promise<BackofficeOrganizationFile>
}

export function createOrganizationFileService(
  database: OrganizationFileDatabase,
): OrganizationFileService {
  return {
    read: (reader, input) => database.read({ ...reader, ...input }),
  }
}
