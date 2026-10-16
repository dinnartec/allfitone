import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type postgres from 'postgres'
import type {
  ClientDirectoryDatabase,
  HolderAssignmentDatabase,
  HolderReassignmentDatabase,
  DirectoryEntry,
  DirectoryGroup,
  InvitationStatus,
  RelationshipStatus,
  RelationshipGrant,
  RelationshipHistory,
  RelationshipHistoryDatabase,
  RelationshipHistoryEvent,
  RelationshipProfessional,
  RelationshipState,
  RelationshipStateDatabase,
  RelationshipSubstitution,
  SubstitutionProposalDatabase,
  SubstitutionTerminationDatabase,
  MyRelationship,
  MyRelationshipDatabase,
} from '../domain/index.js'

type DirectoryRow = {
  entry_kind: 'relationship' | 'invitation'
  relationship_id: string | null
  invitation_id: string | null
  person_id: string | null
  display_name: string | null
  contact_hint: string | null
  relationship_status: RelationshipStatus | null
  invitation_status: InvitationStatus
  started_at: string
  ended_at: string | null
  sort_group: DirectoryGroup
  sort_name: string
  sort_id: string
}

export function createClientDirectoryDatabase(
  sql: postgres.Sql = database(),
): ClientDirectoryDatabase {
  return {
    async listClients(personId, query) {
      return measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId)
          // One row over the page, so "is there more" is answered by the read
          // itself rather than by a second count that could disagree with it.
          const rows = await transaction<DirectoryRow[]>`
            select * from relationships.list_organization_clients(
              ${personId}::uuid,
              ${query.organizationId}::uuid,
              ${query.status ?? null}::text,
              ${query.limit + 1}::integer,
              ${query.cursorGroup ?? null}::text,
              ${query.cursorName ?? null}::text,
              ${query.cursorId ?? null}::uuid
            )
          `
          const hasMore = rows.length > query.limit
          return {
            hasMore,
            items: rows.slice(0, query.limit).map(toEntry),
          }
        }),
      )
    },
  }
}

/**
 * The two kinds stay separate all the way out. Collapsing them into one shape
 * with everything optional would let a caller read a name off an invitation
 * that has none, and the type would not stop them.
 */
function toEntry(row: DirectoryRow): DirectoryEntry {
  if (row.entry_kind === 'invitation') {
    return {
      kind: 'invitation',
      invitationId: row.invitation_id ?? '',
      contactHint: row.contact_hint ?? '',
      invitationStatus: row.invitation_status,
      invitedAt: new Date(row.started_at),
      sortGroup: row.sort_group,
      sortName: row.sort_name,
      sortId: row.sort_id,
    }
  }
  return {
    kind: 'relationship',
    relationshipId: row.relationship_id ?? '',
    personId: row.person_id ?? '',
    displayName: row.display_name ?? '',
    relationshipStatus: row.relationship_status ?? 'active',
    invitationStatus: row.invitation_status,
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    sortGroup: row.sort_group,
    sortName: row.sort_name,
    sortId: row.sort_id,
  }
}

