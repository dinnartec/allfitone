/**
 * Relationships: the accepted service link between a person and an
 * organization. It grants no data on its own — it is the first of the five
 * conditions any access to a person's data has to satisfy, never the whole of
 * them.
 */

export type RelationshipStatus = 'active' | 'terminated'
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired'

/** What a directory row may be filtered down to. */
export type DirectoryGroup = RelationshipStatus | 'invited'

/**
 * A directory entry: either a person the organization has a relationship with,
 * or somebody invited who has not answered. No fitness data appears in either,
 * not even aggregated, which is why reading the directory writes no access
 * event.
 *
 * The two kinds are deliberately not merged into one optional-everything shape:
 * an unanswered invitation has no person and no name, because until somebody
 * accepts, neither exists.
 */
export type DirectoryEntry = DirectoryRelationshipEntry | DirectoryInvitationEntry

export interface DirectoryRelationshipEntry {
  readonly kind: 'relationship'
  readonly relationshipId: string
  readonly personId: string
  readonly displayName: string
  readonly relationshipStatus: RelationshipStatus
  readonly invitationStatus: InvitationStatus
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly sortGroup: DirectoryGroup
  readonly sortName: string
  readonly sortId: string
}

export interface DirectoryInvitationEntry {
  readonly kind: 'invitation'
  readonly invitationId: string
  /** The address the invitation went to, masked. Never the full contact. */
  readonly contactHint: string
  readonly invitationStatus: InvitationStatus
  readonly invitedAt: Date
  readonly sortGroup: DirectoryGroup
  readonly sortName: string
  readonly sortId: string
}

export interface DirectoryPage {
  readonly items: readonly DirectoryEntry[]
  readonly hasMore: boolean
}

export interface DirectoryQuery {
  readonly organizationId: string
  readonly status?: DirectoryGroup
  readonly limit: number
  readonly cursorGroup?: string
  readonly cursorName?: string
  readonly cursorId?: string
}

export interface ClientDirectoryDatabase {
  listClients(personId: string, query: DirectoryQuery): Promise<DirectoryPage>
}

/*
 * Declared here rather than imported: every domain carries its own command
 * shape, and reaching into another one for it would couple two schemas over a
 * pair of fields.
 */
export interface CommandContext {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

export interface CommandResult<T> {
  resource: T
  replayed: boolean
}

/**
 * Who attends a client. Saying so grants nothing: without a live grant from
 * the person, the professional in charge reads nothing of theirs. Assignment
 * and permission are two of the five conditions a read has to satisfy, and
 * this one is only the first.
 */
export interface RelationshipHolder {
  readonly assignmentId: string
  readonly relationshipId: string
  readonly membershipId: string
  readonly personId: string
  readonly validFrom: Date
}

/**
 * `created` is false when this coach was already in charge. Asking for what is
 * already true is not an error and writes nothing — the date they have
 * attended this person since is a fact, not a counter to be reset.
 */
export interface HolderAssignmentResult extends CommandResult<RelationshipHolder> {
  readonly created: boolean
}

export interface HolderAssignmentDatabase {
  assignHolder(
    input: CommandContext & {
      actorPersonId: string
      organizationId: string
      relationshipId: string
      membershipId: string
    },
  ): Promise<HolderAssignmentResult>
}
