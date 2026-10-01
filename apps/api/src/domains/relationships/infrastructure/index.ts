import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type postgres from 'postgres'
import type {
  ClientDirectoryDatabase,
  DirectoryEntry,
  DirectoryGroup,
  InvitationStatus,
  RelationshipStatus,
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
