import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import type { ProfessionalCatalogDatabase, ProfessionalCatalogItem } from '../domain/index.js'

export function createProfessionalCatalogDatabase(): ProfessionalCatalogDatabase {
  const sql = database()

  return {
    listSpecialties: (personId) =>
      sql.begin(async (transaction) => {
        await setPersonActor(transaction, personId)
        return transaction<ProfessionalCatalogItem[]>`
          select * from catalog.list_professional_specialties()
        `
      }),
    listCredentialTypes: (personId) =>
      sql.begin(async (transaction) => {
        await setPersonActor(transaction, personId)
        return transaction<ProfessionalCatalogItem[]>`
          select * from catalog.list_professional_credential_types()
        `
      }),
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