async function setPersonActor(
  transaction: postgres.TransactionSql,
  personId: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'person', true),
           set_config('app.actor_person_id', ${personId}, true)
  `
}

/**
 * PostgreSQL access for reading how one relationship stands.
 *
 * The function returns one jsonb document rather than three result sets, because
 * the holder, the substitutions and the grants have to describe the same instant
 * — three round trips could each see a different one.
 */
export function createRelationshipStateDatabase(
  sql: postgres.Sql = database(),
): RelationshipStateDatabase {
  return {
    readState: (personId, query) =>
      measureStudioRequestPhase('business-db', async () => {
        const [row] = await sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId)
          return transaction<{ state: StateDocument }[]>`
            select relationships.read_relationship_state(
              ${personId}::uuid,
              ${query.organizationId}::uuid,
              ${query.relationshipId}::uuid
            ) as state
          `
        })

        if (!row) throw new Error('read_relationship_state returned no row')
        return presentState(row.state)
      }),
  }
}

/*
 * The document is parsed field by field rather than cast. A shape that drifts
 * should fail here, where the contract is, instead of reaching a screen as
 * `undefined`.
 */
function presentState(document: StateDocument): RelationshipState {
  return {
    relationshipId: document.relationship_id,
    personId: document.person_id,
    displayName: document.display_name,
    status: document.status,
    startedAt: new Date(document.started_at),
    endedAt: document.ended_at ? new Date(document.ended_at) : null,
    holder: document.holder ? presentProfessional(document.holder) : null,
    substitutions: document.substitutions.map((entry) => ({
      ...presentProfessional(entry),
      status: entry.status,
      endsOn: entry.ends_on,
      acceptedByPersonAt: entry.accepted_by_person_at
        ? new Date(entry.accepted_by_person_at)
        : null,
    })),
    grants: document.grants.map(presentGrant),
  }
}

/**
 * PostgreSQL access for reading what a relationship has been through.
 *
 * The limit goes down as the caller asked for it and the function clamps it.
 * Clamping twice would mean two opinions about the maximum, and the one that
 * matters is the one next to the query.
 */
export function createRelationshipHistoryDatabase(
  sql: postgres.Sql = database(),
): RelationshipHistoryDatabase {
  return {
    readHistory: (personId, query) =>
      measureStudioRequestPhase('business-db', async () => {
        const [row] = await sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId)
          return transaction<{ history: HistoryDocument }[]>`
            select relationships.read_relationship_history(
              ${personId}::uuid,
              ${query.organizationId}::uuid,
              ${query.relationshipId}::uuid,
              ${query.limit}::integer,
              ${query.cursor}::text
            ) as history
          `
        })

        if (!row) throw new Error('read_relationship_history returned no row')
        return presentHistory(row.history)
      }),
  }
}

function presentHistory(document: HistoryDocument): RelationshipHistory {
  return {
    relationshipId: document.relationship_id,
    personId: document.person_id,
    events: document.data.map(presentHistoryEvent),
    nextCursor: document.page.next_cursor,
    hasMore: document.page.has_more,
  }
}

function presentHistoryEvent(row: HistoryEventRow): RelationshipHistoryEvent {
  return {
    type: row.type,
    occurredAt: new Date(row.occurred_at),
    sourceId: row.source_id,
    // Passed through as it came. Every key in it is metadata about the moment,
    // never content a permission covers, and the function is where that is
    // enforced — re-listing the keys here would be a second place to forget.
    detail: row.detail,
  }
}

function presentProfessional(row: ProfessionalRow): RelationshipProfessional {
  return {
    assignmentId: row.assignment_id,
    membershipId: row.membership_id,
    professionalPersonId: row.professional_person_id,
    displayName: row.display_name,
    validFrom: new Date(row.valid_from),
  }
}

function presentGrant(row: GrantRow): RelationshipGrant {
  return {
    grantId: row.grant_id,
    scopeCode: row.scope_code,
    displayName: row.display_name,
    versionNumber: row.version_number,
    accessLevel: row.access_level,
    status: row.status,
    purpose: row.purpose,
    grantedAt: new Date(row.granted_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  }
}

type ProfessionalRow = {
  assignment_id: string
  membership_id: string
  professional_person_id: string
  display_name: string
  valid_from: string
}

type SubstitutionRow = ProfessionalRow & {
  status: RelationshipSubstitution['status']
  ends_on: string | null
  accepted_by_person_at: string | null
}

type GrantRow = {
  grant_id: string
  scope_code: string
  display_name: string | null
  version_number: number
  access_level: RelationshipGrant['accessLevel']
  status: RelationshipGrant['status']
  purpose: string
  granted_at: string
  revoked_at: string | null
}

type StateDocument = {
  relationship_id: string
  person_id: string
  display_name: string
  status: RelationshipStatus
  started_at: string
  ended_at: string | null
  holder: ProfessionalRow | null
  substitutions: SubstitutionRow[]
  grants: GrantRow[]
}

type HistoryEventRow = {
  type: RelationshipHistoryEvent['type']
  occurred_at: string
  source_id: string
  detail: Record<string, unknown>
}

type HistoryDocument = {
  relationship_id: string
  person_id: string
  data: HistoryEventRow[]
  page: { next_cursor: string | null; has_more: boolean }
}

/**
 * PostgreSQL access for changing who attends a client.
 *
 * The organization context is set by the function itself, for the same reason
 * as assigning: it checks the capability against that organization before
 * anything is written, and a caller that set it from outside would be declaring
 * the answer to the question being asked.
 */
export function createHolderReassignmentDatabase(
  sql: postgres.Sql = database(),
): HolderReassignmentDatabase {
  return {
    reassignHolder: (input) =>
      measureStudioRequestPhase('business-db', async () => {
        const row = await sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.actorPersonId)
          const [moved] = await transaction<ReassignmentRow[]>`
            select * from relationships.reassign_relationship_holder(
              ${input.actorPersonId}::uuid,
              ${input.organizationId}::uuid,
              ${input.relationshipId}::uuid,
              ${input.membershipId}::uuid,
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          return moved
        })

        if (!row) throw new Error('reassign_relationship_holder returned no row')
        return {
          resource: {
            assignmentId: row.assignment_id,
            relationshipId: row.relationship_id,
            membershipId: row.membership_id,
            professionalPersonId: row.professional_person_id,
            validFrom: new Date(row.valid_from),
            replacedAssignmentId: row.replaced_assignment_id,
          },
          reassigned: row.reassigned,
          replayed: row.replayed,
        }
      }),
  }
}

