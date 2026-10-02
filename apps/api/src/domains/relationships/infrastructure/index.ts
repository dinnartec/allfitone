import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type postgres from 'postgres'
import type {
  ClientDirectoryDatabase,
  HolderAssignmentDatabase,
  DirectoryEntry,
  DirectoryGroup,
  InvitationStatus,
  RelationshipStatus,
  RelationshipGrant,
  RelationshipProfessional,
  RelationshipState,
  RelationshipStateDatabase,
  RelationshipSubstitution,
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
