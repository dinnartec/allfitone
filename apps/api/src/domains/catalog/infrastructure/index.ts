import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import {
  measureRequestPhase,
  measureStudioRequestPhase,
} from '../../../platform/observability/index.js'
import type {
  ActivityTypeResultContract,
  CatalogActivityType,
  CatalogCommandResult,
  CatalogDiscipline,
  CatalogReader,
  GlobalCatalogDatabase,
  ProfessionalCatalogDatabase,
  ProfessionalCatalogItem,
  ResultContract,
  ResultContractDatabase,
} from '../domain/index.js'

type CommandRow = { result: ResultContract; replayed: boolean }

export function createProfessionalCatalogDatabase(): ProfessionalCatalogDatabase {
  const sql = database()

  return {
    listSpecialties: (personId) =>
      measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId)
          return transaction<ProfessionalCatalogItem[]>`
            select * from catalog.list_professional_specialties()
          `
        }),
      ),
    listCredentialTypes: (personId) =>
      measureStudioRequestPhase('business-db', () =>
        sql.begin(async (transaction) => {
          await setPersonActor(transaction, personId)
          return transaction<ProfessionalCatalogItem[]>`
            select * from catalog.list_professional_credential_types()
          `
        }),
      ),
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
 * Curation runs as the support actor. The catalogue read policies are written
 * for the product actor and expose only what is effective, so a curator that
 * arrived as `person` would be unable to close a superseded association or to
 * see the history the operator is publishing against.
 */
export function createResultContractDatabase(): ResultContractDatabase {
  const sql = database()

  return {
    publish: (input) =>
      command(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const publication = input.publication
        const [row] = await transaction<CommandRow[]>`
          select * from catalog.publish_result_contract(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${publication.contract_code}, ${publication.activity_family}::catalog.activity_family,
            ${jsonDocument(publication.envelope)}::jsonb,
            ${jsonDocument(publication.minimums)}::jsonb,
            ${jsonDocument(publication.fixtures)}::jsonb,
            ${publication.activity_type_id}::uuid, ${publication.is_default ?? true},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'publish the result contract')
      }),

    deprecate: (input) =>
      command(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from catalog.deprecate_result_contract(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.contractId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return required(row, 'deprecate the result contract')
      }),
  }
}

function command<T>(
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
 * A contract's envelope, minimums and fixtures are arbitrary JSON documents, so
 * they have no shape `postgres` can type. Binding the serialized text and
 * casting it in SQL preserves the object; `transaction.json` would need the DTO
 * widened to satisfy its own type.
 */
function jsonDocument(value: unknown): string {
  return JSON.stringify(value)
}

function required(
  row: CommandRow | undefined,
  operation: string,
): CatalogCommandResult<ResultContract> {
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return { resource: row.result, replayed: row.replayed }
}

/**
 * The global catalogue is read with the caller's own actor context: the policies
 * refuse a null person, and the closed functions refuse one that is not active.
 * The actor kind travels so a Backoffice read is recorded as support rather than
 * as the person themselves.
 */
export function createGlobalCatalogDatabase(): GlobalCatalogDatabase {
  const sql = database()

  const read = <T>(reader: CatalogReader, run: (t: postgres.TransactionSql) => Promise<T[]>) =>
    measureRequestPhase('business-db', async () => {
      const result = await sql.begin(async (transaction) => {
        await transaction`
          select set_config('app.actor_kind', ${reader.actorKind}, true),
                 set_config('app.actor_person_id', ${reader.personId}, true)
        `
        return { value: await run(transaction) }
      })
      return result.value
    })

  return {
    listDisciplines: (reader) =>
      read<CatalogDiscipline>(
        reader,
        (transaction) => transaction<CatalogDiscipline[]>`
          select * from catalog.list_disciplines()
        `,
      ),

    listActivityTypes: (reader) =>
      read<CatalogActivityType>(
        reader,
        (transaction) => transaction<CatalogActivityType[]>`
          select * from catalog.list_activity_types()
        `,
      ),

    listActivityTypeResultContracts: (reader, activityTypeId) =>
      read<ActivityTypeResultContract>(
        reader,
        (transaction) => transaction<ActivityTypeResultContract[]>`
          select * from catalog.list_activity_type_result_contracts(${activityTypeId}::uuid)
        `,
      ),
  }
}
