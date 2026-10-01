/**
 * PostgreSQL access for scope publication.
 *
 * Curation runs as the support actor: the insert policies on the privacy tables
 * require it, so a transaction that forgot the ritual writes nothing rather than
 * writing as somebody else.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  OfferableScope,
  OfferableScopeDatabase,
  AccessEvent,
  AccessEventPage,
  AccessLogDatabase,
  ScopeCommandResult,
  ScopeDefinition,
  ScopeDefinitionDatabase,
} from '../domain/index.js'

type CommandRow = { result: ScopeDefinition; replayed: boolean }

/**
 * The log and the count of what was withheld are read in **one** transaction. Two
 * transactions would let a write land between them, and the number would then
 * describe a list the auditor is not looking at — which is exactly the kind of
 * quiet inconsistency an audit read cannot afford.
 */
export function createAccessLogDatabase(): AccessLogDatabase {
  const sql = database()

  return {
    read: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const items = await transaction<AccessEvent[]>`
          select * from privacy.list_access_events(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.filterActorPersonId ?? null}::uuid,
            ${input.filterSubjectPersonId ?? null}::uuid,
            ${input.from ?? null}::timestamptz, ${input.to ?? null}::timestamptz,
            ${input.limit ?? null}::integer
          )
        `
        const [withheld] = await transaction<{ count_withheld_access_events: number }[]>`
          select * from privacy.count_withheld_access_events(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.filterActorPersonId ?? null}::uuid,
            ${input.filterSubjectPersonId ?? null}::uuid,
            ${input.from ?? null}::timestamptz, ${input.to ?? null}::timestamptz
          )
        `
        if (!withheld) throw new Error('PostgreSQL did not count the withheld access events')
        return {
          items,
          withheld_from_you: withheld.count_withheld_access_events,
        } satisfies AccessEventPage
      }),
  }
}

export function createScopeDefinitionDatabase(): ScopeDefinitionDatabase {
  const sql = database()

  return {
    publish: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from privacy.publish_scope_definition(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.publication.scope_code},
            ${JSON.stringify(input.publication.rules)}::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not publish the scope definition')
        return { resource: row.result, replayed: row.replayed } satisfies ScopeCommandResult
      }),

    list: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<{ result: ScopeDefinition }[]>`
          select * from privacy.list_scope_definitions(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid
          )
        `
        return rows.map((row) => row.result)
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

/**
 * PostgreSQL access for the offerable permission catalogue.
 *
 * Runs as the person actor, not as support: this is a professional reading the
 * product's own vocabulary, and `list_offerable_scopes` returns nothing to any
 * other kind of actor.
 */
export function createOfferableScopeDatabase(
  sql: ReturnType<typeof database> = database(),
): OfferableScopeDatabase {
  return {
    listOfferable: (input) =>
      measureRequestPhase('business-db', async () => {
        const result = await sql.begin(async (transaction) => {
          await transaction`
            select set_config('app.actor_kind', 'person', true),
                   set_config('app.actor_person_id', ${input.actorPersonId}, true),
                   set_config('app.request_id', ${input.requestId}, true)
          `
          return {
            rows: await transaction<OfferableScope[]>`
              select * from privacy.list_offerable_scopes()
            `,
          }
        })
        return [...result.rows]
      }),
  }
}
