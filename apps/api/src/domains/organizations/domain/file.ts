/**
 * A gym's file as Allfit's team reads it: NEW-SUP-ORG-DETAIL (`HU-BO-013`).
 *
 * The projection is built in PostgreSQL, which also records every active member it
 * returns in the access log before the file travels. Nothing here assembles or
 * filters it: the API carries it as the database closed it.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BackofficeOrganizationFile = AllfitV1Schemas['BackofficeOrganizationFile']

export interface OrganizationFileReader {
  actorPersonId: string
  actorSessionId: string
}

export interface OrganizationFileDatabase {
  read(
    input: OrganizationFileReader & { requestId: string; organizationId: string },
  ): Promise<BackofficeOrganizationFile>
}
