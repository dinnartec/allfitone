/**
 * PostgreSQL access for global catalogue curation.
 *
 * Curation runs as the support actor, like result contract publication: the product read
 * policies answer only what is published, and a curator needs to see what is archived.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  BackofficeGlobalCatalogue,
  CatalogueEntryResult,
  GlobalCatalogueCurationDatabase,
  GlobalCatalogueEntry,
} from '../domain/global-catalogue.js'

type ReadRow = { list_global_catalog: BackofficeGlobalCatalogue }
type CommandRow = { result: GlobalCatalogueEntry; replayed: boolean }

export function createGlobalCatalogueCurationDatabase(): GlobalCatalogueCurationDatabase {
  const sql = database()

  return {
    read: (input) =>
      asCurator(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<ReadRow[]>`
          select catalog.list_global_catalog(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the global catalogue')
        return row.list_global_catalog
      }),

    publishDiscipline: (input) =>
      asCurator(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from catalog.publish_discipline(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.publication.code}, ${input.publication.name},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return entry(rows, 'publish the discipline')
      }),

    archiveDiscipline: (input) =>
      asCurator(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from catalog.archive_discipline(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid, ${input.code},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return entry(rows, 'archive the discipline')
      }),

    publishActivityType: (input) =>
      asCurator(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from catalog.publish_activity_type(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.publication.discipline_code}, ${input.publication.code},
            ${input.publication.name},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return entry(rows, 'publish the activity type')
      }),

    archiveActivityType: (input) =>
      asCurator(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from catalog.archive_activity_type(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid, ${input.code},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return entry(rows, 'archive the activity type')
      }),

    publishMovement: (input) =>
      asCurator(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from catalog.publish_global_movement(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.publication.discipline_code}, ${input.publication.name},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return entry(rows, 'publish the movement')
      }),

    archiveMovement: (input) =>
      asCurator(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from catalog.archive_global_movement(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.movementId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return entry(rows, 'archive the movement')
      }),
  }
}

function entry(rows: CommandRow[], operation: string): CatalogueEntryResult {
  const [row] = rows
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return { resource: row.result, replayed: row.replayed }
}

function asCurator<T>(
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
