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
  MyConsent,
  MyConsentDatabase,
  OfferableScope,
  OfferableScopeDatabase,
  AccessEvent,
  AccessEventPage,
  AccessLogDatabase,
  ErasureRequest,
  ErasureRequestDatabase,
  LegalHold,
  LegalHoldDatabase,
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

/**
 * One row more than the page is asked for, so "is there another page" is answered
 * by the same query rather than by a second count over a moving table.
 */
type HoldRow = { result: LegalHold; replayed: boolean }

export function createLegalHoldDatabase(): LegalHoldDatabase {
  const sql = database()

  return {
    apply: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<HoldRow[]>`
          select * from privacy.apply_legal_hold(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.application.scope_description}, ${input.application.reason_code},
            ${input.application.case_reference}, ${input.application.valid_to}::timestamptz,
            ${input.application.disposition_item_ids}::uuid[],
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not answer the legal hold')
        return { resource: row.result, replayed: row.replayed }
      }),

    release: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<HoldRow[]>`
          select * from privacy.release_legal_hold(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.holdId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not answer the legal hold release')
        return { resource: row.result, replayed: row.replayed }
      }),
  }
}

export function createErasureRequestDatabase(): ErasureRequestDatabase {
  const sql = database()

  return {
    list: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<ErasureRequest[]>`
          select * from privacy.list_erasure_requests(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.status}, ${input.limit + 1}::integer,
            ${input.cursor?.at ?? null}::timestamptz, ${input.cursor?.id ?? null}::uuid
          )
        `
        const hasMore = rows.length > input.limit
        return { items: hasMore ? rows.slice(0, input.limit) : rows, has_more: hasMore }
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
            ${JSON.stringify(input.publication.rules)}::text::jsonb,
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

type ConsentRow = Omit<
  MyConsent,
  'started_at' | 'ended_at' | 'decided_at' | 'granted_at' | 'frozen_at' | 'revoked_at'
> & {
  started_at: Date
  ended_at: Date | null
  decided_at: Date
  granted_at: Date | null
  frozen_at: Date | null
  revoked_at: Date | null
}

const instant = (value: Date | null): string | null => (value ? value.toISOString() : null)

/**
 * PostgreSQL access for what the person shares (`OP-PRV-013`, `OP-PRV-005`).
 *
 * Runs as the person: both functions answer that actor and nobody else, so a
 * transaction that skipped the ritual is refused rather than served.
 */
export function createMyConsentDatabase(
  sql: ReturnType<typeof database> = database(),
): MyConsentDatabase {
  return {
    listMine: (personId) =>
      measureRequestPhase('business-db', async () => {
        const result = await sql.begin(async (transaction) => {
          await asPerson(transaction, personId)
          return {
            rows: await transaction<ConsentRow[]>`
              select * from privacy.list_my_consents(${personId}::uuid)
            `,
          }
        })
        return result.rows.map((row) => ({
          ...row,
          started_at: row.started_at.toISOString(),
          ended_at: instant(row.ended_at),
          decided_at: row.decided_at.toISOString(),
          granted_at: instant(row.granted_at),
          frozen_at: instant(row.frozen_at),
          revoked_at: instant(row.revoked_at),
        }))
      }),

    revoke: (command) =>
      measureRequestPhase('business-db', async () => {
        const result = await sql.begin(async (transaction) => {
          await asPerson(transaction, command.personId)
          const [row] = await transaction<
            { grant_id: string; status: string; revoked_at: Date | null; replayed: boolean }[]
          >`
            select * from privacy.revoke_my_grant(
              ${command.personId}::uuid, ${command.grantId}::uuid,
              ${command.idempotencyKey}::uuid, ${command.commandId}::uuid,
              ${Buffer.from(command.requestHash)}::bytea
            )
          `
          return { row }
        })
        const { row } = result
        if (!row || row.status !== 'revoked' || !row.revoked_at) {
          throw new Error('PostgreSQL did not confirm the revocation')
        }
        return {
          resource: {
            grantId: row.grant_id,
            status: 'revoked' as const,
            revokedAt: row.revoked_at.toISOString(),
          },
          replayed: row.replayed,
        }
      }),
  }
}

async function asPerson(transaction: postgres.TransactionSql, personId: string): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'person', true),
           set_config('app.actor_person_id', ${personId}, true)
  `
}
