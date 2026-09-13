/**
 * PostgreSQL access for the organization directory.
 *
 * The page is read one row beyond its size, so whether another page exists is
 * known without a second query. The cursor is the last visible row's position in
 * the directory's own sort order, encoded so the client treats it as opaque.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  OrganizationDirectoryDatabase,
  OrganizationLifecycleStatus,
} from '../domain/directory.js'

type DirectoryRow = {
  organization_id: string
  display_name: string
  type_code: string
  type_name: string
  status: OrganizationLifecycleStatus
  created_at: Date
  claimed_at: Date | null
  cancelled_at: Date | null
  active_member_count: number
  site_count: number
  people_served: number | null
}

export function createOrganizationDirectoryDatabase(): OrganizationDirectoryDatabase {
  const sql = database()

  return {
    list: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<DirectoryRow[]>`
          select * from organizations.list_backoffice_organizations(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.query ?? null}, ${input.status ?? null},
            ${input.limit + 1}::integer,
            ${input.cursor?.name ?? null}, ${input.cursor?.id ?? null}::uuid
          )
        `
        const hasMore = rows.length > input.limit
        const visible = rows.slice(0, input.limit)
        const last = visible.at(-1)
        return {
          items: visible.map((row) => ({
            organization_id: row.organization_id,
            display_name: row.display_name,
            type_code: row.type_code,
            type_name: row.type_name,
            status: row.status,
            created_at: row.created_at.toISOString(),
            claimed_at: row.claimed_at?.toISOString() ?? null,
            cancelled_at: row.cancelled_at?.toISOString() ?? null,
            active_member_count: row.active_member_count,
            site_count: row.site_count,
            people_served: row.people_served,
          })),
          hasMore,
          ...(hasMore && last
            ? {
                nextCursor: Buffer.from(
                  JSON.stringify({ name: last.display_name, id: last.organization_id }),
                  'utf8',
                ).toString('base64url'),
              }
            : {}),
        }
      }),
  }
}

function inTransaction<T>(
  sql: ReturnType<typeof database>,
  actorPersonId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureRequestPhase('business-db', async () => {
    const result = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'support', true),
               set_config('app.actor_person_id', ${actorPersonId}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return result.value
  })
}
