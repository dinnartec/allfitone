import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import {
  MovementCursorError,
  type CatalogueTerm,
  type MovementLibraryDatabase,
  type MuscleTerm,
  type Page,
  type ProfessionalCatalogDatabase,
  type ProfessionalCatalogItem,
  type StoredMovement,
  type StoredMovementDetail,
} from '../domain/index.js'

/** `22023` is what the reader raises for a cursor it cannot decode. */
function isInvalidCursor(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '22023'
}

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
      sql
        .begin(async (transaction) => {
          await setPersonActor(transaction, request.personId)
          const [row] = await transaction<{ movements: Page<StoredMovement> }[]>`
          select catalog.read_movements(
            ${request.personId}::uuid,
            ${request.discipline}::text,
            ${request.query}::text,
            ${request.limit}::integer,
            ${request.muscles}::text[],
            ${request.equipment}::text[],
            ${request.cursor}::text
          ) as movements
        `
          return row?.movements ?? { data: [], page: { next_cursor: null, has_more: false } }
        })
        .catch((cause: unknown) => {
          // The database raises 22023 for a cursor it cannot make sense of. Answering an
          // arbitrary page instead would look exactly like answering the right one.
          if (isInvalidCursor(cause)) throw new MovementCursorError()
          throw cause
        }),

    readMovement: (input) =>
      sql.begin(async (transaction) => {
        await setPersonActor(transaction, input.personId)
        const [row] = await transaction<{ movement: StoredMovementDetail | null }[]>`
          select catalog.read_movement(${input.personId}::uuid, ${input.movementId}::uuid)
            as movement
        `
        return row?.movement ?? null
      }),

    readEquipment: (personId) =>
      sql.begin(async (transaction) => {
        await setPersonActor(transaction, personId)
        const [row] = await transaction<{ terms: CatalogueTerm[] }[]>`
          select catalog.read_equipment(${personId}::uuid) as terms
        `
        return row?.terms ?? []
      }),

    readMuscles: (personId) =>
      sql.begin(async (transaction) => {
        await setPersonActor(transaction, personId)
        const [row] = await transaction<{ terms: MuscleTerm[] }[]>`
          select catalog.read_muscles(${personId}::uuid) as terms
        `
        return row?.terms ?? []
      }),
  }
}
