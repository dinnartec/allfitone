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

/**
 * How one relationship stands. Three things a member of the organization needs
 * before deciding anything: where the link is, who attends the person, and what
 * the person agreed to share. Never what they shared.
 */
export interface RelationshipState {
  readonly relationshipId: string
  readonly personId: string
  readonly displayName: string
  readonly status: 'active' | 'terminated'
  readonly startedAt: Date
  readonly endedAt: Date | null
  /** Null when nobody attends this person yet. */
  readonly holder: RelationshipProfessional | null
  readonly substitutions: readonly RelationshipSubstitution[]
  readonly grants: readonly RelationshipGrant[]
}

export interface RelationshipProfessional {
  readonly assignmentId: string
  readonly membershipId: string
  /**
   * The professional, never the client. On the assignment row in PostgreSQL
   * `person_id` is the client being attended, so the two names have to differ
   * here or one reads as the other.
   */
  readonly professionalPersonId: string
  readonly displayName: string
  readonly validFrom: Date
}

export interface RelationshipSubstitution extends RelationshipProfessional {
  readonly status: 'proposed' | 'active' | 'ended'
  readonly endsOn: string | null
  readonly acceptedByPersonAt: Date | null
}

/**
 * Metadata about a permission, and nothing the permission covers. `version` is
 * the scope version that was agreed, not the latest published: a grant never
 * drifts onto a later one.
 */
export interface RelationshipGrant {
  readonly grantId: string
  readonly scopeCode: string
  readonly displayName: string | null
  readonly versionNumber: number
  readonly accessLevel: 'read' | 'contribute'
  readonly status: 'active' | 'frozen' | 'revoked'
  readonly purpose: string
  readonly grantedAt: Date
  readonly revokedAt: Date | null
}

export interface RelationshipStateDatabase {
  readState(
    actorPersonId: string,
    query: { organizationId: string; relationshipId: string },
  ): Promise<RelationshipState>
}

/**
 * The outcome of changing who attends a client. `reassigned` is false when the
 * named coach was already in charge: nothing was written and, more to the
 * point, **nobody was notified** — a notice saying somebody's coach changed to
 * the same coach teaches people to ignore the real one.
 */
export interface RelationshipReassignment {
  readonly assignmentId: string
  readonly relationshipId: string
  readonly membershipId: string
  readonly professionalPersonId: string
  readonly validFrom: Date
  /** The assignment this one ended, or null when nothing changed. */
  readonly replacedAssignmentId: string | null
}

export interface HolderReassignmentResult extends CommandResult<RelationshipReassignment> {
  readonly reassigned: boolean
}

export interface HolderReassignmentDatabase {
  reassignHolder(
    input: CommandContext & {
      actorPersonId: string
      organizationId: string
      relationshipId: string
      membershipId: string
    },
  ): Promise<HolderReassignmentResult>
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
