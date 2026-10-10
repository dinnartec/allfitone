import type { AccountActor } from '../../identity/index.js'
import type {
  ClientDirectoryDatabase,
  CommandContext,
  DirectoryPage,
  DirectoryQuery,
  HolderAssignmentDatabase,
  HolderReassignmentDatabase,
  RelationshipHistory,
  RelationshipHistoryDatabase,
  RelationshipState,
  RelationshipStateDatabase,
  SubstitutionProposalDatabase,
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
