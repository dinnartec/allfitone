import type { AccountActor } from '../../identity/index.js'
import type {
  ClientDirectoryDatabase,
  CommandContext,
  DirectoryPage,
  DirectoryQuery,
  HolderAssignmentDatabase,
  HolderReassignmentDatabase,
  RelationshipHistory,
  MyRelationshipCommandDatabase,
  RelationshipHistoryDatabase,
  RelationshipState,
  RelationshipStateDatabase,
  SubstitutionProposalDatabase,
  SubstitutionListDatabase,
  RelationshipTerminationDatabase,
  SubstitutionPage,
  SubstitutionQuery,
  SubstitutionTerminationDatabase,
  MyRelationshipDatabase,
  MyRelationshipPage,
  MyRelationshipQuery,
} from '../domain/index.js'

/**
 * An account that authenticated but never completed activation has no person
 * behind it, so there is no subject for the directory's policy to resolve.
 * Refusing here keeps that distinct from "you may not read this directory".
 */
export class RelationshipsError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'RelationshipsError'
  }
}

export interface ClientDirectoryService {
  listClients(actor: AccountActor, query: DirectoryQuery): Promise<DirectoryPage>
}

/**
 * Thin on purpose. The narrowing a coach gets is a row policy in PostgreSQL,
 * not a branch here: a second copy of "who may see this client" would drift
 * from the first the day either changes.
 */
export function createClientDirectoryService(
  database: ClientDirectoryDatabase,
): ClientDirectoryService {
  const personId = (actor: AccountActor) => {
    if (!actor.personId) throw new RelationshipsError('registration-incomplete')
    return actor.personId
  }

  return {
    listClients: (actor, query) => database.listClients(personId(actor), query),
  }
}

export interface RelationshipStateService {
  read(
    actor: AccountActor,
    query: { organizationId: string; relationshipId: string },
  ): Promise<RelationshipState>
}

/*
 * Thin for the same reason as the directory. Whether a coach may read this
 * relationship is the row policy's answer, and the function raises not-found
 * when it says no — the one place that decision lives.
 */
export function createRelationshipStateService(
  database: RelationshipStateDatabase,
): RelationshipStateService {
  return {
    read(actor, query) {
      if (!actor.personId) throw new RelationshipsError('registration-incomplete')
      return database.readState(actor.personId, query)
    },
  }
}

export interface RelationshipHistoryService {
  read(
    actor: AccountActor,
    query: {
      organizationId: string
      relationshipId: string
      limit: number | null
      cursor: string | null
    },
  ): Promise<RelationshipHistory>
}

/*
 * Thin for the same reason as the state read. Who may see this relationship, how
 * far back, and whether a termination reason is theirs to read are all decided by
 * the function and the row policies. A check here would be a second opinion with
 * no access to the rows it is judging.
 */
export function createRelationshipHistoryService(
  database: RelationshipHistoryDatabase,
): RelationshipHistoryService {
  return {
    read(actor, query) {
      if (!actor.personId) throw new RelationshipsError('registration-incomplete')
      return database.readHistory(actor.personId, query)
    },
  }
}

export interface HolderReassignmentService {
  reassign(
    actor: AccountActor,
    input: CommandContext & {
      organizationId: string
      relationshipId: string
      membershipId: string
    },
  ): ReturnType<HolderReassignmentDatabase['reassignHolder']>
}

/*
 * Thin for the same reason as assigning. Whether there is a holder to change,
 * whether the new one is eligible, and whether the notice can be enqueued are
 * all resolved inside the command's own transaction — and the last of those is
 * the whole point of this operation existing separately.
 */
export function createHolderReassignmentService(
  database: HolderReassignmentDatabase,
): HolderReassignmentService {
  return {
    reassign(actor, input) {
      if (!actor.personId) throw new RelationshipsError('registration-incomplete')
      return database.reassignHolder({ actorPersonId: actor.personId, ...input })
    },
  }
}

export interface HolderAssignmentService {
  assign(
    actor: AccountActor,
    input: CommandContext & {
      organizationId: string
      relationshipId: string
      membershipId: string
    },
  ): ReturnType<HolderAssignmentDatabase['assignHolder']>
}

/*
 * No authorization branch here. Who may assign, who may be assigned, and
 * whether the relationship is still live are all resolved inside the command's
 * own transaction, and a second answer in this layer could disagree with the
 * one that decides.
 */
export function createHolderAssignmentService(
  database: HolderAssignmentDatabase,
): HolderAssignmentService {
  return {
    assign(actor, input) {
      if (!actor.personId) throw new RelationshipsError('registration-incomplete')
      return database.assignHolder({ actorPersonId: actor.personId, ...input })
    },
  }
}

export interface SubstitutionProposalService {
  propose(
    actor: AccountActor,
    input: CommandContext & {
      organizationId: string
      relationshipId: string
      membershipId: string
      startsOn: string
      endsOn: string
    },
  ): ReturnType<SubstitutionProposalDatabase['proposeSubstitution']>
}

/*
 * Thin, like its three siblings. The dates are checked by the route's schema
 * before they arrive and again by the command, which is the one that also knows
 * whether the relationship is live, who the holder is and whether the person
 * can be asked at all — none of which this layer can see.
 */
