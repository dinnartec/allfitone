/**
 * Relationships: the accepted service link between a person and an
 * organization. It grants no data on its own — it is the first of the five
 * conditions any access to a person's data has to satisfy, never the whole of
 * them.
 */

export type RelationshipStatus = 'active' | 'terminated'

/**
 * A client as the directory presents them: who they are and where the link
 * stands. No fitness data appears here, not even aggregated, which is why
 * reading the directory writes no access event.
 */
export interface DirectoryClient {
  readonly relationshipId: string
  readonly personId: string
  readonly displayName: string
  readonly status: RelationshipStatus
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly sortDisplayName: string
}

export interface DirectoryPage {
  readonly items: readonly DirectoryClient[]
  readonly hasMore: boolean
}

export interface DirectoryQuery {
  readonly organizationId: string
  readonly status?: RelationshipStatus
  readonly limit: number
  readonly cursorStatus?: string
  readonly cursorDisplayName?: string
  readonly cursorRelationshipId?: string
}

export interface ClientDirectoryDatabase {
  listClients(personId: string, query: DirectoryQuery): Promise<DirectoryPage>
}