type ReassignmentRow = {
  assignment_id: string
  relationship_id: string
  membership_id: string
  professional_person_id: string
  valid_from: string
  replaced_assignment_id: string | null
  reassigned: boolean
  replayed: boolean
}

/**
 * PostgreSQL access for putting a coach in charge.
 *
 * The organization context is set by the function itself, not here: it checks
 * the capability against it before anything is written, and a caller that set
 * it from outside would be declaring the answer to the question being asked.
 */
export function createHolderAssignmentDatabase(
  sql: postgres.Sql = database(),
): HolderAssignmentDatabase {
  return {
    assignHolder: (input) =>
      measureStudioRequestPhase('business-db', async () => {
        const row = await sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.actorPersonId)
          const [assigned] = await transaction<HolderRow[]>`
            select * from relationships.assign_relationship_holder(
              ${input.actorPersonId}::uuid,
              ${input.organizationId}::uuid,
              ${input.relationshipId}::uuid,
              ${input.membershipId}::uuid,
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          return assigned
        })

        if (!row) throw new Error('assign_relationship_holder returned no row')
        return {
          resource: {
            assignmentId: row.assignment_id,
            relationshipId: row.relationship_id,
            membershipId: row.membership_id,
            personId: row.person_id,
            validFrom: new Date(row.valid_from),
          },
          created: row.created,
          replayed: row.replayed,
        }
      }),
  }
}

type HolderRow = {
  assignment_id: string
  relationship_id: string
  membership_id: string
  person_id: string
  valid_from: string
  created: boolean
  replayed: boolean
}

/**
 * PostgreSQL access for asking somebody to accept a cover.
 *
 * The organization context is set by the function itself, for the same reason
 * as assigning and reassigning.
 *
 * The dates stay strings on the way in and on the way out. `date` has no time
 * and no zone, and routing it through a `Date` would attach both — a cover
 * starting on the 12th becoming the 11th at 22:00 for a caller an hour west is
 * the whole of that bug.
 */
export function createSubstitutionProposalDatabase(
  sql: postgres.Sql = database(),
): SubstitutionProposalDatabase {
  return {
    proposeSubstitution: (input) =>
      measureStudioRequestPhase('business-db', async () => {
        const row = await sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.actorPersonId)
          const [proposal] = await transaction<SubstitutionProposalRow[]>`
            select
              assignment_id,
              relationship_id,
              membership_id,
              professional_person_id,
              starts_on::text as starts_on,
              ends_on::text as ends_on,
              proposed,
              replayed
            from relationships.propose_substitution(
              ${input.actorPersonId}::uuid,
              ${input.organizationId}::uuid,
              ${input.relationshipId}::uuid,
              ${input.membershipId}::uuid,
              ${input.startsOn}::date,
              ${input.endsOn}::date,
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          return proposal
        })

        if (!row) throw new Error('propose_substitution returned no row')
        return {
          resource: {
            assignmentId: row.assignment_id,
            relationshipId: row.relationship_id,
            membershipId: row.membership_id,
            professionalPersonId: row.professional_person_id,
            startsOn: row.starts_on,
            endsOn: row.ends_on,
          },
          proposed: row.proposed,
          replayed: row.replayed,
        }
      }),
  }
}

