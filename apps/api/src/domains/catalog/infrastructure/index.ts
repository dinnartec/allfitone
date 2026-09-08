import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type {
  Movement,
  MovementLibraryDatabase,
  ProfessionalCatalogDatabase,
  ProfessionalCatalogItem,
} from '../domain/index.js'

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

export function createMovementLibraryDatabase(): MovementLibraryDatabase {
  const sql = database()

  return {
    readMovements: (request) =>
      sql.begin(async (transaction) => {
        await setPersonActor(transaction, request.personId)
        const [row] = await transaction<{ movements: Movement[] }[]>`
          select catalog.read_movements(
            ${request.personId}::uuid,
            ${request.discipline}::text,
            ${request.query}::text,
            ${request.limit}::integer
          ) as movements
        `
        return row?.movements ?? []
      }),
  }
}
