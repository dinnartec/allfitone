import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type postgres from 'postgres'
import type { ClientDirectoryDatabase, RelationshipStatus } from '../domain/index.js'

type DirectoryRow = {
  relationship_id: string
  person_id: string
  display_name: string
  status: RelationshipStatus
  started_at: string
  ended_at: string | null
  sort_display_name: string
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
              ${query.cursorStatus ?? null}::text,
              ${query.cursorDisplayName ?? null}::text,
              ${query.cursorRelationshipId ?? null}::uuid
            )
          `
          const hasMore = rows.length > query.limit
          return {
            hasMore,
            items: rows.slice(0, query.limit).map((row) => ({
              relationshipId: row.relationship_id,
              personId: row.person_id,
              displayName: row.display_name,
              status: row.status,
              startedAt: new Date(row.started_at),
              endedAt: row.ended_at ? new Date(row.ended_at) : null,
              sortDisplayName: row.sort_display_name,
            })),
          }
        }),
      )
    },
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