type SubstitutionProposalRow = {
  assignment_id: string
  relationship_id: string
  membership_id: string
  professional_person_id: string
  starts_on: string
  ends_on: string
  proposed: boolean
  replayed: boolean
}

/**
 * `OP-REL-006`. The organization is `null` on the Space surface, and the command
 * reads that as «the caller is not claiming to act inside one» rather than as a
 * missing argument: it resolves the organization from the relationship either
 * way, and only a Studio caller has one to be checked against.
 *
 * `ended_at` is cast to text for the same reason the proposal's dates are. The
 * driver would hand back a `Date`, and a `Date` serialised by the route is the
 * server's timezone leaking into a contract that says instant.
 */
export function createSubstitutionTerminationDatabase(
  sql: postgres.Sql = database(),
): SubstitutionTerminationDatabase {
  return {
    endSubstitution: (input) =>
      measureStudioRequestPhase('business-db', async () => {
        const row = await sql.begin(async (transaction) => {
          await setPersonActor(transaction, input.actorPersonId)
          const [termination] = await transaction<SubstitutionTerminationRow[]>`
            select
              assignment_id,
              relationship_id,
              membership_id,
              professional_person_id,
              ended_at::text as ended_at,
              replayed
            from relationships.end_substitution(
              ${input.actorPersonId}::uuid,
              ${input.organizationId ?? null}::uuid,
              ${input.relationshipId}::uuid,
              ${input.assignmentId}::uuid,
              ${input.idempotencyKey}::uuid,
              ${input.commandId}::uuid,
              ${input.requestHash}
            )
          `
          return termination
        })

        if (!row) throw new Error('end_substitution returned no row')
        return {
          resource: {
            assignmentId: row.assignment_id,
            relationshipId: row.relationship_id,
            membershipId: row.membership_id,
            professionalPersonId: row.professional_person_id,
            endedAt: row.ended_at,
          },
          replayed: row.replayed,
        }
      }),
  }
}

type SubstitutionTerminationRow = {
  assignment_id: string
  relationship_id: string
  membership_id: string
  professional_person_id: string
  ended_at: string
  replayed: boolean
}

/**
 * `OP-REL-012`. The function answers with the contract's own field names, so the rows go
 * out as they came in apart from the timestamps, which PostgreSQL hands over as `Date`.
 *
 * Reads `limit + 1` and trims, so `has_more` is a fact rather than a guess.
 */
export function createMyRelationshipDatabase(
  sql: postgres.Sql = database(),
): MyRelationshipDatabase {
  return {
    listMine: (personId, query) =>
      measureStudioRequestPhase('business-db', async () => {
        const outcome = await sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId)
          const rows = await transaction<MyRelationshipRow[]>`
            select * from relationships.list_my_relationships(
              ${personId}::uuid,
              ${query.limit + 1}::integer,
              ${query.cursorStartedAt ?? null}::timestamptz,
              ${query.cursorRelationshipId ?? null}::uuid
            )
          `
          const hasMore = rows.length > query.limit
          return {
            value: {
              items: rows.slice(0, query.limit).map(presentMyRelationship),
              hasMore,
            },
          }
        })
        return outcome.value
      }),
  }
}

type MyRelationshipRow = {
  relationship_id: string
  organization_id: string
  organization_name: string
  organization_type_code: string
  status: MyRelationship['status']
  started_at: string
  ended_at: string | null
  previous_relationship_id: string | null
}

function presentMyRelationship(row: MyRelationshipRow): MyRelationship {
  return {
    relationship_id: row.relationship_id,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    organization_type_code: row.organization_type_code,
    status: row.status,
    started_at: new Date(row.started_at).toISOString(),
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    previous_relationship_id: row.previous_relationship_id,
  }
}
