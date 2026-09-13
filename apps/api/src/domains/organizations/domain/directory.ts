/**
 * The organization directory Allfit's team reads to reach a gym.
 *
 * The rules that make it safe — who may read it, that search matches the display
 * name only and literally, that nothing identifying a person is returned — live in
 * PostgreSQL. What is repeated here is the closed vocabulary and the shape of the
 * page, so a malformed request is answered 400 rather than becoming a database error.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BackofficeOrganizationSummary = AllfitV1Schemas['BackofficeOrganizationSummary']
export type OrganizationLifecycleStatus = AllfitV1Schemas['OrganizationLifecycleStatus']

export const ORGANIZATION_LIFECYCLE_STATUSES: readonly OrganizationLifecycleStatus[] = [
  'unclaimed',
  'active',
  'closed',
  'cancelled',
]

export interface DirectoryReader {
  actorPersonId: string
  actorSessionId: string
}

/** Where the previous page ended, in the directory's own sort order. */
export interface OrganizationDirectoryCursor {
  name: string
  id: string
}

export interface OrganizationDirectoryQuery {
  requestId: string
  query?: string | undefined
  status?: OrganizationLifecycleStatus | undefined
  limit: number
  cursor?: OrganizationDirectoryCursor | undefined
}

export interface OrganizationDirectoryPage {
  items: BackofficeOrganizationSummary[]
  hasMore: boolean
  nextCursor?: string | undefined
}

export interface OrganizationDirectoryDatabase {
  list(input: DirectoryReader & OrganizationDirectoryQuery): Promise<OrganizationDirectoryPage>
}