export function createSubstitutionProposalService(
  database: SubstitutionProposalDatabase,
): SubstitutionProposalService {
  return {
    propose(actor, input) {
      if (!actor.personId) throw new RelationshipsError('registration-incomplete')
      return database.proposeSubstitution({ actorPersonId: actor.personId, ...input })
    },
  }
}

/**
 * `OP-REL-006`, which is one operation reached from two surfaces, so it is one
 * service with two doors.
 *
 * They differ only in how the person is found — Studio from the session, Space
 * from the token — and in whether an organization is being claimed. Folding
 * them into a single method would mean an optional organization and an actor
 * that is sometimes an id, which hides the one thing a reader needs to know:
 * which surface is calling. The command decides authority either way.
 */
export interface SubstitutionTerminationService {
  /** Studio: somebody who may assign professionals inside the organization. */
  end(
    actor: AccountActor,
    input: CommandContext & {
      organizationId: string
      relationshipId: string
      assignmentId: string
    },
  ): ReturnType<SubstitutionTerminationDatabase['endSubstitution']>

  /** Space: the person the relationship belongs to, with no organization in the route. */
  endMine(
    personId: string,
    input: CommandContext & { relationshipId: string; assignmentId: string },
  ): ReturnType<SubstitutionTerminationDatabase['endSubstitution']>
}

export function createSubstitutionTerminationService(
  database: SubstitutionTerminationDatabase,
): SubstitutionTerminationService {
  return {
    end(actor, input) {
      if (!actor.personId) throw new RelationshipsError('registration-incomplete')
      return database.endSubstitution({ actorPersonId: actor.personId, ...input })
    },
    endMine(personId, input) {
      return database.endSubstitution({ actorPersonId: personId, ...input })
    },
  }
}

/**
 * `OP-REL-008`. Thin, like its siblings: whether the relationship is live, who
 * the caller is and what freezing a grant means are all decisions the command
 * makes, and none of them is visible from here.
 */
export interface RelationshipTerminationService {
  terminate(
    actor: AccountActor,
    input: CommandContext & {
      organizationId: string
      relationshipId: string
      reason?: string
    },
  ): ReturnType<RelationshipTerminationDatabase['terminate']>
}

export function createRelationshipTerminationService(
  database: RelationshipTerminationDatabase,
): RelationshipTerminationService {
  return {
    terminate(actor, input) {
      if (!actor.personId) throw new RelationshipsError('registration-incomplete')
      return database.terminate({ actorPersonId: actor.personId, ...input })
    },
  }
}

/**
 * `OP-REL-013`. Takes a person id for the same reason `listMine` does: both
 * surfaces resolve the person before anything else, Studio from the session and
 * Space from the token, and an actor without one has no relationship to read.
 */
export interface SubstitutionListService {
  /** Studio: a coach, administrator or owner of the organization. */
  list(
    actor: AccountActor,
    query: SubstitutionQuery & { organizationId: string },
  ): Promise<SubstitutionPage>

  /** Space: the person the relationship belongs to, with no organization. */
  listMine(
    personId: string,
    query: Omit<SubstitutionQuery, 'organizationId'>,
  ): Promise<SubstitutionPage>
}

export function createSubstitutionListService(
  database: SubstitutionListDatabase,
): SubstitutionListService {
  return {
    list(actor, query) {
      if (!actor.personId) throw new RelationshipsError('registration-incomplete')
      return database.listSubstitutions(actor.personId, query)
    },
    listMine: (personId, query) => database.listSubstitutions(personId, query),
  }
}

/**
 * `OP-REL-012`. Takes a person id rather than an actor: Space resolves the person from the
 * token before anything else, and there is no incomplete-registration case to report —
 * somebody without a person has no relationships to list.
 */
/**
 * The person's own relationships from Space: the history (`OP-REL-014`), a cover
 * (`OP-REL-005`) and the end (`OP-REL-007`). The person comes from the token; whose
 * relationship it is, and whether it can still be answered or ended, is the command's
 * decision.
 */
export interface MyRelationshipCommandService {
  readHistory(
    personId: string,
    query: { relationshipId: string; limit: number | null; cursor: string | null },
  ): Promise<RelationshipHistory>
  decideSubstitution: MyRelationshipCommandDatabase['decideSubstitution']
  endRelationship: MyRelationshipCommandDatabase['endRelationship']
}

export function createMyRelationshipCommandService(
  histories: RelationshipHistoryDatabase,
  commands: MyRelationshipCommandDatabase,
): MyRelationshipCommandService {
  return {
    readHistory: (personId, query) =>
      histories.readHistory(personId, { organizationId: null, ...query }),
    decideSubstitution: (input) => commands.decideSubstitution(input),
    endRelationship: (input) => commands.endRelationship(input),
  }
}

export interface MyRelationshipService {
  listMine(personId: string, query: MyRelationshipQuery): Promise<MyRelationshipPage>
}

export function createMyRelationshipService(
  database: MyRelationshipDatabase,
): MyRelationshipService {
  return {
    listMine: (personId, query) => database.listMine(personId, query),
  }
}
