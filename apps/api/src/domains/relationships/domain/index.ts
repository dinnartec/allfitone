/**
 * Relationships: the accepted service link between a person and an
 * organization. It grants no data on its own — it is the first of the five
 * conditions any access to a person's data has to satisfy, never the whole of
 * them.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

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

/**
 * How full the gym is against the quota Allfit sold it. `null` seats is no
 * limit, which is not zero, and `placesLeft` is `null` with it. Nothing here
 * says who set the number.
 */
export interface GuestQuota {
  readonly seats: number | null
  readonly occupied: number
  readonly placesLeft: number | null
  readonly overQuota: boolean
}

export interface DirectoryPage {
  readonly items: readonly DirectoryEntry[]
  readonly hasMore: boolean
  readonly guestQuota: GuestQuota
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
 * One moment in a relationship's past. `detail` stays loose on purpose: each
 * kind carries different fields, and narrowing them here would mean a union the
 * screen has to re-narrow anyway. What is fixed is that `type` names the kind
 * and `occurredAt` places it.
 */
export interface RelationshipHistoryEvent {
  readonly type:
    | 'relationship_started'
    | 'holder_assigned'
    | 'holder_ended'
    | 'substitution_proposed'
    | 'substitution_accepted'
    | 'substitution_ended'
    | 'consent_decided'
    | 'relationship_ended'
  readonly occurredAt: Date
  /** The row the moment was read from — not an id of the moment itself. */
  readonly sourceId: string
  readonly detail: Readonly<Record<string, unknown>>
}

/**
 * A page of a relationship's history, newest first.
 *
 * **Shorter for a coach than for an owner, by design.** The row policy shows a
 * coach only their own assignment, so a coach never learns who attended this
 * person before them. A short list is not a failed read.
 */
export interface RelationshipHistory {
  readonly relationshipId: string
  readonly personId: string
  readonly events: readonly RelationshipHistoryEvent[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

export interface RelationshipHistoryDatabase {
  readHistory(
    actorPersonId: string,
    query: {
      /** Null on Space: the person reads her own, with no organization. */
      organizationId: string | null
      relationshipId: string
      limit: number | null
      cursor: string | null
    },
  ): Promise<RelationshipHistory>
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

/**
 * A cover somebody has been asked to accept. It is a question put to the
 * person, not a decision taken for them: until they answer, the professional
 * named here reads nothing of theirs, and the window below is only when the
 * cover *would* run.
 *
 * Dates, not timestamps. A cover runs from one day to another, and the person
 * answering reads days — turning that into an instant would invent a time
 * nobody chose.
 */
export interface SubstitutionProposal {
  readonly assignmentId: string
  readonly relationshipId: string
  readonly membershipId: string
  readonly professionalPersonId: string
  readonly startsOn: string
  readonly endsOn: string
}

export interface SubstitutionProposalResult extends CommandResult<SubstitutionProposal> {
  readonly proposed: boolean
}

export interface SubstitutionProposalDatabase {
  proposeSubstitution(
    input: CommandContext & {
      actorPersonId: string
      organizationId: string
      relationshipId: string
      membershipId: string
      startsOn: string
      endsOn: string
    },
  ): Promise<SubstitutionProposalResult>
}

/**
 * `OP-REL-006`. A cover that has been cut short, and the instant it stopped.
 *
 * `endedAt` is an instant and not a day, unlike the window above: the cover was
 * agreed in days, and this is the moment somebody ended it. Rounding that to a
 * day would say the access stopped at midnight when it stopped at four.
 */
export interface SubstitutionTermination {
  readonly assignmentId: string
  readonly relationshipId: string
  readonly membershipId: string
  readonly professionalPersonId: string
  readonly endedAt: string
}

export type SubstitutionTerminationResult = CommandResult<SubstitutionTermination>

export interface SubstitutionTerminationDatabase {
  /**
   * `organizationId` is absent on the Space surface, whose route carries no
   * organization: the person reaches a relationship of her own directly. The
   * command resolves it from the relationship either way, so this is the
   * caller's claim to be acting inside an organization, not the source of
   * truth about which one the relationship belongs to.
   */
  endSubstitution(
    input: CommandContext & {
      actorPersonId: string
      organizationId?: string
      relationshipId: string
      assignmentId: string
    },
  ): Promise<SubstitutionTerminationResult>
}

/**
 * `OP-REL-008`. A relationship the organization ended, and what stopped with it.
 *
 * `endedAt` is the single instant `T` the whole transaction used: the
 * relationship, every grant it froze and every assignment it closed carry this
 * same moment. A historical-access case is measured against it, so three
 * answers to «when did this stop» would be three different boundaries.
 *
 * The counts are what the screen reports back. `frozenGrants` is the one that
 * matters to a reader: freezing is not revoking, and saying how many permissions
 * stopped is saying what the organization keeps as history and no longer
 * receives.
 */
export interface RelationshipTermination {
  readonly relationshipId: string
  readonly personId: string
  readonly endedAt: Date
  readonly frozenGrants: number
  readonly closedAssignments: number
}

export type RelationshipTerminationResult = CommandResult<RelationshipTermination>

export interface RelationshipTerminationDatabase {
  terminate(
    input: CommandContext & {
      actorPersonId: string
      organizationId: string
      relationshipId: string
      /** Optional by the catalogue: a gym need not justify itself to the system. */
      reason?: string
    },
  ): Promise<RelationshipTerminationResult>
}

/**
 * `OP-REL-013`. The covers of one relationship, running and finished, newest
 * first.
 *
 * Newest first is the point rather than a preference: the relationship card
 * embeds its covers oldest-first, so the one that is running sinks under every
 * one that is over — unnoticeable with two and a wall after a few years.
 *
 * A finished cover appearing here grants nothing. That is not enforced by this
 * query: `relationships.actor_is_assigned` already refuses an assignment whose
 * validity has passed, so reading a fact about the past is reading, not
 * reopening.
 */
export interface ListedSubstitution extends RelationshipSubstitution {
  /**
   * Present here and not on the card's own shape: a cover that is over has an
   * instant it stopped, and a list that spans years is where that matters.
   */
  readonly validTo: Date | null
}

export interface SubstitutionPage {
  readonly items: readonly ListedSubstitution[]
  readonly hasMore: boolean
}

export interface SubstitutionQuery {
  /** Absent on the Space surface, whose route carries no organization. */
  readonly organizationId?: string
  readonly relationshipId: string
  readonly limit: number
  readonly cursorValidFrom?: string
  readonly cursorAssignmentId?: string
}

export interface SubstitutionListDatabase {
  listSubstitutions(personId: string, query: SubstitutionQuery): Promise<SubstitutionPage>
}

/**
 * `OP-REL-012`. A page of the caller's own relationships, shaped as the contract sends
 * it: this answer is handed straight to the client, so the row and the DTO are the same
 * thing and a mapping layer between them would only be a place to drop a field.
 */
export type MyRelationship = AllfitV1Schemas['SpaceRelationship']

/** Her answer to a cover (`OP-REL-005`). */
export interface SubstitutionDecision {
  readonly assignmentId: string
  readonly status: 'active' | 'rejected'
  readonly acceptedByPersonAt: string | null
}

/** Her relationship after she ended it (`OP-REL-007`). */
export interface MyRelationshipEnd {
  readonly relationshipId: string
  readonly endedAt: string
  readonly frozenGrants: number
  readonly closedAssignments: number
}

/** What the person does to her own relationships from Space. */
export interface MyRelationshipCommandDatabase {
  decideSubstitution(
    input: CommandContext & {
      personId: string
      relationshipId: string
      assignmentId: string
      decision: 'accepted' | 'rejected'
    },
  ): Promise<CommandResult<SubstitutionDecision>>
  endRelationship(
    input: CommandContext & { personId: string; relationshipId: string; reason: string | null },
  ): Promise<CommandResult<MyRelationshipEnd>>
}

export interface MyRelationshipPage {
  items: MyRelationship[]
  hasMore: boolean
}

export interface MyRelationshipQuery {
  limit: number
  requestId: string
  cursorStartedAt?: string
  cursorRelationshipId?: string
}

export interface MyRelationshipDatabase {
  listMine(personId: string, query: MyRelationshipQuery): Promise<MyRelationshipPage>
}
